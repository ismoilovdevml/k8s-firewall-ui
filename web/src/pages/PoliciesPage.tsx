import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { exportUrl, useClusterInfo, useNamespaces, usePolicies, usePosture } from '../api/queries'
import { policyStatus } from '../policy/status'
import ImportDialog from '../components/ImportDialog'
import {
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
import { buttonClass, td, th } from '../components/styles'
import { IconAlertTriangle, IconDownload, IconFileText, IconPlus, IconUpload } from '../components/icons'

// policyStatus labels carry a leading symbol for plain-text contexts; the
// table shows a colored dot instead.
const stripSymbol = (label: string) => label.replace(/^[^\p{L}]+/u, '')

export default function PoliciesPage() {
  const navigate = useNavigate()
  const [namespace, setNamespace] = useState('')
  const [search, setSearch] = useState('')
  const [importing, setImporting] = useState(false)
  const { data: namespaces } = useNamespaces()
  const { data: policies, isLoading } = usePolicies(namespace || undefined)
  const { data: info } = useClusterInfo()
  // Unknown CNI = unverified, not "not enforced".
  const cniEnforces = info?.cni?.provider === 'unknown' ? undefined : info?.cni?.enforcesPolicies
  const { data: posture } = usePosture()
  const issues = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of posture?.findings ?? []) {
      if (f.policy && f.severity !== 'info') {
        const key = `${f.policy.namespace}/${f.policy.name}`
        m.set(key, (m.get(key) ?? 0) + 1)
      }
    }
    return m
  }, [posture])

  const filtered = (policies ?? []).filter(
    (p) => !search || `${p.namespace}/${p.name}`.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <Page>
      <PageHeader
        icon={<IconFileText size={20} />}
        title="Network Policies"
        subtitle="Every NetworkPolicy on the cluster: which directions it isolates, how many pods it selects, and whether it has problems."
        actions={
          <>
            <a href={exportUrl(namespace || undefined)} download className={buttonClass('secondary')}>
              <IconDownload size={16} /> Export YAML
            </a>
            {!info?.readOnly && (
              <>
                <Button onClick={() => setImporting(true)} icon={<IconUpload size={16} />}>
                  Import
                </Button>
                <Link to="/policies/new" className={buttonClass('primary')}>
                  <IconPlus size={16} /> New policy
                </Link>
              </>
            )}
          </>
        }
      />
      {importing && (
        <ImportDialog namespaces={(namespaces ?? []).map((n) => n.name)} onClose={() => setImporting(false)} />
      )}

      <Card flush>
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <SearchInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by namespace or name…"
            aria-label="Search policies"
            className="w-full sm:w-72"
          />
          <Select aria-label="Namespace filter" value={namespace} onChange={(e) => setNamespace(e.target.value)} mono>
            <option value="">All namespaces</option>
            {(namespaces ?? []).map((ns) => (
              <option key={ns.name} value={ns.name}>
                {ns.name} ({ns.policyCount})
              </option>
            ))}
          </Select>
          <span className="ml-auto text-xs text-muted">
            {filtered.length} of {policies?.length ?? 0} policies
          </span>
        </div>
        {isLoading ? (
          <Spinner />
        ) : (
          <Table>
            <THead>
              <th className={th}>Name</th>
              <th className={th}>Namespace</th>
              <th className={th}>Directions</th>
              <th className={th}>Pods matched</th>
              <th className={th}>Status</th>
              <th className={th}>Issues</th>
              <th className={th}>Created</th>
            </THead>
            <tbody>
              {filtered.map((p) => {
                const status = policyStatus(p.podsMatched, cniEnforces)
                const tone = status.tone === 'ok' ? 'ok' : status.tone === 'warn' ? 'warn' : 'block'
                const n = issues.get(`${p.namespace}/${p.name}`)
                const href = `/policies/${p.namespace}/${p.name}`
                return (
                  <tr
                    key={`${p.namespace}/${p.name}`}
                    onClick={(e) => {
                      // Whole row is clickable; real links inside keep their own behavior.
                      if (!(e.target as HTMLElement).closest('a')) navigate(href)
                    }}
                    className="cursor-pointer border-b border-edge/70 transition-colors last:border-0 hover:bg-raised/50"
                  >
                    <td className={td}>
                      <Link
                        to={href}
                        className="font-mono text-[13px] font-semibold text-accent-strong hover:underline"
                      >
                        {p.name}
                      </Link>
                    </td>
                    <td className={`${td} font-mono text-xs text-muted`}>{p.namespace}</td>
                    <td className={td}>
                      <div className="flex gap-1">
                        {p.policyTypes.map((t) => (
                          <Badge key={t} tone={t === 'Ingress' ? 'info' : 'neutral'}>
                            {t}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className={`${td} tabular-nums text-muted`}>{p.podsMatched}</td>
                    <td className={td}>
                      <Badge tone={tone} dot>
                        {stripSymbol(status.label)}
                      </Badge>
                    </td>
                    <td className={td}>
                      {n ? (
                        <Link
                          to={href}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-warn-text hover:underline"
                        >
                          <IconAlertTriangle size={14} /> {n}
                        </Link>
                      ) : (
                        <span className="text-quiet">—</span>
                      )}
                    </td>
                    <td className={`${td} whitespace-nowrap text-xs text-quiet`} title={p.createdAt}>
                      {p.createdAt.slice(0, 10)}
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    {policies?.length ? (
                      <EmptyState icon={<IconFileText size={22} />} title="No policies match the filter">
                        Try a different search or namespace.
                      </EmptyState>
                    ) : (
                      <EmptyState
                        icon={<IconFileText size={22} />}
                        title="No NetworkPolicies yet"
                        action={
                          !info?.readOnly && (
                            <Link to="/policies/new" className={buttonClass('primary')}>
                              <IconPlus size={16} /> Create your first policy
                            </Link>
                          )
                        }
                      >
                        Every pod accepts all traffic. Create one to start restricting.
                      </EmptyState>
                    )}
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
