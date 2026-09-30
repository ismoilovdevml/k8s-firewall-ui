import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import type { TopologyNode } from '../../api/types'
import { IconBox } from '../icons'

export type WorkloadNodeData = { info: TopologyNode }

export default function WorkloadNode({ data }: NodeProps) {
  const { info } = data as WorkloadNodeData
  const [kind, name] = info.workload.split('/', 2)

  return (
    <div
      title="Open this workload's firewall"
      className="flex w-[230px] cursor-pointer items-start gap-2.5 rounded-xl border border-edge bg-surface px-3 py-2.5 shadow-card transition hover:border-accent hover:shadow-pop"
    >
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-raised text-muted">
        <IconBox size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-mono text-sm font-semibold text-text">{name}</span>
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-quiet">{kind}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <span className="font-mono">{info.namespace}</span>
          <span className="text-quiet">·</span>
          <span>
            {info.podCount} pod{info.podCount === 1 ? '' : 's'}
          </span>
          {info.hostNetwork && (
            <span
              className="rounded bg-warn-bg px-1 text-[10px] font-medium text-warn-text"
              title="Runs on the host network — policy selectors do not apply to it"
            >
              hostNet
            </span>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </div>
  )
}
