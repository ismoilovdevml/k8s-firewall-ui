import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force'
import type { SimulationLinkDatum, SimulationNodeDatum } from 'd3-force'
import type { Node } from '@xyflow/react'

const NODE_WIDTH = 230
const NODE_HEIGHT = 72

/**
 * Places nodes on a circle (dense, fully connected graphs such as the
 * namespace view, where a layered layout degenerates into a line).
 */
export function layoutCircle(nodes: Node[]): Node[] {
  const n = nodes.length
  if (n <= 1) return nodes.map((node) => ({ ...node, position: { x: 0, y: 0 } }))
  // Radius so that neighbours on the circle do not overlap.
  const r = Math.max(220, (n * (NODE_WIDTH + 60)) / (2 * Math.PI))
  return nodes.map((node, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2
    return {
      ...node,
      position: { x: r * Math.cos(angle) - NODE_WIDTH / 2, y: r * Math.sin(angle) - NODE_HEIGHT / 2 },
    }
  })
}

interface SimNode extends SimulationNodeDatum {
  id: string
  group: string
}

/**
 * Force-directed layout that keeps each group (namespace) in its own
 * cluster: groups sit on a circle, nodes are pulled towards their group's
 * anchor, connected nodes attract and boxes never overlap. Runs a fixed
 * number of ticks from deterministic starting points, so the same graph
 * always gets the same picture and toggling edge filters never moves nodes.
 */
export function layoutClusters(
  nodes: Node[],
  edges: { source: string; target: string }[],
  groupOf: (n: Node) => string,
): Node[] {
  if (nodes.length <= 1) return layoutCircle(nodes)
  const groups = [...new Set(nodes.map(groupOf))]
  const groupRadius = groups.length <= 1 ? 0 : Math.max(300, groups.length * 130)
  const anchor = new Map(
    groups.map((g, i) => {
      const a = (2 * Math.PI * i) / groups.length - Math.PI / 2
      return [g, { x: groupRadius * Math.cos(a), y: groupRadius * Math.sin(a) }]
    }),
  )
  const sim: SimNode[] = nodes.map((n, i) => {
    const g = groupOf(n)
    const c = anchor.get(g)!
    // Spread each group's nodes on a small circle around its anchor.
    const a = (2 * Math.PI * i) / nodes.length
    return { id: n.id, group: g, x: c.x + 120 * Math.cos(a), y: c.y + 120 * Math.sin(a) }
  })
  const ids = new Set(sim.map((n) => n.id))
  const links: SimulationLinkDatum<SimNode>[] = edges
    .filter((e) => e.source !== e.target && ids.has(e.source) && ids.has(e.target))
    .map((e) => ({ source: e.source, target: e.target }))

  forceSimulation(sim)
    .force(
      'link',
      forceLink<SimNode, SimulationLinkDatum<SimNode>>(links)
        .id((d) => d.id)
        .distance(260)
        .strength(0.15),
    )
    .force('charge', forceManyBody().strength(-700))
    .force('collide', forceCollide(Math.hypot(NODE_WIDTH, NODE_HEIGHT) / 2 + 24))
    .force('x', forceX<SimNode>((d) => anchor.get(d.group)!.x).strength(0.45))
    .force('y', forceY<SimNode>((d) => anchor.get(d.group)!.y).strength(0.45))
    .stop()
    .tick(300)

  const pos = new Map(sim.map((n) => [n.id, n]))
  return nodes.map((node) => {
    const p = pos.get(node.id)!
    return { ...node, position: { x: (p.x ?? 0) - NODE_WIDTH / 2, y: (p.y ?? 0) - NODE_HEIGHT / 2 } }
  })
}
