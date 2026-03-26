import { FirebaseApp, FirebaseOptions, getApp, getApps, initializeApp } from 'firebase/app'
import { Auth, GoogleAuthProvider, getAuth } from 'firebase/auth'

function getFirebaseConfig(): FirebaseOptions {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY as string | undefined
  const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined
  const appId = import.meta.env.VITE_FIREBASE_APP_ID as string | undefined
  const messagingSenderId = import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined

  if (!apiKey || !authDomain || !projectId || !appId || !messagingSenderId) {
    throw new Error(
      'Missing Firebase frontend env vars. Set VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_APP_ID, and VITE_FIREBASE_MESSAGING_SENDER_ID.'
    )
  }

  return {
    apiKey,
    authDomain,
    projectId,
    appId,
    messagingSenderId
  }
}

let app: FirebaseApp
if (getApps().length) {
  app = getApp()
} else {
  app = initializeApp(getFirebaseConfig())
}

export const firebaseAuth: Auth = getAuth(app)
export const googleProvider = new GoogleAuthProvider()
googleProvider.setCustomParameters({ prompt: 'select_account' })
