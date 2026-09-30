import type { PeerDraft, PeerKind } from '../../policy/model'
import { IconInfo, IconTrash } from '../icons'
import { IconButton, Input, Select } from '../ui'
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
    if (kind === 'namespaces' || kind === 'podsInNamespaces') next.namespaceSelector = value.namespaceSelector ?? {}
    if (kind === 'ipBlock') {
      next.cidr = value.cidr ?? ''
      next.except = value.except ?? []
    }
    onChange(next)
  }

  return (
    <div className="rounded-lg border border-edge bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <Select
          aria-label="Peer type"
          value={value.kind}
          onChange={(e) => setKind(e.target.value as PeerKind)}
          className="h-8 text-[13px]"
        >
          {(Object.keys(KIND_LABELS) as PeerKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </Select>
        <IconButton label="Remove peer" onClick={onRemove} className="hover:bg-block-soft hover:text-block">
          <IconTrash size={15} />
        </IconButton>
      </div>

      {value.kind === 'podsInNamespaces' && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-muted">
          <IconInfo size={13} className="mt-0.5 text-info" />
          Both conditions must match (AND). To allow either one, add two separate peers instead.
        </p>
      )}

      {(value.kind === 'pods' || value.kind === 'podsInNamespaces') && (
        <div className="mt-3">
          <div className="mb-1 text-xs font-medium text-muted">Pod labels</div>
          <LabelMapEditor
            value={value.podSelector ?? {}}
            onChange={(podSelector) => onChange({ ...value, podSelector })}
            emptyHint="no labels — matches all pods"
          />
        </div>
      )}

      {(value.kind === 'namespaces' || value.kind === 'podsInNamespaces') && (
        <div className="mt-3">
          <div className="mb-1 text-xs font-medium text-muted">Namespace labels</div>
          <LabelMapEditor
            value={value.namespaceSelector ?? {}}
            onChange={(namespaceSelector) => onChange({ ...value, namespaceSelector })}
            emptyHint="no labels — matches all namespaces"
          />
        </div>
      )}

      {value.kind === 'ipBlock' && (
        <div className="mt-3 space-y-2">
          <Input
            mono
            value={value.cidr ?? ''}
            onChange={(e) => onChange({ ...value, cidr: e.target.value })}
            placeholder="CIDR, e.g. 10.0.0.0/8"
            aria-label="CIDR"
            className="h-8 w-full"
          />
          <Input
            mono
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
            aria-label="Excluded CIDRs"
            className="h-8 w-full"
          />
        </div>
      )}
    </div>
  )
}
