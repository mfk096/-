import type { SupabaseClient } from '@supabase/supabase-js'
import { createContext, useContext } from 'react'
import type { ConnectionDraft, ConnectionSource } from '@/lib/connection'
import type { Database } from '@/types/database'

export type ConnectionContextValue = {
  client: SupabaseClient<Database> | null
  configured: boolean
  configMessage: string | null
  source: ConnectionSource | null
  envDefaults: ConnectionDraft
  device: ConnectionDraft | null
  save: (draft: ConnectionDraft) => Promise<void>
  resetToEnv: () => Promise<void>
  check: (draft: ConnectionDraft) => Promise<string>
}

export const ConnectionContext = createContext<ConnectionContextValue | null>(null)

export function useConnection(): ConnectionContextValue {
  const value = useContext(ConnectionContext)
  if (!value) {
    throw new Error('useConnection вызывается вне ConnectionProvider')
  }
  return value
}
