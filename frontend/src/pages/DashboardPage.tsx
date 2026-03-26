import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'

// ─── Typewriter hook ──────────────────────────────────────────────────────────
// Streams text character-by-character, mimicking ChatGPT / Claude / Gemini.
// Speed is adaptive: fast at start, settles to ~18ms/char for natural pacing.

function useTypewriter(text: string, active: boolean, onTick?: () => void) {
  const [displayed, setDisplayed] = useState(active ? '' : text)
  const indexRef = useRef(active ? 0 : text.length)
  const rafRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!active) { setDisplayed(text); indexRef.current = text.length; return }
    indexRef.current = 0
    setDisplayed('')

    const tick = () => {
      if (indexRef.current >= text.length) return
      // Chunk 1-3 chars per frame so very long messages don't drag
      const chunkSize = indexRef.current < 60 ? 1 : 2
      indexRef.current = Math.min(indexRef.current + chunkSize, text.length)
      setDisplayed(text.slice(0, indexRef.current))
      onTick?.()
      rafRef.current = setTimeout(tick, indexRef.current < 60 ? 14 : 10)
    }

    rafRef.current = setTimeout(tick, 60) // small initial delay feels natural
    return () => { if (rafRef.current) clearTimeout(rafRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, active])

  return displayed
}

// ─── Streaming text bubble ────────────────────────────────────────────────────

function StreamingText({ content, active, onTick }: { content: string; active: boolean; onTick?: () => void }) {
  const displayed = useTypewriter(content, active, onTick)
  return (
    <>
      {displayed}
      {active && displayed.length < content.length && (
        <span style={{ display: 'inline-block', width: 2, height: '1em', background: '#181D1F', marginLeft: 2, verticalAlign: 'text-bottom', animation: 'kavi-cursor-blink 0.8s step-end infinite' }} />
      )}
    </>
  )
}
import { AnimatePresence, motion } from 'framer-motion'
import { Link, useSearchParams } from 'react-router-dom'
import {
  AlertCircle,
  ArrowRight,
  Compass,
  File,
  FolderGit2,
  GitPullRequest,
  Loader2,
  Send,
  X,
  type LucideIcon,
} from 'lucide-react'

import { useAuth } from '../features/auth/useAuth'
import { useAsync } from '../hooks/useAsync'
import { useApiClient } from '../services/apiClient'
import { ChatMode, queryChat } from '../services/chatService'
import { getRepositoryStatus } from '../services/githubService'
import { listKnowledgeEntries, listKnowledgeFiles } from '../services/knowledgeService'

// ─── Types ────────────────────────────────────────────────────────────────────

interface StructuredSection { heading: string; bullets: string[] }
interface CodeReference { file_path: string; start_line?: number | null; end_line?: number | null; pr_number?: number | null; note?: string }
interface TimelineHighlight { label: string; detail: string }
interface StructuredAnswer { title?: string; summary?: string; sections?: StructuredSection[]; code_references?: CodeReference[]; timeline_highlights?: TimelineHighlight[]; limitations?: string[] }
interface ChatEntry { role: 'user' | 'assistant'; content: string; structured?: StructuredAnswer | null }
interface ChatSource { [key: string]: unknown }
interface ChatQueryResponse { answer?: string; answer_structured?: StructuredAnswer | null; sources?: ChatSource[]; context?: ChatSource[]; mode?: ChatMode }
interface WorkspaceRenderProps { repoId: string; repositoryName: string; messages: ChatEntry[]; chatLoading: boolean; chatInput: string; setChatInput: (v: string) => void; chatSources: ChatSource[]; entries: any[]; files: any[]; entriesLoading: boolean; entriesError: Error | null; filesLoading: boolean; filesError: Error | null; noPrContext: boolean; onSend: (input: string) => void; messagesEndRef: RefObject<HTMLDivElement>; streamingIndex: number | null }
interface WorkspaceOverlayProps { repoId: string; repositoryName: string; entries: any[]; files: any[]; chatSources: ChatSource[]; entriesLoading: boolean; entriesError: Error | null; filesLoading: boolean; filesError: Error | null; onNavigate?: () => void }
interface DashboardChatPaneProps { messages: ChatEntry[]; chatLoading: boolean; chatInput: string; setChatInput: (v: string) => void; noPrContext: boolean; onSend: (input: string) => void; messagesEndRef: RefObject<HTMLDivElement>; streamingIndex: number | null }

