import { AxiosInstance } from 'axios'

export type ChatMode = 'default' | 'repo_overview'

export const queryChat = async (
  api: AxiosInstance,
  repoId: string,
  query: string,
  mode: ChatMode = 'default'
) => {
  const { data } = await api.post('/chat/query', {
    repo_id: repoId,
    query,
    mode
  })
  return data
}
