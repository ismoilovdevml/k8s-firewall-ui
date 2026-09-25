import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { errorMessage } from '../api/client'
import { useImpact } from '../api/queries'
import type { ImpactRequest } from '../api/queries'
import type { ImpactEdge } from '../api/types'
import { Button } from './ui'

/**
 * "What changes if I do this?" — runs the simulator over every workload
 * pair touched by the change and lists connections that flip between
 * reachable and blocked. `request` is evaluated on demand (button) or
 * immediately when `auto` is set.
 */
export default function ImpactPanel({ request, auto }: { request: ImpactRequest | null; auto?: boolean }) {
  const impact = useImpact()
  const key = request ? JSON.stringify(request) : ''

  useEffect(() => {
    impact.reset()
    if (auto && request) impact.mutate(request)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, auto])

  const res = impact.data
  return (
    <section className="rounded-xl border border-edge bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-mono text-[11px] uppercase tracking-wide text-quiet">impact preview</h2>
          <p className="text-xs text-muted">Which workload connections change if this is applied.</p>
        </div>
        {!auto && (
          <Button onClick={() => request && impact.mutate(request)} disabled={!request || impact.isPending}>
            {impact.isPending ? 'Analyzing…' : res ? 'Re-run' : 'Preview impact'}
          </Button>
        )}
      </div>

      {impact.isPending && auto && <p className="mt-3 text-xs text-muted">Analyzing…</p>}
      {impact.isError && <p className="mt-3 font-mono text-xs text-block">{errorMessage(impact.error)}</p>}
      {res && (
        <div className="mt-3 space-y-3 text-sm">
          <p className="text-text">
            Affects <strong>{res.selectedWorkloads.length}</strong> workload(s):{' '}
            <span className="font-semibold text-block">{res.newlyBlocked.length} connection(s) become blocked</span>,{' '}
            <span className="font-semibold text-accent-strong">{res.newlyAllowed.length} become allowed</span>.
            {res.truncated && <span className="text-warn-text"> (analysis truncated — cluster too large)</span>}
          </p>
          {res.newlyBlocked.length === 0 && res.newlyAllowed.length === 0 && (
            <p className="text-xs text-muted">
              No reachability changes between existing workloads. The preview compares any-port reachability, so
              port-only changes and traffic to/from external IPs are not reflected — use the simulator for a
              specific port.
            </p>
          )}
          <EdgeList title="newly blocked" tone="text-block" edges={res.newlyBlocked} />
          <EdgeList title="newly allowed" tone="text-accent-strong" edges={res.newlyAllowed} />
        </div>
      )}
    </section>
  )
}

function EdgeList({ title, tone, edges }: { title: string; tone: string; edges: ImpactEdge[] }) {
  if (edges.length === 0) return null
  const shown = edges.slice(0, 50)
  return (
    <div>
      <h3 className={`font-mono text-[11px] uppercase tracking-wide ${tone}`}>{title}</h3>
      <ul className="mt-1 max-h-48 space-y-0.5 overflow-auto font-mono text-xs text-text">
        {shown.map((e) => (
          <li key={`${e.source}->${e.target}`}>
            {e.source} <span className={tone}>→</span> {e.target}
          </li>
        ))}
      </ul>
      {edges.length > shown.length && (
        <p className="mt-1 text-xs text-muted">
          …and {edges.length - shown.length} more. Use the{' '}
          <Link to="/topology" className="text-accent-strong hover:underline">
            topology view
          </Link>{' '}
          after applying.
        </p>
      )}
    </div>
  )
}
