import type { SupabaseClient } from '@supabase/supabase-js'
import { errorText } from '@/lib/errors'
import type { AppRole, Database } from '@/types/database'

export const technicalEmailDomain = 'inventory.local'
export const loginPattern = /^[a-z0-9._-]{3,32}$/

/** Логин без @ превращается в технический адрес Auth. Email остаётся как есть. */
export function signInEmail(input: string): string {
  const value = input.trim()
  if (value.includes('@')) return value
  return `${value.toLowerCase()}@${technicalEmailDomain}`
}

export function isTechnicalEmail(email: string | null | undefined): boolean {
  return Boolean(email) && (email ?? '').toLowerCase().endsWith(`@${technicalEmailDomain}`)
}

export type InviteResult = {
  delivery: 'email' | 'temporary_password' | 'login'
  email: string
  temporaryPassword: string | null
  message: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

async function readFunctionError(error: unknown): Promise<string | null> {
  if (!error || typeof error !== 'object' || !('context' in error)) return null
  const context = (error as { context?: unknown }).context
  if (!(context instanceof Response)) return null
  try {
    const body: unknown = await context.clone().json()
    if (isRecord(body) && typeof body.error === 'string' && body.error.trim()) {
      return body.error.trim()
    }
  } catch {
    return null
  }
  return null
}

export async function inviteAppUser(
  client: SupabaseClient<Database>,
  input: { email: string; fullName: string; role: AppRole; login?: string; password?: string },
): Promise<InviteResult> {
  const login = input.login?.trim().toLowerCase() ?? ''
  const { data, error } = await client.functions.invoke('manage-users', {
    body: {
      email: input.email.trim(),
      full_name: input.fullName.trim(),
      role: input.role,
      ...(login ? { login, password: input.password ?? '' } : {}),
    },
  })

  if (error) {
    const parsed = await readFunctionError(error)
    throw new Error(parsed ?? errorText(error, 'Не удалось пригласить пользователя'))
  }

  if (!isRecord(data)) throw new Error('Сервер вернул пустой ответ.')
  if (typeof data.error === 'string' && data.error.trim()) throw new Error(data.error.trim())

  const delivery =
    data.delivery === 'temporary_password'
      ? 'temporary_password'
      : data.delivery === 'login'
        ? 'login'
        : 'email'
  const temporaryPassword =
    typeof data.temporary_password === 'string' && data.temporary_password.trim()
      ? data.temporary_password.trim()
      : null
  const message =
    typeof data.message === 'string' && data.message.trim()
      ? data.message.trim()
      : delivery === 'login'
        ? 'Учётная запись создана. Вход по логину и паролю.'
        : delivery === 'email'
          ? 'Письмо со ссылкой отправлено. Человек задаёт пароль по ссылке из письма.'
          : 'Передайте временный пароль. После входа его нужно сменить.'

  return {
    delivery,
    email: input.email.trim(),
    temporaryPassword,
    message,
  }
}

export async function setUserPassword(
  client: SupabaseClient<Database>,
  input: { userId: string; password: string },
): Promise<void> {
  const { data, error } = await client.functions.invoke('manage-users', {
    body: { action: 'set_password', user_id: input.userId, password: input.password },
  })
  if (error) {
    const parsed = await readFunctionError(error)
    throw new Error(parsed ?? errorText(error, 'Не удалось сменить пароль'))
  }
  if (isRecord(data) && typeof data.error === 'string' && data.error.trim()) {
    throw new Error(data.error.trim())
  }
}
