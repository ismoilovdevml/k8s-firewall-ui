import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { errorMessage } from '../api/client'
import { useImpact } from '../api/queries'
import type { ImpactRequest } from '../api/queries'
import type { ImpactEdge } from '../api/types'
import { IconActivity, IconArrowRight } from './icons'
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
    <section className="rounded-xl border border-edge bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-info-soft text-info">
            <IconActivity size={16} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-text">Impact preview</h2>
            <p className="text-xs text-muted">Which workload connections change if this is applied.</p>
          </div>
        </div>
        {!auto && (
          <Button size="sm" onClick={() => request && impact.mutate(request)} disabled={!request || impact.isPending}>
            {impact.isPending ? 'Analyzing…' : res ? 'Re-run' : 'Preview impact'}
          </Button>
        )}
      </div>

      {impact.isPending && auto && <p className="mt-3 text-xs text-muted">Analyzing…</p>}
      {impact.isError && (
        <p className="mt-3 rounded-lg bg-block-soft px-3 py-2 text-xs text-block">{errorMessage(impact.error)}</p>
      )}
      {!res && !impact.isPending && !auto && (
        <p className="mt-3 text-xs text-quiet">
          {request
            ? 'Run a preview before applying to catch connections you would break.'
            : 'Fill in a name and namespace to enable the preview.'}
        </p>
      )}
      {res && (
        <div className="mt-4 space-y-3 text-sm">
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat n={res.selectedWorkloads.length} label="workloads" />
            <Stat n={res.newlyBlocked.length} label="blocked" tone="text-block" />
            <Stat n={res.newlyAllowed.length} label="allowed" tone="text-accent-strong" />
          </div>
          <p className="text-text">
            Affects <strong>{res.selectedWorkloads.length}</strong> workload(s):{' '}
            <span className="font-semibold text-block">{res.newlyBlocked.length} connection(s) become blocked</span>,{' '}
            <span className="font-semibold text-accent-strong">{res.newlyAllowed.length} become allowed</span>.
            {res.truncated && <span className="text-warn-text"> (analysis truncated — cluster too large)</span>}
          </p>
          {res.newlyBlocked.length === 0 && res.newlyAllowed.length === 0 && (
            <p className="text-xs text-muted">
              No reachability changes between existing workloads. The preview compares any-port reachability, so
              port-only changes and traffic to/from external IPs are not reflected — use the simulator for a specific
              port.
            </p>
          )}
          <EdgeList title="Newly blocked" tone="text-block" edges={res.newlyBlocked} />
          <EdgeList title="Newly allowed" tone="text-accent-strong" edges={res.newlyAllowed} />
        </div>
      )}
    </section>
  )
}

function Stat({ n, label, tone = 'text-text' }: { n: number; label: string; tone?: string }) {
  return (
    <div className="rounded-lg bg-raised/70 py-2">
      <div className={`text-lg font-bold tabular-nums ${n === 0 ? 'text-quiet' : tone}`}>{n}</div>
      <div className="text-[11px] text-muted">{label}</div>
    </div>
  )
}

function EdgeList({ title, tone, edges }: { title: string; tone: string; edges: ImpactEdge[] }) {
  if (edges.length === 0) return null
  const shown = edges.slice(0, 50)
  return (
    <div>
      <h3 className={`text-xs font-semibold ${tone}`}>{title}</h3>
      <ul className="mt-1.5 max-h-48 space-y-1 overflow-auto rounded-lg border border-edge bg-sunken p-2 font-mono text-xs text-text">
        {shown.map((e) => (
          <li key={`${e.source}->${e.target}`} className="flex items-center gap-1.5">
            <span className="truncate">{e.source}</span>
            <IconArrowRight size={12} className={tone} />
            <span className="truncate">{e.target}</span>
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
