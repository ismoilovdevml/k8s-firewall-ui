import { Suspense, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useClusterInfo, useLogout, useMe } from '../api/queries'
import type { ClusterInfo } from '../api/types'
import { useSSEInvalidation } from '../hooks/useSSEInvalidation'
import { setThemePref, useThemePref } from '../theme'
import type { ThemePref } from '../theme'
import CommandPalette from './CommandPalette'
import ErrorBoundary from './ErrorBoundary'
import {
  IconAlertTriangle,
  IconChevronDown,
  IconLogOut,
  IconMenu,
  IconMonitor,
  IconMoon,
  IconPanelLeft,
  IconSearch,
  IconShieldCheck,
  IconSun,
  IconX,
} from './icons'
import { NAV_GROUPS, navFor } from './nav'
import { Badge, Dot, IconButton, Kbd, Spinner } from './ui'

const COLLAPSE_KEY = 'fwui-sidebar-collapsed'

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

export default function Layout() {
  useSSEInvalidation()
  const { data: info } = useClusterInfo()
  const cni = info?.cni
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [drawer, setDrawer] = useState(false)
  const [palette, setPalette] = useState(false)

  // Close the mobile drawer on navigation.
  useEffect(() => setDrawer(false), [location.pathname])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette((p) => !p)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1')
      } catch {
        /* storage blocked */
      }
      return !c
    })
  }

  const current = navFor(location.pathname)

  return (
    <div className="flex h-screen flex-col bg-base">
      {cni && cni.provider === 'unknown' && (
        <div className="flex items-center gap-2 border-b border-warn/40 bg-warn-bg px-4 py-2 text-sm text-warn-text">
          <IconAlertTriangle size={16} />
          <span>
            Could not identify the CNI, so NetworkPolicy enforcement is unverified. Confirm your CNI enforces policies
            (then start the server with <code className="font-mono text-xs">--cni-override</code>).
          </span>
        </div>
      )}
      {cni && cni.provider !== 'unknown' && !cni.enforcesPolicies && (
        <div className="flex items-center gap-2 border-b border-block/40 bg-block-soft px-4 py-2 text-sm font-medium text-block">
          <IconAlertTriangle size={16} />
          <span>
            Policies are not enforced on this cluster — CNI “{cni.provider}” accepts NetworkPolicies but ignores them.
            Everything below is theoretical until you install a policy engine.
          </span>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Desktop sidebar */}
        <aside
          className={`hidden shrink-0 flex-col border-r border-edge bg-sidebar transition-[width] duration-200 lg:flex ${
            collapsed ? 'w-[68px]' : 'w-64'
          }`}
        >
          <Sidebar collapsed={collapsed} onToggle={toggleCollapsed} />
        </aside>

        {/* Mobile drawer */}
        {drawer && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 animate-fade-in bg-overlay" onClick={() => setDrawer(false)} />
            <aside className="absolute inset-y-0 left-0 flex w-72 animate-slide-in flex-col border-r border-edge bg-sidebar shadow-pop">
              <Sidebar collapsed={false} onClose={() => setDrawer(false)} />
            </aside>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b border-edge bg-surface/80 px-3 backdrop-blur sm:px-4">
            <IconButton label="Open menu" className="lg:hidden" onClick={() => setDrawer(true)}>
              <IconMenu size={18} />
            </IconButton>
            <div className="flex min-w-0 items-center gap-2 text-sm">
              {current && <span className="text-quiet">{current.icon}</span>}
              <span className="truncate font-semibold text-text">{current?.label ?? 'k8s-firewall-ui'}</span>
              {current && <span className="hidden truncate text-muted md:inline">· {current.hint}</span>}
            </div>

            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPalette(true)}
                aria-label="Search (Ctrl+K)"
                className="flex h-9 items-center gap-2 rounded-lg border border-edge bg-base px-3 text-sm text-quiet transition-colors hover:border-edge-strong hover:text-muted sm:w-64"
              >
                <IconSearch size={15} />
                <span className="hidden flex-1 text-left sm:inline">Search or jump to…</span>
                <span className="hidden items-center gap-0.5 sm:flex">
                  <Kbd>Ctrl</Kbd>
                  <Kbd>K</Kbd>
                </span>
              </button>
              {info && <ClusterStatus info={info} />}
              <ThemeMenu />
            </div>
          </header>

          <main className="min-h-0 flex-1 overflow-auto">
            <ErrorBoundary key={location.pathname}>
              <Suspense fallback={<Spinner />}>
                <Outlet />
              </Suspense>
            </ErrorBoundary>
          </main>
        </div>
      </div>

      {palette && <CommandPalette onClose={() => setPalette(false)} />}
    </div>
  )
}

