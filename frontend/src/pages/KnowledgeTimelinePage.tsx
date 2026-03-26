import { motion } from 'framer-motion'
import { Activity, Clock3, GitPullRequest, Users2 } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'

import { useAsync } from '../hooks/useAsync'
import { useApiClient } from '../services/apiClient'
import { getProjectEvolution } from '../services/knowledgeService'

// ─── Shared style tokens ──────────────────────────────────────────────────────
const CARD: React.CSSProperties = { borderRadius: 28, border: '1px solid #E7E7E9', background: '#F4F4F5', padding: '24px 28px' }
const INNER_CARD: React.CSSProperties = { borderRadius: 16, border: '1px solid #E7E7E9', background: '#fff', padding: '12px 14px' }
const EYEBROW: React.CSSProperties = { fontFamily: "'Gabarito', sans-serif", fontSize: 12, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: 'rgba(24,29,31,0.45)', marginBottom: 8 }
const H1: React.CSSProperties = { fontFamily: "'Archivo', sans-serif", fontSize: 'clamp(28px, 4vw, 48px)', fontWeight: 600, letterSpacing: '-0.025em', color: '#181D1F', lineHeight: 1.1 }
const BODY: React.CSSProperties = { fontFamily: "'Archivo', sans-serif", fontSize: 14, color: '#424647', lineHeight: 1.6 }
const PILL: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: "'Gabarito', sans-serif", fontSize: 12, fontWeight: 500, color: 'rgba(24,29,31,0.55)', border: '1px solid #E7E7E9', borderRadius: 9999, padding: '4px 10px', background: '#fff' }

// ─── Palette for monthly bar chart ───────────────────────────────────────────
const BAR_COLORS = ['#EAE4DC', '#D7CEF0', '#FDDBCE', '#DBE5F0', '#E4EED2', '#DCEEEF']

