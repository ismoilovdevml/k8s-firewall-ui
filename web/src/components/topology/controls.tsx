import type { ReactNode } from 'react'
import { IconX } from '../icons'
import { IconButton } from '../ui'

/** Toggle chip for one edge kind, drawn with the same stroke as the graph. */
export function LegendToggle({
  label,
  count,
  stroke,
  dash,
  width = 2,
  pressed,
  title,
  onClick,
}: {
  label: string
  count?: number
  stroke: string
  dash?: string
  width?: number
  pressed: boolean
  title?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      title={title}
      className={`inline-flex h-7 items-center gap-2 rounded-full border px-3 text-xs font-medium transition-colors ${
        pressed ? 'border-edge bg-surface text-text shadow-sm' : 'border-dashed border-edge text-quiet line-through'
      }`}
    >
      <svg width="22" height="6" aria-hidden className={pressed ? '' : 'opacity-40'}>
        <line x1="0" y1="3" x2="22" y2="3" stroke={stroke} strokeWidth={width} strokeDasharray={dash} />
      </svg>
      {/* Lowercase in the DOM (tests and screen readers), capitalized on screen. */}
      <span className="inline-block first-letter:uppercase">{label}</span>
      {count !== undefined && <span className="tabular-nums text-quiet">{count}</span>}
    </button>
  )
}

/** Floating detail card over a graph. */
export function GraphPanel({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="absolute right-4 top-4 z-10 w-80 max-w-[calc(100%-2rem)] animate-pop-in rounded-xl border border-edge bg-surface p-4 shadow-pop">
      <div className="absolute right-2 top-2">
        <IconButton label="Close" onClick={onClose}>
          <IconX size={15} />
        </IconButton>
      </div>
      {children}
    </div>
  )
}

export function GraphHint({ children, tone }: { children: ReactNode; tone?: 'error' }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6">
      <div
        className={`max-w-md rounded-xl border px-5 py-4 text-center text-sm shadow-card ${
          tone === 'error' ? 'border-block/30 bg-block-soft text-block' : 'border-edge bg-surface text-muted'
        }`}
      >
        {children}
      </div>
    </div>
  )
}
