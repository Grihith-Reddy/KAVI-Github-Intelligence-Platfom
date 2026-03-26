import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { LoadingState } from '../../components/LoadingState'
import { useAuth } from './useAuth'

export function RequireAuth() {
  const { isAuthenticated, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ background: '#fff' }}
      >
        <LoadingState label="Authenticating..." />
      </div>
    )
  }

  if (!isAuthenticated) {
    const returnTo = `${location.pathname}${location.search}`
    return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />
  }

  return <Outlet />
}
