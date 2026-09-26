import type { AccessSubject, FlowDirection, ObservedRow } from '../../api/types'
import { useFlows } from '../../api/queries'
import { Badge, Button, Card } from '../ui'
import { peerId } from './flow'

function ago(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  return `${Math.round(s / 3600)}h ago`
}

/**
 * Traffic the node agents actually saw for the subject, with each flow's
 * verdict under the current policies, and "learn" buttons that restrict the
 * subject to exactly what was observed.
 */
export default function ObservedCard({
  subject,
  onLearn,
}: {
  subject: AccessSubject
  onLearn: (direction: FlowDirection) => void
}) {
  const { data } = useFlows(subject.namespace, subject.workload ?? '')
  if (!data) return null
  if (!data.enabled) {
    return (
      <Card title="observed traffic">
        <p className="text-sm text-muted">
          Off. Enable the flow agent (Helm <code>flows.enabled=true</code>) to see the connections pods actually make
          (IPs, ports, hosts) and build least-privilege policies from them.
        </p>
      </Card>
    )
  }
  const agents = Object.keys(data.agents).length
  return (
    <Card
      title={
        <span>
          observed traffic · {agents} node agent{agents === 1 ? '' : 's'} reporting
        </span>
      }
    >
      {agents === 0 && <p className="mb-2 text-sm text-warn-text">No agent has reported yet.</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <ObservedTable title="Connects to" direction="outbound" rows={data.outbound} onLearn={onLearn} />
        <ObservedTable title="Connected from" direction="inbound" rows={data.inbound} onLearn={onLearn} />
      </div>
    </Card>
  )
}

function ObservedTable({
  title,
  direction,
  rows,
  onLearn,
}: {
  title: string
  direction: FlowDirection
  rows: ObservedRow[]
  onLearn: (d: FlowDirection) => void
}) {
  const blocked = rows.filter((r) => !r.allowedNow).length
  return (
    <section data-observed={direction}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text">
          {title} <span className="font-normal text-muted">({rows.length})</span>
          {blocked > 0 && (
            <span className="ml-2">
              <Badge tone="block">{blocked} blocked by current policy</Badge>
            </span>
          )}
        </h3>
        <Button className="px-2 py-1 text-xs" disabled={rows.length === 0} onClick={() => onLearn(direction)}>
          Allow only observed {direction}
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted">Nothing observed yet.</p>
      ) : (
        <table className="w-full text-left text-xs">
          <tbody>
            {rows.map((r) => (
              <tr key={peerId(r.peer)} data-observed-peer={peerId(r.peer)} className="border-t border-edge/60 align-top">
                <td className="py-1.5 pr-2 font-mono text-text">
                  {r.peer.kind === 'workload' ? (
                    <>
                      <span className="text-muted">{r.peer.namespace}/</span>
                      {r.peer.workload}
                    </>
                  ) : (
                    <>
                      {r.peer.cidr} <Badge tone="neutral">external</Badge>
                    </>
                  )}
                </td>
                <td className="py-1.5 pr-2">
                  <div className="flex flex-wrap gap-1">
                    {r.ports.map((p) => (
                      <span
                        key={`${p.protocol}${p.port}`}
                        title={p.serviceIP ? `via Service ${p.serviceIP}` : undefined}
                        className={`rounded px-1.5 py-0.5 font-mono text-[11px] ${
                          p.allowedNow ? 'bg-accent/10 text-accent-strong' : 'bg-block/10 text-block'
                        }`}
                      >
                        {p.allowedNow ? '✓' : '✕'} {p.port}/{p.protocol}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="whitespace-nowrap py-1.5 text-right text-muted">{ago(r.lastSeen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
