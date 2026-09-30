import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import { layoutClusters } from './layout'

const node = (ns: string, name: string): Node => ({ id: `${ns}/${name}`, position: { x: 0, y: 0 }, data: { ns } })
const groupOf = (n: Node) => (n.data as { ns: string }).ns

const nodes = [
  node('shop', 'frontend'),
  node('shop', 'cart'),
  node('shop', 'redis'),
  node('payments', 'api'),
  node('payments', 'db'),
  node('analytics', 'collector'),
]
const edges = [
  { source: 'shop/frontend', target: 'shop/cart' },
  { source: 'shop/cart', target: 'shop/redis' },
  { source: 'shop/cart', target: 'payments/api' },
  { source: 'payments/api', target: 'payments/db' },
]

const center = (n: Node) => ({ x: n.position.x + 115, y: n.position.y + 36 })
const dist = (a: Node, b: Node) => Math.hypot(center(a).x - center(b).x, center(a).y - center(b).y)

describe('layoutClusters', () => {
  it('is deterministic', () => {
    expect(layoutClusters(nodes, edges, groupOf)).toEqual(layoutClusters(nodes, edges, groupOf))
  })

  it('keeps node boxes apart', () => {
    const out = layoutClusters(nodes, edges, groupOf)
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++) {
        const dx = Math.abs(center(out[i]).x - center(out[j]).x)
        const dy = Math.abs(center(out[i]).y - center(out[j]).y)
        expect(dx >= 230 || dy >= 72).toBe(true)
      }
  })

  it('places a namespace closer to itself than to other namespaces', () => {
    const out = new Map(layoutClusters(nodes, edges, groupOf).map((n) => [n.id, n]))
    const same = dist(out.get('shop/frontend')!, out.get('shop/redis')!)
    const other = dist(out.get('shop/frontend')!, out.get('analytics/collector')!)
    expect(same).toBeLessThan(other)
  })

  it('ignores edges to unknown nodes and self-loops', () => {
    const out = layoutClusters(
      nodes,
      [...edges, { source: 'x/y', target: 'shop/cart' }, { source: 'shop/cart', target: 'shop/cart' }],
      groupOf,
    )
    expect(out).toHaveLength(nodes.length)
  })
})
