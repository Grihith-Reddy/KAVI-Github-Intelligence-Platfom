import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { ErrorState } from '../../components/ErrorState'
import { useAsync } from '../../hooks/useAsync'
import { useApiClient } from '../../services/apiClient'
import { getGitHubStatus } from '../../services/githubService'

export function RequireGitHubConnection() {
  const api = useApiClient()
  const location = useLocation()
  const { data, error, loading } = useAsync(() => getGitHubStatus(api), [api])

  if (loading) {
    return <div style={{ minHeight: '100vh', background: '#fff' }} />
  }

  if (error) {
    return <ErrorState message="Unable to verify GitHub connection. Refresh and try again." />
  }

  if (!data?.connected) {
    return <Navigate to="/connect-github" replace state={{ from: location.pathname }} />
  }

  return <Outlet />
}