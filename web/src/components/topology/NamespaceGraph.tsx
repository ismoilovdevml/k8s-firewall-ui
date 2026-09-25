import { useMemo, useState } from 'react'
import { Background, Controls, Handle, MarkerType, Position, ReactFlow } from '@xyflow/react'
import type { Edge, Node, NodeProps } from '@xyflow/react'
import { errorMessage } from '../../api/client'
import { useNamespaceTopology } from '../../api/queries'
import type { NamespaceGraphEdge, NamespaceGraphNode, VerdictCounts } from '../../api/types'
import { layoutCircle } from './layout'
import FloatingEdge from './FloatingEdge'
import { REACH_STYLE, classify, type Reach } from './reach'

function openText(c: VerdictCounts) {
  const total = c.allowed + c.blocked + c.unconstrained
  return `${c.allowed + c.unconstrained}/${total} open`
}

type NsNodeData = { info: NamespaceGraphNode; onOpen: (ns: string) => void }

function NamespaceNode({ data }: NodeProps) {
  const { info, onOpen } = data as NsNodeData
  const internal = info.internal.allowed + info.internal.blocked + info.internal.unconstrained
  return (
    <button
      onClick={() => onOpen(info.namespace)}
      title="Open this namespace's workloads"
      className="w-[220px] rounded-lg border border-edge bg-surface px-3 py-2 text-left shadow-sm transition hover:border-accent"
    >
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <div className="truncate font-mono text-sm font-semibold text-text">{info.namespace}</div>
      <div className="mt-0.5 font-mono text-xs text-muted">
        {info.workloads} workload{info.workloads === 1 ? '' : 's'} · {info.pods} pod{info.pods === 1 ? '' : 's'}
      </div>
      {internal > 0 && (
        <div className="mt-0.5 font-mono text-[11px] text-quiet">internal: {openText(info.internal)}</div>
      )}
      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </button>
  )
}

const nodeTypes = { namespace: NamespaceNode }
const edgeTypes = { floating: FloatingEdge }

export default function NamespaceGraph({ onOpen }: { onOpen: (ns: string) => void }) {
  const { data, error, isLoading } = useNamespaceTopology(true)
  const [visible, setVisible] = useState<Record<Reach, boolean>>({
    allowed: true,
    partial: true,
    blocked: true,
    unconstrained: true,
  })
  const [active, setActive] = useState<NamespaceGraphEdge | null>(null)

  const { nodes, edges, counts } = useMemo(() => {
    const counts: Record<Reach, number> = { allowed: 0, partial: 0, blocked: 0, unconstrained: 0 }
    if (!data) return { nodes: [] as Node[], edges: [] as Edge[], counts }
    const rfNodes: Node[] = data.nodes.map((n) => ({
      id: n.namespace,
      type: 'namespace',
      data: { info: n, onOpen },
      position: { x: 0, y: 0 },
    }))
    const rfEdges: Edge[] = data.edges.map((e) => {
      const reach = classify(e.counts)
      counts[reach]++
      const style = REACH_STYLE[reach]
      return {
        id: `${e.source}->${e.target}`,
        type: 'floating',
        source: e.source,
        target: e.target,
        style: { stroke: style.stroke, strokeDasharray: style.dash, strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: style.stroke },
        data: { edge: e, reach },
      }
    })
    return { nodes: layoutCircle(rfNodes), edges: rfEdges, counts }
  }, [data, onOpen])

  const shown = edges.filter((e) => visible[(e.data as { reach: Reach }).reach])

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-edge px-4 py-2 font-mono text-xs text-muted">
        <span className="uppercase tracking-wide text-quiet">show</span>
        {(Object.keys(REACH_STYLE) as Reach[]).map((r) => (
          <button
            key={r}
            aria-pressed={visible[r]}
            onClick={() => setVisible((cur) => ({ ...cur, [r]: !cur[r] }))}
            title={REACH_STYLE[r].label}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 transition ${
              visible[r] ? 'border-edge bg-surface text-text' : 'border-transparent text-quiet line-through opacity-60'
            }`}
          >
            <svg width="24" height="6">
              <line x1="0" y1="3" x2="24" y2="3" stroke={REACH_STYLE[r].stroke} strokeWidth="2" strokeDasharray={REACH_STYLE[r].dash} />
            </svg>
            {r}
            {data && <span className="text-quiet">{counts[r]}</span>}
          </button>
        ))}
        <span className="ml-auto text-quiet">click a namespace to open its workloads</span>
      </div>
      <div className="relative min-h-0 flex-1">
        {isLoading && <p className="p-6 text-sm text-muted">Computing namespace graph…</p>}
        {error && <p className="p-6 text-sm text-block">{errorMessage(error)}</p>}
        {data && data.nodes.length === 0 && (
          <p className="p-6 text-sm text-muted">No application namespaces with running pods.</p>
        )}
        {nodes.length > 0 && (
          <ReactFlow
            nodes={nodes}
            edges={shown}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onEdgeClick={(_, edge) => setActive((edge.data as { edge: NamespaceGraphEdge }).edge)}
            onPaneClick={() => setActive(null)}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            proOptions={{ hideAttribution: true }}
            colorMode="light"
          >
            <Background color="var(--color-edge)" gap={24} />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}
        {active && (
          <div className="absolute right-4 top-4 w-80 rounded-md border border-edge bg-surface p-4 shadow-lg">
            <div className="flex items-start justify-between gap-2">
              <div className="font-mono text-sm text-text">
                {active.source} <span className="text-quiet">→</span> {active.target}
              </div>
              <button onClick={() => setActive(null)} className="text-quiet hover:text-text" aria-label="Close">
                ✕
              </button>
            </div>
            <div className="mt-1 font-mono text-sm font-semibold" style={{ color: REACH_STYLE[classify(active.counts)].stroke }}>
              {REACH_STYLE[classify(active.counts)].label}
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-y-1 font-mono text-xs">
              <dt className="text-muted">allowed by policy</dt>
              <dd className="text-right text-text">{active.counts.allowed}</dd>
              <dt className="text-muted">no policy applies</dt>
              <dd className="text-right text-text">{active.counts.unconstrained}</dd>
              <dt className="text-muted">blocked</dt>
              <dd className="text-right text-text">{active.counts.blocked}</dd>
            </dl>
            <p className="mt-2 text-xs text-muted">Counts are workload pairs, any port.</p>
            <button
              onClick={() => onOpen(active.target)}
              className="mt-3 text-xs font-medium text-accent-strong hover:underline"
            >
              Open {active.target} workloads →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
