import {
  cellText,
  emptyToNull,
  excelImportLimit,
  normalizePath,
  parseStatus,
  parseYesNo,
  pathSeparator,
  type ImportKind,
} from '@/lib/excel/model'
import { parseExcelDate, type ParsedRecord, type ParsedSheet } from '@/lib/excel/parse'

export type ImportIssue = {
  row: number
  message: string
}

export type ValidatedRow<T> = {
  row: number
  value: T | null
  errors: string[]
  warnings: string[]
}

export type ValidatedImport<T> = {
  fileErrors: string[]
  rows: ValidatedRow<T>[]
}

export type ImportCatalog = {
  prefixes: Set<string>
  prefixRequiresVerification: Map<string, boolean>
  locationPaths: Set<string>
  archivedLocationPaths: Set<string>
  activeEmployees: Map<string, number>
  serialsByPrefix: Map<string, Set<string>>
}

export type NomenclatureImportRow = {
  row: number
  code_prefix: string
  name: string
  manufacturer: string | null
  model: string | null
  category: string | null
  requires_verification: boolean
  verification_interval_months: number | null
  notes: string | null
}

export type LocationImportRow = {
  row: number
  name: string
  kind: string
  parent_path: string
  responsible_name: string
}

export type EmployeeImportRow = {
  row: number
  full_name: string
  position: string | null
  phone: string | null
}

export type EquipmentImportRow = {
  row: number
  code_prefix: string
  serial_number: string | null
  inventory_number: string | null
  status: string
  location_path: string
  last_verification_date: string | null
  next_verification_date: string | null
  notes: string | null
}

export function emptyCatalog(): ImportCatalog {
  return {
    prefixes: new Set(),
    prefixRequiresVerification: new Map(),
    locationPaths: new Set(),
    archivedLocationPaths: new Set(),
    activeEmployees: new Map(),
    serialsByPrefix: new Map(),
  }
}

export function validateImport(kind: ImportKind, sheet: ParsedSheet, catalog: ImportCatalog) {
  if (kind === 'nomenclature') return validateNomenclature(sheet, catalog)
  if (kind === 'locations') return validateLocations(sheet, catalog)
  if (kind === 'employees') return validateEmployees(sheet)
  return validateEquipment(sheet, catalog)
}

function limitError(count: number): string | null {
  if (count > excelImportLimit) {
    return `В файле ${count} строк. За один раз можно импортировать не больше ${excelImportLimit}.`
  }
  return null
}

export function validateNomenclature(
  sheet: ParsedSheet,
  catalog: ImportCatalog,
): ValidatedImport<NomenclatureImportRow> {
  if (sheet.fileErrors.length > 0) return { fileErrors: sheet.fileErrors, rows: [] }
  const tooMany = limitError(sheet.records.length)
  if (tooMany) return { fileErrors: [tooMany], rows: [] }
  if (sheet.records.length === 0) {
    return { fileErrors: ['В файле нет строк для импорта.'], rows: [] }
  }

  const seen = new Map<string, number>()
  const rows = sheet.records.map((record) => {
    const errors: string[] = []
    const prefix = cellText(record.cells.code_prefix).toUpperCase()
    const name = cellText(record.cells.name)
    if (!/^[A-Z0-9]{2,8}$/.test(prefix)) {
      errors.push('Префикс — от 2 до 8 символов, только A–Z и цифры.')
    } else if (catalog.prefixes.has(prefix)) {
      errors.push(`Префикс «${prefix}» уже занят.`)
    } else if (seen.has(prefix)) {
      errors.push(`Префикс «${prefix}» повторяется в строке ${seen.get(prefix)}.`)
    } else {
      seen.set(prefix, record.row)
    }
    if (!name) errors.push('Не заполнено название.')
    const requires = parseYesNo(record.cells.requires_verification)
    if (requires == null) errors.push('В колонке «Требует поверки» напишите «да» или «нет».')
    const interval = parseInterval(record.cells.verification_interval_months, errors)
    if (
      requires === true &&
      interval == null &&
      !errors.some((item) => item.includes('Интервал'))
    ) {
      errors.push('При включённой поверке укажите интервал в месяцах.')
    }
    if (requires === false && interval != null) {
      errors.push('Интервал указывают только если поверка нужна.')
    }
    const value: NomenclatureImportRow | null =
      errors.length > 0
        ? null
        : {
            row: record.row,
            code_prefix: prefix,
            name,
            manufacturer: emptyToNull(cellText(record.cells.manufacturer)),
            model: emptyToNull(cellText(record.cells.model)),
            category: emptyToNull(cellText(record.cells.category)),
            requires_verification: requires === true,
            verification_interval_months: requires === true ? interval : null,
            notes: emptyToNull(cellText(record.cells.notes)),
          }
    return { row: record.row, value, errors, warnings: [] }
  })
  return { fileErrors: [], rows }
}

