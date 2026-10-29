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
  if (message.includes('employees_profile_id')) {
    return 'Этот пользователь уже привязан к другому сотруднику.'
  }
  if (message.includes('последнего администратора')) {
    return 'Нельзя снять роль или отключить последнего администратора.'
  }
  if (message.includes('собственную учётную') || message.includes('собственную учетную')) {
    return 'Нельзя отключить собственную учётную запись.'
  }
  if (message.includes('не больше 10') || message.includes('10 активных')) {
    return 'Одновременно может быть не больше 10 активных пользователей.'
  }
  if (message.includes('собственную роль')) {
    return 'Нельзя изменить собственную роль.'
  }
  if (
    /edge function|functions\/v1|function not found|failed to send a request to the edge function/i.test(
      message,
    )
  ) {
    return 'Не удалось пригласить пользователя. Функция manage-users ещё не опубликована на сервере или нет сети.'
  }
  if (
    /failed to fetch|networkerror|network request failed|load failed|the operation was aborted|aborterror|timeouterror|signal timed out/i.test(
      message,
    )
  ) {
    return 'Сервер не ответил. Проверьте адрес, сеть и что для локального сервера разрешён HTTP.'
  }
  return message
}
