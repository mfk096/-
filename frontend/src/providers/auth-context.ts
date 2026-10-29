import type { Session, User } from '@supabase/supabase-js'
import { createContext, useContext } from 'react'

export type AuthContextValue = {
  configured: boolean
  configMessage: string | null
  loading: boolean
  session: Session | null
  user: User | null
  recovery: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  requestPasswordReset: (email: string) => Promise<void>
  updatePassword: (password: string) => Promise<void>
  clearRecovery: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) {
    throw new Error('useAuth вызывается вне AuthProvider')
  }
  return value
}
