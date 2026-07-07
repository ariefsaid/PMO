---
name: PMO Portal
description: >
  The monochrome-calm control surface (ADR-0037). Calm near-mono zinc chrome; PMO
  blue reserved for the ONE primary action + focus ring + active-nav; status as a
  quiet dot/ring + label; content-over-containers. LIGHT default + first-class
  WCAG-AA DARK. Values below are the LIGHT (`:root`) theme; the full light|dark
  pair is in §2. Canonical runtime form is the bare `H S% L%` triplet.
colors:
  # --- Surfaces (light; dark in §2) ---
  background: "hsl(0 0% 100%)"
  foreground: "hsl(240 6% 10%)"
  card: "hsl(0 0% 100%)"
  card-foreground: "hsl(240 6% 10%)"
  popover: "hsl(0 0% 100%)"
  popover-foreground: "hsl(240 6% 10%)"
  # --- Brand / action — PMO blue, held to primary + ring + active-nav ONLY ---
  primary: "hsl(221.2 83.2% 53.3%)"
  primary-foreground: "hsl(0 0% 98%)"
  ring: "hsl(221.2 83.2% 53.3%)"
  # --- Quiet UI (calm near-mono zinc) ---
  secondary: "hsl(240 5% 95.5%)"
  secondary-foreground: "hsl(240 4% 32%)"
  muted: "hsl(240 5% 95.5%)"
  muted-foreground: "hsl(240 4% 44%)"
  accent: "hsl(240 5% 95.5%)"
  accent-foreground: "hsl(240 4% 32%)"
  # --- Status / semantic (restrained: the dot hue; AA text via the -text vars) ---
  destructive: "hsl(0 72% 50%)"
  destructive-foreground: "hsl(0 0% 100%)"
  warning: "hsl(40 96% 50%)"
  warning-foreground: "hsl(28 95% 33%)"
  success: "hsl(142 60% 42%)"
  success-foreground: "hsl(0 0% 100%)"
  # --- Status / AA text variants (clear ≥4.5:1 on their /10–/12 tints, §6) ---
  nav-active-text: "hsl(221.2 83.2% 45%)"
  status-open-text: "hsl(221.2 83.2% 45%)"
  status-won-text: "hsl(142 64% 27%)"
  status-lost-text: "hsl(0 72% 44%)"
  status-violet-text: "hsl(255 45% 42%)"
  destructive-text: "hsl(0 72% 44%)"
  warning-icon: "hsl(35 92% 42%)"
  success-text: "hsl(142 64% 27%)"
  tooltip-muted: "hsl(240 5% 75%)"
  scrim: "hsl(240 8% 6%)"
  # --- Categorical accent (KPI/avatar/timeline only; never an action color) ---
  violet: "hsl(255 50% 55%)"
  # --- Lines / fields ---
  border: "hsl(240 5% 90.5%)"
  input: "hsl(240 4% 84%)"
typography:
  # Inter variable + the cv stylistic sets (ADR-0037) is the single UI family.
  fontFamily: "Inter, system-ui, -apple-system, Segoe UI, sans-serif"
  cvSets: '"cv02","cv03","cv04","cv11"'
  page-title: { size: "24px", weight: 700, lineHeight: 1.2, letterSpacing: "-0.02em" }
  heading: { size: "20px", weight: 700, lineHeight: 1.25, letterSpacing: "-0.01em" }
  subheading: { size: "18px", weight: 600, lineHeight: 1.3 }
  body: { size: "14px", weight: 400, lineHeight: 1.45 }
  label: { size: "12px", weight: 600, lineHeight: 1.3 }
  overline: { size: "11px", weight: 600, lineHeight: 1.3, letterSpacing: "0.06em" }
  mono: "Tailwind v4 `font-mono` stack (ui-monospace, SFMono-Regular, Menlo, …) — IDs/codes only"
rounded:
  sm: "4px"   # calc(var(--radius) - 4px)
  md: "6px"   # calc(var(--radius) - 2px)
  lg: "8px"   # var(--radius) = 0.5rem  (the base; nested children step DOWN)
  full: "999px"
spacing:
  base: "4px"   # Tailwind v4 default 4px scale (1..N)
motion:
  ds-ease: "120ms cubic-bezier(0.16, 1, 0.3, 1)"
components:
  button-primary:    { bg: "{colors.primary}", text: "{colors.primary-foreground}", radius: "{rounded.lg}", padding: "0 12px", height: "32px" }
  button-outline:    { bg: "{colors.background}", text: "{colors.foreground}", border: "{colors.border}", radius: "{rounded.lg}", padding: "0 12px", height: "32px" }
  button-ghost:      { bg: "transparent", text: "{colors.foreground}", radius: "{rounded.lg}", padding: "0 12px", height: "32px" }
  button-destructive:{ bg: "{colors.destructive}", text: "{colors.destructive-foreground}", radius: "{rounded.lg}", padding: "0 12px", height: "32px" }
  card:              { bg: "{colors.card}", text: "{colors.card-foreground}", radius: "{rounded.lg}", padding: "16px" }
  input:             { bg: "{colors.background}", text: "{colors.foreground}", border: "{colors.border}", radius: "{rounded.lg}", padding: "0 10px", height: "32px" }
  badge-status:      { bg: "{colors.secondary}", text: "{colors.muted-foreground}", radius: "{rounded.full}", padding: "0 9px", height: "22px" }
  table-header-cell: { bg: "{colors.card}", text: "{colors.muted-foreground}", padding: "0 12px", height: "38px" }
  table-body-cell:   { bg: "{colors.card}", text: "{colors.foreground}", padding: "12px", height: "54px" }
  nav-item:          { bg: "transparent", text: "{colors.foreground}", radius: "{rounded.sm}", padding: "0 10px", height: "36px" }
  kanban-card:       { bg: "{colors.card}", text: "{colors.foreground}", radius: "{rounded.lg}", padding: "11px" }
---

# Design System: PMO Portal

## 1. Overview

**Creative North Star: "The Quiet Control Surface" — monochrome-calm (ADR-0037).**

