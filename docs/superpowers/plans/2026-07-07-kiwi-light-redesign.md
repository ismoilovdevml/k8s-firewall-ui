# Kiwi Light Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retheme the entire SPA from dark navy/amber to the light "Kiwi" green system (cream base, dark-teal sidebar, teal accents) and apply the simplicity improvements from the spec (`docs/superpowers/specs/2026-07-07-kiwi-light-redesign-design.md`).

**Architecture:** The app already styles everything through Tailwind v4 semantic tokens defined in `web/src/index.css` `@theme` (verified: no raw hex in any `.tsx`). Task 1 swaps the token values, which converts ~80% of the UI. Remaining tasks fix the places where dark-mode assumptions are hardcoded (button text color, shadows, React Flow `colorMode`, CodeMirror theme, sidebar) and add the three UX upgrades (sidebar status chip, Policies STATUS column, Simulator verdict banner + progressive disclosure).

**Tech Stack:** React 19, Tailwind CSS v4 (`@theme` tokens), @xyflow/react (React Flow), @uiw/react-codemirror, vitest.

## Global Constraints

- All UI text, code, and commit messages in English (CLAUDE.md).
- No new npm dependencies.
- Raw hex colors are allowed ONLY in `web/src/index.css`; components use semantic Tailwind utilities (`bg-surface`, `text-accent-strong`, …).
- Normal-size green text on white/cream must use `text-accent-strong` (#028174, ≥4.5:1). `text-accent` (#0AB68B) is only for large/bold text or non-text elements.
- Verdicts always pair icon + label (✓/✕/⚠ + word), never color alone.
- After every task: `cd web && npm test -- --run` and `npx tsc -b --noEmit` (or `npm run build`) must pass. Commit at the end of every task.
- Frontend dir for all tasks: `web/`. Run npm commands from `web/`.

---

### Task 1: Token system swap (`index.css`)

**Files:**
- Modify: `web/src/index.css` (entire file)

**Interfaces:**
- Produces Tailwind utilities used by later tasks: `accent-strong`, `on-accent`, `warn`, `warn-bg`, `warn-text`, `sidebar`, `sidebar-text`, `sidebar-brand`, `sidebar-raised` (each as `--color-*` token), plus recolored existing tokens.

- [ ] **Step 1: Replace the full contents of `web/src/index.css`**

```css
@import 'tailwindcss';

@theme {
  /* Kiwi light palette: cream base, white surfaces, dark-teal sidebar,
     teal accents. Block-red sits outside the green family on purpose so
     allow/block never blend with the brand color. */
  --color-base: #faf7f0;
  --color-surface: #ffffff;
  --color-raised: #f6f2e8;
  --color-edge: #eee7d8;
  --color-text: #0f2a24;
  --color-muted: #64716c;
  --color-quiet: #8a968f;
  --color-accent: #0ab68b;
  --color-accent-strong: #028174;
  --color-on-accent: #04211d;
  --color-allow: #0ab68b;
  --color-block: #e05c52;
  --color-warn: #d9a13f;
  --color-warn-bg: #ffe3b3;
  --color-warn-text: #7a5410;
  --color-sidebar: #06373a;
  --color-sidebar-text: #cfe8e0;
  --color-sidebar-brand: #92de8b;
  --color-sidebar-raised: #0a4a4e;

  --font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', SFMono-Regular, Menlo, monospace;
  --font-sans: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
}

:root {
  color-scheme: light;
}

body {
  background: var(--color-base);
  color: var(--color-text);
  font-family: var(--font-sans);
}

.react-flow__attribution {
  background: transparent;
  color: var(--color-quiet);
}
```

Note: `--color-muted`/`--color-quiet` are slightly darker than the spec's mockup values (#7D8A85/#A8B3AE) to meet the spec's own WCAG AA requirement on white; the spec's contrast clause wins over the mockup sample.

- [ ] **Step 2: Verify tests and types still pass**

Run: `cd web && npm test -- --run && npx tsc -b --noEmit`
Expected: all vitest suites PASS (they test logic, not styles), tsc clean.

- [ ] **Step 3: Commit**

```bash
git add web/src/index.css
git commit -m "Swap theme tokens to Kiwi light palette"
```

---

### Task 2: Button text sweep (`text-base` → `text-on-accent`)

Solid `bg-accent`/`bg-block` buttons currently use `text-base` (was near-black, now cream — unreadable on teal). Switch them to the new `on-accent` token.

**Files:**
- Modify: `web/src/pages/PoliciesPage.tsx:21`
- Modify: `web/src/pages/SimulatorPage.tsx:146`
- Modify: `web/src/pages/BuilderPage.tsx:169`
- Modify: `web/src/pages/PolicyNewPage.tsx:76`
- Modify: `web/src/pages/PolicyDetailPage.tsx:257,290`

**Interfaces:**
- Consumes: `text-on-accent` utility from Task 1.

- [ ] **Step 1: In each of the 6 listed class strings, replace the single word `text-base` with `text-on-accent`**

All 6 occurrences look like this (only the `text-base` token changes; the `bg-block` one on PolicyDetailPage:257 gets the same replacement):

```
- className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-base hover:brightness-110 disabled:opacity-50"
+ className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:brightness-110 disabled:opacity-50"
```

Verify none remain: `grep -rn "text-base" web/src` → no matches.

- [ ] **Step 2: Verify** — `cd web && npm test -- --run && npx tsc -b --noEmit` → PASS

- [ ] **Step 3: Commit**

```bash
git add web/src/pages
git commit -m "Use on-accent text on solid buttons"
```

---

### Task 3: Layout shell — dark sidebar, status chip, no footer

**Files:**
- Modify: `web/src/components/Layout.tsx` (entire file)

**Interfaces:**
- Consumes: `sidebar*`, `warn*`, `on-accent` tokens (Task 1).
- Produces: the footer is removed; cluster/CNI/version info renders only in the sidebar chip. No exports change (`default Layout`).

- [ ] **Step 1: Replace the contents of `web/src/components/Layout.tsx`**

```tsx
import { NavLink, Outlet } from 'react-router-dom'
import { useClusterInfo } from '../api/queries'
import { useSSEInvalidation } from '../hooks/useSSEInvalidation'

const NAV = [
  { to: '/', label: 'Topology', hint: 'live traffic map' },
  { to: '/policies', label: 'Policies', hint: 'rules on the cluster' },
  { to: '/simulator', label: 'Simulator', hint: 'test a connection' },
  { to: '/builder', label: 'Builder', hint: 'draw a policy' },
]

export default function Layout() {
  useSSEInvalidation()
  const { data: info } = useClusterInfo()
  const cni = info?.cni

  return (
    <div className="flex h-screen flex-col">
      {cni && !cni.enforcesPolicies && (
        <div className="border-b border-warn bg-warn-bg px-4 py-2 text-sm font-medium text-warn-text">
          ⚠ Policies are not enforced on this cluster — CNI “{cni.provider}” accepts NetworkPolicies
          but ignores them. Everything below is theoretical until you install a policy engine.
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-56 shrink-0 flex-col bg-sidebar">
          <div className="px-4 py-5">
            <span className="font-mono text-sm font-bold tracking-tight text-sidebar-brand">
              🛡 k8s-firewall-ui
            </span>
          </div>
          <nav className="flex flex-col gap-1 px-3">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? 'bg-accent text-on-accent'
                      : 'text-sidebar-text hover:bg-sidebar-raised'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <span className="block font-semibold">{item.label}</span>
                    <span
                      className={`block text-xs ${isActive ? 'text-on-accent/70' : 'text-sidebar-text/60'}`}
                    >
                      {item.hint}
                    </span>
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="mt-auto p-3">
            <div className="rounded-lg bg-sidebar-raised p-3 font-mono text-xs text-sidebar-text">
              <div>cluster {info?.kubernetesVersion ?? '…'}</div>
              <div className="mt-1">
                CNI {cni?.provider ?? '…'}{' '}
                {cni &&
                  (cni.enforcesPolicies ? (
                    <span className="text-sidebar-brand">enforced ✓</span>
                  ) : (
                    <span className="font-semibold text-warn-bg">NOT enforced ✗</span>
                  ))}
              </div>
              {cni?.anpPresent && (
                <div className="mt-1 text-warn-bg">ANP present (not evaluated)</div>
              )}
              {info?.appVersion && (
                <div className="mt-1 text-sidebar-text/60">{info.appVersion}</div>
              )}
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify** — `cd web && npm test -- --run && npx tsc -b --noEmit` → PASS

- [ ] **Step 3: Commit**

```bash
git add web/src/components/Layout.tsx
git commit -m "Redesign shell: dark teal sidebar with cluster status chip, drop footer"
```

---

### Task 4: CodeMirror light theme

**Files:**
- Modify: `web/src/components/YamlEditor.tsx:5-22`

**Interfaces:**
- Produces: the same `YamlEditor` default export; Builder's YAML preview and PolicyDetail/New editors pick the theme up automatically (they all render this component).

- [ ] **Step 1: Replace the `theme` definition (lines 5–22) with a light variant**

```ts
const theme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'var(--color-surface)',
      color: 'var(--color-text)',
      fontSize: '13px',
    },
    '.cm-gutters': {
      backgroundColor: 'var(--color-raised)',
      color: 'var(--color-quiet)',
      border: 'none',
    },
    '.cm-activeLine': { backgroundColor: 'rgba(6, 55, 58, 0.05)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent' },
    '&.cm-focused': { outline: 'none' },
  },
  { dark: false },
)
```

(The two changes besides colors: gutter uses `raised`, and `{ dark: false }` so CodeMirror picks light syntax-highlighting defaults.)

- [ ] **Step 2: Verify** — `cd web && npm test -- --run && npx tsc -b --noEmit` → PASS

- [ ] **Step 3: Commit**

```bash
git add web/src/components/YamlEditor.tsx
git commit -m "Switch CodeMirror to light theme"
```

---

### Task 5: React Flow surfaces to light mode (Topology + Builder canvases)

**Files:**
- Modify: `web/src/pages/TopologyPage.tsx:121,129` and namespace-chip/legend classes (66, 79–95)
- Modify: `web/src/pages/BuilderPage.tsx:192`
- Modify: `web/src/components/topology/WorkloadNode.tsx:12`
- Modify: `web/src/components/builder/nodes.tsx:10,31`

**Interfaces:**
- Consumes: `accent-strong` token (Task 1). No exported signatures change.

- [ ] **Step 1: TopologyPage — flip color mode, soften shadows, fix chip text contrast**

Line 121: `colorMode="dark"` → `colorMode="light"`.

Line 129 (edge-detail panel): replace
`shadow-xl shadow-black/40` → `shadow-lg` (Tailwind's default shadow color is already a soft black).

Line 66 (selected namespace chip): `text-accent` → `text-accent-strong` (small text on light background), i.e.
`'border-accent/60 bg-accent/10 text-accent-strong'`.

- [ ] **Step 2: BuilderPage — flip color mode**

Line 192: `colorMode="dark"` → `colorMode="light"`.

- [ ] **Step 3: WorkloadNode — white card, light shadow, readable hostNet badge**

Line 12: `border border-edge bg-raised … shadow-lg shadow-black/30` →

```
className="w-[220px] rounded-md border border-edge bg-surface px-3 py-2 shadow-sm"
```

Also in the same file, the `hostNet` badge (`className="text-accent"`, line 26) → `text-warn-text` with unchanged `title` (it is a warning, and amber text stays readable on white).

- [ ] **Step 4: builder/nodes.tsx — light shadows + egress color split**

With the new palette `accent` and `allow` are the same teal, so ingress ("allow from", `text-allow`) and egress ("allow to", `text-accent`) would become indistinguishable. Egress moves to the deep teal `accent-strong` everywhere in the Builder:

Line 10 (TargetNode): `shadow-lg shadow-black/40` → `shadow-sm` (keep `bg-raised` — the cream target card stands out on the white canvas).

Line 28 (PeerNode): ingress keeps the teal-green family, egress moves to deep teal (the labels already differ: "allow from"/"allow to"):

```ts
const dirColor = card.direction === 'ingress' ? 'text-allow' : 'text-accent-strong'
```

(`text-allow` here is a 10px uppercase label on white — if it looks weak during Task 9 verification, darken it to `text-accent-strong` too and rely on the label text + edge direction for the distinction.)

Line 31 (PeerNode): `shadow-md shadow-black/30` → `shadow-sm`.

- [ ] **Step 5: BuilderPage — egress button + egress edge use accent-strong**

Lines 153–157 ("+ Allow to…" button):

```
- className="rounded border border-accent/50 px-3 py-1.5 text-sm text-accent hover:bg-accent/10"
+ className="rounded border border-accent-strong/50 px-3 py-1.5 text-sm text-accent-strong hover:bg-accent-strong/10"
```

Lines 90–96 (egress edges): both `var(--color-accent)` occurrences → `var(--color-accent-strong)`.

Also the "+ Allow from…" button (line 149) keeps `border-allow/50 text-allow hover:bg-allow/10` but `text-allow` is small text — change to `text-accent-strong`:

```
- className="rounded border border-allow/50 px-3 py-1.5 text-sm text-allow hover:bg-allow/10"
+ className="rounded border border-allow/50 px-3 py-1.5 text-sm text-accent-strong hover:bg-allow/10"
```

- [ ] **Step 6: Verify** — `cd web && npm test -- --run && npx tsc -b --noEmit` → PASS

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/TopologyPage.tsx web/src/pages/BuilderPage.tsx web/src/components/topology/WorkloadNode.tsx web/src/components/builder/nodes.tsx
git commit -m "Move React Flow canvases to light mode; split builder egress color"
```

