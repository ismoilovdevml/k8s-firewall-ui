import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { labelsText, peerText, portText } from '../../policy/describe'
import type { LabelMap } from '../../policy/model'
import type { BuilderPeer } from '../../builder/store'

export function TargetNode({ data }: NodeProps) {
  const { name, podSelector } = data as { name: string; podSelector: LabelMap }
  return (
    <div className="w-[230px] rounded-md border-2 border-accent/70 bg-raised px-3 py-2 shadow-sm">
      <Handle type="target" position={Position.Left} className="!bg-accent" />
      <div className="font-mono text-[10px] uppercase tracking-wide text-accent">
        policy target
      </div>
      <div className="mt-0.5 truncate font-mono text-sm font-semibold text-text">
        {name || 'unnamed policy'}
      </div>
      <div className="mt-1 font-mono text-xs text-muted">
        pods [{labelsText(podSelector, 'all in namespace')}]
      </div>
      <Handle type="source" position={Position.Right} className="!bg-accent" />
    </div>
  )
}

export function PeerNode({ data, selected }: NodeProps) {
  const { card } = data as { card: BuilderPeer }
  const dirColor = card.direction === 'ingress' ? 'text-allow' : 'text-accent-strong'
  return (
    <div
      className={`w-[230px] cursor-pointer rounded-md border bg-surface px-3 py-2 shadow-sm ${
        selected ? 'border-accent' : 'border-edge hover:border-quiet'
      }`}
    >
      {card.direction === 'ingress' ? (
        <Handle type="source" position={Position.Right} className="!bg-quiet" />
      ) : (
        <Handle type="target" position={Position.Left} className="!bg-quiet" />
      )}
      <div className={`font-mono text-[10px] uppercase tracking-wide ${dirColor}`}>
        {card.direction === 'ingress' ? 'allow from' : 'allow to'}
      </div>
      <div className="mt-1 text-xs text-text">{peerText(card.peer)}</div>
      <div className="mt-1 font-mono text-[11px] text-muted">
        {card.ports.length === 0 ? 'all ports' : card.ports.map(portText).join(', ')}
      </div>
    </div>
  )
}
