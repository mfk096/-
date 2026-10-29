import * as XLSX from 'xlsx'
import type { WorkBook, WorkSheet } from 'xlsx'
import {
  columnsFor,
  employeeColumns,
  equipmentColumns,
  journalColumns,
  locationColumns,
  nomenclatureColumns,
  resultText,
  sheetNameFor,
  statusText,
  verificationJournalColumns,
  verificationQueueColumns,
  yesNoText,
  type ImportKind,
} from '@/lib/excel/model'
import type { EquipmentStatus } from '@/types/database'

export type ExcelValue = string | number | Date | null

export function excelDate(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day)
}

export function excelDateTime(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

export function sheetFromRows(
  headers: readonly string[],
  rows: ExcelValue[][],
  options?: { dates?: number[]; dateTimes?: number[] },
): WorkSheet {
  const sheet = XLSX.utils.aoa_to_sheet([Array.from(headers), ...rows], { cellDates: true })
  const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1')
  const dates = new Set(options?.dates ?? [])
  const dateTimes = new Set(options?.dateTimes ?? [])
  for (let row = 1; row <= range.e.r; row += 1) {
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: column })
      const cell = sheet[address]
      if (!cell || !(cell.v instanceof Date)) continue
      cell.t = 'd'
      if (dateTimes.has(column)) cell.z = 'DD.MM.YYYY HH:MM'
      else if (dates.has(column)) cell.z = 'DD.MM.YYYY'
    }
  }
  const widths: XLSX.ColInfo[] = []
  for (let column = range.s.c; column <= range.e.c; column += 1) {
    let width = 12
    for (let row = range.s.r; row <= range.e.r; row += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })]
      const text = cell?.v instanceof Date ? '00.00.0000 00:00' : String(cell?.v ?? '')
      width = Math.max(width, Math.min(text.length + 2, 60))
    }
    widths.push({ wch: width })
  }
  sheet['!cols'] = widths
  return sheet
}

export function workbookWith(sheetName: string, sheet: WorkSheet, note?: string[]): WorkBook {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, sheetName)
  if (note?.length) {
    const lines = note.map((line) => [line])
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(lines), 'Пояснение')
  }
  return book
}

const templateNotes: Record<ImportKind, string[]> = {
  nomenclature: [
    'Импорт создаёт новые позиции и не обновляет существующие.',
    'Префикс — 2–8 символов A–Z и цифр. Если поверка нужна, укажите «да» и интервал в месяцах.',
    'Если поверка не нужна, в колонке «Требует поверки» напишите «нет», а интервал оставьте пустым.',
  ],
  locations: [
    'Колонка «Родитель» — полный путь через « → », как в выгрузке. Для корня оставьте её пустой.',
    'Родитель может быть в этом же файле, выше или ниже строки.',
    'Ответственный — ФИО действующего сотрудника. Пустое поле значит, что свой ответственный не задан.',
    'Импорт создаёт места и не меняет уже существующие.',
  ],
  employees: [
    'Импорт создаёт новые карточки. Совпадение ФИО не обновляет существующего сотрудника.',
    'Колонка «В архиве» при импорте не используется.',
  ],
  equipment: [
    'Код единицы выдаёт база. Колонки «Код» в шаблоне нет: если она есть в файле, значение игнорируется.',
    'Номенклатура задаётся префиксом, место — полным путём и обязательно, статус — по-русски.',
    'Даты поверки заполняют только у номенклатуры с флагом поверки.',
    'Повтор серийного номера в рамках одной номенклатуры — предупреждение, строка всё равно создаётся.',
  ],
}

export function importHeaders(kind: ImportKind): string[] {
  return columnsFor(kind)
    .filter(
      (column) => !['code', 'nomenclature_name', 'full_path', 'archived'].includes(column.key),
    )
    .map((column) => column.header)
}

export function templateWorkbook(kind: ImportKind): WorkBook {
  return workbookWith(
    sheetNameFor(kind),
    sheetFromRows(importHeaders(kind), []),
    templateNotes[kind],
  )
}

export function nomenclatureWorkbook(
  rows: {
    code_prefix: string
    name: string
    manufacturer: string | null
    model: string | null
    category: string | null
    requires_verification: boolean
    verification_interval_months: number | null
    notes: string | null
  }[],
): WorkBook {
  const sheet = sheetFromRows(
    nomenclatureColumns.map((column) => column.header),
    rows.map((row) => [
      row.code_prefix,
      row.name,
      row.manufacturer,
      row.model,
      row.category,
      yesNoText(row.requires_verification),
      row.verification_interval_months,
      row.notes,
    ]),
  )
  return workbookWith('Номенклатура', sheet)
}