This is the **monochrome-calm** language the owner locked on 2026-07-01 (ADR-0037), ported *in place*
onto the existing app (Foundation slices F1 tokens + F2 dark toggle are committed; the surface slices
follow). It supersedes the prior "calm/dense/light-only shadcn" identity in *look only* — every logic,
data, chart, and action is unchanged. The mockups in `docs/design-mockups/redesign/reskin/` define the
look; **the committed code is the source of truth for every value below** (`pmo-portal/index.css`).

The personality is **calm, dense-but-airy, data-first, and premium in both themes.** Chrome is a calm
near-mono zinc ramp; **PMO blue is reserved for the ONE primary action per surface, the focus ring, and
active-nav** — nothing else. Status means something but is rendered **restrained**: a quiet **dot/ring +
label** (or a faint tint), **never a loud filled slab**. Structure prefers **hairline borders or
whitespace over boxes** (content-over-containers). It is an operator's tool for a contract- and
project-based business, and it explicitly rejects the "AI SaaS marketing" aesthetic: no
dark-mode-with-purple-gradients, no neon, no glassmorphism, no oversized hero type, no shadow-heavy
floating-card soup. *Calm after the 100th use.*

**Key characteristics (locked, ADR-0037 §1):**
- **Monochrome chrome; colour = meaning.** PMO blue (`--primary`) does all the interactive work and is
  held to primary-action + ring + active-nav; the semantic status palette (success/warning/destructive)
  stays but is quiet (dot/ring + label or a faint tint, never a solid slab behind text). Categorical
  violet is reserved for non-interactive accents (KPI tiles, avatars, timeline dots) — never an action.
- **Typography:** Inter variable + the cv stylistic sets (`cv02 cv03 cv04 cv11`); `tabular-nums` on all
  figures.
- **Shape/motion:** 8px base radius (`--radius: 0.5rem`) with nested reduction `calc(r - 2px/-4px)`;
  soft `--ds-ease: 120ms cubic-bezier(0.16,1,0.3,1)`; low, single-layer elevation; hairline borders or
  none. `prefers-reduced-motion` drops all transitions.
- **Icons:** ONE monoline family, stroke-2, 24×24 viewBox, `currentColor`, 1em — the `<Icon name=…>`
  facade (`src/components/ui/icons.tsx`).
- **Dark mode is first-class + WCAG-AA in both themes** (verified numerically; §6). Toggle via `<html>.dark`.
- **Density = deliberate balance (action ↔ density ↔ whitespace).** Airier than the old chrome
  (generous gutters, ~56–64px rows, content-over-containers) **while staying action-rich**: exactly one
  primary action visible; essential ERP verbs (Advance/Approve/Return/New) obvious; rare/secondary
  actions disclosed in menus, hover/focus, or disclosure rows. *Subtract, don't strip.*

> **Coherence Wave (2026-06-14):** the app's *atoms* are shared and disciplined — the diagnosed
> "doesn't feel like the same app" problem is PATTERN/MOLECULE drift, not token drift. §7 is the
> enforced standard for how records, lists, steppers, status pills, and copy must behave so every module
> reads as one hand.

## 2. Colors — light | dark token tables

A near-mono system built on shadcn-HSL **bare triplets** (`H S% L%`, no `hsl()` wrapper) mapped onto
semantic roles via Tailwind v4 `@theme inline` (`--color-*: hsl(var(--token))`). The bare form is
**load-bearing**: slash-alpha tints (`bg-primary/10`, `border-border/70`, `bg-success/12`) only work on
bare triplets (v4 generates them via `color-mix()`). **Light is default; `.dark` redeclares every
color/semantic token for a first-class dark theme.** Every value below is copied verbatim from
`pmo-portal/index.css`. Token groups (light | dark):

### Surfaces + text
| Token | Light (`:root`) | Dark (`.dark`) | Role |
|---|---|---|---|
| `--background` | `0 0% 100%` | `240 6% 7%` | app canvas |
| `--foreground` | `240 6% 10%` | `240 6% 95%` | primary text |
| `--card` | `0 0% 100%` | `240 5% 11%` | cards/table/popover body |
| `--card-foreground` | `240 6% 10%` | `240 6% 95%` | text on card |
| `--popover` | `0 0% 100%` | `240 5% 11%` | menus/toasts |
| `--popover-foreground` | `240 6% 10%` | `240 6% 95%` | text on popover |

### Quiet UI (calm near-mono zinc)
| Token | Light | Dark | Role |
|---|---|---|---|
| `--secondary` | `240 5% 95.5%` | `240 5% 14%` | quiet fills (seg tracks, count pills) |
| `--secondary-foreground` | `240 4% 32%` | `240 5% 72%` | text-secondary on quiet fills |
| `--muted` | `240 5% 95.5%` | `240 5% 14%` | de-emphasised surface |
| `--muted-foreground` | `240 4% 44%` | `240 4% 60%` | text-tertiary (labels, captions) |
| `--accent` | `240 5% 95.5%` | `240 5% 14%` | hover wash on neutral surfaces |
| `--accent-foreground` | `240 4% 32%` | `240 5% 72%` | text on accent |

### Brand / action — PMO blue, held to primary + ring + active-nav ONLY
| Token | Light | Dark | Role |
|---|---|---|---|
| `--primary` | `221.2 83.2% 53.3%` | `221 83% 52%` | the ONE primary-action fill + active-nav tint |
| `--primary-foreground` | `0 0% 98%` | `0 0% 100%` | white-on-primary |
| `--ring` | `221.2 83.2% 53.3%` | `221 90% 66%` | focus ring |
| `--nav-active-text` | `221.2 83.2% 45%` | `221 90% 72%` | AA blue text on the primary/10 nav wash |
| `--violet` | `255 50% 55%` | `255 60% 72%` | categorical accent (KPI/avatar/timeline only) |

