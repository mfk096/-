import type { EquipmentStatus } from '@/types/database'

export const excelImportLimit = 2000
export const pathSeparator = ' → '

export type ImportKind = 'nomenclature' | 'locations' | 'employees' | 'equipment'

export type ColumnDef = {
  key: string
  header: string
  required: boolean
  aliases?: string[]
}

export const importKinds: { value: ImportKind; label: string; sheet: string }[] = [
  { value: 'nomenclature', label: 'Номенклатура', sheet: 'Номенклатура' },
  { value: 'locations', label: 'Места', sheet: 'Места' },
  { value: 'employees', label: 'Сотрудники', sheet: 'Сотрудники' },
  { value: 'equipment', label: 'Единицы', sheet: 'Единицы' },
]

export const nomenclatureColumns: ColumnDef[] = [
  { key: 'code_prefix', header: 'Префикс', required: true, aliases: ['Префикс кода'] },
  { key: 'name', header: 'Название', required: true },
  { key: 'manufacturer', header: 'Производитель', required: false },
  { key: 'model', header: 'Модель', required: false },
  { key: 'category', header: 'Категория', required: false },
  { key: 'requires_verification', header: 'Требует поверки', required: true },
  {
    key: 'verification_interval_months',
    header: 'Интервал, мес.',
    required: false,
    aliases: ['Интервал поверки, мес.'],
  },
  { key: 'notes', header: 'Примечание', required: false },
]

export const locationColumns: ColumnDef[] = [
  { key: 'name', header: 'Название', required: true },
  { key: 'kind', header: 'Вид', required: false },
  { key: 'parent_path', header: 'Родитель', required: false, aliases: ['Родительский путь'] },
  { key: 'responsible_name', header: 'Ответственный', required: false },
  { key: 'full_path', header: 'Полный путь', required: false },
  { key: 'archived', header: 'В архиве', required: false },
]

export const employeeColumns: ColumnDef[] = [
  { key: 'full_name', header: 'ФИО', required: true, aliases: ['Сотрудник'] },
  { key: 'position', header: 'Должность', required: false },
  { key: 'phone', header: 'Телефон', required: false },
  { key: 'archived', header: 'В архиве', required: false },
]

export const equipmentColumns: ColumnDef[] = [
  { key: 'code', header: 'Код', required: false, aliases: ['Код единицы'] },
  { key: 'code_prefix', header: 'Префикс', required: true, aliases: ['Префикс номенклатуры'] },
  { key: 'nomenclature_name', header: 'Номенклатура', required: false },
  { key: 'serial_number', header: 'Серийный номер', required: false, aliases: ['Серийник'] },
  {
    key: 'inventory_number',
    header: 'Инвентарный номер',
    required: false,
    aliases: ['Инв. номер'],
  },
  { key: 'status', header: 'Статус', required: true },
  {
    key: 'location_path',
    header: 'Место',
    required: false,
    aliases: ['Полный путь места', 'Место установки'],
  },
  {
    key: 'last_verification_date',
    header: 'Последняя поверка',
    required: false,
    aliases: ['Дата последней поверки'],
  },
  {
    key: 'next_verification_date',
    header: 'Следующая поверка',
    required: false,
    aliases: ['Дата следующей поверки'],
  },
  { key: 'notes', header: 'Примечание', required: false },
]

export const journalColumns = [
  'Дата',
  'Тип',
  'Код',
  'Номенклатура',
  'Откуда',
  'Куда',
  'Статус был',
  'Статус стал',
  'Автор',
  'Комментарий',
] as const

export const verificationJournalColumns = [
  'Дата',
  'Код',
  'Номенклатура',
  'Результат',
  'Номер свидетельства',
  'Следующая дата',
  'Комментарий',
  'Место',
] as const

export const verificationQueueColumns = [
  'Код',
  'Номенклатура',
  'Префикс',
  'Место',
  'Статус',
  'Последняя поверка',
  'Следующая поверка',
  'Группа',
] as const

const dateKeys = new Set([
  'last_verification_date',
  'next_verification_date',
  'verified_at',
  'next_due_at',
])

export function columnsFor(kind: ImportKind): ColumnDef[] {
  if (kind === 'nomenclature') return nomenclatureColumns
  if (kind === 'locations') return locationColumns
  if (kind === 'employees') return employeeColumns
  return equipmentColumns
}

export function sheetNameFor(kind: ImportKind): string {
  return importKinds.find((item) => item.value === kind)?.sheet ?? 'Лист'
}

export function isDateColumn(key: string): boolean {
  return dateKeys.has(key)
}

export function headerKey(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function columnByHeader(columns: ColumnDef[], header: string): ColumnDef | undefined {
  const key = headerKey(header)
  return columns.find(
    (column) =>
      headerKey(column.header) === key || column.aliases?.some((alias) => headerKey(alias) === key),
  )
}

const statusLabels: Record<EquipmentStatus, string> = {
  in_work: 'В работе',
  on_verification: 'На поверке',
  in_repair: 'В ремонте',
  written_off: 'Списано',
  reserve: 'Резерв',
}

const statusByLabel = new Map<string, EquipmentStatus>(
  (Object.entries(statusLabels) as [EquipmentStatus, string][]).flatMap(([code, label]) => [
    [code, code],
    [label.toLowerCase(), code],
  ]),
)

export function statusText(status: EquipmentStatus | null | undefined): string {
  if (!status) return ''
  return statusLabels[status]
}

export function parseStatus(value: unknown): EquipmentStatus | null {
  const text = cellText(value).toLowerCase()
  if (!text) return null
  return statusByLabel.get(text) ?? null
}

export function parseYesNo(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (value === 1) return true
    if (value === 0) return false
    return null
  }
  const text = cellText(value).toLowerCase()
  if (!text) return null
  if (['да', 'yes', 'true', 'истина', '1'].includes(text)) return true
  if (['нет', 'no', 'false', 'ложь', '0'].includes(text)) return false
  return null
}

export function yesNoText(value: boolean): string {
  return value ? 'да' : 'нет'
}

export function cellText(value: unknown): string {
  if (value == null) return ''
  if (value instanceof Date) return ''
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return ''
    if (Number.isInteger(value)) return String(value)
    return String(value)
  }
  if (typeof value === 'boolean') return value ? 'да' : 'нет'
  return String(value).trim()
}

export function emptyToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export function normalizePath(value: string): string {
  const unified = value
    .trim()
    .replace(/\s*->\s*/g, pathSeparator)
    .replace(/\s*→\s*/g, pathSeparator)
  if (!unified) return ''
  return unified
    .split('→')
    .map((part) => part.trim().replace(/\s+/g, ' '))
    .filter((part) => part.length > 0)
    .join(pathSeparator)
}

export function parentPathFromFull(fullPath: string | null | undefined, name: string): string {
  if (!fullPath?.trim()) return ''
  if (fullPath === name) return ''
  const suffix = `${pathSeparator}${name}`
  if (fullPath.endsWith(suffix)) return fullPath.slice(0, -suffix.length)
  return ''
}

export function resultText(result: 'passed' | 'failed' | null | undefined): string {
  if (result === 'passed') return 'Годен'
  if (result === 'failed') return 'Не годен'
  return ''
}
