export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const [year, month, day] = value.slice(0, 10).split('-')
  if (!year || !month || !day) return value
  return `${day}.${month}.${year}`
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' })
}

export function emptyToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export function asCount(value: number | string | null | undefined): number {
  const count = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(count) ? count : 0
}

export function unitsLabel(count: number): string {
  const abs = Math.abs(count) % 100
  const last = abs % 10
  if (abs > 10 && abs < 20) return `${count} единиц`
  if (last === 1) return `${count} единица`
  if (last >= 2 && last <= 4) return `${count} единицы`
  return `${count} единиц`
}

export function placesPhrase(count: number): string {
  const abs = Math.abs(count) % 100
  const last = abs % 10
  const word = abs > 10 && abs < 20 ? 'местах' : last === 1 ? 'месте' : 'местах'
  return `в ${count} ${word}`
}