type WorkspacePanelId = 'repository' | 'focus' | 'prs' | 'files'

// ─── Constants ────────────────────────────────────────────────────────────────

const ACTIVE_REPO_STORAGE_KEY = 'kavi.activeRepoId'
const CHAT_STORAGE_PREFIX = 'kavi.chat.'
const DEFAULT_ASSISTANT_MESSAGE = 'I am ready. Ask about architecture decisions, PR intent, file evolution, or use "Explain Entire Repo".'
const QUICK_PROMPTS = ['Explain Entire Repo', 'Explain the main architecture', 'What are the most recent PRs doing?', 'Which files changed for auth?']
const WORKSPACE_PANEL_ITEMS: { id: WorkspacePanelId; label: string; icon: LucideIcon }[] = [
  { id: 'repository', label: 'Repository', icon: FolderGit2 },
  { id: 'focus', label: 'Focus', icon: Compass },
  { id: 'prs', label: 'PRs', icon: GitPullRequest },
  { id: 'files', label: 'Files', icon: File },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function defaultMessages(name?: string | null): ChatEntry[] {
  const safeName = typeof name === 'string' && name.trim() ? name.trim() : null
  const greeting = safeName ? `Welcome, ${safeName}.` : 'Welcome.'
  return [{ role: 'assistant', content: `${greeting} ${DEFAULT_ASSISTANT_MESSAGE}` }]
}

function resolveUserDisplayName(user: unknown): string | null {
  if (!user || typeof user !== 'object') return null
  const record = user as Record<string, unknown>
  const rawName = record.name ?? record.nickname
  if (typeof rawName === 'string' && rawName.trim()) return rawName.trim()
  const rawEmail = record.email
  if (typeof rawEmail === 'string' && rawEmail.includes('@')) return rawEmail.split('@')[0]
  return null
}

function getChatStorageKey(userSub: string | null, repoId: string | null): string | null {
  if (!userSub || !repoId) return null
  return `${CHAT_STORAGE_PREFIX}${userSub}.${repoId}`
}

function readStoredRepoId(): string | null {
  if (typeof window === 'undefined') return null
  try { return window.localStorage.getItem(ACTIVE_REPO_STORAGE_KEY) } catch { return null }
}

function splitFilePath(path: string) {
  const normalized = String(path || '').replace(/\\/g, '/')
  const segments = normalized.split('/').filter(Boolean)
  const fileName = segments.length ? segments[segments.length - 1] : normalized
  const directory = segments.length > 1 ? segments.slice(0, -1).join('/') : ''
  return { fileName, directory }
}

function lineLabel(startLine?: number | null, endLine?: number | null) {
  if (startLine && endLine) return `L${startLine}-${endLine}`
  if (startLine) return `L${startLine}`
  return 'Line n/a'
}

function resolveChatMode(input: string): ChatMode {
  const value = input.trim().toLowerCase()
  const overviewPhrases = ['explain entire repo', 'explain the entire repo', 'repo overview', 'project overview', 'whole repo', 'full repository']
  if (overviewPhrases.some((p) => value.includes(p))) return 'repo_overview'
  if (value.includes('entire repo') || value.includes('whole repo')) return 'repo_overview'
  return 'default'
}

// ─── Structured answer renderer ───────────────────────────────────────────────

function StructuredAssistantBody({ content, structured }: { content: string; structured: StructuredAnswer }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <p style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(24,29,31,0.45)', marginBottom: 6 }}>
          {structured.title ?? 'Answer'}
        </p>
        <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 14, lineHeight: 1.6, color: '#181D1F', whiteSpace: 'pre-wrap' }}>
          {structured.summary || content}
        </p>
      </div>

      {Array.isArray(structured.sections) && structured.sections.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {structured.sections.slice(0, 6).map((section, i) => (
            <div key={`${section.heading}-${i}`} style={{ borderRadius: 14, border: '1px solid #E7E7E9', background: '#F9F9FA', padding: '12px 14px' }}>
              <p style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', color: 'rgba(24,29,31,0.55)', textTransform: 'uppercase', marginBottom: 6 }}>{section.heading}</p>
              <ul style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {section.bullets.slice(0, 5).map((bullet, bi) => (
                  <li key={bi} style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, lineHeight: 1.5, color: '#424647' }}>— {bullet}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {Array.isArray(structured.code_references) && structured.code_references.length > 0 && (
        <div>
          <p style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(24,29,31,0.45)', marginBottom: 8 }}>Code References</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {structured.code_references.slice(0, 6).map((ref, i) => (
              <div key={`${ref.file_path}-${i}`} style={{ borderRadius: 12, border: '1px solid #E7E7E9', background: '#F9F9FA', padding: '10px 12px' }}>
                <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 12, fontWeight: 600, color: '#181D1F', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{splitFilePath(ref.file_path).fileName}</p>
                <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 11, color: 'rgba(24,29,31,0.5)', border: '1px solid #E7E7E9', borderRadius: 9999, padding: '2px 8px' }}>{lineLabel(ref.start_line, ref.end_line)}</span>
                  {ref.pr_number && <span style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 11, color: 'rgba(24,29,31,0.5)', border: '1px solid #E7E7E9', borderRadius: 9999, padding: '2px 8px' }}>PR #{ref.pr_number}</span>}
                </div>
                {ref.note && <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 12, color: '#424647', marginTop: 6 }}>{ref.note}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {Array.isArray(structured.timeline_highlights) && structured.timeline_highlights.length > 0 && (
        <div>
          <p style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(24,29,31,0.45)', marginBottom: 8 }}>Evolution Highlights</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {structured.timeline_highlights.slice(0, 5).map((item, i) => (
              <p key={`${item.label}-${i}`} style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, lineHeight: 1.5, color: '#424647' }}>
                <span style={{ fontWeight: 600, color: '#181D1F' }}>{item.label}:</span> {item.detail}
              </p>
            ))}
          </div>
        </div>
      )}

      {Array.isArray(structured.limitations) && structured.limitations.length > 0 && (
        <div style={{ borderRadius: 14, border: '1px solid #E7E7E9', background: '#F9F9FA', padding: '12px 14px' }}>
          <p style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(24,29,31,0.45)', marginBottom: 6 }}>Limits</p>
          <ul style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {structured.limitations.slice(0, 4).map((item, i) => (
              <li key={i} style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, color: '#424647' }}>— {item}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ─── Icon rail ────────────────────────────────────────────────────────────────

function WorkspaceIconRail({ activePanel, onToggle }: { activePanel: WorkspacePanelId | null; onToggle: (panel: WorkspacePanelId) => void }) {
  return (
    <aside style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '12px 8px', background: '#F4F4F5', borderRadius: 24, border: '1px solid #E7E7E9' }}>
      {WORKSPACE_PANEL_ITEMS.map((item) => {
        const Icon = item.icon
        const active = activePanel === item.id
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onToggle(item.id)}
            title={item.label}
            aria-label={item.label}
            style={{
              width: 40, height: 40,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 14,
              border: active ? 'none' : '1px solid #E7E7E9',
              background: active ? '#181D1F' : '#fff',
              color: active ? '#fff' : 'rgba(24,29,31,0.6)',
              cursor: 'pointer',
              transition: 'all 0.18s cubic-bezier(0.34,1.56,0.64,1)',
            }}
          >
            <Icon size={16} />
          </button>
        )
      })}
    </aside>
  )
}

