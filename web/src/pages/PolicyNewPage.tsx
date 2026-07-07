import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useCreatePolicy, useNamespaces } from '../api/queries'
import { ApiError } from '../api/client'
import { draftToPolicy, emptyDraft } from '../policy/model'
import type { PolicyDraft } from '../policy/model'
import PolicyForm from '../components/policy-form/PolicyForm'

export default function PolicyNewPage() {
  const navigate = useNavigate()
  const { data: namespaces } = useNamespaces()
  const create = useCreatePolicy()

  const userNamespaces = (namespaces ?? [])
    .map((ns) => ns.name)
    .filter((n) => !n.startsWith('kube-'))

  const [draft, setDraft] = useState<PolicyDraft>(() => emptyDraft(''))
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  // Pick the first namespace once loaded.
  useEffect(() => {
    if (draft.namespace === '' && userNamespaces.length > 0) {
      setDraft((d) => ({ ...d, namespace: userNamespaces[0] }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.namespace, userNamespaces.join(',')])

  const submit = (dryRun: boolean) => {
    create.mutate(
      { namespace: draft.namespace, payload: { json: draftToPolicy(draft) }, dryRun },
      {
        onSuccess: () => {
          if (dryRun) {
            setFeedback({ tone: 'ok', text: 'Valid — the API server accepts this policy.' })
          } else {
            navigate(`/policies/${draft.namespace}/${draft.name}`)
          }
        },
        onError: (err) =>
          setFeedback({ tone: 'error', text: err instanceof ApiError ? err.message : String(err) }),
      },
    )
  }

  const ready = draft.name.trim() !== '' && draft.namespace !== ''

  return (
    <div className="mx-auto max-w-3xl p-6">
      <Link to="/policies" className="font-mono text-xs text-quiet hover:text-accent-strong">
        ← policies
      </Link>
      <h1 className="mt-1 text-lg font-bold text-text">New NetworkPolicy</h1>

      <div className="mt-4">
        <PolicyForm value={draft} onChange={setDraft} namespaces={userNamespaces} />
      </div>

      {feedback && (
        <p className={`mt-3 font-mono text-xs ${feedback.tone === 'ok' ? 'text-accent-strong' : 'text-block'}`}>
          {feedback.text}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <button
          onClick={() => submit(true)}
          disabled={!ready || create.isPending}
          className="rounded border border-edge px-3 py-1.5 text-sm text-muted hover:border-accent hover:text-accent-strong disabled:opacity-50"
        >
          Validate (dry-run)
        </button>
        <button
          onClick={() => submit(false)}
          disabled={!ready || create.isPending}
          className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:brightness-110 disabled:opacity-50"
        >
          Create policy
        </button>
      </div>
    </div>
  )
}
