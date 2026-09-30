import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { errorMessage } from '../api/client'
import { useAccess, useNamespacePods, useNamespaces } from '../api/queries'
import type { AccessReport, AccessRow, FlowDirection, PlanRequest } from '../api/types'
import PlanDialog from '../components/firewall/PlanDialog'
import ObservedCard from '../components/firewall/ObservedCard'
import { deniedBy, peerId, rowStatus } from '../components/firewall/flow'
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  Input,
  Page,
  PageHeader,
  SearchInput,
  Segmented,
  Select,
  Spinner,
  THead,
  Table,
} from '../components/ui'
import { td, th } from '../components/styles'
import {
  IconArrowRight,
  IconBox,
  IconFlame,
  IconGlobe,
  IconLayers,
  IconLock,
  IconUnlock,
  IconX,
} from '../components/icons'

type StatusFilter = 'all' | 'reachable' | 'blocked'
type OnRequest = (d: FlowDirection, row: AccessRow, action: 'allow' | 'block', ports?: PlanRequest['ports']) => void

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
  const [learn, setLearn] = useState<FlowDirection | null>(null)

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

  const request: OnRequest = (direction, row, action, ports) =>
    setPlan({
      subject: { namespace, workload: workload || undefined },
      direction,
      peer: row.peer,
      action,
      ports,
      keepExternal: true,
    })

  const withPods = (namespaces ?? []).filter((n) => n.podCount > 0)

  return (
    <Page>
      <PageHeader
        icon={<IconFlame size={20} />}
        title="Firewall"
        subtitle="See where a namespace or workload can connect, who can reach it, and which policy decides. Allow or block any flow — every change is planned, verified by the simulator and shown as a diff before it is applied."
      />

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="1 · Namespace">
            <Select
              aria-label="namespace"
              mono
              value={namespace}
              onChange={(e) => pick(e.target.value, '')}
              className="w-52"
            >
              <option value="">choose…</option>
              {withPods.map((n) => (
                <option key={n.name} value={n.name}>
                  {n.name}
                </option>
              ))}
            </Select>
          </Field>
          <IconArrowRight size={16} className="mb-2.5 hidden text-quiet sm:block" />
          <Field label="2 · Workload (optional)">
            <Select
              aria-label="workload"
              mono
              value={workload}
              disabled={!namespace}
              onChange={(e) => pick(namespace, e.target.value)}
              className="w-80"
            >
              <option value="">whole namespace</option>
              {workloads.map(([owner, n]) => (
                <option key={owner} value={owner}>
                  {owner} ({n} pod{n === 1 ? '' : 's'})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="or pick a pod">
            <Select
              aria-label="pod"
              mono
              value=""
              disabled={!namespace}
              onChange={(e) => {
                const pod = (pods ?? []).find((p) => p.name === e.target.value)
                if (pod) pick(namespace, pod.owner)
              }}
              className="w-56"
            >
              <option value="">pick a pod…</option>
              {(pods ?? []).map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          {namespace && (
            <Button variant="ghost" className="mb-0.5" icon={<IconX size={15} />} onClick={() => pick('', '')}>
              Clear
            </Button>
          )}
        </div>
      </Card>

      {!namespace && (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-text">Or open a namespace</h2>
          {withPods.length === 0 ? (
            <Card>
              <EmptyState icon={<IconLayers size={22} />} title="No namespaces with pods">
                Deploy a workload to see its firewall here.
              </EmptyState>
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {withPods.map((n) => (
                <button
                  key={n.name}
                  type="button"
                  onClick={() => pick(n.name, '')}
                  className="group flex items-center gap-3 rounded-xl border border-edge bg-surface p-4 text-left shadow-card transition-all hover:border-accent/50 hover:shadow-pop"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-raised text-muted group-hover:bg-accent-soft group-hover:text-accent-strong">
                    <IconLayers size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-sm font-semibold text-text">{n.name}</div>
                    <div className="text-xs text-muted">
                      {n.podCount} pod{n.podCount === 1 ? '' : 's'} · {n.policyCount} polic
                      {n.policyCount === 1 ? 'y' : 'ies'}
                    </div>
                  </div>
                  <IconArrowRight size={16} className="text-quiet group-hover:text-accent-strong" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {access.isLoading && namespace && <Spinner />}
      {access.error && <Alert tone="block">{errorMessage(access.error)}</Alert>}
      {access.data && <Summary report={access.data} onOpenWorkload={(wl) => pick(namespace, wl)} />}
      {access.data && (
        <ObservedCard subject={{ namespace, workload: workload || undefined }} onLearn={(d) => setLearn(d)} />
      )}
      {access.data && <Flows report={access.data} onRequest={request} />}

      {plan && <PlanDialog request={plan} onClose={() => setPlan(null)} />}
      {learn && (
        <PlanDialog
          learn={{ subject: { namespace, workload: workload || undefined }, direction: learn }}
          onClose={() => setLearn(null)}
        />
      )}
    </Page>
  )
}

function Summary({ report, onOpenWorkload }: { report: AccessReport; onOpenWorkload: (wl: string) => void }) {
  const isNamespace = !report.subject.workload
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card>
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-strong">
            {isNamespace ? <IconLayers size={18} /> : <IconBox size={18} />}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-medium text-muted">{isNamespace ? 'Namespace' : 'Workload'}</div>
            <div className="break-words font-mono text-sm font-semibold text-text">
              {report.subject.namespace}
              {report.subject.workload && <span>/{report.subject.workload}</span>}
            </div>
            <p className="mt-1 text-xs text-muted">
              {report.pods.length} pod{report.pods.length === 1 ? '' : 's'}
              {report.ports && report.ports.length > 0 && (
                <>
                  {' '}
                  · listens on{' '}
                  {report.ports.map((p) => `${p.port}/${p.protocol}${p.name ? ` (${p.name})` : ''}`).join(', ')}
                </>
              )}
            </p>
          </div>
        </div>
        {report.hostNetwork && (
          <Alert tone="warn" className="mt-3">
            Runs on the host network — NetworkPolicy does not apply to it.
          </Alert>
        )}
        {isNamespace && report.workloads && report.workloads.length > 0 && (
          <div className="mt-3 border-t border-edge pt-3">
            <div className="mb-1.5 text-xs text-muted">Drill into a workload</div>
            <div className="flex flex-wrap gap-1.5">
              {report.workloads.map((wl) => (
                <button
                  key={wl}
                  onClick={() => onOpenWorkload(wl)}
                  className="rounded-md border border-edge bg-raised/50 px-2 py-0.5 font-mono text-[11px] text-text hover:border-accent hover:text-accent-strong"
                >
                  {wl}
                </button>
              ))}
            </div>
          </div>
        )}
      </Card>
      <IsolationCard title="Inbound (ingress)" isolated={report.ingressIsolated} policies={report.ingressPolicies} />
      <IsolationCard title="Outbound (egress)" isolated={report.egressIsolated} policies={report.egressPolicies} />
    </div>
  )
}

function IsolationCard({
  title,
  isolated,
  policies,
}: {
  title: string
  isolated: boolean
  policies: { namespace: string; name: string }[]
}) {
  return (
    <Card>
      <div className="flex items-start gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
            isolated ? 'bg-allow-soft text-accent-strong' : 'bg-warn-bg text-warn-text'
          }`}
        >
          {isolated ? <IconLock size={18} /> : <IconUnlock size={18} />}
        </div>
        <div className="min-w-0">
          <div className="text-xs font-medium text-muted">{title}</div>
          <div className="mt-1">
            {isolated ? (
              <Badge tone="ok">isolated — default deny</Badge>
            ) : (
              <Badge tone="warn">open — no policy restricts it</Badge>
            )}
          </div>
        </div>
      </div>
      {policies.length > 0 && (
        <div className="mt-3 border-t border-edge pt-3">
          <div className="mb-1 text-xs text-muted">Selected by</div>
          <ul className="space-y-0.5">
            {policies.map((p) => (
              <li key={`${p.namespace}/${p.name}`}>
                <Link
                  to={`/policies/${p.namespace}/${p.name}`}
                  className="font-mono text-xs text-accent-strong hover:underline"
                >
                  {p.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}

function Flows({ report, onRequest }: { report: AccessReport; onRequest: OnRequest }) {
  const isNamespace = !report.subject.workload
  return (
    <div className="space-y-6">
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
  onRequest: OnRequest
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
      flush
      title={title}
      description={
        <span className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-allow" /> {rows.length - blocked} reachable
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-block" /> {blocked} blocked
          </span>
        </span>
      }
    >
      <div className="flex flex-wrap items-center gap-2 border-t border-edge px-4 py-3">
        <SearchInput
          aria-label={`filter ${direction}`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter peers…"
          className="w-full sm:w-56"
        />
        <Segmented
          label={`status ${direction}`}
          value={status}
          onChange={setStatus}
          options={[
            { id: 'all', label: 'All' },
            { id: 'reachable', label: 'Reachable' },
            { id: 'blocked', label: 'Blocked' },
          ]}
        />
        <Checkbox
          label="system namespaces"
          checked={showSystem}
          onChange={(e) => setShowSystem(e.target.checked)}
          className="text-xs text-muted"
        />
      </div>
      {!isNamespace && (
        <div className="flex flex-wrap items-center gap-2 border-t border-edge bg-raised/40 px-4 py-3">
          <IconGlobe size={15} className="text-quiet" />
          <span className="text-xs font-medium text-muted">
            {direction === 'outbound' ? 'External destination' : 'External source'}
          </span>
          <Input
            mono
            aria-label={`cidr ${direction}`}
            value={cidr}
            onChange={(e) => setCidr(e.target.value.trim())}
            placeholder="CIDR e.g. 203.0.113.0/24"
            className="h-8 w-52"
          />
          <Input
            mono
            aria-label={`cidr port ${direction}`}
            value={port}
            onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))}
            placeholder="port"
            className="h-8 w-20"
          />
          <Button
            size="sm"
            variant="primary"
            disabled={!cidrValid}
            onClick={() => onRequest(direction, externalRow(cidr), 'allow', extPorts)}
          >
            Allow CIDR
          </Button>
          <Button
            size="sm"
            variant="danger-outline"
            disabled={!cidrValid}
            onClick={() => onRequest(direction, externalRow(cidr), 'block')}
          >
            Block CIDR
          </Button>
        </div>
      )}

      <Table>
        <THead>
          <th className={th}>{direction === 'outbound' ? 'Destination' : 'Source'}</th>
          <th className={th}>Ports</th>
          <th className={th}>Status</th>
          <th className={th}>Decided by</th>
          <th className={th} />
        </THead>
        <tbody>
          {shown.map((row) => (
            <FlowRow key={peerId(row.peer)} row={row} direction={direction} onRequest={onRequest} />
          ))}
          {shown.length === 0 && (
            <tr>
              <td colSpan={5}>
                <EmptyState title="No peers match">Change the filters above to see more connections.</EmptyState>
              </td>
            </tr>
          )}
        </tbody>
      </Table>
    </Card>
  )
}

function FlowRow({ row, direction, onRequest }: { row: AccessRow; direction: FlowDirection; onRequest: OnRequest }) {
  const st = rowStatus(row)
  const rules = [...(row.egress.rules ?? []), ...(row.ingress.rules ?? [])]
  const reason = row.verdict === 'blocked' ? deniedBy(row) : ''
  const canAllow = row.verdict === 'blocked' || row.verdict === 'partial'
  const canBlock = row.verdict !== 'blocked'
  return (
    <tr
      className="border-b border-edge/70 transition-colors last:border-0 hover:bg-raised/40"
      data-peer={peerId(row.peer)}
    >
      <td className={td}>
        <div className="flex flex-wrap items-center gap-1.5">
          {row.peer.kind === 'workload' ? (
            <span className="font-mono text-[13px]">
              <span className="text-quiet">{row.peer.namespace}/</span>
              <span className="text-text">{row.peer.workload}</span>
            </span>
          ) : row.peer.kind === 'namespace' ? (
            <span className="text-[13px] text-text">
              namespace <span className="font-mono">{row.peer.namespace}</span>
            </span>
          ) : (
            <span className="font-mono text-[13px] text-text">{row.peer.cidr}</span>
          )}
          {row.peer.label && <Badge tone="info">{row.peer.label}</Badge>}
          {row.peer.kind === 'external' && !row.peer.label && <Badge tone="neutral">external</Badge>}
        </div>
      </td>
      <td className={td}>
        {row.ports && row.ports.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {row.ports.map((p) => (
              <span
                key={`${p.protocol}${p.port}`}
                title={p.name}
                className={`rounded-md px-1.5 py-0.5 font-mono text-[11px] font-medium ${
                  p.allowed ? 'bg-allow-soft text-accent-strong' : 'bg-block-soft text-block'
                }`}
              >
                {p.allowed ? '✓' : '✕'} {p.port}/{p.protocol}
              </span>
            ))}
          </div>
        ) : row.counts ? (
          <span className="text-xs text-muted">
            {row.counts.allowed + row.counts.unconstrained}/
            {row.counts.allowed + row.counts.unconstrained + row.counts.blocked} pairs open
          </span>
        ) : (
          <span className="text-xs text-quiet">any</span>
        )}
      </td>
      <td className={td}>
        <Badge tone={st.tone} dot>
          {st.label}
        </Badge>
        {reason && <div className="mt-1 text-xs text-block">{reason}</div>}
      </td>
      <td className={td}>
        {rules.length > 0 ? (
          <ul className="space-y-0.5">
            {rules.map((m) => (
              <li key={`${m.policy.namespace}/${m.policy.name}/${m.ruleIndex}`}>
                <Link
                  to={`/policies/${m.policy.namespace}/${m.policy.name}`}
                  title={m.explanation}
                  className="font-mono text-xs text-accent-strong hover:underline"
                >
                  {m.policy.namespace}/{m.policy.name} #{m.ruleIndex + 1}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-xs text-quiet">{row.verdict === 'unconstrained' ? 'no policy applies' : '—'}</span>
        )}
      </td>
      <td className={`${td} whitespace-nowrap text-right`}>
        <div className="flex justify-end gap-1.5">
          {canAllow && (
            <Button size="xs" variant="primary" onClick={() => onRequest(direction, row, 'allow')}>
              Allow
            </Button>
          )}
          {canBlock && (
            <Button size="xs" variant="danger-outline" onClick={() => onRequest(direction, row, 'block')}>
              Block
            </Button>
          )}
        </div>
      </td>
    </tr>
  )
}