export function KnowledgeTimelinePage() {
  const api = useApiClient()
  const [searchParams] = useSearchParams()
  const repoId = searchParams.get('repoId')

  const { data, error, loading } = useAsync(
    () => (repoId ? getProjectEvolution(api, repoId) : Promise.resolve(null)),
    [api, repoId]
  )

  if (!repoId) {
    return (
      <div style={{ ...CARD, textAlign: 'center', padding: '64px 48px' }}>
        <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 22, fontWeight: 600, color: '#181D1F', marginBottom: 8 }}>No repository selected</p>
        <p style={{ ...BODY, marginBottom: 28 }}>Open a repository first to view its evolution timeline.</p>
        <Link to="/repositories" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 24px', background: '#181D1F', color: '#fff', borderRadius: 9999, fontFamily: "'Archivo', sans-serif", fontSize: 15, fontWeight: 600, textDecoration: 'none' }}>
          Back to repositories
        </Link>
      </div>
    )
  }

  const stats = data?.stats ?? {}
  const monthlyActivity = Array.isArray(data?.monthly_activity) ? data.monthly_activity : []
  const milestones = Array.isArray(data?.milestones) ? data.milestones : []
  const topFiles = Array.isArray(data?.top_files) ? data.top_files : []
  const contributors = Array.isArray(data?.contributors) ? data.contributors : []
  const maxMonthlyPrs = Math.max(...monthlyActivity.map((item: any) => Number(item.pr_count || 0)), 1)

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Gabarito:wght@400;500;600;700&family=Archivo:wght@400;500;600;700&display=swap');
        .tl-grid { display: grid; gap: 16px; }
        .tl-stats { grid-template-columns: repeat(4, 1fr); }
        @media (max-width: 900px) { .tl-stats { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 500px) { .tl-stats { grid-template-columns: 1fr 1fr; } }
        .tl-main { grid-template-columns: minmax(0,1fr) 300px; align-items: start; }
        @media (max-width: 1024px) { .tl-main { grid-template-columns: 1fr; } }
      `}</style>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── Hero card ── */}
        <motion.section
          style={{ ...CARD, background: 'linear-gradient(170deg,#15aeea 0%,#73cef2 100%)', border: 'none', padding: '48px 48px 56px', position: 'relative', overflow: 'hidden', minHeight: 200 }}
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <img
            src="/src/assets/cloud.webp"
            alt=""
            style={{ position: 'absolute', width: '110%', left: '-5%', bottom: '-20%', opacity: 0.5, mixBlendMode: 'screen', pointerEvents: 'none', zIndex: 1 }}
          />
          <div style={{ position: 'relative', zIndex: 2 }}>
            <p style={{ ...EYEBROW, color: '#037BB5' }}>Project Evolution</p>
            <h1 style={{ ...H1, background: 'linear-gradient(169deg,rgba(3,123,181,0.9) 20%,rgba(3,120,176,0.95) 74%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              Repository decisions<br />over time.
            </h1>
            <p style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 14, color: '#037BB5', marginTop: 12 }}>{data?.repository?.full_name ?? repoId}</p>
          </div>
        </motion.section>

        {/* ── Loading / error ── */}
        {loading && <div style={{ ...CARD, textAlign: 'center', padding: '32px', fontFamily: "'Archivo', sans-serif", fontSize: 14, color: 'rgba(24,29,31,0.5)' }}>Loading project evolution…</div>}
        {error && <div style={{ ...CARD, background: '#FDE8E3', border: '1px solid rgba(155,58,38,0.12)', fontFamily: "'Archivo', sans-serif", fontSize: 14, color: '#9B3A26' }}>Failed to load timeline: {error.message}</div>}

        {!loading && !error && (
          <>
            {/* ── Stat tiles ── */}
            <div className="tl-grid tl-stats">
              {[
                { label: 'Total PRs', value: stats.total_prs ?? 0, bg: '#EAE4DC' },
                { label: 'Merged', value: stats.merged_prs ?? 0, bg: '#D7CEF0' },
                { label: 'Contributors', value: stats.contributors ?? 0, bg: '#FDDBCE' },
                { label: 'Latest Activity', value: stats.last_pr_at ? new Date(stats.last_pr_at).toLocaleDateString() : 'N/A', bg: '#DBE5F0' },
              ].map(({ label, value, bg }, i) => (
                <motion.article
                  key={label}
                  style={{ borderRadius: 24, background: bg, padding: '20px 24px', border: '1px solid rgba(24,29,31,0.06)' }}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 200, damping: 26, delay: i * 0.06 }}
                >
                  <p style={{ ...EYEBROW, marginBottom: 12 }}>{label}</p>
                  <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 28, fontWeight: 600, color: '#181D1F', letterSpacing: '-0.02em' }}>{value}</p>
                </motion.article>
              ))}
            </div>

            {/* ── Monthly activity ── */}
            <section style={{ ...CARD }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                <Activity size={16} color="#181D1F" strokeWidth={1.5} />
                <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 16, fontWeight: 600, color: '#181D1F' }}>Monthly Evolution</p>
              </div>
              {monthlyActivity.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {monthlyActivity.map((item: any, i: number) => {
                    const ratio = Math.max(6, Math.round((Number(item.pr_count || 0) / maxMonthlyPrs) * 100))
                    const bg = BAR_COLORS[i % BAR_COLORS.length]
                    return (
                      <article key={item.month} style={{ ...INNER_CARD }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                          <span style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, fontWeight: 600, color: '#181D1F' }}>{item.month}</span>
                          <span style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 12, color: 'rgba(24,29,31,0.5)' }}>{item.pr_count} PRs · {item.merged_count} merged</span>
                        </div>
                        <div style={{ height: 8, borderRadius: 9999, background: '#F4F4F5', overflow: 'hidden' }}>
                          <motion.div
                            style={{ height: 8, borderRadius: 9999, background: bg === '#EAE4DC' ? '#181D1F' : '#181D1F', opacity: 0.15 + (ratio / 100) * 0.85 }}
                            initial={{ width: 0 }}
                            animate={{ width: `${ratio}%` }}
                            transition={{ duration: 0.6, ease: 'easeOut', delay: i * 0.04 }}
                          />
                        </div>
                      </article>
                    )
                  })}
                </div>
              ) : (
                <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, color: 'rgba(24,29,31,0.45)' }}>No monthly activity data yet.</p>
              )}
            </section>

            {/* ── Milestones + sidebar ── */}
            <div className="tl-grid tl-main">
              {/* Milestones */}
              <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {milestones.length ? milestones.map((item: any, index: number) => (
                  <motion.article
                    key={item.id ?? index}
                    style={{ ...CARD, padding: '24px 28px' }}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ type: 'spring', stiffness: 190, damping: 26, delay: index * 0.04 }}
                  >
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                      <span style={PILL}><GitPullRequest size={11} /> PR #{item.github_pr_number ?? '?'}</span>
                      <span style={PILL}>
                        <Clock3 size={11} />
                        {item.merged_at ? new Date(item.merged_at).toLocaleDateString() : item.created_at ? new Date(item.created_at).toLocaleDateString() : 'Unknown date'}
                      </span>
                      {item.author_login && <span style={PILL}><Users2 size={11} /> {item.author_login}</span>}
                    </div>
                    <h3 style={{ fontFamily: "'Archivo', sans-serif", fontSize: 18, fontWeight: 600, color: '#181D1F', marginBottom: 8, lineHeight: 1.3 }}>{item.pr_title ?? 'Untitled pull request'}</h3>
                    <p style={BODY}>{item.intent ?? item.summary ?? 'No summarized intent available for this change.'}</p>
                  </motion.article>
                )) : (
                  <div style={{ ...CARD, textAlign: 'center', padding: '48px 32px' }}>
                    <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 15, color: 'rgba(24,29,31,0.5)' }}>No PR milestones exist for this repository yet.</p>
                  </div>
                )}
              </section>

              {/* Sidebar */}
              <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Top files */}
                <section style={{ ...CARD, padding: '20px 24px' }}>
                  <p style={{ ...EYEBROW }}>Top Changed Files</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                    {topFiles.slice(0, 8).map((item: any, i: number) => (
                      <article key={item.file_path} style={{ ...INNER_CARD, background: BAR_COLORS[i % BAR_COLORS.length] + '66', border: '1px solid rgba(24,29,31,0.06)' }}>
                        <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, fontWeight: 600, color: '#181D1F', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.file_path}</p>
                        <p style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 12, color: 'rgba(24,29,31,0.5)', marginTop: 2 }}>{item.change_count} references</p>
                      </article>
                    ))}
                    {!topFiles.length && <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, color: 'rgba(24,29,31,0.45)' }}>No file-change data yet.</p>}
                  </div>
                </section>

                {/* Contributors */}
                <section style={{ ...CARD, padding: '20px 24px' }}>
                  <p style={{ ...EYEBROW }}>Top Contributors</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                    {contributors.slice(0, 8).map((item: any) => (
                      <article key={item.author_login} style={{ ...INNER_CARD }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, fontWeight: 600, color: '#181D1F' }}>{item.author_login}</p>
                          <span style={{ ...PILL, fontSize: 11 }}>{item.pr_count} PRs</span>
                        </div>
                      </article>
                    ))}
                    {!contributors.length && <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, color: 'rgba(24,29,31,0.45)' }}>No contributor data yet.</p>}
                  </div>
                </section>
              </aside>
            </div>
          </>
        )}
      </div>
    </>
  )
}