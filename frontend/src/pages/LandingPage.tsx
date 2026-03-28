import { useEffect, useRef, useState, useMemo } from 'react'
import {
  ArrowRight, GitPullRequest, DatabaseZap, MessageSquareText,
  ShieldCheck, LockKeyhole, Zap,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { firebaseAuth } from '../features/auth/firebase'
import { useAuth } from '../features/auth/useAuth'
import { useAsync } from '../hooks/useAsync'
import { useApiClient } from '../services/apiClient'
import { getGitHubStatus } from '../services/githubService'
import cloudImg from '../assets/cloud.webp'

// ─── Data ─────────────────────────────────────────────────────────────────────

const MARQUEE_TOKENS = [
  'PR Discussions', 'Review Intent', 'Design Tradeoffs', 'File Impact',
  'Decision History', 'Architecture Context', 'Grounded Answers', 'Team Memory',
  'Merge Rationale', 'Code Ownership', 'Incident Traces', 'Author Intent',
]

const FLOW_STEPS = [
  {
    icon: <GitPullRequest size={20} strokeWidth={1.5} />,
    title: 'Connect your repositories',
    body: 'Kavi syncs pull-request discussions and metadata with read-only GitHub access. No write permissions, ever.',
  },
  {
    icon: <DatabaseZap size={20} strokeWidth={1.5} />,
    title: 'Index decision memory',
    body: 'Intent, summaries, file-level impact, and architecture context are structured and stored for instant retrieval.',
  },
  {
    icon: <MessageSquareText size={20} strokeWidth={1.5} />,
    title: 'Ask in plain language',
    body: 'Get grounded answers tied directly to pull-request history — cited, traceable, and never hallucinated.',
  },
]

const OUTCOMES = [
  {
    id: '01',
    title: 'Onboarding without guesswork',
    body: 'New engineers ask plain questions and immediately see why systems evolved through pull-request decisions.',
    tag: 'Ramp faster',
  },
  {
    id: '02',
    title: 'Review conversations stay durable',
    body: 'Intent, caveats, and tradeoffs from past PRs remain queryable long after the original authors move on.',
    tag: 'Reduce context loss',
  },
  {
    id: '03',
    title: 'Architecture decisions become discoverable',
    body: 'During planning and incident response, teams trace change rationale without manually scanning old threads.',
    tag: 'Ship with confidence',
  },
]

const TRUST = [
  {
    icon: <ShieldCheck size={22} strokeWidth={1.4} />,
    title: 'Read-only repository access',
    body: 'Kavi reads metadata and discussion context without writing into your codebase.',
  },
  {
    icon: <LockKeyhole size={22} strokeWidth={1.4} />,
    title: 'Encrypted authentication tokens',
    body: 'GitHub credentials are encrypted at rest for safer production operation.',
  },
  {
    icon: <DatabaseZap size={22} strokeWidth={1.4} />,
    title: 'Context-grounded responses',
    body: 'Responses are based on indexed PR data instead of free-form assumptions.',
  },
]

const TESTIMONIALS = [
  {
    quote: 'Saved us hours during our last incident review. Found the exact PR where the regression was introduced in under a minute.',
    author: 'Sarah',
  },
  {
    quote: 'Onboarded two engineers last month. Neither had to ping me once about why something was built the way it was.',
    author: 'Marcus',
  },
  {
    quote: 'The answers are actually grounded. It cites the PR, the author, the date. I can verify everything it tells me.',
    author: 'Priya',
  },
  {
    quote: 'Finally a tool that respects that architecture decisions live in pull-request threads, not wiki pages nobody updates.',
    author: 'Tom',
  },
]

const FAQ_ITEMS = [
  {
    q: 'How does Kavi collect context?',
    a: 'Kavi syncs pull-request discussions and metadata, then structures intent, summaries, and file-level references for fast retrieval.',
  },
  {
    q: 'Does Kavi write code or modify repositories?',
    a: 'No. Repository integration is strictly read-only. Kavi focuses on indexing context so responses stay grounded in real PR history.',
  },
  {
    q: 'What happens if a repo has no PR history?',
    a: 'Kavi can still connect the repository, but chat features stay limited until pull-request discussions are available to index.',
  },
  {
    q: 'Can teams use this for onboarding and incident review?',
    a: 'Yes. Teams use Kavi to understand why architecture changed, trace decision intent, and speed up context transfer across engineers.',
  },
  {
    q: 'Is there a free trial?',
    a: 'Every new team gets a free trial with full access. No credit card required. We send a reminder before it ends.',
  },
  {
    q: 'How long does the initial sync take?',
    a: 'Most repositories with up to 2,000 PRs are fully indexed in under 10 minutes. Larger histories may take up to an hour.',
  },
]

// ─── Word reveal hook ─────────────────────────────────────────────────────────

function useWordReveal(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const words = el.querySelectorAll<HTMLElement>('.word')
    if (!words.length) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            words.forEach((word, i) => {
              setTimeout(() => {
                word.style.opacity = '1'
                word.style.transform = 'translateY(0px)'
              }, i * 22)
            })
            observer.disconnect()
          }
        })
      },
      { threshold: 0.15 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
}

function Words({ text }: { text: string }) {
  return (
    <>
      {text.split(' ').map((word, i) => (
        <span
          key={i}
          className="word inline-block whitespace-nowrap"
          style={{
            opacity: 0,
            transform: 'translateY(12px)',
            transition: 'opacity 0.42s ease, transform 0.42s ease',
            marginRight: '0.28em',
          }}
        >
          {word}
        </span>
      ))}
    </>
  )
}

