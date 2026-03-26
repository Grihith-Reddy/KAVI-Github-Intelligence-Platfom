interface BrandMarkProps {
  size?: number
  className?: string
}

export function BrandMark({ size = 22, className = '' }: BrandMarkProps) {
  return (
    <div
      className={`inline-flex items-center justify-center rounded-full border border-white/24 bg-white/10 p-2 shadow-[0_10px_35px_rgba(0,0,0,0.26)] ${className}`}
      aria-label="Kavi Logo"
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M13.9 1.8L5.8 13.2h5.1l-1 9 8.2-11.3h-5.3l1.1-9.1z"
          fill="#f4f8ff"
          stroke="#f4f8ff"
          strokeWidth="0.9"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}
