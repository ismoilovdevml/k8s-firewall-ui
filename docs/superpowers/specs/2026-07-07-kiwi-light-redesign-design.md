# Kiwi Light Redesign — Design

**Date:** 2026-07-07
**Status:** approved direction (visual mockups validated with user via brainstorm companion)
**Scope:** presentation layer only — no functional, routing, API, or state-management changes.

## Goal

Replace the current dark navy/amber "control-room" theme with a light, warm green
system based on the user's Kiwi palette (#028174, #0AB68B, #92DE8B, #FFE3B3) plus
dark greens (#061A23–#49B265) for the sidebar. The UI should look simple and calm
at first glance while keeping all existing power features; complexity is revealed
progressively.

Validated direction: **clean-SaaS table layout ("A") + warm Kiwi colors ("B")** —
cream content background, dark teal sidebar, white cards, pill badges.

## 1. Color token system

All colors live in `web/src/index.css` under Tailwind v4 `@theme`. The app already
uses semantic utility names (`bg-surface`, `text-accent`, `border-edge`, `text-allow`,
`text-block`, `text-muted`, `text-quiet`, `bg-raised`, `bg-base`), so the retheme is
primarily a token redefinition plus targeted component work.

| Token | New value | Role |
|---|---|---|
| `--color-base` | `#FAF7F0` | page background (cream) |
| `--color-surface` | `#FFFFFF` | cards, tables, panels |
| `--color-raised` | `#F6F2E8` | table headers, subtle fills, hover |
| `--color-edge` | `#EEE7D8` | borders, dividers |
| `--color-text` | `#0F2A24` | primary text (dark green ink) |
| `--color-muted` | `#7D8A85` | secondary text |
| `--color-quiet` | `#A8B3AE` | tertiary/disabled text |
| `--color-accent` | `#0AB68B` | primary buttons, active nav |
| `--color-accent-strong` | `#028174` | links, emphasized interactive text |
| `--color-allow` | `#0AB68B` | ALLOWED verdicts |
| `--color-block` | `#E05C52` | BLOCKED verdicts (deliberately outside the green palette so allow/block never blend) |
| `--color-warn` | `#D9A13F` | warning borders/icons |
| `--color-warn-bg` | `#FFE3B3` | warning fills (Kiwi cream) |
| `--color-warn-text` | `#7A5410` | warning text |
| `--color-sidebar` | `#06373A` | sidebar background |
| `--color-sidebar-text` | `#CFE8E0` | sidebar idle text |
| `--color-sidebar-brand` | `#92DE8B` | logo/brand in sidebar |
| `--color-sidebar-raised` | `#0A4A4E` | sidebar chips/hover |

`color-scheme` switches from `dark` to `light`. Fonts unchanged (Inter + JetBrains
Mono); headings get heavier weight (700–800) for hierarchy on the light background.

Contrast requirements: body text and all badge text/background pairs meet WCAG AA
(≥ 4.5:1); `#0AB68B` on white is reserved for large/bold text and non-text elements,
with `#028174` used where normal-size text needs to be green.

## 2. Layout shell (`components/Layout.tsx`)

- Sidebar: dark teal (`sidebar` tokens), brand in `#92DE8B`, active item = solid
  `#0AB68B` pill with dark text; idle items light-green text.
- **Cluster/CNI status moves from the footer into a status chip pinned at the bottom
  of the sidebar** (provider name, enforcement state, ANP presence, app version).
  The footer is removed. Rationale: enforcement status is the app's most important
  warning and is currently easy to miss.
- The red "policies not enforced" banner (flannel case) stays at the top but is
  restyled as a high-contrast warning strip consistent with the new warning tokens.

## 3. Per-page changes

### Policies (`pages/PoliciesPage.tsx`)
- Table styled per mockup: white card, `raised` header row, hairline row dividers,
  type shown as teal pill badges.
- **New STATUS column** computed client-side from data already returned by the API:
  `✓ enforced` (CNI enforces + selects ≥1 pod), `⚠ warning` (existing simulator/policy
  warnings such as DNS egress trap), `✕ selects nothing` (matches 0 pods). No backend
  changes; if a needed field is not in the list response, the status degrades
  gracefully (omit that state) rather than adding API surface.

### Simulator (`pages/SimulatorPage.tsx`)
- Verdict becomes a large banner: teal `✓ ALLOWED` / red `✕ BLOCKED` with the
  one-line reason.
- Explanation steps render as a readable numbered list (source egress check →
  destination ingress check), with per-rule match details inside a collapsible
  "details" section (progressive disclosure).
- Warnings (DNS trap, hostNetwork, node-local) render as cream `warn-bg` callouts.

### Topology (`pages/TopologyPage.tsx`, `components/topology/`)
- React Flow on light background; nodes become white cards with `edge` borders;
  namespace group containers use a faint green tint.
- Edges: allow = solid `#0AB68B`, blocked = dashed `#E05C52`, unknown/quiet = `quiet`.
- `.react-flow__attribution` and controls restyled for light mode.

### Builder (`pages/BuilderPage.tsx`, `components/builder/`)
- Light canvas; OR cards = white with teal border; AND rows inside a card keep the
  existing structure. Peer/port chips use pill styling.
- Live YAML preview switches to the light CodeMirror theme.

### Policy detail / forms (`pages/PolicyDetailPage.tsx`, `PolicyNewPage.tsx`,
`components/policy-form/`, `YamlEditor.tsx`)
- Overview cards white on cream; inputs white with `edge` borders, focus ring
  `#0AB68B`.
- **CodeMirror switches to a light theme** consistent with the token system (base
  editor background `#FFFFFF`, subtle gutter `#F6F2E8`). One shared editor theme
  object used by both YamlEditor and the Builder preview.

## 4. Non-goals

- No dark mode / theme toggle in this iteration.
- No functional changes: routing, API client, TanStack Query/zustand state, SSE
  handling, and the simulator engine are untouched.
- No new dependencies (the CodeMirror light theme is defined in-repo via
  `@uiw/react-codemirror` theming, not a new package).
- No logo/brand asset work beyond text + emoji-level marks.

## 5. Testing & verification

- Existing vitest suites must stay green; tests that assert on class names/colors
  are updated alongside components.
- Visual verification via the running app (`make dev` + Vite) against the kind
  cluster with demo namespaces: check Topology edges, Simulator verdict banner,
  Policies status column, Builder canvas, YAML editor readability.
- Accessibility spot-check: text contrast on cream/white surfaces, focus states
  visible, verdict distinguishable by icon + label (not color alone — ✓/✕ glyphs
  are part of the design for color-blind users).

## 6. Risks

- Green brand vs green "allow": mitigated by red/amber verdict colors staying
  outside the brand palette and by icon+label pairing.
- React Flow and CodeMirror have hardcoded dark-mode tweaks in `index.css` today;
  these must be audited so no dark remnants remain.
- Tailwind token rename fallout: any component using raw hex or non-semantic colors
  must be found (`grep -rn "#" web/src` audit) and migrated to tokens.
