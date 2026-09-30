import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { labelsText, peerText, portText } from '../../policy/describe'
import type { LabelMap } from '../../policy/model'
import type { BuilderPeer } from '../../builder/store'
import { IconShieldCheck } from '../icons'

export function TargetNode({ data }: NodeProps) {
  const { name, podSelector } = data as { name: string; podSelector: LabelMap }
  return (
    <div className="w-[240px] rounded-xl border-2 border-accent bg-surface px-3.5 py-3 shadow-pop">
      <Handle type="target" position={Position.Left} className="!bg-accent" />
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-accent-strong">
        <IconShieldCheck size={13} /> Policy target
      </div>
      <div className="mt-1 truncate font-mono text-sm font-semibold text-text">{name || 'unnamed policy'}</div>
      <div className="mt-1 font-mono text-xs text-muted">pods [{labelsText(podSelector, 'all in namespace')}]</div>
      <Handle type="source" position={Position.Right} className="!bg-accent" />
    </div>
  )
}

export function PeerNode({ data, selected }: NodeProps) {
  const { card } = data as { card: BuilderPeer }
  const ingress = card.direction === 'ingress'
  return (
    <div
      className={`w-[240px] cursor-pointer rounded-xl border border-l-4 bg-surface px-3.5 py-2.5 shadow-card transition ${
        ingress ? 'border-l-info' : 'border-l-accent'
      } ${selected ? 'border-accent ring-2 ring-accent/30' : 'border-edge hover:border-edge-strong'}`}
    >
      {ingress ? (
        <Handle type="source" position={Position.Right} className="!bg-quiet" />
      ) : (
        <Handle type="target" position={Position.Left} className="!bg-quiet" />
      )}
      <div
        className={`text-[11px] font-semibold uppercase tracking-wide ${ingress ? 'text-info' : 'text-accent-strong'}`}
      >
        {ingress ? 'Allow from' : 'Allow to'}
      </div>
      <div className="mt-1 text-xs text-text">{peerText(card.peer)}</div>
      <div className="mt-1 font-mono text-[11px] text-muted">
        {card.ports.length === 0 ? 'all ports' : card.ports.map(portText).join(', ')}
      </div>
    </div>
  )
}
