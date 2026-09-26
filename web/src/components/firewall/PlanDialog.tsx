import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, errorMessage } from '../../api/client'
import { useApplyAccess, usePlanAccess } from '../../api/queries'
import type { AccessPlan, AccessSubject, FlowDirection, PlanRequest } from '../../api/types'
import DiffView from '../DiffView'
import { flowText } from './flow'
import { Badge, Button, Feedback, Modal } from '../ui'

/**
 * Review-then-apply dialog for one allow/block request. The server plans
 * the change, the user reviews diffs and impact, and apply re-plans
 * server-side and refuses if anything changed in between.
 */
type Source =
  | { request: PlanRequest; learn?: undefined }
  | { learn: { subject: AccessSubject; direction: FlowDirection }; request?: undefined }

export default function PlanDialog({ request, learn, onClose }: Source & { onClose: () => void }) {
  const [keepExternal, setKeepExternal] = useState(request?.keepExternal ?? true)
  const endpoint = learn ? '/api/v1/flows/learn' : '/api/v1/access'
  const plan = usePlanAccess(endpoint)
  const apply = useApplyAccess(endpoint)
  const req: object = learn ?? { ...request, keepExternal }
  const reqKey = JSON.stringify(req)
  const action = learn ? 'learn' : request!.action

  useEffect(() => {
    apply.reset()
    plan.mutate(req)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqKey])

  const p: AccessPlan | undefined = plan.data
  const done = apply.isSuccess && !apply.data.results.some((r) => r.error)
  const stale = apply.error instanceof ApiError && apply.error.code === 'PLAN_CHANGED'
  const verb = action === 'allow' ? 'Allow' : action === 'block' ? 'Block' : 'Restrict'
  const title = learn
    ? `Allow only observed ${learn.direction} traffic for ${learn.subject.namespace}${learn.subject.workload ? '/' + learn.subject.workload : ''}`
    : `${verb} ${flowText(request!)}`

  return (
    <Modal title={title} onClose={onClose} wide>
      {plan.isPending && <p className="text-sm text-muted">Planning…</p>}
      {plan.isError && <Feedback tone="error">{errorMessage(plan.error)}</Feedback>}

      {p && !done && (
        <div className="space-y-4">
          {p.alreadyDone ? (
            <Feedback tone="ok">{p.notes[0] ?? 'Nothing to do.'}</Feedback>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {p.verified ? (
                  <Badge tone="ok">✓ verified by the simulator</Badge>
                ) : (
                  <Badge tone="block">✕ cannot fully {action === 'learn' ? 'apply' : action} automatically</Badge>
                )}
                <span className="text-muted">
                  {p.changes.length} change{p.changes.length === 1 ? '' : 's'} ·{' '}
                  <span className="text-block">{p.impact.newlyBlocked.length} newly blocked</span> ·{' '}
                  <span className="text-accent-strong">{p.impact.newlyAllowed.length} newly allowed</span>
                </span>
              </div>

              {action === 'block' && (
                <label className="flex items-center gap-2 text-sm text-text">
                  <input type="checkbox" checked={keepExternal} onChange={(e) => setKeepExternal(e.target.checked)} />
                  Keep internet access if this workload has to be isolated (0.0.0.0/0 except private ranges)
                </label>
              )}

              {p.notes.length > 0 && (
                <ul className="space-y-1 rounded-lg border border-edge bg-raised/60 p-3 text-sm text-text">
                  {p.notes.map((n) => (
                    <li key={n}>• {n}</li>
                  ))}
                </ul>
              )}

              {p.blockers.length > 0 && (
                <div className="rounded-lg border border-block/40 bg-block/5 p-3 text-sm">
                  <p className="font-semibold text-block">
                    These rules in hand-written policies still allow it — edit them to finish the block:
                  </p>
                  <ul className="mt-1 space-y-1">
                    {p.blockers.map((b) => (
                      <li key={`${b.policy.namespace}/${b.policy.name}/${b.ruleIndex}`}>
                        <Link
                          to={`/policies/${b.policy.namespace}/${b.policy.name}`}
                          className="font-mono text-xs text-accent-strong hover:underline"
                        >
                          {b.policy.namespace}/{b.policy.name} rule #{b.ruleIndex + 1}
                        </Link>{' '}
                        <span className="text-muted">— {b.explanation}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {p.changes.map((c) => (
                <section key={`${c.namespace}/${c.name}`}>
                  <h3 className="mb-1 flex items-center gap-2 text-sm">
                    <Badge tone={c.operation === 'create' ? 'ok' : 'info'}>{c.operation}</Badge>
                    <span className="font-mono text-text">
                      {c.namespace}/{c.name}
                    </span>
                    <span className="text-xs text-muted">{c.reason}</span>
                  </h3>
                  <DiffView before={c.before} after={c.after} onlyChanges={c.operation === 'update'} />
                </section>
              ))}

              {p.impact.newlyBlocked.length + p.impact.newlyAllowed.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted">Connections that change</summary>
                  <ul className="mt-1 max-h-40 overflow-auto font-mono text-xs">
                    {p.impact.newlyBlocked.map((e) => (
                      <li key={`b${e.source}${e.target}`} className="text-block">
                        ✕ {e.source} → {e.target}
                      </li>
                    ))}
                    {p.impact.newlyAllowed.map((e) => (
                      <li key={`a${e.source}${e.target}`} className="text-accent-strong">
                        ✓ {e.source} → {e.target}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}

          {stale && <Feedback tone="error">The cluster changed while you were reviewing. The plan above was refreshed — review it again.</Feedback>}
          {apply.isError && !stale && <Feedback tone="error">{errorMessage(apply.error)}</Feedback>}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            {!p.alreadyDone && (
              <Button
                variant={action === 'block' ? 'danger' : 'primary'}
                disabled={p.changes.length === 0 || apply.isPending}
                onClick={() =>
                  apply.mutate(
                    { ...req, signature: p.signature },
                    { onError: (err) => err instanceof ApiError && err.code === 'PLAN_CHANGED' && plan.mutate(req) },
                  )
                }
              >
                {apply.isPending ? 'Applying…' : `${verb} — apply ${p.changes.length} change${p.changes.length === 1 ? '' : 's'}`}
              </Button>
            )}
          </div>
        </div>
      )}

      {done && (
        <div className="space-y-3">
          <Feedback tone="ok">
            Applied:{' '}
            {apply.data!.results.map((r) => `${r.operation} ${r.namespace}/${r.name}`).join(', ')}. The table updates
            automatically.
          </Feedback>
          <div className="flex justify-end">
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
