import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { saveEquipmentWorkbook } from '@/lib/excel/save'
import { Field } from '@/components/field'
import { LocationPicker } from '@/components/location-picker'
import { StatusBadge } from '@/components/status-badge'
import { UnitBulkActions } from '@/components/unit-bulk-actions'
import { SupabaseConfigNotice } from '@/components/supabase-config-notice'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useLocations } from '@/hooks/use-catalogs'
import { useDebounced } from '@/hooks/use-debounced'
import { useAccess } from '@/hooks/use-profile'
import { changeEquipmentStatusBulk, moveEquipmentBulk } from '@/lib/equipment-bulk'
import { errorText } from '@/lib/errors'
import { emptyToNull, unitsLabel } from '@/lib/format'
import { equipmentBulkLimit } from '@/lib/journal'
import { stashLabelCodes } from '@/lib/label-settings'
import { placeResponsibleNote } from '@/lib/location-tree'
import { equipmentStatuses, isEquipmentStatus } from '@/lib/labels'
import { supabase, supabaseConfigMessage } from '@/lib/supabase'
import type { EquipmentStatus } from '@/types/database'

type Draft = {
  nomenclatureId: string
  serialNumber: string
  inventoryNumber: string
  status: EquipmentStatus
  locationId: string
  notes: string
  lastVerificationDate: string
  nextVerificationDate: string
}

const emptyDraft: Draft = {
  nomenclatureId: '',
  serialNumber: '',
  inventoryNumber: '',
  status: 'in_work',
  locationId: '',
  notes: '',
  lastVerificationDate: '',
  nextVerificationDate: '',
}

