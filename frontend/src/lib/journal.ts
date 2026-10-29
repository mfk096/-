export const journalPageSize = 20
export const equipmentBulkLimit = 200

export const journalEventKinds = [
  { value: 'movement', label: 'Перемещение' },
  { value: 'status_change', label: 'Смена статуса' },
] as const

export type JournalEventKind = (typeof journalEventKinds)[number]['value']

export function isJournalEventKind(value: string): value is JournalEventKind {
  return journalEventKinds.some((item) => item.value === value)
}

export function journalEventLabel(kind: string): string {
  return journalEventKinds.find((item) => item.value === kind)?.label ?? 'Событие'
}

export function placeLabel(path: string | null | undefined): string {
  return path?.trim() ? path : 'Место не назначено'
}

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export function localDayStartIso(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Date(year, (month ?? 1) - 1, day ?? 1).toISOString()
}

export function localNextDayIso(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Date(year, (month ?? 1) - 1, (day ?? 1) + 1).toISOString()
}

export function pageNumber(value: string | null): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) return 1
  return parsed
}
