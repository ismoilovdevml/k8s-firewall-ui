import { useState } from 'react'
import type { LabelMap } from '../../policy/model'
import { IconPlus, IconX } from '../icons'
import { Button, Input } from '../ui'

interface Props {
  value: LabelMap
  onChange: (value: LabelMap) => void
  /** Shown when the map is empty, e.g. "matches all pods". */
  emptyHint: string
}

/** Key=value chip editor for matchLabels. */
export default function LabelMapEditor({ value, onChange, emptyHint }: Props) {
  const [key, setKey] = useState('')
  const [val, setVal] = useState('')

  const add = () => {
    const k = key.trim()
    if (!k) return
    onChange({ ...value, [k]: val.trim() })
    setKey('')
    setVal('')
  }

  const remove = (k: string) => {
    const next = { ...value }
    delete next[k]
    onChange(next)
  }

  const entries = Object.entries(value)
  const onEnter = (e: React.KeyboardEvent) => e.key === 'Enter' && (e.preventDefault(), add())

  return (
    <div>
      <div className="flex min-h-7 flex-wrap items-center gap-1.5">
        {entries.map(([k, v]) => (
          <span
            key={k}
            className="inline-flex items-center gap-1 rounded-md border border-accent/25 bg-accent-soft py-0.5 pl-2 pr-1 font-mono text-xs text-accent-strong"
          >
            {k}={v}
            <button
              type="button"
              onClick={() => remove(k)}
              className="rounded p-0.5 text-accent-strong/70 hover:bg-block-soft hover:text-block"
              aria-label={`Remove label ${k}`}
            >
              <IconX size={12} />
            </button>
          </span>
        ))}
        {entries.length === 0 && <span className="text-xs italic text-quiet">{emptyHint}</span>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Input
          mono
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={onEnter}
          placeholder="key"
          aria-label="label key"
          className="h-8 w-36"
        />
        <span className="text-quiet">=</span>
        <Input
          mono
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={onEnter}
          placeholder="value"
          aria-label="label value"
          className="h-8 w-36"
        />
        <Button size="sm" onClick={add} disabled={!key.trim()} icon={<IconPlus size={14} />}>
          Add label
        </Button>
      </div>
    </div>
  )
}
