import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Field } from '@/components/field'
import { HistoryTimeline } from '@/components/history-timeline'
import { UnitQr } from '@/components/unit-qr'
import { VerificationJournal } from '@/components/verification-journal'
import { LocationPicker } from '@/components/location-picker'
import { StatusBadge } from '@/components/status-badge'
import { SupabaseConfigNotice } from '@/components/supabase-config-notice'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useLocations } from '@/hooks/use-catalogs'
import { useAccess } from '@/hooks/use-profile'
import { errorText } from '@/lib/errors'
import { emptyToNull, formatDate } from '@/lib/format'
import { placeLabel } from '@/lib/journal'
import { placeResponsibleNote } from '@/lib/location-tree'
import { equipmentStatuses, isEquipmentStatus } from '@/lib/labels'
import { supabase, supabaseConfigMessage } from '@/lib/supabase'
import type { EquipmentStatus } from '@/types/database'

export function UnitPage() {
  const { code = '' } = useParams()
  const [params] = useSearchParams()
  const formerFromQuery = params.get('former')
  const access = useAccess()
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<EquipmentStatus | ''>('')
  const [statusComment, setStatusComment] = useState('')
  const [locationId, setLocationId] = useState<string | null>(null)
  const [moveComment, setMoveComment] = useState('')
  const [serialNumber, setSerialNumber] = useState<string | null>(null)
  const [inventoryNumber, setInventoryNumber] = useState<string | null>(null)
  const [notes, setNotes] = useState<string | null>(null)

  const unit = useQuery({
    queryKey: ['equipment', 'card', code, formerFromQuery],
    enabled: Boolean(supabase && code),
    queryFn: async () => {
      const client = supabase
      if (!client) throw new Error('Supabase не настроен.')
      const loaded = await client.from('equipment_list').select('*').eq('code', code).maybeSingle()
      if (loaded.error) throw loaded.error
      if (loaded.data) {
        return { row: loaded.data, formerCode: formerFromQuery }
      }
      const alias = await client
        .from('equipment_former_codes')
        .select('equipment_id, code')
        .eq('code', code)
        .maybeSingle()
      if (alias.error) throw alias.error
      if (!alias.data) return { row: null, formerCode: null }
      const current = await client
        .from('equipment_list')
        .select('*')
        .eq('id', alias.data.equipment_id)
        .maybeSingle()
      if (current.error) throw current.error
      return { row: current.data, formerCode: alias.data.code }
    },
  })

  const row = unit.data?.row ?? null
  const formerCode = unit.data?.formerCode ?? null
  const equipmentId = row?.id

  const history = useQuery({
    queryKey: ['journal', 'unit', equipmentId],
    enabled: Boolean(supabase && equipmentId),
    queryFn: async () => {
      const client = supabase
      if (!client || !equipmentId) throw new Error('Нет единицы')
      const { data, error } = await client
        .from('journal_events')
        .select('*')
        .eq('equipment_id', equipmentId)
        .order('occurred_at', { ascending: false })
        .order('id', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })

  const locations = useLocations(access.canEditEquipment)

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['equipment'] })
    await queryClient.invalidateQueries({ queryKey: ['locations'] })
    await queryClient.invalidateQueries({ queryKey: ['journal'] })
    await queryClient.invalidateQueries({ queryKey: ['equipment-status-counts'] })
  }

  const changeStatus = useMutation({
    mutationFn: async () => {
      const client = supabase
      const nextStatus = status || row?.status
      if (!client || !equipmentId || !nextStatus) throw new Error('Выберите статус.')
      const { error } = await client.rpc('change_equipment_status', {
        equipment_id: equipmentId,
        new_status: nextStatus,
        comment: emptyToNull(statusComment),
      })
      if (error) throw error
    },
    onSuccess: async () => {
      setStatusComment('')
      setStatus('')
      await refresh()
      toast.success('Статус изменён')
    },
    onError: (error) => toast.error(errorText(error, 'Не удалось сменить статус')),
  })

  const move = useMutation({
    mutationFn: async () => {
      const client = supabase
      if (!client || !equipmentId) throw new Error('Единица не найдена.')
      const nextLocation = locationId === null ? (row?.location_id ?? '') : locationId
      if (!nextLocation) throw new Error('Укажите место установки.')
      const { error } = await client.rpc('move_equipment', {
        equipment_id: equipmentId,
        to_location_id: nextLocation || null,
        comment: emptyToNull(moveComment),
      })
      if (error) throw error
    },
    onSuccess: async () => {
      setMoveComment('')
      setLocationId(null)
      await refresh()
      toast.success('Перемещение записано')
    },
    onError: (error) => toast.error(errorText(error, 'Не удалось переместить')),
  })

  const saveDetails = useMutation({
    mutationFn: async () => {
      const client = supabase
      if (!client || !equipmentId) throw new Error('Единица не найдена.')
      const { error } = await client
        .from('equipment')
        .update({
          serial_number: emptyToNull(serialNumber ?? row?.serial_number ?? ''),
          inventory_number: emptyToNull(inventoryNumber ?? row?.inventory_number ?? ''),
          notes: emptyToNull(notes ?? row?.notes ?? ''),
        })
        .eq('id', equipmentId)
      if (error) throw error
    },
    onSuccess: async () => {
      await refresh()
      toast.success('Данные сохранены')
    },
    onError: (error) => toast.error(errorText(error, 'Не удалось сохранить')),
  })

  const locationChoices = (locations.data ?? []).filter(
    (item) => !item.is_archived || item.id === row?.location_id,
  )
  const currentLocation = locationId === null ? (row?.location_id ?? '') : locationId
  const responsible = row ? placeResponsibleNote(row) : null

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <Link to="/units" className="text-sm text-primary">
          ← К списку единиц
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <h1 className="font-mono text-2xl font-semibold tracking-tight">{row?.code ?? code}</h1>
          {row ? (
            <Button asChild variant="outline" className="h-11">
              <Link to={`/labels?codes=${encodeURIComponent(row.code)}`}>Этикетка</Link>
            </Button>
          ) : null}
        </div>
      </div>

      {!supabase && supabaseConfigMessage ? (
        <SupabaseConfigNotice message={supabaseConfigMessage} />
      ) : null}

      {unit.isLoading ? <p className="text-sm text-muted-foreground">Загрузка…</p> : null}
      {unit.error ? (
        <p className="text-sm text-destructive" role="alert">
          {errorText(unit.error, 'Не удалось открыть карточку')}
        </p>
      ) : null}

      {unit.isSuccess && !row ? (
        <Card>
          <CardHeader>
            <CardTitle>Единица не найдена</CardTitle>
            <CardDescription>Кода {code} в базе нет.</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {row ? (
        <>
          {formerCode ? (
            <div
              className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
              role="status"
            >
              <p className="font-medium">
                Этикетка устарела: старый код {formerCode}, новый {row.code} — замените этикетку
              </p>
              <Button asChild className="mt-3 h-11 w-full sm:w-auto">
                <Link to={`/labels?codes=${encodeURIComponent(row.code)}`}>
                  Печать новой этикетки
                </Link>
              </Button>
            </div>
          ) : null}
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle>{row.nomenclature_name}</CardTitle>
                <StatusBadge status={row.status} />
              </div>
              <CardDescription>
                {[row.manufacturer, row.model, row.category].filter(Boolean).join(' · ') ||
                  row.code_prefix}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="flex items-center gap-4 sm:col-span-2">
                <UnitQr code={row.code} pixels={256} className="size-28 shrink-0" />
                <p className="min-w-0 text-muted-foreground break-words">
                  QR открывает эту карточку по ссылке. Код {row.code} напечатан рядом.
                </p>
              </div>
              <p>
                <span className="text-muted-foreground">Серийный номер</span>
                <br />
                {row.serial_number || '—'}
              </p>
              <p>
                <span className="text-muted-foreground">Инвентарный номер</span>
                <br />
                {row.inventory_number || '—'}
              </p>
              <p className="sm:col-span-2">
                <span className="text-muted-foreground">Место</span>
                <br />
                {row.location_id ? (
                  <Link to={`/locations/${row.location_id}`} className="text-primary">
                    {placeLabel(row.location_path)}
                  </Link>
                ) : (
                  placeLabel(row.location_path)
                )}
              </p>
              <p className="sm:col-span-2">
                <span className="text-muted-foreground">Ответственный места</span>
                <br />
                {responsible ?? 'Не назначен'}
              </p>
              <p className="sm:col-span-2">
                <span className="text-muted-foreground">Заметки</span>
                <br />
                {row.notes || '—'}
              </p>
              {row.requires_verification ? (
                <>
                  <p>
                    <span className="text-muted-foreground">Последняя поверка</span>
                    <br />
                    {formatDate(row.last_verification_date)}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Следующая поверка</span>
                    <br />
                    {formatDate(row.next_verification_date)}
                  </p>
                  <p className="text-muted-foreground sm:col-span-2">
                    Интервал {row.verification_interval_months} мес. Даты на карточке обновляет база
                    по последней записи журнала.
                  </p>
                </>
              ) : null}
            </CardContent>
          </Card>

          {row.requires_verification ? (
            <VerificationJournal
              equipmentId={row.id}
              status={row.status}
              intervalMonths={row.verification_interval_months}
              canEdit={access.canEditEquipment}
            />
          ) : null}

          {access.canEditEquipment ? (
            <Card>
              <CardHeader>
                <CardTitle>Учётные данные</CardTitle>
                <CardDescription>Код и номенклатуру после создания сменить нельзя.</CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  className="grid gap-4"
                  onSubmit={(event) => {
                    event.preventDefault()
                    saveDetails.mutate()
                  }}
                >
                  <Field label="Серийный номер" htmlFor="card-serial">
                    <Input
                      id="card-serial"
                      className="h-11"
                      value={serialNumber ?? row.serial_number ?? ''}
                      onChange={(event) => setSerialNumber(event.target.value)}
                    />
                  </Field>
                  <Field label="Инвентарный номер" htmlFor="card-inventory">
                    <Input
                      id="card-inventory"
                      className="h-11"
                      value={inventoryNumber ?? row.inventory_number ?? ''}
                      onChange={(event) => setInventoryNumber(event.target.value)}
                    />
                  </Field>
                  <Field label="Заметки" htmlFor="card-notes">
                    <Textarea
                      id="card-notes"
                      value={notes ?? row.notes ?? ''}
                      onChange={(event) => setNotes(event.target.value)}
                    />
                  </Field>
                  <Button
                    type="submit"
                    className="h-11 w-full sm:w-auto"
                    disabled={saveDetails.isPending}
                  >
                    Сохранить данные
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : null}

          {access.canEditEquipment ? (
            <Card>
              <CardHeader>
                <CardTitle>Статус</CardTitle>
                <CardDescription>
                  Смена пишется в историю: кто, когда и комментарий.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  className="grid gap-4"
                  onSubmit={(event) => {
                    event.preventDefault()
                    changeStatus.mutate()
                  }}
                >
                  <Field label="Новый статус" htmlFor="card-status">
                    <NativeSelect
                      id="card-status"
                      value={status || row.status}
                      onChange={(event) => {
                        const value = event.target.value
                        if (!isEquipmentStatus(value)) return
                        setStatus(value)
                      }}
                    >
                      {equipmentStatuses.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field label="Комментарий" htmlFor="card-status-comment">
                    <Textarea
                      id="card-status-comment"
                      value={statusComment}
                      onChange={(event) => setStatusComment(event.target.value)}
                    />
                  </Field>
                  <Button
                    type="submit"
                    className="h-11 w-full sm:w-auto"
                    disabled={changeStatus.isPending}
                  >
                    Сменить статус
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : null}

          {access.canEditEquipment ? (
            <Card>
              <CardHeader>
                <CardTitle>Перемещение</CardTitle>
                <CardDescription>
                  Место выбирается из дерева, поиск идёт по полному пути. Можно переносить при любом
                  статусе, в том числе «Списано».
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  className="grid gap-4"
                  onSubmit={(event) => {
                    event.preventDefault()
                    move.mutate()
                  }}
                >
                  <Field label="Куда" htmlFor="card-location">
                    <LocationPicker
                      id="card-location"
                      locations={locationChoices}
                      value={currentLocation}
                      onChange={setLocationId}
                      emptyLabel="Выберите место"
                    />
                  </Field>
                  <Field label="Комментарий" htmlFor="card-move-comment">
                    <Textarea
                      id="card-move-comment"
                      value={moveComment}
                      onChange={(event) => setMoveComment(event.target.value)}
                    />
                  </Field>
                  <Button type="submit" className="h-11 w-full sm:w-auto" disabled={move.isPending}>
                    Переместить
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : null}

          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2 className="text-lg font-semibold">История</h2>
              <Link
                to={`/history?code=${encodeURIComponent(row.code)}`}
                className="text-sm text-primary"
              >
                В журнале
              </Link>
            </div>
            {history.isLoading ? <p className="text-sm text-muted-foreground">Загрузка…</p> : null}
            {history.error ? (
              <p className="text-sm text-destructive" role="alert">
                {errorText(history.error, 'Не удалось загрузить историю')}
              </p>
            ) : null}
            {history.data ? <HistoryTimeline events={history.data} /> : null}
          </section>
        </>
      ) : null}
    </div>
  )
}
