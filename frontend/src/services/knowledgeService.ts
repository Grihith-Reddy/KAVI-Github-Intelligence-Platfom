import { AxiosInstance } from 'axios'

export const listKnowledgeEntries = async (api: AxiosInstance, repoId: string) => {
  const { data } = await api.get(`/knowledge/repositories/${repoId}/entries`)
  return data
}

export const getKnowledgeEntry = async (api: AxiosInstance, entryId: string) => {
  const { data } = await api.get(`/knowledge/entries/${entryId}`)
  return data
}

export const listKnowledgeTimeline = async (api: AxiosInstance, repoId: string) => {
  const { data } = await api.get(`/knowledge/repositories/${repoId}/timeline`)
  return data
}

export const getProjectEvolution = async (api: AxiosInstance, repoId: string) => {
  const { data } = await api.get(`/knowledge/repositories/${repoId}/evolution`)
  return data
}

export const listKnowledgeFiles = async (api: AxiosInstance, repoId: string) => {
  const { data } = await api.get(`/knowledge/repositories/${repoId}/files`)
  return data
}

export const getFileDetails = async (api: AxiosInstance, repoId: string, path: string) => {
  const { data } = await api.get(`/knowledge/files`, { params: { repo_id: repoId, path } })
  return data
}
