import axios, { AxiosInstance } from 'axios'
import { useEffect, useRef } from 'react'

import { useAuth } from '../features/auth/useAuth'

export function createApiClient(getToken: () => Promise<string | undefined>): AxiosInstance {
  const client = axios.create({
    baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api'
  })

  client.interceptors.request.use(async (config) => {
    const token = await getToken()
    if (token) {
      config.headers = config.headers ?? {}
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  })

  return client
}

export function useApiClient() {
  const { getToken } = useAuth()
  const getTokenRef = useRef(getToken)
  const clientRef = useRef<AxiosInstance | null>(null)

  useEffect(() => {
    getTokenRef.current = getToken
  }, [getToken])

  if (!clientRef.current) {
    clientRef.current = createApiClient(() => getTokenRef.current())
  }

  return clientRef.current
}
