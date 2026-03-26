import { useEffect, useState } from 'react'

export function useAsync<T>(asyncFn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    asyncFn()
      .then((result) => {
        if (!active) return
        setData(result)
        setError(null)
      })
      .catch((err: Error) => {
        if (!active) return
        setError(err)
      })
      .finally(() => {
        if (!active) return
        setLoading(false)
      })

    return () => {
      active = false
    }
  }, deps)

  return { data, error, loading, setData }
}
