import { useState } from 'react'
import { Link } from 'react-router-dom'
import { errorMessage } from '../api/client'
import { useAudit, useMe } from '../api/queries'
import type { AuditEntry } from '../api/types'
import { Badge, PageHeader, Spinner } from '../components/ui'
import DiffView from '../components/DiffView'

const inputCls =
  'rounded border border-edge bg-surface px-2 py-1.5 font-mono text-xs text-text placeholder:text-quiet focus:border-accent focus:outline-none'

export default function AuditPage() {
  const [action, setAction] = useState('')
  const [q, setQ] = useState('')
  const { data, isLoading, error } = useAudit({ action, q })
  const { data: me } = useMe()
  const [open, setOpen] = useState<number | null>(null)

  return (
    <div className="p-6">
      <PageHeader
        title="Audit log"
        subtitle={
          <>
            Every policy change made through this UI, newest first. The server keeps the most recent
            entries in memory; the durable record is its structured log output
            {me?.mode !== 'none' && ' and the Kubernetes API audit log, which records you as the author'}.
          </>
        }
      />

      <div className="mt-4 flex flex-wrap gap-2">
        <select aria-label="Action" value={action} onChange={(e) => setAction(e.target.value)} className={inputCls}>
          <option value="">all actions</option>
          <option value="create">create</option>
          <option value="update">update</option>
          <option value="delete">delete</option>
        </select>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter namespace/name…"
          className={`${inputCls} w-64`}
        />
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-edge bg-surface shadow-sm">
        {isLoading ? (
          <Spinner />
        ) : error ? (
          <p className="p-6 text-sm text-block">{errorMessage(error)}</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-raised font-mono text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">time</th>
                <th className="px-4 py-2.5 font-medium">user</th>
                <th className="px-4 py-2.5 font-medium">action</th>
                <th className="px-4 py-2.5 font-medium">policy</th>
                <th className="px-4 py-2.5 font-medium">result</th>
                <th className="px-4 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((e) => (
                <Row key={e.id} e={e} open={open === e.id} onToggle={() => setOpen(open === e.id ? null : e.id)} />
              ))}
              {data?.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted">
                    No changes recorded since the server started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

const ACTION_TONE = { create: 'ok', update: 'info', delete: 'block' } as const

function Row({ e, open, onToggle }: { e: AuditEntry; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="border-t border-edge/60 hover:bg-raised/50">
        <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-muted" title={e.time}>
          {new Date(e.time).toLocaleString()}
        </td>
        <td className="px-4 py-2.5 text-xs text-text">
          <div className="font-medium">{e.user}</div>
          {e.sourceIP && <div className="font-mono text-[11px] text-quiet">{e.sourceIP}</div>}
        </td>
        <td className="px-4 py-2.5">
          <Badge tone={ACTION_TONE[e.action]}>{e.action}</Badge>
        </td>
        <td className="px-4 py-2.5 font-mono text-xs">
          {e.action === 'delete' || e.result === 'failure' ? (
            <span className="text-text">
              {e.namespace}/{e.name}
            </span>
          ) : (
            <Link to={`/policies/${e.namespace}/${e.name}`} className="text-accent-strong hover:underline">
              {e.namespace}/{e.name}
            </Link>
          )}
        </td>
        <td className="px-4 py-2.5">
          {e.result === 'success' ? <Badge tone="ok">✓ success</Badge> : <Badge tone="block">✗ failed</Badge>}
        </td>
        <td className="px-4 py-2.5 text-right">
          <button onClick={onToggle} className="text-xs font-medium text-accent-strong hover:underline">
            {open ? 'Hide' : 'Details'}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} className="bg-base px-4 py-3">
            {e.error && <p className="mb-2 font-mono text-xs text-block">{e.error}</p>}
            <DiffView before={e.before ?? ''} after={e.after ?? ''} />
          </td>
        </tr>
      )}
    </>
  )
}
