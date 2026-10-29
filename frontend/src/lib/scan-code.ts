const CODE_PATTERN = /[A-Za-z0-9]{2,8}-\d+/

/**
 * Приводит текст с камеры или из ручного поля к коду единицы.
 * Печатаемый QR содержит только код. Если в кадре оказалась ссылка,
 * из неё забирается код вида KYOC-001 — адрес сервера в базу не уходит.
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
