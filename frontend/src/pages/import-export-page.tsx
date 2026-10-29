import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Field } from '@/components/field'
import { SupabaseConfigNotice } from '@/components/supabase-config-notice'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { useLocations } from '@/hooks/use-catalogs'
import { useAccess } from '@/hooks/use-profile'
import {
  employeesWorkbook,
  journalWorkbook,
  locationsWorkbook,
  nomenclatureWorkbook,
  templateWorkbook,
  verificationJournalWorkbook,
} from '@/lib/excel/build'
import { downloadWorkbook } from '@/lib/excel/download'
import { fetchAll } from '@/lib/excel/fetch-all'
import { cellText, importKinds, parentPathFromFull, type ImportKind } from '@/lib/excel/model'
import { readWorkbook } from '@/lib/excel/parse'
import {
  emptyCatalog,
  importSelection,
  readImportReport,
  validateImport,
  type ImportReport,
} from '@/lib/excel/validate'
import { errorText } from '@/lib/errors'
import { labelPrintLimit } from '@/lib/label-templates'
import { stashLabelCodes } from '@/lib/label-settings'
import { loadFilteredJournal } from '@/lib/journal-load'
import { supabase, supabaseConfigMessage } from '@/lib/supabase'
import type { Json } from '@/types/database'

type Payload = { row: number }
type PreviewRow = {
  row: number
  title: string
  errors: string[]
  warnings: string[]
  value: Payload | null
}
type Preview = {
  kind: ImportKind
  fileErrors: string[]
  rows: PreviewRow[]
}

function rowTitle(kind: ImportKind, cells: Record<string, unknown>): string {
  if (kind === 'nomenclature') {
    return `${cellText(cells.code_prefix)} ${cellText(cells.name)}`.trim() || 'Номенклатура'
  }
  if (kind === 'locations') {
    const parent = cellText(cells.parent_path)
    const name = cellText(cells.name)
    return parent ? `${parent} → ${name}` : name || 'Место'
  }
  if (kind === 'employees') return cellText(cells.full_name) || 'Сотрудник'
  return `${cellText(cells.code_prefix)} ${cellText(cells.serial_number)} ${cellText(cells.status)}`.trim()
}

