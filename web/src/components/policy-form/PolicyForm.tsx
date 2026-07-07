import type { PolicyDraft, RuleDraft } from '../../policy/model'
import LabelMapEditor from './LabelMapEditor'
import RuleEditor from './RuleEditor'

interface Props {
  value: PolicyDraft
  onChange: (value: PolicyDraft) => void
  /** Name and namespace are fixed when editing an existing policy. */
  identityLocked?: boolean
  namespaces?: string[]
}

export default function PolicyForm({ value, onChange, identityLocked, namespaces }: Props) {
  const setRules = (direction: 'ingress' | 'egress', rules: RuleDraft[]) =>
    onChange({ ...value, [direction]: rules })

  const ruleSection = (direction: 'ingress' | 'egress') => {
    const enabled = direction === 'ingress' ? value.ingressEnabled : value.egressEnabled
    const rules = value[direction]
    return (
      <section className="rounded-md border border-edge bg-surface p-4">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) =>
              onChange({
                ...value,
                [direction === 'ingress' ? 'ingressEnabled' : 'egressEnabled']: e.target.checked,
              })
            }
            className="accent-(--color-accent)"
          />
          <span className="font-mono text-sm font-semibold text-text">
            {direction === 'ingress' ? 'Ingress' : 'Egress'}
          </span>
        </label>
        <p className="mt-1 text-xs text-muted">
          {enabled
            ? rules.length === 0
              ? `Isolates the selected pods: ALL ${direction === 'ingress' ? 'incoming' : 'outgoing'} traffic is denied. Add rules to allow specific traffic.`
              : `${direction === 'ingress' ? 'Incoming' : 'Outgoing'} traffic is denied unless a rule below allows it.`
            : `This policy does not restrict ${direction === 'ingress' ? 'incoming' : 'outgoing'} traffic.`}
        </p>
        {enabled && (
          <div className="mt-3 space-y-2">
            {rules.map((rule, i) => (
              <RuleEditor
                key={i}
                value={rule}
                direction={direction}
                onChange={(r) => setRules(direction, rules.map((x, j) => (j === i ? r : x)))}
                onRemove={() => setRules(direction, rules.filter((_, j) => j !== i))}
              />
            ))}
            <button
              type="button"
              onClick={() => setRules(direction, [...rules, { peers: [], ports: [] }])}
              className="rounded border border-edge px-3 py-1.5 text-xs text-muted hover:border-accent hover:text-accent-strong"
            >
              Add {direction} rule
            </button>
          </div>
        )}
      </section>
    )
  }

  return (
    <div className="space-y-4">
      <section className="rounded-md border border-edge bg-surface p-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block font-mono text-[10px] uppercase tracking-wide text-quiet">
              name
            </span>
            <input
              value={value.name}
              onChange={(e) => onChange({ ...value, name: e.target.value })}
              disabled={identityLocked}
              placeholder="allow-web-to-db"
              className="w-full rounded border border-edge bg-base px-2 py-1.5 font-mono text-sm text-text placeholder:text-quiet focus:border-accent focus:outline-none disabled:opacity-50"
            />
          </label>
          <label className="block">
            <span className="mb-1 block font-mono text-[10px] uppercase tracking-wide text-quiet">
              namespace
            </span>
            {identityLocked || !namespaces ? (
              <input
                value={value.namespace}
                disabled
                className="w-full rounded border border-edge bg-base px-2 py-1.5 font-mono text-sm text-text opacity-50"
              />
            ) : (
              <select
                value={value.namespace}
                onChange={(e) => onChange({ ...value, namespace: e.target.value })}
                className="w-full rounded border border-edge bg-base px-2 py-1.5 font-mono text-sm text-text focus:border-accent focus:outline-none"
              >
                {namespaces.map((ns) => (
                  <option key={ns}>{ns}</option>
                ))}
              </select>
            )}
          </label>
        </div>
        <div className="mt-3">
          <span className="mb-1 block font-mono text-[10px] uppercase tracking-wide text-quiet">
            applies to pods
          </span>
          <LabelMapEditor
            value={value.podSelector}
            onChange={(podSelector) => onChange({ ...value, podSelector })}
            emptyHint="no labels — applies to EVERY pod in the namespace"
          />
        </div>
      </section>

      {ruleSection('ingress')}
      {ruleSection('egress')}
    </div>
  )
}
