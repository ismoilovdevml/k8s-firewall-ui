import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useNamespaceIsolation, usePosture } from '../api/queries'
import { errorMessage } from '../api/client'
import type { Finding, NamespacePosture, Severity } from '../api/types'
import {
  Alert,
  Badge,
  Card,
  Checkbox,
  EmptyState,
  Page,
  PageHeader,
  Select,
  Spinner,
  THead,
  Table,
} from '../components/ui'
import { buttonClass, td, th } from '../components/styles'
import { severityTone } from '../components/tone'
import {
  IconAlertOctagon,
  IconAlertTriangle,
  IconArrowRight,
  IconCheck,
  IconChevronRight,
  IconDownload,
  IconGauge,
  IconInfo,
  IconLock,
  IconPlus,
  IconShieldCheck,
  IconX,
} from '../components/icons'

function pct(n: number, d: number) {
  return d === 0 ? 0 : Math.round((100 * n) / d)
}

function scoreGrade(score: number): { label: string; color: string; hint: string } {
  if (score >= 80)
    return { label: 'Strong', color: 'var(--color-allow)', hint: 'Most workloads are isolated. Keep it that way.' }
  if (score >= 50)
    return { label: 'Fair', color: 'var(--color-warn)', hint: 'Some workloads accept traffic from anywhere.' }
  return {
    label: 'At risk',
    color: 'var(--color-block)',
    hint: 'Many workloads are wide open. Start with default-deny.',
  }
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
  if (error)
    return (
      <Page>
        <Alert tone="block" title="Could not load the posture report">
          {errorMessage(error)}
        </Alert>
      </Page>
    )
  if (!data) return null
  const s = data.summary
  const namespaces = data.namespaces.filter((n) => showSystem || !n.system)
  const unprotected = data.namespaces.filter(
    (n) => !n.system && n.pods - n.hostNetworkPods > 0 && !n.defaultDenyIngress,
  )
  const grade = scoreGrade(s.score)

  return (
    <Page>
      <PageHeader
        icon={<IconGauge size={20} />}
        title="Security overview"
        subtitle="How well NetworkPolicies isolate your workloads, and what to fix first. Figures cover application pods (system namespaces and hostNetwork pods excluded)."
        actions={
          <>
            <div className="flex h-9 items-center overflow-hidden rounded-lg border border-edge bg-surface text-sm shadow-sm">
              <span className="flex items-center gap-1.5 px-3 text-muted">
                <IconDownload size={15} /> Report
              </span>
              {(['md', 'csv', 'json'] as const).map((f) => (
                <a
                  key={f}
                  href={`/api/v1/posture/report?format=${f}`}
                  download
                  className="flex h-full items-center border-l border-edge px-3 text-[13px] font-medium text-text hover:bg-raised"
                >
                  {f === 'md' ? 'Markdown' : f.toUpperCase()}
                </a>
              ))}
            </div>
            <Link to="/policies/new" className={buttonClass('primary')}>
              <IconPlus size={16} /> New policy
            </Link>
          </>
        }
      />

      {unprotected.length > 0 && (
        <Alert
          tone="warn"
          title={`${unprotected.length} namespace${unprotected.length === 1 ? '' : 's'} accept traffic from anywhere`}
          action={
            unprotected.length === 1 ? (
              <Link
                to={`/policies/new?template=default-deny-ingress&namespace=${encodeURIComponent(unprotected[0].namespace)}`}
                className={buttonClass('secondary', 'sm')}
              >
                Harden {unprotected[0].namespace}
              </Link>
            ) : undefined
          }
        >
          {unprotected.map((n) => n.namespace).join(', ')} {unprotected.length === 1 ? 'has' : 'have'} no default-deny
          ingress policy. Use <strong>Harden</strong> in the table below to add one from a template.
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <div className="flex items-center gap-4">
            <ScoreRing score={s.score} color={grade.color} />
            <div className="min-w-0">
              <div className="text-sm font-medium text-muted">Posture score</div>
              <div className="mt-0.5 text-lg font-semibold" style={{ color: grade.color }}>
                {grade.label}
              </div>
              <p className="mt-0.5 text-xs text-muted">{grade.hint}</p>
            </div>
          </div>
        </Card>
        <CoverageTile
          label="Ingress isolated"
          hint="Pods that only accept allowed incoming traffic"
          n={s.ingressIsolatedPods}
          d={s.pods}
        />
        <CoverageTile
          label="Egress isolated"
          hint="Pods that can only connect where allowed"
          n={s.egressIsolatedPods}
          d={s.pods}
        />
        <Card>
          <div className="text-sm font-medium text-muted">Findings</div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <SeverityCount
              n={s.critical}
              label="critical"
              tone="block"
              active={severity === 'critical'}
              onClick={() => setSeverity(severity === 'critical' ? 'all' : 'critical')}
            />
            <SeverityCount
              n={s.warnings}
              label="warning"
              tone="warn"
              active={severity === 'warning'}
              onClick={() => setSeverity(severity === 'warning' ? 'all' : 'warning')}
            />
            <SeverityCount
              n={s.info}
              label="info"
              tone="info"
              active={severity === 'info'}
              onClick={() => setSeverity(severity === 'info' ? 'all' : 'info')}
            />
          </div>
          <p className="mt-3 text-xs text-muted">
            {s.policies} policies across {s.namespaces} namespaces
          </p>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
        <Card
          flush
          title="Namespaces"
          description="Share of pods isolated per direction. Expand a row to see which policies select each pod."
          actions={
            <Checkbox
              label="Show system"
              checked={showSystem}
              onChange={(e) => setShowSystem(e.target.checked)}
              className="text-xs"
            />
          }
        >
          <Table>
            <THead>
              <th className={th}>Namespace</th>
              <th className={th}>Pods</th>
              <th className={th}>Ingress</th>
              <th className={th}>Egress</th>
              <th className={th}>Default deny</th>
              <th className={th} />
            </THead>
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
                  <td colSpan={6}>
                    <EmptyState title="No application namespaces" icon={<IconShieldCheck size={22} />}>
                      Deploy a workload, or tick “Show system” to include system namespaces.
                    </EmptyState>
                  </td>
                </tr>
              )}
            </tbody>
          </Table>
        </Card>

        <Card
          title={`Findings (${findings.length})`}
          description="Misconfigurations detected in the current policies, most severe first."
          actions={
            <Select
              aria-label="Filter findings by severity"
              value={severity}
              onChange={(e) => setSeverity(e.target.value as Severity | 'all')}
              className="h-8 text-[13px]"
            >
              <option value="all">All severities</option>
              <option value="critical">Critical</option>
              <option value="warning">Warning</option>
              <option value="info">Info</option>
            </Select>
          }
        >
          <ul className="max-h-[36rem] space-y-2.5 overflow-auto pr-1">
            {findings.map((f, i) => (
              <FindingItem key={`${f.code}-${f.namespace}-${f.policy?.name}-${i}`} f={f} />
            ))}
            {findings.length === 0 && (
              <li>
                <EmptyState icon={<IconShieldCheck size={22} />} title="Nothing to report">
                  {severity === 'all' ? 'No misconfigurations found.' : `No ${severity} findings.`}
                </EmptyState>
              </li>
            )}
          </ul>
        </Card>
      </div>
    </Page>
  )
}

