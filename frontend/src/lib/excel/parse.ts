import * as XLSX from 'xlsx'
import {
  cellText,
  columnByHeader,
  columnsFor,
  type ColumnDef,
  type ImportKind,
} from '@/lib/excel/model'

export type ParsedCell = {
  key: string
  value: unknown
}

export type ParsedRecord = {
  row: number
  cells: Record<string, unknown>
}

export type ParsedSheet = {
  sheetName: string
  records: ParsedRecord[]
  fileErrors: string[]
}

function isEmptyRow(row: unknown[]): boolean {
  return row.every((cell) => cell == null || cellText(cell) === '')
}

export function parseExcelDate(value: unknown): { iso: string | null; error: string | null } {
  if (value == null || value === '') return { iso: null, error: null }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return { iso: null, error: 'дата не разбирается' }
    const iso = dateParts(value.getFullYear(), value.getMonth() + 1, value.getDate())
    return iso ? { iso, error: null } : { iso: null, error: 'такой даты нет' }
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value) as { y?: number; m?: number; d?: number } | null
    if (!parsed?.y || !parsed.m || !parsed.d) return { iso: null, error: 'дата не разбирается' }
    const iso = dateParts(parsed.y, parsed.m, parsed.d)
    return iso ? { iso, error: null } : { iso: null, error: 'такой даты нет' }
  }
  if (typeof value === 'string') {
    const text = value.trim()
    const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
    if (isoMatch) {
      const iso = dateParts(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]))
      return iso ? { iso, error: null } : { iso: null, error: 'такой даты нет' }
    }
    const ruMatch = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(text)
    if (ruMatch) {
      const iso = dateParts(Number(ruMatch[3]), Number(ruMatch[2]), Number(ruMatch[1]))
      return iso ? { iso, error: null } : { iso: null, error: 'такой даты нет' }
    }
  }
  return { iso: null, error: 'дата не разбирается' }
}

function dateParts(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null
  if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null
  const probe = new Date(year, month - 1, day)
  if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) {
    return null
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function readWorkbook(data: ArrayBuffer | Uint8Array, kind: ImportKind): ParsedSheet {
  const book = XLSX.read(data, { type: 'array', cellDates: true })
  const preferred = columnsFor(kind).length ? sheetName(kind) : ''
  const sheetNameFound =
    book.SheetNames.find((name) => name.trim().toLowerCase() === preferred.toLowerCase()) ??
    book.SheetNames.find((name) => name.trim().toLowerCase() !== 'пояснение')
  if (!sheetNameFound) {
    return { sheetName: '', records: [], fileErrors: ['В файле нет листа с данными.'] }
  }
  const sheet = book.Sheets[sheetNameFound]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
  })
  return parseRows(rows, columnsFor(kind), sheetNameFound)
}

function sheetName(kind: ImportKind): string {
  if (kind === 'nomenclature') return 'Номенклатура'
  if (kind === 'locations') return 'Места'
  if (kind === 'employees') return 'Сотрудники'
  return 'Единицы'
}

export function parseRows(rows: unknown[][], columns: ColumnDef[], sheetName: string): ParsedSheet {
  const headerIndex = rows.findIndex((row) => Array.isArray(row) && !isEmptyRow(row))
  if (headerIndex < 0) {
    return { sheetName, records: [], fileErrors: ['В файле нет заголовков.'] }
  }
  const headerRow = rows[headerIndex] ?? []
  const mapped: { index: number; column: ColumnDef }[] = []
  const seen = new Set<string>()
  headerRow.forEach((cell, index) => {
    const column = columnByHeader(columns, cellText(cell))
    if (!column || seen.has(column.key)) return
    seen.add(column.key)
    mapped.push({ index, column })
  })
  const missing = columns.filter((column) => column.required && !seen.has(column.key))
  if (missing.length > 0) {
    return {
      sheetName,
      records: [],
      fileErrors: [`Не найдены колонки: ${missing.map((column) => column.header).join(', ')}.`],
    }
  }

  const records: ParsedRecord[] = []
  rows.slice(headerIndex + 1).forEach((row, offset) => {
    if (!Array.isArray(row) || isEmptyRow(row)) return
    const cells: Record<string, unknown> = {}
    for (const item of mapped) cells[item.column.key] = row[item.index] ?? null
    records.push({ row: headerIndex + offset + 2, cells })
  })

  return { sheetName, records, fileErrors: [] }
}
