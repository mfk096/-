const STORAGE_URL = 'inventory.connection.url'
const STORAGE_ANON_KEY = 'inventory.connection.anonKey'

export const PLACEHOLDER_URL = 'https://your-project.supabase.co'
export const PLACEHOLDER_KEY = 'your-anon-key'

/** Облачный проект, на котором проверяют релиз 1.0. Ключ сюда не кладётся. */
export const TEST_SUPABASE_URL = 'https://wehdetsnxqbfjrfhopzh.supabase.co'

export function resolveSupabaseUrl(envUrl: string | undefined | null): string {
  const trimmed = (envUrl ?? '').trim().replace(/\/+$/, '')
  return trimmed || TEST_SUPABASE_URL
}

export type ConnectionSource = 'device' | 'env'

export type ConnectionDraft = {
  url: string
  anonKey: string
}

export type ActiveConnection = ConnectionDraft & {
  source: ConnectionSource
}

function readEnv(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function readEnvDefaults(): ConnectionDraft {
  return {
    url: resolveSupabaseUrl(readEnv(import.meta.env.VITE_SUPABASE_URL)),
    anonKey: readEnv(import.meta.env.VITE_SUPABASE_ANON_KEY),
  }
}

export function readDeviceConnection(): ConnectionDraft | null {
  try {
    const storedUrl = localStorage.getItem(STORAGE_URL)
    const storedKey = localStorage.getItem(STORAGE_ANON_KEY)
    if (storedUrl === null && storedKey === null) return null
    return {
      url: (storedUrl ?? '').trim(),
      anonKey: (storedKey ?? '').trim(),
    }
  } catch {
    return null
  }
}

export function saveDeviceConnection(draft: ConnectionDraft) {
  localStorage.setItem(STORAGE_URL, draft.url.trim())
  localStorage.setItem(STORAGE_ANON_KEY, draft.anonKey.trim())
}

export function clearDeviceConnection() {
  try {
    localStorage.removeItem(STORAGE_URL)
    localStorage.removeItem(STORAGE_ANON_KEY)
  } catch {
    // Приватный режим: локальной настройки и так нет.
  }
}

export function normalizeConnection(draft: ConnectionDraft): ConnectionDraft {
  return {
    url: draft.url.trim().replace(/\/+$/, ''),
    anonKey: draft.anonKey.trim(),
  }
}

function isServiceRoleKey(anonKey: string): boolean {
  const parts = anonKey.split('.')
  if (parts.length < 2) return false
  try {
    const body = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = body.padEnd(Math.ceil(body.length / 4) * 4, '=')
    const payload = JSON.parse(atob(padded)) as { role?: unknown }
    return payload.role === 'service_role'
  } catch {
    return false
  }
}

function urlProblem(url: string, source: ConnectionSource): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return source === 'env'
        ? 'VITE_SUPABASE_URL должен начинаться с http:// или https://.'
        : 'Адрес должен начинаться с http:// или https://.'
    }
  } catch {
    return source === 'env'
      ? 'VITE_SUPABASE_URL имеет неверный формат. Ожидается адрес вида https://xxxx.supabase.co.'
      : 'Адрес сервера имеет неверный формат. Ожидается адрес вида https://xxxx.supabase.co или http://10.0.0.5:8000.'
  }
  return null
}

export function describeConnection(
  draft: ConnectionDraft,
  source: ConnectionSource,
): string | null {
  const url = draft.url.trim()
  const anonKey = draft.anonKey.trim()

  if (source === 'env') {
    if (!url && !anonKey) {
      return 'Не заданы переменные VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY.'
    }
    if (!url) return 'Не задана переменная VITE_SUPABASE_URL.'
    if (!anonKey) return 'Не задана переменная VITE_SUPABASE_ANON_KEY.'
    if (url === PLACEHOLDER_URL || anonKey === PLACEHOLDER_KEY) {
      return 'В окружении всё ещё стоят значения-заглушки из frontend/.env.example.'
    }
    if (isServiceRoleKey(anonKey)) {
      return 'В VITE_SUPABASE_ANON_KEY попал service_role. Нужен anon key.'
    }
    return urlProblem(url, source)
  }

  if (!url && !anonKey) return 'В настройках подключения не заданы адрес сервера и anon key.'
  if (!url) return 'Укажите адрес сервера.'
  if (!anonKey) return 'Укажите anon key.'
  if (url === PLACEHOLDER_URL || anonKey === PLACEHOLDER_KEY) {
    return 'Это значения-заглушки из примера. Нужны адрес вашего сервера и anon key.'
  }
  if (isServiceRoleKey(anonKey)) {
    return 'Это ключ service_role. В приложение можно вводить только anon key.'
  }
  return urlProblem(url, source)
}

export async function checkConnection(draft: ConnectionDraft): Promise<string> {
  const problem = describeConnection(draft, 'device')
  if (problem) throw new Error(problem)

  const normalized = normalizeConnection(draft)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(`${normalized.url}/auth/v1/health`, {
      signal: controller.signal,
      headers: {
        apikey: normalized.anonKey,
        Authorization: `Bearer ${normalized.anonKey}`,
      },
    })
    if (response.status === 401 || response.status === 403) {
      throw new Error('Сервер отклонил ключ. Нужен anon key, не service_role.')
    }
    if (!response.ok) {
      throw new Error(
        `Сервер ответил кодом ${response.status}. Проверьте адрес: это должен быть URL Supabase, без лишнего пути.`,
      )
    }
    return 'Соединение установлено. Сервер аутентификации ответил.'
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Сервер не ответил за 8 секунд. Проверьте адрес и что телефон в той же сети.')
    }
    if (error instanceof Error && error.message.startsWith('Сервер')) throw error
    if (error instanceof Error && error.message.startsWith('Это значения')) throw error
    if (error instanceof Error && error.message.startsWith('Укажите')) throw error
    if (error instanceof Error && error.message.startsWith('Адрес')) throw error
    if (error instanceof Error && error.message.startsWith('В настройках')) throw error
    throw new Error(
      'Не удалось связаться с сервером. Проверьте адрес, сеть и что для локального сервера разрешён HTTP.',
    )
  } finally {
    clearTimeout(timer)
  }
}