### Status / semantic (the dot/bar hue) + their AA text variants
| Token | Light | Dark | Role |
|---|---|---|---|
| `--destructive` | `0 72% 50%` | `0 80% 62%` | destructive dot/bar/button fill |
| `--destructive-foreground` | `0 0% 100%` | `0 0% 100%` | white-on-destructive |
| `--warning` | `40 96% 50%` | `43 90% 58%` | warning dot/bar |
| `--warning-foreground` | `28 95% 33%` | `43 92% 64%` | AA amber text on warning tint |
| `--success` | `142 60% 42%` | `142 55% 52%` | success dot/bar |
| `--success-foreground` | `0 0% 100%` | `0 0% 100%` | white-on-success |
| `--status-open-text` | `221.2 83.2% 45%` | `221 90% 72%` | AA blue status-text (open) |
| `--status-won-text` | `142 64% 27%` | `142 60% 68%` | AA green status-text (won) |
| `--status-lost-text` | `0 72% 44%` | `0 85% 76%` | AA red status-text (lost) |
| `--status-violet-text` | `255 45% 42%` | `255 65% 80%` | AA violet status-text |
| `--destructive-text` | `0 72% 44%` | `0 85% 76%` | AA destructive text on tint/white |
| `--warning-icon` | `35 92% 42%` | `43 90% 64%` | darker amber icon on warning/12 tint |
| `--success-text` | `142 64% 27%` | `142 60% 68%` | AA green body text on success/10 tint |
| `--tooltip-muted` | `240 5% 75%` | `240 5% 75%` | muted text on the constant-dark tooltip |
| `--scrim` | `240 8% 6%` | `0 0% 0%` | overlay COLOR (app applies `/0.4` itself) |

### Avatar categorical solids (AA harden, 2026-07-07)
Closes the gap flagged in "Solid fills" below: the raw `--primary`/`--violet`/`--success`/`--warning`/
`--muted-foreground` hues were not all AA-safe as a SOLID FILL under BOLD WHITE initials (two independent
audits: raw `--warning` `#faa805` = 1.96:1, raw `--success` `#2bab5a` = 2.96:1 — both well under 4.5:1).
`--avatar-1..5` are the SAME hue family (same H/S as their source token) with L darkened until white text
clears **4.5:1 in both themes**. Avatar-only — never use for status dots/pills/text, which keep their own
AA-verified `-text` tokens above.

| Token | Light | Dark | White-text ratio (light / dark) | Source hue |
|---|---|---|---|---|
| `--avatar-1` | `221.2 83.2% 55%` | `221 83% 55%` | 4.86 / 4.83 | `--primary` family |
| `--avatar-2` | `255 50% 57%` | `255 60% 57%` | 5.14 / 5.57 | `--violet` family |
| `--avatar-3` | `142 60% 32%` | `142 55% 33%` | 4.80 / 4.78 | `--success` family |
| `--avatar-4` | `40 96% 31%` | `43 90% 30%` | 4.79 / 4.90 | `--warning` family |
| `--avatar-5` | `240 4% 46%` | `240 4% 46%` | 4.86 / 4.86 | `--muted-foreground` family |

Deterministic gate: `pmo-portal/pages/__tests__/AdminUsers.avatarContrast.test.ts` (`AC-A11Y-AVATAR-001`)
re-derives WCAG contrast for every `--avatar-*` token straight from `index.css` on every test run — a
future retune that drops any hue below 4.5:1 fails CI.

### Lines / fields
| Token | Light | Dark | Role |
|---|---|---|---|
| `--border` | `240 5% 90.5%` | `240 5% 16%` | the single hairline divider/outline |
| `--input` | `240 4% 84%` | `240 4% 30%` | field stroke (a hairline-strong) |

### Geometry + motion (theme-independent; redeclared in `.dark` for full parity)
`--radius: 0.5rem` · `--rail-w: 224px` · `--header-h: 56px` · `--ds-ease: 120ms cubic-bezier(0.16, 1, 0.3, 1)`

### Dark-theme mechanics (F2)
- Toggle = the `dark` class on `<html>`. **No-flash bootstrap** (`pmo-portal/index.html`, synchronous,
  pre-paint) reads `localStorage['theme']`, falls back to `prefers-color-scheme`, and sets the class
  **before first paint** so the canvas never flashes the wrong scheme.
- **Persistence + runtime sync** via `useTheme` (`src/hooks/useTheme.ts`) + `ThemeToggle`
  (`src/components/shell/ThemeToggle.tsx`): the `<html>.dark` class is the single source of truth;
  `setTheme`/`toggle` flips the class FIRST, then best-effort-persists (never throws — Safari private
  mode). No `'system'` tri-state, no provider.
- `@theme inline` is untouched by dark: it resolves `var()` at use-time, so redeclaring the base vars
  in `.dark` cascades through every utility automatically.

### Named rules
**The One-Blue Rule.** `--primary` is the only saturated interactive color and must touch ≤~10% of any
screen: the one primary action + the focus ring + active-nav. If two things are blue and only one is the
action, one is wrong. Violet/status hues are NOT substitutes for it.

**The Status-As-Dot Rule (ADR-0037).** Status is a **dot/ring + label** (or a faint `/10–/12` tint with
an AA `-text` variant) — **never a loud filled slab behind body text.** Solid status fills are reserved
for the essential status *verb* (the destructive button). Pill text MUST come from the AA `-text` tokens
(`--status-*-text`, `--destructive-text`, `--success-text`), never the raw dot hue — and status is never
color-only (the label carries identity).

**The Freed-Blue Status Rule (Coherence Wave).** The action-blue is reserved for the one affordance —
**no status/severity/category pill may use it.** Three independent pill families, one registry each in
`src/lib/status/statusVariants.ts`: **(A) Workflow** open/active/in-progress → `progress` (neutral grey;
the LABEL carries identity, never color-only); needs-you → `warn`; done/won/approved → `won`;
lost/rejected/cancelled → `lost`; closed/terminal → `neutral`. **(B) Severity/risk** Low `neutral` ·
Medium/High `warn` · Critical `lost`. **(C) Categorical/type/activity** `violet` for the highlighted
kind + `neutral` for the rest. The StatusPill `open` (blue-tint) variant is frozen out of status use.

**The Single-Border Rule.** `--border` is one value; `--input` is its slightly-stronger sibling for field
strokes. Never invent a second border color to "separate" regions — use surface-tone contrast or spacing
(content-over-containers) instead.