---

### Task 6: Policies page — Kiwi table + STATUS column

**Files:**
- Create: `web/src/policy/status.ts`
- Test: `web/src/policy/status.test.ts`
- Modify: `web/src/pages/PoliciesPage.tsx`

**Interfaces:**
- Produces: `policyStatus(podsMatched: number, cniEnforces: boolean | undefined): { label: string; tone: 'ok' | 'warn' | 'bad' }`
- Consumes: `useClusterInfo()` from `web/src/api/queries` (already exists, returns `{ cni?: { enforcesPolicies: boolean } }`), list items' `podsMatched: number`.

- [ ] **Step 1: Write the failing test** — `web/src/policy/status.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { policyStatus } from './status'

describe('policyStatus', () => {
  it('flags a policy whose selector matches no pods, regardless of CNI', () => {
    expect(policyStatus(0, true)).toEqual({ label: '⚠ selects nothing', tone: 'warn' })
    expect(policyStatus(0, false)).toEqual({ label: '⚠ selects nothing', tone: 'warn' })
  })

  it('flags every policy as not enforced when the CNI ignores policies', () => {
    expect(policyStatus(3, false)).toEqual({ label: '✕ not enforced', tone: 'bad' })
  })

  it('reports enforced when the CNI enforces and pods are matched', () => {
    expect(policyStatus(3, true)).toEqual({ label: '✓ enforced', tone: 'ok' })
  })

  it('degrades to a neutral label while cluster info is still loading', () => {
    expect(policyStatus(3, undefined)).toEqual({ label: 'active', tone: 'ok' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- --run src/policy/status.test.ts`
