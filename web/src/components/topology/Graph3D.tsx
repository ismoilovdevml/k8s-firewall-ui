import { useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph3D from 'react-force-graph-3d'
import type { ForceGraphMethods, LinkObject, NodeObject } from 'react-force-graph-3d'
import { Group, Mesh, MeshLambertMaterial, SphereGeometry } from 'three'
import SpriteText from 'three-spritetext'
import { useTheme } from '../../theme'

// Interactive 3D view of a topology graph (three.js via react-force-graph-3d).
// Loaded lazily: three.js is only fetched when someone opens the 3D view.

export interface Node3D {
  id: string
  label: string
  /** Nodes of one group share a color and are pulled into a cluster. */
  group: string
  /** Relative size, e.g. pod count. */
  size: number
}

export interface Link3D {
  id: string
  source: string
  target: string
  /** A theme token name, e.g. "--color-allow". */
  colorToken: string
  /** Animated particles travelling along the link (traffic that can flow). */
  particles: number
  /** Drawn heavier, e.g. traffic the node agents actually observed. */
  emphasis?: boolean
  /** Drawn faint, e.g. blocked connections. */
  faint?: boolean
}

type N = NodeObject<Node3D>
type L = LinkObject<Node3D, Link3D>

const CATEGORY_TOKENS = Array.from({ length: 8 }, (_, i) => `--color-cat-${i + 1}`)

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888888'
}

function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

/** Pulls every node towards the centroid of its group, so namespaces form clusters. */
function clusterForce(strength: number) {
  let nodes: N[] = []
  const force = (alpha: number) => {
    const sums = new Map<string, { x: number; y: number; z: number; n: number }>()
    for (const d of nodes) {
      const s = sums.get(d.group) ?? { x: 0, y: 0, z: 0, n: 0 }
      s.x += d.x ?? 0
      s.y += d.y ?? 0
      s.z += d.z ?? 0
      s.n++
      sums.set(d.group, s)
    }
    for (const d of nodes) {
      const s = sums.get(d.group)!
      const k = strength * alpha
      d.vx = (d.vx ?? 0) + (s.x / s.n - (d.x ?? 0)) * k
      d.vy = (d.vy ?? 0) + (s.y / s.n - (d.y ?? 0)) * k
      d.vz = (d.vz ?? 0) + (s.z / s.n - (d.z ?? 0)) * k
    }
  }
  force.initialize = (n: N[]) => {
    nodes = n
  }
  return force
}

