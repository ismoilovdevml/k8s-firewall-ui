import { useEffect } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

// Small shared primitives so new pages stay visually consistent with the
// Kiwi light theme tokens defined in index.css.

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'

const BUTTON: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent font-medium hover:brightness-110',
  secondary: 'border border-edge bg-surface text-muted hover:border-accent hover:text-accent-strong',
  danger: 'bg-block text-on-accent font-medium hover:brightness-110',
  ghost: 'text-muted hover:text-text',
}

export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type="button"
      {...props}
      className={`rounded px-3 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON[variant]} ${className}`}
    />
  )
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-lg font-bold text-text">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function Card({ title, children, className = '' }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-edge bg-surface p-4 shadow-sm ${className}`}>
      {title && <h2 className="mb-3 font-mono text-[11px] uppercase tracking-wide text-quiet">{title}</h2>}
      {children}
    </section>
  )
}

import type { Tone } from './tone'

const TONE: Record<Tone, string> = {
  ok: 'bg-accent/10 text-accent-strong',
  warn: 'bg-warn-bg text-warn-text',
  block: 'bg-block/10 text-block',
  neutral: 'bg-raised text-muted',
  info: 'bg-sky-100 text-sky-800',
}

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[11px] font-medium ${TONE[tone]}`}>
      {children}
    </span>
  )
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`max-h-[90vh] w-full overflow-auto rounded-xl border border-edge bg-surface p-5 shadow-xl ${wide ? 'max-w-3xl' : 'max-w-md'}`}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 className="font-mono text-sm font-semibold text-text">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-quiet hover:text-text">
            ✕
          </button>
        </div>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  )
}

export function Feedback({ tone, children }: { tone: 'ok' | 'error'; children: ReactNode }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={`mt-3 rounded border px-3 py-2 font-mono text-xs ${
        tone === 'ok' ? 'border-accent/30 bg-accent/5 text-accent-strong' : 'border-block/30 bg-block/5 text-block'
      }`}
    >
      {children}
    </p>
  )
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-6 text-sm text-muted" role="status">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      {label}
    </div>
  )
}