Expected: FAIL — `Cannot find module './status'` (or equivalent).

- [ ] **Step 3: Implement** — `web/src/policy/status.ts`

```ts
export interface PolicyStatus {
  label: string
  tone: 'ok' | 'warn' | 'bad'
}

/**
 * Row-level status for the policy list, derived from data the list API
 * already returns. "Selects nothing" outranks CNI state because it is the
 * more specific, per-policy problem.
 */
export function policyStatus(
  podsMatched: number,
  cniEnforces: boolean | undefined,
): PolicyStatus {
  if (podsMatched === 0) return { label: '⚠ selects nothing', tone: 'warn' }
  if (cniEnforces === false) return { label: '✕ not enforced', tone: 'bad' }
  if (cniEnforces === undefined) return { label: 'active', tone: 'ok' }
  return { label: '✓ enforced', tone: 'ok' }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test -- --run src/policy/status.test.ts`
Expected: 4 tests PASS.

- [ ] **Step 5: Restyle the table and add the STATUS column in `PoliciesPage.tsx`**

Add imports at the top:

```ts
import { useClusterInfo, useNamespaces, usePolicies } from '../api/queries'
import { policyStatus } from '../policy/status'
```

Inside the component add:

```ts
const { data: info } = useClusterInfo()
const cniEnforces = info?.cni?.enforcesPolicies
```

