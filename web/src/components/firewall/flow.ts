import type { AccessPeer, AccessRow, PlanRequest } from '../../api/types'

export function flowText(req: PlanRequest): string {
  const subject = req.subject.workload ? `${req.subject.namespace}/${req.subject.workload}` : `namespace ${req.subject.namespace}`
  const peer =
    req.peer.kind === 'external'
      ? req.peer.cidr!
      : req.peer.kind === 'namespace'
        ? `namespace ${req.peer.namespace}`
        : `${req.peer.namespace}/${req.peer.workload}`
  const ports = req.ports?.length ? ` on ${req.ports.map((p) => `${p.port}/${p.protocol}`).join(', ')}` : ''
  return req.direction === 'outbound' ? `${subject} → ${peer}${ports}` : `${peer} → ${subject}${ports}`
}


export function peerId(p: AccessPeer): string {
  if (p.kind === 'external') return p.cidr ?? ''
  if (p.kind === 'namespace') return p.namespace ?? ''
  return `${p.namespace}/${p.workload}`
}

/** Status word and tone for a row. */
export function rowStatus(row: AccessRow): { label: string; tone: 'ok' | 'block' | 'warn' | 'neutral' } {
  switch (row.verdict) {
    case 'allowed':
      return { label: 'allowed', tone: 'ok' }
    case 'blocked':
      return { label: 'blocked', tone: 'block' }
    case 'partial':
      return { label: 'partial', tone: 'warn' }
    default:
      return { label: 'open (no policy)', tone: 'neutral' }
  }
}

/** Which side denies a blocked row, in words. */
export function deniedBy(row: AccessRow): string {
  const src = row.egress.applicable && row.egress.isolated && !row.egress.allowed
  const dst = row.ingress.applicable && row.ingress.isolated && !row.ingress.allowed
  if (src && dst) return 'both sides deny'
  if (src) return 'source egress denies'
  if (dst) return 'destination ingress denies'
  return ''
}
