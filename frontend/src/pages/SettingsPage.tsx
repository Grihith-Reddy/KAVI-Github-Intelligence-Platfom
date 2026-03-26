import { motion } from 'framer-motion'
import { LogOut, Mail, User, Zap } from 'lucide-react'

import { useAuth } from '../features/auth/useAuth'
import { useAsync } from '../hooks/useAsync'
import { useApiClient } from '../services/apiClient'
import { verifyAuth } from '../services/authService'

const CARD: React.CSSProperties = { borderRadius: 28, border: '1px solid #E7E7E9', background: '#F4F4F5', padding: '24px 28px' }
const INNER_CARD: React.CSSProperties = { borderRadius: 16, border: '1px solid #E7E7E9', background: '#fff', padding: '16px 18px' }
const EYEBROW: React.CSSProperties = { fontFamily: "'Gabarito', sans-serif", fontSize: 12, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: 'rgba(24,29,31,0.45)', marginBottom: 12 }

export function SettingsPage() {
  const api = useApiClient()
  const { user, logout } = useAuth()
  const { data } = useAsync(() => verifyAuth(api), [api])

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Gabarito:wght@400;500;600;700&family=Archivo:wght@400;500;600;700&display=swap');
        .st-layout { display: grid; gap: 16px; grid-template-columns: minmax(0,1fr) 280px; align-items: start; }
        @media (max-width: 900px) { .st-layout { grid-template-columns: 1fr; } }
        .st-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        @media (max-width: 600px) { .st-fields { grid-template-columns: 1fr; } }
      `}</style>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── Hero ── */}
        <motion.section
          style={{ ...CARD, background: '#DCEEEF', border: 'none', padding: '40px 48px' }}
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <p style={{ ...EYEBROW }}>Account</p>
          <h1 style={{ fontFamily: "'Archivo', sans-serif", fontSize: 'clamp(32px, 5vw, 56px)', fontWeight: 600, letterSpacing: '-0.025em', color: '#181D1F', lineHeight: 1.1, marginBottom: 8 }}>Settings.</h1>
          <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 15, color: '#424647' }}>Profile and workspace controls for your Kavi session.</p>
        </motion.section>

        <div className="st-layout">

          {/* ── Profile card ── */}
          <motion.section
            style={CARD}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 200, damping: 26, delay: 0.06 }}
          >
            {/* Profile header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24, paddingBottom: 20, borderBottom: '1px solid #E7E7E9' }}>
              <div style={{ width: 48, height: 48, background: '#181D1F', borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Zap size={20} color="#fff" strokeWidth={1.5} />
              </div>
              <div>
                <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 16, fontWeight: 600, color: '#181D1F' }}>{user?.name ?? 'Developer'}</p>
                <p style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 13, color: 'rgba(24,29,31,0.5)', marginTop: 2 }}>Personal workspace</p>
              </div>
            </div>

            {/* Name + email */}
            <div className="st-fields" style={{ marginBottom: 12 }}>
              <div style={{ ...INNER_CARD }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <User size={12} color="rgba(24,29,31,0.4)" />
                  <p style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(24,29,31,0.4)' }}>Full Name</p>
                </div>
                <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 15, fontWeight: 600, color: '#181D1F' }}>{user?.name ?? 'Developer'}</p>
              </div>
              <div style={{ ...INNER_CARD }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <Mail size={12} color="rgba(24,29,31,0.4)" />
                  <p style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(24,29,31,0.4)' }}>Email</p>
                </div>
                <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 15, fontWeight: 600, color: '#181D1F' }}>{user?.email ?? 'Not available'}</p>
              </div>
            </div>

            {/* Auth sub */}
            <div style={{ ...INNER_CARD }}>
              <p style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(24,29,31,0.4)', marginBottom: 8 }}>External Identifier</p>
              <p style={{ fontFamily: 'monospace', fontSize: 12, color: '#424647', wordBreak: 'break-all', lineHeight: 1.5 }}>{data?.user?.auth0_sub ?? 'not synced'}</p>
            </div>
          </motion.section>

          {/* ── Sidebar ── */}
          <aside style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* Session */}
            <motion.section
              style={{ ...CARD, background: '#E4EED2', border: 'none', padding: '20px 24px' }}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 200, damping: 26, delay: 0.1 }}
            >
              <p style={{ ...EYEBROW }}>Session</p>
              <button
                onClick={logout}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '13px 20px', background: '#181D1F', color: '#fff', borderRadius: 9999, border: 'none', fontFamily: "'Archivo', sans-serif", fontSize: 15, fontWeight: 600, cursor: 'pointer', transition: 'background 0.15s' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#2d3748')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '#181D1F')}
              >
                <LogOut size={15} />
                Sign out
              </button>
            </motion.section>

            {/* About Kavi */}
            <motion.section
              style={{ ...CARD, padding: '20px 24px' }}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 200, damping: 26, delay: 0.14 }}
            >
              <p style={{ ...EYEBROW }}>About</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[['Product', 'Kavi'], ['Version', '1.0'], ['Access', 'Read-only GitHub']].map(([label, value]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 13, color: 'rgba(24,29,31,0.45)' }}>{label}</span>
                    <span style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, fontWeight: 600, color: '#181D1F' }}>{value}</span>
                  </div>
                ))}
              </div>
            </motion.section>
          </aside>
        </div>
      </div>
    </>
  )
}