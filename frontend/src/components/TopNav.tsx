import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { LogIn, LogOut, Zap } from 'lucide-react'

import { useAuth } from '../features/auth/useAuth'

const navItems = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/repositories', label: 'Repositories' },
  { to: '/timeline', label: 'Timeline' },
  { to: '/settings', label: 'Settings' },
]

const ACTIVE_REPO_STORAGE_KEY = 'kavi.activeRepoId'

export function TopNav() {
  const { isAuthenticated, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [scrolled, setScrolled] = useState(false)
  const [storedRepoId, setStoredRepoId] = useState<string | null>(() => {
    try { return window.localStorage.getItem(ACTIVE_REPO_STORAGE_KEY) } catch { return null }
  })

  const activeRepoId = useMemo(() => {
    const queryRepoId = new URLSearchParams(location.search).get('repoId')
    return queryRepoId || storedRepoId
  }, [location.search, storedRepoId])

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 48)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const queryRepoId = new URLSearchParams(location.search).get('repoId')
    if (!queryRepoId) return
    setStoredRepoId(queryRepoId)
    try { window.localStorage.setItem(ACTIVE_REPO_STORAGE_KEY, queryRepoId) } catch {}
  }, [location.search])

  const resolveNavTarget = (path: string) => {
    if (!activeRepoId) return path
    if (path === '/dashboard' || path === '/timeline') {
      return `${path}?repoId=${encodeURIComponent(activeRepoId)}`
    }
    return path
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Audiowide&display=swap');

        .kavi-topnav-wrap {
          position: fixed;
          inset-inline: 0;
          top: 0;
          z-index: 1000;
          padding: 20px 24px;
          pointer-events: none;
        }
        @media (max-width: 768px) { .kavi-topnav-wrap { padding: 12px; } }

        .kavi-topnav-inner {
          max-width: 1440px;
          margin: 0 auto;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 8px 8px 16px;
          border-radius: 9999px;
          pointer-events: auto;
          transition: background 0.25s ease, box-shadow 0.25s ease;
        }
        .kavi-topnav-inner.on {
          background: rgba(255, 255, 255, 0.88);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          box-shadow: 0 4px 24px rgba(116, 130, 151, 0.14);
        }

        /* Logo */
        .kavi-nav-logo {
          display: flex;
          align-items: center;
          gap: 8px;
          text-decoration: none;
          flex-shrink: 0;
        }
        .kavi-nav-logomark {
          width: 32px; height: 32px;
          background: #181D1F;
          border-radius: 10px;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }
        .kavi-nav-logoname {
          font-family: 'Audiowide', sans-serif;
          font-size: 18px;
          font-weight: 600;
          letter-spacing: 0.06em;
          color: #181D1F;
        }

        /* Nav links — centred absolutely so logo + button stay at edges */
        .kavi-nav-links {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          pointer-events: none;
        }
        @media (max-width: 768px) { .kavi-nav-links { display: none; } }

        .kavi-nav-link {
          pointer-events: auto;
          font-family: 'Archivo', sans-serif;
          font-size: 15px;
          font-weight: 500;
          color: #181D1F;
          text-decoration: none;
          padding: 8px 18px;
          border-radius: 9999px;
          transition: background 0.15s;
          white-space: nowrap;
        }
        .kavi-nav-link:hover { background: rgba(24, 29, 31, 0.07); }
        .kavi-nav-link.active {
          background: #181D1F;
          color: #fff;
        }
        .kavi-nav-link.active:hover { background: #181D1F; }

        /* Right side */
        .kavi-nav-right {
          position: relative;
          z-index: 10;
          flex-shrink: 0;
        }
        .kavi-nav-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 10px 20px;
          border-radius: 9999px;
          border: none;
          cursor: pointer;
          font-family: 'Archivo', sans-serif;
          font-size: 15px;
          font-weight: 500;
          letter-spacing: 0.01em;
          white-space: nowrap;
          transition: background 0.15s;
          background: #181D1F;
          color: #fff;
        }
        .kavi-nav-btn:hover { background: #2d3748; }
      `}</style>

      <header className="kavi-topnav-wrap">
        {/* We use a relative wrapper so the absolute nav-links can center against the full bar */}
        <motion.div
          className={`kavi-topnav-inner${scrolled ? ' on' : ''}`}
          style={{ position: 'relative' }}
          animate={{ y: scrolled ? 0 : 4 }}
          transition={{ type: 'spring', stiffness: 280, damping: 30, mass: 0.5 }}
        >
          {/* Logo */}
          <NavLink to="/" className="kavi-nav-logo" aria-label="Kavi home">
            <div className="kavi-nav-logomark">
              <Zap size={15} color="#fff" strokeWidth={2} />
            </div>
            <span className="kavi-nav-logoname">KAVI</span>
          </NavLink>

          {/* Centred nav links */}
          <nav className="kavi-nav-links" aria-label="Main navigation">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={resolveNavTarget(item.to)}
                className={({ isActive }) =>
                  `kavi-nav-link${isActive ? ' active' : ''}`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          {/* Auth button */}
          <div className="kavi-nav-right">
            {isAuthenticated ? (
              <button onClick={logout} className="kavi-nav-btn">
                <LogOut size={14} />
                Logout
              </button>
            ) : (
              <button onClick={() => navigate('/login?returnTo=%2Fconnect-github')} className="kavi-nav-btn">
                <LogIn size={14} />
                Login
              </button>
            )}
          </div>
        </motion.div>
      </header>
    </>
  )
}
