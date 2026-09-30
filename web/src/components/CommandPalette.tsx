import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useNamespaces, usePolicies } from '../api/queries'
import { setThemePref, useTheme } from '../theme'
import { NAV } from './nav'
import { IconCornerDownLeft, IconFileText, IconFlame, IconMoon, IconPlus, IconSearch, IconSun } from './icons'
import { Kbd } from './ui'

interface Command {
  id: string
  group: string
  label: string
  hint?: string
  icon: ReactNode
  keywords?: string
  run: () => void
}

/**
 * ⌘K / Ctrl+K quick switcher: jump to any page, policy or namespace
 * firewall without hunting through menus.
 */
export default function CommandPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const theme = useTheme()
  const { data: policies } = usePolicies()
  const { data: namespaces } = useNamespaces()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)

  const go = (to: string) => () => {
    navigate(to)
    onClose()
  }

  const commands = useMemo<Command[]>(() => {
    const out: Command[] = [
      ...NAV.map((n) => ({
        id: `page:${n.to}`,
        group: 'Pages',
        label: n.label,
        hint: n.hint,
        icon: n.icon,
        run: go(n.to),
      })),
      {
        id: 'action:new',
        group: 'Actions',
        label: 'Create a new policy',
        hint: 'From a template or blank',
        icon: <IconPlus size={18} />,
        keywords: 'add networkpolicy template',
        run: go('/policies/new'),
      },
      {
        id: 'action:theme',
        group: 'Actions',
        label: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
        icon: theme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />,
        keywords: 'theme dark light mode appearance',
        run: () => {
          setThemePref(theme === 'dark' ? 'light' : 'dark')
          onClose()
        },
      },
      ...(namespaces ?? [])
        .filter((n) => n.podCount > 0)
        .map((n) => ({
          id: `ns:${n.name}`,
          group: 'Namespace firewall',
          label: n.name,
          hint: `${n.podCount} pods · ${n.policyCount} policies`,
          icon: <IconFlame size={18} />,
          keywords: 'namespace firewall',
          run: go(`/firewall?namespace=${encodeURIComponent(n.name)}`),
        })),
      ...(policies ?? []).map((p) => ({
        id: `policy:${p.namespace}/${p.name}`,
        group: 'Policies',
        label: `${p.namespace}/${p.name}`,
        hint: p.policyTypes.join(' + '),
        icon: <IconFileText size={18} />,
        keywords: 'policy networkpolicy',
        run: go(`/policies/${p.namespace}/${p.name}`),
      })),
    ]
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policies, namespaces, theme])

  const shown = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
    const hits = commands.filter((c) => {
      const hay = `${c.label} ${c.hint ?? ''} ${c.group} ${c.keywords ?? ''}`.toLowerCase()
      return terms.every((t) => hay.includes(t))
    })
    // Without a query, keep the list short: pages and actions only.
    return terms.length === 0 ? hits.filter((c) => c.group === 'Pages' || c.group === 'Actions') : hits.slice(0, 60)
  }, [q, commands])

  useEffect(() => setActive(0), [q])
  useEffect(() => input.current?.focus(), [])
  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, shown.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      shown[active]?.run()
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  let lastGroup = ''
  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-start justify-center bg-overlay p-4 pt-[12vh] backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-xl animate-pop-in overflow-hidden rounded-2xl border border-edge bg-surface shadow-pop"
        onKeyDown={onKey}
      >
        <div className="flex items-center gap-3 border-b border-edge px-4">
          <IconSearch size={18} className="text-quiet" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search pages, policies, namespaces…"
            aria-label="Search commands"
            className="h-14 flex-1 bg-transparent text-[15px] text-text placeholder:text-quiet focus:outline-none"
          />
          <Kbd>Esc</Kbd>
        </div>
        <ul ref={list} className="max-h-[50vh] overflow-y-auto p-2">
          {shown.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : null
            lastGroup = c.group
            return (
              <li key={c.id}>
                {header && (
                  <div className="px-3 pb-1 pt-3 text-[11px] font-semibold text-quiet first:pt-1">{header}</div>
                )}
                <button
                  type="button"
                  data-active={i === active}
                  onMouseMove={() => setActive(i)}
                  onClick={c.run}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${
                    i === active ? 'bg-accent-soft text-text' : 'text-text'
                  }`}
                >
                  <span className={i === active ? 'text-accent-strong' : 'text-quiet'}>{c.icon}</span>
                  <span
                    className={`min-w-0 flex-1 truncate ${c.group === 'Policies' || c.group === 'Namespace firewall' ? 'font-mono text-[13px]' : 'font-medium'}`}
                  >
                    {c.label}
                  </span>
                  {c.hint && <span className="truncate text-xs text-quiet">{c.hint}</span>}
                  {i === active && <IconCornerDownLeft size={14} className="text-quiet" />}
                </button>
              </li>
            )
          })}
          {shown.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted">No matches for “{q}”.</li>}
        </ul>
        <div className="flex items-center gap-4 border-t border-edge bg-raised/50 px-4 py-2 text-[11px] text-quiet">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> navigate
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd> open
          </span>
        </div>
      </div>
    </div>
  )
}
