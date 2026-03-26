import { HTMLAttributes } from 'react'
import clsx from 'clsx'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: 'blue' | 'slate' | 'green'
}

const tones = {
  blue: 'bg-white text-black',
  slate: 'bg-white/10 text-white/84 border border-white/22',
  green: 'bg-emerald-300/14 text-emerald-100 border border-emerald-200/30'
}

export function Badge({ tone = 'blue', className, ...props }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold',
        tones[tone],
        className
      )}
      {...props}
    />
  )
}
