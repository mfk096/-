import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import { equipmentWorkbook, importHeaders, templateWorkbook } from '@/lib/excel/build'
import { workbookBytes } from '@/lib/excel/download'
import { normalizePath, parseStatus, parseYesNo } from '@/lib/excel/model'
import { parseExcelDate, readWorkbook } from '@/lib/excel/parse'
import {
  emptyCatalog,
  importSelection,
  validateEquipment,
  validateLocations,
  validateNomenclature,
} from '@/lib/excel/validate'
import { addCalendarMonths, certificateProblem, verificationGroup } from '@/lib/verification'
import type { ImportKind } from '@/lib/excel/model'

function workbookBuffer(rows: unknown[][], sheetName: string): Uint8Array {
  const sheet = XLSX.utils.aoa_to_sheet(rows, { cellDates: true })
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, sheetName)
  return workbookBytes(book)
}

function readKind(kind: ImportKind, rows: unknown[][], sheetName: string) {
  return readWorkbook(workbookBuffer(rows, sheetName), kind)
}

describe('даты и группы поверок', () => {
  it('разбирает дату Excel, строку и отбрасывает несуществующий день', () => {
    expect(parseExcelDate(new Date(2026, 2, 15)).iso).toBe('2026-03-15')
    expect(parseExcelDate('15.03.2026').iso).toBe('2026-03-15')
    expect(parseExcelDate('2026-03-15').iso).toBe('2026-03-15')
    expect(parseExcelDate('31.02.2026').error).toBe('такой даты нет')
    expect(parseExcelDate(null).iso).toBeNull()
  })

  it('прибавляет месяцы и не вылезает за конец месяца', () => {
    expect(addCalendarMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addCalendarMonths('2024-01-31', 1)).toBe('2024-02-29')
    expect(addCalendarMonths('2026-03-15', 12)).toBe('2027-03-15')
  })

  it('делит график так же, как сводка в базе', () => {
    const today = new Date(2026, 9, 29)
    expect(verificationGroup(null, 30, today)).toBe('no_data')
    expect(verificationGroup('2026-10-28', 30, today)).toBe('overdue')
    expect(verificationGroup('2026-10-29', 30, today)).toBe('soon')
    expect(verificationGroup('2026-11-08', 30, today)).toBe('soon')
    expect(verificationGroup('2026-11-08', 5, today)).toBe('ok')
    expect(verificationGroup('2026-12-08', 30, today)).toBe('ok')
    expect(verificationGroup('2026-10-29', 0, today)).toBe('soon')
  })
})

describe('разбор Excel', () => {
  it('читает русские заголовки, алиас и дату как дату', () => {
    const sheet = readKind(
      'equipment',
      [
        ['Префикс номенклатуры', 'Статус', 'Последняя поверка', 'Код', 'Серийник'],
        ['scal2', 'На поверке', new Date(2026, 0, 15), 'HACK-999', 'SN-1'],
      ],
      'Единицы',
    )
    expect(sheet.fileErrors).toEqual([])
    expect(sheet.records[0]?.row).toBe(2)
    expect(sheet.records[0]?.cells.code).toBe('HACK-999')
    expect(parseExcelDate(sheet.records[0]?.cells.last_verification_date).iso).toBe('2026-01-15')
  })

  it('сообщает о пропущенной обязательной колонке', () => {
    const sheet = readKind('nomenclature', [['Название'], ['Весы']], 'Номенклатура')
    expect(sheet.fileErrors[0]).toContain('Префикс')
  })

  it('шаблон единиц не содержит колонку кода', () => {
    expect(importHeaders('equipment')).not.toContain('Код')
    expect(importHeaders('equipment')).toContain('Префикс')
    const book = templateWorkbook('locations')
    expect(book.SheetNames).toContain('Места')
    expect(book.SheetNames).toContain('Пояснение')
  })
})