export default function Graph3D({
  nodes,
  links,
  selectedId,
  onNodeClick,
  onLinkClick,
  onBackgroundClick,
}: {
  nodes: Node3D[]
  links: Link3D[]
  selectedId?: string | null
  onNodeClick?: (id: string) => void
  onLinkClick?: (id: string) => void
  onBackgroundClick?: () => void
}) {
  const theme = useTheme()
  const box = useRef<HTMLDivElement>(null)
  const fg = useRef<ForceGraphMethods<N, L> | undefined>(undefined)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [hover, setHover] = useState<string | null>(null)
  const [supported] = useState(webglAvailable)
  const fitted = useRef(false)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ width: e.contentRect.width, height: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Resolved token colors; recomputed when the theme flips.
  const colors = useMemo(() => {
    void theme
    return {
      background: token('--color-base'),
      text: token('--color-text'),
      cat: CATEGORY_TOKENS.map(token),
      tokens: new Map<string, string>(),
    }
  }, [theme])
  const color = (name: string) => {
    let c = colors.tokens.get(name)
    if (!c) {
      c = token(name)
      colors.tokens.set(name, c)
    }
    return c
  }

  const groups = useMemo(() => [...new Set(nodes.map((n) => n.group))].sort(), [nodes])
  const groupColor = (g: string) => colors.cat[groups.indexOf(g) % colors.cat.length]

  // New object identities only when the graph itself changes, so filtering
  // links or hovering never restarts the simulation from scratch.
  // Node objects are reused by id so they keep their positions when only the
  // links change (e.g. toggling a verdict filter).
  const nodeCache = useRef(new Map<string, N>())
  const graphData = useMemo(() => {
    const cache = nodeCache.current
    const next = nodes.map((n) => Object.assign(cache.get(n.id) ?? {}, n) as N)
    nodeCache.current = new Map(next.map((n) => [n.id, n]))
    return { nodes: next, links: links.map((l) => ({ ...l })) as L[] }
  }, [nodes, links])
  const nodeKey = useMemo(() => nodes.map((n) => n.id).join('|'), [nodes])

  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const l of links) {
      if (!m.has(l.source)) m.set(l.source, new Set())
      if (!m.has(l.target)) m.set(l.target, new Set())
      m.get(l.source)!.add(l.target)
      m.get(l.target)!.add(l.source)
    }
    return m
  }, [links])
  const focus = hover ?? selectedId ?? null

  // The graph mounts only once the container has a size, so forces are set
  // up when that happens (and again for every new graph).
  const mounted = size.width > 0
  useEffect(() => {
    const g = fg.current
    if (!g) return
    g.d3Force('cluster', clusterForce(0.12) as never)
    g.d3Force('charge')?.strength?.(-220)
    g.d3Force('link')?.distance?.(70)
    g.d3ReheatSimulation()
  }, [graphData, mounted])
  // Frame the whole graph once it has spread out; the timer covers slow
  // renderers where the engine takes long to cool down.
  useEffect(() => {
    fitted.current = false
    if (!mounted) return
    const t = setTimeout(() => {
      if (!fitted.current) {
        fitted.current = true
        fg.current?.zoomToFit(600, 40)
      }
    }, 1500)
    return () => clearTimeout(t)
  }, [nodeKey, mounted])

  const endpoint = (v: L['source']) => (typeof v === 'object' ? (v as N).id : String(v))
  const linkTouches = (l: L, id: string) => endpoint(l.source) === id || endpoint(l.target) === id

  if (!supported) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted">
        3D view needs WebGL, which this browser has disabled. Use the 2D view instead.
      </div>
    )
  }

  return (
    <div ref={box} className="relative h-full w-full" data-graph3d>
      {size.width > 0 && (
        <ForceGraph3D<Node3D, Link3D>
          ref={fg}
          width={size.width}
          height={size.height}
          graphData={graphData}
          backgroundColor={colors.background}
          showNavInfo={false}
          nodeId="id"
          nodeLabel={(n) => escapeHtml(n.label)}
          nodeThreeObject={(n: N) => {
            const g = new Group()
            const dim = focus && focus !== n.id && !neighbors.get(focus)?.has(n.id)
            const radius = 4 + Math.sqrt(Math.max(n.size, 1)) * 2.2
            const sphere = new Mesh(
              new SphereGeometry(radius, 24, 16),
              new MeshLambertMaterial({ color: groupColor(n.group), transparent: true, opacity: dim ? 0.2 : 0.95 }),
            )
            g.add(sphere)
            const label = new SpriteText(n.label, 5, colors.text)
            label.fontFace = 'ui-monospace, SFMono-Regular, Menlo, monospace'
            label.fontWeight = n.id === selectedId ? '700' : '500'
            label.material.depthWrite = false
            label.material.opacity = dim ? 0.25 : 1
            label.position.y = radius + 6
            g.add(label)
            return g
          }}
          linkColor={(l: L) => {
            const c = color(l.colorToken)
            if (focus) return linkTouches(l, focus) ? c : withAlpha(c, 0.08)
            return l.faint ? withAlpha(c, 0.35) : c
          }}
          linkWidth={(l: L) => (focus && linkTouches(l, focus) ? 1.8 : l.emphasis ? 1.6 : 0.5)}
          linkOpacity={0.9}
          linkCurvature={0.18}
          linkDirectionalArrowLength={4}
          linkDirectionalArrowRelPos={1}
          linkDirectionalArrowColor={(l: L) => color(l.colorToken)}
          linkDirectionalParticles={(l: L) => (focus && !linkTouches(l, focus) ? 0 : l.particles)}
          linkDirectionalParticleWidth={(l: L) => (l.emphasis ? 2.4 : 1.6)}
          linkDirectionalParticleSpeed={0.006}
          linkDirectionalParticleColor={(l: L) => color(l.colorToken)}
          onNodeHover={(n) => setHover(n ? (n as N).id : null)}
          onNodeClick={(n: N) => {
            const dist = 140
            const r = Math.hypot(n.x ?? 0, n.y ?? 0, n.z ?? 0) || 1
            const k = 1 + dist / r
            fg.current?.cameraPosition(
              { x: (n.x ?? 0) * k, y: (n.y ?? 0) * k, z: (n.z ?? 0) * k },
              { x: n.x ?? 0, y: n.y ?? 0, z: n.z ?? 0 },
              900,
            )
            onNodeClick?.(n.id)
          }}
          onLinkClick={(l: L) => onLinkClick?.(l.id)}
          onBackgroundClick={() => onBackgroundClick?.()}
          cooldownTicks={150}
          onEngineStop={() => {
            if (!fitted.current) {
              fitted.current = true
              fg.current?.zoomToFit(600, 40)
            }
          }}
        />
      )}
      <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-edge bg-surface/90 px-3 py-1 text-[11px] text-muted shadow-sm">
        Drag to rotate · scroll to zoom · right-drag to pan · hover to highlight
      </div>
      {groups.length > 1 && (
        <div className="pointer-events-none absolute left-3 top-3 max-w-[40%] rounded-lg border border-edge bg-surface/90 p-2 text-[11px] shadow-sm">
          {groups.map((g) => (
            <div key={g} className="flex items-center gap-1.5 font-mono text-text">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: groupColor(g) }} />
              {g}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
