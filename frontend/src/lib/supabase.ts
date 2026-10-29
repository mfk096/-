import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const PLACEHOLDER_URL = 'https://your-project.supabase.co'
const PLACEHOLDER_KEY = 'your-anon-key'

function readEnv(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function describeConfig(url: string, anonKey: string): string | null {
  if (!url && !anonKey) {
    return 'Не заданы переменные VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY.'
  }
  if (!url) {
    return 'Не задана переменная VITE_SUPABASE_URL.'
  }
  if (!anonKey) {
    return 'Не задана переменная VITE_SUPABASE_ANON_KEY.'
  }
  if (url === PLACEHOLDER_URL || anonKey === PLACEHOLDER_KEY) {
    return 'В окружении всё ещё стоят значения-заглушки из frontend/.env.example.'
  }

  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return 'VITE_SUPABASE_URL должен начинаться с http:// или https://.'
    }
  } catch {
    return 'VITE_SUPABASE_URL имеет неверный формат. Ожидается адрес вида https://xxxx.supabase.co.'
  }

  return null
}

const supabaseUrl = readEnv(import.meta.env.VITE_SUPABASE_URL)
const supabaseAnonKey = readEnv(import.meta.env.VITE_SUPABASE_ANON_KEY)

let supabaseConfigMessage = describeConfig(supabaseUrl, supabaseAnonKey)
let supabase: SupabaseClient | null = null

if (!supabaseConfigMessage) {
  try {
    supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // Ссылка из письма должна открываться и на другом устройстве, не только в браузере, где её запросили.
        flowType: 'implicit',
      },
    })
  } catch {
    supabaseConfigMessage =
      'Не удалось создать клиент Supabase. Проверьте VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY.'
  }
}

export { supabase, supabaseConfigMessage }
export const isSupabaseConfigured = supabase !== null
