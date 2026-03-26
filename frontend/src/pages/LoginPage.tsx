import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Eye, EyeOff, Mail, Lock, Zap, ArrowRight, AlertCircle } from 'lucide-react'
import { useNavigate, Link, useLocation } from 'react-router-dom'

// ─── Firebase imports ─────────────────────────────────────────────────────────
// Adjust these imports to match your Firebase setup
import {
  signInWithEmailAndPassword,
  signInWithPopup,
  sendPasswordResetEmail,
  createUserWithEmailAndPassword,
} from 'firebase/auth'
import { firebaseAuth, googleProvider } from '../features/auth/firebase'
import { useAuth } from '../features/auth/useAuth'

// ─── Google icon SVG ──────────────────────────────────────────────────────────
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const returnToParam = new URLSearchParams(location.search).get('returnTo')
  const returnTo = returnToParam && returnToParam.startsWith('/') ? returnToParam : null
  const { isAuthenticated, isLoading } = useAuth()
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resetSent, setResetSent] = useState(false)

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate(returnTo || '/repositories', { replace: true })
    }
  }, [isAuthenticated, isLoading, navigate, returnTo])

  const clearError = () => setError(null)

  const friendlyError = (code: string) => {
    switch (code) {
      case 'auth/user-not-found':
      case 'auth/wrong-password':
      case 'auth/invalid-credential': return 'Incorrect email or password.'
      case 'auth/email-already-in-use': return 'An account with this email already exists.'
      case 'auth/weak-password': return 'Password must be at least 6 characters.'
      case 'auth/invalid-email': return 'Please enter a valid email address.'
      case 'auth/too-many-requests': return 'Too many attempts. Please try again later.'
      case 'auth/popup-closed-by-user': return 'Sign-in cancelled.'
      default: return 'Something went wrong. Please try again.'
    }
  }

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || (!password.trim() && mode !== 'reset')) return
    setLoading(true)
    setError(null)

    try {
      if (mode === 'reset') {
        await sendPasswordResetEmail(firebaseAuth, email)
        setResetSent(true)
      } else if (mode === 'signin') {
        await signInWithEmailAndPassword(firebaseAuth, email, password)
        navigate(returnTo || '/repositories', { replace: true })
      } else {
        await createUserWithEmailAndPassword(firebaseAuth, email, password)
        navigate(returnTo || '/connect-github', { replace: true })
      }
    } catch (err: any) {
      setError(friendlyError(err.code))
    } finally {
      setLoading(false)
    }
  }

  const handleGoogle = async () => {
    setGoogleLoading(true)
    setError(null)
    try {
      await signInWithPopup(firebaseAuth, googleProvider)
      navigate(returnTo || '/repositories', { replace: true })
    } catch (err: any) {
      setError(friendlyError(err.code))
    } finally {
      setGoogleLoading(false)
    }
  }

  const title = mode === 'signin' ? 'Welcome back.' : mode === 'signup' ? 'Create account.' : 'Reset password.'
  const subtitle = mode === 'signin' ? 'Sign in to your Kavi workspace.' : mode === 'signup' ? 'Start building your team\'s architecture memory.' : 'We\'ll send a reset link to your email.'

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Audiowide&family=Gabarito:wght@400;500;600;700&family=Archivo:wght@400;500;600;700&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .login-page {
          min-height: 100vh;
          background: #fff;
          padding: 16px;
          display: flex;
          flex-direction: column;
          font-family: 'Gabarito', sans-serif;
        }

        .login-card {
          position: relative;
          flex: 1;
          width: 100%;
          max-width: 1440px;
          margin: 0 auto;
          background: linear-gradient(170deg, #15aeea 0%, #73cef2 100%);
          border-radius: 32px;
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .login-cloud {
          position: absolute;
          width: 120%;
          left: -10%;
          bottom: -15%;
          opacity: 0.55;
          mix-blend-mode: screen;
          pointer-events: none;
          z-index: 1;
        }

        .login-inner {
          position: relative;
          z-index: 10;
          background: rgba(255, 255, 255, 0.92);
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          border-radius: 28px;
          padding: 40px 40px 36px;
          width: 100%;
          max-width: 440px;
          box-shadow: 0 24px 60px rgba(24,29,31,0.14);
        }

        @media (max-width: 520px) {
          .login-inner { padding: 28px 24px; border-radius: 20px; }
          .login-card { border-radius: 20px; }
        }

        .login-logo {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 28px;
          text-decoration: none;
        }
        .login-logo-mark {
          width: 34px; height: 34px;
          background: #181D1F;
          border-radius: 10px;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }
        .login-logo-name {
          font-family: 'Audiowide', sans-serif;
          font-size: 18px;
          font-weight: 400;
          letter-spacing: 0.04em;
          color: #181D1F;
        }

        .login-title {
          font-family: 'Archivo', sans-serif;
          font-size: 28px;
          font-weight: 700;
          color: #181D1F;
          letter-spacing: -0.02em;
          margin-bottom: 6px;
        }
        .login-subtitle {
          font-family: 'Archivo', sans-serif;
          font-size: 14px;
          color: #424647;
          margin-bottom: 28px;
          line-height: 1.5;
        }

        /* Google button */
        .login-google {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 12px 20px;
          background: #fff;
          border: 1.5px solid #E7E7E9;
          border-radius: 12px;
          font-family: 'Archivo', sans-serif;
          font-size: 14px;
          font-weight: 600;
          color: #181D1F;
          cursor: pointer;
          transition: border-color 0.15s, box-shadow 0.15s;
          margin-bottom: 20px;
        }
        .login-google:hover { border-color: #181D1F; box-shadow: 0 2px 8px rgba(24,29,31,0.08); }
        .login-google:disabled { opacity: 0.6; cursor: not-allowed; }

        /* Divider */
        .login-divider {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 20px;
        }
        .login-divider-line { flex: 1; height: 1px; background: #E7E7E9; }
        .login-divider-text {
          font-family: 'Gabarito', sans-serif;
          font-size: 12px;
          color: rgba(24,29,31,0.4);
          white-space: nowrap;
        }

        /* Fields */
        .login-field { margin-bottom: 14px; }
        .login-label {
          display: block;
          font-family: 'Gabarito', sans-serif;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: rgba(24,29,31,0.45);
          margin-bottom: 6px;
        }
        .login-input-wrap {
          display: flex;
          align-items: center;
          gap: 10px;
          background: #F4F4F5;
          border: 1.5px solid #E7E7E9;
          border-radius: 12px;
          padding: 0 14px;
          transition: border-color 0.15s;
        }
        .login-input-wrap:focus-within {
          border-color: #181D1F;
          background: #fff;
        }
        .login-input-icon { color: rgba(24,29,31,0.35); flex-shrink: 0; }
        .login-input {
          flex: 1;
          border: none;
          outline: none;
          background: transparent;
          font-family: 'Archivo', sans-serif;
          font-size: 14px;
          color: #181D1F;
          padding: 13px 0;
        }
        .login-input::placeholder { color: rgba(24,29,31,0.35); }
        .login-eye {
          background: none;
          border: none;
          cursor: pointer;
          color: rgba(24,29,31,0.4);
          display: flex;
          align-items: center;
          padding: 0;
          transition: color 0.15s;
          flex-shrink: 0;
        }
        .login-eye:hover { color: #181D1F; }

        /* Error */
        .login-error {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          background: #FDE8E3;
          border: 1px solid rgba(155,58,38,0.15);
          border-radius: 12px;
          padding: 10px 14px;
          font-family: 'Archivo', sans-serif;
          font-size: 13px;
          color: #9B3A26;
          margin-bottom: 14px;
          line-height: 1.4;
        }

        /* Success */
        .login-success {
          background: #E4EED2;
          border: 1px solid rgba(45,106,45,0.15);
          border-radius: 12px;
          padding: 14px 16px;
          font-family: 'Archivo', sans-serif;
          font-size: 14px;
          color: #2D4A1A;
          margin-bottom: 14px;
          line-height: 1.5;
          text-align: center;
        }

        /* Submit button */
        .login-submit {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 14px 20px;
          background: #181D1F;
          color: #fff;
          border: none;
          border-radius: 12px;
          font-family: 'Archivo', sans-serif;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.15s;
          margin-top: 4px;
        }
        .login-submit:hover:not(:disabled) { background: #2d3748; }
        .login-submit:disabled { opacity: 0.55; cursor: not-allowed; }

        /* Footer links */
        .login-footer {
          margin-top: 20px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
        }
        .login-link {
          font-family: 'Archivo', sans-serif;
          font-size: 13px;
          color: rgba(24,29,31,0.5);
          background: none;
          border: none;
          cursor: pointer;
          text-decoration: none;
          transition: color 0.15s;
          padding: 0;
        }
        .login-link:hover { color: #181D1F; }
        .login-link-strong {
          font-weight: 600;
          color: #181D1F;
        }
      `}</style>

      <div className="login-page">
        <div className="login-card">
          {/* Cloud background */}
          <img src="/src/assets/cloud.webp" alt="" className="login-cloud" />

          <motion.div
            className="login-inner"
            initial={{ opacity: 0, scale: 0.94, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          >
            {/* Logo */}
            <Link to="/" className="login-logo">
              <div className="login-logo-mark">
                <Zap size={16} color="#fff" strokeWidth={2} />
              </div>
              <span className="login-logo-name">KAVI</span>
            </Link>

            {/* Heading */}
            <h1 className="login-title">{title}</h1>
            <p className="login-subtitle">{subtitle}</p>

            {/* Google — only show on signin / signup */}
            {mode !== 'reset' && (
              <>
                <button
                  onClick={handleGoogle}
                  disabled={googleLoading || loading}
                  className="login-google"
                >
                  {googleLoading
                    ? <span style={{ fontFamily: "'Archivo', sans-serif", fontSize: 14 }}>Signing in…</span>
                    : <><GoogleIcon /> Continue with Google</>
                  }
                </button>

                <div className="login-divider">
                  <div className="login-divider-line" />
                  <span className="login-divider-text">or continue with email</span>
                  <div className="login-divider-line" />
                </div>
              </>
            )}

            {/* Error */}
            {error && (
              <div className="login-error">
                <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                {error}
              </div>
            )}

            {/* Reset success */}
            {resetSent && (
              <div className="login-success">
                ✓ Reset link sent! Check your inbox for <strong>{email}</strong>.
              </div>
            )}

            {/* Form */}
            {!resetSent && (
              <form onSubmit={handleEmailAuth} noValidate>
                {/* Email */}
                <div className="login-field">
                  <label className="login-label">Email</label>
                  <div className="login-input-wrap">
                    <Mail size={15} className="login-input-icon" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => { setEmail(e.target.value); clearError() }}
                      placeholder="you@company.com"
                      className="login-input"
                      autoComplete="email"
                      required
                    />
                  </div>
                </div>

                {/* Password — hide on reset mode */}
                {mode !== 'reset' && (
                  <div className="login-field">
                    <label className="login-label">Password</label>
                    <div className="login-input-wrap">
                      <Lock size={15} className="login-input-icon" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => { setPassword(e.target.value); clearError() }}
                        placeholder={mode === 'signup' ? 'Min. 6 characters' : '••••••••'}
                        className="login-input"
                        autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                        required
                      />
                      <button
                        type="button"
                        className="login-eye"
                        onClick={() => setShowPassword(s => !s)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                  </div>
                )}

                {/* Submit */}
                <button
                  type="submit"
                  disabled={loading || googleLoading}
                  className="login-submit"
                >
                  {loading ? 'Please wait…' : mode === 'signin' ? <>Sign in <ArrowRight size={15} /></> : mode === 'signup' ? <>Create account <ArrowRight size={15} /></> : 'Send reset link'}
                </button>
              </form>
            )}

            {/* Footer links */}
            <div className="login-footer">
              {mode === 'signin' && (
                <>
                  <button className="login-link" onClick={() => { setMode('reset'); clearError() }}>
                    Forgot your password?
                  </button>
                  <span className="login-link">
                    Don't have an account?{' '}
                    <button className="login-link login-link-strong" style={{ display: 'inline' }} onClick={() => { setMode('signup'); clearError() }}>
                      Sign up
                    </button>
                  </span>
                </>
              )}
              {mode === 'signup' && (
                <span className="login-link">
                  Already have an account?{' '}
                  <button className="login-link login-link-strong" style={{ display: 'inline' }} onClick={() => { setMode('signin'); clearError() }}>
                    Sign in
                  </button>
                </span>
              )}
              {mode === 'reset' && (
                <button className="login-link" onClick={() => { setMode('signin'); setResetSent(false); clearError() }}>
                  ← Back to sign in
                </button>
              )}
            </div>
          </motion.div>
        </div>
      </div>
    </>
  )
}