function ScoreRing({ score, color }: { score: number; color: string }) {
  const r = 30
  const c = 2 * Math.PI * r
  return (
    <div
      className="relative h-20 w-20 shrink-0"
      role="meter"
      aria-label="posture score"
      aria-valuenow={score}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <svg viewBox="0 0 72 72" className="h-full w-full -rotate-90">
        <circle cx="36" cy="36" r={r} fill="none" stroke="var(--color-raised)" strokeWidth="7" />
        <circle
          cx="36"
          cy="36"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${(c * score) / 100} ${c}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold tabular-nums text-text">{score}</span>
        <span className="-mt-1 text-[10px] text-quiet">/ 100</span>
      </div>
    </div>
  )
}

function SeverityCount({
  n,
  label,
  tone,
  active,
  onClick,
}: {
  n: number
  label: string
  tone: 'block' | 'warn' | 'info'
  active: boolean
  onClick: () => void
}) {
  const color =
    n === 0 ? 'text-quiet' : tone === 'block' ? 'text-block' : tone === 'warn' ? 'text-warn-text' : 'text-info'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={`Show ${label} findings`}
      className={`rounded-lg border px-2 py-1.5 text-left transition-colors ${
        active ? 'border-accent bg-accent-soft' : 'border-transparent hover:bg-raised'
      }`}
    >
      <div className={`text-2xl font-bold tabular-nums ${color}`}>{n}</div>
      <div className="text-xs text-muted">{label}</div>
    </button>
  )
}