function Sidebar({
  collapsed,
  onToggle,
  onClose,
}: {
  collapsed: boolean
  onToggle?: () => void
  onClose?: () => void
}) {
  const { data: me } = useMe()
  const logout = useLogout()

  return (
    <>
      <div
        className={`flex h-14 shrink-0 items-center border-b border-edge ${collapsed ? 'justify-center' : 'justify-between px-4'}`}
      >
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-on-accent shadow-sm">
            <IconShieldCheck size={18} />
          </div>
          {!collapsed && (
            <div className="leading-tight">
              <div className="text-sm font-semibold text-text">Firewall UI</div>
              <div className="text-[11px] text-quiet">Kubernetes NetworkPolicy</div>
            </div>
          )}
        </div>
        {onClose && (
          <IconButton label="Close menu" onClick={onClose}>
            <IconX size={18} />
          </IconButton>
        )}
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {NAV_GROUPS.map((group) => (
          <div key={group.title}>
            {collapsed ? (
              <div className="mx-auto mb-2 h-px w-6 bg-edge" />
            ) : (
              <div className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-quiet">
                {group.title}
              </div>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  title={collapsed ? `${item.label} — ${item.hint}` : undefined}
                  aria-label={collapsed ? item.label : undefined}
                  className={({ isActive }) =>
                    `group relative flex items-center gap-3 rounded-lg py-2 text-sm transition-colors ${
                      collapsed ? 'justify-center px-0' : 'px-3'
                    } ${
                      isActive
                        ? 'bg-accent-soft text-accent-strong'
                        : 'text-sidebar-text hover:bg-sidebar-raised hover:text-text'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && !collapsed && (
                        <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-accent" />
                      )}
                      <span className={isActive ? 'text-accent-strong' : 'text-quiet group-hover:text-muted'}>
                        {item.icon}
                      </span>
                      {!collapsed && (
                        <span className="min-w-0">
                          <span className="block font-medium leading-5">{item.label}</span>
                          <span
                            className={`block truncate text-xs ${isActive ? 'text-accent-strong/75' : 'text-quiet'}`}
                          >
                            {item.hint}
                          </span>
                        </span>
                      )}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="space-y-2 border-t border-edge p-3">
        {me?.user && me.mode !== 'none' && !collapsed && (
          <div className="rounded-lg bg-sidebar-raised p-3 text-xs text-sidebar-text">
            <div className="text-[11px] text-quiet">Signed in as</div>
            <div className="mt-0.5 truncate font-semibold text-text" title={me.user.name}>
              {me.user.name}
            </div>
            {me.user.groups.length > 0 && (
              <div className="truncate text-quiet" title={me.user.groups.join(', ')}>
                {me.user.groups.join(', ')}
              </div>
            )}
            {me.restrictReads && (
              <div className="mt-1.5" title="You see only namespaces where your RBAC allows listing NetworkPolicies">
                <Badge tone="info">scoped to your namespaces</Badge>
              </div>
            )}
            {me.mode === 'token' && (
              <button
                onClick={() => logout.mutate()}
                className="mt-2 inline-flex items-center gap-1.5 font-medium text-accent-strong hover:underline"
              >
                <IconLogOut size={13} /> Sign out
              </button>
            )}
          </div>
        )}
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-quiet hover:bg-sidebar-raised hover:text-text ${
              collapsed ? 'justify-center px-0' : ''
            }`}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <IconPanelLeft size={16} />
            {!collapsed && 'Collapse'}
          </button>
        )}
      </div>
    </>
  )
}

/** Cluster health pill with a details popover. */
function ClusterStatus({ info }: { info: ClusterInfo }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false), open)
  const cni = info.cni
  const tone = cni.enforcesPolicies ? 'ok' : cni.provider === 'unknown' ? 'warn' : 'block'
  const status = cni.enforcesPolicies ? 'enforced' : cni.provider === 'unknown' ? 'unverified' : 'NOT enforced'

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex h-9 items-center gap-2 rounded-lg border border-edge bg-surface px-2.5 text-sm text-text transition-colors hover:border-edge-strong"
      >
        <Dot tone={tone} />
        <span className="hidden font-medium md:inline">{cni.provider}</span>
        {info.readOnly && <Badge tone="neutral">read-only</Badge>}
        <IconChevronDown size={14} className="text-quiet" />
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-30 w-72 animate-pop-in rounded-xl border border-edge bg-surface p-4 text-sm shadow-pop">
          <div className="text-xs font-semibold text-quiet">Cluster</div>
          <dl className="mt-2 space-y-2">
            <Row label="Kubernetes" value={<span className="font-mono text-xs">{info.kubernetesVersion}</span>} />
            <Row
              label="CNI"
              value={
                <span className="flex items-center gap-1.5">
                  <span className="font-mono text-xs">{cni.provider}</span>
                  <Badge tone={tone}>{status}</Badge>
                </span>
              }
            />
            {cni.anpPresent && (
              <Row label="AdminNetworkPolicy" value={<Badge tone="warn">present, not evaluated</Badge>} />
            )}
            {info.readOnly && <Row label="Mode" value={<Badge tone="neutral">read-only</Badge>} />}
            <Row label="App version" value={<span className="font-mono text-xs text-muted">{info.appVersion}</span>} />
          </dl>
          {cni.evidence && cni.evidence.length > 0 && (
            <div className="mt-3 border-t border-edge pt-3 text-xs text-muted">
              <div className="mb-1 font-medium text-quiet">Detected from</div>
              <ul className="space-y-0.5">
                {cni.evidence.map((e) => (
                  <li key={e} className="truncate font-mono" title={e}>
                    {e}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right text-text">{value}</dd>
    </div>
  )
}

const THEMES: { id: ThemePref; label: string; icon: React.ReactNode }[] = [
  { id: 'light', label: 'Light', icon: <IconSun size={15} /> },
  { id: 'dark', label: 'Dark', icon: <IconMoon size={15} /> },
  { id: 'system', label: 'System', icon: <IconMonitor size={15} /> },
]

function ThemeMenu() {
  const pref = useThemePref()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false), open)
  const current = THEMES.find((t) => t.id === pref) ?? THEMES[2]
  return (
    <div ref={ref} className="relative">
      <IconButton
        label={`Theme: ${current.label}`}
        onClick={() => setOpen((o) => !o)}
        className="h-9 w-9 border border-edge bg-surface"
      >
        {current.icon}
      </IconButton>
      {open && (
        <div className="absolute right-0 top-11 z-30 w-36 animate-pop-in rounded-xl border border-edge bg-surface p-1 shadow-pop">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setThemePref(t.id)
                setOpen(false)
              }}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm ${
                pref === t.id ? 'bg-accent-soft text-accent-strong' : 'text-text hover:bg-raised'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function useClickOutside(ref: React.RefObject<HTMLElement | null>, onOutside: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onOutside()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onOutside()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [ref, onOutside, active])
}
