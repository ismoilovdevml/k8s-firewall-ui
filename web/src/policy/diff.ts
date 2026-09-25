export interface DiffLine {
  op: '+' | '-' | '='
  text: string
}

/**
 * Line diff via longest common subsequence. Policies are small (tens of
 * lines), so the O(n·m) table is fine.
 */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before === '' ? [] : before.replace(/\n$/, '').split('\n')
  const b = after === '' ? [] : after.replace(/\n$/, '').split('\n')
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ op: '=', text: a[i] })
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ op: '-', text: a[i++] })
    } else {
      out.push({ op: '+', text: b[j++] })
    }
  }
  while (i < a.length) out.push({ op: '-', text: a[i++] })
  while (j < b.length) out.push({ op: '+', text: b[j++] })
  return out
}

export type HunkLine = DiffLine | { op: 'gap'; text: string }

/** Keeps only changed lines plus `context` lines around them, like `diff -U`. */
export function compactDiff(lines: DiffLine[], context = 3): HunkLine[] {
  const keep = new Array<boolean>(lines.length).fill(false)
  lines.forEach((l, i) => {
    if (l.op === '=') return
    for (let j = Math.max(0, i - context); j <= Math.min(lines.length - 1, i + context); j++) keep[j] = true
  })
  const out: HunkLine[] = []
  let skipped = 0
  lines.forEach((l, i) => {
    if (keep[i]) {
      if (skipped > 0) out.push({ op: 'gap', text: `${skipped} unchanged line${skipped === 1 ? '' : 's'}` })
      skipped = 0
      out.push(l)
    } else {
      skipped++
    }
  })
  if (skipped > 0 && out.length > 0) out.push({ op: 'gap', text: `${skipped} unchanged line${skipped === 1 ? '' : 's'}` })
  return out
}
