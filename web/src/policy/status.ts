export interface PolicyStatus {
  label: string
  tone: 'ok' | 'warn' | 'bad'
}

/**
 * Row-level status for the policy list, derived from data the list API
 * already returns. "Selects nothing" outranks CNI state because it is the
 * more specific, per-policy problem.
 */
export function policyStatus(
  podsMatched: number,
  cniEnforces: boolean | undefined,
): PolicyStatus {
  if (podsMatched === 0) return { label: '⚠ selects nothing', tone: 'warn' }
  if (cniEnforces === false) return { label: '✕ not enforced', tone: 'bad' }
  if (cniEnforces === undefined) return { label: 'active', tone: 'ok' }
  return { label: '✓ enforced', tone: 'ok' }
}