export function UnitsPage() {
  const access = useAccess()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('q') ?? '')
  const debouncedSearch = useDebounced(search)
  const nomenclatureId = params.get('nomenclature') ?? ''
  const status = params.get('status') ?? ''
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<Draft>({
    ...emptyDraft,
    nomenclatureId,
  })
  const [createdCode, setCreatedCode] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const nomenclature = useQuery({
    queryKey: ['nomenclature', 'options'],
    enabled: Boolean(supabase),
    queryFn: async () => {
      const client = supabase
      if (!client) throw new Error('Supabase не настроен.')
      const { data, error } = await client
        .from('nomenclature')
        .select('id, code_prefix, name, requires_verification')
        .order('name')
      if (error) throw error
      return data ?? []
    },
  })

  const locations = useLocations()
  const locationChoices = (locations.data ?? []).filter((item) => !item.is_archived)

  const list = useQuery({
    queryKey: ['equipment', debouncedSearch, nomenclatureId, status],
    enabled: Boolean(supabase),
    queryFn: async () => {
      const client = supabase
      if (!client) throw new Error('Supabase не настроен.')
      let query = client.from('equipment_list').select('*').order('code')
      if (nomenclatureId) query = query.eq('nomenclature_id', nomenclatureId)
      if (status && isEquipmentStatus(status)) query = query.eq('status', status)
      const needle = debouncedSearch.trim().replace(/[%_,]/g, '')
      if (needle) {
        query = query.or(`code.ilike.%${needle}%,serial_number.ilike.%${needle}%`)
      }
      const { data, error } = await query
      if (error) throw error
      return data ?? []
    },
  })

  useEffect(() => {
    setSelected(new Set())
  }, [debouncedSearch, nomenclatureId, status])

  const selectedNomenclature = useMemo(
    () => nomenclature.data?.find((item) => item.id === draft.nomenclatureId),
    [nomenclature.data, draft.nomenclatureId],
  )

  function setFilter(key: string, value: string) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: true },
    )
  }

  const visibleRows = list.data ?? []
  const visibleIds = visibleRows.map((row) => row.id)
  const selectedIds = visibleIds.filter((id) => selected.has(id))
  const allSelected = visibleIds.length > 0 && selectedIds.length === visibleIds.length
  const someSelected = selectedIds.length > 0 && !allSelected

  function toggleSelected(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function refreshLists() {
    await queryClient.invalidateQueries({ queryKey: ['equipment'] })
    await queryClient.invalidateQueries({ queryKey: ['journal'] })
    await queryClient.invalidateQueries({ queryKey: ['equipment-status-counts'] })
    await queryClient.invalidateQueries({ queryKey: ['locations'] })
    await queryClient.invalidateQueries({ queryKey: ['nomenclature'] })
  }

  function openLabels() {
    const codes = visibleRows.filter((row) => selected.has(row.id)).map((row) => row.code)
    if (codes.length === 0) return
    if (codes.length > equipmentBulkLimit) {
      toast.error(`За один раз можно напечатать не больше ${equipmentBulkLimit} этикеток`)
      return
    }
    stashLabelCodes(codes)
    navigate('/labels?from=selection')
  }

  const moveBulk = useMutation({
    mutationFn: (input: { locationId: string | null; comment: string }) =>
      moveEquipmentBulk(selectedIds, input.locationId, input.comment),
    onSuccess: async (count) => {
      setSelected(new Set())
      await refreshLists()
      toast.success(`Перемещение записано: ${unitsLabel(count)}`)
    },
    onError: (error) => toast.error(errorText(error, 'Не удалось переместить')),
  })

  const statusBulk = useMutation({
    mutationFn: (input: { status: EquipmentStatus; comment: string }) =>
      changeEquipmentStatusBulk(selectedIds, input.status, input.comment),
    onSuccess: async (count) => {
      setSelected(new Set())
      await refreshLists()
      toast.success(`Статус изменён: ${unitsLabel(count)}`)
    },
    onError: (error) => toast.error(errorText(error, 'Не удалось сменить статус')),
  })

  const create = useMutation({
    mutationFn: async () => {
      const client = supabase
      if (!client) throw new Error('Supabase не настроен.')
      if (!draft.nomenclatureId) throw new Error('Выберите номенклатуру.')
      const payload = {
        nomenclature_id: draft.nomenclatureId,
        serial_number: emptyToNull(draft.serialNumber),
        inventory_number: emptyToNull(draft.inventoryNumber),
        status: draft.status,
        location_id: draft.locationId || null,
        notes: emptyToNull(draft.notes),
        last_verification_date: selectedNomenclature?.requires_verification
          ? emptyToNull(draft.lastVerificationDate)
          : null,
        next_verification_date: selectedNomenclature?.requires_verification
          ? emptyToNull(draft.nextVerificationDate)
          : null,
      }
      const { data, error } = await client.from('equipment').insert(payload).select('code').single()
      if (error) throw error
      return data.code
    },
    onSuccess: async (code) => {
      setCreatedCode(code)
      setCreating(false)
      setDraft({ ...emptyDraft, nomenclatureId })
      await queryClient.invalidateQueries({ queryKey: ['equipment'] })
      await queryClient.invalidateQueries({ queryKey: ['nomenclature'] })
      await queryClient.invalidateQueries({ queryKey: ['locations'] })
      toast.success(`Единица создана: ${code}`)
    },
    onError: (error) => {
      toast.error(errorText(error, 'Не удалось создать единицу'))
    },
  })

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Единицы</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Конкретные экземпляры. Код вида KYOC-001 назначает база, номер не повторяется.
          </p>
        </div>
        {access.canEditEquipment ? (
          <Button
            type="button"
            className="h-11 w-full sm:w-auto"
            onClick={() => {
              setCreatedCode(null)
              setDraft((current) => ({
                ...current,
                nomenclatureId: nomenclatureId || current.nomenclatureId,
              }))
              setCreating(true)
            }}
          >
            Добавить единицу
          </Button>
        ) : null}
      </header>

      {!supabase && supabaseConfigMessage ? (
        <SupabaseConfigNotice message={supabaseConfigMessage} />
      ) : null}

      {access.isSuccess && !access.data ? (
        <p className="text-sm text-muted-foreground">
          Профиль не найден или доступ отключён. Обратитесь к администратору.
        </p>
      ) : null}

      {access.data && !access.canEditEquipment ? (
        <p className="text-sm text-muted-foreground">
          У вас доступ только на просмотр. Создавать единицы и менять статус могут редактор и
          администратор.
        </p>
      ) : null}

      {createdCode ? (
        <Card>
          <CardHeader>
            <CardTitle>Код единицы</CardTitle>
            <CardDescription>Его присвоила база. Этот код пойдёт на этикетку.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="font-mono text-3xl font-semibold tracking-wide">{createdCode}</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button asChild className="h-11 w-full sm:w-auto">
                <Link to={`/units/${createdCode}`}>Открыть карточку</Link>
              </Button>
              <Button asChild variant="outline" className="h-11 w-full sm:w-auto">
                <Link to={`/labels?codes=${encodeURIComponent(createdCode)}`}>Этикетка</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {creating && access.canEditEquipment ? (
        <Card>
          <CardHeader>
            <CardTitle>Новая единица</CardTitle>
            <CardDescription>Поле кода нет: его нельзя задать с клиента.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault()
                create.mutate()
              }}
            >
              <Field label="Номенклатура" htmlFor="unit-nomenclature">
                <NativeSelect
                  id="unit-nomenclature"
                  value={draft.nomenclatureId}
                  required
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, nomenclatureId: event.target.value }))
                  }
                >
                  <option value="">Выберите модель</option>
                  {(nomenclature.data ?? []).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.code_prefix} — {item.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Статус" htmlFor="unit-status">
                <NativeSelect
                  id="unit-status"
                  value={draft.status}
                  onChange={(event) => {
                    const value = event.target.value
                    if (!isEquipmentStatus(value)) return
                    setDraft((current) => ({ ...current, status: value }))
                  }}
                >
                  {equipmentStatuses.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Серийный номер" htmlFor="unit-serial">
                <Input
                  id="unit-serial"
                  value={draft.serialNumber}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, serialNumber: event.target.value }))
                  }
                  className="h-11"
                />
              </Field>
              <Field label="Инвентарный номер" htmlFor="unit-inventory">
                <Input
                  id="unit-inventory"
                  value={draft.inventoryNumber}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, inventoryNumber: event.target.value }))
                  }
                  className="h-11"
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Место" htmlFor="unit-location" hint="Поиск идёт по полному пути.">
                  <LocationPicker
                    id="unit-location"
                    locations={locationChoices}
                    value={draft.locationId}
                    onChange={(locationId) => setDraft((current) => ({ ...current, locationId }))}
                    allowEmpty
                    emptyLabel="Не назначено"
                  />
                </Field>
              </div>
              {selectedNomenclature?.requires_verification ? (
                <>
                  <Field label="Последняя поверка" htmlFor="unit-last">
                    <Input
                      id="unit-last"
                      type="date"
                      value={draft.lastVerificationDate}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          lastVerificationDate: event.target.value,
                        }))
                      }
                      className="h-11"
                    />
                  </Field>
                  <Field label="Следующая поверка" htmlFor="unit-next">
                    <Input
                      id="unit-next"
                      type="date"
                      value={draft.nextVerificationDate}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          nextVerificationDate: event.target.value,
                        }))
                      }
                      className="h-11"
                    />
                  </Field>
                </>
              ) : null}
              <div className="sm:col-span-2">
                <Field label="Заметки" htmlFor="unit-notes">
                  <Textarea
                    id="unit-notes"
                    value={draft.notes}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, notes: event.target.value }))
                    }
                  />
                </Field>
              </div>
              <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row">
                <Button type="submit" className="h-11" disabled={create.isPending}>
                  {create.isPending ? 'Сохранение…' : 'Создать'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  onClick={() => setCreating(false)}
                >
                  Отмена
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {supabase ? (
        <div className="flex flex-col gap-3">
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full sm:w-auto"
              disabled={!list.data}
              onClick={() => {
                const count = visibleRows.length
                void saveEquipmentWorkbook(
                  visibleRows.map((row) => ({
                    code: row.code,
                    code_prefix: row.code_prefix,
                    nomenclature_name: row.nomenclature_name,
                    serial_number: row.serial_number,
                    inventory_number: row.inventory_number,
                    status: row.status,
                    location_path: row.location_path,
                    last_verification_date: row.last_verification_date,
                    next_verification_date: row.next_verification_date,
                    notes: row.notes,
                  })),
                  'единицы.xlsx',
                )
                  .then(() => toast.success(`В файле ${count} строк, с текущими фильтрами`))
                  .catch((error) => toast.error(errorText(error, 'Не удалось выгрузить единицы')))
              }}
            >
              Скачать Excel
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setFilter('q', event.target.value.trim())
              }}
              placeholder="Код или серийный номер"
              aria-label="Поиск по коду или серийному номеру"
              className="h-11"
            />
            <NativeSelect
              aria-label="Фильтр по номенклатуре"
              value={nomenclatureId}
              onChange={(event) => setFilter('nomenclature', event.target.value)}
            >
              <option value="">Вся номенклатура</option>
              {(nomenclature.data ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code_prefix} — {item.name}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label="Фильтр по статусу"
              value={status}
              onChange={(event) => setFilter('status', event.target.value)}
            >
              <option value="">Все статусы</option>
              {equipmentStatuses.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
      ) : null}

      {list.isLoading ? <p className="text-sm text-muted-foreground">Загрузка…</p> : null}
      {list.error ? (
        <p className="text-sm text-destructive" role="alert">
          {errorText(list.error, 'Не удалось загрузить единицы')}
        </p>
      ) : null}

      {list.data && list.data.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Ничего не найдено</CardTitle>
            <CardDescription>Измените поиск или фильтры, либо добавьте единицу.</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {visibleRows.length > 0 ? (
        <UnitBulkActions
          selectedCount={selectedIds.length}
          shownCount={visibleRows.length}
          allSelected={allSelected}
          someSelected={someSelected}
          locations={locationChoices}
          pending={moveBulk.isPending || statusBulk.isPending}
          allowChanges={access.canEditEquipment}
          onPrintLabels={openLabels}
          onToggleAll={() => {
            setSelected((current) => {
              if (allSelected) {
                const next = new Set(current)
                for (const id of visibleIds) next.delete(id)
                return next
              }
              return new Set([...current, ...visibleIds])
            })
          }}
          onClear={() => setSelected(new Set())}
          onMove={(locationId, comment) => moveBulk.mutate({ locationId, comment })}
          onChangeStatus={(nextStatus, comment) =>
            statusBulk.mutate({ status: nextStatus, comment })
          }
        />
      ) : null}

      <ul className="flex flex-col gap-3">
        {visibleRows.map((row) => {
          const responsible = placeResponsibleNote(row)
          return (
            <li key={row.id} className="flex items-stretch rounded-xl border bg-card">
              <label className="flex w-12 shrink-0 cursor-pointer items-center justify-center">
                <input
                  type="checkbox"
                  className="size-5"
                  checked={selected.has(row.id)}
                  aria-label={`Выбрать ${row.code}`}
                  onChange={() => toggleSelected(row.id)}
                />
              </label>
              <Link
                to={`/units/${row.code}`}
                className="block min-w-0 flex-1 p-4 transition-colors hover:bg-accent/40"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono text-lg font-semibold">{row.code}</p>
                  <StatusBadge status={row.status} />
                </div>
                <p className="mt-2 text-sm">
                  {row.nomenclature_name}
                  {row.model ? ` · ${row.model}` : ''}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {row.serial_number ? `Серийный ${row.serial_number}` : 'Серийный не указан'}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {row.location_path?.trim() ? row.location_path : 'Место не назначено'}
                </p>
                {row.location_id ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {responsible ?? 'Ответственный не назначен'}
                  </p>
                ) : null}
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
