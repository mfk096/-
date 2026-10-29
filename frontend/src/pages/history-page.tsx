import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { HistoryTimeline } from '@/components/history-timeline'
import { Field } from '@/components/field'
import { SupabaseConfigNotice } from '@/components/supabase-config-notice'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { useLocations } from '@/hooks/use-catalogs'
import { useDebounced } from '@/hooks/use-debounced'
import { errorText } from '@/lib/errors'
import {
  isIsoDate,
  isJournalEventKind,
  journalEventKinds,
  journalPageSize,
  localDayStartIso,
  localNextDayIso,
  pageNumber,
} from '@/lib/journal'
import { equipmentStatuses, isEquipmentStatus } from '@/lib/labels'
import { supabase, supabaseConfigMessage } from '@/lib/supabase'

export function HistoryPage() {
  const [params, setParams] = useSearchParams()
  const codeParam = params.get('code') ?? ''
  const [codeInput, setCodeInput] = useState(codeParam)
  const debouncedCode = useDebounced(codeInput)
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const eventType = params.get('type') ?? ''
  const nomenclatureId = params.get('nomenclature') ?? ''
  const locationId = params.get('location') ?? ''
  const authorId = params.get('author') ?? ''
  const status = params.get('status') ?? ''
  const page = pageNumber(params.get('page'))
  const rangeError = isIsoDate(from) && isIsoDate(to) && from > to

  useEffect(() => {
    setCodeInput(codeParam)
  }, [codeParam])

  useEffect(() => {
    setParams(
      (current) => {
        const existing = current.get('code') ?? ''
        if (existing === debouncedCode) return current
        const next = new URLSearchParams(current)
        if (debouncedCode) next.set('code', debouncedCode)
        else next.delete('code')
        next.delete('page')
        return next
      },
      { replace: true },
    )
  }, [debouncedCode, setParams])

  function setFilter(key: string, value: string) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (value) next.set(key, value)
        else next.delete(key)
        if (key !== 'page') next.delete('page')
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
        .select('id, code_prefix, name')
        .order('name')
      if (error) throw error
      return data ?? []
    },
  })

  const profiles = useQuery({
    queryKey: ['profiles', 'authors'],
    enabled: Boolean(supabase),
    queryFn: async () => {
      const client = supabase
      if (!client) throw new Error('Supabase не настроен.')
      const { data, error } = await client
        .from('profiles')
        .select('id, full_name, is_active')
        .order('full_name')
      if (error) throw error
      return data ?? []
    },
  })

  const locations = useLocations()

  const journal = useQuery({
    queryKey: [
      'journal',
      'feed',
      codeParam,
      from,
      to,
      eventType,
      nomenclatureId,
      locationId,
      authorId,
      status,
      page,
    ],
    enabled: Boolean(supabase) && !rangeError,
    queryFn: async () => {
      const client = supabase
      if (!client) throw new Error('Supabase не настроен.')
      let query = client
        .from('journal_events')
        .select('*', { count: 'exact' })
        .order('occurred_at', { ascending: false })
        .order('id', { ascending: false })

      const needle = codeParam.trim().replace(/[%_,]/g, '')
      if (needle) query = query.ilike('equipment_code', `%${needle}%`)
      if (isIsoDate(from)) query = query.gte('occurred_at', localDayStartIso(from))
      if (isIsoDate(to)) query = query.lt('occurred_at', localNextDayIso(to))
      if (isJournalEventKind(eventType)) query = query.eq('event_kind', eventType)
      if (nomenclatureId) query = query.eq('nomenclature_id', nomenclatureId)
      if (locationId) query = query.contains('location_scope', [locationId])
      if (authorId) query = query.eq('actor_id', authorId)
      if (isEquipmentStatus(status)) query = query.contains('status_scope', [status])

      const fromRow = (page - 1) * journalPageSize
      const { data, error, count } = await query.range(fromRow, fromRow + journalPageSize - 1)
      if (error) throw error
      return { rows: data ?? [], total: count ?? 0 }
    },
  })

  const rows = journal.data?.rows ?? []
  const total = journal.data?.total ?? 0
  const fromRow = total === 0 ? 0 : (page - 1) * journalPageSize + 1
  const toRow = Math.min(page * journalPageSize, total)
  const locationOptions = [...(locations.data ?? [])].sort((left, right) =>
    (left.full_path ?? left.name).localeCompare(right.full_path ?? right.name, 'ru'),
  )
  const filtersActive = Boolean(
    codeParam || from || to || eventType || nomenclatureId || locationId || authorId || status,
  )

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Журнал</h1>
        <p className="mt-2 text-muted-foreground">
          Перемещения и смены статуса в одной ленте. Фильтры остаются в адресе страницы.
        </p>
      </header>

      {!supabase && supabaseConfigMessage ? (
        <SupabaseConfigNotice message={supabaseConfigMessage} />
      ) : null}

      {supabase ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="С даты" htmlFor="history-from">
            <Input
              id="history-from"
              type="date"
              value={from}
              className="h-11"
              onChange={(event) => setFilter('from', event.target.value)}
            />
          </Field>
          <Field label="По дату" htmlFor="history-to">
            <Input
              id="history-to"
              type="date"
              value={to}
              className="h-11"
              onChange={(event) => setFilter('to', event.target.value)}
            />
          </Field>
          <Field label="Тип события" htmlFor="history-type">
            <NativeSelect
              id="history-type"
              value={eventType}
              onChange={(event) => setFilter('type', event.target.value)}
            >
              <option value="">Все события</option>
              {journalEventKinds.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field
            label="Статус в событии"
            htmlFor="history-status"
            hint="Откуда или куда в смене статуса. Перемещения при этом фильтре не показываются."
          >
            <NativeSelect
              id="history-status"
              value={status}
              onChange={(event) => setFilter('status', event.target.value)}
            >
              <option value="">Любой статус</option>
              {equipmentStatuses.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Код единицы" htmlFor="history-code">
            <Input
              id="history-code"
              value={codeInput}
              className="h-11 font-mono"
              placeholder="KYOC-001"
              autoComplete="off"
              onChange={(event) => setCodeInput(event.target.value)}
            />
          </Field>
          <Field label="Номенклатура" htmlFor="history-nomenclature">
            <NativeSelect
              id="history-nomenclature"
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
          </Field>
          <Field
            label="Место"
            htmlFor="history-location"
            hint="Это место и всё вложенное, если оно стоит в «откуда» или в «куда»."
          >
            <NativeSelect
              id="history-location"
              value={locationId}
              onChange={(event) => setFilter('location', event.target.value)}
            >
              <option value="">Все места</option>
              {locationOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.full_path || item.name}
                  {item.is_archived ? ' · архив' : ''}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Автор" htmlFor="history-author">
            <NativeSelect
              id="history-author"
              value={authorId}
              onChange={(event) => setFilter('author', event.target.value)}
            >
              <option value="">Все авторы</option>
              {(profiles.data ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.full_name}
                  {item.is_active ? '' : ' · отключён'}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {filtersActive ? (
            <div className="sm:col-span-2">
              <Button
                type="button"
                variant="outline"
                className="h-11 w-full sm:w-auto"
                onClick={() => {
                  setCodeInput('')
                  setParams({}, { replace: true })
                }}
              >
                Сбросить фильтры
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {rangeError ? (
        <p className="text-sm text-destructive" role="alert">
          Дата начала позже даты окончания.
        </p>
      ) : null}

      {journal.isLoading ? <p className="text-sm text-muted-foreground">Загрузка…</p> : null}
      {journal.error ? (
        <p className="text-sm text-destructive" role="alert">
          {errorText(journal.error, 'Не удалось загрузить журнал')}
        </p>
      ) : null}
      {nomenclature.error || profiles.error || locations.error ? (
        <p className="text-sm text-destructive" role="alert">
          {errorText(
            nomenclature.error ?? profiles.error ?? locations.error,
            'Не удалось загрузить фильтры',
          )}
        </p>
      ) : null}

      {journal.data && rows.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Событий нет</CardTitle>
            <CardDescription>
              {page > 1
                ? 'На этой странице записей нет.'
                : 'Измените фильтры или дождитесь перемещений и смен статуса.'}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {rows.length > 0 ? <HistoryTimeline events={rows} showUnit /> : null}

      {total > journalPageSize ? (
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={page <= 1}
            onClick={() => setFilter('page', page <= 2 ? '' : String(page - 1))}
          >
            Назад
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            {fromRow}–{toRow} из {total}
          </p>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={page * journalPageSize >= total}
            onClick={() => setFilter('page', String(page + 1))}
          >
            Дальше
          </Button>
        </div>
      ) : null}
    </div>
  )
}