Replace the heading (line 18) with a sans-serif page title:

```tsx
<h1 className="text-lg font-bold text-text">Network Policies</h1>
```

Replace the table block (lines 48–91) with:

```tsx
<div className="mt-4 overflow-x-auto rounded-xl border border-edge bg-surface shadow-sm">
  <table className="w-full text-left text-sm">
    <thead className="bg-raised font-mono text-[11px] uppercase tracking-wide text-muted">
      <tr>
        <th className="px-4 py-2.5 font-medium">namespace</th>
        <th className="px-4 py-2.5 font-medium">name</th>
        <th className="px-4 py-2.5 font-medium">directions</th>
        <th className="px-4 py-2.5 font-medium">pods matched</th>
        <th className="px-4 py-2.5 font-medium">status</th>
        <th className="px-4 py-2.5 font-medium">created</th>
      </tr>
    </thead>
    <tbody>
      {filtered.map((p) => {
        const status = policyStatus(p.podsMatched, cniEnforces)
        return (
          <tr key={`${p.namespace}/${p.name}`} className="border-t border-edge/60 hover:bg-raised/50">
            <td className="px-4 py-2.5 font-mono text-xs text-muted">{p.namespace}</td>
            <td className="px-4 py-2.5">
              <Link
                to={`/policies/${p.namespace}/${p.name}`}
                className="font-mono text-sm font-semibold text-accent-strong hover:underline"
              >
                {p.name}
              </Link>
            </td>
            <td className="px-4 py-2.5">
              <span className="rounded-full bg-accent/10 px-2.5 py-0.5 font-mono text-[11px] font-medium text-accent-strong">
                {p.policyTypes.join(' + ')}
              </span>
            </td>
            <td className="px-4 py-2.5 font-mono text-xs text-muted">{p.podsMatched}</td>
            <td
              className={`px-4 py-2.5 text-xs font-semibold ${
                status.tone === 'ok'
                  ? 'text-accent-strong'
                  : status.tone === 'warn'
                    ? 'text-warn-text'
                    : 'text-block'
              }`}
            >
              {status.label}
            </td>
            <td className="px-4 py-2.5 font-mono text-xs text-quiet">{p.createdAt.slice(0, 10)}</td>
          </tr>
        )
      })}
      {!isLoading && filtered.length === 0 && (
        <tr className="border-t border-edge/60">
          <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted">
            {policies?.length
              ? 'No policies match the filter.'
              : 'No NetworkPolicies yet — every pod accepts all traffic. Create one to start restricting.'}
          </td>
        </tr>
      )}
    </tbody>
  </table>
</div>
```

