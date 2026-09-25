import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useNamespaceIsolation, usePosture } from '../api/queries'
import { errorMessage } from '../api/client'
import type { Finding, NamespacePosture, Severity } from '../api/types'
import { Badge, Button, Card, PageHeader, Spinner } from '../components/ui'
import { severityTone } from '../components/tone'

function pct(n: number, d: number) {
  return d === 0 ? 0 : Math.round((100 * n) / d)
}

function scoreTone(score: number) {
  return score >= 80 ? 'text-accent-strong' : score >= 50 ? 'text-warn-text' : 'text-block'
}

export default function OverviewPage() {
  const { data, isLoading, error } = usePosture()
  const [severity, setSeverity] = useState<Severity | 'all'>('all')
  const [showSystem, setShowSystem] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  const findings = useMemo(
    () => (data?.findings ?? []).filter((f) => severity === 'all' || f.severity === severity),
    [data, severity],
  )

  if (isLoading) return <Spinner />
  if (error) return <p className="p-6 text-sm text-block">{errorMessage(error)}</p>
  if (!data) return null
  const s = data.summary
  const namespaces = data.namespaces.filter((n) => showSystem || !n.system)

  return (
    <div className="space-y-5 p-6">
      <PageHeader
        title="Security overview"
        subtitle="How well the cluster's NetworkPolicies isolate workloads, and what to fix first. Figures cover application pods (system namespaces and hostNetwork pods excluded)."
        actions={
          <>
            <div className="flex items-center overflow-hidden rounded border border-edge bg-surface text-sm">
              <span className="px-2.5 py-1.5 text-muted">Report</span>
              {(['md', 'csv', 'json'] as const).map((f) => (
                <a
                  key={f}
                  href={`/api/v1/posture/report?format=${f}`}
                  download
                  className="border-l border-edge px-2.5 py-1.5 font-mono text-xs text-accent-strong hover:bg-raised"
                >
                  {f === 'md' ? 'Markdown' : f.toUpperCase()}
                </a>
              ))}
            </div>
            <Link to="/policies/new">
              <Button variant="primary">New policy</Button>
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card title="posture score">
          <div className={`text-4xl font-bold tabular-nums ${scoreTone(s.score)}`}>{s.score}</div>
          <p className="mt-1 text-xs text-muted">of 100 · 60% ingress + 40% egress coverage, minus findings</p>
        </Card>
        <CoverageTile label="ingress isolated" n={s.ingressIsolatedPods} d={s.pods} />
        <CoverageTile label="egress isolated" n={s.egressIsolatedPods} d={s.pods} />
        <Card title="findings">
          <div className="flex items-baseline gap-4 tabular-nums">
            <Count n={s.critical} label="critical" tone="text-block" />
            <Count n={s.warnings} label="warning" tone="text-warn-text" />
            <Count n={s.info} label="info" tone="text-muted" />
          </div>
          <p className="mt-1 text-xs text-muted">
            {s.policies} policies · {s.namespaces} namespaces
          </p>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-[3fr_2fr]">
        <Card
          title={
            <span className="flex items-center justify-between">
              <span>namespaces</span>
              <label className="flex items-center gap-1 normal-case tracking-normal">
                <input type="checkbox" checked={showSystem} onChange={(e) => setShowSystem(e.target.checked)} />
                show system
              </label>
            </span>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="font-mono text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="py-2 pr-3 font-medium">namespace</th>
                  <th className="py-2 pr-3 font-medium">pods</th>
                  <th className="py-2 pr-3 font-medium">ingress</th>
                  <th className="py-2 pr-3 font-medium">egress</th>
                  <th className="py-2 pr-3 font-medium">default-deny</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {namespaces.map((ns) => (
                  <NamespaceRow
                    key={ns.namespace}
                    ns={ns}
                    open={open === ns.namespace}
                    onToggle={() => setOpen(open === ns.namespace ? null : ns.namespace)}
                  />
                ))}
                {namespaces.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-muted">
                      No application namespaces.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card
          title={
            <span className="flex items-center justify-between gap-2">
              <span>findings ({findings.length})</span>
              <select
                aria-label="Filter findings by severity"
                value={severity}
                onChange={(e) => setSeverity(e.target.value as Severity | 'all')}
                className="rounded border border-edge bg-surface px-1.5 py-0.5 font-mono text-[11px] normal-case text-text"
              >
                <option value="all">all</option>
                <option value="critical">critical</option>
                <option value="warning">warning</option>
                <option value="info">info</option>
              </select>
            </span>
          }
        >
          <ul className="max-h-[32rem] space-y-2 overflow-auto pr-1">
            {findings.map((f, i) => (
              <FindingItem key={`${f.code}-${f.namespace}-${f.policy?.name}-${i}`} f={f} />
            ))}
            {findings.length === 0 && (
              <li className="py-6 text-center text-sm text-muted">Nothing to report. ✓</li>
            )}
          </ul>
        </Card>
      </div>
    </div>
  )
}

function Count({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <div>
      <div className={`text-2xl font-bold ${n > 0 ? tone : 'text-quiet'}`}>{n}</div>
      <div className="text-[11px] text-muted">{label}</div>
    </div>
  )
}

function CoverageTile({ label, n, d }: { label: string; n: number; d: number }) {
  const p = pct(n, d)
  return (
    <Card title={label}>
      <div className="text-4xl font-bold tabular-nums text-text">{p}%</div>
      <Meter value={p} />
      <p className="mt-1 text-xs text-muted">
        {n} of {d} pods
      </p>
    </Card>
  )
}

function Meter({ value, small }: { value: number; small?: boolean }) {
  return (
    <div
      role="meter"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      className={`mt-2 w-full overflow-hidden rounded-full bg-raised ${small ? 'h-1.5' : 'h-2'}`}
    >
      <div
        className={`h-full rounded-full ${value >= 80 ? 'bg-allow' : value >= 40 ? 'bg-warn' : 'bg-block'}`}
        style={{ width: `${Math.max(value, value > 0 ? 3 : 0)}%` }}
      />
    </div>
  )
}

function NamespaceRow({ ns, open, onToggle }: { ns: NamespacePosture; open: boolean; onToggle: () => void }) {
  const eligible = ns.pods - ns.hostNetworkPods
  const ing = pct(ns.ingressIsolatedPods, eligible)
  const eg = pct(ns.egressIsolatedPods, eligible)
  const needsDeny = eligible > 0 && !ns.defaultDenyIngress
  return (
    <>
      <tr className="border-t border-edge/60 align-middle">
        <td className="py-2 pr-3">
          <button onClick={onToggle} className="font-mono text-xs font-semibold text-accent-strong hover:underline">
            {open ? '▾' : '▸'} {ns.namespace}
          </button>
          {ns.system && <span className="ml-1 font-mono text-[10px] text-quiet">system</span>}
        </td>
        <td className="py-2 pr-3 font-mono text-xs text-muted">
          {ns.pods}
          {ns.hostNetworkPods > 0 && <span title="hostNetwork pods"> ({ns.hostNetworkPods} host)</span>}
        </td>
        <td className="w-28 py-2 pr-3">
          <span className="font-mono text-xs text-text">{eligible ? `${ing}%` : '—'}</span>
          {eligible > 0 && <Meter value={ing} small />}
        </td>
        <td className="w-28 py-2 pr-3">
          <span className="font-mono text-xs text-text">{eligible ? `${eg}%` : '—'}</span>
          {eligible > 0 && <Meter value={eg} small />}
        </td>
        <td className="py-2 pr-3">
          <div className="flex gap-1">
            <Badge tone={ns.defaultDenyIngress ? 'ok' : 'neutral'}>{ns.defaultDenyIngress ? '✓' : '✗'} in</Badge>
            <Badge tone={ns.defaultDenyEgress ? 'ok' : 'neutral'}>{ns.defaultDenyEgress ? '✓' : '✗'} out</Badge>
          </div>
        </td>
        <td className="py-2 text-right">
          {needsDeny && (
            <Link
              to={`/policies/new?template=default-deny-ingress&namespace=${encodeURIComponent(ns.namespace)}`}
              className="whitespace-nowrap text-xs font-medium text-accent-strong hover:underline"
            >
              Harden →
            </Link>
          )}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} className="pb-3">
            <IsolationTable namespace={ns.namespace} />
          </td>
        </tr>
      )}
    </>
  )
}