// ─── Overlay panel content ────────────────────────────────────────────────────

function WorkspaceOverlayPanel({ panel, repoId, repositoryName, entries, files, chatSources, entriesLoading, entriesError, filesLoading, filesError, onNavigate }: WorkspaceOverlayProps & { panel: WorkspacePanelId }) {
  const referencedEntries = (entries.length ? entries : (chatSources as any[])).slice(0, 7)
  const shortRepo = repositoryName.includes('/') ? repositoryName.split('/').pop() ?? repositoryName : repositoryName

  const pillStyle: React.CSSProperties = { fontFamily: "'Gabarito', sans-serif", fontSize: 11, border: '1px solid #E7E7E9', borderRadius: 9999, padding: '3px 10px', color: 'rgba(24,29,31,0.55)', background: '#fff' }
  const cardStyle: React.CSSProperties = { borderRadius: 16, border: '1px solid #E7E7E9', background: '#F9F9FA', padding: '12px 14px', marginBottom: 8 }
  const labelStyle: React.CSSProperties = { fontFamily: "'Gabarito', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: 'rgba(24,29,31,0.4)', marginBottom: 10 }

  if (panel === 'repository') return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={cardStyle}>
        <p style={labelStyle}>Repository</p>
        <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 15, fontWeight: 600, color: '#181D1F', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortRepo}</p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {[['PR Contexts', entries.length], ['Indexed Files', files.length]].map(([label, value]) => (
          <div key={label as string} style={{ borderRadius: 14, border: '1px solid #E7E7E9', background: '#F9F9FA', padding: '10px 14px' }}>
            <p style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 11, color: 'rgba(24,29,31,0.5)', marginBottom: 4 }}>{label}</p>
            <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 20, fontWeight: 600, color: '#181D1F' }}>{value}</p>
          </div>
        ))}
      </div>
      <Link to={`/timeline?repoId=${repoId}`} onClick={onNavigate} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '11px 20px', background: '#181D1F', color: '#fff', borderRadius: 9999, border: 'none', fontFamily: "'Archivo', sans-serif", fontSize: 13, fontWeight: 600, textDecoration: 'none', cursor: 'pointer' }}>
        Project timeline <ArrowRight size={13} />
      </Link>
      <Link to="/repositories" onClick={onNavigate} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '11px 20px', background: '#F4F4F5', color: '#181D1F', borderRadius: 9999, border: '1px solid #E7E7E9', fontFamily: "'Archivo', sans-serif", fontSize: 13, fontWeight: 600, textDecoration: 'none', cursor: 'pointer' }}>
        Switch repository <FolderGit2 size={13} />
      </Link>
    </section>
  )

  if (panel === 'focus') return (
    <section style={cardStyle}>
      <p style={labelStyle}>Workspace Focus</p>
      <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, lineHeight: 1.6, color: '#424647', marginBottom: 8 }}>Ask architecture-level questions and trace PR evolution quickly.</p>
      <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, lineHeight: 1.6, color: '#424647', marginBottom: 8 }}>Use concise prompts to get cleaner structured responses.</p>
      <p style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 12, color: 'rgba(24,29,31,0.45)' }}>Tip: start with "Explain Entire Repo" for baseline context.</p>
    </section>
  )

  if (panel === 'prs') return (
    <section>
      <p style={labelStyle}>Referenced PRs</p>
      {entriesLoading ? (
        <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, color: 'rgba(24,29,31,0.5)' }}>Loading pull requests…</p>
      ) : entriesError ? (
        <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, color: '#9B3A26', display: 'flex', alignItems: 'center', gap: 4 }}><AlertCircle size={12} /> Unable to load PR context.</p>
      ) : referencedEntries.length ? referencedEntries.map((entry: any, i: number) => {
        const prNumber = entry?.pr_number ?? entry?.github_pr_number ?? entry?.pr ?? '?'
        const title = entry?.pr_title ?? entry?.title ?? 'Untitled pull request'
        const summary = entry?.intent ?? entry?.summary ?? entry?.excerpt ?? 'No summary available.'
        return (
          <div key={`${title}-${i}`} style={cardStyle}>
            <p style={{ ...pillStyle, display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 6 }}><GitPullRequest size={11} /> PR #{prNumber}</p>
            <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, fontWeight: 600, color: '#181D1F', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</p>
            <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 12, color: '#424647', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{summary}</p>
          </div>
        )
      }) : <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, color: 'rgba(24,29,31,0.5)' }}>No PR context available yet.</p>}
    </section>
  )

  return (
    <section>
      <p style={labelStyle}>Indexed Files</p>
      {filesLoading ? (
        <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, color: 'rgba(24,29,31,0.5)' }}>Loading files…</p>
      ) : filesError ? (
        <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, color: '#9B3A26', display: 'flex', alignItems: 'center', gap: 4 }}><AlertCircle size={12} /> Unable to load files.</p>
      ) : files.length ? files.slice(0, 14).map((file: any) => {
        const { fileName, directory } = splitFilePath(file.file_path)
        return (
          <Link key={file.file_path} to={`/file?repoId=${repoId}&path=${encodeURIComponent(file.file_path)}`} onClick={onNavigate} style={{ display: 'block', ...cardStyle, textDecoration: 'none' }}>
            <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, fontWeight: 600, color: '#181D1F', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fileName}</p>
            <p style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 12, color: 'rgba(24,29,31,0.45)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{directory || '(repository root)'}</p>
          </Link>
        )
      }) : <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, color: 'rgba(24,29,31,0.5)' }}>No files indexed.</p>}
    </section>
  )
}

