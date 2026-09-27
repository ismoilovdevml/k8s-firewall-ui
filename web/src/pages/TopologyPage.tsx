import { useCallback, useMemo, useState } from 'react'
import { ReactFlow, Background, Controls, MarkerType } from '@xyflow/react'
import type { Edge, Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Link, useNavigate } from 'react-router-dom'
import { useNamespaces, useTopology } from '../api/queries'
import { ApiError } from '../api/client'
import type { EdgeVerdict, TopologyEdge } from '../api/types'
import WorkloadNode from '../components/topology/WorkloadNode'
import NamespaceGraph from '../components/topology/NamespaceGraph'
import { layoutCircle } from '../components/topology/layout'
import FloatingEdge from '../components/topology/FloatingEdge'

const nodeTypes = { workload: WorkloadNode }
const edgeTypes = { floating: FloatingEdge }

const VERDICT_STYLE: Record<EdgeVerdict, { stroke: string; dash?: string; label: string }> = {
  allowed: { stroke: 'var(--color-allow)', label: 'allowed by policy' },
  blocked: { stroke: 'var(--color-block)', dash: '6 4', label: 'blocked' },
  unconstrained: { stroke: 'var(--color-quiet)', dash: '2 4', label: 'no policy applies' },
}

type View = 'namespaces' | 'workloads'

export default function TopologyPage() {
  const [view, setView] = useState<View>('namespaces')
  const [selected, setSelected] = useState<string[]>([])
  const openNamespace = useCallback((ns: string) => {
    setSelected([ns])
    setView('workloads')
  }, [])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-edge px-4 pt-2">
        {(['namespaces', 'workloads'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            aria-pressed={view === v}
            className={`px-3 py-2 font-mono text-xs ${
              view === v ? 'border-b-2 border-accent text-accent-strong' : 'text-muted hover:text-text'
            }`}
          >
            {v === 'namespaces' ? 'Namespaces' : 'Workloads'}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {view === 'namespaces' ? (
          <NamespaceGraph onOpen={openNamespace} />
        ) : (
          <WorkloadTopology selected={selected} setSelected={setSelected} />
        )}
      </div>
    </div>
  )
}

function WorkloadTopology({
  selected,
  setSelected,
}: {
  selected: string[]
  setSelected: React.Dispatch<React.SetStateAction<string[]>>
}) {
  const { data: namespaces } = useNamespaces()
  const navigate = useNavigate()
  const [activeEdge, setActiveEdge] = useState<TopologyEdge | null>(null)
  const [visible, setVisible] = useState<Record<EdgeVerdict, boolean>>({
    allowed: true,
    blocked: true,
    unconstrained: true,
  })
  const [observedOnly, setObservedOnly] = useState(false)

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
        type: 'floating',
        source: e.source,
        target: e.target,
        // Observed traffic is drawn heavier than what policy merely permits.
        style: { stroke: style.stroke, strokeDasharray: e.observed ? undefined : style.dash, strokeWidth: e.observed ? 3.5 : 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: style.stroke },
        data: { edge: e },
      }
    })
    // Nodes arrive sorted by namespace/workload, so a circle keeps each
    // namespace's workloads adjacent; hiding a verdict never moves nodes.
    return { nodes: layoutCircle(rfNodes), edges: rfEdges }
  }, [topology.data])
  const shownEdges = useMemo(
    () =>
      edges.filter((e) => {
        const edge = (e.data as { edge: TopologyEdge }).edge
        return visible[edge.verdict] && (!observedOnly || edge.observed)
      }),
    [edges, visible, observedOnly],
  )
  const observedCount = topology.data?.edges.filter((e) => e.observed).length ?? 0
  // Traffic that was flowing but current policies block: likely broken.
  const observedBlocked = topology.data?.edges.filter((e) => e.observed && e.verdict === 'blocked').length ?? 0
  const counts = useMemo(() => {
    const c: Record<EdgeVerdict, number> = { allowed: 0, blocked: 0, unconstrained: 0 }
    for (const e of topology.data?.edges ?? []) c[e.verdict]++
    return c
  }, [topology.data])

  const toggle = (ns: string) =>
    setSelected((cur) => (cur.includes(ns) ? cur.filter((n) => n !== ns) : [...cur, ns]))

  const userNamespaces = (namespaces ?? []).filter(
    (ns) => !ns.name.startsWith('kube-') && ns.name !== 'local-path-storage' && ns.podCount > 0,
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
        <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-xs text-muted">
          <span className="uppercase tracking-wide text-quiet">show</span>
          {(Object.keys(VERDICT_STYLE) as EdgeVerdict[]).map((v) => (
            <button
              key={v}
              aria-pressed={visible[v]}
              onClick={() => setVisible((cur) => ({ ...cur, [v]: !cur[v] }))}
              title={VERDICT_STYLE[v].label}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 transition ${
                visible[v] ? 'border-edge bg-surface text-text' : 'border-transparent text-quiet line-through opacity-60'
              }`}
            >
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
              {topology.data && <span className="text-quiet">{counts[v]}</span>}
            </button>
          ))}
          {topology.data?.flowsEnabled && (
            <>
              <span className="mx-1 h-4 w-px bg-edge" />
              <button
                aria-pressed={observedOnly}
                onClick={() => setObservedOnly((cur) => !cur)}
                title="Only connections the node agents actually saw (thick lines)"
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 transition ${
                  observedOnly ? 'border-accent/60 bg-accent/10 text-accent-strong' : 'border-edge bg-surface text-text'
                }`}
              >
                <svg width="24" height="6">
                  <line x1="0" y1="3" x2="24" y2="3" stroke="currentColor" strokeWidth="3.5" />
                </svg>
                observed only
                <span className="text-quiet">{observedCount}</span>
              </button>
              {observedBlocked > 0 && (
                <span className="rounded-full bg-block/10 px-2.5 py-0.5 text-block" data-observed-blocked>
                  {observedBlocked} observed connection{observedBlocked === 1 ? '' : 's'} now blocked
                </span>
              )}
            </>
          )}
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
            edges={shownEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodeClick={(_, node) => {
              const info = (node.data as { info: { namespace: string; workload: string } }).info
              navigate(`/firewall?namespace=${encodeURIComponent(info.namespace)}&workload=${encodeURIComponent(info.workload)}`)
            }}
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
            {activeEdge.observed && (
              <div className="mt-2 text-sm text-text" data-edge-observed>
                Observed on{' '}
                <span className="font-mono">
                  {activeEdge.observed.ports.map((p) => `${p.port}/${p.protocol}`).join(', ')}
                </span>
                , last {new Date(activeEdge.observed.lastSeen).toLocaleTimeString()}
                {activeEdge.verdict === 'blocked' && (
                  <p className="mt-1 text-block">This traffic was flowing but current policies block it.</p>
                )}
              </div>
            )}
            <div className="mt-3">
              <div className="font-mono text-xs uppercase tracking-wide text-quiet">
                policies involved
              </div>
              {activeEdge.policies?.length ? (
                <ul className="mt-1 space-y-1">
                  {activeEdge.policies.map((p) => (
                    <li key={`${p.namespace}/${p.name}`} className="font-mono text-sm">
                      <Link to={`/policies/${p.namespace}/${p.name}`} className="text-accent-strong hover:underline">
                        {p.namespace}/{p.name}
                      </Link>
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
