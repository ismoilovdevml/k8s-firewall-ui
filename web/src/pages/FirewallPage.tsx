import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { errorMessage } from '../api/client'
import { useAccess, useNamespacePods, useNamespaces } from '../api/queries'
import type { AccessReport, AccessRow, FlowDirection, PlanRequest } from '../api/types'
import PlanDialog from '../components/firewall/PlanDialog'
import { deniedBy, peerId, rowStatus } from '../components/firewall/flow'
import { Badge, Button, Card, PageHeader, Spinner } from '../components/ui'

const selectCls =
  'rounded border border-edge bg-surface px-2 py-1.5 font-mono text-xs text-text focus:border-accent focus:outline-none'

type StatusFilter = 'all' | 'reachable' | 'blocked'

/**
 * Firewall console: pick a namespace, workload or pod and see — and change —
 * everything it can reach and everything that can reach it.
 */
export default function FirewallPage() {
  const [params, setParams] = useSearchParams()
  const namespace = params.get('namespace') ?? ''
  const workload = params.get('workload') ?? ''
  const { data: namespaces } = useNamespaces()
  const { data: pods } = useNamespacePods(namespace)
  const access = useAccess(namespace, workload)
  const [plan, setPlan] = useState<PlanRequest | null>(null)

  const workloads = useMemo(() => {
    const byOwner = new Map<string, number>()
    for (const p of pods ?? []) byOwner.set(p.owner, (byOwner.get(p.owner) ?? 0) + 1)
    return [...byOwner.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [pods])

  const pick = (ns: string, wl: string) => {
    const next = new URLSearchParams()
    if (ns) next.set('namespace', ns)
    if (wl) next.set('workload', wl)
    setParams(next, { replace: true })
  }

  const request = (direction: FlowDirection, row: AccessRow, action: 'allow' | 'block', ports?: PlanRequest['ports']): void =>
    setPlan({
      subject: { namespace, workload: workload || undefined },
      direction,
      peer: row.peer,
      action,
      ports,
      keepExternal: true,
    })

  return (
    <div className="space-y-5 p-6">
      <PageHeader
        title="Firewall"
        subtitle="Pick a namespace, workload or pod to see where it can connect, who can reach it, on which ports, and which policy decides. Allow or block any flow; every change is planned, verified by the simulator and shown as a diff before it is applied."
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-muted">
          <span className="mb-1 block font-mono uppercase tracking-wide text-quiet">namespace</span>
          <select aria-label="namespace" value={namespace} onChange={(e) => pick(e.target.value, '')} className={selectCls}>
            <option value="">choose…</option>
            {(namespaces ?? [])
              .filter((n) => n.podCount > 0)
              .map((n) => (
                <option key={n.name} value={n.name}>
                  {n.name}
                </option>
              ))}
          </select>
        </label>
        <label className="text-xs text-muted">
          <span className="mb-1 block font-mono uppercase tracking-wide text-quiet">workload</span>
          <select
            aria-label="workload"
            value={workload}
            disabled={!namespace}
            onChange={(e) => pick(namespace, e.target.value)}
            className={selectCls}
          >
            <option value="">whole namespace</option>
            {workloads.map(([owner, n]) => (
              <option key={owner} value={owner}>
                {owner} ({n} pod{n === 1 ? '' : 's'})
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted">
          <span className="mb-1 block font-mono uppercase tracking-wide text-quiet">or pod</span>
          <select
            aria-label="pod"
            value=""
            disabled={!namespace}
            onChange={(e) => {
              const pod = (pods ?? []).find((p) => p.name === e.target.value)
              if (pod) pick(namespace, pod.owner)
            }}
            className={selectCls}
          >
            <option value="">pick a pod…</option>
            {(pods ?? []).map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!namespace && (
        <Card>
          <p className="text-sm text-muted">Choose a namespace to open its firewall.</p>
        </Card>
      )}
      {access.isLoading && namespace && <Spinner />}
      {access.error && <p className="text-sm text-block">{errorMessage(access.error)}</p>}
      {access.data && <Report report={access.data} onRequest={request} onOpenWorkload={(wl) => pick(namespace, wl)} />}

      {plan && <PlanDialog request={plan} onClose={() => setPlan(null)} />}
    </div>
  )
}

function Report({
  report,
  onRequest,
  onOpenWorkload,
}: {
  report: AccessReport
  onRequest: (d: FlowDirection, row: AccessRow, action: 'allow' | 'block', ports?: PlanRequest['ports']) => void
  onOpenWorkload: (wl: string) => void
}) {
  const isNamespace = !report.subject.workload
  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-3">
        <Card title="subject">
          <div className="font-mono text-sm font-semibold text-text">
            {report.subject.namespace}
            {report.subject.workload && <span>/{report.subject.workload}</span>}
          </div>
          <p className="mt-1 text-xs text-muted">
            {report.pods.length} pod{report.pods.length === 1 ? '' : 's'}
            {report.ports && report.ports.length > 0 && (
              <> · listens on {report.ports.map((p) => `${p.port}/${p.protocol}${p.name ? ` (${p.name})` : ''}`).join(', ')}</>
            )}
          </p>
          {report.hostNetwork && (
            <p className="mt-1 text-xs text-warn-text">Runs on the host network — NetworkPolicy does not apply to it.</p>
          )}
          {isNamespace && report.workloads && report.workloads.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {report.workloads.map((wl) => (
                <button
                  key={wl}
                  onClick={() => onOpenWorkload(wl)}
                  className="rounded-full border border-edge px-2 py-0.5 font-mono text-[11px] text-accent-strong hover:border-accent"
                >
                  {wl}
                </button>
              ))}
            </div>
          )}
        </Card>
        <IsolationCard title="inbound (ingress)" isolated={report.ingressIsolated} policies={report.ingressPolicies} />
        <IsolationCard title="outbound (egress)" isolated={report.egressIsolated} policies={report.egressPolicies} />
      </div>

      <FlowTable
        title="Outbound — where it can connect"
        direction="outbound"
        rows={report.outbound}
        isNamespace={isNamespace}
        onRequest={onRequest}
      />
      <FlowTable
        title="Inbound — who can connect to it"
        direction="inbound"
        rows={report.inbound}
        isNamespace={isNamespace}
        onRequest={onRequest}
      />
    </div>
  )
}

function IsolationCard({ title, isolated, policies }: { title: string; isolated: boolean; policies: { namespace: string; name: string }[] }) {
  return (
    <Card title={title}>
      {isolated ? (
        <Badge tone="ok">isolated — default deny</Badge>
      ) : (
        <Badge tone="warn">open — no policy restricts it</Badge>
      )}
      {policies.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {policies.map((p) => (
            <li key={`${p.namespace}/${p.name}`}>
              <Link to={`/policies/${p.namespace}/${p.name}`} className="font-mono text-xs text-accent-strong hover:underline">
                {p.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function FlowTable({
  title,
  direction,
  rows,
  isNamespace,
  onRequest,
}: {
  title: string
  direction: FlowDirection
  rows: AccessRow[]
  isNamespace: boolean
  onRequest: (d: FlowDirection, row: AccessRow, action: 'allow' | 'block', ports?: PlanRequest['ports']) => void
}) {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [showSystem, setShowSystem] = useState(false)
  const [cidr, setCidr] = useState('')
  const [port, setPort] = useState('')

  const shown = rows.filter((r) => {
    const id = peerId(r.peer)
    if (q && !id.toLowerCase().includes(q.toLowerCase())) return false
    if (!showSystem && r.peer.namespace?.startsWith('kube-') && r.peer.label !== 'DNS') return false
    if (status === 'blocked' && r.verdict !== 'blocked') return false
    if (status === 'reachable' && r.verdict === 'blocked') return false
    return true
  })
  const blocked = rows.filter((r) => r.verdict === 'blocked').length

  const externalRow = (c: string): AccessRow => ({
    peer: { kind: 'external', cidr: c },
    verdict: 'unconstrained',
    egress: { applicable: false, isolated: false, allowed: false },
    ingress: { applicable: false, isolated: false, allowed: false },
  })
  const cidrValid = /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(cidr)
  const extPorts = port ? [{ protocol: 'TCP', port: Number(port) }] : undefined

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span>
            {title} · {rows.length - blocked} reachable · {blocked} blocked
          </span>
        </span>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          aria-label={`filter ${direction}`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter peers…"
          className={`${selectCls} w-56`}
        />
        <select aria-label={`status ${direction}`} value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className={selectCls}>
          <option value="all">all</option>
          <option value="reachable">reachable</option>
          <option value="blocked">blocked</option>
        </select>
        <label className="flex items-center gap-1 text-xs text-muted">
          <input type="checkbox" checked={showSystem} onChange={(e) => setShowSystem(e.target.checked)} />
          system namespaces
        </label>
        {!isNamespace && (
          <span className="ml-auto flex items-center gap-1">
            <input
              aria-label={`cidr ${direction}`}
              value={cidr}
              onChange={(e) => setCidr(e.target.value.trim())}
              placeholder="CIDR e.g. 203.0.113.0/24"
              className={`${selectCls} w-48`}
            />
            <input
              aria-label={`cidr port ${direction}`}
              value={port}
              onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))}
              placeholder="port"
              className={`${selectCls} w-16`}
            />
            <Button disabled={!cidrValid} onClick={() => onRequest(direction, externalRow(cidr), 'allow', extPorts)}>
              Allow CIDR
            </Button>
            <Button disabled={!cidrValid} onClick={() => onRequest(direction, externalRow(cidr), 'block')}>
              Block CIDR
            </Button>
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="font-mono text-[11px] uppercase tracking-wide text-muted">
            <tr>
              <th className="py-2 pr-3 font-medium">{direction === 'outbound' ? 'destination' : 'source'}</th>
              <th className="py-2 pr-3 font-medium">ports</th>
              <th className="py-2 pr-3 font-medium">status</th>
              <th className="py-2 pr-3 font-medium">decided by</th>
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <FlowRow key={peerId(row.peer)} row={row} direction={direction} onRequest={onRequest} />
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-muted">
                  No peers match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function FlowRow({
  row,
  direction,
  onRequest,
}: {
  row: AccessRow
  direction: FlowDirection
  onRequest: (d: FlowDirection, row: AccessRow, action: 'allow' | 'block', ports?: PlanRequest['ports']) => void
}) {
  const st = rowStatus(row)
  const rules = [...(row.egress.rules ?? []), ...(row.ingress.rules ?? [])]
  const reason = row.verdict === 'blocked' ? deniedBy(row) : ''
  const canAllow = row.verdict === 'blocked' || row.verdict === 'partial'
  const canBlock = row.verdict !== 'blocked'
  return (
    <tr className="border-t border-edge/60 align-top" data-peer={peerId(row.peer)}>
      <td className="py-2 pr-3">
        <div className="font-mono text-xs text-text">
          {row.peer.kind === 'workload' ? (
            <>
              <span className="text-muted">{row.peer.namespace}/</span>
              {row.peer.workload}
            </>
          ) : row.peer.kind === 'namespace' ? (
            <>namespace {row.peer.namespace}</>
          ) : (
            <>{row.peer.cidr}</>
          )}
        </div>
        {row.peer.label && <Badge tone="info">{row.peer.label}</Badge>}
        {row.peer.kind === 'external' && !row.peer.label && <Badge tone="neutral">external</Badge>}
      </td>
      <td className="py-2 pr-3">
        {row.ports && row.ports.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {row.ports.map((p) => (
              <span
                key={`${p.protocol}${p.port}`}
                title={p.name}
                className={`rounded px-1.5 py-0.5 font-mono text-[11px] ${p.allowed ? 'bg-accent/10 text-accent-strong' : 'bg-block/10 text-block'}`}
              >
                {p.allowed ? '✓' : '✕'} {p.port}/{p.protocol}
              </span>
            ))}
          </div>
        ) : row.counts ? (
          <span className="font-mono text-[11px] text-muted">
            {row.counts.allowed + row.counts.unconstrained}/{row.counts.allowed + row.counts.unconstrained + row.counts.blocked} pairs open
          </span>
        ) : (
          <span className="font-mono text-[11px] text-quiet">any</span>
        )}
      </td>
      <td className="py-2 pr-3">
        <Badge tone={st.tone}>{st.label}</Badge>
        {reason && <div className="mt-0.5 text-[11px] text-block">{reason}</div>}
      </td>
      <td className="py-2 pr-3">
        {rules.length > 0 ? (
          <ul className="space-y-0.5">
            {rules.map((m) => (
              <li key={`${m.policy.namespace}/${m.policy.name}/${m.ruleIndex}`}>
                <Link
                  to={`/policies/${m.policy.namespace}/${m.policy.name}`}
                  title={m.explanation}
                  className="font-mono text-[11px] text-accent-strong hover:underline"
                >
                  {m.policy.namespace}/{m.policy.name} #{m.ruleIndex + 1}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-[11px] text-quiet">{row.verdict === 'unconstrained' ? 'no policy applies' : '—'}</span>
        )}
      </td>
      <td className="whitespace-nowrap py-2 text-right">
        {canAllow && (
          <Button variant="primary" className="px-2 py-1 text-xs" onClick={() => onRequest(direction, row, 'allow')}>
            Allow
          </Button>
        )}{' '}
        {canBlock && (
          <Button className="px-2 py-1 text-xs hover:border-block hover:text-block" onClick={() => onRequest(direction, row, 'block')}>
            Block
          </Button>
        )}
      </td>
    </tr>
  )
}
