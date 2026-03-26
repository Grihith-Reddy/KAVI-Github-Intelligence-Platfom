import { AxiosInstance } from 'axios'

export const verifyAuth = async (api: AxiosInstance) => {
  const { data } = await api.get('/auth/verify')
  return data
}
