import axios from 'axios'

interface ApiErrorData {
  detail?: string
  message?: string
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as ApiErrorData | undefined
    if (typeof data?.detail === 'string' && data.detail.trim()) {
      return data.detail
    }
    if (typeof data?.message === 'string' && data.message.trim()) {
      return data.message
    }
    if (error.response?.status) {
      return `${fallback} (HTTP ${error.response.status})`
    }
    return `${fallback} (network error)`
  }

  if (error instanceof Error && error.message) {
    return `${fallback} (${error.message})`
  }

  return fallback
}