**Content-over-containers (ADR-0037 §1).** Fewer boxes; prefer hairline dividers and whitespace to
nested card wrappers. Drop a wrapping card where whitespace/dividers suffice; keep a container only where
the content earns it (a phase/delivery card, a table frame).

## 3. Typography

**UI font:** Inter variable (opsz 14..32, 400/500/600) + the cv stylistic sets
(`font-feature-settings: "cv02","cv03","cv04","cv11"`) — the agent-native typographic signature (ADR-0037).
Fallback `system-ui, -apple-system, "Segoe UI", sans-serif`. Root font-size is **16px** (load-bearing:
rem-based utilities resolve to DESIGN.md sizes — `h-8` = 32px controls). Default body size is 14px,
line-height 1.45.

**Mono:** the Tailwind v4 `font-mono` default stack (`ui-monospace, SFMono-Regular, Menlo, …`), applied
via the `font-mono` utility for IDs/codes/`⌘K` only. **Never** for prose or money (money is Inter-tabular).

**`tabular-nums` is mandatory** (`font-variant-numeric: tabular-nums` + `font-feature-settings: "tnum"`,
via the `.tabular`/`.tnum` utility) on every figure that can change or be compared — currency, %, counts,
deltas, ages — so columns align and figures don't jitter. Note: `.tabular`/`.tnum` set their own
`font-feature-settings` list, which fully replaces (not merges) the cv list on those elements.

### Hierarchy (unchanged scale)
- **Page Title** (700, 24px, lh 1.2, ls -0.02em): one per page. KPI values reuse ~23px/700.
- **Heading** (700, 20px, lh 1.25, ls -0.01em): section/card/kanban-column titles.
- **Subheading** (600, 18px, lh 1.3): sub-section headers in detail panels.
- **Body** (400, 14px, lh 1.45): default text; controls/table cells run ~13.5px.
- **Label** (600, 12px, lh 1.3): status pills, badge counts, dense metadata, small button text.
- **Overline** (600, 11px, lh 1.3, ls 0.06em, UPPERCASE): rail group labels + table column headers.
- **Mono** (IDs/codes/`⌘K`): see above.

**The Mono-For-Identifiers Rule.** `font-mono` appears only on machine identifiers (deal/project codes)
and keyboard chips. Money is Inter-`tabular`, not mono.

## 4. Geometry, motion & elevation

**Radius — 8px spine with nested reduction.** `--radius: 0.5rem` (8px = `lg`); nested children step DOWN:
`--radius-md: calc(var(--radius) - 2px)` (6px), `--radius-sm: calc(var(--radius) - 4px)` (4px). `full` =
999px. So inner corners always sit inside outer ones.

**Motion — soft, premium, low.** `--ds-ease: 120ms cubic-bezier(0.16, 1, 0.3, 1)` is the declared easing
token for hover/state transitions. `prefers-reduced-motion: reduce` drops every animation/transition to
~0ms globally (a single `@media` rule in `index.css`); build motion so it degrades to an instant
crossfade there.

**Elevation — borders-first, flat-by-default, single-layer.** Depth is conveyed by 1px hairlines and
surface-tone contrast (a white `card` on the tinted canvas), not shadow. Shadows are small, low-opacity,
and almost always a *response to state* (hover/pressed/focus) or reserved for true overlays (popover,
toast, tooltip) that genuinely float. Shadow color is a desaturated near-black (`hsl(240 6–10% ~8% /
low-alpha)`), never pure black. The signature shadow alphas are the only sanctioned raw values (in
`index.css` + component classes); everything else is token-referenced. Low, single-layer elevation only.

**The Flat-By-Default Rule.** A static card gets a border, not a drop shadow. A shadow appears only on
hover/pressed/focus or for a genuine overlay.

**The No-Pure-Black-Shadow Rule.** Shadow color is always desaturated near-black at low alpha. Never
`rgba(0,0,0,…)` at high opacity.

## 5. Components

All interactive controls are **32px tall** ("h-8") with `lg` (8px) radius unless noted; data-table rows
are deliberately roomier (54px today; the airier target is ~56–64px — generous gutters, content-over-
containers). Nested radii use `calc(var(--radius) - 2px/-4px)` so inner corners sit inside outer ones.

### Buttons
- **Shape:** `lg` radius, 32px tall, `0 12px` padding, ~7px gap to a ~15px icon. Small (`btn-sm`): 28px.
  Icon-only: 32px square.
- **Primary:** `primary` bg, `primary-foreground` text, faint brand-tinted shadow at rest. The ONE blue
  action per surface.
- **Outline:** `background` fill, `border` stroke, `foreground` text. Hover → `accent` wash.
- **Ghost:** transparent, `foreground`/`muted-foreground` text. Hover → `accent` wash. Home for header
  icon buttons and rare/secondary actions (the overflow menu is the calm home for Edit/Archive/Export).
  Shell icon-buttons (top-bar bell/theme-toggle/rail-toggle/search-trigger) render at
  `text-muted-foreground` **at rest** in both themes, flipping to `text-foreground` only on hover —
  never `text-foreground` at rest (a quiet-by-default control, not a highlighted one).
- **Destructive:** `destructive` bg, `destructive-foreground` text. The only solid status fill; reserved
  for irreversible actions (Mark lost, Delete).
- **Focus:** global `:focus-visible` — `outline: 2px solid hsl(var(--ring)); outline-offset: 2px; border-radius: 4px`.

### Badges / Status Pills
- **Status pill:** 22px tall, full radius, 12px/600 label with a leading 6px colored **dot** (a ring on
  the tinted variants). Background = status hue at ~10–18% (`/10`–`/12` tints), text = the matching AA
  `-text` token. Per the Freed-Blue + Status-As-Dot rules, **no status/severity/category pill may use the
  `open` (blue) variant**, and status is never color-only. Default/neutral badge = `secondary` bg +
  `muted-foreground` text.
- **Count badge** (nav rail / kanban): quiet — `muted-foreground` figure (not a loud filled chip); active
  nav item flips to `--nav-active-text` (AA blue) + `font-semibold`.
