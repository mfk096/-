import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  describeConnection,
  normalizeConnection,
  readDeviceConnection,
  readEnvDefaults,
  type ActiveConnection,
  type ConnectionDraft,
  type ConnectionSource,
} from '@/lib/connection'
import type { Database } from '@/types/database'

const authOptions = {
  persistSession: true,
  autoRefreshToken: true,
  detectSessionInUrl: true,
  // Ссылка из письма должна открываться и на другом устройстве, не только в браузере, где её запросили.
  flowType: 'implicit' as const,
}

export let supabase: SupabaseClient<Database> | null = null
export let supabaseConfigMessage: string | null = null
export let connectionSource: ConnectionSource | null = null

let activeDraft: ConnectionDraft | null = null
const listeners = new Set<() => void>()

function clientError(source: ConnectionSource): string {
  return source === 'device'
    ? 'Не удалось создать клиент. Проверьте адрес сервера и anon key в настройках подключения.'
    : 'Не удалось создать клиент Supabase. Проверьте VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY.'
}

function assignClient(connection: ActiveConnection | null, message: string | null) {
  if (!connection) {
    supabase = null
    supabaseConfigMessage = message
    connectionSource = readDeviceConnection() ? 'device' : null
    activeDraft = null
    return
  }

  try {
    supabase = createClient<Database>(connection.url, connection.anonKey, { auth: authOptions })
    supabaseConfigMessage = null
    connectionSource = connection.source
    activeDraft = { url: connection.url, anonKey: connection.anonKey }
  } catch {
    supabase = null
    supabaseConfigMessage = clientError(connection.source)
    connectionSource = connection.source
    activeDraft = null
  }
}

export function applyResolvedConnection() {
  const device = readDeviceConnection()
  const draft = device ?? readEnvDefaults()
  const source: ConnectionSource = device ? 'device' : 'env'
  const problem = describeConnection(draft, source)
  if (problem) {
    assignClient(null, problem)
    if (device) connectionSource = 'device'
    return
  }
  assignClient({ ...normalizeConnection(draft), source }, null)
}

export function subscribeSupabase(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function notify() {
  for (const listener of listeners) listener()
}

export async function activateConnection(
  next: ActiveConnection | null,
  message: string | null,
): Promise<'same' | 'changed'> {
  const unchanged = Boolean(
    next &&
      activeDraft &&
      supabase &&
      activeDraft.url === next.url &&
      activeDraft.anonKey === next.anonKey,
  )
  if (unchanged && next) {
    connectionSource = next.source
    notify()
    return 'same'
  }

  const previous = supabase
  if (previous) {
    try {
      await previous.auth.signOut({ scope: 'local' })
    } catch {
      // Старый клиент больше не используется, даже если выход не записался.
    }
  }
  assignClient(next, message)
  notify()
  return 'changed'
}

applyResolvedConnection()
