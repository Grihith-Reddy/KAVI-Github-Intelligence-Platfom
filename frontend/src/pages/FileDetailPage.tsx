import { motion } from 'framer-motion'
import { FileCode2, GitPullRequest } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'

import { useAsync } from '../hooks/useAsync'
import { useApiClient } from '../services/apiClient'
import { getFileDetails } from '../services/knowledgeService'
import { formatLineRange } from '../utils/format'

const CARD: React.CSSProperties = { borderRadius: 28, border: '1px solid #E7E7E9', background: '#F4F4F5', padding: '24px 28px' }
const INNER_CARD: React.CSSProperties = { borderRadius: 16, border: '1px solid #E7E7E9', background: '#fff', padding: '14px 16px' }
const EYEBROW: React.CSSProperties = { fontFamily: "'Gabarito', sans-serif", fontSize: 12, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: 'rgba(24,29,31,0.45)', marginBottom: 12 }
const BODY: React.CSSProperties = { fontFamily: "'Archivo', sans-serif", fontSize: 14, color: '#424647', lineHeight: 1.6 }
const PILL: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: "'Gabarito', sans-serif", fontSize: 12, fontWeight: 500, color: 'rgba(24,29,31,0.55)', border: '1px solid #E7E7E9', borderRadius: 9999, padding: '4px 10px', background: '#fff' }

const PASTEL_CARDS = ['#EAE4DC', '#D7CEF0', '#FDDBCE', '#DBE5F0', '#E4EED2', '#DCEEEF']

export function FileDetailPage() {
  const api = useApiClient()
  const [searchParams] = useSearchParams()
  const repoId = searchParams.get('repoId')
  const filePath = searchParams.get('path')

  const { data, error, loading } = useAsync<any>(
    () => (repoId && filePath ? getFileDetails(api, repoId, filePath) : Promise.resolve(null)),
    [api, repoId, filePath]
  )

  if (!repoId || !filePath) {
    return (
      <div style={{ ...CARD, textAlign: 'center', padding: '64px 48px' }}>
        <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 22, fontWeight: 600, color: '#181D1F', marginBottom: 8 }}>Missing repository or file path</p>
        <Link to="/repositories" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 24px', background: '#181D1F', color: '#fff', borderRadius: 9999, fontFamily: "'Archivo', sans-serif", fontSize: 15, fontWeight: 600, textDecoration: 'none' }}>
          Back to repositories
        </Link>
      </div>
    )
  }

  const entries = (data?.entries ?? []) as Array<Record<string, any>>
  const primary = entries[0]
  const fileName = filePath.split('/').pop() ?? filePath

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Gabarito:wght@400;500;600;700&family=Archivo:wght@400;500;600;700&display=swap');
        .fd-layout { display: grid; gap: 16px; grid-template-columns: minmax(0,1fr) 300px; align-items: start; }
        @media (max-width: 1024px) { .fd-layout { grid-template-columns: 1fr; } }
      `}</style>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── Hero header ── */}
        <motion.section
          style={{ ...CARD, background: '#EAE4DC', border: 'none', padding: '40px 48px' }}
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <p style={{ ...EYEBROW }}>{repoId}</p>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginTop: 4 }}>
            <div style={{ width: 44, height: 44, background: '#181D1F', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <FileCode2 size={20} color="#fff" strokeWidth={1.5} />
            </div>
            <div>
              <h1 style={{ fontFamily: "'Archivo', sans-serif", fontSize: 'clamp(22px, 3.5vw, 40px)', fontWeight: 600, letterSpacing: '-0.025em', color: '#181D1F', lineHeight: 1.15, wordBreak: 'break-all' }}>
                {fileName}
              </h1>
              <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'rgba(24,29,31,0.5)', marginTop: 6, wordBreak: 'break-all' }}>{filePath}</p>
            </div>
          </div>
        </motion.section>

        {/* ── Loading / error ── */}
        {loading && <div style={{ ...CARD, textAlign: 'center', padding: '32px', fontFamily: "'Archivo', sans-serif", fontSize: 14, color: 'rgba(24,29,31,0.5)' }}>Loading file insights…</div>}
        {error && <div style={{ ...CARD, background: '#FDE8E3', border: '1px solid rgba(155,58,38,0.12)', fontFamily: "'Archivo', sans-serif", fontSize: 14, color: '#9B3A26' }}>Failed to load file details: {error.message}</div>}

        {!loading && !error && (
          <div className="fd-layout">

            {/* ── Main content ── */}
            <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

              {/* Primary intent */}
              <motion.article
                style={{ ...CARD, background: '#D7CEF0', border: 'none' }}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 200, damping: 26 }}
              >
                <p style={EYEBROW}>Primary Intent</p>
                <p style={{ ...BODY, fontSize: 15, color: '#181D1F' }}>
                  {primary?.intent ?? primary?.summary ?? 'No summary available for this file yet.'}
                </p>
              </motion.article>

              {/* All PR references */}
              <motion.article
                style={CARD}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 200, damping: 26, delay: 0.06 }}
              >
                <p style={EYEBROW}>All Referenced Changes</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {entries.length ? entries.map((entry, index) => (
                    <motion.article
                      key={entry.knowledge_entry_id ?? index}
                      style={{ ...INNER_CARD, background: PASTEL_CARDS[index % PASTEL_CARDS.length] + '99', border: '1px solid rgba(24,29,31,0.06)' }}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ type: 'spring', stiffness: 200, damping: 26, delay: 0.08 + index * 0.04 }}
                    >
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                        <span style={PILL}><GitPullRequest size={11} /> PR #{entry.github_pr_number ?? '?'}</span>
                        <span style={PILL}>{formatLineRange(entry.start_line, entry.end_line)}</span>
                      </div>
                      <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 14, fontWeight: 600, color: '#181D1F', marginBottom: 6 }}>{entry.pr_title ?? 'Untitled PR'}</p>
                      <p style={BODY}>{entry.intent ?? entry.summary ?? 'No intent available'}</p>
                    </motion.article>
                  )) : (
                    <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 14, color: 'rgba(24,29,31,0.5)' }}>No PR references found for this file.</p>
                  )}
                </div>
              </motion.article>
            </section>

            {/* ── Sidebar ── */}
            <aside style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <motion.section
                style={{ ...CARD, padding: '20px 24px' }}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 200, damping: 26, delay: 0.1 }}
              >
                <p style={EYEBROW}>Summary</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ ...INNER_CARD }}>
                    <p style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 11, color: 'rgba(24,29,31,0.45)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.1em' }}>PR references</p>
                    <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 28, fontWeight: 600, color: '#181D1F', letterSpacing: '-0.02em' }}>{entries.length}</p>
                  </div>
                  <div style={{ ...INNER_CARD }}>
                    <p style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 11, color: 'rgba(24,29,31,0.45)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Most recent PR</p>
                    <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 14, fontWeight: 600, color: '#181D1F', lineHeight: 1.4 }}>{primary?.pr_title ?? 'N/A'}</p>
                  </div>
                </div>
              </motion.section>
            </aside>
          </div>
        )}
      </div>
    </>
  )
}