- **Unread-count chip** (notification bell): `bg-foreground` / `text-background` — a maximal-AA-contrast
  NEUTRAL pair, never `destructive`. A count is not a severity signal (that's the notification's own
  dot+label inside the inbox popover); `destructive` stays reserved for the actual destructive verb.

### Status / AA text tokens (single source of truth in `index.css`)
The darkened-AA text values for blue/status TEXT are named CSS custom properties. `StatusPill` and
status text apply them as `hsl(var(--token))`. See §6 for the verified contrast numbers.

### Cards / Containers
- **Corner:** `lg` radius (8px). When a card sits above a toolbar+table assembly, top corners round and
  the seam squares (`var(--radius) var(--radius) 0 0`).
- **Background:** `card` on the canvas; the tone contrast reads as elevated (no rest shadow).
- **Border:** always a 1px `border` — the primary depth cue. **Drop the wrapper where whitespace/dividers
  suffice** (content-over-containers).
- **Padding:** 16px standard; compact cards (kanban) ~11px.
- **KPI Tile** (signature): white card, 16px padding, [30px tinted icon tile] + [label, `muted-foreground`
  12.5px] + [help `?`], a ~23px/700 tabular value, and a foot row with a tinted delta chip + `muted`
  "vs." comparison. **ONE treatment app-wide** (`KPITile`); the in-header metric strip is `StatTiles`.

### Inputs / Fields
- `background` fill, 1px `input` border, `lg` radius, 32px tall, `0 10px` padding. Placeholder =
  `muted-foreground`. Focus = global ring.
- **Checkbox:** 16px, 1.5px `input` border, 4px radius; checked → `primary` fill + `primary` border +
  white check. Exposed with `role="checkbox"` + `aria-checked` + `tabindex`.
- **Validation contract (Coherence Wave):** `EntityFormModal`/`useEntityForm` validate **on blur / on
  submit**, never on mount — no eager "Fix N fields" banner on an untouched form.

### Data Table (signature)
- **Header cells:** sticky, `card` bg, 38px tall, Overline type (uppercase, `muted-foreground`), bottom
  `border`. Numeric columns right-align. Row `⋯` menu trigger is **always visible** (hover-hidden was
  reverted: undiscoverable on touch + keyboard).
- **Body cells:** 54px today (airier target ~56–64px), 12px padding, divider = `border/70%`. Row hover →
  `accent/60%`; selected → `primary/7%`; expanded → `accent/50%`.
- **In-cell:** project cell (28px mono icon + 2-line name/code, code in `font-mono`); money (`tabular`,
  sub-values `muted`); win-% bar (track `secondary`, fill `success`/`warning`/`destructive` by
  threshold); age chip (turns `warning`/`destructive` when aging/stale).
- **Footer:** totals row, `secondary/40%` bg, 1.5px top border, `tabular` values.
- **Toolbar / Action bar:** `card` bg seamed to the table top, holds `control` chips, a `seg` segmented
  filter, a `search-mini`, trailing icon controls. **The list-toolbar slot order is fixed by the
  `ListPage` shell (§7).**
- **Reflow (OD-W4-4):** single-renders — `<table>` at `md` (768px), stacked card list below. One branch
  in the DOM (no flash, no `aria-hidden` dup). Touch targets extend to ≥44px via `.touch-target`.

### Kanban Card (signature)
White `card`, `lg` radius, ~11px padding, faint rest shadow; hover lift + `muted-foreground/35%` border;
active → `scale(.992)`; selected → `primary` border + `primary` ring + `primary/4%` fill. 26px icon,
name + customer, ~15px/700 tabular value, win-% chip, foot row (age + owner avatar + mini status pill).
Columns in a horizontal-scroll grid of `minmax(258px, 1fr)` tracks with scroll-snap (one column per
gesture on touch) + a right-edge mask fade. **ONE `ProjectCard` + ONE `KanbanBoard`** drive every board.

### Lifecycle Stepper (signature) — ONE stepper only
The canonical stepper is the even-flex **BAR** stepper: equal-flex steps each with a 6px rounded `jbar`
(track `secondary`); `done` → `success`, `current` → `primary`, `paid` → `success`. Used for budget,
project-stage, and procurement lifecycles. The `current` step using `primary` is intentional — the bar
stepper is a **journey indicator**, not a status/category pill, so the Freed-Blue rule does not govern it.
The numbered-circle `node` variant is retired; the `inline` pip (9px dots in table rows) remains.

### Navigation
- **Rail:** `--rail-w: 224px`, `card`/sunken bg, right `border`. Brand block (56px). Grouped items under
  Overline labels. **Nav item:** 36px tall, `sm` radius, 13.5px/500, 17px stroke-2 icon, optional quiet
  count. Hover → `accent`; active → `primary/10%` bg + `--nav-active-text` (AA blue) + 600 +
  `aria-current="page"`. Foot holds Settings + the non-destination Assistant toggle (`aria-pressed`).
- **Top bar:** `--header-h: 56px`, `background` bg, bottom `border`. Mobile menu + breadcrumb (`muted` →
  `foreground` on hover, `>` separators, bold current) + spacer + `cmdk` search (`⌘K`) + icon button with
  a `destructive` notification dot + user chip (avatar gradient + name/role, hidden on phone).
- **Mobile:** below 920px the rail collapses (`--rail-w: 0`); hamburger appears; `cmdk` shrinks to an
  icon. (Two breakpoints: 920px rail-collapse, 768px table→card reflow.)

### Tabs / Segmented Controls
- **Inline segmented (`seg`):** 32px track on `secondary`, 28px buttons, "on" = white `background` pill +
  `foreground` + 600 + a 1px lift. `role="tablist"`/`role="tab"`/`aria-selected`.
- **View switch (`ViewToggle`):** the shared `Table / Board / Calendar / Cards` label set, right-aligned
  icon segmented.

### Overlays
- **Popover menu:** `popover` bg, `border`, `lg` radius, overlay shadow, 5px padding; 32px items, `accent`
  hover, `danger` items in `destructive-text`, hairline separator.
