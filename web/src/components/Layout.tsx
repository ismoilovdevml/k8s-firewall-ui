import { Suspense } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useClusterInfo, useLogout, useMe } from '../api/queries'
import { useSSEInvalidation } from '../hooks/useSSEInvalidation'
import ErrorBoundary from './ErrorBoundary'
import { Spinner } from './ui'

const NAV = [
  { to: '/', label: 'Overview', hint: 'security posture' },
  { to: '/firewall', label: 'Firewall', hint: 'allow & block traffic' },
  { to: '/topology', label: 'Topology', hint: 'live traffic map' },
  { to: '/policies', label: 'Policies', hint: 'rules on the cluster' },
  { to: '/simulator', label: 'Simulator', hint: 'test a connection' },
  { to: '/builder', label: 'Builder', hint: 'draw a policy' },
  { to: '/audit', label: 'Audit log', hint: 'who changed what' },
]

export default function Layout() {
  useSSEInvalidation()
  const { data: info } = useClusterInfo()
  const cni = info?.cni
  const { data: me } = useMe()
  const logout = useLogout()
  const location = useLocation()

  return (
    <div className="flex h-screen flex-col">
      {cni && cni.provider === 'unknown' && (
        <div className="border-b border-warn bg-warn-bg/60 px-4 py-2 text-sm text-warn-text">
          ⚠ Could not identify the CNI, so NetworkPolicy enforcement is unverified. Confirm your CNI
          enforces policies (then start the server with <code>--cni-override</code>).
        </div>
      )}
      {cni && cni.provider !== 'unknown' && !cni.enforcesPolicies && (
        <div className="border-b border-warn bg-warn-bg px-4 py-2 text-sm font-medium text-warn-text">
          ⚠ Policies are not enforced on this cluster — CNI “{cni.provider}” accepts NetworkPolicies
          but ignores them. Everything below is theoretical until you install a policy engine.
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-56 shrink-0 flex-col bg-sidebar">
          <div className="px-4 py-5">
            <span className="font-mono text-sm font-bold tracking-tight text-sidebar-brand">
              🛡 k8s-firewall-ui
            </span>
          </div>
          <nav className="flex flex-col gap-1 px-3">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? 'bg-accent text-on-accent'
                      : 'text-sidebar-text hover:bg-sidebar-raised'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <span className="block font-semibold">{item.label}</span>
                    <span
                      className={`block text-xs ${isActive ? 'text-on-accent/70' : 'text-sidebar-text/60'}`}
                    >
                      {item.hint}
                    </span>
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="mt-auto space-y-2 p-3">
            {me?.user && me.mode !== 'none' && (
              <div className="rounded-lg bg-sidebar-raised p-3 text-xs text-sidebar-text">
                <div className="font-mono text-[10px] uppercase tracking-wide text-sidebar-text/60">
                  signed in as
                </div>
                <div className="mt-0.5 truncate font-semibold" title={me.user.name}>
                  {me.user.name}
                </div>
                {me.user.groups.length > 0 && (
                  <div className="truncate text-sidebar-text/60" title={me.user.groups.join(', ')}>
                    {me.user.groups.join(', ')}
                  </div>
                )}
                {me.restrictReads && (
                  <div
                    className="mt-1 text-[11px] text-sidebar-brand"
                    title="You see only namespaces where your RBAC allows listing NetworkPolicies"
                  >
                    scoped to your namespaces
                  </div>
                )}
                {me.mode === 'token' && (
                  <button
                    onClick={() => logout.mutate()}
                    className="mt-2 text-sidebar-brand hover:underline"
                  >
                    Sign out
                  </button>
                )}
              </div>
            )}
            <div className="rounded-lg bg-sidebar-raised p-3 font-mono text-xs text-sidebar-text">
              <div>cluster {info?.kubernetesVersion ?? '…'}</div>
              <div className="mt-1">
                CNI {cni?.provider ?? '…'}{' '}
                {cni &&
                  (cni.enforcesPolicies ? (
                    <span className="text-sidebar-brand">enforced ✓</span>
                  ) : cni.provider === 'unknown' ? (
                    <span className="text-warn-bg">unverified ?</span>
                  ) : (
                    <span className="font-semibold text-warn-bg">NOT enforced ✗</span>
                  ))}
              </div>
              {cni?.anpPresent && (
                <div className="mt-1 text-warn-bg">ANP present (not evaluated)</div>
              )}
              {info?.readOnly && <div className="mt-1 text-warn-bg">read-only mode</div>}
              {info?.appVersion && (
                <div className="mt-1 text-sidebar-text/60">{info.appVersion}</div>
              )}
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-auto">
          <ErrorBoundary key={location.pathname}>
            <Suspense fallback={<Spinner />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  )
}
