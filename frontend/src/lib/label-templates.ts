export const labelPrintLimit = 200

export type LabelTemplateId = 'thermal-58x40' | 'thermal-40x30' | 'a4-3x8'

export type LabelTemplate = {
  id: LabelTemplateId
  title: string
  description: string
  pageWidthMm: number
  pageHeightMm: number
  columns: number
  rows: number
  labelWidthMm: number
  labelHeightMm: number
  marginMm: number
  gapMm: number
  qrMm: number
  paddingMm: number
  codeFontMm: number
  textFontMm: number
}

const a4MarginMm = 8
const a4GapMm = 2
const a4Columns = 3
const a4Rows = 8

export const labelTemplates: LabelTemplate[] = [
  {
    id: 'thermal-58x40',
    title: 'Термоэтикетка 58×40 мм',
    description: 'Одна этикетка на страницу, для термопринтера шириной 58 мм.',
    pageWidthMm: 58,
    pageHeightMm: 40,
    columns: 1,
    rows: 1,
    labelWidthMm: 58,
    labelHeightMm: 40,
    marginMm: 0,
    gapMm: 0,
    qrMm: 22,
    paddingMm: 2,
    codeFontMm: 4.2,
    textFontMm: 2.6,
  },
  {
    id: 'thermal-40x30',
    title: 'Термоэтикетка 40×30 мм',
    description: 'Одна этикетка на страницу, компактный размер.',
    pageWidthMm: 40,
    pageHeightMm: 30,
    columns: 1,
    rows: 1,
    labelWidthMm: 40,
    labelHeightMm: 30,
    marginMm: 0,
    gapMm: 0,
    qrMm: 16,
    paddingMm: 1.4,
    codeFontMm: 3.2,
    textFontMm: 2.1,
  },
  {
    id: 'a4-3x8',
    title: 'Лист A4, сетка 3×8',
    description: '24 этикетки на лист A4. Линии сетки помогают резать.',
    pageWidthMm: 210,
    pageHeightMm: 297,
    columns: a4Columns,
    rows: a4Rows,
    marginMm: a4MarginMm,
    gapMm: a4GapMm,
    labelWidthMm: (210 - a4MarginMm * 2 - a4GapMm * (a4Columns - 1)) / a4Columns,
    labelHeightMm: (297 - a4MarginMm * 2 - a4GapMm * (a4Rows - 1)) / a4Rows,
    qrMm: 18,
    paddingMm: 1.4,
    codeFontMm: 3.4,
    textFontMm: 2.3,
  },
]

export function labelTemplateById(id: string): LabelTemplate {
  return labelTemplates.find((item) => item.id === id) ?? labelTemplates[0]
}

export function labelsPerPage(template: LabelTemplate): number {
  return template.columns * template.rows
}

export function chunkLabels<T>(items: T[], size: number): T[][] {
  if (size < 1) return [items]
  const pages: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    pages.push(items.slice(index, index + size))
  }
  return pages
}

export type LabelContent = {
  code: string
  nomenclatureName: string
  inventoryNumber: string | null
  serialNumber: string | null
}

export type LabelFieldSettings = {
  templateId: LabelTemplateId
  showName: boolean
  showInventory: boolean
  showSerial: boolean
}

export const defaultLabelSettings: LabelFieldSettings = {
  templateId: 'thermal-58x40',
  showName: true,
  showInventory: false,
  showSerial: false,
}

/** Образец вёрстки, не из базы. В печать и PDF не попадает. */
export const labelSample: LabelContent = {
  code: 'KYOC-001',
  nomenclatureName: 'Принтер Kyocera',
  inventoryNumber: 'ИНВ-1042',
  serialNumber: 'SN77821',
}

/**
 * Содержимое QR. Только код единицы, без адреса сервера:
 * этикетку нельзя перепечатать, когда сервер переедет.
 */
export function qrPayload(code: string): string {
  return code.trim()
}

export function labelDetailLines(item: LabelContent, settings: LabelFieldSettings): string[] {
  const lines: string[] = []
  if (settings.showName && item.nomenclatureName.trim()) lines.push(item.nomenclatureName.trim())
  if (settings.showInventory && item.inventoryNumber?.trim()) {
    lines.push(`Инв. ${item.inventoryNumber.trim()}`)
  }
  if (settings.showSerial && item.serialNumber?.trim()) {
    lines.push(`SN ${item.serialNumber.trim()}`)
  }
  return lines
}
