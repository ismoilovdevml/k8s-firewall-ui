import { describe, expect, it } from 'vitest'
import { staleAgents, STALE_AGENT_MS } from './flow'

describe('staleAgents', () => {
  const now = Date.parse('2026-09-27T12:00:00Z')
  const at = (msAgo: number) => new Date(now - msAgo).toISOString()

  it('flags only agents silent for longer than the threshold, sorted by node', () => {
    const agents = { 'node-b': at(STALE_AGENT_MS + 1000), 'node-a': at(10 * 60_000), 'node-c': at(5000) }
    expect(staleAgents(agents, now).map(([n]) => n)).toEqual(['node-a', 'node-b'])
  })

  it('is empty when every agent reports', () => {
    expect(staleAgents({ n1: at(0), n2: at(STALE_AGENT_MS - 1) }, now)).toEqual([])
  })
})
