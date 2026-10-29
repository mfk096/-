import type { SupabaseClient } from '@supabase/supabase-js'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  checkConnection,
  clearDeviceConnection,
  describeConnection,
  normalizeConnection,
  readDeviceConnection,
  readEnvDefaults,
  saveDeviceConnection,
  type ConnectionDraft,
  type ConnectionSource,
} from '@/lib/connection'
import {
  activateConnection,
  connectionSource,
  subscribeSupabase,
  supabase,
  supabaseConfigMessage,
} from '@/lib/supabase'
import { queryClient } from '@/providers/query-client'
import { ConnectionContext } from '@/providers/connection-context'
import type { Database } from '@/types/database'

type ConnectionSnapshot = {
  client: SupabaseClient<Database> | null
  configured: boolean
  configMessage: string | null
  source: ConnectionSource | null
  envDefaults: ConnectionDraft
  device: ConnectionDraft | null
}

function readSnapshot(): ConnectionSnapshot {
  return {
    client: supabase,
    configured: supabase !== null,
    configMessage: supabaseConfigMessage,
    source: connectionSource,
    envDefaults: readEnvDefaults(),
    device: readDeviceConnection(),
  }
}

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<ConnectionSnapshot>(() => readSnapshot())

  useEffect(() => subscribeSupabase(() => setSnapshot(readSnapshot())), [])

  const save = useCallback(async (draft: ConnectionDraft) => {
    const problem = describeConnection(draft, 'device')
    if (problem) throw new Error(problem)
    const normalized = normalizeConnection(draft)
    saveDeviceConnection(normalized)
    const result = await activateConnection({ ...normalized, source: 'device' }, null)
    if (result === 'changed') queryClient.clear()
  }, [])

  const resetToEnv = useCallback(async () => {
    clearDeviceConnection()
    const env = readEnvDefaults()
    const problem = describeConnection(env, 'env')
    const result = problem
      ? await activateConnection(null, problem)
      : await activateConnection({ ...normalizeConnection(env), source: 'env' }, null)
    if (result === 'changed') queryClient.clear()
  }, [])

  const check = useCallback(async (draft: ConnectionDraft) => checkConnection(draft), [])

  return (
    <ConnectionContext.Provider value={{ ...snapshot, save, resetToEnv, check }}>
      {children}
    </ConnectionContext.Provider>
  )
}
