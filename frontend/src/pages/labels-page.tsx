import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { LabelPreview } from '@/components/label-preview'
import { SupabaseConfigNotice } from '@/components/supabase-config-notice'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { useDebounced } from '@/hooks/use-debounced'
import { useLabelSettings } from '@/hooks/use-label-settings'
import { errorText } from '@/lib/errors'
import { downloadLabelsPdf } from '@/lib/label-pdf'
import { parseLabelCodes, peekLabelCodes } from '@/lib/label-settings'
import { isEquipmentStatus } from '@/lib/labels'
import {
  labelPrintLimit,
  labelSample,
  labelTemplateById,
  labelTemplates,
  type LabelContent,
} from '@/lib/label-templates'
import { publicAppUrl } from '@/lib/public-url'
import { supabase, supabaseConfigMessage } from '@/lib/supabase'

function codesFromLocation(params: URLSearchParams): string[] {
  const fromQuery = parseLabelCodes(params.get('codes'))
  const stored = params.get('from') === 'selection' ? peekLabelCodes() : []
  return [...new Set([...fromQuery, ...stored])]
}

export function LabelsPage() {
  const [params] = useSearchParams()
  const incomingKey = `${params.get('from') ?? ''}|${params.get('codes') ?? ''}`
  const { settings, update } = useLabelSettings()
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounced(search)
  const [nomenclatureId, setNomenclatureId] = useState('')
  const [status, setStatus] = useState('')
  const [selected, setSelected] = useState<Set<string>>(() => new Set(codesFromLocation(params)))
  const [pdfPending, setPdfPending] = useState(false)

  useEffect(() => {
    const separator = incomingKey.indexOf('|')
    const from = incomingKey.slice(0, separator)
    const codes = incomingKey.slice(separator + 1)
    if (!from && !codes) return
    const search = new URLSearchParams()
    if (from) search.set('from', from)
    if (codes) search.set('codes', codes)
    const next = codesFromLocation(search)
    if (next.length === 0) return
    setSelected(new Set(next))
  }, [incomingKey])

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

  const list = useQuery({
    queryKey: ['equipment', 'labels-picker', debouncedSearch, nomenclatureId, status],
    enabled: Boolean(supabase),
    queryFn: async () => {
      const client = supabase
      if (!client) throw new Error('Supabase не настроен.')
      let query = client
        .from('equipment_list')
        .select('id, code, nomenclature_name, inventory_number, serial_number, status')
        .order('code')
      if (nomenclatureId) query = query.eq('nomenclature_id', nomenclatureId)
      if (status && isEquipmentStatus(status)) query = query.eq('status', status)
      const needle = debouncedSearch.trim().replace(/[%_,]/g, '')
      if (needle) query = query.or(`code.ilike.%${needle}%,serial_number.ilike.%${needle}%`)
      const { data, error } = await query
      if (error) throw error
      return data ?? []
    },
  })

  const selectedCodes = useMemo(() => [...selected], [selected])

  const chosen = useQuery({
    queryKey: ['equipment', 'labels-selected', selectedCodes.slice().sort().join('|')],
    enabled: Boolean(supabase) && selectedCodes.length > 0,
    queryFn: async () => {
      const client = supabase
      if (!client) throw new Error('Supabase не настроен.')
      const { data, error } = await client
        .from('equipment_list')
        .select('code, nomenclature_name, inventory_number, serial_number')
        .in('code', selectedCodes)
      if (error) throw error
      const byCode = new Map((data ?? []).map((row) => [row.code, row]))
      const found: LabelContent[] = []
      const missing: string[] = []
      for (const code of selectedCodes) {
        const row = byCode.get(code)
        if (!row) {
          missing.push(code)
          continue
        }
        found.push({
          code: row.code,
          nomenclatureName: row.nomenclature_name,
          inventoryNumber: row.inventory_number,
          serialNumber: row.serial_number,
        })
      }
      return { found, missing }
    },
  })

  const template = labelTemplateById(settings.templateId)
  const printable = chosen.data?.found ?? []
  const overLimit = selectedCodes.length > labelPrintLimit
  const visibleRows = list.data ?? []
  const visibleCodes = visibleRows.map((row) => row.code)
  const selectedVisible = visibleCodes.filter((code) => selected.has(code))
  const allVisibleSelected =
    visibleCodes.length > 0 && selectedVisible.length === visibleCodes.length

  function toggle(code: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  async function savePdf() {
    if (printable.length === 0 || overLimit) return
    setPdfPending(true)
    try {
      await downloadLabelsPdf(printable, template, settings)
      toast.success('PDF сохранён')
    } catch (error) {
      toast.error(errorText(error, 'Не удалось сохранить PDF'))
    } finally {
      setPdfPending(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header className="no-print">
        <h1 className="text-2xl font-semibold tracking-tight">Этикетки</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          QR открывает карточку на {publicAppUrl()}. Код единицы напечатан рядом с QR.
        </p>
      </header>

      {!supabase && supabaseConfigMessage ? (
        <div className="no-print">
          <SupabaseConfigNotice message={supabaseConfigMessage} />
        </div>
      ) : null}

      <Card className="no-print">
        <CardHeader>
          <CardTitle>Шаблон</CardTitle>
          <CardDescription>
            QR и код печатаются всегда. Остальные поля включаются здесь и запоминаются на этом
            устройстве.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">Размер</legend>
            {labelTemplates.map((item) => (
              <label key={item.id} className="flex min-h-11 items-start gap-3 text-sm">
                <input
                  type="radio"
                  className="mt-1 size-5"
                  name="label-template"
                  checked={settings.templateId === item.id}
                  onChange={() => update({ templateId: item.id })}
                />
                <span>
                  <span className="font-medium">{item.title}</span>
                  <span className="mt-0.5 block text-muted-foreground">{item.description}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">Поля</legend>
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="size-5"
                checked={settings.showName}
                onChange={(event) => update({ showName: event.target.checked })}
              />
              Название номенклатуры
            </label>
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="size-5"
                checked={settings.showInventory}
                onChange={(event) => update({ showInventory: event.target.checked })}
              />
              Инвентарный номер
            </label>
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="size-5"
                checked={settings.showSerial}
                onChange={(event) => update({ showSerial: event.target.checked })}
              />
              Серийный номер
            </label>
          </fieldset>
        </CardContent>
      </Card>

      {supabase ? (
        <div className="no-print grid gap-3 sm:grid-cols-3">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Код или серийный номер"
            aria-label="Поиск единиц для этикеток"
            className="h-11"
          />
          <NativeSelect
            aria-label="Фильтр по номенклатуре"
            value={nomenclatureId}
            onChange={(event) => setNomenclatureId(event.target.value)}
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
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">Все статусы</option>
            <option value="in_work">В работе</option>
            <option value="on_verification">На поверке</option>
            <option value="in_repair">В ремонте</option>
            <option value="written_off">Списано</option>
            <option value="reserve">Резерв</option>
          </NativeSelect>
        </div>
      ) : null}

      {list.isLoading ? <p className="no-print text-sm text-muted-foreground">Загрузка…</p> : null}
      {list.error ? (
        <p className="no-print text-sm text-destructive" role="alert">
          {errorText(list.error, 'Не удалось загрузить единицы')}
        </p>
      ) : null}

      {visibleRows.length > 0 ? (
        <div className="no-print flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="size-5"
                checked={allVisibleSelected}
                onChange={() => {
                  setSelected((current) => {
                    const next = new Set(current)
                    if (allVisibleSelected) {
                      for (const code of visibleCodes) next.delete(code)
                    } else {
                      for (const code of visibleCodes) next.add(code)
                    }
                    return next
                  })
                }}
              />
              Выбрать показанные
            </label>
            <p className="text-sm text-muted-foreground">Выбрано: {selected.size}</p>
            {selected.size > 0 ? (
              <Button
                type="button"
                variant="ghost"
                className="h-11"
                onClick={() => setSelected(new Set())}
              >
                Снять выбор
              </Button>
            ) : null}
          </div>
          <ul className="flex flex-col gap-2">
            {visibleRows.map((row) => (
              <li key={row.id}>
                <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border bg-card px-3 py-2">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={selected.has(row.code)}
                    aria-label={`Этикетка ${row.code}`}
                    onChange={() => toggle(row.code)}
                  />
                  <span className="min-w-0">
                    <span className="block font-mono font-semibold">{row.code}</span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {row.nomenclature_name}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <section className="flex flex-col gap-3">
        <div className="no-print flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Предпросмотр</h2>
            <p className="text-sm text-muted-foreground">
              На экране размер как на бумаге. Печать идёт через диалог браузера.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              className="h-11"
              variant="outline"
              disabled={printable.length === 0 || overLimit}
              onClick={() => window.print()}
            >
              Печать
            </Button>
            <Button
              type="button"
              className="h-11"
              disabled={printable.length === 0 || overLimit || pdfPending}
              onClick={() => void savePdf()}
            >
              {pdfPending ? 'Готовим PDF…' : 'Скачать PDF'}
            </Button>
          </div>
        </div>
        {overLimit ? (
          <p className="no-print text-sm text-destructive" role="alert">
            За один раз можно напечатать не больше {labelPrintLimit} этикеток.
          </p>
        ) : null}
        {chosen.error ? (
          <p className="no-print text-sm text-destructive" role="alert">
            {errorText(chosen.error, 'Не удалось собрать этикетки')}
          </p>
        ) : null}
        {chosen.data && chosen.data.missing.length > 0 ? (
          <p className="no-print text-sm text-destructive" role="status">
            Нет в базе: {chosen.data.missing.join(', ')}
          </p>
        ) : null}
        {printable.length > 0 ? (
          <div className="overflow-x-auto rounded-xl bg-muted/60 p-4 print:overflow-visible print:bg-white print:p-0">
            <LabelPreview items={printable} template={template} settings={settings} />
          </div>
        ) : (
          <div className="no-print flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Единицы не выбраны. Ниже образец вёрстки, он не попадёт в печать.
            </p>
            <div className="overflow-x-auto rounded-xl bg-muted/60 p-4">
              <LabelPreview items={[labelSample]} template={template} settings={settings} />
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