function CoverageTile({ label, hint, n, d }: { label: string; hint: string; n: number; d: number }) {
  const p = pct(n, d)
  return (
    <Card>
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-muted">{label}</div>
        <IconLock size={16} className="text-quiet" />
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-3xl font-bold tabular-nums text-text">{p}%</span>
        <span className="text-sm text-muted">
          {n} of {d} pods
        </span>
      </div>
      <Meter value={p} />
      <p className="mt-2 text-xs text-quiet">{hint}</p>
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
        className={`h-full rounded-full transition-[width] ${value >= 80 ? 'bg-allow' : value >= 40 ? 'bg-warn' : 'bg-block'}`}
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
      <tr className={`border-b border-edge/70 transition-colors hover:bg-raised/40 ${open ? 'bg-raised/40' : ''}`}>
        <td className={td}>
          <button
            onClick={onToggle}
            aria-expanded={open}
            className="inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-[13px] font-semibold text-text hover:text-accent-strong"
          >
            <IconChevronRight size={14} className={`text-quiet transition-transform ${open ? 'rotate-90' : ''}`} />
            {ns.namespace}
          </button>
          {ns.system && (
            <Badge tone="neutral" className="ml-2">
              system
            </Badge>
          )}
        </td>
        <td className={`${td} tabular-nums text-muted`}>
          {ns.pods}
          {ns.hostNetworkPods > 0 && (
            <span className="text-xs text-quiet" title="hostNetwork pods">
              {' '}
              ({ns.hostNetworkPods} host)
            </span>
          )}
        </td>
        <td className={`${td} w-32`}>
          <span className="text-xs font-medium tabular-nums text-text">{eligible ? `${ing}%` : '—'}</span>
          {eligible > 0 && <Meter value={ing} small />}
        </td>
        <td className={`${td} w-32`}>
          <span className="text-xs font-medium tabular-nums text-text">{eligible ? `${eg}%` : '—'}</span>
          {eligible > 0 && <Meter value={eg} small />}
        </td>
        <td className={td}>
          <div className="flex gap-1">
            <DenyBadge on={ns.defaultDenyIngress} label="in" />
            <DenyBadge on={ns.defaultDenyEgress} label="out" />
          </div>
        </td>
        <td className={`${td} whitespace-nowrap text-right`}>
          <div className="flex justify-end gap-1.5">
            {needsDeny && (
              <Link
                to={`/policies/new?template=default-deny-ingress&namespace=${encodeURIComponent(ns.namespace)}`}
                className={buttonClass('secondary', 'xs')}
                title="Create a default-deny ingress policy for this namespace"
              >
                Harden
              </Link>
            )}
            <Link
              to={`/firewall?namespace=${encodeURIComponent(ns.namespace)}`}
              className={buttonClass('ghost', 'xs', 'text-accent-strong')}
            >
              Firewall <IconArrowRight size={12} />
            </Link>
          </div>
        </td>
      </tr>
      {open && (
        <tr className="border-b border-edge/70 bg-raised/40">
          <td colSpan={6} className="px-4 pb-4">
            <IsolationTable namespace={ns.namespace} />
          </td>
        </tr>
      )}
    </>
  )
}

function DenyBadge({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      title={
        on
          ? `default-deny ${label === 'in' ? 'ingress' : 'egress'} in place`
          : `no default-deny ${label === 'in' ? 'ingress' : 'egress'}`
      }
    >
      <Badge tone={on ? 'ok' : 'neutral'}>
        {on ? <IconCheck size={12} /> : <IconX size={12} />}
        {label}
      </Badge>
    </span>
  )
}

function IsolationTable({ namespace }: { namespace: string }) {
  const { data, isLoading } = useNamespaceIsolation(namespace)
  if (isLoading) return <Spinner />
  return (
    <div className="overflow-x-auto rounded-lg border border-edge bg-surface">
      <table className="w-full text-left text-xs">
        <thead className="bg-raised/60 text-muted">
          <tr>
            <th className="px-3 py-2 font-medium">Pod</th>
            <th className="px-3 py-2 font-medium">Ingress policies</th>
            <th className="px-3 py-2 font-medium">Egress policies</th>
          </tr>
        </thead>
        <tbody>
          {(data ?? []).map((p) => (
            <tr key={p.name} className="border-t border-edge/70">
              <td className="px-3 py-2 font-mono text-text">
                {p.name}
                {p.hostNetwork && (
                  <Badge tone="warn" className="ml-1.5">
                    hostNetwork
                  </Badge>
                )}
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
  if (refs.length === 0)
    return (
      <td className="px-3 py-2">
        <Badge tone="block">open (not isolated)</Badge>
      </td>
    )
  return (
    <td className="px-3 py-2">
      <div className="flex flex-wrap gap-x-2 gap-y-0.5">
        {refs.map((r) => (
          <Link
            key={r.name}
            to={`/policies/${r.namespace}/${r.name}`}
            className="font-mono text-accent-strong hover:underline"
          >
            {r.name}
          </Link>
        ))}
      </div>
    </td>
  )
}

const SEVERITY_STYLE: Record<Severity, { border: string; icon: React.ReactNode }> = {
  critical: { border: 'border-l-block', icon: <IconAlertOctagon size={14} /> },
  warning: { border: 'border-l-warn', icon: <IconAlertTriangle size={14} /> },
  info: { border: 'border-l-info', icon: <IconInfo size={14} /> },
}

function FindingItem({ f }: { f: Finding }) {
  const st = SEVERITY_STYLE[f.severity] ?? SEVERITY_STYLE.info
  return (
    <li className={`rounded-lg border border-l-[3px] border-edge ${st.border} bg-surface p-3`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={severityTone(f.severity)}>
          {st.icon} {f.severity}
        </Badge>
        <span className="font-mono text-[11px] text-quiet">{f.code}</span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-text">{f.message}</p>
      <div className="mt-1.5 text-xs text-muted">
        {f.policy ? (
          <Link
            to={`/policies/${f.policy.namespace}/${f.policy.name}`}
            className="inline-flex items-center gap-1 font-mono text-accent-strong hover:underline"
          >
            {f.policy.namespace}/{f.policy.name} <IconArrowRight size={12} />
          </Link>
        ) : (
          f.namespace && (
            <span>
              in namespace <span className="font-mono text-text">{f.namespace}</span>
            </span>
          )
        )}
      </div>
    </li>
  )
}