- **Toast:** `popover` bg, `border` + 3px left accent stripe (`primary`, or `success` for ok), bottom-
  right, slide-in (`.toast-anim`).
- **Tooltip (`.tooltip-surface`):** a DESIGN.md-sanctioned literal dark surface (`hsl(240 10% 8%)`),
  near-white text, `lg`-derived radius, `0 8px 24px / 0.4` shadow, max 280px; bold title + `tabular`
  key/value rows; `tooltip-muted` for de-emphasised body. (The tooltip surface is constant-dark in both
  themes, so `--tooltip-muted` is the same value in `:root` and `.dark`.)

## 6. Do's and Don'ts

### Do:
- **Do** hold `--primary` to the ONE primary action + ring + active-nav; keep it under ~10% of any screen.
- **Do** render status as a dot/ring + label (or a faint `/10–/12` tint) using the AA `-text` tokens;
  reserve solid status fills for the destructive verb only.
- **Do** define structure with the single 1px `border` + surface-tone contrast — and prefer
  whitespace/dividers over boxes (content-over-containers).
- **Do** apply `tabular-nums` to every figure (currency, %, counts, deltas, ages).
- **Do** keep controls at 32px and rows roomy; use the 8px radius spine with `calc()` derivations.
- **Do** use `font-mono` only for machine IDs/codes and the `⌘K` chip; everything else is Inter+cv.
- **Do** expose the global `:focus-visible` ring on every focusable element; keep `role`/`aria-*` on tabs,
  checkboxes, nav, dialogs.
- **Do** reserve violet/status hues for non-interactive meaning — never as action colors.
- **Do** route every status/severity/category pill through `src/lib/status/statusVariants.ts`.
- **Do** open every primary entity as a routable `/x/:id` page (The Record-Open Rule, §7).

### Don't:
- **Don't** ship the "AI SaaS marketing" aesthetic (dark+purple-gradients, neon, glassmorphism, hero
  type, floating-card soup).
- **Don't** put a drop shadow on a static card — give it a border (Flat-By-Default).
- **Don't** use `rgba(0,0,0,…)` at high opacity for shadows; desaturated near-black at low alpha only.
- **Don't** introduce a second brand color, a new font, or a second border color.
- **Don't** color body text with a fully saturated status hue, or fill a status pill solid.
- **Don't** make controls taller/shorter than 32px or invent radii outside the 4/6/8/999 scale.
- **Don't** assign the action-blue (`open` variant) to any status/severity/category pill.
- **Don't** build a record as a URL-less drawer, leave a list row inert, or build a second
  stepper/KPI-tile/project-card/list-toolbar grammar — reuse the §7 molecule.
- **Don't** invent a per-feature create verb. Use **"New &lt;Entity&gt;"**; keep a domain verb only where
  the domain uses it, and make button + modal title + submit all say the same phrase.

---

## 7. Coherence-Wave canonical molecules (enforced standard)

The atoms (§2–§6) are shared; this section governs the **molecules** so every module behaves by one
rulebook. Plan: `docs/plans/2026-06-14-coherence-wave.md`.

### Terminology + create-verb
- **Canonical noun = "Project"** in all UI copy. "Deal"/"opportunity" are removed. "Pipeline" is a valid
  *stage-group* label, not a second noun.
- **Create-verb = "New &lt;Entity&gt;"** (New project / company / contact / user). Domain verbs kept only
  where the domain uses them; then button + modal title + submit must be identical.

### RecordHeader (the one record-page header)
Anatomy (non-optional): **[icon tile] [name] [status pill] … [Edit] [Archive/Delete by permission]**,
actions top-right. Optional `meta` row + `StatTiles` strip below. Thin wrapper over `PageHeader`
(`src/components/ui/PageHeader.tsx`); the Project detail header is the template.

### Record-open paradigm (The Record-Open Rule)
- **Every primary entity is a routable `/x/:id` page** with breadcrumb + Back + ⌘K indexing. Drawers are
  optional quick-peek previews that carry a URL + "Open full record" — never the only home.
- **Stage-aware project lens (ADR-0020):** the one `/projects/:id` shows a **pipeline lens** pre-win
  (Value / Win probability / Weighted) and a **delivery lens** post-win (Contract/Committed/Actual strip,
  S-curve, milestone stepper, delivery tabs). Tab/body visibility is driven by `projectStatusGroup`.

### RecordActionZone (the record-action contract)
The advance/approve verbs (Advance / Mark won / Approve / Reject) live in ONE consistently-placed,
**never-below-the-fold** zone (sticky on desktop, fixed action bar on mobile), above the green
"Ready to advance" banner. Edit/Archive live in the header; advance verbs live here — one rule.

### ListPage shell
Fixed grammar: **[title + count] … [primary "New &lt;Entity&gt;"]**, then a toolbar in fixed slot order
**view-switcher · status filters · Search · Filter · Export · Import** (empty slots held in place). ONE
`ViewToggle` with the shared `Table / Board / Calendar / Cards` label set. View-switcher right-aligned
(icon segmented); status filters left as text chips — visually distinct. Implemented as `ListPage`
(`src/components/ui/ListPage.tsx`): named slots `title / description / count / primaryAction` +
`banner / filters / search / secondaryFilter / exportAction / importAction / view`.

### Approvals (one inbox)
`/approvals` is the single canonical inbox for ALL approval types, with per-module deep-link tabs, one
`ApprovalRow`, one decision affordance (inline Approve/Return + "Open"). Rail label + H1 = "Approvals".

### Skeleton loading pattern
- **Page-head skeleton:** two `skel` divs mirroring `DashPageHead` (h1 + two-line sub) — never a single
  `skel h-8` (collapses the two-line structure → layout jump on ready). `skel-line` provides line height
  + gap.
- **Panel skeleton:** delegate to `<ChartFrame state="loading">` (emits `data-testid="liststate-loading"`).
  Never hand-roll a panel spinner.
- **Unified loading guard:** unify data-loading + still-compiling under one `isPending || compiling` guard
  so the user sees a single stable skeleton with no FOUC. Reference: `UserViewRenderer` (I3).

