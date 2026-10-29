import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { toRussianAuthError } from '@/lib/auth-errors'
import { hasRecoveryHint } from '@/lib/auth-url'
import { isSupabaseConfigured, supabase, supabaseConfigMessage } from '@/lib/supabase'
import { AuthContext, type AuthContextValue } from '@/providers/auth-context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [recovery, setRecovery] = useState(hasRecoveryHint)

  useEffect(() => {
    const client = supabase
    if (!client) return

    const { data } = client.auth.onAuthStateChange((event, next) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      setSession(next)
      setLoading(false)
    })

    return () => {
      data.subscription.unsubscribe()
    }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) {
      throw new Error(supabaseConfigMessage ?? 'Supabase не настроен.')
    }
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    if (error) throw new Error(toRussianAuthError(error.message, error.code))
  }, [])

  const signOut = useCallback(async () => {
    if (!supabase) return
    const { error } = await supabase.auth.signOut()
    if (error) throw new Error(toRussianAuthError(error.message, error.code))
  }, [])

  const requestPasswordReset = useCallback(async (email: string) => {
    if (!supabase) {
      throw new Error(supabaseConfigMessage ?? 'Supabase не настроен.')
    }
    const redirectTo = `${window.location.origin}/reset-password`
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo })
    if (error) throw new Error(toRussianAuthError(error.message, error.code))
  }, [])

  const updatePassword = useCallback(async (password: string) => {
    if (!supabase) {
      throw new Error(supabaseConfigMessage ?? 'Supabase не настроен.')
    }
    const { error } = await supabase.auth.updateUser({ password })
    if (error) throw new Error(toRussianAuthError(error.message, error.code))
  }, [])

  const clearRecovery = useCallback(() => {
    setRecovery(false)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      configured: isSupabaseConfigured,
      configMessage: supabaseConfigMessage,
      loading,
      session,
      user: session?.user ?? null,
      recovery,
      signIn,
      signOut,
      requestPasswordReset,
      updatePassword,
      clearRecovery,
    }),
    [
      loading,
      session,
      recovery,
      signIn,
      signOut,
      requestPasswordReset,
      updatePassword,
      clearRecovery,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
