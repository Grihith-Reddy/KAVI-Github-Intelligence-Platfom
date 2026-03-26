import { TextareaHTMLAttributes } from 'react'
import clsx from 'clsx'

export function TextArea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={clsx(
        'w-full rounded-[18px] border border-white/24 bg-white/10 px-4 py-3 text-sm text-white shadow-[0_12px_28px_rgba(0,0,0,0.2)] focus:border-white/45 focus:outline-none focus:ring-2 focus:ring-white/15 placeholder:text-white/50',
        className
      )}
      {...props}
    />
  )
}