### FE design battery — 4 lenses, run twice
Every UI issue passes a **4-lens design battery** twice (mockup round 1, built-UI round 2 per
`docs/design-workflow.md`): **Lens A Visual / B Flow / C Structure / D Intent**. `design-reviewer` owns
all four; Lens D grades against `docs/jtbd.md`. In the current (default) **portfolio** review mode
(ADR-0030), this is the rendered Discover pass: `design-reviewer` renders the running app on rich seed and
audits open-endedly; every finding graduates to a test + a `routes × oracles` cell + a DESIGN.md note.

---

## How to use these tokens (implementers)

The source ships these as **shadcn-HSL bare triplets on `:root`** (light) + `.dark` (dark), consumed via
`hsl(var(--token))` and `hsl(var(--token) / <alpha>)`. Tailwind v4 `@theme inline` maps utilities to them.

1. **Bare `H S% L%` triplets only** — no `hsl()` wrapper on the `:root`/`.dark` declarations. This is
   load-bearing: slash-alpha tints (`bg-primary/10`, `border-border/70`, `bg-success/12`) only work on
   bare triplets.
2. **`@theme inline` maps each `--color-*` to a resolved color** — `@theme inline { --color-background:
   hsl(var(--background)); --color-primary: hsl(var(--primary)); … }` — and `--radius-lg: var(--radius);
   --radius-md: calc(var(--radius) - 2px); --radius-sm: calc(var(--radius) - 4px)`. **Do NOT append the v3
   `/ <alpha-value>` placeholder** — v4 does not substitute it and emits invalid CSS the browser discards.
   v4 generates `/<alpha>` modifiers automatically via `color-mix()` from the bare color.
3. **Redeclare in `.dark`** every color/semantic token (index.css does). `@theme inline` resolves `var()`
   at use-time, so redeclaring the base vars cascades through every utility — no per-utility dark variant.
4. **Alpha tints** (`primary/10`, `success/12`, `border/70`, …) come from slash-alpha syntax — keep them;
   they are load-bearing for the Status-As-Dot and hover-wash patterns.
5. **Numbers:** apply `.tabular`/`.tnum` to every metric.
6. **Focus:** keep the global `*:focus-visible { outline: 2px solid hsl(var(--ring)); outline-offset: 2px;
   border-radius: 4px }` rather than per-component focus styles.
7. **Charts (recharts):** theme via `chartTheme` (`src/components/ui/chartTheme.ts`) — axis/grid in
   `muted-foreground`/`border`, primary series in `primary`, status series in success/warning/destructive,
   categorical in violet. **`chartTheme.ts` still holds legacy hardcoded categorical hues** (the old
   blue/violet/green/amber/red literals) — a known follow-up to re-tone in a chart surface slice; the
   axis/grid/series already derive from tokens. Time-series use a time/value axis (`type='number'` +
   `scale='time'`, `dataKey` = epoch-ms), never a categorical index; date math via date-fns (UTC-stable).

## Accessibility posture

**Contrast — WCAG-AA in BOTH themes (verified in reskin `_app.css` §0; numbers ported verbatim).**
Light (text token → on surface → ratio) and Dark:

| Text token (light value) | On surface (light) | Ratio | On surface (dark value) | Ratio |
|---|---|---|---|---|
| `--foreground` `240 6% 10%` | canvas | **17.72:1** | `240 6% 95%` on canvas `240 6% 7%` | **16.81:1** |
| `--secondary-foreground` `240 4% 32%` | canvas / muted | 8.21 / 7.40:1 | `240 5% 72%` on canvas / raised | 9.17 / 8.37:1 |
| `--muted-foreground` `240 4% 44%` | canvas / sunken / muted | 5.22 / 4.94 / 4.71:1 | `240 4% 60%` on canvas / raised / muted | 6.35 / 5.80 / 5.34:1 |
| `--nav-active-text`/`--status-open-text` `221.2 83.2% 45%` | canvas / primary-tint / tint-strong | 6.81 / 5.87 / 5.35:1 | `221 90% 72%` on canvas / tint / tint-strong | 7.35 / 6.06 / 5.21:1 |
| `--status-won-text`/`--success-text` `142 64% 27%` | success-tint / canvas | 5.38 / 6.07:1 | `142 60% 68%` on tint / raised | 8.43 / 10.56:1 |
| `--status-lost-text`/`--destructive-text` `0 72% 44%` | destructive-tint / canvas | 5.06 / 6.02:1 | `0 85% 76%` on tint / raised | 6.66 / 7.52:1 |
| `--warning-foreground` `28 95% 33%` | warning-tint / canvas | 5.09 / 5.68:1 | `43 92% 64%` on tint / raised | 8.27 / 10.95:1 |
| `--status-violet-text` `255 45% 42%` | violet-tint | AA (no §0 number) | `255 65% 80%` on tint | AA (no §0 number) |

**Solid fills (white text on the hue):** dark `--primary` (`221 83% 52%`) = **5.39:1 AA** (verified).
**Known gap (flagged in `index.css`):** the app has ONE `--primary` that doubles as the solid fill, so
**raw `text-primary` (blue) used as TEXT on the dark canvas is ~3.5:1 (sub-AA).** The fix is a
`--primary-text` bright-blue split (the reskin `--ds-primary-text`, already prototyped) landing with the
surface slices — **not a token-layer concern**. Until then, surface agents MUST use the AA `-text` tokens
(`--nav-active-text`, `--status-*-text`, `--destructive-text`, `--success-text`) for blue/status TEXT.
**Unverified solids (not in the §0 table):** the solid BUTTON fills `--primary` (light `53.3%` L) and
`--destructive` (light `50%` / dark `62%` L) with white text were not contrast-verified in §0 — §0's
AA-passing solids are darker `-solid` variants (primary-solid 47%/52%, destructive-solid 44%/46%) the app
has not yet split out. Treat solid status-button contrast as pending the surface slices.

