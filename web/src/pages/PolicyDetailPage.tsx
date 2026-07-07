import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useDeletePolicy, usePolicyDetail, useUpdatePolicy } from '../api/queries'
import { ApiError } from '../api/client'
import { draftToPolicy, policyToDraft } from '../policy/model'
import type { PolicyDraft } from '../policy/model'
import { isolationText, ruleText } from '../policy/describe'
import YamlEditor from '../components/YamlEditor'
import PolicyForm from '../components/policy-form/PolicyForm'

type Tab = 'overview' | 'edit' | 'yaml' | 'pods'

export default function PolicyDetailPage() {
  const { namespace = '', name = '' } = useParams()
  const navigate = useNavigate()
  const { data, isLoading, error } = usePolicyDetail(namespace, name)
  const update = useUpdatePolicy()
  const remove = useDeletePolicy()

  const [tab, setTab] = useState<Tab>('overview')
  const [yamlText, setYamlText] = useState('')
  const [draft, setDraft] = useState<PolicyDraft | null>(null)
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (data) {
      setYamlText(data.yaml)
      setDraft(null) // rebuilt lazily when the edit tab opens
      setFeedback(null)
    }
  }, [data])

  const conversion = useMemo(() => (data ? policyToDraft(data.policy) : null), [data])

  if (isLoading) return <PageNote>Loading…</PageNote>
  if (error instanceof ApiError) return <PageNote tone="error">{error.message}</PageNote>
  if (!data || !conversion) return null

  const startEdit = () => {
    setDraft(conversion.draft)
    setTab('edit')
  }

  const feedbackFrom = (err: unknown) =>
    setFeedback({
      tone: 'error',
      text:
        err instanceof ApiError
          ? err.status === 409
            ? 'The policy changed on the cluster while you were editing. Reload and re-apply your changes.'
            : err.message
          : String(err),
    })

  const validateOrApply = (dryRun: boolean) => {
    const payload =
      tab === 'yaml'
        ? ({ yaml: yamlText } as const)
        : ({
            json: {
              ...draftToPolicy(draft!),
              metadata: {
                ...draftToPolicy(draft!).metadata,
                // optimistic concurrency: reuse the loaded resourceVersion
                resourceVersion: data.policy.metadata.resourceVersion,
              },
            },
          } as const)
    update.mutate(
      { namespace, name, payload, dryRun },
      {
        onSuccess: () => {
          setFeedback({ tone: 'ok', text: dryRun ? 'Valid — the API server accepts this policy.' : 'Applied.' })
          if (!dryRun) setTab('overview')
        },
        onError: feedbackFrom,
      },
    )
  }

  const doDelete = () =>
    remove.mutate(
      { namespace, name },
      { onSuccess: () => navigate('/policies'), onError: feedbackFrom },
    )

  const TABS: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'edit', label: 'Edit' },
    { id: 'yaml', label: 'YAML' },
    { id: 'pods', label: `Affected pods (${data.affectedPods.length})` },
  ]

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link to="/policies" className="font-mono text-xs text-quiet hover:text-accent-strong">
            ← policies
          </Link>
          <h1 className="mt-1 font-mono text-lg font-semibold text-text">
            <span className="text-muted">{namespace}/</span>
            {name}
          </h1>
        </div>
        <button
          onClick={() => setConfirmDelete(true)}
          className="rounded border border-block/50 px-3 py-1.5 text-sm text-block hover:bg-block/10"
        >
          Delete
        </button>
      </div>

      <div className="mt-4 flex gap-1 border-b border-edge">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => (t.id === 'edit' ? startEdit() : (setTab(t.id), setFeedback(null)))}
            className={`px-3 py-2 font-mono text-xs ${
              tab === t.id
                ? 'border-b-2 border-accent text-accent-strong'
                : 'text-muted hover:text-text'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {feedback && (
        <p
          className={`mt-3 font-mono text-xs ${feedback.tone === 'ok' ? 'text-accent-strong' : 'text-block'}`}
        >
          {feedback.text}
        </p>
      )}

      <div className="mt-4">
        {tab === 'overview' && (
          <div className="space-y-4">
            <section className="rounded-md border border-edge bg-surface p-4">
              <h2 className="font-mono text-[11px] uppercase tracking-wide text-quiet">effect</h2>
              <ul className="mt-2 space-y-1 text-sm text-text">
                {isolationText(conversion.draft).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>
            {(['ingress', 'egress'] as const).map(
              (dir) =>
                conversion.draft[dir].length > 0 && (
                  <section key={dir} className="rounded-md border border-edge bg-surface p-4">
                    <h2 className="font-mono text-[11px] uppercase tracking-wide text-quiet">
                      {dir} rules
                    </h2>
                    <ol className="mt-2 list-inside list-decimal space-y-1 text-sm text-text">
                      {conversion.draft[dir].map((rule, i) => (
                        <li key={i}>{ruleText(rule, dir)}</li>
                      ))}
                    </ol>
                  </section>
                ),
            )}
          </div>
        )}

        {tab === 'edit' &&
          (conversion.lossy.length > 0 ? (
            <div className="rounded-md border border-accent/40 bg-accent/5 p-4 text-sm text-text">
              <p>This policy uses features the form cannot edit:</p>
              <ul className="mt-1 list-inside list-disc font-mono text-xs text-accent-strong">
                {conversion.lossy.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              <p className="mt-2 text-muted">Use the YAML tab instead.</p>
            </div>
          ) : (
            draft && (
              <div>
                <PolicyForm value={draft} onChange={setDraft} identityLocked />
                <ApplyBar
                  busy={update.isPending}
                  onValidate={() => validateOrApply(true)}
                  onApply={() => validateOrApply(false)}
                />
              </div>
            )
          ))}

        {tab === 'yaml' && (
          <div>
            <YamlEditor value={yamlText} onChange={setYamlText} />
            <ApplyBar
              busy={update.isPending}
              onValidate={() => validateOrApply(true)}
              onApply={() => validateOrApply(false)}
            />
          </div>
        )}

        {tab === 'pods' && (
          <div className="overflow-x-auto rounded-md border border-edge">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface font-mono text-[11px] uppercase tracking-wide text-quiet">
                <tr>
                  <th className="px-4 py-2 font-medium">pod</th>
                  <th className="px-4 py-2 font-medium">workload</th>
                  <th className="px-4 py-2 font-medium">ip</th>
                  <th className="px-4 py-2 font-medium">phase</th>
                </tr>
              </thead>
              <tbody>
                {data.affectedPods.map((p) => (
                  <tr key={p.name} className="border-t border-edge">
                    <td className="px-4 py-2 font-mono text-xs text-text">{p.name}</td>
                    <td className="px-4 py-2 font-mono text-xs text-muted">{p.owner}</td>
                    <td className="px-4 py-2 font-mono text-xs text-muted">{p.ip}</td>
                    <td className="px-4 py-2 font-mono text-xs text-muted">{p.phase}</td>
                  </tr>
                ))}
                {data.affectedPods.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-sm text-muted">
                      No running pods match this policy's selector right now.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {confirmDelete && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/60">
          <div className="w-96 rounded-md border border-edge bg-surface p-5 shadow-xl">
            <h2 className="font-mono text-sm font-semibold text-text">
              Delete {namespace}/{name}?
            </h2>
            <p className="mt-2 text-sm text-muted">
              {data.affectedPods.length > 0
                ? `${data.affectedPods.length} pod(s) currently matched by this policy will lose its restrictions/allowances.`
                : 'No pods are currently matched by this policy.'}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(false)}
                className="rounded border border-edge px-3 py-1.5 text-sm text-muted hover:text-text"
              >
                Cancel
              </button>
              <button
                onClick={doDelete}
                disabled={remove.isPending}
                className="rounded bg-block px-3 py-1.5 text-sm font-medium text-on-accent hover:brightness-110 disabled:opacity-50"
              >
                Delete policy
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ApplyBar({
  busy,
  onValidate,
  onApply,
}: {
  busy: boolean
  onValidate: () => void
  onApply: () => void
}) {
  return (
    <div className="mt-3 flex gap-2">
      <button
        onClick={onValidate}
        disabled={busy}
        className="rounded border border-edge px-3 py-1.5 text-sm text-muted hover:border-accent hover:text-accent-strong disabled:opacity-50"
      >
        Validate (dry-run)
      </button>
      <button
        onClick={onApply}
        disabled={busy}
        className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:brightness-110 disabled:opacity-50"
      >
        Apply
      </button>
    </div>
  )
}

function PageNote({ children, tone }: { children: React.ReactNode; tone?: 'error' }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className={`text-sm ${tone === 'error' ? 'text-block' : 'text-muted'}`}>{children}</p>
    </div>
  )
}
