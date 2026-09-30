import type { PolicyDraft, RuleDraft } from '../../policy/model'
import { IconArrowRight, IconPlus } from '../icons'
import { Button, Card, Field, Input, Select } from '../ui'
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
  const setRules = (direction: 'ingress' | 'egress', rules: RuleDraft[]) => onChange({ ...value, [direction]: rules })

  const ruleSection = (direction: 'ingress' | 'egress') => {
    const enabled = direction === 'ingress' ? value.ingressEnabled : value.egressEnabled
    const rules = value[direction]
    const word = direction === 'ingress' ? 'incoming' : 'outgoing'
    return (
      <Card>
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) =>
              onChange({
                ...value,
                [direction === 'ingress' ? 'ingressEnabled' : 'egressEnabled']: e.target.checked,
              })
            }
            className="mt-1 h-4 w-4"
          />
          <span className="min-w-0">
            <span className="flex items-center gap-2 text-sm font-semibold text-text">
              <IconArrowRight size={15} className={direction === 'ingress' ? 'text-info' : 'text-accent-strong'} />
              {direction === 'ingress' ? 'Ingress — incoming traffic' : 'Egress — outgoing traffic'}
            </span>
            <span className="mt-0.5 block text-xs text-muted">
              {enabled
                ? rules.length === 0
                  ? `Isolates the selected pods: ALL ${word} traffic is denied. Add rules to allow specific traffic.`
                  : `${direction === 'ingress' ? 'Incoming' : 'Outgoing'} traffic is denied unless a rule below allows it.`
                : `This policy does not restrict ${word} traffic.`}
            </span>
          </span>
        </label>
        {enabled && (
          <div className="mt-4 space-y-3">
            {rules.map((rule, i) => (
              <RuleEditor
                key={i}
                index={i}
                value={rule}
                direction={direction}
                onChange={(r) =>
                  setRules(
                    direction,
                    rules.map((x, j) => (j === i ? r : x)),
                  )
                }
                onRemove={() =>
                  setRules(
                    direction,
                    rules.filter((_, j) => j !== i),
                  )
                }
              />
            ))}
            <Button
              size="sm"
              onClick={() => setRules(direction, [...rules, { peers: [], ports: [] }])}
              icon={<IconPlus size={14} />}
            >
              Add {direction} rule
            </Button>
          </div>
        )}
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card title="Basics" description="Name the policy and choose which pods it applies to.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input
              mono
              value={value.name}
              onChange={(e) => onChange({ ...value, name: e.target.value })}
              disabled={identityLocked}
              placeholder="allow-web-to-db"
              className="w-full"
            />
          </Field>
          <Field label="Namespace">
            {identityLocked || !namespaces ? (
              <Input mono value={value.namespace} disabled className="w-full" />
            ) : (
              <Select
                mono
                value={value.namespace}
                onChange={(e) => onChange({ ...value, namespace: e.target.value })}
                className="w-full"
              >
                {namespaces.map((ns) => (
                  <option key={ns}>{ns}</option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="mt-4">
          <span className="mb-1.5 block text-xs font-medium text-muted">Applies to pods with labels</span>
          <LabelMapEditor
            value={value.podSelector}
            onChange={(podSelector) => onChange({ ...value, podSelector })}
            emptyHint="no labels — applies to EVERY pod in the namespace"
          />
        </div>
      </Card>

      {ruleSection('ingress')}
      {ruleSection('egress')}
    </div>
  )
}
