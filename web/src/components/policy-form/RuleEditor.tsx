import type { RuleDraft } from '../../policy/model'
import { IconPlus, IconTrash } from '../icons'
import { Button } from '../ui'
import PeerEditor from './PeerEditor'
import PortListEditor from './PortListEditor'

interface Props {
  value: RuleDraft
  direction: 'ingress' | 'egress'
  index?: number
  onChange: (value: RuleDraft) => void
  onRemove: () => void
}

export default function RuleEditor({ value, direction, index, onChange, onRemove }: Props) {
  const setPeer = (i: number, peer: RuleDraft['peers'][number]) =>
    onChange({ ...value, peers: value.peers.map((p, j) => (j === i ? peer : p)) })

  return (
    <div className="rounded-xl border border-edge bg-raised/50 p-4">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-semibold text-text">
          {index !== undefined && (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-soft text-[11px] text-accent-strong">
              {index + 1}
            </span>
          )}
          {direction === 'ingress' ? 'Allow from' : 'Allow to'}
        </span>
        <Button
          size="xs"
          variant="ghost"
          onClick={onRemove}
          icon={<IconTrash size={13} />}
          className="hover:bg-block-soft hover:text-block"
        >
          Remove rule
        </Button>
      </div>

      <div className="mt-3 space-y-2">
        {value.peers.map((peer, i) => (
          <PeerEditor
            key={i}
            value={peer}
            onChange={(p) => setPeer(i, p)}
            onRemove={() => onChange({ ...value, peers: value.peers.filter((_, j) => j !== i) })}
          />
        ))}
        {value.peers.length === 0 && (
          <p className="text-xs text-quiet">
            No peers — this rule allows traffic {direction === 'ingress' ? 'from' : 'to'}{' '}
            <span className="font-medium text-accent-strong">anywhere</span>.
          </p>
        )}
        <Button
          size="sm"
          onClick={() => onChange({ ...value, peers: [...value.peers, { kind: 'pods', podSelector: {} }] })}
          icon={<IconPlus size={14} />}
        >
          Add peer
        </Button>
      </div>

      <div className="mt-4 border-t border-edge pt-3">
        <div className="mb-2 text-xs font-medium text-muted">Ports</div>
        <PortListEditor value={value.ports} onChange={(ports) => onChange({ ...value, ports })} />
      </div>
    </div>
  )
}