describe('валидация строк', () => {
  it('проверяет номенклатуру и повтор префикса', () => {
    const sheet = readKind(
      'nomenclature',
      [
        ['Префикс', 'Название', 'Требует поверки', 'Интервал, мес.'],
        ['k', 'Короткий', 'нет', ''],
        ['SCAL2', 'Весы', 'да', 12],
        ['scal2', 'Ещё весы', 'да', ''],
        ['IMPT', 'Принтер', 'нет', 6],
        ['OKAY', 'Готово', 'нет', ''],
      ],
      'Номенклатура',
    )
    const catalog = emptyCatalog()
    catalog.prefixes.add('SCAL2')
    const validated = validateNomenclature(sheet, catalog)
    expect(validated.rows[0]?.errors[0]).toContain('Префикс')
    expect(validated.rows[1]?.errors.join(' ')).toContain('уже занят')
    expect(validated.rows[2]?.errors.join(' ')).toContain('интервал')
    expect(validated.rows[3]?.errors.join(' ')).toContain('только если поверка нужна')
    expect(validated.rows[4]?.value).toMatchObject({
      row: 6,
      code_prefix: 'OKAY',
      requires_verification: false,
      verification_interval_months: null,
    })
  })

  it('строит иерархию мест и объясняет чужого родителя', () => {
    const sheet = readKind(
      'locations',
      [
        ['Название', 'Вид', 'Родитель', 'Ответственный'],
        ['Участок', 'участок', 'Завод -> Цех', ''],
        ['Завод', 'завод', '', 'Пётр Импортов'],
        ['Цех', 'цех', 'Завод', ''],
        ['Склад', 'помещение', 'Нет такого', ''],
      ],
      'Места',
    )
    const catalog = emptyCatalog()
    catalog.activeEmployees.set('пётр импортов', 1)
    const validated = validateLocations(sheet, catalog)
    expect(validated.rows[0]?.value?.parent_path).toBe('Завод → Цех')
    expect(validated.rows[1]?.value?.responsible_name).toBe('Пётр Импортов')
    expect(validated.rows[2]?.value?.parent_path).toBe('Завод')
    expect(validated.rows[3]?.errors.join(' ')).toContain('не найден')
    expect(normalizePath('Завод -> Цех')).toBe('Завод → Цех')
  })

  it('игнорирует код, принимает русский статус и предупреждает о серийнике', () => {
    const sheet = readKind(
      'equipment',
      [
        ['Код', 'Префикс', 'Статус', 'Серийный номер', 'Место', 'Последняя поверка'],
        ['HACK-999', 'IMPT', 'В работе', 'SN-1', 'Завод → Цех', ''],
        ['', 'IMPT', 'Резерв', 'sn-1', '', ''],
        ['', 'IMPT', 'на складе', '', '', ''],
        ['', 'IMPT', 'В работе', '', '', '01.02.2026'],
        ['', 'MISS', 'В работе', '', '', ''],
      ],
      'Единицы',
    )
    const catalog = emptyCatalog()
    catalog.prefixes.add('IMPT')
    catalog.prefixRequiresVerification.set('IMPT', false)
    catalog.locationPaths.add('Завод → Цех')
    catalog.serialsByPrefix.set('IMPT', new Set(['sn-1']))
    const validated = validateEquipment(sheet, catalog)
    expect(validated.rows[0]?.value).toMatchObject({
      code_prefix: 'IMPT',
      status: 'in_work',
      serial_number: 'SN-1',
      location_path: 'Завод → Цех',
    })
    expect(validated.rows[0]?.value).not.toHaveProperty('code')
    expect(validated.rows[0]?.warnings[0]).toContain('Серийный номер')
    expect(validated.rows[1]?.warnings[0]).toContain('Серийный номер')
    expect(validated.rows[2]?.errors.join(' ')).toContain('не распознан')
    expect(validated.rows[3]?.errors.join(' ')).toContain('Даты поверки')
    expect(validated.rows[4]?.errors.join(' ')).toContain('не найдена')
    expect(parseStatus('Списано')).toBe('written_off')
    expect(parseYesNo('Да')).toBe(true)
  })

  it('не импортирует файл с ошибками, пока не выбран режим корректных строк', () => {
    const sheet = readKind(
      'nomenclature',
      [
        ['Префикс', 'Название', 'Требует поверки'],
        ['OKAY', 'Готово', 'нет'],
        ['A', 'Плохо', 'нет'],
      ],
      'Номенклатура',
    )
    const validated = validateNomenclature(sheet, emptyCatalog())
    expect(importSelection(validated, false).blockedReason).toContain('ошибки')
    expect(importSelection(validated, true).rows).toHaveLength(1)
  })

  it('останавливает файл длиннее 2000 строк', () => {
    const rows: unknown[][] = [['Префикс', 'Название', 'Требует поверки']]
    for (let index = 0; index < 2001; index += 1) rows.push(['OKAY', 'Имя', 'нет'])
    const validated = validateNomenclature(
      readKind('nomenclature', rows, 'Номенклатура'),
      emptyCatalog(),
    )
    expect(validated.fileErrors[0]).toContain('2000')
  })
})

describe('выгрузка', () => {
  it('пишет статус по-русски, дату ячейкой Excel и ширину колонок', () => {
    const book = equipmentWorkbook([
      {
        code: 'IMPT-001',
        code_prefix: 'IMPT',
        nomenclature_name: 'Принтер',
        serial_number: 'SN-1',
        inventory_number: null,
        status: 'in_work',
        location_path: 'Завод → Цех',
        last_verification_date: '2026-03-15',
        next_verification_date: null,
        notes: null,
      },
    ])
    const sheet = book.Sheets['Единицы']
    expect(sheet?.A1?.v).toBe('Код')
    expect(sheet?.F2?.v).toBe('В работе')
    expect(sheet?.H2?.t).toBe('d')
    expect(sheet?.H2?.v).toBeInstanceOf(Date)
    expect(sheet?.['!cols']?.[0]?.wch).toBeGreaterThan(8)
  })
})

describe('файл свидетельства', () => {
  it('принимает pdf и отвергает пустой или чужой тип', () => {
    expect(certificateProblem(new File(['%PDF'], 'a.pdf', { type: 'application/pdf' }))).toBeNull()
    expect(
      certificateProblem(new File(['x'], 'a.exe', { type: 'application/octet-stream' })),
    ).toContain('PDF')
    expect(certificateProblem(new File([], 'a.pdf', { type: 'application/pdf' }))).toContain(
      'пустой',
    )
  })
})