function parseInterval(value: unknown, errors: string[]): number | null {
  if (value == null || value === '') return null
  const text = cellText(value).replace(',', '.')
  if (!text) return null
  const parsed = Number(text)
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 1200) {
    errors.push('Интервал поверки — целое число месяцев больше нуля.')
    return null
  }
  return parsed
}

export function validateEmployees(sheet: ParsedSheet): ValidatedImport<EmployeeImportRow> {
  if (sheet.fileErrors.length > 0) return { fileErrors: sheet.fileErrors, rows: [] }
  const tooMany = limitError(sheet.records.length)
  if (tooMany) return { fileErrors: [tooMany], rows: [] }
  if (sheet.records.length === 0) {
    return { fileErrors: ['В файле нет строк для импорта.'], rows: [] }
  }
  const rows = sheet.records.map((record) => {
    const errors: string[] = []
    const name = cellText(record.cells.full_name)
    if (!name) errors.push('Не заполнено ФИО.')
    const value: EmployeeImportRow | null = errors.length
      ? null
      : {
          row: record.row,
          full_name: name,
          position: emptyToNull(cellText(record.cells.position)),
          phone: emptyToNull(cellText(record.cells.phone)),
        }
    return { row: record.row, value, errors, warnings: [] }
  })
  return { fileErrors: [], rows }
}

type LocationDraft = {
  record: ParsedRecord
  name: string
  kind: string
  parent: string
  fullPath: string
  responsible: string
  errors: string[]
}

export function validateLocations(
  sheet: ParsedSheet,
  catalog: ImportCatalog,
): ValidatedImport<LocationImportRow> {
  if (sheet.fileErrors.length > 0) return { fileErrors: sheet.fileErrors, rows: [] }
  const tooMany = limitError(sheet.records.length)
  if (tooMany) return { fileErrors: [tooMany], rows: [] }
  if (sheet.records.length === 0) {
    return { fileErrors: ['В файле нет строк для импорта.'], rows: [] }
  }

  const drafts: LocationDraft[] = sheet.records.map((record) => {
    const errors: string[] = []
    const name = cellText(record.cells.name)
    const kind = cellText(record.cells.kind)
    const parent = normalizePath(cellText(record.cells.parent_path))
    const responsible = cellText(record.cells.responsible_name)
    if (!name) errors.push('Не заполнено название.')
    if (name.includes('→')) errors.push('В названии нельзя использовать знак «→».')
    const fullPath = parent ? `${parent}${pathSeparator}${name}` : name
    if (responsible) {
      const count = catalog.activeEmployees.get(responsible.toLowerCase()) ?? 0
      if (count === 0) errors.push(`Сотрудник «${responsible}» не найден среди действующих.`)
      else if (count > 1) errors.push(`Несколько сотрудников с ФИО «${responsible}».`)
    }
    if (parent && catalog.archivedLocationPaths.has(parent) && !catalog.locationPaths.has(parent)) {
      errors.push(`Родитель «${parent}» в архиве.`)
    }
    return { record, name, kind, parent, fullPath, responsible, errors }
  })

  const creatable = drafts.filter((draft) => draft.errors.length === 0 && draft.name)
  const paths = new Map<string, number>()
  for (const draft of creatable) {
    const previous = paths.get(draft.fullPath)
    if (previous) {
      draft.errors.push(`Место «${draft.fullPath}» уже задано в строке ${previous}.`)
    } else if (
      catalog.locationPaths.has(draft.fullPath) ||
      catalog.archivedLocationPaths.has(draft.fullPath)
    ) {
      draft.errors.push(`Место «${draft.fullPath}» уже есть в справочнике.`)
    } else {
      paths.set(draft.fullPath, draft.record.row)
    }
  }

  const known = new Set<string>(catalog.locationPaths)
  const pending = creatable.filter((draft) => draft.errors.length === 0)
  let guard = 0
  while (pending.length > 0 && guard < excelImportLimit + 1) {
    guard += 1
    let progress = false
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const draft = pending[index]
      if (draft.parent && !known.has(draft.parent)) continue
      known.add(draft.fullPath)
      pending.splice(index, 1)
      progress = true
    }
    if (!progress) break
  }
  for (const draft of pending) {
    draft.errors.push(
      draft.parent
        ? `Родитель «${draft.parent}» не найден среди существующих мест и корректных строк файла.`
        : 'Не удалось поставить место в иерархию.',
    )
  }

  return {
    fileErrors: [],
    rows: drafts.map((draft) => ({
      row: draft.record.row,
      errors: draft.errors,
      warnings: [],
      value:
        draft.errors.length > 0
          ? null
          : {
              row: draft.record.row,
              name: draft.name,
              kind: draft.kind,
              parent_path: draft.parent,
              responsible_name: draft.responsible,
            },
    })),
  }
}

