import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useCreatePolicy, useNamespaces, usePermissions } from '../api/queries'
import { errorMessage } from '../api/client'
import { draftToPolicy, emptyDraft } from '../policy/model'
import type { PolicyDraft } from '../policy/model'
import { TEMPLATES, findTemplate } from '../policy/templates'
import PolicyForm from '../components/policy-form/PolicyForm'
import ImpactPanel from '../components/ImpactPanel'
import { Button, Feedback, PageHeader } from '../components/ui'

export default function PolicyNewPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { data: namespaces } = useNamespaces()
  const create = useCreatePolicy()

  const userNamespaces = (namespaces ?? []).map((ns) => ns.name).filter((n) => !n.startsWith('kube-'))

  const initialNs = params.get('namespace') ?? ''
  const initialTemplate = findTemplate(params.get('template'))
  const [templateId, setTemplateId] = useState<string>(initialTemplate?.id ?? 'blank')
  const [draft, setDraft] = useState<PolicyDraft>(() =>
    initialTemplate ? initialTemplate.build(initialNs) : emptyDraft(initialNs),
  )
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const perms = usePermissions(draft.namespace)
  const denied = perms.data && !perms.data.create

  // Pick the first namespace once loaded.
  useEffect(() => {
    if (draft.namespace === '' && userNamespaces.length > 0) {
      setDraft((d) => ({ ...d, namespace: userNamespaces[0] }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.namespace, userNamespaces.join(',')])

  const applyTemplate = (id: string) => {
    setTemplateId(id)
    setFeedback(null)
    const t = findTemplate(id)
    setDraft(t ? t.build(draft.namespace) : emptyDraft(draft.namespace))
  }

  const policy = useMemo(() => draftToPolicy(draft), [draft])
  const ready = draft.name.trim() !== '' && draft.namespace !== ''

  const submit = (dryRun: boolean) => {
    create.mutate(
      { namespace: draft.namespace, payload: { json: policy }, dryRun },
      {
        onSuccess: () => {
          if (dryRun) setFeedback({ tone: 'ok', text: 'Valid — the API server accepts this policy.' })
          else navigate(`/policies/${draft.namespace}/${draft.name}`)
        },
        onError: (err) => setFeedback({ tone: 'error', text: errorMessage(err) }),
      },
    )
  }

  const template = findTemplate(templateId)

  return (
    <div className="mx-auto max-w-5xl p-6">
      <Link to="/policies" className="font-mono text-xs text-quiet hover:text-accent-strong">
        ← policies
      </Link>
      <div className="mt-1">
        <PageHeader
          title="New NetworkPolicy"
          subtitle="Start from a proven pattern or a blank policy. Validate with a server-side dry-run and preview the impact before creating."
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
        <TemplateCard active={templateId === 'blank'} title="Blank" description="An empty ingress policy." onClick={() => applyTemplate('blank')} />
        {TEMPLATES.map((t) => (
          <TemplateCard
            key={t.id}
            active={templateId === t.id}
            title={t.title}
            description={t.description}
            onClick={() => applyTemplate(t.id)}
          />
        ))}
      </div>
      {template?.caution && (
        <div className="mt-3 rounded-lg border border-warn bg-warn-bg/60 px-3 py-2 text-sm text-warn-text">
          ⚠ {template.caution} Review the impact preview before creating.
        </div>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-[3fr_2fr]">
        <div>
          <PolicyForm value={draft} onChange={setDraft} namespaces={userNamespaces} />
          {denied && (
            <p className="mt-3 text-sm text-block">
              Your account is not allowed to create NetworkPolicies in “{draft.namespace}”.
            </p>
          )}
          {feedback && <Feedback tone={feedback.tone}>{feedback.text}</Feedback>}
          <div className="mt-4 flex gap-2">
            <Button onClick={() => submit(true)} disabled={!ready || create.isPending}>
              Validate (dry-run)
            </Button>
            <Button variant="primary" onClick={() => submit(false)} disabled={!ready || create.isPending || denied}>
              Create policy
            </Button>
          </div>
        </div>
        <div className="space-y-4">
          <ImpactPanel request={ready ? { operation: 'apply', namespace: draft.namespace, policy } : null} />
        </div>
      </div>
    </div>
  )
}

function TemplateCard({
  active,
  title,
  description,
  onClick,
}: {
  active: boolean
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-lg border p-3 text-left transition ${
        active ? 'border-accent bg-accent/5 ring-1 ring-accent' : 'border-edge bg-surface hover:border-accent/60'
      }`}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-sm font-semibold text-text">{title}</span>
      </div>
      <p className="mt-1 line-clamp-3 text-xs text-muted">{description}</p>
    </button>
  )
}
