import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { apiSend } from '../api/client'
import { useNamespacePods, useNamespaces } from '../api/queries'
import type { PolicyRef } from '../api/types'

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
        dstKind === 'pod'
          ? { kind: 'pod', namespace: dst.namespace, name: dst.name }
          : { kind: 'ip', ip: dst.ip },
      ...(port !== '' ? { port: { protocol, port: Number(port) } } : {}),
    })
  }

  const ready =
    src.namespace !== '' &&
    src.name !== '' &&
    (dstKind === 'pod' ? dst.namespace !== '' && dst.name !== '' : dst.ip !== '')

  const res = simulate.data

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="font-mono text-lg font-semibold text-text">Connection simulator</h1>
      <p className="mt-1 text-sm text-muted">
        Answers “can A reach B?” from the NetworkPolicies on the cluster, and explains which rule
        decided each side.
      </p>

      <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
        <section className="rounded-md border border-edge bg-surface p-4">
          <h2 className="font-mono text-[11px] uppercase tracking-wide text-quiet">source pod</h2>
          <PodPicker value={src} onChange={setSrc} />
        </section>

        <section className="rounded-md border border-edge bg-surface p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-mono text-[11px] uppercase tracking-wide text-quiet">destination</h2>
            <div className="flex gap-1 font-mono text-xs">
              {(['pod', 'ip'] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setDstKind(k)}
                  className={`rounded px-2 py-0.5 ${
                    dstKind === k ? 'bg-raised text-accent-strong' : 'text-muted hover:text-text'
                  }`}
                >
                  {k === 'pod' ? 'pod' : 'external IP'}
                </button>
              ))}
            </div>
          </div>
          {dstKind === 'pod' ? (
            <PodPicker
              value={{ namespace: dst.namespace, name: dst.name }}
              onChange={(v) => setDst({ ...dst, ...v })}
            />
          ) : (
            <input
              value={dst.ip}
              onChange={(e) => setDst({ ...dst, ip: e.target.value })}
              placeholder="e.g. 203.0.113.7"
              className="mt-2 w-full rounded border border-edge bg-base px-2 py-1.5 font-mono text-sm text-text placeholder:text-quiet focus:border-accent focus:outline-none"
            />
          )}
        </section>
      </div>

      <div className="mt-4 flex items-end gap-3">
        <label className="block">
          <span className="mb-1 block font-mono text-[10px] uppercase tracking-wide text-quiet">
            protocol
          </span>
          <select
            value={protocol}
            onChange={(e) => setProtocol(e.target.value as typeof protocol)}
            className="rounded border border-edge bg-surface px-2 py-1.5 font-mono text-sm text-text focus:border-accent focus:outline-none"
          >
            <option>TCP</option>
            <option>UDP</option>
            <option>SCTP</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block font-mono text-[10px] uppercase tracking-wide text-quiet">
            port
          </span>
          <input
            value={port}
            onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))}
            placeholder="any"
            className="w-28 rounded border border-edge bg-surface px-2 py-1.5 font-mono text-sm text-text placeholder:text-quiet focus:border-accent focus:outline-none"
          />
        </label>
        <button
          onClick={run}
          disabled={!ready || simulate.isPending}
          className="rounded bg-accent px-4 py-1.5 text-sm font-medium text-on-accent hover:brightness-110 disabled:opacity-50"
        >
          Simulate
        </button>
      </div>

      {simulate.error && (
        <p className="mt-4 font-mono text-xs text-block">{String(simulate.error)}</p>
      )}

      {res && (
        <div className="mt-6">
          <div
            className={`flex items-center gap-4 rounded-xl border-2 p-5 ${
              res.allowed ? 'border-allow bg-allow/10' : 'border-block bg-block/10'
            }`}
          >
            <span
              aria-hidden
              className={`text-3xl font-bold ${res.allowed ? 'text-accent-strong' : 'text-block'}`}
            >
              {res.allowed ? '✓' : '✕'}
            </span>
            <div>
              <div
                className={`text-xl font-bold ${res.allowed ? 'text-accent-strong' : 'text-block'}`}
              >
                {res.allowed ? 'Connection allowed' : 'Connection blocked'}
              </div>
              <div className="mt-0.5 text-sm text-muted">
                source egress: {sideWord(res.egress)} · destination ingress: {sideWord(res.ingress)}
              </div>
            </div>
          </div>

          {res.warnings && res.warnings.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {res.warnings.map((w) => (
                <li
                  key={w.code + w.message}
                  className={`rounded-lg border px-3 py-2 text-sm ${
                    w.severity === 'warning'
                      ? 'border-warn bg-warn-bg text-warn-text'
                      : 'border-edge bg-surface text-muted'
                  }`}
                >
                  <span className="font-mono text-[10px] font-semibold uppercase">⚠ {w.code}</span> —{' '}
                  {w.message}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <SidePanel title="source egress check" side={res.egress} />
            <SidePanel title="destination ingress check" side={res.ingress} />
          </div>
        </div>
      )}
    </div>
  )
}

function PodPicker({
  value,
  onChange,
}: {
  value: { namespace: string; name: string }
  onChange: (v: { namespace: string; name: string }) => void
}) {
  const { data: namespaces } = useNamespaces()
  const { data: pods } = useNamespacePods(value.namespace)

  return (
    <div className="mt-2 space-y-2">
      <select
        value={value.namespace}
        onChange={(e) => onChange({ namespace: e.target.value, name: '' })}
        className="w-full rounded border border-edge bg-base px-2 py-1.5 font-mono text-sm text-text focus:border-accent focus:outline-none"
      >
        <option value="">namespace…</option>
        {(namespaces ?? [])
          .filter((ns) => ns.podCount > 0)
          .map((ns) => (
            <option key={ns.name} value={ns.name}>
              {ns.name}
            </option>
          ))}
      </select>
      <select
        value={value.name}
        onChange={(e) => onChange({ ...value, name: e.target.value })}
        disabled={value.namespace === ''}
        className="w-full rounded border border-edge bg-base px-2 py-1.5 font-mono text-sm text-text focus:border-accent focus:outline-none disabled:opacity-40"
      >
        <option value="">pod…</option>
        {(pods ?? []).map((p) => (
          <option key={p.name} value={p.name}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  )
}

function SidePanel({ title, side }: { title: string; side: SideResult }) {
  return (
    <section className="rounded-md border border-edge bg-surface p-4">
      <h2 className="font-mono text-[11px] uppercase tracking-wide text-quiet">{title}</h2>
      {!side.applicable ? (
        <p className="mt-2 text-sm text-muted">
          Not evaluated — the destination is outside the cluster.
        </p>
      ) : (
        <>
          <p className="mt-2 font-mono text-sm">
            {side.isolated ? (
              side.allowed ? (
                <span className="text-accent-strong">isolated — allowed by rule</span>
              ) : (
                <span className="text-block">isolated — no rule matches (deny)</span>
              )
            ) : (
              <span className="text-muted">not isolated — everything allowed by default</span>
            )}
          </p>
          {side.matchedRules && side.matchedRules.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {side.matchedRules.map((m) => (
                <li key={`${m.policy.namespace}/${m.policy.name}/${m.ruleIndex}`} className="text-sm text-text">
                  {m.explanation}{' '}
                  <Link
                    to={`/policies/${m.policy.namespace}/${m.policy.name}`}
                    className="font-mono text-xs text-accent-strong hover:underline"
                  >
                    open →
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {side.evaluatedPolicies && side.evaluatedPolicies.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-wide text-quiet hover:text-muted">
                policies evaluated ({side.evaluatedPolicies.length})
              </summary>
              <ul className="mt-1 space-y-0.5">
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
    </section>
  )
}
