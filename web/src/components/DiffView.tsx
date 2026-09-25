import { compactDiff, lineDiff } from '../policy/diff'

/** Unified line diff of two YAML documents. */
export default function DiffView({ before, after, onlyChanges }: { before: string; after: string; onlyChanges?: boolean }) {
  if (!before && !after) return <p className="text-xs text-muted">No content recorded.</p>
  const all = lineDiff(before, after)
  const changed = all.some((l) => l.op !== '=')
  if (onlyChanges && !changed) return <p className="text-xs text-muted">No changes yet.</p>
  const lines = onlyChanges ? compactDiff(all) : all
  return (
    <pre className="max-h-96 overflow-auto rounded-lg border border-edge bg-surface p-3 font-mono text-[11px] leading-5">
      {lines.map((l, i) => (
        l.op === 'gap' ? (
          <div key={i} className="my-0.5 border-y border-dashed border-edge text-center text-quiet">
            ⋯ {l.text} ⋯
          </div>
        ) : (
          <div
            key={i}
            className={l.op === '+' ? 'bg-accent/10 text-accent-strong' : l.op === '-' ? 'bg-block/10 text-block' : 'text-muted'}
          >
            {l.op === '=' ? ' ' : l.op} {l.text}
          </div>
        )
      ))}
    </pre>
  )
}
