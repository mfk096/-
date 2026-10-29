/** Адрес тестового сайта на GitHub Pages. Репозиторий называется «-». */
export const DEFAULT_PUBLIC_APP_URL = 'https://mfk096.github.io/-'

export function normalizePublicAppUrl(value: string | undefined | null): string {
  const trimmed = (value ?? '').trim().replace(/\/+$/, '')
  if (!trimmed) return DEFAULT_PUBLIC_APP_URL
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return DEFAULT_PUBLIC_APP_URL
    if (parsed.username || parsed.password) return DEFAULT_PUBLIC_APP_URL
  } catch {
    return DEFAULT_PUBLIC_APP_URL
  }
  return trimmed
}

/**
 * Куда ведут QR и письма.
 * Явный VITE_PUBLIC_APP_URL побеждает.
 * На GitHub Pages берётся адрес открытой вкладки, чтобы прямая ссылка совпала с сайтом.
 * В APK страница открыта как https://localhost, поэтому там остаётся адрес по умолчанию.
 */
export function publicAppUrl(): string {
  const fromEnv = (import.meta.env.VITE_PUBLIC_APP_URL ?? '').trim()
  if (fromEnv) return normalizePublicAppUrl(fromEnv)
  if (typeof window !== 'undefined') {
    const host = window.location.hostname
    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      const base = import.meta.env.BASE_URL || '/'
      const prefix = base === '/' ? '' : base.replace(/\/$/, '')
      return normalizePublicAppUrl(`${window.location.origin}${prefix}`)
    }
  }
  return DEFAULT_PUBLIC_APP_URL
}

export function unitPublicUrl(code: string, base?: string): string {
  const root = (base ?? publicAppUrl()).replace(/\/+$/, '')
  return `${root}/units/${encodeURIComponent(code.trim())}`
}

export function passwordResetRedirect(base?: string): string {
  const root = (base ?? publicAppUrl()).replace(/\/+$/, '')
  return `${root}/reset-password`
}
