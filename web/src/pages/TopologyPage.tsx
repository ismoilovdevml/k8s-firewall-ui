import { Suspense, lazy, useCallback, useMemo, useState } from 'react'
import { ReactFlow, Background, Controls, MarkerType } from '@xyflow/react'
import type { Edge, Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Link, useNavigate } from 'react-router-dom'
import { useNamespaces, useTopology } from '../api/queries'
import { ApiError } from '../api/client'
import type { EdgeVerdict, TopologyEdge } from '../api/types'
import WorkloadNode from '../components/topology/WorkloadNode'
import NamespaceGraph from '../components/topology/NamespaceGraph'
import { layoutClusters } from '../components/topology/layout'
import FloatingEdge from '../components/topology/FloatingEdge'
import { GraphHint, GraphPanel, LegendToggle } from '../components/topology/controls'
import { useGraphDim } from '../components/topology/dim'
import type { GraphDim } from '../components/topology/dim'
import type { Link3D, Node3D } from '../components/topology/Graph3D'
import { IconBox, IconLayers } from '../components/icons'
import { Badge, Segmented, Spinner } from '../components/ui'
import { useTheme } from '../theme'

const Graph3D = lazy(() => import('../components/topology/Graph3D'))

const nodeTypes = { workload: WorkloadNode }
const edgeTypes = { floating: FloatingEdge }

const VERDICT_STYLE: Record<EdgeVerdict, { stroke: string; token: string; dash?: string; label: string }> = {
  allowed: { stroke: 'var(--color-allow)', token: '--color-allow', label: 'allowed by policy' },
  blocked: { stroke: 'var(--color-block)', token: '--color-block', dash: '6 4', label: 'blocked' },
  unconstrained: { stroke: 'var(--color-quiet)', token: '--color-quiet', dash: '2 4', label: 'no policy applies' },
}

type View = 'namespaces' | 'workloads'

export default function TopologyPage() {
  const [view, setView] = useState<View>('namespaces')
  const [selected, setSelected] = useState<string[]>([])
  const [dim, setDim] = useGraphDim()
  const openNamespace = useCallback((ns: string) => {
    setSelected([ns])
    setView('workloads')
  }, [])

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-edge bg-surface px-4 py-3">
        <Segmented
          label="Topology level"
          value={view}
          onChange={setView}
          options={[
            {
              id: 'namespaces',
              label: (
                <>
                  <IconLayers size={14} />
                  Namespaces
                </>
              ),
            },
            {
              id: 'workloads',
              label: (
                <>
                  <IconBox size={14} />
                  Workloads
                </>
              ),
            },
          ]}
        />
        <Segmented
          label="Rendering"
          value={dim}
          onChange={setDim}
          options={[
            { id: '2d', label: '2D' },
            { id: '3d', label: '3D' },
          ]}
        />
        <p className="text-sm text-muted">
          {view === 'namespaces'
            ? 'Which teams can reach which: one node per namespace, lines summarize every workload pair.'
            : 'Workload-to-workload reachability under the current policies. Click a workload to open its firewall.'}
        </p>
      </div>
      <div className="min-h-0 flex-1">
        {view === 'namespaces' ? (
          <NamespaceGraph onOpen={openNamespace} dim={dim} />
        ) : (
          <WorkloadTopology selected={selected} setSelected={setSelected} dim={dim} />
        )}
      </div>
    </div>
  )
}

