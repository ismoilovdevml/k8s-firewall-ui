import { forwardRef, useEffect, useRef } from 'react'
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'
import type { Tone } from './tone'
import { buttonClass } from './styles'
import type { ButtonSize, ButtonVariant } from './styles'
import { IconAlertOctagon, IconAlertTriangle, IconCheck, IconInfo, IconSearch, IconX } from './icons'

// Shared primitives so every page looks and behaves the same. Colors come
// only from the theme tokens in index.css, so light and dark mode both work.

// ---------------------------------------------------------------- buttons

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; icon?: ReactNode }) {
  return (
    <button type="button" {...props} className={buttonClass(variant, size, className)}>
      {icon}
      {children}
    </button>
  )
}

export function IconButton({
  label,
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-raised hover:text-text disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------- form controls

const CONTROL =
  'rounded-lg border border-edge bg-surface text-sm text-text shadow-sm transition-colors placeholder:text-quiet hover:border-edge-strong focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/15 disabled:cursor-not-allowed disabled:opacity-50'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }>(
  function Input({ className = '', mono, ...props }, ref) {
    return (
      <input
        ref={ref}
        {...props}
        className={`${CONTROL} h-9 px-3 ${mono ? 'font-mono text-[13px]' : ''} ${className}`}
      />
    )
  },
)

export function Select({
  className = '',
  mono,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { mono?: boolean }) {
  return (
    <select {...props} className={`${CONTROL} h-9 pl-3 pr-8 ${mono ? 'font-mono text-[13px]' : ''} ${className}`} />
  )
}

export function Textarea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${CONTROL} px-3 py-2 font-mono text-xs ${className}`} />
}

export function SearchInput({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={`relative ${className}`}>
      <IconSearch size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-quiet" />
      <input {...props} className={`${CONTROL} h-9 w-full pl-8 pr-3`} />
    </div>
  )
}

/** A labelled form control. The label wraps the control so clicks focus it. */
export function Field({
  label,
  hint,
  children,
  className = '',
}: {
  label: ReactNode
  hint?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-quiet">{hint}</span>}
    </label>
  )
}

export function Checkbox({
  label,
  hint,
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; hint?: ReactNode }) {
  return (
    <label className={`inline-flex cursor-pointer select-none items-center gap-2 text-sm text-text ${className}`}>
      <input type="checkbox" {...props} className="h-4 w-4 rounded" />
      <span>
        {label}
        {hint && <span className="ml-1.5 text-xs text-quiet">{hint}</span>}
      </span>
    </label>
  )
}

// ---------------------------------------------------------------- layout

export function Page({
  children,
  width = 'wide',
  className = '',
}: {
  children: ReactNode
  width?: 'wide' | 'narrow' | 'full'
  className?: string
}) {
  const w = width === 'narrow' ? 'max-w-5xl' : width === 'wide' ? 'max-w-[1400px]' : ''
  return <div className={`mx-auto w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8 ${w} ${className}`}>{children}</div>
}

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
  icon,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  back?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div>
      {back && <div className="mb-2">{back}</div>}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3 lg:flex-1">
          {icon && (
            <div className="mt-0.5 hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-strong sm:flex">
              {icon}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-text">{title}</h1>
            {subtitle && <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  )
}

export function Card({
  title,
  description,
  actions,
  children,
  className = '',
  bodyClassName = '',
  flush,
  ...rest
}: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  /** No body padding: for tables that run edge to edge. */
  flush?: boolean
} & Omit<React.HTMLAttributes<HTMLElement>, 'title'>) {
  const hasHeader = title || actions || description
  return (
    <section {...rest} className={`rounded-xl border border-edge bg-surface shadow-card ${className}`}>
      {hasHeader && (
        <div className={`flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-4 ${flush ? 'pb-3' : ''}`}>
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-text">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={`${flush ? '' : hasHeader ? 'px-5 pb-5 pt-3' : 'p-5'} ${bodyClassName}`}>{children}</div>
    </section>
  )
}

// ---------------------------------------------------------------- tables

export function Table({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full text-sm">{children}</table>
    </div>
  )
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="border-y border-edge bg-raised/60">
      <tr>{children}</tr>
    </thead>
  )
}

// ---------------------------------------------------------------- status

const TONE: Record<Tone, string> = {
  ok: 'bg-allow-soft text-accent-strong ring-allow/25',
  warn: 'bg-warn-bg text-warn-text ring-warn/30',
  block: 'bg-block-soft text-block ring-block/25',
  neutral: 'bg-raised text-muted ring-edge-strong/50',
  info: 'bg-info-soft text-info ring-info/25',
}

const DOT: Record<Tone, string> = {
  ok: 'bg-allow',
  warn: 'bg-warn',
  block: 'bg-block',
  neutral: 'bg-quiet',
  info: 'bg-info',
}

export function Badge({
  tone = 'neutral',
  dot,
  children,
  className = '',
}: {
  tone?: Tone
  dot?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE[tone]} ${className}`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${DOT[tone]}`} />}
      {children}
    </span>
  )
}

export function Dot({ tone }: { tone: Tone }) {
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${DOT[tone]}`} />
}

