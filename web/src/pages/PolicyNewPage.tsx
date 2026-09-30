import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useCreatePolicy, useNamespaces, usePermissions } from '../api/queries'
import { errorMessage } from '../api/client'
import { draftToPolicy, emptyDraft } from '../policy/model'
import type { PolicyDraft } from '../policy/model'
import { TEMPLATES, findTemplate } from '../policy/templates'
import PolicyForm from '../components/policy-form/PolicyForm'
import ImpactPanel from '../components/ImpactPanel'
import { Alert, Button, Feedback, Page, PageHeader } from '../components/ui'
import { IconArrowLeft, IconCheck, IconPlus } from '../components/icons'

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
    <Page>
      <PageHeader
        back={
          <Link to="/policies" className="inline-flex items-center gap-1 text-sm text-muted hover:text-accent-strong">
            <IconArrowLeft size={14} /> Policies
          </Link>
        }
        icon={<IconPlus size={20} />}
        title="New NetworkPolicy"
        subtitle="Start from a proven pattern or a blank policy. Validate with a server-side dry-run and preview the impact before creating."
      />

      <Step n={1} title="Choose a starting point">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
          <TemplateCard
            active={templateId === 'blank'}
            title="Blank"
            description="An empty ingress policy."
            onClick={() => applyTemplate('blank')}
          />
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
          <Alert tone="warn" className="mt-3">
            {template.caution} Review the impact preview before creating.
          </Alert>
        )}
      </Step>

      <Step n={2} title="Adjust the rules">
        <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
          <div>
            <PolicyForm value={draft} onChange={setDraft} namespaces={userNamespaces} />
          </div>
          <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
            <ImpactPanel request={ready ? { operation: 'apply', namespace: draft.namespace, policy } : null} />
          </div>
        </div>
      </Step>

      <Step n={3} title="Validate and create">
        <div className="rounded-xl border border-edge bg-surface p-4 shadow-card">
          {denied && (
            <Alert tone="block" className="mb-3">
              Your account is not allowed to create NetworkPolicies in “{draft.namespace}”.
            </Alert>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-auto text-sm text-muted">
              {ready ? (
                <>
                  Creates{' '}
                  <span className="font-mono text-text">
                    {draft.namespace}/{draft.name}
                  </span>
                </>
              ) : (
                'Give the policy a name to continue.'
              )}
            </span>
            <Button onClick={() => submit(true)} disabled={!ready || create.isPending}>
              Validate (dry-run)
            </Button>
            <Button variant="primary" onClick={() => submit(false)} disabled={!ready || create.isPending || denied}>
              Create policy
            </Button>
          </div>
          {feedback && <Feedback tone={feedback.tone}>{feedback.text}</Feedback>}
        </div>
      </Step>
    </Page>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2.5 text-sm font-semibold text-text">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-xs font-bold text-on-accent">
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
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
      className={`relative flex flex-col justify-start rounded-xl border p-4 text-left transition-all ${
        active
          ? 'border-accent bg-accent-soft ring-1 ring-accent'
          : 'border-edge bg-surface shadow-card hover:border-edge-strong hover:shadow-pop'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold text-text">{title}</span>
        {active && (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent">
            <IconCheck size={12} />
          </span>
        )}
      </div>
      <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-muted">{description}</p>
    </button>
  )
}