function WorkloadTopology({
  selected,
  setSelected,
  dim,
}: {
  selected: string[]
  setSelected: React.Dispatch<React.SetStateAction<string[]>>
  dim: GraphDim
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
  const [hovered, setHovered] = useState<string | null>(null)
  const [activeNode, setActiveNode] = useState<string | null>(null)

  const topology = useTopology(selected)
  const theme = useTheme()

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
        style: {
          stroke: style.stroke,
          strokeDasharray: e.observed ? undefined : style.dash,
          strokeWidth: e.observed ? 3.5 : 1.5,
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: style.stroke },
        data: { edge: e },
      }
    })
    // Each namespace forms its own cluster; the layout depends only on the
    // graph, so hiding a verdict never moves nodes.
    // Only connections that can carry traffic pull workloads together.
    const laidOut = layoutClusters(
      rfNodes,
      topology.data.edges.filter((e) => e.verdict !== 'blocked'),
      (n) => (n.data as { info: { namespace: string } }).info.namespace,
    )
    return { nodes: laidOut, edges: rfEdges }
  }, [topology.data])
  const shownEdges = useMemo(
    () =>
      edges
        .filter((e) => {
          const edge = (e.data as { edge: TopologyEdge }).edge
          return visible[edge.verdict] && (!observedOnly || edge.observed)
        })
        // Hovering a workload highlights its own connections.
        .map((e) =>
          hovered && e.source !== hovered && e.target !== hovered ? { ...e, style: { ...e.style, opacity: 0.12 } } : e,
        ),
    [edges, visible, observedOnly, hovered],
  )
  const shownNodes = useMemo(() => {
    if (!hovered) return nodes
    const near = new Set([hovered])
    for (const e of shownEdges) {
      if (e.source === hovered) near.add(e.target)
      if (e.target === hovered) near.add(e.source)
    }
    return nodes.map((n) => (near.has(n.id) ? n : { ...n, style: { opacity: 0.35 } }))
  }, [nodes, shownEdges, hovered])

  // Same graph for the 3D view.
  const nodes3d = useMemo<Node3D[]>(
    () =>
      (topology.data?.nodes ?? []).map((n) => ({
        id: n.id,
        label: n.workload.split('/').slice(1).join('/') || n.workload,
        group: n.namespace,
        size: n.podCount,
      })),
    [topology.data],
  )
  const links3d = useMemo<Link3D[]>(
    () =>
      (topology.data?.edges ?? [])
        .filter((e) => visible[e.verdict] && (!observedOnly || e.observed))
        .map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          colorToken: VERDICT_STYLE[e.verdict].token,
          particles: e.verdict === 'blocked' ? 0 : e.observed ? 4 : e.verdict === 'allowed' ? 2 : 1,
          emphasis: !!e.observed,
          faint: e.verdict === 'blocked',
        })),
    [topology.data, visible, observedOnly],
  )
  const nodeInfo = activeNode ? topology.data?.nodes.find((n) => n.id === activeNode) : undefined
  const observedCount = topology.data?.edges.filter((e) => e.observed).length ?? 0
  // Traffic that was flowing but current policies block: likely broken.
  const observedBlocked = topology.data?.edges.filter((e) => e.observed && e.verdict === 'blocked').length ?? 0
  const counts = useMemo(() => {
    const c: Record<EdgeVerdict, number> = { allowed: 0, blocked: 0, unconstrained: 0 }
    for (const e of topology.data?.edges ?? []) c[e.verdict]++
    return c
  }, [topology.data])

  const toggle = (ns: string) => setSelected((cur) => (cur.includes(ns) ? cur.filter((n) => n !== ns) : [...cur, ns]))

  const userNamespaces = (namespaces ?? []).filter(
    (ns) => !ns.name.startsWith('kube-') && ns.name !== 'local-path-storage' && ns.podCount > 0,
  )

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2.5 border-b border-edge bg-surface px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs font-medium text-muted">Namespaces</span>
          {userNamespaces.map((ns) => (
            <button
              key={ns.name}
              onClick={() => toggle(ns.name)}
              aria-pressed={selected.includes(ns.name)}
              className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-3 font-mono text-xs transition-colors ${
                selected.includes(ns.name)
                  ? 'border-accent bg-accent-soft text-accent-strong'
                  : 'border-edge bg-surface text-muted hover:border-edge-strong hover:text-text'
              }`}
            >
              {ns.name}
              <span className="text-quiet">{ns.podCount}</span>
            </button>
          ))}
          {namespaces && userNamespaces.length === 0 && (
            <span className="text-sm text-muted">No user namespaces with pods yet.</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs font-medium text-muted">Show</span>
          {(Object.keys(VERDICT_STYLE) as EdgeVerdict[]).map((v) => (
            <LegendToggle
              key={v}
              label={v === 'unconstrained' ? 'no policy' : v}
              count={topology.data ? counts[v] : undefined}
              stroke={VERDICT_STYLE[v].stroke}
              dash={VERDICT_STYLE[v].dash}
              pressed={visible[v]}
              title={VERDICT_STYLE[v].label}
              onClick={() => setVisible((cur) => ({ ...cur, [v]: !cur[v] }))}
            />
          ))}
          {topology.data?.flowsEnabled && (
            <>
              <span className="mx-1 h-5 w-px bg-edge" />
              <button
                aria-pressed={observedOnly}
                onClick={() => setObservedOnly((cur) => !cur)}
                title="Only connections the node agents actually saw (thick lines)"
                className={`inline-flex h-7 items-center gap-2 rounded-full border px-3 text-xs font-medium transition-colors ${
                  observedOnly ? 'border-accent bg-accent-soft text-accent-strong' : 'border-edge bg-surface text-text'
                }`}
              >
                <svg width="22" height="6" aria-hidden>
                  <line x1="0" y1="3" x2="22" y2="3" stroke="currentColor" strokeWidth="3.5" />
                </svg>
                observed only
                <span className="text-quiet">{observedCount}</span>
              </button>
              {observedBlocked > 0 && (
                <Badge tone="block">
                  <span data-observed-blocked>
                    {observedBlocked} observed connection{observedBlocked === 1 ? '' : 's'} now blocked
                  </span>
                </Badge>
              )}
            </>
          )}
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {selected.length === 0 && <GraphHint>Select one or more namespaces above to map their traffic.</GraphHint>}
        {topology.error instanceof ApiError && (
          <GraphHint tone="error">
            {topology.error.code === 'TOO_MANY_WORKLOADS'
              ? topology.error.message
              : `Could not compute the topology: ${topology.error.message}`}
          </GraphHint>
        )}
        {topology.data && topology.data.nodes.length === 0 && (
          <GraphHint>No running workloads in this selection.</GraphHint>
        )}
        {nodes.length > 0 && dim === '3d' && (
          <Suspense fallback={<Spinner label="Loading 3D view…" />}>
            <Graph3D
              nodes={nodes3d}
              links={links3d}
              selectedId={activeNode}
              onNodeClick={(id) => {
                setActiveEdge(null)
                setActiveNode(id)
              }}
              onLinkClick={(id) => {
                setActiveNode(null)
                setActiveEdge(topology.data?.edges.find((e) => e.id === id) ?? null)
              }}
              onBackgroundClick={() => {
                setActiveNode(null)
                setActiveEdge(null)
              }}
            />
          </Suspense>
        )}
        {nodes.length > 0 && dim === '2d' && (
          <ReactFlow
            nodes={shownNodes}
            edges={shownEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodeClick={(_, node) => {
              const info = (node.data as { info: { namespace: string; workload: string } }).info
              navigate(
                `/firewall?namespace=${encodeURIComponent(info.namespace)}&workload=${encodeURIComponent(info.workload)}`,
              )
            }}
            onNodeMouseEnter={(_, node) => setHovered(node.id)}
            onNodeMouseLeave={() => setHovered(null)}
            onEdgeClick={(_, edge) => setActiveEdge((edge.data as { edge: TopologyEdge }).edge)}
            onPaneClick={() => setActiveEdge(null)}
            fitView
            proOptions={{ hideAttribution: true }}
            colorMode={theme}
          >
            <Background color="var(--color-edge-strong)" gap={24} />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}

        {nodeInfo && !activeEdge && (
          <GraphPanel onClose={() => setActiveNode(null)}>
            <div className="pr-8 font-mono text-sm font-semibold text-text">{nodeInfo.workload}</div>
            <div className="mt-0.5 text-xs text-muted">
              namespace <span className="font-mono">{nodeInfo.namespace}</span> · {nodeInfo.podCount} pod
              {nodeInfo.podCount === 1 ? '' : 's'}
            </div>
            {nodeInfo.hostNetwork && (
              <p className="mt-2 text-xs text-warn-text">Runs on the host network — policy selectors do not apply.</p>
            )}
            <dl className="mt-3 space-y-1 text-xs">
              {(['allowed', 'blocked', 'unconstrained'] as EdgeVerdict[]).map((v) => {
                const n = (topology.data?.edges ?? []).filter(
                  (e) => e.verdict === v && (e.source === nodeInfo.id || e.target === nodeInfo.id),
                ).length
                return (
                  <div key={v} className="flex justify-between">
                    <dt className="flex items-center gap-2 text-muted">
                      <span className="h-2 w-2 rounded-full" style={{ background: VERDICT_STYLE[v].stroke }} />
                      {VERDICT_STYLE[v].label}
                    </dt>
                    <dd className="font-semibold tabular-nums text-text">{n}</dd>
                  </div>
                )
              })}
            </dl>
            <Link
              to={`/firewall?namespace=${encodeURIComponent(nodeInfo.namespace)}&workload=${encodeURIComponent(nodeInfo.workload)}`}
              className="mt-3 inline-flex text-sm font-medium text-accent-strong hover:underline"
            >
              Open firewall →
            </Link>
          </GraphPanel>
        )}
        {activeEdge && (
          <GraphPanel onClose={() => setActiveEdge(null)}>
            <div className="min-w-0 pr-8 font-mono text-xs text-muted">
              <div className="truncate text-text">{activeEdge.source.split('/').slice(1).join('/')}</div>
              <div className="truncate">→ {activeEdge.target.split('/').slice(1).join('/')}</div>
            </div>
            <div className="mt-2 text-sm font-semibold" style={{ color: VERDICT_STYLE[activeEdge.verdict].stroke }}>
              {VERDICT_STYLE[activeEdge.verdict].label}
            </div>
            {activeEdge.observed && (
              <div className="mt-2 rounded-lg bg-raised/70 p-2.5 text-sm text-text" data-edge-observed>
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
            <div className="mt-3 border-t border-edge pt-3">
              <div className="text-xs font-medium text-muted">Policies involved</div>
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
          </GraphPanel>
        )}
      </div>
    </div>
  )
}