const ALERT: Record<'info' | 'warn' | 'block' | 'ok', { cls: string; icon: ReactNode }> = {
  info: { cls: 'border-info/25 bg-info-soft text-text', icon: <IconInfo size={16} className="mt-0.5 text-info" /> },
  warn: { cls: 'border-warn/40 bg-warn-bg text-warn-text', icon: <IconAlertTriangle size={16} className="mt-0.5" /> },
  block: { cls: 'border-block/30 bg-block-soft text-block', icon: <IconAlertOctagon size={16} className="mt-0.5" /> },
  ok: { cls: 'border-allow/30 bg-allow-soft text-accent-strong', icon: <IconCheck size={16} className="mt-0.5" /> },
}

export function Alert({
  tone = 'info',
  title,
  children,
  action,
  className = '',
}: {
  tone?: 'info' | 'warn' | 'block' | 'ok'
  title?: ReactNode
  children?: ReactNode
  action?: ReactNode
  className?: string
}) {
  const a = ALERT[tone]
  return (
    <div
      role={tone === 'block' ? 'alert' : undefined}
      className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${a.cls} ${className}`}
    >
      {a.icon}
      <div className="min-w-0 flex-1">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={title ? 'mt-0.5 opacity-90' : ''}>{children}</div>}
      </div>
      {action}
    </div>
  )
}

export function Feedback({ tone, children }: { tone: 'ok' | 'error'; children: ReactNode }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
        tone === 'ok' ? 'border-allow/30 bg-allow-soft text-accent-strong' : 'border-block/30 bg-block-soft text-block'
      }`}
    >
      {tone === 'ok' ? <IconCheck size={15} className="mt-0.5" /> : <IconAlertOctagon size={15} className="mt-0.5" />}
      <span className="min-w-0 break-words">{children}</span>
    </p>
  )
}

export function Spinner({ label = 'Loading…', className = '' }: { label?: string; className?: string }) {
  return (
    <div className={`flex items-center gap-2 p-6 text-sm text-muted ${className}`} role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      {label}
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  children,
  action,
  className = '',
}: {
  icon?: ReactNode
  title: ReactNode
  children?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={`flex flex-col items-center justify-center px-6 py-12 text-center ${className}`}>
      {icon && (
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-raised text-quiet">{icon}</div>
      )}
      <div className="text-sm font-semibold text-text">{title}</div>
      {children && <div className="mt-1 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/** Horizontal tab bar. Tabs are plain buttons with aria-pressed. */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className = '',
}: {
  tabs: { id: T; label: ReactNode; icon?: ReactNode }[]
  value: T
  onChange: (id: T) => void
  className?: string
}) {
  return (
    <div className={`flex gap-1 overflow-x-auto border-b border-edge ${className}`}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-pressed={value === t.id}
          onClick={() => onChange(t.id)}
          className={`-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
            value === t.id
              ? 'border-accent text-text'
              : 'border-transparent text-muted hover:border-edge-strong hover:text-text'
          }`}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  )
}

/** Compact pill switch between a few options. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { id: T; label: ReactNode }[]
  value: T
  onChange: (id: T) => void
  label?: string
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-edge bg-raised p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={`inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors ${
            value === o.id ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-edge bg-surface px-1 font-sans text-[10px] font-medium text-quiet">
      {children}
    </kbd>
  )
}

/** A monospace Kubernetes identifier, with the namespace part de-emphasized. */
export function ResourceName({
  namespace,
  name,
  className = '',
}: {
  namespace?: string
  name: ReactNode
  className?: string
}) {
  return (
    <span className={`font-mono text-[13px] ${className}`}>
      {namespace && <span className="text-quiet">{namespace}/</span>}
      <span className="text-text">{name}</span>
    </span>
  )
}

// ---------------------------------------------------------------- overlays

export function Modal({
  title,
  description,
  onClose,
  children,
  footer,
  wide,
}: {
  title: ReactNode
  description?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  useEffect(() => {
    // Move focus into the dialog for keyboard and screen-reader users.
    box.current?.focus()
  }, [])
  return (
    <div
      className="fixed inset-0 z-40 flex animate-fade-in items-center justify-center bg-overlay p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={box}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className={`flex max-h-[90vh] w-full animate-pop-in flex-col overflow-hidden rounded-2xl border border-edge bg-surface shadow-pop outline-none ${wide ? 'max-w-3xl' : 'max-w-lg'}`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-edge px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-text">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          <IconButton label="Close" onClick={onClose} className="-mr-1.5 -mt-1">
            <IconX size={16} />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-edge bg-raised/50 px-5 py-3">{footer}</div>
        )}
      </div>
    </div>
  )
}
