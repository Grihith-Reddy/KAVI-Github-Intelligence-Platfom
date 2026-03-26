import clsx from 'clsx'

export interface ChatMessageProps {
  role: 'user' | 'assistant'
  content: string
}

export function ChatMessage({ role, content }: ChatMessageProps) {
  const isUser = role === 'user'
  return (
    <div className={clsx('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={clsx(
          'max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm shadow-sm',
          isUser
            ? 'border border-white/15 bg-white text-black shadow-[0_16px_32px_rgba(255,255,255,0.12)]'
            : 'border border-white/22 bg-[rgba(255,255,255,0.08)] text-white/86'
        )}
      >
        {content}
      </div>
    </div>
  )
}
