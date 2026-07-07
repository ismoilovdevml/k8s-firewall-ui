import { useMemo, useState } from 'react'
import { ReactFlow, Background, Controls, MarkerType } from '@xyflow/react'
import type { Edge, Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useNamespaces, useTopology } from '../api/queries'
import { ApiError } from '../api/client'
import type { EdgeVerdict, TopologyEdge } from '../api/types'
import WorkloadNode from '../components/topology/WorkloadNode'
import { layoutGraph } from '../components/topology/layout'

const nodeTypes = { workload: WorkloadNode }

const VERDICT_STYLE: Record<EdgeVerdict, { stroke: string; dash?: string; label: string }> = {
  allowed: { stroke: 'var(--color-allow)', label: 'allowed by policy' },
  blocked: { stroke: 'var(--color-block)', dash: '6 4', label: 'blocked' },
  unconstrained: { stroke: 'var(--color-quiet)', dash: '2 4', label: 'no policy applies' },
}

export default function TopologyPage() {
  const { data: namespaces } = useNamespaces()
  const [selected, setSelected] = useState<string[]>([])
  const [activeEdge, setActiveEdge] = useState<TopologyEdge | null>(null)

  const topology = useTopology(selected)

  const { nodes, edges } = useMemo(() => {
    if (!topology.data) return { nodes: [] as Node[], edges: [] as Edge[] }
    const rfNodes: Node[] = topology.data.nodes.map((n) => ({
      id: n.id,
      type: 'workload',
      data: { info: n },
      position: { x: 0, y: 0 },
    }))
    const rfEdges: Edge[] = topology.data.edges.map((e) => {
      const style = VERDICT_STYLE[e.verdict]
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        style: { stroke: style.stroke, strokeDasharray: style.dash },
        markerEnd: { type: MarkerType.ArrowClosed, color: style.stroke },
        data: { edge: e },
      }
    })
    return { nodes: layoutGraph(rfNodes, rfEdges), edges: rfEdges }
  }, [topology.data])

  const toggle = (ns: string) =>
    setSelected((cur) => (cur.includes(ns) ? cur.filter((n) => n !== ns) : [...cur, ns]))

  const userNamespaces = (namespaces ?? []).filter(
    (ns) => !ns.name.startsWith('kube-') && ns.name !== 'local-path-storage',
  )

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-edge px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs uppercase tracking-wide text-quiet">namespaces</span>
          {userNamespaces.map((ns) => (
            <button
              key={ns.name}
              onClick={() => toggle(ns.name)}
              className={`rounded-full border px-3 py-0.5 font-mono text-xs transition-colors ${
                selected.includes(ns.name)
                  ? 'border-accent/60 bg-accent/10 text-accent-strong'
                  : 'border-edge text-muted hover:border-quiet hover:text-text'
              }`}
            >
              {ns.name}
              <span className="ml-1.5 text-quiet">{ns.podCount}</span>
            </button>
          ))}
          {namespaces && userNamespaces.length === 0 && (
            <span className="text-sm text-muted">No user namespaces with pods yet.</span>
          )}
        </div>
        <div className="mt-2 flex gap-4 font-mono text-xs text-muted">
          {(Object.keys(VERDICT_STYLE) as EdgeVerdict[]).map((v) => (
            <span key={v} className="flex items-center gap-1.5">
              <svg width="24" height="6">
                <line
                  x1="0"
                  y1="3"
                  x2="24"
                  y2="3"
                  stroke={VERDICT_STYLE[v].stroke}
                  strokeWidth="2"
                  strokeDasharray={VERDICT_STYLE[v].dash}
                />
              </svg>
              {v}
            </span>
          ))}
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {selected.length === 0 && (
          <EmptyHint>Select one or more namespaces above to map their traffic.</EmptyHint>
        )}
        {topology.error instanceof ApiError && (
          <EmptyHint tone="error">
            {topology.error.code === 'TOO_MANY_WORKLOADS'
              ? topology.error.message
              : `Could not compute the topology: ${topology.error.message}`}
          </EmptyHint>
        )}
        {topology.data && topology.data.nodes.length === 0 && (
          <EmptyHint>No running workloads in this selection.</EmptyHint>
        )}
        {nodes.length > 0 && (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onEdgeClick={(_, edge) => setActiveEdge((edge.data as { edge: TopologyEdge }).edge)}
            onPaneClick={() => setActiveEdge(null)}
            fitView
            proOptions={{ hideAttribution: true }}
            colorMode="light"
          >
            <Background color="var(--color-edge)" gap={24} />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}

        {activeEdge && (
          <div className="absolute right-4 top-4 w-80 rounded-md border border-edge bg-surface p-4 shadow-lg">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 font-mono text-xs text-muted">
                <div className="truncate">{activeEdge.source.split('/').slice(1).join('/')}</div>
                <div className="text-quiet">→ {activeEdge.target.split('/').slice(1).join('/')}</div>
              </div>
              <button
                onClick={() => setActiveEdge(null)}
                className="text-quiet hover:text-text"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div
              className="mt-2 font-mono text-sm font-semibold"
              style={{ color: VERDICT_STYLE[activeEdge.verdict].stroke }}
            >
              {VERDICT_STYLE[activeEdge.verdict].label}
            </div>
            <div className="mt-3">
              <div className="font-mono text-xs uppercase tracking-wide text-quiet">
                policies involved
              </div>
              {activeEdge.policies?.length ? (
                <ul className="mt-1 space-y-1">
                  {activeEdge.policies.map((p) => (
                    <li key={`${p.namespace}/${p.name}`} className="font-mono text-sm text-text">
                      {p.namespace}/{p.name}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-sm text-muted">
                  None — neither side is selected by a policy, so traffic flows unrestricted.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function EmptyHint({ children, tone }: { children: React.ReactNode; tone?: 'error' }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <p className={`max-w-md text-center text-sm ${tone === 'error' ? 'text-block' : 'text-muted'}`}>
        {children}
      </p>
    </div>
  )
}
