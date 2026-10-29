function readMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    const message = error.message
    if (typeof message === 'string' && message.trim()) return message
  }
  return ''
}

export function errorText(error: unknown, fallback: string): string {
  const message = readMessage(error)
  if (!message) return fallback
  if (
    message.includes('schema cache') ||
    message.includes('Could not find the') ||
    message.includes('does not exist') ||
    message.includes('relation')
  ) {
    return 'Таблицы ещё не применены в этом проекте Supabase. Их добавит координатор после ревью миграций.'
  }
  if (
    message.includes('row-level security') ||
    message.includes('permission denied') ||
    message.includes('Недостаточно прав')
  ) {
    return 'Недостаточно прав для этого действия.'
  }
  if (message.includes('nomenclature_code_prefix') || message.includes('code_counters_pkey')) {
    return 'Такой префикс уже занят.'
  }
  if (message.includes('nomenclature_prefix_format') || message.includes('Префикс:')) {
    return 'Префикс: от 2 до 8 символов, только A–Z и цифры.'
  }
  return message
}
