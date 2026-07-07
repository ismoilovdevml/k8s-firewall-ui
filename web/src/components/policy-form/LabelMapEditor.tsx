import { useState } from 'react'
import type { LabelMap } from '../../policy/model'

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

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {entries.map(([k, v]) => (
          <span
            key={k}
            className="inline-flex items-center gap-1 rounded bg-raised px-2 py-0.5 font-mono text-xs text-text"
          >
            {k}={v}
            <button
              type="button"
              onClick={() => remove(k)}
              className="text-quiet hover:text-block"
              aria-label={`Remove label ${k}`}
            >
              ✕
            </button>
          </span>
        ))}
        {entries.length === 0 && <span className="text-xs text-quiet">{emptyHint}</span>}
      </div>
      <div className="mt-1.5 flex items-center gap-1">
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
          placeholder="key"
          className="w-32 rounded border border-edge bg-base px-2 py-1 font-mono text-xs text-text placeholder:text-quiet focus:border-accent focus:outline-none"
        />
        <span className="text-quiet">=</span>
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
          placeholder="value"
          className="w-32 rounded border border-edge bg-base px-2 py-1 font-mono text-xs text-text placeholder:text-quiet focus:border-accent focus:outline-none"
        />
        <button
          type="button"
          onClick={add}
          disabled={!key.trim()}
          className="rounded border border-edge px-2 py-1 text-xs text-muted hover:border-accent hover:text-accent disabled:opacity-40"
        >
          Add label
        </button>
      </div>
    </div>
  )
}