export function validateEquipment(
  sheet: ParsedSheet,
  catalog: ImportCatalog,
): ValidatedImport<EquipmentImportRow> {
  if (sheet.fileErrors.length > 0) return { fileErrors: sheet.fileErrors, rows: [] }
  const tooMany = limitError(sheet.records.length)
  if (tooMany) return { fileErrors: [tooMany], rows: [] }
  if (sheet.records.length === 0) {
    return { fileErrors: ['В файле нет строк для импорта.'], rows: [] }
  }

  const seenSerials = new Map<string, Set<string>>()
  const rows = sheet.records.map((record) => {
    const errors: string[] = []
    const warnings: string[] = []
    const prefix = cellText(record.cells.code_prefix).toUpperCase()
    const serial = emptyToNull(cellText(record.cells.serial_number))
    const status = parseStatus(record.cells.status)
    const location = normalizePath(cellText(record.cells.location_path))
    if (!prefix) errors.push('Не заполнен префикс номенклатуры.')
    else if (!catalog.prefixes.has(prefix)) {
      errors.push(`Номенклатура с префиксом «${prefix}» не найдена.`)
    }
    if (!status) {
      const raw = cellText(record.cells.status)
      errors.push(
        raw
          ? `Статус «${raw}» не распознан. Допустимо: В работе, На поверке, В ремонте, Списано, Резерв.`
          : 'Не заполнен статус.',
      )
    }
    if (!location) errors.push('Не заполнено место установки.')
    else {
      if (catalog.archivedLocationPaths.has(location) && !catalog.locationPaths.has(location)) {
        errors.push('Архивное место нельзя назначить.')
      } else if (!catalog.locationPaths.has(location)) {
        errors.push(`Место «${location}» не найдено.`)
      }
    }
    const last = readDate(record, 'last_verification_date', 'Дата последней поверки', errors)
    const next = readDate(record, 'next_verification_date', 'Дата следующей поверки', errors)
    const requires = prefix ? catalog.prefixRequiresVerification.get(prefix) : undefined
    if (requires === false && (last || next)) {
      errors.push('Даты поверки можно указать только у номенклатуры, которая требует поверки.')
    }
    if (serial && prefix && catalog.prefixes.has(prefix)) {
      const folded = serial.toLowerCase()
      const known = catalog.serialsByPrefix.get(prefix)
      const batch = seenSerials.get(prefix) ?? new Set<string>()
      if (known?.has(folded) || batch.has(folded)) {
        warnings.push(`Серийный номер «${serial}» уже есть у номенклатуры ${prefix}.`)
      }
      batch.add(folded)
      seenSerials.set(prefix, batch)
    }
    const value: EquipmentImportRow | null =
      errors.length > 0 || !status
        ? null
        : {
            row: record.row,
            code_prefix: prefix,
            serial_number: serial,
            inventory_number: emptyToNull(cellText(record.cells.inventory_number)),
            status,
            location_path: location,
            last_verification_date: last,
            next_verification_date: next,
            notes: emptyToNull(cellText(record.cells.notes)),
          }
    return { row: record.row, value, errors, warnings }
  })
  return { fileErrors: [], rows }
}

function readDate(
  record: ParsedRecord,
  key: string,
  label: string,
  errors: string[],
): string | null {
  const parsed = parseExcelDate(record.cells[key])
  if (parsed.error) errors.push(`${label}: ${parsed.error}.`)
  return parsed.iso
}

export type ImportReport = {
  created: number
  codes: string[]
  warnings: { row: number; message: string }[]
}

export function readImportReport(value: unknown): ImportReport {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const codes = Array.isArray(record.codes)
    ? record.codes.filter(
        (item): item is string => typeof item === 'string' && item.trim().length > 0,
      )
    : []
  const warnings = Array.isArray(record.warnings)
    ? record.warnings.flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const row = Number((item as { row?: unknown }).row)
        const message = (item as { message?: unknown }).message
        if (!Number.isFinite(row) || typeof message !== 'string') return []
        return [{ row, message }]
      })
    : []
  const created = Number(record.created)
  return { created: Number.isFinite(created) ? created : codes.length, codes, warnings }
}

export function importSelection<T extends { row: number }>(
  validated: ValidatedImport<T>,
  onlyValid: boolean,
): { rows: T[]; blockedReason: string | null } {
  if (validated.fileErrors.length > 0) {
    return { rows: [], blockedReason: validated.fileErrors[0] ?? 'Файл не разобран.' }
  }
  const valid = validated.rows.flatMap((row) => (row.value ? [row.value] : []))
  const errorCount = validated.rows.filter((row) => row.errors.length > 0).length
  if (errorCount > 0 && !onlyValid) {
    return {
      rows: [],
      blockedReason:
        'В файле есть ошибки. Исправьте их или включите «Импортировать только корректные».',
    }
  }
  if (valid.length === 0) {
    return { rows: [], blockedReason: 'Нет корректных строк для импорта.' }
  }
  if (valid.length > excelImportLimit) {
    return {
      rows: [],
      blockedReason: `За один раз можно импортировать не больше ${excelImportLimit} строк.`,
    }
  }
  return { rows: valid, blockedReason: null }
}