export function locationsWorkbook(
  rows: {
    name: string
    kind: string
    parent_path: string
    full_path: string
    responsible_name: string
    archived: boolean
  }[],
): WorkBook {
  const sheet = sheetFromRows(
    locationColumns.map((column) => column.header),
    rows.map((row) => [
      row.name,
      row.kind,
      row.parent_path,
      row.responsible_name,
      row.full_path,
      yesNoText(row.archived),
    ]),
  )
  return workbookWith('Места', sheet)
}

export function employeesWorkbook(
  rows: { full_name: string; position: string | null; phone: string | null; archived: boolean }[],
): WorkBook {
  const sheet = sheetFromRows(
    employeeColumns.map((column) => column.header),
    rows.map((row) => [row.full_name, row.position, row.phone, yesNoText(row.archived)]),
  )
  return workbookWith('Сотрудники', sheet)
}

export function equipmentWorkbook(
  rows: {
    code: string
    code_prefix: string
    nomenclature_name: string
    serial_number: string | null
    inventory_number: string | null
    status: EquipmentStatus
    location_path: string | null
    last_verification_date: string | null
    next_verification_date: string | null
    notes: string | null
  }[],
): WorkBook {
  const headers = equipmentColumns.map((column) => column.header)
  const sheet = sheetFromRows(
    headers,
    rows.map((row) => [
      row.code,
      row.code_prefix,
      row.nomenclature_name,
      row.serial_number,
      row.inventory_number,
      statusText(row.status),
      row.location_path,
      excelDate(row.last_verification_date),
      excelDate(row.next_verification_date),
      row.notes,
    ]),
    { dates: [7, 8] },
  )
  return workbookWith('Единицы', sheet)
}

export function journalWorkbook(
  rows: {
    occurred_at: string
    event_kind: string
    equipment_code: string
    nomenclature_name: string
    from_path: string | null
    to_path: string | null
    from_status: EquipmentStatus | null
    to_status: EquipmentStatus | null
    actor_name: string
    comment: string | null
  }[],
): WorkBook {
  const sheet = sheetFromRows(
    journalColumns,
    rows.map((row) => [
      excelDateTime(row.occurred_at),
      row.event_kind === 'movement' ? 'Перемещение' : 'Смена статуса',
      row.equipment_code,
      row.nomenclature_name,
      row.event_kind === 'movement' ? (row.from_path ?? 'Место не назначено') : null,
      row.event_kind === 'movement' ? (row.to_path ?? 'Место не назначено') : null,
      row.event_kind === 'status_change' ? statusText(row.from_status) || '—' : null,
      row.event_kind === 'status_change' ? statusText(row.to_status) : null,
      row.actor_name,
      row.comment,
    ]),
    { dateTimes: [0] },
  )
  return workbookWith('Журнал', sheet)
}

export function verificationJournalWorkbook(
  rows: {
    verified_at: string
    equipment_code: string
    nomenclature_name: string
    result: 'passed' | 'failed'
    certificate_number: string | null
    next_due_at: string | null
    comment: string | null
    location_path: string | null
  }[],
): WorkBook {
  const sheet = sheetFromRows(
    verificationJournalColumns,
    rows.map((row) => [
      excelDateTime(row.verified_at),
      row.equipment_code,
      row.nomenclature_name,
      resultText(row.result),
      row.certificate_number,
      excelDate(row.next_due_at),
      row.comment,
      row.location_path,
    ]),
    { dates: [5], dateTimes: [0] },
  )
  return workbookWith('Поверки', sheet)
}

export function verificationQueueWorkbook(
  rows: {
    code: string
    nomenclature_name: string
    code_prefix: string
    location_path: string | null
    status: EquipmentStatus
    last_verification_date: string | null
    next_verification_date: string | null
    group: string
  }[],
): WorkBook {
  const sheet = sheetFromRows(
    verificationQueueColumns,
    rows.map((row) => [
      row.code,
      row.nomenclature_name,
      row.code_prefix,
      row.location_path,
      statusText(row.status),
      excelDate(row.last_verification_date),
      excelDate(row.next_verification_date),
      row.group,
    ]),
    { dates: [5, 6] },
  )
  return workbookWith('График поверок', sheet)
}
