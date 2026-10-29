import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Field } from '@/components/field'
import { LocationPicker } from '@/components/location-picker'
import { StatusBadge } from '@/components/status-badge'
import { SupabaseConfigNotice } from '@/components/supabase-config-notice'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useLocations } from '@/hooks/use-catalogs'
import { useDebounced } from '@/hooks/use-debounced'
import { useAccess } from '@/hooks/use-profile'
import { errorText } from '@/lib/errors'
import { emptyToNull } from '@/lib/format'
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
            <Button asChild className="h-11 w-full sm:w-auto">
              <Link to={`/units/${createdCode}`}>Открыть карточку</Link>
            </Button>
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

      <ul className="flex flex-col gap-3">
        {(list.data ?? []).map((row) => {
          const responsible = placeResponsibleNote(row)
          return (
            <li key={row.id}>
              <Link
                to={`/units/${row.code}`}
                className="block rounded-xl border bg-card p-4 transition-colors hover:bg-accent/40"
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
