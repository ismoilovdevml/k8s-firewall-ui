import { describe, expect, it } from 'vitest'
import { classify } from './reach'

describe('namespace edge classification', () => {
  it.each([
    [{ allowed: 0, blocked: 3, unconstrained: 0 }, 'blocked'],
    [{ allowed: 2, blocked: 1, unconstrained: 0 }, 'partial'],
    [{ allowed: 0, blocked: 1, unconstrained: 2 }, 'partial'],
    [{ allowed: 2, blocked: 0, unconstrained: 1 }, 'allowed'],
    [{ allowed: 0, blocked: 0, unconstrained: 4 }, 'unconstrained'],
  ] as const)('%o -> %s', (counts, want) => {
    expect(classify(counts)).toBe(want)
  })
})
