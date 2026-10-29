export const soonVerificationDays = 30
export const certificateBucket = 'verification-certificates'
export const certificateMaxBytes = 10 * 1024 * 1024

const certificateTypes = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
])

const certificateExtensions = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'])

export type VerificationGroup = 'overdue' | 'soon' | 'ok' | 'no_data'

export const verificationGroups: { value: VerificationGroup; label: string }[] = [
  { value: 'overdue', label: 'Просрочена' },
  { value: 'soon', label: 'Скоро поверка' },
  { value: 'ok', label: 'В порядке' },
  { value: 'no_data', label: 'Нет данных' },
]

export function verificationGroupLabel(
  group: VerificationGroup,
  soonDays = soonVerificationDays,
): string {
  if (group === 'soon') return `В ближайшие ${soonDays} дн.`
  return verificationGroups.find((item) => item.value === group)?.label ?? group
}

export function isVerificationGroup(value: string): value is VerificationGroup {
  return verificationGroups.some((item) => item.value === value)
}

function localDate(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

export function formatIsoDate(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function calendarDaysUntil(isoDate: string, today = new Date()): number {
  const [year, month, day] = isoDate.slice(0, 10).split('-').map(Number)
  const target = new Date(year, (month ?? 1) - 1, day ?? 1)
  const start = localDate(today)
  return Math.round((target.getTime() - start.getTime()) / 86_400_000)
}

export function verificationGroup(
  nextDate: string | null | undefined,
  soonDays: number,
  today = new Date(),
): VerificationGroup {
  if (!nextDate) return 'no_data'
  const days = calendarDaysUntil(nextDate, today)
  if (days < 0) return 'overdue'
  if (days <= soonDays) return 'soon'
  return 'ok'
}

export function addCalendarMonths(isoDate: string, months: number): string {
  const [year, month, day] = isoDate.slice(0, 10).split('-').map(Number)
  const cursor = new Date(year, (month ?? 1) - 1 + months, 1)
  const lastDay = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()
  cursor.setDate(Math.min(day || 1, lastDay))
  return formatIsoDate(cursor)
}

export function todayIso(today = new Date()): string {
  return formatIsoDate(today)
}

export function verificationInstant(isoDate: string): string {
  return `${isoDate.slice(0, 10)}T12:00:00.000Z`
}

export function certificateProblem(file: File): string | null {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  const typeOk = file.type === '' || certificateTypes.has(file.type)
  if (!certificateExtensions.has(extension) || !typeOk) {
    return 'Свидетельство — это PDF или фото: PDF, JPG, PNG, WEBP, HEIC.'
  }
  if (file.size > certificateMaxBytes) {
    return 'Файл больше 10 МБ.'
  }
  if (file.size <= 0) {
    return 'Файл пустой.'
  }
  return null
}

export function certificateObjectPath(
  equipmentId: string,
  verificationId: string,
  fileName: string,
): string {
  const base = fileName.split(/[/\\]/).pop() ?? 'file'
  const cleaned = base.replace(/[^\w.\-()+\u0400-\u04FF ]+/g, '_').slice(0, 120)
  return `${equipmentId}/${verificationId}/${cleaned || 'file'}`
}
