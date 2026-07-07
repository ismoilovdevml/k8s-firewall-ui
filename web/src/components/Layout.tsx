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
        <div className="border-b border-block/40 bg-block/10 px-4 py-2 font-mono text-sm text-block">
          Policies are not enforced on this cluster — CNI “{cni.provider}” accepts NetworkPolicies
          but ignores them. Everything below is theoretical until you install a policy engine.
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-52 shrink-0 flex-col border-r border-edge bg-surface">
          <div className="border-b border-edge px-4 py-4">
            <span className="font-mono text-sm font-semibold tracking-tight text-accent">
              k8s-firewall-ui
            </span>
          </div>
          <nav className="flex flex-col gap-1 p-2">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `rounded px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? 'bg-raised text-accent'
                      : 'text-muted hover:bg-raised/60 hover:text-text'
                  }`
                }
              >
                <span className="block font-medium">{item.label}</span>
                <span className="block text-xs text-quiet">{item.hint}</span>
              </NavLink>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>

      <footer className="flex items-center gap-4 border-t border-edge bg-surface px-4 py-1.5 font-mono text-xs text-muted">
        <span>cluster {info?.kubernetesVersion ?? '…'}</span>
        <span>·</span>
        <span>
          CNI {cni?.provider ?? '…'}{' '}
          {cni &&
            (cni.enforcesPolicies ? (
              <span className="text-allow">policies enforced ✓</span>
            ) : (
              <span className="text-block">policies NOT enforced ✗</span>
            ))}
        </span>
        {cni?.anpPresent && (
          <>
            <span>·</span>
            <span className="text-accent">ANP present (not evaluated)</span>
          </>
        )}
        <span className="ml-auto">{info?.appVersion ?? ''}</span>
      </footer>
    </div>
  )
}
