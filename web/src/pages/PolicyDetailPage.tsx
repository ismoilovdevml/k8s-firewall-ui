import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useDeletePolicy, usePermissions, usePolicyDetail, useUpdatePolicy } from '../api/queries'
import { ApiError, errorMessage } from '../api/client'
import { draftToPolicy, policyToDraft } from '../policy/model'
import type { PolicyDraft } from '../policy/model'
import { isolationText, labelsText, ruleText } from '../policy/describe'
import YamlEditor from '../components/YamlEditor'
import PolicyForm from '../components/policy-form/PolicyForm'
import ImpactPanel from '../components/ImpactPanel'
import DiffView from '../components/DiffView'
import { stringify } from 'yaml'
import { PolicyFindingsCard } from '../components/PolicyFindings'
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Feedback,
  Modal,
  Page,
  PageHeader,
  Spinner,
  THead,
  Table,
  Tabs,
} from '../components/ui'
import { buttonClass, td, th } from '../components/styles'
import {
  IconArrowLeft,
  IconArrowRight,
  IconBox,
  IconCode,
  IconDownload,
  IconEye,
  IconFileText,
  IconPencilRuler,
  IconShieldCheck,
  IconTrash,
} from '../components/icons'

type Tab = 'overview' | 'edit' | 'yaml' | 'pods'

