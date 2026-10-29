export function toRussianAuthError(message: string, code?: string): string {
  const normalized = `${code ?? ''} ${message}`.toLowerCase()

  if (
    normalized.includes('invalid_credentials') ||
    normalized.includes('invalid login credentials')
  ) {
    return 'Неверный email или пароль.'
  }
  if (normalized.includes('email not confirmed')) {
    return 'Email ещё не подтверждён. Обратитесь к администратору.'
  }
  if (normalized.includes('user not found')) {
    return 'Пользователь с таким email не найден.'
  }
  if (normalized.includes('password') && normalized.includes('at least')) {
    return 'Пароль должен быть не короче 6 символов.'
  }
  if (
    normalized.includes('rate limit') ||
    normalized.includes('too many') ||
    normalized.includes('over_request')
  ) {
    return 'Слишком много попыток. Подождите немного и повторите.'
  }
  if (
    normalized.includes('network') ||
    normalized.includes('failed to fetch') ||
    normalized.includes('fetch')
  ) {
    return 'Нет связи с Supabase. Проверьте интернет и адрес проекта.'
  }
  if (normalized.includes('expired') || normalized.includes('otp_expired')) {
    return 'Ссылка для сброса пароля устарела. Запросите письмо ещё раз.'
  }

  return 'Не удалось выполнить запрос. Проверьте данные и повторите.'
}
