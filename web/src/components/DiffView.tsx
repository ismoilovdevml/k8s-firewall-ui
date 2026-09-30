import { compactDiff, lineDiff } from '../policy/diff'

/** Unified line diff of two YAML documents. */
export default function DiffView({
  before,
  after,
  onlyChanges,
}: {
  before: string
  after: string
  onlyChanges?: boolean
}) {
  if (!before && !after) return <p className="text-xs text-muted">No content recorded.</p>
  const all = lineDiff(before, after)
  const changed = all.some((l) => l.op !== '=')
  if (onlyChanges && !changed) return <p className="text-xs text-muted">No changes yet.</p>
  const lines = onlyChanges ? compactDiff(all) : all
  return (
    <pre className="max-h-96 overflow-auto rounded-lg border border-edge bg-sunken py-2 font-mono text-xs leading-5">
      {lines.map((l, i) =>
        l.op === 'gap' ? (
          <div key={i} className="my-1 border-y border-dashed border-edge bg-raised px-3 text-center text-quiet">
            ⋯ {l.text} ⋯
          </div>
        ) : (
          <div
            key={i}
            className={`px-3 ${
              l.op === '+'
                ? 'bg-allow-soft text-accent-strong'
                : l.op === '-'
                  ? 'bg-block-soft text-block'
                  : 'text-muted'
            }`}
          >
            {l.op === '=' ? ' ' : l.op} {l.text}
          </div>
        ),
      )}
    </pre>
  )
}