(Changes vs current: `rounded-xl bg-surface shadow-sm` container, `bg-raised` header, new STATUS column with `colSpan` bumped 5→6, pill badge for directions, link in `accent-strong`.)

- [ ] **Step 6: Verify** — `cd web && npm test -- --run && npx tsc -b --noEmit` → PASS

- [ ] **Step 7: Commit**

```bash
git add web/src/policy/status.ts web/src/policy/status.test.ts web/src/pages/PoliciesPage.tsx
git commit -m "Restyle policy list and add per-row status column"
```

---

### Task 7: Simulator — verdict banner, warning callouts, progressive disclosure

**Files:**
- Modify: `web/src/pages/SimulatorPage.tsx`

**Interfaces:**
- Consumes: `warn*`, `accent-strong` tokens. `SimResult`/`SideResult` shapes unchanged.

- [ ] **Step 1: Replace the verdict block (lines 158–166) with a banner**

```tsx
<div
  className={`flex items-center gap-4 rounded-xl border-2 p-5 ${
    res.allowed ? 'border-allow bg-allow/10' : 'border-block bg-block/10'
  }`}
>
  <span
    aria-hidden
    className={`text-3xl font-bold ${res.allowed ? 'text-accent-strong' : 'text-block'}`}
  >
    {res.allowed ? '✓' : '✕'}
  </span>
  <div>
    <div
      className={`text-xl font-bold ${res.allowed ? 'text-accent-strong' : 'text-block'}`}
    >
      {res.allowed ? 'Connection allowed' : 'Connection blocked'}
    </div>
    <div className="mt-0.5 text-sm text-muted">
      source egress: {sideWord(res.egress)} · destination ingress: {sideWord(res.ingress)}
    </div>
  </div>
</div>
```

