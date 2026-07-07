import type { PortDraft } from '../../policy/model'

interface Props {
  value: PortDraft[]
  onChange: (value: PortDraft[]) => void
}

export default function PortListEditor({ value, onChange }: Props) {
  const setPort = (i: number, port: PortDraft) =>
    onChange(value.map((p, j) => (j === i ? port : p)))

  return (
    <div className="space-y-1.5">
      {value.map((port, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <select
            value={port.protocol}
            onChange={(e) => setPort(i, { ...port, protocol: e.target.value as PortDraft['protocol'] })}
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
            onChange={(e) => setPort(i, { ...port, endPort: e.target.value || undefined })}
            placeholder="end (opt)"
            disabled={!/^\d+$/.test(port.port)}
            className="w-20 rounded border border-edge bg-base px-2 py-1 font-mono text-xs text-text placeholder:text-quiet focus:border-accent focus:outline-none disabled:opacity-40"
          />
          <button
            type="button"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
            className="text-xs text-quiet hover:text-block"
            aria-label="Remove port"
          >
            ✕
          </button>
        </div>
      ))}
      {value.length === 0 && (
        <p className="text-xs text-quiet">
          No ports — allows <span className="text-accent-strong">all ports</span>.
        </p>
      )}
      <button
        type="button"
        onClick={() => onChange([...value, { protocol: 'TCP', port: '' }])}
        className="rounded border border-edge px-2 py-1 text-xs text-muted hover:border-accent hover:text-accent-strong"
      >
        Add port
      </button>
    </div>
  )
}