export default function PolicyDetailPage() {
  const { namespace = '', name = '' } = useParams()
  const navigate = useNavigate()
  const { data, isLoading, error } = usePolicyDetail(namespace, name)
  const update = useUpdatePolicy()
  const remove = useDeletePolicy()
  const { data: perms } = usePermissions(namespace)

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
  const draftPolicy = useMemo(() => (draft ? draftToPolicy(draft) : null), [draft])

  if (isLoading) return <Spinner />
  if (error instanceof ApiError)
    return (
      <Page width="narrow">
        <BackLink />
        <Alert tone="block" title="Could not load this policy">
          {error.message}
        </Alert>
      </Page>
    )
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
          : errorMessage(err),
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
    remove.mutate({ namespace, name }, { onSuccess: () => navigate('/policies'), onError: feedbackFrom })

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: 'Overview', icon: <IconEye size={15} /> },
    { id: 'edit', label: 'Edit', icon: <IconPencilRuler size={15} /> },
    { id: 'yaml', label: 'YAML', icon: <IconCode size={15} /> },
    { id: 'pods', label: `Affected pods (${data.affectedPods.length})`, icon: <IconBox size={15} /> },
  ]
  const spec = data.policy.spec

  return (
    <Page>
      <PageHeader
        back={<BackLink />}
        icon={<IconFileText size={20} />}
        title={
          <span className="font-mono">
            <span className="text-quiet">{namespace}/</span>
            {name}
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-1.5">
            {(spec.policyTypes ?? []).map((t) => (
              <Badge key={t} tone={t === 'Ingress' ? 'info' : 'neutral'}>
                {t}
              </Badge>
            ))}
            <Badge tone={data.affectedPods.length > 0 ? 'ok' : 'warn'} dot>
              {data.affectedPods.length} pod{data.affectedPods.length === 1 ? '' : 's'} selected
            </Badge>
            <span className="text-xs text-quiet">
              selector: <span className="font-mono">{labelsText(conversion.draft.podSelector, 'all pods')}</span>
            </span>
          </span>
        }
        actions={
          <>
            <a
              href={`data:application/yaml;charset=utf-8,${encodeURIComponent(data.yaml)}`}
              download={`${namespace}-${name}.yaml`}
              className={buttonClass('secondary')}
            >
              <IconDownload size={16} /> Download YAML
            </a>
            <Button
              variant="danger-outline"
              icon={<IconTrash size={16} />}
              onClick={() => setConfirmDelete(true)}
              disabled={perms?.delete === false}
              title={perms?.delete === false ? 'You are not allowed to delete policies in this namespace' : undefined}
            >
              Delete
            </Button>
          </>
        }
      />

      <div>
        <Tabs
          tabs={TABS}
          value={tab}
          onChange={(id) => (id === 'edit' ? startEdit() : (setTab(id), setFeedback(null)))}
        />
        {feedback && <Feedback tone={feedback.tone}>{feedback.text}</Feedback>}
      </div>

      {tab === 'overview' && (
        <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
          <div className="space-y-4">
            <PolicyFindingsCard namespace={namespace} name={name} />
            {(['ingress', 'egress'] as const).map(
              (dir) =>
                conversion.draft[dir].length > 0 && (
                  <Card
                    key={dir}
                    title={
                      dir === 'ingress' ? 'Ingress rules — who may connect in' : 'Egress rules — where pods may connect'
                    }
                    description="Rules are additive: traffic matching any rule is allowed."
                  >
                    <ol className="space-y-2">
                      {conversion.draft[dir].map((rule, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-3 rounded-lg border border-edge bg-raised/40 p-3 text-sm text-text"
                        >
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-strong">
                            {i + 1}
                          </span>
                          <span className="leading-relaxed">{ruleText(rule, dir)}</span>
                        </li>
                      ))}
                    </ol>
                  </Card>
                ),
            )}
          </div>
          <div className="space-y-4">
            <Card title="Effect" description="What this policy does to the pods it selects.">
              <ul className="space-y-2 text-sm text-text">
                {isolationText(conversion.draft).map((line) => (
                  <li key={line} className="flex items-start gap-2">
                    <IconShieldCheck size={15} className="mt-0.5 text-accent-strong" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="Next steps">
              <div className="flex flex-col gap-2 text-sm">
                <button
                  type="button"
                  onClick={startEdit}
                  className="inline-flex items-center gap-1.5 text-left font-medium text-accent-strong hover:underline"
                >
                  <IconPencilRuler size={15} /> Edit this policy with the form
                </button>
                <Link
                  to="/simulator"
                  className="inline-flex items-center gap-1.5 font-medium text-accent-strong hover:underline"
                >
                  <IconArrowRight size={15} /> Test a connection in the simulator
                </Link>
                <Link
                  to={`/firewall?namespace=${encodeURIComponent(namespace)}`}
                  className="inline-flex items-center gap-1.5 font-medium text-accent-strong hover:underline"
                >
                  <IconArrowRight size={15} /> Open the {namespace} firewall
                </Link>
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === 'edit' &&
        (conversion.lossy.length > 0 ? (
          <Alert tone="info" title="This policy uses features the form cannot edit">
            <ul className="mt-1 list-inside list-disc font-mono text-xs">
              {conversion.lossy.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <p className="mt-2">
              Use the{' '}
              <button
                type="button"
                className="font-semibold text-accent-strong hover:underline"
                onClick={() => setTab('yaml')}
              >
                YAML tab
              </button>{' '}
              instead.
            </p>
          </Alert>
        ) : (
          draft && (
            <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
              <div className="space-y-4">
                <PolicyForm value={draft} onChange={setDraft} identityLocked />
                <ReviewChanges
                  before={stringify(draftToPolicy(conversion.draft))}
                  after={draftPolicy ? stringify(draftPolicy) : ''}
                />
                <ApplyBar
                  busy={update.isPending}
                  denied={perms?.update === false}
                  onValidate={() => validateOrApply(true)}
                  onApply={() => validateOrApply(false)}
                />
              </div>
              <div className="lg:sticky lg:top-4 lg:self-start">
                <ImpactPanel request={draftPolicy ? { operation: 'apply', namespace, policy: draftPolicy } : null} />
              </div>
            </div>
          )
        ))}

      {tab === 'yaml' && (
        <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
          <div className="space-y-4">
            <YamlEditor value={yamlText} onChange={setYamlText} />
            <ReviewChanges before={data.yaml} after={yamlText} />
            <ApplyBar
              busy={update.isPending}
              denied={perms?.update === false}
              onValidate={() => validateOrApply(true)}
              onApply={() => validateOrApply(false)}
            />
          </div>
          <div className="lg:sticky lg:top-4 lg:self-start">
            <ImpactPanel request={{ operation: 'apply', namespace, yaml: yamlText }} />
          </div>
        </div>
      )}

      {tab === 'pods' && (
        <Card flush>
          <Table>
            <THead>
              <th className={th}>Pod</th>
              <th className={th}>Workload</th>
              <th className={th}>IP</th>
              <th className={th}>Phase</th>
            </THead>
            <tbody>
              {data.affectedPods.map((p) => (
                <tr key={p.name} className="border-b border-edge/70 last:border-0">
                  <td className={`${td} font-mono text-xs text-text`}>{p.name}</td>
                  <td className={`${td} font-mono text-xs text-muted`}>{p.owner}</td>
                  <td className={`${td} font-mono text-xs text-muted`}>{p.ip}</td>
                  <td className={td}>
                    <Badge tone={p.phase === 'Running' ? 'ok' : 'neutral'} dot>
                      {p.phase}
                    </Badge>
                  </td>
                </tr>
              ))}
              {data.affectedPods.length === 0 && (
                <tr>
                  <td colSpan={4}>
                    <EmptyState icon={<IconBox size={22} />} title="No pods selected">
                      No running pods match this policy's selector right now.
                    </EmptyState>
                  </td>
                </tr>
              )}
            </tbody>
          </Table>
        </Card>
      )}

      {confirmDelete && (
        <Modal
          title={`Delete ${namespace}/${name}?`}
          description={
            data.affectedPods.length > 0
              ? `${data.affectedPods.length} pod(s) currently matched by this policy will lose its restrictions/allowances.`
              : 'No pods are currently matched by this policy.'
          }
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={doDelete} disabled={remove.isPending} icon={<IconTrash size={16} />}>
                Delete policy
              </Button>
            </>
          }
        >
          <ImpactPanel auto request={{ operation: 'delete', namespace, name }} />
        </Modal>
      )}
    </Page>
  )
}

function BackLink() {
  return (
    <Link to="/policies" className="inline-flex items-center gap-1 text-sm text-muted hover:text-accent-strong">
      <IconArrowLeft size={14} /> Policies
    </Link>
  )
}

function ApplyBar({
  busy,
  denied,
  onValidate,
  onApply,
}: {
  busy: boolean
  denied?: boolean
  onValidate: () => void
  onApply: () => void
}) {
  return (
    <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center gap-2 rounded-xl border border-edge bg-surface/95 px-4 py-3 shadow-card backdrop-blur">
      <span className="mr-auto text-xs text-muted">
        Validate runs a server-side dry-run; nothing changes on the cluster.
      </span>
      <Button onClick={onValidate} disabled={busy}>
        Validate (dry-run)
      </Button>
      <Button
        variant="primary"
        onClick={onApply}
        disabled={busy || denied}
        title={denied ? 'You are not allowed to update policies in this namespace' : undefined}
      >
        Apply
      </Button>
    </div>
  )
}

function ReviewChanges({ before, after }: { before: string; after: string }) {
  if (before === after) return null
  return (
    <details className="group rounded-xl border border-edge bg-surface p-4 shadow-card" open>
      <summary className="cursor-pointer text-sm font-semibold text-text">Review changes</summary>
      <div className="mt-3">
        <DiffView before={before} after={after} onlyChanges />
      </div>
    </details>
  )
}
