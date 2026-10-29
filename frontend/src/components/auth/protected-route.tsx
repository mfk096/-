import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { FullScreenStatus } from '@/components/full-screen-status'
import { useAuth } from '@/providers/auth-context'

export function ProtectedRoute() {
  const { session, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return <FullScreenStatus title="Проверяем сессию…" />
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return <Outlet />
}
