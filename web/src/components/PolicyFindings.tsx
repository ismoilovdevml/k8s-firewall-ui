import { usePosture } from '../api/queries'
import type { Finding } from '../api/types'
import { Badge } from './ui'
import { severityTone } from './tone'

/** Posture findings that point at one policy. */
function usePolicyFindings(namespace: string, name: string): Finding[] {
  const { data } = usePosture()
  return (data?.findings ?? []).filter((f) => f.policy?.namespace === namespace && f.policy?.name === name)
}

export function PolicyFindingsCard({ namespace, name }: { namespace: string; name: string }) {
  const findings = usePolicyFindings(namespace, name)
  if (findings.length === 0) return null
  return (
    <section className="rounded-md border border-warn bg-warn-bg/30 p-4">
      <h2 className="font-mono text-[11px] uppercase tracking-wide text-warn-text">
        issues detected ({findings.length})
      </h2>
      <ul className="mt-2 space-y-2">
        {findings.map((f, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-text">
            <Badge tone={severityTone(f.severity)}>{f.severity}</Badge>
            <span>{f.message}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
