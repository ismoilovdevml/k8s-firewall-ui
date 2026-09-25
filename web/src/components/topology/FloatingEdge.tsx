import { BaseEdge, useInternalNode } from '@xyflow/react'
import type { EdgeProps, InternalNode } from '@xyflow/react'

// Straight edge between node borders along the line of their centers.
// A→B and B→A are offset to opposite sides so both stay visible.
const OFFSET = 5

function center(n: InternalNode) {
  const w = n.measured.width ?? 0
  const h = n.measured.height ?? 0
  return { x: n.internals.positionAbsolute.x + w / 2, y: n.internals.positionAbsolute.y + h / 2, w, h }
}

/** Point where the ray from the node center towards (dx, dy) leaves its box. */
function border(c: { x: number; y: number; w: number; h: number }, dx: number, dy: number) {
  const sx = dx === 0 ? Infinity : c.w / 2 / Math.abs(dx)
  const sy = dy === 0 ? Infinity : c.h / 2 / Math.abs(dy)
  const s = Math.min(sx, sy)
  return { x: c.x + dx * s, y: c.y + dy * s }
}

export default function FloatingEdge({ id, source, target, markerEnd, style }: EdgeProps) {
  const s = useInternalNode(source)
  const t = useInternalNode(target)
  if (!s || !t) return null
  const a = center(s)
  const b = center(t)
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const ux = (b.x - a.x) / len
  const uy = (b.y - a.y) / len
  // Perpendicular offset keeps opposite directions apart.
  const ox = -uy * OFFSET
  const oy = ux * OFFSET
  const p1 = border(a, ux, uy)
  const p2 = border(b, -ux, -uy)
  const path = `M ${p1.x + ox} ${p1.y + oy} L ${p2.x + ox} ${p2.y + oy}`
  return <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
}