And add this helper at module level (below the interfaces):

```ts
function sideWord(side: SideResult): string {
  if (!side.applicable) return 'not evaluated'
  return side.allowed ? 'pass' : 'deny'
}
```

- [ ] **Step 2: Restyle warnings (lines 168–183) as warn callouts**

```tsx
{res.warnings && res.warnings.length > 0 && (
  <ul className="mt-3 space-y-1.5">
    {res.warnings.map((w) => (
      <li
        key={w.code + w.message}
        className={`rounded-lg border px-3 py-2 text-sm ${
          w.severity === 'warning'
            ? 'border-warn bg-warn-bg text-warn-text'
            : 'border-edge bg-surface text-muted'
        }`}
      >
        <span className="font-mono text-[10px] font-semibold uppercase">⚠ {w.code}</span> —{' '}
        {w.message}
      </li>
    ))}
  </ul>
)}
```

- [ ] **Step 3: SidePanel — readable verdict line + collapsible "policies evaluated"**

In `SidePanel` (lines 248–258), the isolated/allowed line: `text-allow` → `text-accent-strong`:

```tsx
<p className="mt-2 font-mono text-sm">
  {side.isolated ? (
    side.allowed ? (
      <span className="text-accent-strong">isolated — allowed by rule</span>
    ) : (
      <span className="text-block">isolated — no rule matches (deny)</span>
    )
  ) : (
    <span className="text-muted">not isolated — everything allowed by default</span>
  )}
</p>
```

Wrap the `evaluatedPolicies` block (lines 274–292) in a `<details>` so rule matches stay visible but the policy inventory collapses:

```tsx
{side.evaluatedPolicies && side.evaluatedPolicies.length > 0 && (
  <details className="mt-3">
    <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-wide text-quiet hover:text-muted">
      policies evaluated ({side.evaluatedPolicies.length})
    </summary>
    <ul className="mt-1 space-y-0.5">
      {side.evaluatedPolicies.map((p) => (
        <li key={`${p.namespace}/${p.name}`}>
          <Link
            to={`/policies/${p.namespace}/${p.name}`}
            className="font-mono text-xs text-muted hover:text-accent-strong"
          >
            {p.namespace}/{p.name}
          </Link>
        </li>
      ))}
    </ul>
  </details>
)}
```

Also in the destination-kind toggle (line 93), active tab `text-accent` → `text-accent-strong`, and the matched-rule "open →" links (line 266) `text-accent` → `text-accent-strong`.

