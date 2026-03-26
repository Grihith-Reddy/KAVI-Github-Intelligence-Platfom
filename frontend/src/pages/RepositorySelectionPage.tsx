import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowRight, FolderGit2, GitPullRequest, RefreshCw, Search } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { useAsync } from '../hooks/useAsync'
import { useApiClient } from '../services/apiClient'
import { RepositorySummary, listRepositories, syncRepository } from '../services/githubService'
import { getApiErrorMessage } from '../utils/errors'

// ─── Card colour palette (matches landing page pastel cards) ─────────────────
const CARD_COLORS = ['#EAE4DC', '#D7CEF0', '#FDDBCE', '#DBE5F0', '#E4EED2', '#DCEEEF']

export function RepositorySelectionPage() {
  const api = useApiClient()
  const navigate = useNavigate()
  const { data, error, loading, setData } = useAsync(() => listRepositories(api), [api])

  const [syncing, setSyncing] = useState<Record<string, boolean>>({})
  const [syncError, setSyncError] = useState<string | null>(null)
  const [syncNotice, setSyncNotice] = useState<string | null>(null)
  const [syncedRepoIds, setSyncedRepoIds] = useState<Record<string, string>>({})
  const [searchQuery, setSearchQuery] = useState('')

  const handleSync = async (repo: RepositorySummary) => {
    setSyncing((prev) => ({ ...prev, [repo.full_name]: true }))
    setSyncError(null)
    setSyncNotice(null)

    try {
      const result = await syncRepository(api, repo.full_name)
      const syncedPrs = typeof result.synced_prs === 'number' ? result.synced_prs : 0
      const syncedRepoId = result.repo_id

      if (syncedRepoId) {
        setSyncedRepoIds((prev) => ({ ...prev, [repo.full_name]: syncedRepoId }))
      }

      if (syncedRepoId && syncedPrs > 0) {
        setTimeout(() => navigate(`/dashboard?repoId=${syncedRepoId}`), 450)
      } else if (syncedPrs === 0) {
        setSyncNotice(
          `Sync completed for ${repo.full_name}, but no pull-request discussions were found. Chat remains disabled.`
        )
      }

      setData((prev) => {
        if (!prev) return prev
        return {
          repositories: prev.repositories.map((item) =>
            item.id === repo.id
              ? {
                  ...item,
                  synced_at: new Date().toISOString(),
                  pr_count: syncedPrs,
                  repo_uuid: syncedRepoId ?? item.repo_uuid,
                }
              : item
          ),
        }
      })
    } catch (err) {
      setSyncError(getApiErrorMessage(err, 'Failed to sync repository'))
    } finally {
      setSyncing((prev) => ({ ...prev, [repo.full_name]: false }))
    }
  }

  const filteredRepos =
    data?.repositories?.filter((repo) =>
      repo.full_name.toLowerCase().includes(searchQuery.trim().toLowerCase())
    ) ?? []

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Gabarito:wght@400;500;600;700&family=Archivo:wght@400;500;600;700&display=swap');

        .repo-page {
          display: flex;
          flex-direction: column;
          gap: 16px;
          font-family: 'Gabarito', sans-serif;
        }

        .font-archivo { font-family: 'Archivo', sans-serif !important; }

        /* ── Hero header card ── */
        .repo-hero-card {
          width: 100%;
          max-width: 1440px;
          margin: 0 auto;
          background: linear-gradient(170deg, #15aeea 0%, #73cef2 100%);
          border-radius: 32px;
          overflow: hidden;
          position: relative;
          padding: 64px 64px 72px;
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 32px;
          min-height: 280px;
        }
        @media (max-width: 768px) {
          .repo-hero-card { padding: 40px 32px 48px; flex-direction: column; align-items: flex-start; min-height: auto; }
        }

        .hero-cloud-bg {
          position: absolute;
          width: 110%;
          left: -5%;
          bottom: -20%;
          opacity: 0.5;
          mix-blend-mode: screen;
          pointer-events: none;
          z-index: 1;
        }

        .repo-hero-text { position: relative; z-index: 2; }
        .repo-eyebrow {
          font-family: 'Gabarito', sans-serif;
          font-size: 14px;
          font-weight: 600;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #037BB5;
          margin-bottom: 16px;
        }
        .repo-hero-h1 {
          font-family: 'Archivo', sans-serif;
          font-weight: 600;
          font-size: clamp(40px, 5vw, 72px);
          line-height: 1.05;
          letter-spacing: -0.025em;
          background: linear-gradient(169deg, rgba(3,123,181,0.9) 20%, rgba(3,120,176,0.95) 74%);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          color: transparent;
        }

        /* ── Search ── */
        .repo-search-wrap {
          position: relative;
          z-index: 2;
          flex-shrink: 0;
        }
        .repo-search {
          display: flex;
          align-items: center;
          gap: 10px;
          background: rgba(255,255,255,0.9);
          backdrop-filter: blur(12px);
          border-radius: 9999px;
          padding: 12px 20px;
          border: none;
          min-width: 260px;
        }
        .repo-search input {
          background: transparent;
          border: none;
          outline: none;
          font-family: 'Archivo', sans-serif;
          font-size: 15px;
          color: #181D1F;
          width: 100%;
        }
        .repo-search input::placeholder { color: rgba(24,29,31,0.4); }

        /* ── Notices ── */
        .repo-notice {
          width: 100%;
          max-width: 1440px;
          margin: 0 auto;
          border-radius: 20px;
          padding: 16px 24px;
          font-family: 'Archivo', sans-serif;
          font-size: 15px;
          line-height: 1.5;
        }
        .repo-notice.error { background: #FDE8E3; color: #9B3A26; border: 1px solid rgba(155,58,38,0.12); }
        .repo-notice.info { background: #E4EED2; color: #2D4A1A; border: 1px solid rgba(45,74,26,0.12); }

        /* ── Grid ── */
        .repo-grid {
          width: 100%;
          max-width: 1440px;
          margin: 0 auto;
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
        }
        @media (max-width: 1200px) { .repo-grid { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 768px) { .repo-grid { grid-template-columns: 1fr; } }

        /* ── Repo card ── */
        .repo-card {
          border-radius: 28px;
          overflow: hidden;
          padding: 32px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          min-height: 280px;
          cursor: default;
          transition: transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.22s ease;
        }
        .repo-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 16px 40px rgba(24,29,31,0.1);
        }

        .repo-card-top { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 20px; }

        .repo-icon-wrap {
          width: 44px; height: 44px;
          background: rgba(24,29,31,0.1);
          border-radius: 14px;
          display: flex; align-items: center; justify-content: center;
        }

        .repo-badge {
          font-family: 'Gabarito', sans-serif;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: rgba(24,29,31,0.5);
          border: 1px solid rgba(24,29,31,0.18);
          border-radius: 9999px;
          padding: 4px 12px;
        }
        .repo-badge.synced {
          color: #2D4A1A;
          border-color: rgba(45,74,26,0.25);
          background: rgba(45,74,26,0.08);
        }

        .repo-name {
          font-family: 'Archivo', sans-serif;
          font-size: 20px;
          font-weight: 600;
          color: #181D1F;
          letter-spacing: -0.01em;
          line-height: 1.2;
          margin-bottom: 6px;
          word-break: break-word;
        }
        .repo-meta {
          font-family: 'Archivo', sans-serif;
          font-size: 14px;
          color: rgba(24,29,31,0.5);
          margin-bottom: 16px;
        }

        .repo-stats { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 28px; }
        .repo-stat-pill {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          border: 1px solid rgba(24,29,31,0.14);
          border-radius: 9999px;
          padding: 5px 12px;
          font-family: 'Archivo', sans-serif;
          font-size: 13px;
          color: rgba(24,29,31,0.6);
          background: rgba(255,255,255,0.5);
        }

        /* ── Buttons ── */
        .repo-btn {
          width: 100%;
          padding: 13px 24px;
          border-radius: 9999px;
          border: none;
          cursor: pointer;
          font-family: 'Archivo', sans-serif;
          font-size: 15px;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: background 0.15s, transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
          letter-spacing: 0.01em;
        }
        .repo-btn:hover:not(:disabled) { transform: scale(1.02); }
        .repo-btn:disabled { opacity: 0.55; cursor: not-allowed; }
        .repo-btn-dark { background: #181D1F; color: #fff; }
        .repo-btn-dark:hover:not(:disabled) { background: #2d3748; }
        .repo-btn-outline {
          background: rgba(255,255,255,0.7);
          color: #181D1F;
          border: 1.5px solid rgba(24,29,31,0.2);
        }
        .repo-btn-outline:hover:not(:disabled) { background: rgba(255,255,255,0.95); }

        .repo-no-prs {
          margin-top: 10px;
          font-family: 'Archivo', sans-serif;
          font-size: 13px;
          color: rgba(24,29,31,0.5);
          line-height: 1.4;
          text-align: center;
        }

        /* ── Loading skeleton ── */
        .repo-skeleton-card {
          border-radius: 28px;
          min-height: 280px;
          background: #F4F4F5;
          position: relative;
          overflow: hidden;
        }
        .repo-skeleton-card::after {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.6) 50%, transparent 100%);
          animation: shimmer 1.4s infinite;
        }
        @keyframes shimmer {
          from { transform: translateX(-100%); }
          to { transform: translateX(100%); }
        }

        /* ── Empty state ── */
        .repo-empty {
          width: 100%;
          max-width: 1440px;
          margin: 0 auto;
          border-radius: 32px;
          background: #F4F4F5;
          padding: 80px 48px;
          text-align: center;
        }
        .repo-empty-icon {
          width: 56px; height: 56px;
          background: #E7E7E9;
          border-radius: 18px;
          display: flex; align-items: center; justify-content: center;
          margin: 0 auto 20px;
        }
        .repo-empty p {
          font-family: 'Archivo', sans-serif;
          font-size: 18px;
          color: rgba(24,29,31,0.5);
        }

        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
        }
      `}</style>

      <div className="repo-page">

        {/* ── Hero card ── */}
        <motion.div
          className="repo-hero-card"
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        >
          <img src="/src/assets/cloud.webp" alt="" className="hero-cloud-bg" />

          <div className="repo-hero-text">
            <p className="repo-eyebrow">Repository workspace</p>
            <h1 className="repo-hero-h1 font-archivo">
              Select a<br />repository.
            </h1>
          </div>

          <div className="repo-search-wrap">
            <div className="repo-search">
              <Search size={16} color="rgba(24,29,31,0.45)" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter repositories…"
                aria-label="Filter repositories"
              />
            </div>
          </div>
        </motion.div>

        {/* ── Notices ── */}
        <AnimatePresence>
          {syncError && (
            <motion.div
              key="error"
              className="repo-notice error font-archivo"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
              {syncError}
            </motion.div>
          )}
          {syncNotice && (
            <motion.div
              key="notice"
              className="repo-notice info font-archivo"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
              {syncNotice}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Loading ── */}
        {loading && (
          <div className="repo-grid" aria-busy="true" aria-label="Loading repositories">
            {[...Array(6)].map((_, i) => (
              <motion.div
                key={i}
                className="repo-skeleton-card"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.05 }}
              />
            ))}
          </div>
        )}

        {/* ── Error ── */}
        {error && (
          <div className="repo-empty">
            <div className="repo-empty-icon">
              <FolderGit2 size={24} color="rgba(24,29,31,0.4)" />
            </div>
            <p className="font-archivo">Unable to load repositories. {error.message}</p>
          </div>
        )}

        {/* ── Repository grid ── */}
        {!loading && !error && (
          <>
            {filteredRepos.length > 0 ? (
              <section className="repo-grid" aria-label="Repositories">
                {filteredRepos.map((repo, index) => {
                  const synced = Boolean(repo.synced_at)
                  const hasNoPrHistory = synced && (repo.pr_count ?? 0) === 0
                  const isSyncing = Boolean(syncing[repo.full_name])
                  const resolvedRepoId = syncedRepoIds[repo.full_name] ?? repo.repo_uuid ?? null
                  const canOpenChat = Boolean(resolvedRepoId) && !hasNoPrHistory
                  const cardColor = CARD_COLORS[index % CARD_COLORS.length]

                  return (
                    <motion.article
                      key={repo.id}
                      className="repo-card"
                      style={{ background: cardColor }}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        type: 'spring',
                        stiffness: 200,
                        damping: 26,
                        delay: index * 0.06,
                      }}
                    >
                      <div>
                        <div className="repo-card-top">
                          <div className="repo-icon-wrap">
                            <FolderGit2 size={20} color="#181D1F" strokeWidth={1.5} />
                          </div>
                          <span className={`repo-badge${synced ? ' synced' : ''}`}>
                            {synced ? 'Synced' : repo.private ? 'Private' : 'Public'}
                          </span>
                        </div>

                        <p className="repo-name font-archivo">{repo.full_name}</p>
                        <p className="repo-meta font-archivo">Default branch: {repo.default_branch}</p>

                        <div className="repo-stats">
                          <span className="repo-stat-pill font-archivo">
                            <GitPullRequest size={12} />
                            {(repo.pr_count ?? 0).toString()} PRs
                          </span>
                          {!synced && (
                            <span className="repo-stat-pill font-archivo">Not synced</span>
                          )}
                          {synced && !repo.private && (
                            <span className="repo-stat-pill font-archivo">Public</span>
                          )}
                        </div>
                      </div>

                      <div>
                        <button
                          onClick={() => {
                            if (canOpenChat) {
                              navigate(`/dashboard?repoId=${resolvedRepoId}`)
                              return
                            }
                            handleSync(repo)
                          }}
                          disabled={isSyncing}
                          className={`repo-btn font-archivo ${canOpenChat ? 'repo-btn-dark' : 'repo-btn-outline'}`}
                        >
                          {isSyncing ? (
                            <>
                              <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} />
                              Syncing…
                            </>
                          ) : canOpenChat ? (
                            <>
                              Open Chat
                              <ArrowRight size={14} />
                            </>
                          ) : synced ? (
                            <>
                              Resync
                              <RefreshCw size={14} />
                            </>
                          ) : (
                            <>
                              Analyze PRs
                              <ArrowRight size={14} />
                            </>
                          )}
                        </button>

                        {hasNoPrHistory && (
                          <p className="repo-no-prs font-archivo">
                            No PR discussions found — chat stays unavailable.
                          </p>
                        )}
                      </div>
                    </motion.article>
                  )
                })}
              </section>
            ) : (
              <motion.div
                className="repo-empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4 }}
              >
                <div className="repo-empty-icon">
                  <Search size={24} color="rgba(24,29,31,0.4)" />
                </div>
                <p className="font-archivo">No repositories match your filter.</p>
              </motion.div>
            )}
          </>
        )}

        <style>{`
          @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        `}</style>
      </div>
    </>
  )
}