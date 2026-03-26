import { AxiosInstance } from 'axios'

export interface RepositorySummary {
  id: number
  name: string
  full_name: string
  private: boolean
  default_branch: string
  synced_at?: string | null
  pr_count?: number
  repo_uuid?: string | null
}

interface RepositoryListResponse {
  repositories: RepositorySummary[]
}

interface SyncRepositoryResponse {
  status: 'queued' | 'completed'
  repo_full_name?: string
  repo_id?: string
  synced_prs?: number
  errors?: Array<{ pr: number; error: string }>
}

export interface GitHubStatusResponse {
  connected: boolean
  account: {
    id: string
    username: string
    updated_at: string
  } | null
}

export interface RepositoryStatusResponse {
  repository: {
    id: string
    full_name: string
    owner?: string
    name?: string
    is_private?: boolean
    default_branch?: string
    synced_at?: string | null
    created_at?: string
    updated_at?: string
  }
  sync_job?: {
    id?: string
    status?: string
    created_at?: string
    updated_at?: string
    [key: string]: unknown
  } | null
}

export const getGitHubConnectUrl = async (api: AxiosInstance) => {
  const { data } = await api.get('/github/connect-url')
  return data as { url: string }
}

export const getGitHubStatus = async (api: AxiosInstance) => {
  const { data } = await api.get('/github/status')
  return data as GitHubStatusResponse
}

export const listRepositories = async (api: AxiosInstance) => {
  const { data } = await api.get('/github/repositories')
  return data as RepositoryListResponse
}

export const syncRepository = async (api: AxiosInstance, repoFullName: string, wait = true) => {
  const { data } = await api.post(`/ingestion/repositories/sync?wait=${wait}`, {
    repo_full_name: repoFullName
  })
  return data as SyncRepositoryResponse
}

export const getRepositoryStatus = async (api: AxiosInstance, repoId: string) => {
  const { data } = await api.get(`/ingestion/repositories/${repoId}/status`)
  return data as RepositoryStatusResponse
}
