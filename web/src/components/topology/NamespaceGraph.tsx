import { useMemo, useState } from 'react'
import { Background, Controls, Handle, MarkerType, Position, ReactFlow } from '@xyflow/react'
import type { Edge, Node, NodeProps } from '@xyflow/react'
import { errorMessage } from '../../api/client'
import { useNamespaceTopology } from '../../api/queries'
import type { NamespaceGraphEdge, NamespaceGraphNode, VerdictCounts } from '../../api/types'
import { useTheme } from '../../theme'
import { IconArrowRight, IconLayers } from '../icons'
import { Spinner } from '../ui'
import { layoutCircle } from './layout'
import FloatingEdge from './FloatingEdge'
import { GraphHint, GraphPanel, LegendToggle } from './controls'
import { REACH_STYLE, classify, type Reach } from './reach'

function openText(c: VerdictCounts) {
  const total = c.allowed + c.blocked + c.unconstrained
  return `${c.allowed + c.unconstrained}/${total} open`
}

const REACH_LABEL: Record<Reach, string> = {
  allowed: 'allowed',
  partial: 'partial',
  blocked: 'blocked',
  unconstrained: 'no policy',
}

type NsNodeData = { info: NamespaceGraphNode; onOpen: (ns: string) => void }

function NamespaceNode({ data }: NodeProps) {
  const { info, onOpen } = data as NsNodeData
  const internal = info.internal.allowed + info.internal.blocked + info.internal.unconstrained
  return (
    <button
      onClick={() => onOpen(info.namespace)}
      title="Open this namespace's workloads"
      className="group flex w-[230px] items-start gap-2.5 rounded-xl border border-edge bg-surface px-3 py-2.5 text-left shadow-card transition hover:border-accent hover:shadow-pop"
    >
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-strong">
        <IconLayers size={16} />
      </div>
      <div className="min-w-0">
        <div className="truncate font-mono text-sm font-semibold text-text">{info.namespace}</div>
        <div className="mt-0.5 text-xs text-muted">
          {info.workloads} workload{info.workloads === 1 ? '' : 's'} · {info.pods} pod{info.pods === 1 ? '' : 's'}
        </div>
        {internal > 0 && <div className="mt-0.5 text-[11px] text-quiet">internal: {openText(info.internal)}</div>}
      </div>
      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </button>
  )
}

const nodeTypes = { namespace: NamespaceNode }
const edgeTypes = { floating: FloatingEdge }

export default function NamespaceGraph({ onOpen }: { onOpen: (ns: string) => void }) {
  const { data, error, isLoading } = useNamespaceTopology(true)
  const theme = useTheme()
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
      <div className="flex flex-wrap items-center gap-2 border-b border-edge bg-surface px-4 py-2.5">
        <span className="mr-1 text-xs font-medium text-muted">Show</span>
        {(Object.keys(REACH_STYLE) as Reach[]).map((r) => (
          <LegendToggle
            key={r}
            label={REACH_LABEL[r]}
            count={data ? counts[r] : undefined}
            stroke={REACH_STYLE[r].stroke}
            dash={REACH_STYLE[r].dash}
            pressed={visible[r]}
            title={REACH_STYLE[r].label}
            onClick={() => setVisible((cur) => ({ ...cur, [r]: !cur[r] }))}
          />
        ))}
        <span className="ml-auto hidden text-xs text-quiet md:inline">
          Click a namespace to open its workloads · click a line for details
        </span>
      </div>
      <div className="relative min-h-0 flex-1">
        {isLoading && <Spinner label="Computing namespace graph…" />}
        {error && <GraphHint tone="error">{errorMessage(error)}</GraphHint>}
        {data && data.nodes.length === 0 && <GraphHint>No application namespaces with running pods.</GraphHint>}
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
            colorMode={theme}
          >
            <Background color="var(--color-edge-strong)" gap={24} />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}
        {active && (
          <GraphPanel onClose={() => setActive(null)}>
            <div className="pr-8 font-mono text-sm text-text">
              {active.source} <span className="text-quiet">→</span> {active.target}
            </div>
            <div
              className="mt-1.5 text-sm font-semibold"
              style={{ color: REACH_STYLE[classify(active.counts)].stroke }}
            >
              {REACH_STYLE[classify(active.counts)].label}
            </div>
            <dl className="mt-3 space-y-1.5 text-xs">
              <CountRow label="allowed by policy" n={active.counts.allowed} color="var(--color-allow)" />
              <CountRow label="no policy applies" n={active.counts.unconstrained} color="var(--color-quiet)" />
              <CountRow label="blocked" n={active.counts.blocked} color="var(--color-block)" />
            </dl>
            <p className="mt-2 text-xs text-quiet">Counts are workload pairs, any port.</p>
            <button
              onClick={() => onOpen(active.target)}
              className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent-strong hover:underline"
            >
              Open {active.target} workloads <IconArrowRight size={14} />
            </button>
          </GraphPanel>
        )}
      </div>
    </div>
  )
}

function CountRow({ label, n, color }: { label: string; n: number; color: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="flex items-center gap-2 text-muted">
        <span className="h-2 w-2 rounded-full" style={{ background: color }} />
        {label}
      </dt>
      <dd className="font-semibold tabular-nums text-text">{n}</dd>
    </div>
  )
}
