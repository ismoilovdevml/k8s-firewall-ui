import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import type { TopologyNode } from '../../api/types'

export type WorkloadNodeData = { info: TopologyNode }

export default function WorkloadNode({ data }: NodeProps) {
  const { info } = data as WorkloadNodeData
  const [kind, name] = info.workload.split('/', 2)

  return (
    <div className="w-[220px] rounded-md border border-edge bg-raised px-3 py-2 shadow-lg shadow-black/30">
      <Handle type="target" position={Position.Left} className="!bg-quiet" />
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-mono text-sm font-semibold text-text">{name}</span>
        <span className="shrink-0 font-mono text-[10px] uppercase text-quiet">{kind}</span>
      </div>
      <div className="mt-1 flex items-center gap-2 font-mono text-xs text-muted">
        <span>{info.namespace}</span>
        <span>·</span>
        <span>
          {info.podCount} pod{info.podCount === 1 ? '' : 's'}
        </span>
        {info.hostNetwork && (
          <span
            className="text-accent"
            title="Runs on the host network — policy selectors do not apply to it"
          >
            hostNet
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-quiet" />
    </div>
  )
}
