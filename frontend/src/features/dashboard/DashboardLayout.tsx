import { ReactNode } from 'react'

interface DashboardLayoutProps {
  left: ReactNode
  center: ReactNode
  right: ReactNode
}

export function DashboardLayout({ left, center, right }: DashboardLayoutProps) {
  return (
    <div className="grid h-[calc(100vh-100px)] gap-6 lg:grid-cols-[260px_minmax(0,1fr)_300px]">
      <div className="flex h-full flex-col overflow-hidden">{left}</div>
      <div className="flex h-full flex-col overflow-hidden">{center}</div>
      <div className="flex h-full flex-col overflow-hidden">{right}</div>
    </div>
  )
}
