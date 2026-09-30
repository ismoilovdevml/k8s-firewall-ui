import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { apiSend } from '../api/client'
import { useNamespacePods, useNamespaces } from '../api/queries'
import type { PolicyRef } from '../api/types'
import { Alert, Badge, Button, Card, Field, Input, Page, PageHeader, Segmented, Select } from '../components/ui'
import { IconArrowRight, IconCheck, IconFlask, IconPlay, IconX } from '../components/icons'

interface Endpoint {
  kind: 'pod' | 'ip'
  namespace?: string
  name?: string
  ip?: string
}

interface RuleMatch {
  policy: PolicyRef
  ruleIndex: number
  explanation: string
}

interface SideResult {
  applicable: boolean
  isolated: boolean
  allowed: boolean
  matchedRules?: RuleMatch[]
  evaluatedPolicies?: PolicyRef[]
}

interface SimResult {
  allowed: boolean
  egress: SideResult
  ingress: SideResult
  warnings?: { code: string; severity: string; message: string }[]
}

function sideWord(side: SideResult): string {
  if (!side.applicable) return 'not evaluated'
  return side.allowed ? 'pass' : 'deny'
}

export default function SimulatorPage() {
  const [src, setSrc] = useState<{ namespace: string; name: string }>({ namespace: '', name: '' })
  const [dstKind, setDstKind] = useState<'pod' | 'ip'>('pod')
  const [dst, setDst] = useState<{ namespace: string; name: string; ip: string }>({
    namespace: '',
    name: '',
    ip: '',
  })
  const [protocol, setProtocol] = useState<'TCP' | 'UDP' | 'SCTP'>('TCP')
  const [port, setPort] = useState('')

  const simulate = useMutation({
    mutationFn: (body: { source: Endpoint; destination: Endpoint; port?: { protocol: string; port: number } }) =>
      apiSend<SimResult>('POST', '/api/v1/simulate', body),
  })

  const run = () => {
    simulate.mutate({
      source: { kind: 'pod', namespace: src.namespace, name: src.name },
      destination:
        dstKind === 'pod' ? { kind: 'pod', namespace: dst.namespace, name: dst.name } : { kind: 'ip', ip: dst.ip },
      ...(port !== '' ? { port: { protocol, port: Number(port) } } : {}),
    })
  }

  const ready =
    src.namespace !== '' &&
    src.name !== '' &&
    (dstKind === 'pod' ? dst.namespace !== '' && dst.name !== '' : dst.ip !== '')

  const res = simulate.data

  return (
    <Page width="narrow">
      <PageHeader
        icon={<IconFlask size={20} />}
        title="Connection simulator"
        subtitle="Answers “can A reach B?” from the NetworkPolicies on the cluster, and explains which rule decided each side. Nothing is sent over the network."
      />

      <Card>
        <div className="grid items-stretch gap-4 md:grid-cols-[1fr_auto_1fr]">
          <div className="rounded-xl border border-edge bg-raised/40 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-text">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-xs font-bold text-on-accent">
                A
              </span>
              Source pod
            </div>
            <PodPicker label="source" value={src} onChange={setSrc} />
          </div>

          <div className="flex flex-row items-center justify-center gap-3 md:flex-col">
            <IconArrowRight size={22} className="rotate-90 text-quiet md:rotate-0" />
            <div className="flex items-end gap-2">
              <Field label="Protocol">
                <Select
                  aria-label="protocol"
                  mono
                  value={protocol}
                  onChange={(e) => setProtocol(e.target.value as typeof protocol)}
                  className="w-24"
                >
                  <option>TCP</option>
                  <option>UDP</option>
                  <option>SCTP</option>
                </Select>
              </Field>
              <Field label="Port">
                <Input
                  aria-label="port"
                  mono
                  value={port}
                  onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))}
                  placeholder="any"
                  className="w-20"
                />
              </Field>
            </div>
          </div>

          <div className="rounded-xl border border-edge bg-raised/40 p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-text">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-info text-xs font-bold text-white dark:text-base">
                  B
                </span>
                Destination
              </div>
              <Segmented
                label="Destination type"
                value={dstKind}
                onChange={setDstKind}
                options={[
                  { id: 'pod', label: 'Pod' },
                  { id: 'ip', label: 'External IP' },
                ]}
              />
            </div>
            {dstKind === 'pod' ? (
              <PodPicker
                label="destination"
                value={{ namespace: dst.namespace, name: dst.name }}
                onChange={(v) => setDst({ ...dst, ...v })}
              />
            ) : (
              <div className="mt-3">
                <Input
                  mono
                  aria-label="destination IP"
                  value={dst.ip}
                  onChange={(e) => setDst({ ...dst, ip: e.target.value })}
                  placeholder="e.g. 203.0.113.7"
                  className="w-full"
                />
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-end gap-3 border-t border-edge pt-4">
          <span className="mr-auto text-xs text-muted">
            {ready ? 'Ready — run the check.' : 'Pick a source pod and a destination to simulate.'}
          </span>
          <Button variant="primary" onClick={run} disabled={!ready || simulate.isPending} icon={<IconPlay size={14} />}>
            Simulate
          </Button>
        </div>
      </Card>

      {simulate.error && <Alert tone="block">{String(simulate.error)}</Alert>}

      {res && (
        <div className="space-y-4">
          <div
            className={`flex items-center gap-4 rounded-2xl border p-5 ${
              res.allowed ? 'border-allow/40 bg-allow-soft' : 'border-block/40 bg-block-soft'
            }`}
          >
            <span
              aria-hidden
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${
                res.allowed ? 'bg-allow text-white dark:text-base' : 'bg-block text-white dark:text-base'
              }`}
            >
              {res.allowed ? <IconCheck size={26} /> : <IconX size={26} />}
            </span>
            <div>
              <div className={`text-xl font-bold ${res.allowed ? 'text-accent-strong' : 'text-block'}`}>
                {res.allowed ? 'Connection allowed' : 'Connection blocked'}
              </div>
              <div className="mt-0.5 text-sm text-muted">
                A connection needs both checks to pass: the source may send (egress) and the destination may receive
                (ingress).
              </div>
            </div>
          </div>

          {res.warnings && res.warnings.length > 0 && (
            <div className="space-y-2">
              {res.warnings.map((w) => (
                <Alert
                  key={w.code + w.message}
                  tone={w.severity === 'warning' ? 'warn' : 'info'}
                  title={<span className="font-mono text-xs">{w.code}</span>}
                >
                  {w.message}
                </Alert>
              ))}
            </div>
          )}

          <div className="grid items-stretch gap-4 md:grid-cols-[1fr_auto_1fr]">
            <SidePanel step={1} title="Source egress check" subtitle="May A send this traffic?" side={res.egress} />
            <div className="hidden items-center md:flex">
              <IconArrowRight size={20} className="text-quiet" />
            </div>
            <SidePanel step={2} title="Destination ingress check" subtitle="May B receive it?" side={res.ingress} />
          </div>
        </div>
      )}
    </Page>
  )
}

function PodPicker({
  label,
  value,
  onChange,
}: {
  label: string
  value: { namespace: string; name: string }
  onChange: (v: { namespace: string; name: string }) => void
}) {
  const { data: namespaces } = useNamespaces()
  const { data: pods } = useNamespacePods(value.namespace)

  return (
    <div className="mt-3 space-y-2">
      <Select
        aria-label={`${label} namespace`}
        mono
        value={value.namespace}
        onChange={(e) => onChange({ namespace: e.target.value, name: '' })}
        className="w-full"
      >
        <option value="">namespace…</option>
        {(namespaces ?? [])
          .filter((ns) => ns.podCount > 0)
          .map((ns) => (
            <option key={ns.name} value={ns.name}>
              {ns.name}
            </option>
          ))}
      </Select>
      <Select
        aria-label={`${label} pod`}
        mono
        value={value.name}
        onChange={(e) => onChange({ ...value, name: e.target.value })}
        disabled={value.namespace === ''}
        className="w-full"
      >
        <option value="">pod…</option>
        {(pods ?? []).map((p) => (
          <option key={p.name} value={p.name}>
            {p.name}
          </option>
        ))}
      </Select>
    </div>
  )
}

function SidePanel({
  step,
  title,
  subtitle,
  side,
}: {
  step: number
  title: string
  subtitle: string
  side: SideResult
}) {
  const verdict = sideWord(side)
  const tone = verdict === 'pass' ? 'ok' : verdict === 'deny' ? 'block' : 'neutral'
  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs font-medium text-quiet">Step {step}</div>
          <h2 className="text-sm font-semibold text-text">{title}</h2>
          <p className="text-xs text-muted">{subtitle}</p>
        </div>
        <Badge tone={tone} dot>
          {verdict}
        </Badge>
      </div>
      {!side.applicable ? (
        <p className="mt-3 text-sm text-muted">Not evaluated — the destination is outside the cluster.</p>
      ) : (
        <>
          <p className="mt-3 text-sm">
            {side.isolated ? (
              side.allowed ? (
                <span className="text-accent-strong">Isolated — allowed by a rule</span>
              ) : (
                <span className="text-block">Isolated — no rule matches (deny)</span>
              )
            ) : (
              <span className="text-muted">Not isolated — everything is allowed by default</span>
            )}
          </p>
          {side.matchedRules && side.matchedRules.length > 0 && (
            <ul className="mt-3 space-y-2">
              {side.matchedRules.map((m) => (
                <li
                  key={`${m.policy.namespace}/${m.policy.name}/${m.ruleIndex}`}
                  className="rounded-lg border border-edge bg-raised/40 p-2.5 text-sm text-text"
                >
                  {m.explanation}{' '}
                  <Link
                    to={`/policies/${m.policy.namespace}/${m.policy.name}`}
                    className="inline-flex items-center gap-0.5 whitespace-nowrap text-xs font-medium text-accent-strong hover:underline"
                  >
                    open <IconArrowRight size={12} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {side.evaluatedPolicies && side.evaluatedPolicies.length > 0 && (
            <details className="mt-3 border-t border-edge pt-2">
              <summary className="cursor-pointer text-xs font-medium text-muted hover:text-text">
                Policies evaluated ({side.evaluatedPolicies.length})
              </summary>
              <ul className="mt-1.5 space-y-0.5">
                {side.evaluatedPolicies.map((p) => (
                  <li key={`${p.namespace}/${p.name}`}>
                    <Link
                      to={`/policies/${p.namespace}/${p.name}`}
                      className="font-mono text-xs text-muted hover:text-accent-strong"
                    >
                      {p.namespace}/{p.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </Card>
  )
}
