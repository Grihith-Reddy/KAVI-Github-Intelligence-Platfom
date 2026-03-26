import { ButtonHTMLAttributes, ReactNode } from 'react'
import clsx from 'clsx'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  icon?: ReactNode
}

const base =
  'inline-flex items-center justify-center gap-2 rounded-full font-semibold transition kavi-spring focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/35'
const variants = {
  primary:
    'bg-white text-black hover:bg-slate-100 border border-white shadow-[0_16px_34px_rgba(255,255,255,0.18)]',
  secondary:
    'bg-white/10 text-white border border-white/25 hover:border-white/40 hover:bg-white/14 shadow-[0_8px_24px_rgba(0,0,0,0.18)]',
  ghost: 'bg-transparent text-white/80 hover:text-white hover:bg-white/10 border border-transparent',
  danger: 'bg-red-500/18 text-red-100 hover:bg-red-500/28 border border-red-300/35',
}
const sizes = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
}

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button className={clsx(base, variants[variant], sizes[size], className)} {...props}>
      {icon}
      {children}
    </button>
  )
}
