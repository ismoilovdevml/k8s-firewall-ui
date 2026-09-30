import { usePosture } from '../api/queries'
import type { Finding } from '../api/types'
import { IconAlertTriangle } from './icons'
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
    <section className="rounded-xl border border-warn/40 bg-warn-bg p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-warn-text">
        <IconAlertTriangle size={16} />
        Issues detected ({findings.length})
      </h2>
      <ul className="mt-3 space-y-2">
        {findings.map((f, i) => (
          <li key={i} className="flex items-start gap-2 rounded-lg bg-surface/70 p-2.5 text-sm text-text">
            <Badge tone={severityTone(f.severity)}>{f.severity}</Badge>
            <span className="leading-relaxed">{f.message}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
