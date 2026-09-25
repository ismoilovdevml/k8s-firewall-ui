import { describe, expect, it } from 'vitest'
import { draftToPolicy, policyToDraft } from './model'
import { TEMPLATES, findTemplate } from './templates'
import { lineDiff } from './diff'

describe('policy templates', () => {
  it.each(TEMPLATES.map((t) => [t.id, t] as const))('%s produces a valid, lossless policy', (_, t) => {
    const pol = draftToPolicy(t.build('team-a'))
    expect(pol.metadata.namespace).toBe('team-a')
    expect(pol.metadata.name).toMatch(/^[a-z0-9-]+$/)
    // policyTypes must always be explicit (CLAUDE.md rule 6).
    expect(pol.spec.policyTypes.length).toBeGreaterThan(0)
    const back = policyToDraft(pol)
    expect(back.lossy).toEqual([])
    expect(draftToPolicy(back.draft)).toEqual(pol)
  })

  it('default deny ingress has no rules', () => {
    const pol = draftToPolicy(findTemplate('default-deny-ingress')!.build('x'))
    expect(pol.spec).toEqual({ podSelector: {}, policyTypes: ['Ingress'] })
  })

  it('egress-isolating templates keep DNS open', () => {
    for (const id of ['default-deny-all', 'default-deny-egress']) {
      const pol = draftToPolicy(findTemplate(id)!.build('x'))
      const ports = pol.spec.egress?.[0].ports ?? []
      expect(ports).toContainEqual({ protocol: 'UDP', port: 53 })
      expect(ports).toContainEqual({ protocol: 'TCP', port: 53 })
    }
  })
})

describe('lineDiff', () => {
  it('marks added, removed and unchanged lines', () => {
    expect(lineDiff('a\nb\nc\n', 'a\nc\nd\n')).toEqual([
      { op: '=', text: 'a' },
      { op: '-', text: 'b' },
      { op: '=', text: 'c' },
      { op: '+', text: 'd' },
    ])
  })

  it('handles creation and deletion', () => {
    expect(lineDiff('', 'x')).toEqual([{ op: '+', text: 'x' }])
    expect(lineDiff('x', '')).toEqual([{ op: '-', text: 'x' }])
  })
})
