export function hasRecoveryHint(): boolean {
  const raw = `${window.location.hash}&${window.location.search}`.toLowerCase()
  return raw.includes('type=recovery') || raw.includes('type=invite') || raw.includes('type=signup')
}

export function readUrlAuthError(): string | null {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const query = new URLSearchParams(window.location.search)
  const code = hash.get('error_code') ?? query.get('error_code') ?? ''
  const description = hash.get('error_description') ?? query.get('error_description') ?? ''

  if (!code && !description) return null

  const text = `${code} ${description}`.toLowerCase()
  if (text.includes('expired') || text.includes('otp_expired')) {
    return 'Ссылка для сброса пароля устарела. Запросите письмо ещё раз.'
  }
  if (text.includes('access_denied') || text.includes('invalid')) {
    return 'Ссылка для сброса пароля недействительна. Запросите письмо ещё раз.'
  }

  return 'Не удалось подтвердить ссылку из письма. Запросите сброс пароля ещё раз.'
}
