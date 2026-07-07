import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useNamespaces, usePolicies } from '../api/queries'

export default function PoliciesPage() {
  const [namespace, setNamespace] = useState('')
  const [search, setSearch] = useState('')
  const { data: namespaces } = useNamespaces()
  const { data: policies, isLoading } = usePolicies(namespace || undefined)

  const filtered = (policies ?? []).filter(
    (p) => !search || p.name.includes(search) || p.namespace.includes(search),
  )

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-mono text-lg font-semibold text-text">NetworkPolicies</h1>
        <Link
          to="/policies/new"
          className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:brightness-110"
        >
          New policy
        </Link>
      </div>

      <div className="mt-4 flex gap-2">
        <select
          value={namespace}
          onChange={(e) => setNamespace(e.target.value)}
          className="rounded border border-edge bg-surface px-2 py-1.5 font-mono text-xs text-text focus:border-accent focus:outline-none"
        >
          <option value="">all namespaces</option>
          {(namespaces ?? []).map((ns) => (
            <option key={ns.name} value={ns.name}>
              {ns.name} ({ns.policyCount})
            </option>
          ))}
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by name…"
          className="w-64 rounded border border-edge bg-surface px-3 py-1.5 font-mono text-xs text-text placeholder:text-quiet focus:border-accent focus:outline-none"
        />
      </div>

      <div className="mt-4 overflow-x-auto rounded-md border border-edge">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface font-mono text-[11px] uppercase tracking-wide text-quiet">
            <tr>
              <th className="px-4 py-2 font-medium">namespace</th>
              <th className="px-4 py-2 font-medium">name</th>
              <th className="px-4 py-2 font-medium">directions</th>
              <th className="px-4 py-2 font-medium">pods matched</th>
              <th className="px-4 py-2 font-medium">created</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={`${p.namespace}/${p.name}`} className="border-t border-edge hover:bg-surface/60">
                <td className="px-4 py-2 font-mono text-xs text-muted">{p.namespace}</td>
                <td className="px-4 py-2">
                  <Link
                    to={`/policies/${p.namespace}/${p.name}`}
                    className="font-mono text-sm text-text hover:text-accent"
                  >
                    {p.name}
                  </Link>
                </td>
                <td className="px-4 py-2 font-mono text-xs text-muted">
                  {p.policyTypes.join(' + ')}
                </td>
                <td className="px-4 py-2 font-mono text-xs text-muted">{p.podsMatched}</td>
                <td className="px-4 py-2 font-mono text-xs text-quiet">
                  {p.createdAt.slice(0, 10)}
                </td>
              </tr>
            ))}
            {!isLoading && filtered.length === 0 && (
              <tr className="border-t border-edge">
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted">
                  {policies?.length
                    ? 'No policies match the filter.'
                    : 'No NetworkPolicies yet — every pod accepts all traffic. Create one to start restricting.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
