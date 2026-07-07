import { NavLink, Outlet } from 'react-router-dom'
import { useClusterInfo } from '../api/queries'
import { useSSEInvalidation } from '../hooks/useSSEInvalidation'

const NAV = [
  { to: '/', label: 'Topology', hint: 'live traffic map' },
  { to: '/policies', label: 'Policies', hint: 'rules on the cluster' },
  { to: '/simulator', label: 'Simulator', hint: 'test a connection' },
  { to: '/builder', label: 'Builder', hint: 'draw a policy' },
]

export default function Layout() {
  useSSEInvalidation()
  const { data: info } = useClusterInfo()
  const cni = info?.cni

  return (
    <div className="flex h-screen flex-col">
      {cni && !cni.enforcesPolicies && (
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

          <div className="mt-auto p-3">
            <div className="rounded-lg bg-sidebar-raised p-3 font-mono text-xs text-sidebar-text">
              <div>cluster {info?.kubernetesVersion ?? '…'}</div>
              <div className="mt-1">
                CNI {cni?.provider ?? '…'}{' '}
                {cni &&
                  (cni.enforcesPolicies ? (
                    <span className="text-sidebar-brand">enforced ✓</span>
                  ) : (
                    <span className="font-semibold text-warn-bg">NOT enforced ✗</span>
                  ))}
              </div>
              {cni?.anpPresent && (
                <div className="mt-1 text-warn-bg">ANP present (not evaluated)</div>
              )}
              {info?.appVersion && (
                <div className="mt-1 text-sidebar-text/60">{info.appVersion}</div>
              )}
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
