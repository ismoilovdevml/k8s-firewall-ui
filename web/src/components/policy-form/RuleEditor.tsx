import type { RuleDraft } from '../../policy/model'
import PeerEditor from './PeerEditor'
import PortListEditor from './PortListEditor'

interface Props {
  value: RuleDraft
  direction: 'ingress' | 'egress'
  onChange: (value: RuleDraft) => void
  onRemove: () => void
}

export default function RuleEditor({ value, direction, onChange, onRemove }: Props) {
  const setPeer = (i: number, peer: RuleDraft['peers'][number]) =>
    onChange({ ...value, peers: value.peers.map((p, j) => (j === i ? peer : p)) })

  return (
    <div className="rounded-md border border-edge bg-base p-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-muted">
          {direction === 'ingress' ? 'Allow from' : 'Allow to'}
        </span>
        <button type="button" onClick={onRemove} className="text-xs text-quiet hover:text-block">
          Remove rule
        </button>
      </div>

      <div className="mt-2 space-y-2">
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
            <span className="text-accent">anywhere</span>.
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() =>
              onChange({ ...value, peers: [...value.peers, { kind: 'pods', podSelector: {} }] })
            }
            className="rounded border border-edge px-2 py-1 text-xs text-muted hover:border-accent hover:text-accent"
          >
            Add peer
          </button>
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-quiet">ports</div>
        <PortListEditor value={value.ports} onChange={(ports) => onChange({ ...value, ports })} />
      </div>
    </div>
  )
}
