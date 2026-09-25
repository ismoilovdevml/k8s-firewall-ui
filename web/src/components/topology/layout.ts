import type { Node } from '@xyflow/react'

const NODE_WIDTH = 220
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
