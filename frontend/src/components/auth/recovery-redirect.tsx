import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/providers/auth-context'

export function RecoveryRedirect() {
  const { recovery, loading } = useAuth()
  const location = useLocation()

  if (loading || !recovery || location.pathname === '/reset-password') return null

  return <Navigate to="/reset-password" replace />
}