function IsolationTable({ namespace }: { namespace: string }) {
  const { data, isLoading } = useNamespaceIsolation(namespace)
  if (isLoading) return <Spinner />
  return (
    <div className="rounded-lg border border-edge bg-base p-2">
      <table className="w-full text-left text-xs">
        <thead className="font-mono text-[10px] uppercase tracking-wide text-quiet">
          <tr>
            <th className="px-2 py-1 font-medium">pod</th>
            <th className="px-2 py-1 font-medium">ingress policies</th>
            <th className="px-2 py-1 font-medium">egress policies</th>
          </tr>
        </thead>
        <tbody>
          {(data ?? []).map((p) => (
            <tr key={p.name} className="border-t border-edge/60">
              <td className="px-2 py-1 font-mono text-text">
                {p.name}
                {p.hostNetwork && <span className="ml-1 text-warn-text">hostNetwork</span>}
              </td>
              <PolicyCell refs={p.ingressPolicies} />
              <PolicyCell refs={p.egressPolicies} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PolicyCell({ refs }: { refs: { namespace: string; name: string }[] }) {
  if (refs.length === 0) return <td className="px-2 py-1 text-block">open (not isolated)</td>
  return (
    <td className="px-2 py-1">
      {refs.map((r, i) => (
        <span key={r.name}>
          {i > 0 && ', '}
          <Link to={`/policies/${r.namespace}/${r.name}`} className="font-mono text-accent-strong hover:underline">
            {r.name}
          </Link>
        </span>
      ))}
    </td>
  )
}

function FindingItem({ f }: { f: Finding }) {
  return (
    <li className="rounded-lg border border-edge/80 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={severityTone(f.severity)}>
          {f.severity === 'critical' ? '⛔' : f.severity === 'warning' ? '⚠' : 'ℹ'} {f.severity}
        </Badge>
        <span className="font-mono text-[11px] text-quiet">{f.code}</span>
      </div>
      <p className="mt-1.5 text-sm text-text">{f.message}</p>
      <div className="mt-1 font-mono text-xs text-muted">
        {f.policy ? (
          <Link to={`/policies/${f.policy.namespace}/${f.policy.name}`} className="text-accent-strong hover:underline">
            {f.policy.namespace}/{f.policy.name}
          </Link>
        ) : (
          f.namespace && <span>namespace {f.namespace}</span>
        )}
      </div>
    </li>
  )
}