**Avatar categorical solids — CLOSED (2026-07-06 audits → fixed 2026-07-07).** The `Avatar` in
`pages/AdminUsers.tsx` renders bold WHITE initials on a raw categorical hue picked from
`--primary`/`--violet`/`--success`/`--warning`/`--muted-foreground` — two of those (raw `--success`
2.96:1, raw `--warning` 1.96:1) failed AA as a solid white-text fill. Fixed via dedicated `--avatar-1..5`
tokens (same H/S family, darkened L) — see the "Avatar categorical solids" table above. Deterministic gate:
`AdminUsers.avatarContrast.test.ts` (`AC-A11Y-AVATAR-001`).

**Status dots** are graphical (≥3:1) and always paired with a text label (WCAG-exempt); light
success-dot 3.92 / warn-dot 3.17 / neutral-dot 4.22 on canvas; dark dots already clear 3:1 at the vivid
hues (success 8.75 / warn 11.01 / neutral 3.12).

**Focus:** single source of truth — global `:focus-visible` = `2px solid hsl(var(--ring))` at 2px offset.
**Semantics:** `aria-current="page"` on active nav, `role="tablist"/"tab"/"aria-selected"` on segmented
filters, `role="checkbox"/"aria-checked"/tabindex` on custom checkboxes, `aria-label` on icon-only
buttons and landmarks. **Keyboard:** tab order follows DOM; overlays add focus management + `Esc`-to-close.
**Coherence-Wave invariants:** every new record page carries a focus-managed heading + breadcrumb + Back;
`RecordActionZone` keeps the primary action in the keyboard path and above the fold; status pills stay
dot+label (never color-only).

---

## Icons — the `<Icon name=…>` monoline facade (ADR-0037, locked look)

The app renders every icon through ONE facade: `<Icon name=…>` (`src/components/ui/icons.tsx`) backed by
the `ICON_PATHS` registry (`src/components/ui/iconPaths.tsx`). The facade is the locked monoline look:
`viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`, `strokeWidth={2}`, round caps/joins,
`width/height="1em"` (sized by font-size), and `aria-hidden` unless an `aria-label`/`title` is passed.

**Adopting Lucide is DEFERRED.** The hand-rolled monoline set (~36 icons) already matches the Lucide
style (stroke-2, 24×24, currentColor), and the facade means Lucide can be swapped in behind `<Icon name>`
with **zero call-site churn** if a future surface needs an icon the set lacks. This is a deliberate
deferral, not an omission — do not introduce a second icon family or bypass the facade.

---

## A2 · AssistantPanel design additions (ADR-0040)

### Layout tokens
| Token | Value | Why |
|---|---|---|
| `--agent-panel-w` | `400px` | Fixed desktop drawer width (a layout constant alongside `--rail-w: 224px` / `--header-h: 56px`). |
| `--agent-panel-breakpoint` | `1024px` | The panel's modal-sheet threshold — distinct from the 920px rail-collapse and 768px table-reflow. |

### `AssistantPanel` (persistent companion drawer)
A right-side companion drawer mounted as a sibling of `<main>` (NOT a grid column). `card` bg + left
`border` + overlay shadow on desktop; full-screen modal sheet below `--agent-panel-breakpoint`.

**Dual focus contract (D-A2-1):**
- **Desktop (≥ breakpoint):** `role="complementary" aria-label="Agent assistant"`. NON-modal: no focus-
  trap, no background `inert`, no scrim. Tab exits freely to `<main>`. Focus into composer on open;
  restores to trigger on close.
- **Mobile (< breakpoint):** `role="dialog" aria-modal="true"`. Full modal: focus-trap, background
  `inert`, scrim (`bg-foreground/40`), body-scroll-lock. Mirrors the AppShell mobile rail drawer.

**Do:** open with ⌘J (toggle), the Rail "Assistant" button (non-destination, `aria-pressed` MUST track
the real `open` state from `AgentRuntimeContext`), or Close ×. Esc always closes. Stop cancels.
**Don't:** trap focus or scrim the background on desktop — a companion drawer is non-modal. Keep-mounted +
`inert` when closed (transcript survives route changes).

### `ChatBubble` (user message)
Right-aligned, `secondary` bg, `foreground` text, `lg` radius (one corner squared), max-width ~85%, body
type, SR-only "You said: " prefix. **Must be `secondary` (quiet grey) — NEVER `primary` blue** (a sent
message is not an action; One-Blue Rule). Blue is reserved for the Send button only.

### `ToolCallCard` (agent evidence)
Recessed card deriving the label from `payload`: `payload.entity` → "Looked up &lt;entity&gt; · N rows"
(count `tabular`); else "Checking your data…". `card` bg + 1px `border`, `lg` radius, 12px
`muted-foreground` label. Leading status glyph is `aria-hidden`; never renders raw JSON; never blue.

### `ApprovalChip` (write-action approve/deny widget) — A3 graduation
- **Token rule (Blocker-6):** the "Approved ✓" paragraph MUST use `text-[hsl(var(--success-text))]`
  (`--success-text: 142 64% 27%`). Never the raw `text-green-600` literal (different L, fails AA, breaks
  dark). Enforced by a Vitest test.
- **Control-height rule (Blocker-9):** Approve/Deny buttons MUST be `h-8` (32px, app-wide control height).
  Use `h-8 py-0`. Enforced by a Vitest test.
- **Shape:** `lg` radius border, `secondary/40` bg. Approve = `primary`/`primary-foreground` `h-8`; Deny
  = `border` outline `foreground` `h-8`. Resolved states remove buttons; "Approved ✓" in `success-text`,
  "Denied" in `muted-foreground`.
- **A11y (NFR-AW-A11Y-001/003):** container `aria-live="assertive"`; when `phase==='needs-approval'`,
  AssistantPanel renders a distinct `role="status" aria-live="polite"` "A write action awaits your
  decision" region; the composer textarea carries `aria-disabled` via `needsApproval`.
- **Per-chip state keyed by `pendingId` (Blocker-8):** `ChipStateMap = Record<string, ApprovalChipState>`
  keyed by `pendingId` — NOT a single global atom (a global corrupts earlier chips on sequential
  proposals). See `docs/decisions.md` OD-A3-CHIP.
