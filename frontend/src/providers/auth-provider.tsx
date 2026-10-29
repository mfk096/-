import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { toRussianAuthError } from '@/lib/auth-errors'
import { hasRecoveryHint } from '@/lib/auth-url'
import { passwordResetRedirect } from '@/lib/public-url'
import { AuthContext, type AuthContextValue } from '@/providers/auth-context'
import { useConnection } from '@/providers/connection-context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const { client, configured, configMessage } = useConnection()
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(configured)
  const [recovery, setRecovery] = useState(hasRecoveryHint)

  useEffect(() => {
    if (!client) {
      setSession(null)
      setLoading(false)
      return
    }

    setLoading(true)
    const { data } = client.auth.onAuthStateChange((event, next) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      setSession(next)
      setLoading(false)
    })

    return () => {
      data.subscription.unsubscribe()
    }
  }, [client])

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (!client) {
        throw new Error(configMessage ?? 'Supabase не настроен.')
      }
      const { error } = await client.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (error) throw new Error(toRussianAuthError(error.message, error.code))
    },
    [client, configMessage],
  )

  const signOut = useCallback(async () => {
    if (!client) return
    const { error } = await client.auth.signOut()
    if (error) throw new Error(toRussianAuthError(error.message, error.code))
  }, [client])

  const requestPasswordReset = useCallback(
    async (email: string) => {
      if (!client) {
        throw new Error(configMessage ?? 'Supabase не настроен.')
      }
      const redirectTo = passwordResetRedirect()
      const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo })
      if (error) throw new Error(toRussianAuthError(error.message, error.code))
    },
    [client, configMessage],
  )

  const updatePassword = useCallback(
    async (password: string) => {
      if (!client) {
        throw new Error(configMessage ?? 'Supabase не настроен.')
      }
      const { error } = await client.auth.updateUser({ password })
      if (error) throw new Error(toRussianAuthError(error.message, error.code))
    },
    [client, configMessage],
  )

  const clearRecovery = useCallback(() => {
    setRecovery(false)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      configured,
      configMessage,
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
      configured,
      configMessage,
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
