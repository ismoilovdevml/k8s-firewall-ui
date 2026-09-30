import type { AccessSubject, FlowDirection, ObservedRow } from '../../api/types'
import { useFlows } from '../../api/queries'
import { IconActivity } from '../icons'
import { Alert, Badge, Button, Card } from '../ui'
import { peerId, staleAgents } from './flow'

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
      <Card>
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-raised text-quiet">
            <IconActivity size={18} />
          </div>
          <div>
            <div className="text-sm font-semibold text-text">Observed traffic is off</div>
            <p className="mt-0.5 text-sm text-muted">
              Enable the flow agent (Helm <code className="font-mono text-xs">flows.enabled=true</code>) to see the
              connections pods actually make (IPs, ports, hosts) and build least-privilege policies from them.
            </p>
          </div>
        </div>
      </Card>
    )
  }
  const agents = Object.keys(data.agents).length
  // Agents upload every ~10s; a node silent for minutes means a crashed or
  // unschedulable agent, and its traffic is missing below.
  const stale = staleAgents(data.agents, Date.now()).map(([node, at]) => `${node} (${ago(at)})`)
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <IconActivity size={16} className="text-accent-strong" /> Observed traffic
        </span>
      }
      description={`${agents} node agent${agents === 1 ? '' : 's'} reporting · what pods actually did, checked against current policies`}
    >
      {agents === 0 && (
        <Alert tone="warn" className="mb-3">
          No agent has reported yet.
        </Alert>
      )}
      {stale.length > 0 && (
        <div data-stale-agents className="mb-3">
          <Alert tone="warn">
            Agent silent on {stale.join(', ')} — traffic on {stale.length === 1 ? 'that node' : 'those nodes'} is not
            being recorded. Check the agent DaemonSet before learning a policy.
          </Alert>
        </div>
      )}
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
    <section data-observed={direction} className="rounded-lg border border-edge p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text">
          {title} <span className="font-normal text-muted">({rows.length})</span>
          {blocked > 0 && (
            <span className="ml-2">
              <Badge tone="block">{blocked} blocked by current policy</Badge>
            </span>
          )}
        </h3>
        <Button size="xs" disabled={rows.length === 0} onClick={() => onLearn(direction)}>
          Allow only observed {direction}
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="py-3 text-center text-xs text-muted">Nothing observed yet.</p>
      ) : (
        <table className="w-full text-left text-xs">
          <tbody>
            {rows.map((r) => (
              <tr
                key={peerId(r.peer)}
                data-observed-peer={peerId(r.peer)}
                className="border-t border-edge/60 align-top"
              >
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
                        className={`rounded-md px-1.5 py-0.5 font-mono text-[11px] font-medium ${
                          p.allowedNow ? 'bg-allow-soft text-accent-strong' : 'bg-block-soft text-block'
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