- [ ] **Step 4: Verify** — `cd web && npm test -- --run && npx tsc -b --noEmit` → PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/SimulatorPage.tsx
git commit -m "Simulator: verdict banner, warning callouts, collapsible policy list"
```

---

### Task 8: Contrast sweep of remaining small `text-accent` / `text-allow` usages

Small (non-bold, <18px) green text on white must be `accent-strong` (global constraint). The pages not yet touched: PolicyDetailPage, PolicyNewPage, policy-form components, BuilderPage feedback line, TopologyPage empty states.

**Files:**
- Modify: every match from the grep below in `web/src/pages/PolicyDetailPage.tsx`, `web/src/pages/PolicyNewPage.tsx`, `web/src/components/policy-form/*.tsx`, `web/src/pages/BuilderPage.tsx`

**Interfaces:** none (class-string changes only).

- [ ] **Step 1: Enumerate and fix**

Run: `grep -rn "text-accent\b\|text-allow\b" web/src --include='*.tsx' | grep -v accent-strong`

For each hit, apply this rule:
- Small/normal-weight text (labels, links, feedback lines, notices) → `text-accent-strong`.
- Text that sits on `bg-accent` (solid buttons) → leave as-is (`text-on-accent` after Task 2).
- Large or bold display text (≥18px or `font-bold`) → may stay `text-accent`.
- `text-allow` used as small text → `text-accent-strong`; `text-allow`/verdict colors in edge strokes, borders, icons stay.

Known hits to fix (line numbers as of this plan): `BuilderPage.tsx:177` (feedback ok tone → `text-accent-strong`), `BuilderPage.tsx:320` (lossy notice → `text-warn-text`), hover states `hover:text-accent` → `hover:text-accent-strong` across `PoliciesPage`, `SimulatorPage` (done in Task 7), `PolicyDetailPage`, `LoadExisting`. Anything ambiguous: prefer `accent-strong`.

- [ ] **Step 2: Verify no small-teal stragglers**

Run: `grep -rn "text-accent\b" web/src --include='*.tsx'`
Expected: remaining matches are only large/bold display text or `!bg-accent` handle fills.

- [ ] **Step 3: Verify** — `cd web && npm test -- --run && npx tsc -b --noEmit` → PASS

- [ ] **Step 4: Commit**

```bash
git add web/src
git commit -m "Contrast sweep: strong teal for small text on light surfaces"
```

---

### Task 9: Full verification against the kind cluster

**Files:** none (verification only; fix-ups allowed anywhere).

- [ ] **Step 1: Full local gates**

Run: `cd web && npm run lint && npm test -- --run && npm run build && cd .. && make test && make lint`
Expected: all PASS.

- [ ] **Step 2: Run the app against the kind cluster**

Run: `kubectl config use-context kind-k8s-firewall-ui` must NOT be needed — instead pass the kubeconfig context explicitly per the project convention: `go run ./cmd/k8s-firewall-ui --kubeconfig ~/.kube/config --context kind-k8s-firewall-ui` (check `--help` for the exact context flag; if none exists, export `KUBECONFIG` scoped to the shell). Frontend: `cd web && npm run dev`, open http://localhost:5173.

- [ ] **Step 3: Visual pass (Playwright MCP or manually), page by page**

- Topology: select `demo-a`+`demo-b` → light canvas, white node cards, teal solid allowed edges, red dashed blocked edges, legend readable, edge-detail panel light.
- Policies: cream page, white table card, pill direction badges, STATUS column shows `✓ enforced` (Calico) and `⚠ selects nothing` for a zero-match policy (create one if none exists).
- Simulator: run one allowed and one blocked pair → banner shows big ✓/✕ with per-side summary; DNS-trap warning renders as cream callout; "policies evaluated" collapses.
- Builder: white canvas, cream target card, ingress vs egress cards distinguishable, YAML preview light.
- Policy detail: light YAML editor, readable Overview.
- Sidebar: dark teal, active pill, status chip shows CNI Calico enforced ✓.

- [ ] **Step 4: Screenshot evidence**

Capture one screenshot per page (Playwright `browser_take_screenshot`) into the scratchpad; report anything off and fix inline (respecting the token-only rule).

- [ ] **Step 5: Final commit & push**

```bash
git add -A && git status   # expect only intentional fix-ups
git commit -m "Kiwi light redesign: final polish after visual verification"  # only if fix-ups exist
git push origin main
```

---

## Self-Review Notes

- Spec coverage: tokens (T1), shell/status chip/banner (T3), Policies table+STATUS (T6), Simulator banner/warnings/disclosure (T7), Topology light (T5), Builder light + egress split (T5), CodeMirror light (T4), button/contrast sweeps (T2, T8), a11y + visual verification (T9, global constraints). Non-goals respected: no new deps, no dark toggle, no functional changes (only `policyStatus` pure helper added, with tests).
- Types: `policyStatus` signature consistent between test (Step 1) and implementation (Step 3) and usage (Step 5) in Task 6; `sideWord` defined and used only within Task 7.
- Known judgment call recorded inline: PeerNode ingress label color (Task 5 Step 4) — verify visually in Task 9.
