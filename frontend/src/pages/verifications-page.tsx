import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Field } from '@/components/field'
import { StatusBadge } from '@/components/status-badge'
import { SupabaseConfigNotice } from '@/components/supabase-config-notice'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { useLocations } from '@/hooks/use-catalogs'
import { saveVerificationQueueWorkbook } from '@/lib/excel/save'
import { errorText } from '@/lib/errors'
import { formatDate } from '@/lib/format'
import { subtreeIds } from '@/lib/location-tree'
import { supabase, supabaseConfigMessage } from '@/lib/supabase'
import {
  soonVerificationDays,
  verificationGroup,
  verificationGroupLabel,
  verificationGroups,
  isVerificationGroup,
  type VerificationGroup,
} from '@/lib/verification'
import type { VerificationQueueRow } from '@/types/database'

function parseDays(value: string | null): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 3650) return soonVerificationDays
  return parsed
}

export function VerificationsPage() {
  const [params, setParams] = useSearchParams()
  const nomenclatureId = params.get('nomenclature') ?? ''
  const locationId = params.get('location') ?? ''
  const days = parseDays(params.get('days'))
  const showWrittenOff = params.get('retired') === '1'
  const groupParam = params.get('group') ?? ''
  const groupFilter = isVerificationGroup(groupParam) ? groupParam : ''

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

  const nomenclature = useQuery({
    queryKey: ['nomenclature', 'options'],
    enabled: Boolean(supabase),
    queryFn: async () => {
      const client = supabase
      if (!client) throw new Error('Supabase не настроен.')
      const { data, error } = await client
        .from('nomenclature')
        .select('id, code_prefix, name, requires_verification')
        .eq('requires_verification', true)
        .order('name')
      if (error) throw error
      return data ?? []
    },
  })

  const locations = useLocations()
  const queue = useQuery({
    queryKey: ['verification-queue'],
    enabled: Boolean(supabase),
    queryFn: async () => {
      const client = supabase
      if (!client) throw new Error('Supabase не настроен.')
      const { data, error } = await client
        .from('equipment_verification_queue')
        .select('*')
        .order('code')
      if (error) throw error
      return data ?? []
    },
  })

  const locationOptions = [...(locations.data ?? [])].sort((left, right) =>
    (left.full_path ?? left.name).localeCompare(right.full_path ?? right.name, 'ru'),
  )
  const scope = useMemo(() => {
    if (!locationId || locationId === 'none') return null
    return new Set(subtreeIds(locations.data ?? [], locationId))
  }, [locationId, locations.data])

  const grouped = useMemo(() => {
    const buckets: Record<VerificationGroup, VerificationQueueRow[]> = {
      overdue: [],
      soon: [],
      ok: [],
      no_data: [],
    }
    for (const row of queue.data ?? []) {
      if (!showWrittenOff && row.status === 'written_off') continue
      if (nomenclatureId && row.nomenclature_id !== nomenclatureId) continue
      if (locationId === 'none' && row.location_id) continue
      if (scope && (!row.location_id || !scope.has(row.location_id))) continue
      const group = verificationGroup(row.next_verification_date, days)
      if (groupFilter && group !== groupFilter) continue
      buckets[group].push(row)
    }
    return buckets
  }, [queue.data, showWrittenOff, nomenclatureId, locationId, scope, days, groupFilter])

  const visible = verificationGroups.flatMap((item) => grouped[item.value])

  function exportQueue() {
    const count = visible.length
    void saveVerificationQueueWorkbook(
      visible.map((row) => ({
        code: row.code,
        nomenclature_name: row.nomenclature_name,
        code_prefix: row.code_prefix,
        location_path: row.location_path,
        status: row.status,
        last_verification_date: row.last_verification_date,
        next_verification_date: row.next_verification_date,
        group: verificationGroupLabel(verificationGroup(row.next_verification_date, days), days),
      })),
      'график-поверок.xlsx',
    )
      .then(() => toast.success(`В файле ${count} строк`))
      .catch((error) => toast.error(errorText(error, 'Не удалось выгрузить график')))
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Поверки</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Только единицы, у которых номенклатура требует поверки. Списанные скрыты, пока их не
            включить. Порог «скоро» по умолчанию 30 дней.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full sm:w-auto"
          disabled={!queue.data}
          onClick={exportQueue}
        >
          Скачать Excel
        </Button>
      </header>

      {!supabase && supabaseConfigMessage ? (
        <SupabaseConfigNotice message={supabaseConfigMessage} />
      ) : null}

      {supabase ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Номенклатура" htmlFor="verify-nomenclature">
            <NativeSelect
              id="verify-nomenclature"
              value={nomenclatureId}
              onChange={(event) => setFilter('nomenclature', event.target.value)}
            >
              <option value="">Вся номенклатура с поверкой</option>
              {(nomenclature.data ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code_prefix} — {item.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field
            label="Место"
            htmlFor="verify-location"
            hint="Выбранное место и всё, что внутри него."
          >
            <NativeSelect
              id="verify-location"
              value={locationId}
              onChange={(event) => setFilter('location', event.target.value)}
            >
              <option value="">Все места</option>
              <option value="none">Место не назначено</option>
              {locationOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.full_path || item.name}
                  {item.is_archived ? ' · архив' : ''}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Порог «скоро», дней" htmlFor="verify-days">
            <Input
              id="verify-days"
              type="number"
              min={0}
              max={3650}
              className="h-11"
              value={days}
              onChange={(event) => setFilter('days', event.target.value)}
            />
          </Field>
          <label className="flex items-end gap-3 pb-2 text-sm">
            <input
              type="checkbox"
              className="size-5"
              checked={showWrittenOff}
              onChange={(event) => setFilter('retired', event.target.checked ? '1' : '')}
            />
            Показывать списанные
          </label>
        </div>
      ) : null}

      {groupFilter ? (
        <p className="text-sm">
          Показана группа «{verificationGroupLabel(groupFilter, days)}».{' '}
          <button type="button" className="text-primary" onClick={() => setFilter('group', '')}>
            Все группы
          </button>
        </p>
      ) : null}

      {queue.isLoading ? <p className="text-sm text-muted-foreground">Загрузка…</p> : null}
      {queue.error ? (
        <p className="text-sm text-destructive" role="alert">
          {errorText(queue.error, 'Не удалось загрузить график поверок')}
        </p>
      ) : null}

      {queue.data && visible.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Ничего не найдено</CardTitle>
            <CardDescription>
              Нет единиц с поверкой под этими фильтрами. Проверьте флаг у номенклатуры.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {verificationGroups.map((group) => {
        const rows = grouped[group.value]
        if (rows.length === 0) return null
        return (
          <section key={group.value} className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">
              {verificationGroupLabel(group.value, days)}{' '}
              <span className="text-muted-foreground">{rows.length}</span>
            </h2>
            <ul className="flex flex-col gap-3">
              {rows.map((row) => (
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
                      {row.verification_interval_months
                        ? ` · ${row.verification_interval_months} мес.`
                        : ''}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {row.location_path?.trim() ? row.location_path : 'Место не назначено'}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Последняя {formatDate(row.last_verification_date)} · следующая{' '}
                      {formatDate(row.next_verification_date)}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
