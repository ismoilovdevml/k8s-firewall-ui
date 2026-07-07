import { describe, expect, it } from 'vitest'
import { policyStatus } from './status'

describe('policyStatus', () => {
  it('flags a policy whose selector matches no pods, regardless of CNI', () => {
    expect(policyStatus(0, true)).toEqual({ label: '⚠ selects nothing', tone: 'warn' })
    expect(policyStatus(0, false)).toEqual({ label: '⚠ selects nothing', tone: 'warn' })
  })

  it('flags every policy as not enforced when the CNI ignores policies', () => {
    expect(policyStatus(3, false)).toEqual({ label: '✕ not enforced', tone: 'bad' })
  })

  it('reports enforced when the CNI enforces and pods are matched', () => {
    expect(policyStatus(3, true)).toEqual({ label: '✓ enforced', tone: 'ok' })
  })

  it('degrades to a neutral label while cluster info is still loading', () => {
    expect(policyStatus(3, undefined)).toEqual({ label: 'active', tone: 'ok' })
  })
})
