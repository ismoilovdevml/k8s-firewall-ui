import type { VerdictCounts } from '../../api/types'

/** Aggregate reachability of all workload pairs between two namespaces. */
export type Reach = 'allowed' | 'partial' | 'blocked' | 'unconstrained'

export function classify(c: VerdictCounts): Reach {
  const open = c.allowed + c.unconstrained
  if (open === 0) return 'blocked'
  if (c.blocked > 0) return 'partial'
  return c.allowed > 0 ? 'allowed' : 'unconstrained'
}

export const REACH_STYLE: Record<Reach, { stroke: string; dash?: string; label: string }> = {
  allowed: { stroke: 'var(--color-allow)', label: 'all open, restricted by policy' },
  partial: { stroke: 'var(--color-warn)', label: 'some workloads can connect' },
  blocked: { stroke: 'var(--color-block)', dash: '6 4', label: 'fully blocked' },
  unconstrained: { stroke: 'var(--color-quiet)', dash: '2 4', label: 'no policy applies' },
}