// ─── FAQ accordion ────────────────────────────────────────────────────────────

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="kfaq-item">
      <button
        type="button"
        className="kfaq-btn"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span className="kfaq-q">{q}</span>
        <span className="kfaq-icon" style={{ transform: open ? 'rotate(45deg)' : 'rotate(0deg)' }}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
            <path d="M10.625 2H9.375V9.375H2V10.625H9.375V18H10.625V10.625H18V9.375H10.625V2Z" fill="#181D1F"/>
          </svg>
        </span>
      </button>
      <div
        className="kfaq-body"
        style={{ maxHeight: open ? '200px' : '0px', opacity: open ? 1 : 0 }}
      >
        <p className="kfaq-a">{a}</p>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function LandingPage() {
  const navigate = useNavigate()
  const api = useApiClient()
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const [scrolled, setScrolled] = useState(false)
  const [isReady, setIsReady] = useState(false)
  const heroCloudRef = useRef<HTMLImageElement>(null)
  const scrolledRef = useRef(false)
  const latestScrollYRef = useRef(0)
  const scrollRafRef = useRef<number | null>(null)

  const { data: githubStatus, loading: statusLoading } = useAsync(
    () => (isAuthenticated ? getGitHubStatus(api) : Promise.resolve(null)),
    [api, isAuthenticated]
  )
  const hasGithub = Boolean(githubStatus?.connected)

  const aboutRef = useRef<HTMLDivElement>(null)
  const featRef  = useRef<HTMLDivElement>(null)
  const outRef   = useRef<HTMLDivElement>(null)
  useWordReveal(aboutRef)
  useWordReveal(featRef)
  useWordReveal(outRef)

  const scheduleScrollVisualUpdate = (scrollY: number) => {
    latestScrollYRef.current = scrollY
    if (scrollRafRef.current !== null) return
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null
      const y = latestScrollYRef.current
      const nextScrolled = y > 48
      if (nextScrolled !== scrolledRef.current) {
        scrolledRef.current = nextScrolled
        setScrolled(nextScrolled)
      }
      if (heroCloudRef.current) {
        heroCloudRef.current.style.transform = `translate3d(0, ${Math.round(y * -0.5)}px, 0)`
      }
    })
  }

  useEffect(() => {
    const timer = setTimeout(() => setIsReady(true), 300)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    let cleanup: (() => void) | undefined
    ;(async () => {
      try {
        const { default: Lenis } = await import('@studio-freight/lenis')
        const lenis = new Lenis({ lerp: 0.08, smoothWheel: true })
        document.documentElement.classList.add('lenis')
        lenis.on('scroll', (event: { scroll: number }) => {
          scheduleScrollVisualUpdate(event.scroll)
        })
        scheduleScrollVisualUpdate(window.scrollY)
        let raf: number
        const tick = (t: number) => { lenis.raf(t); raf = requestAnimationFrame(tick) }
        raf = requestAnimationFrame(tick)
        cleanup = () => { cancelAnimationFrame(raf); lenis.destroy(); document.documentElement.classList.remove('lenis') }
      } catch {
        const onScroll = () => scheduleScrollVisualUpdate(window.scrollY)
        onScroll()
        window.addEventListener('scroll', onScroll, { passive: true })
        cleanup = () => window.removeEventListener('scroll', onScroll)
      }
    })()
    return () => {
      cleanup?.()
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current)
        scrollRafRef.current = null
      }
    }
  }, [])

  const handleStart = () => {
    const hasAuthSession = Boolean(firebaseAuth.currentUser) || isAuthenticated
    if (!hasAuthSession || authLoading) {
      navigate('/login?returnTo=%2Fconnect-github')
      return
    }
    navigate(hasGithub ? '/repositories' : '/connect-github')
  }

  const scrollTo = (id: string) => {
    const el = document.getElementById(id)
    if (!el) return
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 96, behavior: 'smooth' })
  }

  const streamFwd = useMemo(() => [...MARQUEE_TOKENS, ...MARQUEE_TOKENS, ...MARQUEE_TOKENS], [])
  const streamRev = useMemo(() => [...MARQUEE_TOKENS, ...MARQUEE_TOKENS, ...MARQUEE_TOKENS], [])

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Audiowide&family=Gabarito:wght@400;500;600;700&family=Archivo:wght@400;500;600;700&display=swap');

        html.lenis, html.lenis body { height: auto; }
        .lenis.lenis-smooth { scroll-behavior: auto !important; }
        .lenis.lenis-stopped { overflow: hidden; }

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: 'Gabarito', -apple-system, BlinkMacSystemFont, sans-serif;
          background: #fff; min-height: 100vh; overflow-x: hidden;
        }
        .font-archivo { font-family: 'Archivo', -apple-system, BlinkMacSystemFont, sans-serif !important; }

        .skip-nav { position: absolute; top: auto; left: -9999px; width: 1px; height: 1px; overflow: hidden; z-index: 9999; background: #181D1F; color: #fff; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 600; text-decoration: none; }
        .skip-nav:focus { position: fixed; top: 16px; left: 16px; width: auto; height: auto; overflow: visible; }
        :focus-visible { outline: 2px solid #181D1F; outline-offset: 2px; }

        .k-header {
          position: fixed; inset-inline: 0; top: 0; z-index: 1000; padding: 24px;
          opacity: 0; transform: translateY(-20px);
          transition: opacity 0.8s ease, transform 0.8s ease;
          transition-delay: 1.2s;
        }
        .k-header.ready { opacity: 1; transform: translateY(0); }
        @media (max-width: 768px) { .k-header { padding: 12px; } }

        .k-header-inner {
          max-width: 1200px; margin: 0 auto;
          display: flex; align-items: center; justify-content: space-between;
          padding: 8px 8px 8px 12px; border-radius: 9999px;
          transition: background 0.2s, box-shadow 0.2s;
        }
        .k-header-inner.on {
          background: rgba(255,255,255,0.88);
          backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
          box-shadow: 0 4px 22px rgba(116,130,151,0.15);
        }
        .k-logo { display: flex; align-items: center; gap: 8px; text-decoration: none; z-index: 10; }
        .k-logo-mark { width: 32px; height: 32px; background: #fff; border-radius: 10px; display: flex; align-items: center; justify-content: center; transition: background 0.25s ease; }
        .k-header-inner.on .k-logo-mark { background: #181D1F; }
        .k-logo-name { font-family: 'Audiowide', sans-serif; font-size: 18px; font-weight: 600; letter-spacing: 0.06em;color: #fff; transition: color 0.25s ease;  }
        .k-header-inner.on .k-logo-name { color: #181D1F; }
        .k-nav { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 4px; pointer-events: none; }
        @media (max-width: 768px) { .k-nav { display: none; } }
        .k-nav-link { pointer-events: auto; padding: 8px 20px; border-radius: 9999px; font-family: 'Archivo', sans-serif; font-size: 18px; font-weight: 500; color: #fff; background: transparent; border: none; cursor: pointer; text-decoration: none; transition: background 0.15s, color 0.25s ease; }
        .k-nav-link:hover { background: rgba(255,255,255,0.15); }
        .k-header-inner.on .k-nav-link { color: #181D1F; }
        .k-header-inner.on .k-nav-link:hover { background: rgba(24,29,31,0.08); }
        .k-header-right { position: relative; z-index: 10; }
        .k-btn-dark { display: inline-flex; align-items: center; gap: 6px; padding: 10px 20px; background: rgba(255,255,255,0.18); color: #fff; border: 1.5px solid rgba(255,255,255,0.4); border-radius: 9999px; cursor: pointer; font-family: 'Archivo', sans-serif; font-size: 18px; font-weight: 500; letter-spacing: 0.02em; white-space: nowrap; transition: background 0.25s ease, color 0.25s ease, border-color 0.25s ease; backdrop-filter: blur(8px); }
        @media (max-width: 768px) { .k-btn-dark { font-size: 16px; padding: 8px 16px; } }
        .k-btn-dark:hover { background: rgba(255,255,255,0.28); }
        .k-header-inner.on .k-btn-dark { background: #181D1F; color: #fff; border-color: transparent; }
        .k-header-inner.on .k-btn-dark:hover { background: #2d3748; }

        .k-hero {
          height: 100vh; max-height: 1440px; padding: 16px;
          display: flex; flex-direction: column; background: #fff;
        }
        @media (max-width: 768px) { .k-hero { padding: 12px; } }

        .k-hero-card {
          position: relative; flex: 1; width: 100%; max-width: 1440px; margin: 0 auto;
          background: linear-gradient(170deg, #15aeea 0%, #73cef2 100%);
          overflow: hidden;
          transform: scale(0.6); border-radius: 80px; opacity: 0;
          transition: transform 1.6s cubic-bezier(0.85, 0, 0.15, 1),
                      border-radius 1.6s cubic-bezier(0.85, 0, 0.15, 1),
                      opacity 1s ease;
        }
        .k-hero-card.expanded { transform: scale(1); border-radius: 32px; opacity: 1; }
        @media (max-width: 1200px) { .k-hero-card.expanded { border-radius: 28px; } }
        @media (max-width: 768px) { .k-hero-card.expanded { border-radius: 20px; } }

        .hero-cloud {
          position: absolute; width: 120%; max-width: none; left: -10%; bottom: -20%;
          opacity: 0.6; mix-blend-mode: screen; pointer-events: none; z-index: 1; will-change: transform;
        }

        .k-hero-center {
          position: absolute; inset: 0; display: flex; flex-direction: column;
          align-items: center; justify-content: center; z-index: 2;
          padding: 0 24px 48px; text-align: center;
          opacity: 0; transition: opacity 1s ease 1s;
        }
        .k-hero-card.expanded .k-hero-center { opacity: 1; }

        .k-hero-eyebrow { font-family: 'Gabarito', sans-serif; font-size: 18px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #037BB5; margin-bottom: 12px; }
        .k-hero-h1 {
          font-family: 'Archivo', sans-serif; font-weight: 600; font-size: 128px;
          line-height: 1.09; letter-spacing: -0.015em;
          background: linear-gradient(169deg, rgba(3,123,181,0.85) 20%, rgba(3,120,176,0.9) 74%);
          -webkit-background-clip: text; background-clip: text;
          -webkit-text-fill-color: transparent; color: transparent;
        }
        @media (max-width: 1200px) { .k-hero-h1 { font-size: clamp(48px, 8vw, 120px); line-height: 1.1; } }
        @media (max-width: 768px) { .k-hero-h1 { font-size: clamp(40px, 12vw, 72px); line-height: 1.15; } }

        .k-page { background: #fff; }
        .k-sec { background: #fff; padding: 0 16px 16px; }
        .k-inner { max-width: 1440px; margin: 0 auto; }

        /* About */
        .k-about-card { min-height: 760px; border-radius: 32px; overflow: hidden; position: relative; display: flex; align-items: center; justify-content: center; background: #FDDBCE; }
        .k-about-inner { position: relative; z-index: 2; display: flex; flex-direction: column; align-items: center; gap: 24px; padding: 80px 48px; max-width: 820px; text-align: center; }
        .k-eyebrow { font-family: 'Gabarito', sans-serif; font-size: 18px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #181D1F; }
        .k-body-xl { font-family: 'Archivo', sans-serif; font-size: 32px; font-weight: 400; line-height: 1.25; letter-spacing: -0.015em; color: #181D1F; }

        /* Features */
        .k-feat-grid { display: grid; grid-template-columns: 5fr 7fr; gap: 16px; }
        @media (max-width: 1024px) { .k-feat-grid { grid-template-columns: 1fr; } }
        .k-feat-card { height: 760px; border-radius: 32px; overflow: hidden; position: relative; display: flex; flex-direction: column; }
        .k-feat-text { padding: 48px; display: flex; flex-direction: column; gap: 16px; flex-shrink: 0; z-index: 4; }
        .k-feat-h2 { font-family: 'Archivo', sans-serif; font-size: 40px; font-weight: 600; line-height: 1.2; letter-spacing: -0.015em; color: #181D1F; }
        .k-feat-p { font-family: 'Archivo', sans-serif; font-size: 20px; font-weight: 400; line-height: 1.4; letter-spacing: 0.025em; color: #424647; }

        /* Marquee */
        .k-marquee-sec { overflow: hidden; border-top: 1px solid #E7E7E9; border-bottom: 1px solid #E7E7E9; padding: 16px 0; background: #fff; }
        .k-marquee-row { position: relative; overflow: hidden; margin-bottom: 12px; }
        .k-track { display: flex; gap: 12px; width: max-content; will-change: transform; backface-visibility: hidden; }
        .k-fwd { animation: k-marquee-fwd 30s linear infinite; }
        .k-rev { animation: k-marquee-rev 24s linear infinite; }
        @keyframes k-marquee-fwd { from { transform: translateX(0); } to { transform: translateX(-33.333%); } }
        @keyframes k-marquee-rev { from { transform: translateX(-33.333%); } to { transform: translateX(0); } }
        .k-token { display: inline-flex; align-items: center; flex-shrink: 0; border: 1px solid #E7E7E9; border-radius: 9999px; padding: 6px 16px; font-family: 'Archivo', sans-serif; font-size: 16px; font-weight: 400; color: #424647; white-space: nowrap; background: #fff; }

        /* How it works */
        .k-how-card { border-radius: 32px; background: #EAE4DC; padding: 64px 48px; display: grid; grid-template-columns: 1fr 1fr; gap: 64px; align-items: center; }
        @media (max-width: 900px) { .k-how-card { grid-template-columns: 1fr; gap: 32px; } }
        .k-how-h2 { font-family: 'Archivo', sans-serif; font-size: clamp(32px, 4vw, 56px); font-weight: 600; letter-spacing: -0.015em; line-height: 1.1; color: #181D1F; margin-bottom: 16px; }
        .k-step { display: flex; gap: 16px; align-items: flex-start; padding: 16px; border-radius: 16px; background: transparent; transition: background 0.18s; }
        .k-step-num { font-family: 'Archivo', sans-serif; font-size: 14px; font-weight: 600; letter-spacing: 0.1em; color: rgba(24,29,31,0.35); min-width: 28px; }
        /* ✅ Fixed: step title and body were rendering white */
        .k-step-title { font-family: 'Archivo', sans-serif; font-size: 16px; font-weight: 600; color: #181D1F; margin-bottom: 4px; }
        .k-step-body { font-family: 'Archivo', sans-serif; font-size: 14px; color: #424647; line-height: 1.55; }

        /* Outcomes */
        .k-out-card { border-radius: 32px; background: #D7CEF0; padding: 48px; }
        .k-sec-h2 { font-family: 'Archivo', sans-serif; font-size: 64px; font-weight: 600; line-height: 1.12; letter-spacing: -0.015em; color: #181D1F; }
        @media (max-width: 768px) { .k-sec-h2 { font-size: clamp(32px, 8vw, 56px); } }
        .k-out-item { display: grid; grid-template-columns: 72px 1fr auto; gap: 16px; align-items: start; padding: 24px 0; border-bottom: 1px solid rgba(24,29,31,0.1); cursor: default; transition: transform 0.18s ease; }
        .k-out-num { font-family: 'Archivo', sans-serif; font-size: 32px; font-weight: 600; color: rgba(24,29,31,0.22); }
        /* ✅ Fixed: outcome title and body were rendering white */
        .k-out-title { font-family: 'Archivo', sans-serif; font-size: 20px; font-weight: 600; color: #181D1F; margin-bottom: 6px; }
        .k-out-body { font-family: 'Archivo', sans-serif; font-size: 15px; color: #424647; line-height: 1.5; }
        .k-out-tag { display: inline-flex; align-items: center; height: fit-content; border: 1px solid rgba(24,29,31,0.18); border-radius: 9999px; padding: 4px 14px; font-family: 'Gabarito', sans-serif; font-size: 13px; font-weight: 500; color: #424647; white-space: nowrap; }

        /* Trust */
        .k-trust-card { border-radius: 32px; overflow: hidden; background: #DBE5F0; }
        .k-trust-header { padding: 48px 48px 32px; }
        .k-trust-grid { display: grid; grid-template-columns: repeat(3, 1fr); }
        @media (max-width: 768px) { .k-trust-grid { grid-template-columns: 1fr; } }
        .k-trust-item { padding: 32px 40px 40px; position: relative; }
        .k-trust-icon { margin-bottom: 16px; color: #181D1F; }
        .k-trust-title { font-family: 'Archivo', sans-serif; font-size: 20px; font-weight: 600; color: #181D1F; margin-bottom: 8px; }
        /* ✅ Fixed: trust body was rendering white */
        .k-trust-body { font-family: 'Archivo', sans-serif; font-size: 15px; color: #424647; line-height: 1.55; }

        /* Testimonials */
        .k-testi-card { border-radius: 32px; background: #E4EED2; padding: 48px; }
        .k-testi-header { margin-bottom: 32px; }
        .k-testi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
        @media (max-width: 1024px) { .k-testi-grid { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 600px) { .k-testi-grid { grid-template-columns: 1fr; } }
        .k-testi-item { display: flex; flex-direction: column; justify-content: space-between; border: 2px solid rgba(24,29,31,0.2); border-radius: 24px; padding: 24px; min-height: 180px; background: rgba(255,255,255,0.5); }
        /* ✅ Fixed: testimonial quote and author were rendering white */
        .k-testi-q { font-family: 'Archivo', sans-serif; font-size: 15px; color: #181D1F; line-height: 1.55; margin-bottom: 16px; }
        .k-testi-author { font-family: 'Gabarito', sans-serif; font-size: 14px; font-weight: 600; color: rgba(24,29,31,0.55); }

        /* CTA */
        .k-cta-card { border-radius: 32px; background: #181D1F; padding: 64px 48px; display: grid; grid-template-columns: 1fr auto; gap: 48px; align-items: center; }
        @media (max-width: 768px) { .k-cta-card { grid-template-columns: 1fr; gap: 24px; } }
        .k-cta-h2 { font-family: 'Archivo', sans-serif; font-size: clamp(28px, 3.5vw, 48px); font-weight: 600; color: #fff; }
        .k-btn-white { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 14px 28px; background: #fff; color: #181D1F; border-radius: 9999px; border: none; cursor: pointer; font-family: 'Archivo', sans-serif; font-size: 16px; font-weight: 600; white-space: nowrap; transition: background 0.15s; }
        .k-btn-white:hover { background: #f0f0f0; }

        /* FAQ */
        .k-faq-card { border-radius: 32px; background: #DCEEEF; padding: 48px; }
        .k-faq-header { margin-bottom: 24px; }
        .kfaq-item { background: #fff; border-radius: 24px; overflow: hidden; margin-bottom: 12px; }
        .kfaq-btn { width: 100%; display: flex; gap: 48px; align-items: flex-start; padding: 20px 16px 20px 24px; cursor: pointer; background: none; border: none; text-align: left; }
        .kfaq-q { flex: 1; font-family: 'Archivo', sans-serif; font-size: 20px; font-weight: 600; color: #181D1F; line-height: 1.3; }
        .kfaq-icon { flex-shrink: 0; transition: transform 0.25s ease; }
        .kfaq-body { overflow: hidden; transition: max-height 0.3s ease, opacity 0.3s ease; }
        .kfaq-a { font-family: 'Archivo', sans-serif; font-size: 18px; color: #424647; line-height: 1.5; padding: 0 24px 24px; }

        /* Footer */
        .k-footer-card { border-radius: 32px; background: #181D1F; padding: 48px; display: flex; flex-direction: column; gap: 48px; }
        .k-footer-top { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 32px; }
        .k-footer-links { display: flex; gap: 96px; }
        .k-footer-col { display: flex; flex-direction: column; gap: 8px; }
        .k-footer-a { font-family: 'Archivo', sans-serif; font-size: 18px; color: #fff; text-decoration: none; background: none; border: none; cursor: pointer; padding: 0; text-align: left; transition: color 0.15s; }
        .k-footer-a:hover { color: rgba(255,255,255,0.7); }
        .k-footer-copy { font-family: 'Archivo', sans-serif; font-size: 16px; color: rgba(255,255,255,0.4); }

        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
          .word { opacity: 1 !important; transform: none !important; }
          .hero-cloud { transform: none !important; }
          .k-hero-card { transform: none !important; opacity: 1 !important; }
        }
      `}</style>

      <header className={`k-header ${isReady ? 'ready' : ''}`}>
        <div className={`k-header-inner${scrolled ? ' on' : ''}`}>
          <a href="/" className="k-logo" aria-label="Kavi">
            <div className="k-logo-mark"><Zap size={15} color={scrolled ? '#fff' : '#181D1F'} strokeWidth={2} /></div>
            <span className="k-logo-name">KAVI</span>
          </a>
          <nav className="k-nav" aria-label="Main navigation">
            {[['About','about'],['How it works','how'],['Impact','impact'],['Security','trust'],['FAQ','faq']].map(([l,id]) => (
              <button key={id} type="button" className="k-nav-link font-archivo" onClick={() => scrollTo(id)}>{l}</button>
            ))}
          </nav>
          <div className="k-header-right">
            <button onClick={handleStart} disabled={statusLoading} className="k-btn-dark font-archivo">
              Get started <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </header>

      <div className="k-page">
        <a href="#main-content" className="skip-nav">Skip to main content</a>

        <main id="main-content">

          <section aria-labelledby="hero-heading" className="k-hero">
            <div className={`k-hero-card ${isReady ? 'expanded' : ''}`}>
              <img
                src={cloudImg}
                alt=""
                className="hero-cloud"
                ref={heroCloudRef}
                style={{ transform: 'translate3d(0, 0, 0)' }}
              />
              <div className="k-hero-center">
                <p className="k-hero-eyebrow">Pull-request intelligence</p>
                <h1 id="hero-heading" className="k-hero-h1">
                  Your codebase<br />has memory now.
                </h1>
              </div>
            </div>
          </section>

          <section id="about" aria-labelledby="about-heading" className="k-sec">
            <div className="k-inner">
              <div className="k-about-card" style={{ overflow: 'hidden', position: 'relative', minHeight: 760 }}>

                {/* ── Scattered ghost PR cards ── */}
                {[
                  { num: 88,  title: 'Refactor auth middleware',     author: 'priya',   top: '8%',  left: '3%',   rotate: '-4deg',  opacity: 0.55 },
                  { num: 91,  title: 'Add rate limiting to /api',    author: 'tom_p',   top: '18%', left: '72%',  rotate: '3deg',   opacity: 0.45 },
                  { num: 94,  title: 'Migrate DB to Postgres 15',    author: 'sarah_k', top: '55%', left: '5%',   rotate: '-2deg',  opacity: 0.50 },
                  { num: 97,  title: 'Switch to GraphQL layer',      author: 'ravi_m',  top: '70%', left: '68%',  rotate: '5deg',   opacity: 0.40 },
                  { num: 101, title: 'Add feature flags system',     author: 'marcus',  top: '5%',  left: '42%',  rotate: '2deg',   opacity: 0.35 },
                  { num: 103, title: 'Remove legacy endpoints',      author: 'priya',   top: '78%', left: '38%',  rotate: '-3deg',  opacity: 0.48 },
                  { num: 107, title: 'Add CDN caching layer',        author: 'ravi_m',  top: '40%', left: '78%',  rotate: '4deg',   opacity: 0.42 },
                  { num: 112, title: 'Deprecate v1 payments API',    author: 'tom_p',   top: '85%', left: '10%',  rotate: '-5deg',  opacity: 0.38 },
                  { num: 118, title: 'Refactor search indexing',     author: 'sarah_k', top: '32%', left: '-2%',  rotate: '3deg',   opacity: 0.52 },
                  { num: 122, title: 'Add OpenTelemetry traces',     author: 'marcus',  top: '62%', left: '55%',  rotate: '-2deg',  opacity: 0.44 },
                ].map((pr) => (
                  <div
                    key={pr.num}
                    style={{
                      position: 'absolute',
                      top: pr.top,
                      left: pr.left,
                      width: 180,
                      background: '#fff',
                      borderRadius: 14,
                      padding: '10px 13px',
                      opacity: pr.opacity,
                      transform: `rotate(${pr.rotate})`,
                      pointerEvents: 'none',
                      boxShadow: '0 4px 16px rgba(24,29,31,0.10)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
                      <div style={{ width: 16, height: 16, borderRadius: 5, background: '#181D1F', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <svg width="9" height="9" viewBox="0 0 16 16" fill="none"><circle cx="4" cy="3" r="1.5" stroke="#fff" strokeWidth="1.4"/><circle cx="4" cy="13" r="1.5" stroke="#fff" strokeWidth="1.4"/><circle cx="12" cy="13" r="1.5" stroke="#fff" strokeWidth="1.4"/><path d="M4 4.5v7M4 11.5c2 0 5.5-.8 5.5-4" stroke="#fff" strokeWidth="1.4" strokeLinecap="round"/></svg>
                      </div>
                      <span style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 11, fontWeight: 700, color: '#C2522B' }}>PR #{pr.num}</span>
                    </div>
                    <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 12, fontWeight: 600, color: '#181D1F', lineHeight: 1.3, marginBottom: 5 }}>{pr.title}</p>
                    <p style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 11, color: 'rgba(24,29,31,0.5)' }}>@{pr.author}</p>
                    <div style={{ marginTop: 7, height: 3, borderRadius: 9999, background: '#F0EDE8' }}>
                      <div style={{ height: 3, borderRadius: 9999, background: 'rgba(24,29,31,0.2)', width: `${50 + (pr.num % 5) * 8}%` }} />
                    </div>
                  </div>
                ))}

                {/* Radial vignette to fade cards near centre */}
                <div style={{
                  position: 'absolute', inset: 0, pointerEvents: 'none',
                  background: 'radial-gradient(ellipse 55% 60% at 50% 50%, #FDDBCE 38%, transparent 75%)',
                  zIndex: 1,
                }} />

                {/* ── Centre text ── */}
                <div className="k-about-inner" ref={aboutRef as React.RefObject<HTMLDivElement>} style={{ position: 'relative', zIndex: 2 }}>
                  <h2 id="about-heading" className="k-eyebrow">Why Kavi?</h2>
                  <p className="k-body-xl font-archivo">
                    <Words text="Engineering teams make decisions in pull-request threads. But those threads disappear into noise the moment a PR is merged." />
                  </p>
                  <p className="k-body-xl font-archivo">
                    <Words text="Oddly, though, nobody built a way to query them. Until now." />
                  </p>
                  <div style={{ margin: '4px 0' }}>
                    <div style={{ width: 36, height: 36, background: '#181D1F', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Zap size={18} color="#fff" strokeWidth={2} />
                    </div>
                  </div>
                  <p className="k-body-xl font-archivo">
                    <Words text="With Kavi, we're changing that." />
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section aria-label="Key features" className="k-sec">
            <div className="k-inner">
              <div className="k-feat-grid" ref={featRef as React.RefObject<HTMLDivElement>}>
                <div className="k-feat-card" style={{ background: '#EAE4DC' }}>
                  <div className="k-feat-text">
                    <h2 className="k-feat-h2 font-archivo">
                      {['The','antidote','to','context','rot'].map((w, i) => (
                        <span key={i} className="word inline-block" style={{ opacity:0, transform:'translateY(12px)', transition:'opacity 0.42s ease, transform 0.42s ease', marginRight:'0.28em' }}>{w}</span>
                      ))}
                    </h2>
                    <p className="k-feat-p font-archivo">Kavi brings architecture decisions back to the surface — not summaries, but the actual reasoning that happened in review threads.</p>
                  </div>

                  {/* Mock PR thread */}
                  <div style={{ flex: 1, padding: '0 28px 28px', display: 'flex', flexDirection: 'column', gap: 10, overflow: 'hidden', justifyContent: 'flex-end' }}>

                    {/* PR header pill */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#fff', borderRadius: 9999, padding: '5px 12px 5px 8px', boxShadow: '0 1px 4px rgba(24,29,31,0.08)' }}>
                        <div style={{ width: 18, height: 18, background: '#6E5BC2', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><circle cx="4" cy="3" r="2" stroke="#fff" strokeWidth="1.5"/><circle cx="4" cy="13" r="2" stroke="#fff" strokeWidth="1.5"/><circle cx="12" cy="13" r="2" stroke="#fff" strokeWidth="1.5"/><path d="M4 5v6M4 11c2 0 6-.5 6-4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round"/></svg>
                        </div>
                        <span style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 12, fontWeight: 600, color: '#181D1F' }}>PR #341</span>
                        <span style={{ fontFamily: "'Archivo', sans-serif", fontSize: 12, color: 'rgba(24,29,31,0.5)' }}>Migrate auth to JWT tokens</span>
                      </div>
                      <span style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 11, fontWeight: 600, color: '#2D6A2D', background: '#D4EDDA', borderRadius: 9999, padding: '3px 10px' }}>Merged</span>
                    </div>

                    {/* Comment 1 */}
                    <div style={{ background: '#fff', borderRadius: 16, padding: '12px 14px', boxShadow: '0 1px 4px rgba(24,29,31,0.07)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#FDDBCE', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Gabarito', sans-serif", fontSize: 11, fontWeight: 700, color: '#C2522B', flexShrink: 0 }}>S</div>
                        <span style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 13, fontWeight: 600, color: '#181D1F' }}>sarah_k</span>
                        <span style={{ fontFamily: "'Archivo', sans-serif", fontSize: 11, color: 'rgba(24,29,31,0.4)', marginLeft: 'auto' }}>14 Mar</span>
                      </div>
                      <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, color: '#424647', lineHeight: 1.55 }}>
                        Why are we moving away from session cookies? Concerned about token storage on mobile clients.
                      </p>
                    </div>

                    {/* Comment 2 — decision */}
                    <div style={{ background: '#fff', borderRadius: 16, padding: '12px 14px', boxShadow: '0 1px 4px rgba(24,29,31,0.07)', borderLeft: '3px solid #6E5BC2' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#D7CEF0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Gabarito', sans-serif", fontSize: 11, fontWeight: 700, color: '#6E5BC2', flexShrink: 0 }}>R</div>
                        <span style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 13, fontWeight: 600, color: '#181D1F' }}>ravi_m</span>
                        <span style={{ fontFamily: "'Archivo', sans-serif", fontSize: 11, color: 'rgba(24,29,31,0.4)', marginLeft: 'auto' }}>14 Mar</span>
                      </div>
                      <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, color: '#424647', lineHeight: 1.55 }}>
                        Good catch. We decided on <strong style={{ color: '#181D1F' }}>httpOnly cookies for JWT</strong> — no JS access. The mobile SDK handles refresh automatically. Tradeoff documented in the ADR linked below.
                      </p>
                    </div>

                    {/* Comment 3 — resolution */}
                    <div style={{ background: '#fff', borderRadius: 16, padding: '12px 14px', boxShadow: '0 1px 4px rgba(24,29,31,0.07)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#E4EED2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Gabarito', sans-serif", fontSize: 11, fontWeight: 700, color: '#2D6A2D', flexShrink: 0 }}>T</div>
                        <span style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 13, fontWeight: 600, color: '#181D1F' }}>tom_p</span>
                        <span style={{ fontFamily: "'Archivo', sans-serif", fontSize: 11, color: 'rgba(24,29,31,0.4)', marginLeft: 'auto' }}>15 Mar</span>
                      </div>
                      <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, color: '#424647', lineHeight: 1.55 }}>
                        Approved. This is exactly the reasoning we needed documented. ✓
                      </p>
                    </div>

                    {/* Kavi indexed badge */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start', background: 'rgba(24,29,31,0.08)', borderRadius: 9999, padding: '5px 12px' }}>
                      <div style={{ width: 14, height: 14, background: '#181D1F', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width="8" height="8" viewBox="0 0 10 10" fill="none"><path d="M2 5.5L4 7.5L8 3" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </div>
                      <span style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 11, fontWeight: 600, color: 'rgba(24,29,31,0.6)', letterSpacing: '0.06em' }}>INDEXED BY KAVI</span>
                    </div>

                  </div>
                </div>

                <div className="k-feat-card" style={{ background: '#D7CEF0' }}>
                  <div className="k-feat-text">
                    <h2 className="k-feat-h2 font-archivo">
                      {['Ask','in','plain','language'].map((w, i) => (
                        <span key={i} className="word inline-block" style={{ opacity:0, transform:'translateY(12px)', transition:'opacity 0.42s ease, transform 0.42s ease', marginRight:'0.28em' }}>{w}</span>
                      ))}
                    </h2>
                    <p className="k-feat-p font-archivo">Every response cites the pull request, the author, and the date. Fully traceable, never hallucinated.</p>
                  </div>

                  {/* Mock chat UI */}
                  <div style={{ flex: 1, padding: '0 28px 28px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 10, overflow: 'hidden' }}>
                    {/* User message */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <div style={{
                        background: '#181D1F', color: '#fff',
                        borderRadius: '18px 18px 4px 18px',
                        padding: '10px 16px',
                        fontFamily: "'Archivo', sans-serif", fontSize: 14, lineHeight: 1.5,
                        maxWidth: '80%',
                        boxShadow: '0 4px 14px rgba(24,29,31,0.18)',
                      }}>
                        Why did we switch from REST to GraphQL in the API layer?
                      </div>
                    </div>

                    {/* Assistant message */}
                    <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                      <div style={{
                        background: '#fff',
                        borderRadius: '18px 18px 18px 4px',
                        padding: '14px 16px',
                        fontFamily: "'Archivo', sans-serif", fontSize: 14, lineHeight: 1.6,
                        maxWidth: '88%',
                        boxShadow: '0 2px 8px rgba(24,29,31,0.08)',
                        display: 'flex', flexDirection: 'column', gap: 10,
                      }}>
                        <p style={{ color: '#181D1F' }}>
                          The switch was driven by frontend over-fetching issues. PR #214 by <strong>@ravi</strong> documents that mobile clients were downloading 4× more data than needed with the REST endpoints.
                        </p>
                        {/* Citation pill */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {[['PR #214', '#E8E3F8'], ['@ravi', '#E8E3F8'], ['Mar 2024', '#E8E3F8']].map(([label, bg]) => (
                            <span key={label} style={{
                              fontFamily: "'Gabarito', sans-serif", fontSize: 12, fontWeight: 600,
                              background: bg, color: '#5B4FCF',
                              borderRadius: 9999, padding: '3px 10px',
                            }}>{label}</span>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Second user message */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <div style={{
                        background: '#181D1F', color: '#fff',
                        borderRadius: '18px 18px 4px 18px',
                        padding: '10px 16px',
                        fontFamily: "'Archivo', sans-serif", fontSize: 14, lineHeight: 1.5,
                        maxWidth: '72%',
                        boxShadow: '0 4px 14px rgba(24,29,31,0.18)',
                      }}>
                        Which files were most affected?
                      </div>
                    </div>

                    {/* Typing indicator */}
                    <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                      <div style={{
                        background: '#fff', borderRadius: '18px 18px 18px 4px',
                        padding: '12px 16px',
                        display: 'flex', alignItems: 'center', gap: 5,
                        boxShadow: '0 2px 8px rgba(24,29,31,0.08)',
                      }}>
                        {[0, 0.18, 0.36].map((delay, i) => (
                          <span key={i} style={{
                            width: 7, height: 7, borderRadius: '50%',
                            background: 'rgba(24,29,31,0.3)',
                            display: 'inline-block',
                            animation: `kavi-dot-bounce 1.1s ${delay}s ease-in-out infinite`,
                          }} />
                        ))}
                      </div>
                    </div>

                    {/* Fake input bar */}
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      background: '#fff', borderRadius: 14,
                      padding: '10px 12px 10px 16px',
                      boxShadow: '0 2px 8px rgba(24,29,31,0.08)',
                      marginTop: 4,
                    }}>
                      <span style={{ flex: 1, fontFamily: "'Archivo', sans-serif", fontSize: 13, color: 'rgba(24,29,31,0.35)' }}>
                        Ask about architecture, PR history…
                      </span>
                      <div style={{ width: 30, height: 30, background: '#181D1F', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                          <path d="M22 2L11 13" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                          <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                    </div>
                  </div>

                  <style>{`
                    @keyframes kavi-dot-bounce {
                      0%, 60%, 100% { transform: translateY(0); opacity: 0.3; }
                      30% { transform: translateY(-5px); opacity: 1; }
                    }
                  `}</style>
                </div>
              </div>
            </div>
          </section>

          <section aria-label="Context signals" className="k-marquee-sec">
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              <div className="k-marquee-row">
                <div className="k-track k-fwd">
                  {streamFwd.map((t, i) => <span key={`f${i}`} className="k-token font-archivo">{t}</span>)}
                </div>
              </div>
              <div className="k-marquee-row">
                <div className="k-track k-rev">
                  {streamRev.map((t, i) => <span key={`r${i}`} className="k-token font-archivo">{t}</span>)}
                </div>
              </div>
            </div>
          </section>

          <section id="how" aria-labelledby="how-heading" className="k-sec" style={{ paddingTop: 16 }}>
            <div className="k-inner">
              <div className="k-how-card">
                <div>
                  <p className="k-eyebrow" style={{ marginBottom: 16 }}>How Kavi works</p>
                  <h2 id="how-heading" className="k-how-h2 font-archivo">A flowing memory layer,<br />not a static wiki.</h2>
                  <div className="k-steps">
                    {FLOW_STEPS.map((step, i) => (
                      <div key={i} className="k-step">
                        <span className="k-step-num">0{i + 1}</span>
                        <span style={{ color: '#181D1F', marginTop: 1 }}>{step.icon}</span>
                        <div>
                          <p className="k-step-title font-archivo">{step.title}</p>
                          <p className="k-step-body font-archivo">{step.body}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>

                  {/* Step 1 — Repos connected */}
                  <div style={{ background: '#fff', borderRadius: 18, padding: '14px 16px', boxShadow: '0 2px 8px rgba(24,29,31,0.07)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 28, height: 28, background: '#181D1F', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="4" cy="3" r="1.5" stroke="#fff" strokeWidth="1.3"/><circle cx="4" cy="13" r="1.5" stroke="#fff" strokeWidth="1.3"/><circle cx="12" cy="13" r="1.5" stroke="#fff" strokeWidth="1.3"/><path d="M4 4.5v7M4 11.5c2 0 5.5-.8 5.5-4" stroke="#fff" strokeWidth="1.3" strokeLinecap="round"/></svg>
                        </div>
                        <span style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, fontWeight: 600, color: '#181D1F' }}>Repositories connected</span>
                      </div>
                      <span style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 11, fontWeight: 600, color: '#2D6A2D', background: '#D4EDDA', borderRadius: 9999, padding: '3px 10px' }}>✓ Live</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {['api-service', 'frontend', 'auth-core'].map((repo) => (
                        <span key={repo} style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 11, fontWeight: 500, color: 'rgba(24,29,31,0.6)', background: '#F4F4F5', borderRadius: 9999, padding: '3px 10px', border: '1px solid #E7E7E9' }}>{repo}</span>
                      ))}
                    </div>
                  </div>

                  {/* Step 2 — Indexing progress */}
                  <div style={{ background: '#fff', borderRadius: 18, padding: '14px 16px', boxShadow: '0 2px 8px rgba(24,29,31,0.07)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 28, height: 28, background: '#181D1F', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="2" stroke="#fff" strokeWidth="1.3"/><path d="M5 8h6M5 5.5h3M5 10.5h4" stroke="#fff" strokeWidth="1.3" strokeLinecap="round"/></svg>
                        </div>
                        <span style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, fontWeight: 600, color: '#181D1F' }}>Decision memory indexed</span>
                      </div>
                      <span style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 11, fontWeight: 600, color: '#181D1F' }}>1,842 PRs</span>
                    </div>
                    {/* Progress bars */}
                    {[['Intent & summaries', '94%'], ['File-level impact', '88%'], ['Architecture context', '76%']].map(([label, pct]) => (
                      <div key={label as string} style={{ marginBottom: 7 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                          <span style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 11, color: 'rgba(24,29,31,0.5)' }}>{label}</span>
                          <span style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 11, fontWeight: 600, color: 'rgba(24,29,31,0.5)' }}>{pct}</span>
                        </div>
                        <div style={{ height: 5, borderRadius: 9999, background: '#F4F4F5' }}>
                          <div style={{ height: 5, borderRadius: 9999, background: '#181D1F', width: pct as string, opacity: 0.75 }} />
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Step 3 — Query result */}
                  <div style={{ background: '#fff', borderRadius: 18, padding: '14px 16px', boxShadow: '0 2px 8px rgba(24,29,31,0.07)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <div style={{ width: 28, height: 28, background: '#181D1F', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M2 8h8M2 12h5" stroke="#fff" strokeWidth="1.3" strokeLinecap="round"/></svg>
                      </div>
                      <span style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, fontWeight: 600, color: '#181D1F' }}>Grounded answer</span>
                    </div>
                    <div style={{ background: '#F4F4F5', borderRadius: 10, padding: '8px 12px', marginBottom: 8 }}>
                      <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 12, color: 'rgba(24,29,31,0.5)', marginBottom: 2 }}>Query</p>
                      <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, color: '#181D1F', fontWeight: 500 }}>Why was the rate limiter added to /checkout?</p>
                    </div>
                    <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 12, color: '#424647', lineHeight: 1.55, marginBottom: 8 }}>
                      Added in PR #189 after a payment spike caused 3rd-party timeouts. Decision by <strong style={{ color: '#181D1F' }}>@priya</strong>.
                    </p>
                    <div style={{ display: 'flex', gap: 5 }}>
                      {['PR #189', '@priya', 'Nov 2023'].map((tag) => (
                        <span key={tag} style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 11, fontWeight: 600, background: '#EAE4DC', color: '#6B5A3E', borderRadius: 9999, padding: '3px 9px' }}>{tag}</span>
                      ))}
                    </div>
                  </div>

                </div>
              </div>
            </div>
          </section>

          <section id="impact" aria-labelledby="impact-heading" className="k-sec" style={{ paddingTop: 16 }}>
            <div className="k-inner">
              <div className="k-out-card" ref={outRef as React.RefObject<HTMLDivElement>}>
                <p className="k-eyebrow" style={{ marginBottom: 12 }}>Impact moments</p>
                <h2 id="impact-heading" className="k-sec-h2 font-archivo">
                  <Words text="Where teams feel Kavi immediately." />
                </h2>
                <ol style={{ listStyle: 'none', padding: 0, marginTop: 16 }}>
                  {OUTCOMES.map(item => (
                    <li key={item.id} className="k-out-item">
                      <span className="k-out-num font-archivo">{item.id}</span>
                      <div>
                        <p className="k-out-title font-archivo">{item.title}</p>
                        <p className="k-out-body font-archivo">{item.body}</p>
                      </div>
                      <span className="k-out-tag">{item.tag}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </section>

          <section id="trust" aria-labelledby="trust-heading" className="k-sec" style={{ paddingTop: 16 }}>
            <div className="k-inner">
              <div className="k-trust-card">
                <div className="k-trust-header">
                  <p className="k-eyebrow" style={{ marginBottom: 12 }}>Trust & security</p>
                  <h2 id="trust-heading" className="k-sec-h2 font-archivo" style={{ fontSize: 'clamp(28px, 3.5vw, 48px)' }}>
                    Production-ready by design.
                  </h2>
                </div>
                <div className="k-trust-grid">
                  {TRUST.map(item => (
                    <div key={item.title} className="k-trust-item">
                      <div className="k-trust-icon">{item.icon}</div>
                      <p className="k-trust-title font-archivo">{item.title}</p>
                      <p className="k-trust-body font-archivo">{item.body}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section aria-labelledby="reviews-heading" className="k-sec" style={{ paddingTop: 16 }}>
            <div className="k-inner">
              <div className="k-testi-card">
                <div className="k-testi-header">
                  <p className="k-eyebrow">Love from engineering teams</p>
                  <h2 id="reviews-heading" className="k-sec-h2 font-archivo">What engineers are saying</h2>
                </div>
                <div className="k-testi-grid">
                  {TESTIMONIALS.map(t => (
                    <div key={t.author} className="k-testi-item">
                      <p className="k-testi-q font-archivo">"{t.quote}"</p>
                      <p className="k-testi-author font-archivo">{t.author}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section aria-label="Get started" className="k-sec" style={{ paddingTop: 16 }}>
            <div className="k-inner">
              <div className="k-cta-card">
                <div>
                  <h2 className="k-cta-h2 font-archivo">Turn PR history into<br />engineering memory.</h2>
                </div>
                <div>
                  <button onClick={handleStart} className="k-btn-white font-archivo">Launch Kavi <ArrowRight size={14}/></button>
                </div>
              </div>
            </div>
          </section>

          <section id="faq" aria-labelledby="faq-heading" className="k-sec" style={{ paddingTop: 16 }}>
            <div className="k-inner">
              <div className="k-faq-card">
                <div className="k-faq-header">
                  <p className="k-eyebrow">FAQ</p>
                  <h2 id="faq-heading" className="k-sec-h2 font-archivo">Frequently asked questions</h2>
                </div>
                <div>
                  {FAQ_ITEMS.map(item => <FAQItem key={item.q} q={item.q} a={item.a} />)}
                </div>
              </div>
            </div>
          </section>

        </main>

        <footer className="k-sec" style={{ paddingTop: 16 }}>
          <div className="k-inner">
            <div className="k-footer-card">
              <div className="k-footer-top">
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <div style={{ width:32, height:32, background:'rgba(255,255,255,0.12)', borderRadius:10, display:'flex', alignItems:'center', justifyContent:'center' }}>
                    <Zap size={15} color="#fff" strokeWidth={2}/>
                  </div>
                  <span style={{ fontFamily:"'Gabarito', sans-serif", fontSize:18, fontWeight:600, letterSpacing:'0.06em', color:'#fff' }}>KAVI</span>
                </div>
                <div className="k-footer-links">
                  <div className="k-footer-col">
                    <span style={{ fontFamily:"'Audiowide', sans-serif", fontSize:18, fontWeight:600, letterSpacing:'0.06em', color:'#fff' }}>KAVI</span>
                    <button type="button" className="k-footer-a font-archivo" onClick={() => scrollTo('about')}>About</button>
                    <button type="button" className="k-footer-a font-archivo" onClick={() => scrollTo('faq')}>FAQ</button>
                  </div>
                </div>
              </div>
              <p className="k-footer-copy font-archivo">© Copyright 2026. All rights reserved.</p>
            </div>
          </div>
        </footer>

      </div>
    </>
  )
}
