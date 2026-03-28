import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { onAuthStateChanged, signInWithPopup, signOut, type User as FirebaseUser } from 'firebase/auth'
import { useNavigate } from 'react-router-dom'

import { firebaseAuth, googleProvider } from './firebase'

const CHAT_STORAGE_PREFIX = 'kavi.chat.'
const ACTIVE_REPO_STORAGE_KEY = 'kavi.activeRepoId'

export interface AuthUser {
  sub: string
  email?: string | null
  name?: string | null
  picture?: string | null
}

export interface AuthContextValue {
  isAuthenticated: boolean
  isLoading: boolean
  user: AuthUser | null
  login: (returnTo?: string) => Promise<void>
  logout: () => Promise<void>
  getToken: () => Promise<string | undefined>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

interface AuthProviderProps {
  children: ReactNode
}

function mapFirebaseUser(user: FirebaseUser | null): AuthUser | null {
  if (!user) return null
  return {
    sub: user.uid,
    email: user.email,
    name: user.displayName,
    picture: user.photoURL
  }
}

function clearSessionStorageArtifacts() {
  try {
    const keysToDelete: string[] = []
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (!key) continue
      if (key === ACTIVE_REPO_STORAGE_KEY || key.startsWith(CHAT_STORAGE_PREFIX)) {
        keysToDelete.push(key)
      }
    }
    keysToDelete.forEach((key) => window.localStorage.removeItem(key))
  } catch {
    // noop
  }
}

export function AuthProvider({ children }: AuthProviderProps) {
  const navigate = useNavigate()
  const [isLoading, setIsLoading] = useState(true)
  const [user, setUser] = useState<AuthUser | null>(null)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, (nextUser) => {
      setUser(mapFirebaseUser(nextUser))
      setIsLoading(false)
    })
    return () => unsubscribe()
  }, [])

  const login = useCallback(
    async (returnTo = '/connect-github') => {
      await signInWithPopup(firebaseAuth, googleProvider)
      navigate(returnTo, { replace: true })
    },
    [navigate]
  )

  const logoutUser = useCallback(async () => {
    clearSessionStorageArtifacts()
    // Clear local auth state immediately so route guards react without delay.
    setUser(null)
    setIsLoading(false)
    try {
      await signOut(firebaseAuth)
    } finally {
      navigate('/login', { replace: true })
    }
  }, [navigate])

  const getToken = useCallback(async () => {
    const currentUser = firebaseAuth.currentUser
    if (!currentUser) return undefined
    return currentUser.getIdToken()
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated: Boolean(user),
      isLoading,
      user,
      login,
      logout: logoutUser,
      getToken
    }),
    [user, isLoading, login, logoutUser, getToken]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
