import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Field } from '@/components/field'
import { StatusBadge } from '@/components/status-badge'
import { SupabaseConfigNotice } from '@/components/supabase-config-notice'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useAccess } from '@/hooks/use-profile'
import { errorText } from '@/lib/errors'
import { emptyToNull, formatDate, formatDateTime } from '@/lib/format'
import { equipmentStatuses, isEquipmentStatus, statusLabel } from '@/lib/labels'
import { supabase, supabaseConfigMessage } from '@/lib/supabase'
import type { EquipmentStatus } from '@/types/database'

function placeLabel(path: string | null | undefined): string {
  return path?.trim() ? path : 'Место не назначено'
}

export function UnitPage() {
  const { code = '' } = useParams()
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
    queryKey: ['equipment', 'card', code],
    enabled: Boolean(supabase && code),
    queryFn: async () => {
      const client = supabase
      if (!client) throw new Error('Supabase не настроен.')
      const { data, error } = await client
        .from('equipment_list')
        .select('*')
        .eq('code', code)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })

  const row = unit.data
  const equipmentId = row?.id

  const movements = useQuery({
    queryKey: ['movements', equipmentId],
    enabled: Boolean(supabase && equipmentId),
    queryFn: async () => {
      const client = supabase
      if (!client || !equipmentId) throw new Error('Нет единицы')
      const { data, error } = await client
        .from('movement_history')
        .select('*')
        .eq('equipment_id', equipmentId)
        .order('moved_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })

  const statuses = useQuery({
    queryKey: ['status-changes', equipmentId],
    enabled: Boolean(supabase && equipmentId),
    queryFn: async () => {
      const client = supabase
      if (!client || !equipmentId) throw new Error('Нет единицы')
      const { data, error } = await client
        .from('status_change_history')
        .select('*')
        .eq('equipment_id', equipmentId)
        .order('changed_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })

  const locations = useQuery({
    queryKey: ['locations', 'options'],
    enabled: Boolean(supabase && access.canEditEquipment),
    queryFn: async () => {
      const client = supabase
      if (!client) throw new Error('Supabase не настроен.')
      const { data, error } = await client
        .from('locations_with_path')
        .select('id, full_path, name, is_archived')
        .order('full_path')
      if (error) throw error
      return data ?? []
    },
  })

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['equipment'] })
    await queryClient.invalidateQueries({ queryKey: ['movements', equipmentId] })
    await queryClient.invalidateQueries({ queryKey: ['status-changes', equipmentId] })
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

  const locationOptions = (locations.data ?? []).filter(
    (item) => !item.is_archived || item.id === row?.location_id,
  )
  const currentLocation = locationId === null ? (row?.location_id ?? '') : locationId

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <Link to="/units" className="text-sm text-primary">
          ← К списку единиц
        </Link>
        <h1 className="mt-2 font-mono text-2xl font-semibold tracking-tight">{code}</h1>
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

      {unit.data === null ? (
        <Card>
          <CardHeader>
            <CardTitle>Единица не найдена</CardTitle>
            <CardDescription>Кода {code} в базе нет.</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {row ? (
        <>
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
                {placeLabel(row.location_path)}
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
                    Интервал {row.verification_interval_months} мес. Журнал поверок появится на
                    этапе 6, даты на карточке обновляет база.
                  </p>
                </>
              ) : null}
            </CardContent>
          </Card>

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
                  Место выбирается из списка. Можно переносить при любом статусе, в том числе
                  «Списано».
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
                    <NativeSelect
                      id="card-location"
                      value={currentLocation}
                      onChange={(event) => setLocationId(event.target.value)}
                    >
                      <option value="">Не назначено</option>
                      {locationOptions.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.full_path || item.name}
                          {item.is_archived ? ' (архив)' : ''}
                        </option>
                      ))}
                    </NativeSelect>
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
            <h2 className="text-lg font-semibold">История статусов</h2>
            {(statuses.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Записей пока нет.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {(statuses.data ?? []).map((item) => (
                  <li key={item.id} className="rounded-xl border p-4 text-sm">
                    <p className="font-medium">
                      {item.from_status ? statusLabel(item.from_status) : 'Создание'} →{' '}
                      {statusLabel(item.to_status)}
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      {formatDateTime(item.changed_at)} · {item.changed_by_name}
                    </p>
                    {item.comment ? <p className="mt-2">{item.comment}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">История перемещений</h2>
            {(movements.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Записей пока нет.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {(movements.data ?? []).map((item) => (
                  <li key={item.id} className="rounded-xl border p-4 text-sm">
                    <p className="font-medium">
                      {placeLabel(item.from_path)} → {placeLabel(item.to_path)}
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      {formatDateTime(item.moved_at)} · {item.moved_by_name}
                    </p>
                    {item.comment ? <p className="mt-2">{item.comment}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  )
}