export function ImportExportPage() {
  const access = useAccess()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [kind, setKind] = useState<ImportKind>('nomenclature')
  const [onlyValid, setOnlyValid] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [busyExport, setBusyExport] = useState<string | null>(null)

  const nomenclature = useQuery({
    queryKey: ['nomenclature', 'import-catalog'],
    enabled: Boolean(supabase),
    queryFn: async () => {
      const client = supabase
      if (!client) throw new Error('Supabase не настроен.')
      return fetchAll((from, to) =>
        client
          .from('nomenclature')
          .select('code_prefix, requires_verification')
          .order('code_prefix')
          .range(from, to),
      )
    },
  })
  const employees = useQuery({
    queryKey: ['employees', 'import-catalog'],
    enabled: Boolean(supabase),
    queryFn: async () => {
      const client = supabase
      if (!client) throw new Error('Supabase не настроен.')
      return fetchAll((from, to) =>
        client
          .from('employees')
          .select('id, full_name, is_archived')
          .order('full_name')
          .range(from, to),
      )
    },
  })
  const serials = useQuery({
    queryKey: ['equipment', 'serials'],
    enabled: Boolean(supabase),
    queryFn: async () => {
      const client = supabase
      if (!client) throw new Error('Supabase не настроен.')
      return fetchAll((from, to) =>
        client
          .from('equipment_list')
          .select('code_prefix, serial_number')
          .order('code')
          .range(from, to),
      )
    },
  })
  const locations = useLocations()

  const catalog = useMemo(() => {
    const next = emptyCatalog()
    for (const row of nomenclature.data ?? []) {
      next.prefixes.add(row.code_prefix)
      next.prefixRequiresVerification.set(row.code_prefix, row.requires_verification)
    }
    for (const row of locations.data ?? []) {
      const path = row.full_path?.trim()
      if (!path) continue
      if (row.is_archived) next.archivedLocationPaths.add(path)
      else next.locationPaths.add(path)
    }
    for (const row of employees.data ?? []) {
      if (row.is_archived) continue
      const key = row.full_name.trim().toLowerCase()
      next.activeEmployees.set(key, (next.activeEmployees.get(key) ?? 0) + 1)
    }
    for (const row of serials.data ?? []) {
      if (!row.serial_number) continue
      const set = new Set(next.serialsByPrefix.get(row.code_prefix) ?? [])
      set.add(row.serial_number.trim().toLowerCase())
      next.serialsByPrefix.set(row.code_prefix, set)
    }
    return next
  }, [nomenclature.data, locations.data, employees.data, serials.data])

  const selection = preview
    ? importSelection({ fileErrors: preview.fileErrors, rows: preview.rows }, onlyValid)
    : null
  const errorCount = preview?.rows.filter((row) => row.errors.length > 0).length ?? 0
  const warningCount = preview?.rows.filter((row) => row.warnings.length > 0).length ?? 0
  const shownRows = useMemo(() => {
    if (!preview) return []
    const problems = preview.rows.filter((row) => row.errors.length > 0 || row.warnings.length > 0)
    const clean = preview.rows.filter((row) => row.errors.length === 0 && row.warnings.length === 0)
    return [...problems, ...clean.slice(0, 40)]
  }, [preview])

  async function exportFile(name: string, task: () => Promise<void>) {
    setBusyExport(name)
    try {
      await task()
    } catch (error) {
      toast.error(errorText(error, 'Не удалось выгрузить файл'))
    } finally {
      setBusyExport(null)
    }
  }

  async function readFile(file: File) {
    if (nomenclature.isLoading || locations.isLoading || employees.isLoading || serials.isLoading) {
      throw new Error('Справочники ещё загружаются. Выберите файл ещё раз.')
    }
    setReport(null)
    setImportError(null)
    const sheet = readWorkbook(await file.arrayBuffer(), kind)
    const validated = validateImport(kind, sheet, catalog)
    const rows = validated.rows.map((row) => ({
      row: row.row,
      title: rowTitle(kind, sheet.records.find((item) => item.row === row.row)?.cells ?? {}),
      errors: row.errors,
      warnings: row.warnings,
      value: row.value,
    }))
    setPreview({ kind, fileErrors: validated.fileErrors, rows })
  }

  const runImport = useMutation({
    mutationFn: async () => {
      const client = supabase
      if (!client || !preview || !selection || selection.blockedReason) {
        throw new Error(selection?.blockedReason ?? 'Нет строк для импорта.')
      }
      const payload = selection.rows as unknown as Json
      const args = { p_rows: payload }
      const response =
        preview.kind === 'nomenclature'
          ? await client.rpc('import_nomenclature', args)
          : preview.kind === 'locations'
            ? await client.rpc('import_locations', args)
            : preview.kind === 'employees'
              ? await client.rpc('import_employees', args)
              : await client.rpc('import_equipment', args)
      if (response.error) throw response.error
      return readImportReport(response.data)
    },
    onSuccess: async (next) => {
      setReport(next)
      setPreview(null)
      setImportError(null)
      await queryClient.invalidateQueries()
      toast.success(`Создано: ${next.created}`)
    },
    onError: (error) => {
      const message = errorText(error, 'Импорт не выполнен, файл не записан')
      setImportError(message)
      toast.error(message)
    },
  })

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Импорт и экспорт</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Выгрузка доступна всем ролям. Импорт — только администратору: сначала предпросмотр, в базу
          файл попадает целиком или не попадает совсем.
        </p>
      </header>

      {!supabase && supabaseConfigMessage ? (
        <SupabaseConfigNotice message={supabaseConfigMessage} />
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Экспорт</h2>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={busyExport !== null}
            onClick={() =>
              exportFile('nomenclature', async () => {
                const client = supabase
                if (!client) throw new Error('Supabase не настроен.')
                const rows = await fetchAll((from, to) =>
                  client.from('nomenclature').select('*').order('code_prefix').range(from, to),
                )
                downloadWorkbook(nomenclatureWorkbook(rows), 'номенклатура.xlsx')
              })
            }
          >
            Номенклатура
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={busyExport !== null}
            onClick={() =>
              exportFile('locations', async () => {
                const client = supabase
                if (!client) throw new Error('Supabase не настроен.')
                const [places, people] = await Promise.all([
                  fetchAll((from, to) =>
                    client
                      .from('locations_with_path')
                      .select('*')
                      .order('full_path')
                      .range(from, to),
                  ),
                  fetchAll((from, to) =>
                    client
                      .from('employees')
                      .select('id, full_name')
                      .order('full_name')
                      .range(from, to),
                  ),
                ])
                const names = new Map(people.map((person) => [person.id, person.full_name]))
                downloadWorkbook(
                  locationsWorkbook(
                    places.map((place) => ({
                      name: place.name,
                      kind: place.kind,
                      parent_path: parentPathFromFull(place.full_path, place.name),
                      full_path: place.full_path ?? place.name,
                      responsible_name: place.responsible_employee_id
                        ? (names.get(place.responsible_employee_id) ?? '')
                        : '',
                      archived: place.is_archived,
                    })),
                  ),
                  'места.xlsx',
                )
              })
            }
          >
            Места
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={busyExport !== null}
            onClick={() =>
              exportFile('employees', async () => {
                const client = supabase
                if (!client) throw new Error('Supabase не настроен.')
                const rows = await fetchAll((from, to) =>
                  client.from('employees').select('*').order('full_name').range(from, to),
                )
                downloadWorkbook(
                  employeesWorkbook(
                    rows.map((row) => ({
                      full_name: row.full_name,
                      position: row.position,
                      phone: row.phone,
                      archived: row.is_archived,
                    })),
                  ),
                  'сотрудники.xlsx',
                )
              })
            }
          >
            Сотрудники
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={busyExport !== null}
            onClick={() =>
              exportFile('verifications', async () => {
                const client = supabase
                if (!client) throw new Error('Supabase не настроен.')
                const rows = await fetchAll((from, to) =>
                  client
                    .from('verification_journal')
                    .select('*')
                    .order('verified_at', { ascending: false })
                    .range(from, to),
                )
                downloadWorkbook(verificationJournalWorkbook(rows), 'поверки.xlsx')
              })
            }
          >
            Поверки
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={busyExport !== null}
            onClick={() =>
              exportFile('journal', async () => {
                const rows = await loadFilteredJournal({
                  code: '',
                  from: '',
                  to: '',
                  eventType: '',
                  nomenclatureId: '',
                  locationId: '',
                  authorId: '',
                  status: '',
                })
                downloadWorkbook(
                  journalWorkbook(
                    rows.map((row) => ({
                      occurred_at: row.occurred_at,
                      event_kind: row.event_kind,
                      equipment_code: row.equipment_code,
                      nomenclature_name: row.nomenclature_name,
                      from_path: row.from_path,
                      to_path: row.to_path,
                      from_status: row.from_status,
                      to_status: row.to_status,
                      actor_name: row.actor_name,
                      comment: row.comment,
                    })),
                  ),
                  'журнал.xlsx',
                )
              })
            }
          >
            Весь журнал
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Единицы с текущими фильтрами — кнопка в{' '}
          <Link to="/units" className="text-primary">
            списке единиц
          </Link>
          . Журнал с фильтрами — на{' '}
          <Link to="/history" className="text-primary">
            странице журнала
          </Link>
          . График поверок — на{' '}
          <Link to="/verifications" className="text-primary">
            странице поверок
          </Link>
          .
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Импорт</h2>
        {access.isSuccess && access.role !== 'admin' ? (
          <p className="text-sm text-muted-foreground">
            Импорт доступен администратору. Экспорт можно скачать выше.
          </p>
        ) : null}
        {access.role === 'admin' ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Что загружаем" htmlFor="import-kind">
                <NativeSelect
                  id="import-kind"
                  value={kind}
                  onChange={(event) => {
                    const value = event.target.value
                    if (importKinds.some((item) => item.value === value)) {
                      setKind(value as ImportKind)
                      setPreview(null)
                      setOnlyValid(false)
                      setImportError(null)
                    }
                  }}
                >
                  {importKinds.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-full sm:w-auto"
                  onClick={() => downloadWorkbook(templateWorkbook(kind), `шаблон-${kind}.xlsx`)}
                >
                  Скачать шаблон
                </Button>
              </div>
              <div className="sm:col-span-2">
                <Field label="Файл .xlsx" htmlFor="import-file">
                  <Input
                    id="import-file"
                    type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    className="h-11"
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      if (file)
                        void readFile(file).catch((error) =>
                          toast.error(errorText(error, 'Файл не прочитан')),
                        )
                    }}
                  />
                </Field>
              </div>
            </div>

            {preview?.fileErrors.map((message) => (
              <p key={message} className="text-sm text-destructive" role="alert">
                {message}
              </p>
            ))}

            {preview && preview.rows.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>Предпросмотр</CardTitle>
                  <CardDescription>
                    Строк: {preview.rows.length}. С ошибками: {errorCount}. С предупреждениями:{' '}
                    {warningCount}. Ошибка в базе откатывает весь этот файл.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <ul className="flex flex-col gap-2">
                    {shownRows.map((row) => (
                      <li
                        key={row.row}
                        className={
                          row.errors.length > 0
                            ? 'rounded-lg bg-destructive/10 px-3 py-2 text-sm'
                            : row.warnings.length > 0
                              ? 'rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950'
                              : 'rounded-lg bg-muted/60 px-3 py-2 text-sm'
                        }
                      >
                        <p className="font-medium">
                          Строка {row.row}
                          {row.title ? ` · ${row.title}` : ''}
                        </p>
                        {row.errors.map((message) => (
                          <p key={message} className="text-destructive">
                            {message}
                          </p>
                        ))}
                        {row.warnings.map((message) => (
                          <p key={message}>{message}</p>
                        ))}
                      </li>
                    ))}
                  </ul>
                  {preview.rows.length > shownRows.length ? (
                    <p className="text-sm text-muted-foreground">
                      На экране не все корректные строки. Импорт возьмёт каждую строку без ошибок.
                    </p>
                  ) : null}
                  {errorCount > 0 && (selection?.rows.length ?? 0) > 0 ? (
                    <label className="flex items-start gap-3 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-5"
                        checked={onlyValid}
                        onChange={(event) => setOnlyValid(event.target.checked)}
                      />
                      Импортировать только корректные ({selection?.rows.length ?? 0})
                    </label>
                  ) : null}
                  {selection?.blockedReason ? (
                    <p className="text-sm text-destructive">{selection.blockedReason}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      К импорту: {selection?.rows.length ?? 0}.
                    </p>
                  )}
                  <Button
                    type="button"
                    className="h-11 w-full sm:w-auto"
                    disabled={!selection || Boolean(selection.blockedReason) || runImport.isPending}
                    onClick={() => runImport.mutate()}
                  >
                    {runImport.isPending ? 'Импорт…' : 'Импортировать'}
                  </Button>
                </CardContent>
              </Card>
            ) : null}

            {importError ? (
              <p className="whitespace-pre-wrap text-sm text-destructive" role="alert">
                {importError}
              </p>
            ) : null}

            {report ? (
              <Card>
                <CardHeader>
                  <CardTitle>Файл записан</CardTitle>
                  <CardDescription>Создано: {report.created}.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {report.codes.length > 0 ? (
                    <>
                      <p className="text-sm">База выдала коды:</p>
                      <p className="font-mono text-sm">{report.codes.join(', ')}</p>
                      <Button
                        type="button"
                        className="h-11 w-full sm:w-auto"
                        onClick={() => {
                          stashLabelCodes(report.codes)
                          navigate('/labels?from=selection')
                        }}
                      >
                        Печать этикеток
                      </Button>
                      {report.codes.length > labelPrintLimit ? (
                        <p className="text-sm text-muted-foreground">
                          За один раз печатается не больше {labelPrintLimit} этикеток. На экране
                          этикеток лишние нужно убрать или печатать частями.
                        </p>
                      ) : null}
                    </>
                  ) : null}
                  {report.warnings.map((warning) => (
                    <p key={`${warning.row}-${warning.message}`} className="text-sm">
                      Строка {warning.row}: {warning.message}
                    </p>
                  ))}
                </CardContent>
              </Card>
            ) : null}
          </>
        ) : null}
      </section>
    </div>
  )
}
