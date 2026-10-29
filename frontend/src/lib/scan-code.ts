const CODE_PATTERN = /[A-Za-z0-9]{2,8}-\d+/

/**
 * Приводит текст с камеры или из ручного поля к коду единицы.
 * Печатаемый QR — ссылка на карточку. Голый код со старой этикетки тоже принимается.
 * В базу уходит только код вида KYOC-001, без адреса.
 */
export function normalizeScannedCode(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const match = trimmed.match(CODE_PATTERN)
  if (!match) return trimmed.toUpperCase()
  const code = match[0].toUpperCase()
  if (code === trimmed.toUpperCase()) return code
  if (/[:/]/.test(trimmed) || trimmed.length > code.length + 2) return code
  return trimmed.toUpperCase()
}
