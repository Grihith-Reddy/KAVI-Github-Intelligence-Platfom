export function LoadingState({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-[rgba(24,29,31,0.62)]">
      <span className="h-2 w-2 animate-pulse rounded-full bg-[rgba(34,97,163,0.5)]" />
      {label}
    </div>
  )
}