// ─── Chat pane ────────────────────────────────────────────────────────────────

function DashboardChatPane({ messages, chatLoading, chatInput, setChatInput, noPrContext, onSend, messagesEndRef, streamingIndex }: DashboardChatPaneProps) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: '#F4F4F5', borderRadius: 24, border: '1px solid #E7E7E9', overflow: 'hidden' }}>
      {/* Messages */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 20px 8px', display: 'flex', flexDirection: 'column', gap: 12, scrollbarWidth: 'none' }}>

        {noPrContext && (
          <div style={{ borderRadius: 16, border: '1px solid #E7E7E9', background: '#fff', padding: '14px 18px' }}>
            <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 14, fontWeight: 600, color: '#181D1F', marginBottom: 4 }}>No pull-request discussions found yet.</p>
            <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, color: '#424647', lineHeight: 1.5 }}>You can still query the repository. Answers will improve as richer PR context is indexed.</p>
          </div>
        )}

        {messages.map((message, index) => {
          const isStreaming = message.role === 'assistant' && index === streamingIndex
          return (
            <motion.article
              key={`${message.role}-${index}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 220, damping: 26 }}
              style={{ display: 'flex', justifyContent: message.role === 'user' ? 'flex-end' : 'flex-start' }}
            >
              <div style={{
                maxWidth: message.role === 'user' ? 'min(75%, 560px)' : 'min(88%, 760px)',
                borderRadius: message.role === 'user' ? '20px 20px 6px 20px' : '20px 20px 20px 6px',
                padding: '12px 16px',
                fontFamily: "'Archivo', sans-serif",
                fontSize: 14,
                lineHeight: 1.6,
                ...(message.role === 'user'
                  ? { background: '#181D1F', color: '#fff', boxShadow: '0 4px 16px rgba(24,29,31,0.18)' }
                  : { background: '#fff', color: '#181D1F', border: '1px solid #E7E7E9', boxShadow: '0 2px 8px rgba(24,29,31,0.06)' }
                ),
              }}>
                {message.role === 'assistant' && message.structured
                  ? <StructuredAssistantBody content={message.content} structured={message.structured} />
                  : message.role === 'assistant'
                    ? <StreamingText content={message.content} active={isStreaming} onTick={() => messagesEndRef.current?.scrollIntoView({ block: 'end' })} />
                    : message.content}
              </div>
            </motion.article>
          )
        })}

        {chatLoading && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid #E7E7E9', borderRadius: 9999, padding: '8px 14px', fontFamily: "'Gabarito', sans-serif", fontSize: 13, color: 'rgba(24,29,31,0.55)', width: 'fit-content' }}>
            <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
            Thinking…
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick prompts + input */}
      <div style={{ padding: '8px 16px 14px', flexShrink: 0 }}>
        {/* Quick prompts */}
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, scrollbarWidth: 'none' }}>
          {QUICK_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              onClick={() => onSend(prompt)}
              style={{ flexShrink: 0, whiteSpace: 'nowrap', padding: '7px 14px', background: '#fff', border: '1px solid #E7E7E9', borderRadius: 9999, fontFamily: "'Archivo', sans-serif", fontSize: 13, fontWeight: 500, color: '#424647', cursor: 'pointer', transition: 'all 0.15s' }}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.background = '#181D1F'; (e.target as HTMLElement).style.color = '#fff'; (e.target as HTMLElement).style.borderColor = '#181D1F' }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.background = '#fff'; (e.target as HTMLElement).style.color = '#424647'; (e.target as HTMLElement).style.borderColor = '#E7E7E9' }}
            >
              {prompt}
            </button>
          ))}
        </div>

        {/* Input bar */}
        <div
          style={{ display: 'flex', alignItems: 'flex-end', gap: 10, background: '#fff', border: '1.5px solid #E7E7E9', borderRadius: 20, padding: '10px 10px 10px 16px', boxShadow: '0 2px 8px rgba(24,29,31,0.06)', transition: 'border-color 0.15s' }}
          onFocusCapture={(e) => (e.currentTarget.style.borderColor = '#181D1F')}
          onBlurCapture={(e) => (e.currentTarget.style.borderColor = '#E7E7E9')}
        >
          <textarea
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(chatInput) } }}
            rows={1}
            disabled={chatLoading}
            placeholder="Ask about architecture, PR evolution, or type 'Explain Entire Repo'…"
            style={{ flex: 1, resize: 'none', border: 'none', outline: 'none', boxShadow: 'none', fontFamily: "'Archivo', sans-serif", fontSize: 14, color: '#181D1F', background: 'transparent', minHeight: 24, maxHeight: 120, lineHeight: 1.5, padding: 0 }}
          />
          <button
            type="button"
            onClick={() => onSend(chatInput)}
            disabled={chatLoading || !chatInput.trim()}
            style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 12, background: '#181D1F', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', opacity: (!chatInput.trim() || chatLoading) ? 0.4 : 1, transition: 'opacity 0.15s' }}
          >
            <Send size={15} color="#fff" />
          </button>
        </div>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } } @keyframes kavi-cursor-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } } textarea:focus { outline: none !important; box-shadow: none !important; }`}</style>
    </section>
  )
}

// ─── Workspace layout ─────────────────────────────────────────────────────────

function DashboardWorkspaceV2(props: WorkspaceRenderProps) {
  const [activePanel, setActivePanel] = useState<WorkspacePanelId | null>(null)

  useEffect(() => {
    if (!activePanel) return
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setActivePanel(null) }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activePanel])

  const closePanel = () => setActivePanel(null)
  const handlePanelToggle = (panel: WorkspacePanelId) => setActivePanel((c) => (c === panel ? null : panel))

  return (
    <div style={{ position: 'fixed', inset: '90px 16px 16px', zIndex: 20 }}>
      <div style={{ position: 'relative', height: '100%', maxWidth: 1440, margin: '0 auto' }}>
        {/* Main layout: icon rail + chat */}
        <div style={{ display: 'grid', gridTemplateColumns: '54px minmax(0,1fr)', gap: 12, height: '100%', minHeight: 0 }}>
          <WorkspaceIconRail activePanel={activePanel} onToggle={handlePanelToggle} />
          <DashboardChatPane
            messages={props.messages}
            chatLoading={props.chatLoading}
            chatInput={props.chatInput}
            setChatInput={props.setChatInput}
            noPrContext={props.noPrContext}
            onSend={props.onSend}
            messagesEndRef={props.messagesEndRef}
            streamingIndex={props.streamingIndex}
          />
        </div>

        {/* Slide-over panel */}
        <AnimatePresence>
          {activePanel && (
            <>
              <motion.button
                key="backdrop"
                type="button"
                aria-label="Close panel"
                onClick={closePanel}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                style={{ position: 'absolute', inset: 0, zIndex: 28, background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(4px)', border: 'none', cursor: 'pointer' }}
              />
              <motion.aside
                key={`panel-${activePanel}`}
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ type: 'spring', stiffness: 300, damping: 34, mass: 0.78 }}
                style={{
                  position: 'absolute', insetBlock: 0, left: 62,
                  width: 'min(400px, calc(100% - 70px))',
                  zIndex: 36,
                  background: '#fff',
                  borderRadius: 24,
                  border: '1px solid #E7E7E9',
                  boxShadow: '0 24px 48px rgba(24,29,31,0.12)',
                  padding: 16,
                  overflowY: 'auto',
                  scrollbarWidth: 'none',
                }}
              >
                {/* Panel header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 15, fontWeight: 600, color: '#181D1F' }}>
                    {WORKSPACE_PANEL_ITEMS.find((i) => i.id === activePanel)?.label ?? 'Workspace'}
                  </p>
                  <button
                    type="button"
                    onClick={closePanel}
                    style={{ width: 30, height: 30, borderRadius: 9999, border: '1px solid #E7E7E9', background: '#F4F4F5', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#181D1F' }}
                  >
                    <X size={14} />
                  </button>
                </div>

                <WorkspaceOverlayPanel
                  panel={activePanel}
                  repoId={props.repoId}
                  repositoryName={props.repositoryName}
                  entries={props.entries}
                  files={props.files}
                  chatSources={props.chatSources}
                  entriesLoading={props.entriesLoading}
                  entriesError={props.entriesError}
                  filesLoading={props.filesLoading}
                  filesError={props.filesError}
                  onNavigate={closePanel}
                />
              </motion.aside>
            </>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function DashboardPage() {
  const api = useApiClient()
  const { user } = useAuth()
  const [searchParams] = useSearchParams()
  const queryRepoId = searchParams.get('repoId')
  const [storedRepoId, setStoredRepoId] = useState<string | null>(() => readStoredRepoId())
  const repoId = queryRepoId || storedRepoId
  const userSub = typeof user?.sub === 'string' ? user.sub : null
  const welcomeName = useMemo(() => resolveUserDisplayName(user), [user])
  const chatStorageKey = useMemo(() => getChatStorageKey(userSub, repoId), [userSub, repoId])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const hasInitialPositionedRef = useRef(false)

  const { data: filesData, error: filesError, loading: filesLoading } = useAsync(() => (repoId ? listKnowledgeFiles(api, repoId) : Promise.resolve(null)), [api, repoId])
  const { data: entriesData, error: entriesError, loading: entriesLoading } = useAsync(() => (repoId ? listKnowledgeEntries(api, repoId) : Promise.resolve(null)), [api, repoId])
  const { data: repositoryStatus } = useAsync(() => (repoId ? getRepositoryStatus(api, repoId) : Promise.resolve(null)), [api, repoId])

  const [messages, setMessages] = useState<ChatEntry[]>(() => defaultMessages(welcomeName))
  const [chatLoading, setChatLoading] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [chatSources, setChatSources] = useState<ChatSource[]>([])
  const [chatHydrated, setChatHydrated] = useState(false)
  const [streamingIndex, setStreamingIndex] = useState<number | null>(null)

  const scrollToLatestMessage = useCallback((behavior: ScrollBehavior = 'smooth') => {
    requestAnimationFrame(() => { messagesEndRef.current?.scrollIntoView({ behavior, block: 'end' }) })
  }, [])

  useEffect(() => {
    if (!queryRepoId) return
    setStoredRepoId(queryRepoId)
    try { window.localStorage.setItem(ACTIVE_REPO_STORAGE_KEY, queryRepoId) } catch {}
  }, [queryRepoId])

  useEffect(() => {
    setChatHydrated(false)
    hasInitialPositionedRef.current = false
    if (!chatStorageKey) { setMessages(defaultMessages(welcomeName)); setChatSources([]); setChatHydrated(true); return }
    try {
      const raw = window.localStorage.getItem(chatStorageKey)
      if (!raw) { setMessages(defaultMessages(welcomeName)); setChatSources([]); setChatHydrated(true); return }
      const parsed = JSON.parse(raw) as { messages?: unknown; chatSources?: unknown }
      const persistedMessages = Array.isArray(parsed.messages)
        ? parsed.messages.filter((item): item is ChatEntry => Boolean(item) && typeof item === 'object' && (item as ChatEntry).role !== undefined && ((item as ChatEntry).role === 'assistant' || (item as ChatEntry).role === 'user') && typeof (item as ChatEntry).content === 'string')
            .map((item) => ({ role: item.role, content: item.content, structured: item.structured && typeof item.structured === 'object' ? (item.structured as StructuredAnswer) : undefined }))
        : []
      const persistedSources = Array.isArray(parsed.chatSources) ? parsed.chatSources : []
      setMessages(persistedMessages.length ? persistedMessages : defaultMessages(welcomeName))
      setChatSources(persistedSources as ChatSource[])
    } catch { setMessages(defaultMessages(welcomeName)); setChatSources([]) }
    finally { setChatHydrated(true) }
  }, [chatStorageKey, welcomeName])

  useEffect(() => {
    if (!chatStorageKey || !chatHydrated) return
    try { window.localStorage.setItem(chatStorageKey, JSON.stringify({ messages, chatSources, updatedAt: new Date().toISOString() })) } catch {}
  }, [chatStorageKey, chatHydrated, messages, chatSources])

  useEffect(() => {
    if (!chatHydrated || hasInitialPositionedRef.current) return
    hasInitialPositionedRef.current = true
    scrollToLatestMessage('auto')
  }, [chatHydrated, scrollToLatestMessage])

  const files = useMemo(() => filesData?.files ?? [], [filesData])
  const entries = useMemo(() => entriesData?.entries ?? [], [entriesData])
  const repositoryName = useMemo(() => { const fn = repositoryStatus?.repository?.full_name; return typeof fn === 'string' && fn.trim() ? fn : 'Selected repository' }, [repositoryStatus])
  const noPrContext = !filesLoading && !entriesLoading && !filesError && !entriesError && entries.length === 0 && files.length === 0

  const handleSend = async (input: string) => {
    if (!repoId || !input.trim()) return
    const trimmed = input.trim()
    const mode = resolveChatMode(trimmed)
    setMessages((prev) => [...prev, { role: 'user', content: trimmed }])
    setChatInput('')
    setChatLoading(true)
    scrollToLatestMessage('smooth')
    try {
      const data = (await queryChat(api, repoId, trimmed, mode)) as ChatQueryResponse
      const newAssistantMsg: ChatEntry = {
        role: 'assistant',
        content: data.answer || "I couldn't generate an answer.",
        structured: data.answer_structured || null,
      }
      setMessages((prev) => {
        const next = [...prev, newAssistantMsg]
        // Set streaming index to the last message (the one we just added)
        setStreamingIndex(next.length - 1)
        return next
      })
      if (Array.isArray(data.sources)) setChatSources(data.sources)
      else if (Array.isArray(data.context)) setChatSources(data.context)
      else setChatSources([])
      scrollToLatestMessage('smooth')
    } catch {
      setMessages((prev) => {
        const next = [...prev, { role: 'assistant' as const, content: 'An error occurred while processing your query.' }]
        setStreamingIndex(next.length - 1)
        return next
      })
      scrollToLatestMessage('smooth')
    } finally { setChatLoading(false) }
  }

  if (!repoId) {
    return (
      <div style={{ borderRadius: 32, background: '#F4F4F5', border: '1px solid #E7E7E9', padding: '64px 48px', textAlign: 'center' }}>
        <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 22, fontWeight: 600, color: '#181D1F', marginBottom: 8 }}>No repository selected</p>
        <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 15, color: '#424647', marginBottom: 28 }}>Pick a synced repository before opening chat.</p>
        <Link to="/repositories" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 24px', background: '#181D1F', color: '#fff', borderRadius: 9999, fontFamily: "'Archivo', sans-serif", fontSize: 15, fontWeight: 600, textDecoration: 'none' }}>
          Open repositories <ArrowRight size={15} />
        </Link>
      </div>
    )
  }

  return (
    <DashboardWorkspaceV2
      repoId={repoId}
      repositoryName={repositoryName}
      messages={messages}
      chatLoading={chatLoading}
      chatInput={chatInput}
      setChatInput={setChatInput}
      chatSources={chatSources}
      entries={entries}
      files={files}
      entriesLoading={entriesLoading}
      entriesError={entriesError}
      filesLoading={filesLoading}
      filesError={filesError}
      noPrContext={noPrContext}
      onSend={handleSend}
      messagesEndRef={messagesEndRef}
      streamingIndex={streamingIndex}
    />
  )
}