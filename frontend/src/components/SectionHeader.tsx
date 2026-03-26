import { ReactNode } from 'react'

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      {action}
    </div>
  )
}
