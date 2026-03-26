import { Link } from 'react-router-dom'

import { EmptyState } from '../components/EmptyState'

export function NotFoundPage() {
  return (
    <EmptyState
      title="Page not found"
      description="The page you're looking for doesn't exist yet."
      action={
        <Link to="/" className="rounded-full border border-white/24 bg-[rgba(255,255,255,0.08)] px-4 py-2 text-sm font-semibold text-white">
          Back to home
        </Link>
      }
    />
  )
}

