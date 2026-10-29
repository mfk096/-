import type { User } from '@supabase/supabase-js'

function readMeta(user: User, key: string): string | null {
  const metadata: unknown = user.user_metadata
  if (!metadata || typeof metadata !== 'object') return null
  const value = (metadata as Record<string, unknown>)[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function getUserDisplay(user: User): { title: string; email: string; initials: string } {
  const email = user.email ?? ''
  const name =
    readMeta(user, 'full_name') ?? readMeta(user, 'name') ?? readMeta(user, 'display_name')
  const title = name ?? (email || 'Пользователь')
  const source = (name ?? email).trim()
  const parts = source.split(/[\s@._-]+/).filter((part) => part.length > 0)
  const initials =
    parts
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || 'П'

  return { title, email, initials }
}
