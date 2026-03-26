import { FormEvent, useState } from 'react'
import { Send } from 'lucide-react'

import { Button } from '../../components/Button'
import { TextArea } from '../../components/TextArea'

interface ChatComposerProps {
  onSend: (message: string) => void
  disabled?: boolean
}

export function ChatComposer({ onSend, disabled }: ChatComposerProps) {
  const [value, setValue] = useState('')

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!value.trim()) return
    onSend(value.trim())
    setValue('')
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <TextArea
        rows={3}
        placeholder="Ask why a change exists, or how a file evolved..."
        value={value}
        onChange={(event) => setValue(event.target.value)}
        disabled={disabled}
      />
      <div className="flex justify-end">
        <Button type="submit" size="sm" icon={<Send size={14} />} disabled={disabled}>
          Send
        </Button>
      </div>
    </form>
  )
}
