import type { PortDraft, RuleDraft } from '../../policy/model'
import PeerEditor from './PeerEditor'

interface Props {
  value: RuleDraft
  direction: 'ingress' | 'egress'
  onChange: (value: RuleDraft) => void
  onRemove: () => void
}

export default function RuleEditor({ value, direction, onChange, onRemove }: Props) {
  const setPeer = (i: number, peer: RuleDraft['peers'][number]) =>
    onChange({ ...value, peers: value.peers.map((p, j) => (j === i ? peer : p)) })
  const setPort = (i: number, port: PortDraft) =>
    onChange({ ...value, ports: value.ports.map((p, j) => (j === i ? port : p)) })

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
        <div className="space-y-1.5">
          {value.ports.map((port, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <select
                value={port.protocol}
                onChange={(e) =>
                  setPort(i, { ...port, protocol: e.target.value as PortDraft['protocol'] })
                }
                className="rounded border border-edge bg-base px-1.5 py-1 font-mono text-xs text-text focus:border-accent focus:outline-none"
              >
                <option>TCP</option>
                <option>UDP</option>
                <option>SCTP</option>
              </select>
              <input
                value={port.port}
                onChange={(e) => setPort(i, { ...port, port: e.target.value })}
                placeholder="port or name"
                className="w-28 rounded border border-edge bg-base px-2 py-1 font-mono text-xs text-text placeholder:text-quiet focus:border-accent focus:outline-none"
              />
              <span className="text-xs text-quiet">to</span>
              <input
                value={port.endPort ?? ''}
                onChange={(e) =>
                  setPort(i, { ...port, endPort: e.target.value || undefined })
                }
                placeholder="end (opt)"
                disabled={!/^\d+$/.test(port.port)}
                className="w-20 rounded border border-edge bg-base px-2 py-1 font-mono text-xs text-text placeholder:text-quiet focus:border-accent focus:outline-none disabled:opacity-40"
              />
              <button
                type="button"
                onClick={() => onChange({ ...value, ports: value.ports.filter((_, j) => j !== i) })}
                className="text-xs text-quiet hover:text-block"
                aria-label="Remove port"
              >
                ✕
              </button>
            </div>
          ))}
          {value.ports.length === 0 && (
            <p className="text-xs text-quiet">
              No ports — allows <span className="text-accent">all ports</span>.
            </p>
          )}
          <button
            type="button"
            onClick={() => onChange({ ...value, ports: [...value.ports, { protocol: 'TCP', port: '' }] })}
            className="rounded border border-edge px-2 py-1 text-xs text-muted hover:border-accent hover:text-accent"
          >
            Add port
          </button>
        </div>
      </div>
    </div>
  )
}
