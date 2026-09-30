// Class-name helpers shared by the UI primitives and pages (kept out of
// ui.tsx so that file only exports components).

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'danger-outline' | 'ghost'
export type ButtonSize = 'xs' | 'sm' | 'md'

const BUTTON: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-on-accent font-semibold shadow-sm hover:bg-accent-strong dark:hover:brightness-110 dark:hover:bg-accent',
  secondary: 'border border-edge bg-surface text-text font-medium shadow-sm hover:border-edge-strong hover:bg-raised',
  danger: 'bg-block text-white font-semibold shadow-sm hover:brightness-110 dark:text-base',
  'danger-outline': 'border border-block/40 bg-surface text-block font-medium hover:bg-block-soft',
  ghost: 'text-muted font-medium hover:bg-raised hover:text-text',
}

const SIZE: Record<ButtonSize, string> = {
  xs: 'h-7 gap-1 rounded-md px-2 text-xs',
  sm: 'h-8 gap-1.5 rounded-md px-2.5 text-[13px]',
  md: 'h-9 gap-2 rounded-lg px-3.5 text-sm',
}

export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', className = '') {
  return `inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50 ${SIZE[size]} ${BUTTON[variant]} ${className}`
}

export const th = 'px-4 py-2.5 text-left text-xs font-medium text-muted whitespace-nowrap'
export const td = 'px-4 py-3 align-middle'
