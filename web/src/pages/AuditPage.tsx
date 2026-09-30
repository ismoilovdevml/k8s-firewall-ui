import { useState } from 'react'
import { Link } from 'react-router-dom'
import { errorMessage } from '../api/client'
import { useAudit, useMe } from '../api/queries'
import type { AuditEntry } from '../api/types'
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Page,
  PageHeader,
  SearchInput,
  Select,
  Spinner,
  THead,
  Table,
} from '../components/ui'
import { td, th } from '../components/styles'
import { IconChevronDown, IconHistory, IconUser } from '../components/icons'
import DiffView from '../components/DiffView'

export default function AuditPage() {
  const [action, setAction] = useState('')
  const [q, setQ] = useState('')
  const { data, isLoading, error } = useAudit({ action, q })
  const { data: me } = useMe()
  const [open, setOpen] = useState<number | null>(null)

  return (
    <Page>
      <PageHeader
        icon={<IconHistory size={20} />}
        title="Audit log"
        subtitle={
          <>
            Every policy change made through this UI, newest first. The server keeps the most recent entries in memory;
            the durable record is its structured log output
            {me?.mode !== 'none' && ' and the Kubernetes API audit log, which records you as the author'}.
          </>
        }
      />

      <Card flush>
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <SearchInput
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter namespace/name…"
            aria-label="Filter audit entries"
            className="w-full sm:w-72"
          />
          <Select aria-label="Action" value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">All actions</option>
            <option value="create">create</option>
            <option value="update">update</option>
            <option value="delete">delete</option>
          </Select>
          {data && <span className="ml-auto text-xs text-muted">{data.length} entries</span>}
        </div>
        {isLoading ? (
          <Spinner />
        ) : error ? (
          <div className="p-4">
            <Alert tone="block">{errorMessage(error)}</Alert>
          </div>
        ) : (
          <Table>
            <THead>
              <th className={th}>Time</th>
              <th className={th}>User</th>
              <th className={th}>Action</th>
              <th className={th}>Policy</th>
              <th className={th}>Result</th>
              <th className={th} />
            </THead>
            <tbody>
              {(data ?? []).map((e) => (
                <Row key={e.id} e={e} open={open === e.id} onToggle={() => setOpen(open === e.id ? null : e.id)} />
              ))}
              {data?.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <EmptyState icon={<IconHistory size={22} />} title="No changes recorded yet">
                      Changes made through this UI since the server started will appear here.
                    </EmptyState>
                  </td>
                </tr>
              )}
            </tbody>
          </Table>
        )}
      </Card>
    </Page>
  )
}

const ACTION_TONE = { create: 'ok', update: 'info', delete: 'block' } as const

function Row({ e, open, onToggle }: { e: AuditEntry; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className={`border-b border-edge/70 transition-colors hover:bg-raised/40 ${open ? 'bg-raised/40' : ''}`}>
        <td className={`${td} whitespace-nowrap text-xs text-muted`} title={e.time}>
          {new Date(e.time).toLocaleString()}
        </td>
        <td className={td}>
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-raised text-quiet">
              <IconUser size={14} />
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-text">{e.user}</div>
              {e.sourceIP && <div className="font-mono text-[11px] text-quiet">{e.sourceIP}</div>}
            </div>
          </div>
        </td>
        <td className={td}>
          <Badge tone={ACTION_TONE[e.action]}>{e.action}</Badge>
        </td>
        <td className={`${td} font-mono text-xs`}>
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
        <td className={td}>
          {e.result === 'success' ? (
            <Badge tone="ok" dot>
              success
            </Badge>
          ) : (
            <Badge tone="block" dot>
              failed
            </Badge>
          )}
        </td>
        <td className={`${td} text-right`}>
          <Button size="xs" variant="ghost" onClick={onToggle} aria-expanded={open}>
            {open ? 'Hide' : 'Details'}
            <IconChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          </Button>
        </td>
      </tr>
      {open && (
        <tr className="border-b border-edge/70">
          <td colSpan={6} className="bg-raised/40 px-4 py-3">
            {e.error && (
              <Alert tone="block" className="mb-2">
                <span className="font-mono text-xs">{e.error}</span>
              </Alert>
            )}
            <DiffView before={e.before ?? ''} after={e.after ?? ''} />
          </td>
        </tr>
      )}
    </>
  )
}
