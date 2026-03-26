import { ReactNode } from 'react'
import { TopNav } from './TopNav'

interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#fff',
        overflowX: 'hidden',
      }}
    >
      <TopNav />
      <main
        style={{
          maxWidth: '1440px',
          margin: '0 auto',
          padding: '112px 16px 48px',
        }}
      >
        {children}
      </main>
    </div>
  )
}