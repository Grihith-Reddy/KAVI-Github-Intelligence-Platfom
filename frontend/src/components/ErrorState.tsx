import { AlertTriangle } from 'lucide-react'

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="glass-surface kavi-radius-lg flex items-center gap-3 p-4 text-sm text-white/82">
      <AlertTriangle size={16} className="text-rose-200" />
      {message}
    </div>
  )
}
