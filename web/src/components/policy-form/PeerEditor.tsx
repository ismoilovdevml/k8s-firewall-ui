import type { PeerDraft, PeerKind } from '../../policy/model'
import LabelMapEditor from './LabelMapEditor'

const KIND_LABELS: Record<PeerKind, string> = {
  pods: 'Pods in this namespace',
  namespaces: 'Whole namespaces',
  podsInNamespaces: 'Pods in selected namespaces',
  ipBlock: 'IP range',
}

interface Props {
  value: PeerDraft
  onChange: (value: PeerDraft) => void
  onRemove: () => void
}

export default function PeerEditor({ value, onChange, onRemove }: Props) {
  const setKind = (kind: PeerKind) => {
    const next: PeerDraft = { kind }
    if (kind === 'pods' || kind === 'podsInNamespaces') next.podSelector = value.podSelector ?? {}
    if (kind === 'namespaces' || kind === 'podsInNamespaces')
      next.namespaceSelector = value.namespaceSelector ?? {}
    if (kind === 'ipBlock') {
      next.cidr = value.cidr ?? ''
      next.except = value.except ?? []
    }
    onChange(next)
  }

  return (
    <div className="rounded-md border border-edge bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <select
          value={value.kind}
          onChange={(e) => setKind(e.target.value as PeerKind)}
          className="rounded border border-edge bg-base px-2 py-1 text-xs text-text focus:border-accent focus:outline-none"
        >
          {(Object.keys(KIND_LABELS) as PeerKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onRemove}
          className="text-xs text-quiet hover:text-block"
          aria-label="Remove peer"
        >
          Remove
        </button>
      </div>

      {value.kind === 'podsInNamespaces' && (
        <p className="mt-2 text-xs text-quiet">
          Both conditions must match (AND). To allow either one, add two separate peers instead.
        </p>
      )}

      {(value.kind === 'pods' || value.kind === 'podsInNamespaces') && (
        <div className="mt-2">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-quiet">
            pod labels
          </div>
          <LabelMapEditor
            value={value.podSelector ?? {}}
            onChange={(podSelector) => onChange({ ...value, podSelector })}
            emptyHint="no labels — matches all pods"
          />
        </div>
      )}

      {(value.kind === 'namespaces' || value.kind === 'podsInNamespaces') && (
        <div className="mt-2">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-quiet">
            namespace labels
          </div>
          <LabelMapEditor
            value={value.namespaceSelector ?? {}}
            onChange={(namespaceSelector) => onChange({ ...value, namespaceSelector })}
            emptyHint="no labels — matches all namespaces"
          />
        </div>
      )}

      {value.kind === 'ipBlock' && (
        <div className="mt-2 space-y-1.5">
          <input
            value={value.cidr ?? ''}
            onChange={(e) => onChange({ ...value, cidr: e.target.value })}
            placeholder="CIDR, e.g. 10.0.0.0/8"
            className="w-full rounded border border-edge bg-base px-2 py-1 font-mono text-xs text-text placeholder:text-quiet focus:border-accent focus:outline-none"
          />
          <input
            value={(value.except ?? []).join(', ')}
            onChange={(e) =>
              onChange({
                ...value,
                except: e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            placeholder="except CIDRs, comma-separated (optional)"
            className="w-full rounded border border-edge bg-base px-2 py-1 font-mono text-xs text-text placeholder:text-quiet focus:border-accent focus:outline-none"
          />
        </div>
      )}
    </div>
  )
}
