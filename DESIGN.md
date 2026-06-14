---
name: PMO Portal
description: The owner-approved RIS shadcn-style control surface — calm, dense, data-first.
colors:
  # --- Surfaces ---
  background: "hsl(0 0% 100%)"
  foreground: "hsl(240 10% 3.9%)"
  card: "hsl(0 0% 100%)"
  card-foreground: "hsl(240 10% 3.9%)"
  popover: "hsl(0 0% 100%)"
  popover-foreground: "hsl(240 10% 3.9%)"
  # --- Brand / action ---
  primary: "hsl(221.2 83.2% 53.3%)"
  primary-foreground: "hsl(0 0% 98%)"
  # --- Quiet UI ---
  secondary: "hsl(240 4.8% 95.9%)"
  secondary-foreground: "hsl(240 5.9% 10%)"
  muted: "hsl(240 4.8% 95.9%)"
  muted-foreground: "hsl(240 4% 40%)"  # darkened from 46.1%→40% L so muted text clears AA (≥4.5:1) on secondary fills, not just white
  accent: "hsl(240 4.8% 95.9%)"
  accent-foreground: "hsl(240 5.9% 10%)"
  # --- Status / semantic ---
  destructive: "hsl(0 84.2% 60.2%)"
  destructive-foreground: "hsl(0 0% 98%)"
  warning: "hsl(43 96% 56%)"
  warning-foreground: "hsl(22 78% 26%)"
  success: "hsl(142 71% 45%)"
  success-foreground: "hsl(0 0% 98%)"
  # --- Lines / fields / focus ---
  border: "hsl(240 5.9% 90%)"
  input: "hsl(240 5.9% 90%)"
  ring: "hsl(221.2 83.2% 53.3%)"
  # --- Categorical accent (KPI/avatar/timeline only; never primary action) ---
  violet: "hsl(262 83% 58%)"
typography:
  page-title:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  heading:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  subheading:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.3
  overline:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.06em"
  mono:
    fontFamily: "SF Mono, ui-monospace, JetBrains Mono, Menlo, monospace"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.4
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  full: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  button-outline-hover:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.foreground}"
  button-ghost:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  button-ghost-hover:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.foreground}"
  button-destructive:
    backgroundColor: "{colors.destructive}"
    textColor: "{colors.destructive-foreground}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.md}"
    padding: "16px"
  input:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "32px"
  badge-status:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.muted-foreground}"
    rounded: "{rounded.full}"
    padding: "0 9px"
    height: "22px"
  table-header-cell:
    backgroundColor: "{colors.card}"
    textColor: "{colors.muted-foreground}"
    padding: "0 12px"
    height: "38px"
  table-body-cell:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    padding: "12px"
    height: "54px"
  nav-item:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "36px"
  nav-item-active:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary}"
    rounded: "{rounded.sm}"
    height: "36px"
  kanban-card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "11px"
---

# Design System: PMO Portal

## 1. Overview

**Creative North Star: "The Quiet Control Surface."**

This is the existing, owner-approved RIS Portal look — a shadcn/Radix-derived, near-monochrome control surface — adopted wholesale as the PMO Portal's visual identity. It is **preserved, not reinvented.** The system was extracted verbatim from the RIS reference mockups (`sales-pipeline-reference.html`, `budget-reference.html`), both of which carry one identical token block ("Token System A", shadcn-vue HSL, light scheme). Every value below is reverse-engineered from those files; nothing here is a new brand, palette, or font.

The personality is **calm, dense, and data-first.** The surface is white-on-near-white: a single blue carries every interactive affordance against a field of warm-cool greys, so the eye goes straight to numbers, status, and the one action that matters. Density is deliberate — controls are compact (32px tall), but table rows breathe (54px) so financial figures are scannable. This is an operator's tool for a contract- and project-based business: the owner reviews budgets, procurement, and pipeline on desktop and phone, and the design optimizes for trust in the data over decoration. It explicitly rejects the "AI SaaS marketing" aesthetic: no dark-mode-with-purple-gradients, no neon, no glassmorphism panels, no oversized hero type, no shadow-heavy "floating card" soup.

**Key Characteristics:**
- One blue accent (`primary`, `hsl(221 83% 53%)`) does all the interactive work; everything else is neutral.
- Borders, not shadows, define structure. Shadows are a *response to state* (hover, focus, overlay), never decoration.
- Tight 8px-derived radius scale; `--radius: 0.5rem` (8px) is the spine, with `calc()` derivations for nested elements.
- Inter everywhere; tabular-nums for all money and metrics; SF Mono for IDs/codes only.
- Status is communicated by a small colored dot + tinted pill, not by loud fills.

> **Coherence Wave (2026-06-14):** the app's *atoms* (above) are shared and disciplined — the
> diagnosed "doesn't feel like the same app" problem is PATTERN/MOLECULE drift, not token drift. §7
> ("Coherence-Wave canonical molecules") is the enforced standard for how records, lists, steppers,
> status pills, and copy must behave so every module reads as one hand. Plan:
> `docs/plans/2026-06-14-coherence-wave.md`; diagnosis: `docs/reviews/2026-06-14-whole-app-coherence-audit.md`.

## 2. Colors

A near-monochrome system built on shadcn-vue's HSL roles. The hue spine is a cool neutral (`240`); the only saturated color in normal use is the primary blue. Status colors (destructive/warning/success) appear only on data state, and a single categorical violet is reserved for KPI/avatar/timeline accents — never as an action color. **Light scheme only** in the source; no dark `:root` block was present (see Open Questions).

### Primary
- **Action Blue** (`hsl(221.2 83.2% 53.3%)`): The one interactive color. Primary buttons, active nav item (at 10% tint + full-color text), selected rows (7% tint), focus ring, checkbox fill, links-in-context, the "current" step in steppers, sticky-tab indicators, and the toast accent stripe. Its foreground (`hsl(0 0% 98%)`, near-white) sits on solid blue. **Used sparingly** — see The One Blue Rule. **No status, severity, or category pill may use it** — see The Freed-Blue Status Rule.

### Secondary (categorical accent — not an action color)
- **Categorical Violet** (`hsl(262 83% 58%)`): Reserved for non-interactive categorization only: a KPI icon tile (`violet` variant), the user avatar gradient (blue→violet), and select timeline/legend dots. Never use it for buttons, links, or anything clickable.

### Tertiary (status semantics — data-driven only)
- **Destructive Red** (`hsl(0 84.2% 60.2%)`, fg `hsl(0 0% 98%)`): Errors, destructive buttons, "lost"/negative status, overdue/stale ages, negative deltas, notification dot. Tinted variants at ~10–12% for chips/icon tiles.
- **Warning Amber** (`hsl(43 96% 56%)`, fg `hsl(22 78% 26%)`): "Aging"/"overdue" warnings, mid-threshold bars, caution KPI tiles. Note the deep-brown foreground for AA text contrast on amber tints.
- **Success Green** (`hsl(142 71% 45%)`, fg `hsl(0 0% 98%)`): "Won"/positive status, completed steps, positive deltas, high-threshold bars, the "Live" pulse tag, success toasts.

### Neutral
- **Background** (`hsl(0 0% 100%)`, pure white): App background and header. Note the main scroll area uses `secondary` at 35% (`hsl(240 4.8% 95.9% / 0.35)`) to lift cards off the page.
- **Foreground** (`hsl(240 10% 3.9%)`, near-black): Primary text.
- **Card / Popover** (`hsl(0 0% 100%)`): Elevated surfaces (cards, table body, rail, popovers, toasts) — pure white against the tinted main area.
- **Secondary / Muted / Accent** (`hsl(240 4.8% 95.9%)`, light cool grey): These three share one value but differ in intent. `secondary` = quiet fills (segmented controls, count pills, progress tracks). `muted` pairs with `muted-foreground` (`hsl(240 3.8% 46.1%)`) for de-emphasized text (labels, captions, breadcrumb, sub-values). `accent` is the hover wash on interactive neutral surfaces (rail items, ghost buttons, row hover, control hover).
- **Border / Input** (`hsl(240 5.9% 90%)`): All hairline dividers, card outlines, and field strokes — one value. Table row dividers soften to 70% opacity.

### Named Rules
**The One Blue Rule.** The primary blue is the only saturated interactive color and should touch ≤10% of any screen. If two things on a screen are blue and only one is the main action, one of them is wrong. Categorical violet and status colors are NOT substitutes for it.

**The Freed-Blue Status Rule (Coherence Wave).** The action-blue is reserved for the one interactive affordance — **no status, severity, or category pill may use it.** Three independent pill families, each a single source-of-truth map in `src/lib/status/statusVariants.ts`, never sharing tints: **(A) Workflow status** — open/active/in-progress → `progress` (neutral grey; the distinct LABEL carries identity, so it is never color-only); needs-you → `warn`; done/won/approved → `won`; lost/rejected/cancelled → `lost`; closed/terminal → `neutral`. **(B) Severity/risk** — Low `neutral` · Medium/High `warn` · Critical `lost`. **(C) Categorical/type/activity** — `violet` for the highlighted kind + `neutral` for the rest. The StatusPill `open` (blue-tint) variant is **frozen out of status use** (kept defined only for the migration window). This corrects the DOM-measured collisions where Incidents "Medium"==="Open"===action-blue and Companies "Client"===action-blue.

**The Tinted-Status Rule.** Status is shown as a 6px colored dot plus a pill tinted at ~10–18% of the status hue with a darkened text variant — never a fully saturated solid fill behind body text. Solid status fills are reserved for the destructive *button* only.

**The Single-Border Rule.** `border` and `input` are the same value on purpose. Never introduce a second border color to "separate" regions; use the `secondary`/`card` surface contrast or spacing instead.

## 3. Typography

**Display / Body / UI Font:** Inter (with `system-ui, -apple-system, "Segoe UI", sans-serif` fallback).
**Mono Font:** SF Mono (with `ui-monospace, "JetBrains Mono", Menlo, monospace`) — IDs, codes, and the `⌘K` glyph only.

**Character:** One humanist-grotesque sans does all the talking. The voice is neutral and engineered, never expressive — Inter's tight `letterSpacing` at large sizes (`-0.02em` on titles) keeps headings crisp and compact. Base size is 14px with a 1.45 line-height; the app reads like a well-set spreadsheet, not a landing page. **`tabular-nums` (`font-variant-numeric: tabular-nums` + `font-feature-settings: "tnum"`) is mandatory on all money, percentages, counts, deltas, and metric values** so columns align and figures don't jitter on update.

### Hierarchy
- **Page Title** (700, 24px, lh 1.2, ls -0.02em): One per page, in `.page-head`. KPI values reuse ~23px/700 for the headline number.
- **Heading** (700, 20px, lh 1.25, ls -0.01em): Section/card titles, kanban column titles (~13.5px/700 in compact contexts).
- **Subheading** (600, 18px, lh 1.3): Sub-section headers inside detail panels.
- **Body** (400, 14px, lh 1.45): Default text. Controls and table cells run 13.5px; the base run is 14px.
- **Label** (600, 12px, lh 1.3): Status pills, badge counts, dense metadata, button text at small sizes.
- **Overline** (600, 11px, lh 1.3, ls 0.06em, UPPERCASE): Rail group labels and table column headers (`thead th` at 11.5px). The uppercase + tracked treatment is the system's section-divider voice.
- **Mono** (500, 13px): Project codes / IDs (`.pc-id`), keyboard hints (`.kbd`, `⌘K`). Never for prose or numbers-in-tables (those use tabular Inter).

### Named Rules
**The Tabular-Numbers Rule.** Every figure that can change or be compared (currency, %, counts, deltas, ages) is `tabular-nums`. Non-negotiable in tables, KPIs, kanban totals, and funnel values.

**The Mono-For-Identifiers Rule.** SF Mono appears only on machine identifiers (deal/project codes) and keyboard chips. Money is Inter-tabular, not mono.

## 4. Elevation

This is a **borders-first, flat-by-default** system. Depth is conveyed primarily by 1px borders and surface-tone contrast (white `card` floating on the `secondary`/35% main area), not by shadow. Shadows are small, low-opacity, and almost always a *response to state* — a card lifts ~`0 2px 10px` on hover, a primary button carries a faint `0 1px 2px` brand-tinted shadow, segmented "on" states get a `0 1px 2px` lift to read as pressed. Only true overlays (popover menus, toasts, tooltips) carry a real drop shadow, because they genuinely float above the page. All shadow colors are a desaturated near-black (`hsl(240 6–10% ~8% / low-alpha)`), never pure black.

### Shadow Vocabulary
- **State lift** (`box-shadow: 0 2px 10px hsl(240 6% 10% / 0.06)`): Card / KPI tile on hover.
- **Pressed/selected lift** (`box-shadow: 0 1px 2px hsl(240 6% 10% / 0.10–0.14)`): Active segment in a segmented control; the live-layout switcher's selected pane button.
- **Brand button shadow** (`box-shadow: 0 1px 2px hsl(var(--primary) / 0.25)`): Primary button at rest — a faint tinted seat.
- **Kanban card hover** (`box-shadow: 0 4px 14px hsl(240 6% 10% / 0.10)`): Slightly deeper than KPI hover; cards are draggable, so they lift more.
- **Overlay** (`box-shadow: 0 10px 30px hsl(240 10% 8% / 0.16), 0 2px 6px hsl(240 10% 8% / 0.08)`): Popover row-menu. Toasts/tooltips use a single `0 10px 30px … / 0.16` (tooltip darker, `0 8px 24px hsl(240 10% 4% / 0.4)` on its dark surface).

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest, defined by their border and tone. A shadow appears only as a response to state (hover, pressed, focus) or because the element genuinely floats (popover, toast, tooltip). If a static card has a drop shadow, it is wrong — give it a border instead.

**The No-Pure-Black-Shadow Rule.** Shadow color is always desaturated near-black at low alpha (`hsl(240 …% ~8–10% / 0.04–0.16)`). Never `rgba(0,0,0,…)` at high opacity — that reads as a 2014 app.

## 5. Components

All interactive controls are **32px tall** ("h-8") with `md` (8px) radius unless noted; data table rows are deliberately roomier at 54px. Nested radii use `calc(var(--radius) - 2px/3px)` so inner corners sit inside outer ones.

### Buttons
- **Shape:** 8px radius (`{rounded.md}`), 32px tall, `0 12px` padding, 7px gap to a 15px icon. Small variant (`btn-sm`): 28px tall, 13px text. Icon-only: 32px square.
- **Primary:** `primary` bg, `primary-foreground` text, faint brand shadow at rest. Hover → `primary` at 90% (`hsl(var(--primary) / 0.9)`).
- **Outline:** `background` fill, `input` border, `foreground` text. Hover → `accent` wash.
- **Ghost:** transparent, `foreground` text. Hover → `accent` wash. Used for icon buttons in the header.
- **Destructive:** `destructive` bg, `destructive-foreground` text. Hover → 90%. The only solid status fill in the system; reserved for irreversible actions (Mark lost, Delete).
- **Focus:** global `:focus-visible` ring — `outline: 2px solid {colors.ring}; outline-offset: 2px`.
- **Disabled (gap — see Open Questions):** not defined in source; proposed `opacity: 0.5; cursor: not-allowed; pointer-events: none`.

### Badges / Status Pills
- **Status pill:** 22px tall, full radius, 12px/600 label, with a leading 6px colored `dot`. Background = status hue at ~10–18%, text = a darkened variant of the hue for AA contrast (applied via the named CSS token — see below). Variants observed: `open` (blue), `won` (green), `lost` (red), `overdue` (amber). Default/neutral badge uses `secondary` bg + `muted-foreground` text. **Per the Freed-Blue Status Rule (§2), no status/severity/category pill may use the `open` (blue) variant — it is frozen for status; map "open/active" to `progress` (neutral).**
- **Count badge** (nav rail / kanban): `secondary` bg + `muted-foreground` text, full radius; active nav item flips to `primary/15%` bg + `primary` text. Kanban column count adds a 1px border on `background`.

#### Status-pill text tokens (Wave-6 H3 — named source of truth in `index.css` `:root`)
The darkened-AA text values for the four non-neutral pill variants are defined as named CSS custom properties. The `StatusPill` component applies them as `hsl(var(--token))` inline styles — the token IS the applied value.

| Token | HSL value | Pill variant | Contrast (on white) |
|---|---|---|---|
| `--status-open-text` | `221 75% 38%` | `open` (blue) | ≥4.5:1 AA |
| `--status-won-text` | `142 64% 30%` | `won` (green) | ≥4.5:1 AA |
| `--status-lost-text` | `0 72% 45%` | `lost` (red) | ≥4.5:1 AA |
| `--status-violet-text` | `262 60% 42%` | `violet` | 7.4:1 AA |

### Cards / Containers
- **Corner Style:** 8px radius (`{rounded.md}`). When a card sits directly above a toolbar+table assembly, top corners are rounded and the seam is squared (`var(--radius) var(--radius) 0 0`).
- **Background:** `card` (white) on the `secondary/35%` main area; the contrast is what makes it read as elevated.
- **Border:** always a 1px `border`. This is the primary depth cue.
- **Shadow:** none at rest; `state lift` on hover for interactive cards (KPI, kanban).
- **Internal Padding:** 16px standard (`{spacing.4}`); compact cards (kanban) use ~11px.
- **The KPI Tile** (signature): white card, 16px padding, with a top row of [30px tinted icon tile] + [label, `muted-foreground` 12.5px] + [help `?`], a 23px/700 tabular value, and a foot row with a tinted delta chip (`up` green / `down` red / `neutral` grey) plus a `muted` "vs." comparison. Negative values turn `destructive`. **ONE treatment app-wide** (`KPITile`); per-role dashboards vary *which* tiles, never *how* a tile looks. The in-header metric strip is `StatTiles` — one chrome for every record header (no boxed-vs-borderless fork).

### Inputs / Fields
- **Style:** `background` fill, 1px `input` border, 8px radius, 32px tall, `0 10px` padding. Placeholder = `muted-foreground`. The search-mini and the header `cmdk` are the canonical field shells; inner `<input>` is borderless/transparent and inherits the font.
- **Focus:** `:focus-visible` ring (`2px {colors.ring}`, 2px offset). The `cmdk` also shifts its border on hover (`muted-foreground/50%`).
- **Checkbox:** 16px, 1.5px `input` border, 4px radius; checked → `primary` fill + `primary` border + white check. Exposed with `role="checkbox"` + `aria-checked` + `tabindex`.
- **Error / Disabled (gap — see Open Questions):** no error-state field styling in source. Proposed: error border = `destructive`, helper text = `destructive`; disabled = `secondary` bg + `muted-foreground` text + `not-allowed`.
- **Validation contract (Coherence Wave):** `EntityFormModal`/`useEntityForm` validate **on blur / on submit**, never on mount — no eager "Fix N fields" banner on an untouched form. ONE submit-state rule across every modal (do not mix disabled-until-valid with allow-and-error).

### Data Table (signature)
- **Header cells:** sticky, `card` bg, 38px tall, Overline type (11.5px/600 uppercase, 0.03em, `muted-foreground`), bottom `border`. Sortable headers gain `foreground` on hover with a 12px sort glyph. Numeric columns right-align; selection/center columns center.
- **Body cells:** 54px tall ("roomy rows — breathe"), 12px padding, divider = `border/70%`. Row hover → `accent/60%`; selected → `primary/7%`; expanded → `accent/50%`. Row `⋯` menu button is hidden until row hover.
- **In-cell patterns:** project cell (28px colored icon + 2-line name/code, code in mono); money (`tabular`, sub-values `muted`); win-% bar (track `secondary`, fill `success`/`warning`/`destructive` by threshold); age chip (turns `warning-foreground`/`destructive` when aging/stale).
- **Footer:** totals row, `secondary/40%` bg, 1.5px top border, `tabular` values; count in `muted`.
- **Toolbar / Action bar:** `card` bg seamed to the table top (`… … 0 0`), 10–12px padding, holds `control` chips (32px, `input` border, `muted` icon, chevron), a `seg` segmented filter (`secondary` track, "on" = white pill + lift), a `search-mini`, and trailing icon controls. Selection mode swaps the default controls for a bulk-action cluster on a `primary/6%` wash with a count `pill`. **The list toolbar slot order is fixed by the `ListPage` shell (§7) — view-switcher · status filters · Search · Filter · Export · Import — identical on every list, empty slots held in place.**

### Kanban Card (signature)
- White `card`, 8px radius, ~11px padding, faint `0 1px 2px` rest shadow. Hover → `0 4px 14px` lift + `muted-foreground/35%` border; active → `scale(.992)`; selected → `primary` border + `primary` ring + `primary/4%` fill; a drag grip fades in on hover. Holds a 26px colored icon, name (13px/600) + customer (`muted`), a 15px/700 tabular value, a win-% chip, and a foot row (border-top `border/70%`) with age + owner avatar + mini status pill. Columns sit in a horizontal-scroll grid of `minmax(290px, 1fr)` tracks on a `secondary/50%` column body with a sticky blurred header. **ONE `ProjectCard` (size variants `kanban`/`grid`) + ONE `KanbanBoard` engine drive every board (Projects + Sales) — they are one entity, so they share one card.**

### Lifecycle / Stage Stepper (signature) — ONE stepper only
- **The canonical stepper is the even-flex BAR stepper.** A horizontal "journey" tracker: equal-flex steps each with a 6px rounded `jbar` (track = `secondary`), a label, and a date. `done` step → bar `success`, label `foreground`/600; `current` step → bar `primary`, label `foreground`/600; `paid` → `success`. Used for the budget-version lifecycle, the project stage journey, AND the procurement PR→VQ→PO→GR→VI→Paid lifecycle. The macro funnel/stage-summary band is the list-level analog: connected `card` segments with conversion-arrow chips between them; selected stage gets `primary/6%` + an inset `primary` bottom rule.
- **Retired (Coherence Wave):** the numbered-circle `node` stepper variant (`LifecycleStepper variant="node"`) is **removed** — there is exactly ONE stepper appearance app-wide. The `inline` pip variant (9px dots in table rows) remains as the compact in-row form of the same stepper.

### Navigation
- **Rail (sidebar):** 224px (`--rail-w`), `card` bg, right `border`. Brand block (56px, matches header) with a 28px `primary` logo square. Grouped items under Overline group labels. **Nav item:** 36px tall, `sm`-derived radius (`calc(var(--radius) - 2px)`), 13.5px/500, 17px stroke-2 icon, optional trailing count badge. Hover → `accent`; active → `primary/10%` bg + `primary` text + 600 weight + `aria-current="page"`. Foot section (border-top) holds Settings.
- **Top bar (header):** 56px (`--header-h`), `background` bg, bottom `border`. Holds the mobile menu button, a breadcrumb (`muted` links → `foreground` on hover, `>` separators, bold `current`), a flexible spacer, the `cmdk` search button (`⌘K` chip), an icon button with a `destructive` notification dot, and a user chip (avatar gradient blue→violet + name/role, hidden on phone).
- **Mobile:** below 920px the rail collapses (`--rail-w: 0`) and a hamburger appears; `cmdk` shrinks to an icon; user name/role hide.
- **DataTable reflow (OD-W4-4):** the DataTable **single-renders** — at `md` (768 px) it renders the `<table>`; below `md` it renders a stacked card list instead. Exactly ONE branch is in the DOM at a time (chosen by `useIsDesktop()` reading `(min-width: 768px)` synchronously at first paint, so no flash of the wrong branch on mobile). These are two separate breakpoints — 920 px for the rail collapse, 768 px for the table→card reflow. Card anatomy: first column = title/activation button, remaining columns = `<dl>` label:value grid. Because only one branch renders, each cell appears once in the AT tree — **no `aria-hidden` on either branch** (the unrendered branch is simply absent). Touch targets on card affordances extend to ≥44 px via `.touch-target`.

### Tabs / Segmented Controls
- **Inline segmented (`seg`):** 32px track on `secondary`, buttons 28px, "on" = white `background` pill + `foreground` + 600 + `0 1px 2px` lift. `role="tablist"`/`role="tab"`/`aria-selected`. Used for stage filters.
- **Large segmented (layout switcher):** 40px sticky bar (`abc-seg`), 34px buttons with a letter chip; "on" → white pill + lift, letter chip flips to `primary`. Sticky with a `backdrop-filter` blur over the `secondary/35%` page.

### Overlays
- **Popover menu (`#rowmenu`):** `popover` bg, `border`, 8px radius, overlay shadow, 5px padding; 32px menu items, `accent` hover, `danger` items in `destructive`, hairline `menu-sep`.
- **Toast:** `popover` bg, `border` + 3px left accent stripe (`primary`, or `success` for ok), overlay shadow, bottom-right, slide-in. 
- **Tooltip (`#tip`):** dark surface (`hsl(240 10% 8%)`), near-white text, 7px radius, `0 8px 24px / 0.4` shadow, max 280px; bold title with optional dot, `tabular` key/value rows.

## 6. Do's and Don'ts

### Do:
- **Do** drive every interactive affordance with the one `primary` blue, and keep it under ~10% of any screen (The One Blue Rule).
- **Do** define structure with the single 1px `border` (`hsl(240 5.9% 90%)`) and surface-tone contrast (white `card` on `secondary/35%` main), not with shadows.
- **Do** apply `tabular-nums` to every figure — currency, %, counts, deltas, ages — in tables, KPIs, kanban, and funnels.
- **Do** show status as a 6px dot + a tinted pill (status hue ~10–18% bg, darkened text), and reserve solid fills for the `destructive` button only.
- **Do** keep controls at 32px ("h-8") and table body rows roomy at 54px; use the 8px radius spine with `calc()` derivations for nested corners.
- **Do** use SF Mono only for machine IDs/codes and the `⌘K` chip; everything else is Inter.
- **Do** expose the global `:focus-visible` ring (`2px solid {colors.ring}`, 2px offset) on every focusable element, and keep `role`/`aria-selected`/`aria-checked`/`aria-current` on tabs, checkboxes, and nav.
- **Do** reserve categorical violet and the status hues for non-interactive meaning (KPI tiles, avatars, timeline dots, data state) — never as action colors.
- **Do** route every status/severity/category pill through `src/lib/status/statusVariants.ts` (the three-family registry), never an inline per-module map (The Freed-Blue Status Rule).
- **Do** open every primary entity as a routable `/x/:id` page with breadcrumb + Back + ⌘K indexing; drawers are previews only (The Record-Open Rule, §7).

### Don't:
- **Don't** ship the "AI SaaS marketing" aesthetic: no dark-mode-with-purple-gradients, no neon accents, no glassmorphism panels, no oversized hero type, no shadow-heavy floating-card soup.
- **Don't** put a drop shadow on a static card. If it isn't hovering, pressed, focused, or a true overlay, it gets a border instead (The Flat-By-Default Rule).
- **Don't** use `rgba(0,0,0,…)` at high opacity for shadows; shadow color is desaturated near-black at low alpha only.
- **Don't** introduce a second brand color, a new font, or a new border color. The palette is one blue + neutrals + status; the border is one value.
- **Don't** use mono or proportional figures for money in tables — money is Inter-`tabular`, IDs are mono.
- **Don't** color body text with a fully saturated status hue, or fill a status pill solid — use the tint + darkened-text pattern.
- **Don't** make interactive controls taller/shorter than 32px or invent radii outside the 4/6/8/10/999 scale.
- **Don't** assign the action-blue (`open` variant) to any status, severity, or category pill (The Freed-Blue Status Rule).
- **Don't** build a record as a URL-less drawer, leave a list row inert (a dead-end), or build a second stepper / KPI-tile / project-card / list-toolbar grammar — reuse the §7 molecule.
- **Don't** invent a per-feature create verb. Use **"New &lt;Entity&gt;"**; keep a domain verb ("Raise request", "File incident") only where the domain uses it, and make button + modal title + submit all say the same phrase.

---

## 7. Coherence-Wave canonical molecules (enforced standard)

The visual atoms (§2–§6) are shared; this section governs the **molecules** so every module behaves
by one rulebook. Build plan + per-phase migration order: `docs/plans/2026-06-14-coherence-wave.md`.

### Terminology + create-verb
- **Canonical noun = "Project"** in all UI copy. "Deal" and "opportunity" are removed. "Pipeline" is a
  valid *stage-group* label (breadcrumb, the Sales index page title) — a stage, not a second noun.
- **Create-verb scheme = "New &lt;Entity&gt;"** (New project / New company / New contact / New user).
  Domain verbs ("Raise request", "File incident") are kept only where the domain genuinely uses them,
  and then the **button text, modal title, and submit label must all be identical**.

### RecordHeader (the one record-page header)
- Anatomy (non-optional): **[icon tile] [name] [status pill] … [Edit] [Archive/Delete by permission]**,
  actions top-right. Optional `meta` row + `StatTiles` metric strip below. Implemented as a thin
  wrapper over `PageHeader` (`src/components/ui/PageHeader.tsx`); the Project detail header is the
  template. Every record page (Project, Procurement, Company, Contact, Incident) uses it — icon
  presence, status presence, and top-right action placement are mandatory.

### Record-open paradigm (The Record-Open Rule)
- **Every primary entity is a routable `/x/:id` page** with breadcrumb + Back + ⌘K indexing. Drawers
  are demoted to optional *quick-peek previews* that carry a URL + an "Open full record" link — never
  the only home. Company, Contact, and Incident move drawer/dead-end → real pages; ⌘K indexes them.
- **Stage-aware project lens (ADR-0020 single record):** the one `/projects/:id` shows a **pipeline
  lens** pre-win (Value / Win probability / Weighted; no S-curve or delivery stepper) and a **delivery
  lens** post-win (Contract/Committed/Actual strip, S-curve, milestone stepper, delivery tabs). Tab/
  body visibility is driven by `projectStatusGroup` — never render the wrong shell for the stage. The
  URL is role-invariant (role tailors entry-point CTAs, not the default tab).

### RecordActionZone (the record-action contract)
- The advance/approve verbs (Advance / Mark won / Approve / Reject) live in ONE consistently-placed,
  **never-below-the-fold** zone (sticky on desktop, fixed action bar on mobile), above the green
  "Ready to advance" banner. Edit/Archive live in the header; advance verbs live here — one rule for
  every record. No advance action buried at page-bottom.

### ListPage shell
- Fixed grammar: **[title + count] … [primary "New &lt;Entity&gt;"]**, then a toolbar in fixed slot
  order **view-switcher · status filters · Search · Filter · Export · Import** (empty slots held in
  place, no reflow). ONE named view-switcher (`ViewToggle`) with the shared label set **`Table /
  Board / Calendar / Cards`** and a per-entity default. "By-stage Board" and "Kanban" both become
  **Board**. The view-switcher renders right-aligned (icon segmented); status **filters** render left
  as text chips — visually distinct so the two strips are never confused. Master-data lists get Export
  **and** Import; the slot order is identical everywhere.
- **Implemented** as `ListPage` (`src/components/ui/ListPage.tsx`, CW-5). Named slots
  `title / description / count / primaryAction` (header row) + `banner / filters / search /
  secondaryFilter / exportAction / importAction / view` (the toolbar). The view-switcher is the
  *last* DOM node but carries `ml-auto`, so it sits hard-right while filters/search/Export lead at
  the left — the documented right-aligned view, left-aligned filters arrangement. Every list page
  (`Companies / Contacts / Incidents / Procurement / Projects / Pipeline`) renders on it; per-page
  columns/filters/views are passed as slots — the shell is shared, the content is per-page.

### Approvals (one inbox)
- `/approvals` is the single canonical inbox for ALL approval types, with per-module deep-link tabs
  (filtered views INTO the one inbox), one `ApprovalRow` pattern, and one decision affordance (inline
  Approve/Return + an "Open" link). The Timesheets "Approvals queue" tab and the Procurement
  "Needs approval" filter are deep-links, not parallel implementations. Rail label + page H1 = "Approvals".

---

## How to use these tokens (implementers)

The source ships these as **shadcn-vue HSL custom properties on `:root`**, consumed via `hsl(var(--token))` and `hsl(var(--token) / <alpha>)`. Preserve that pipeline in the React/Tailwind app:

1. **Define `:root` HSL triplets** (the bare `H S% L%` form, no `hsl()` wrapper) for every color token above, plus `--radius: 0.5rem`, `--rail-w: 224px`, `--header-h: 56px`. The frontmatter lists them pre-wrapped in `hsl()` for Stitch's hex-ish validator; the canonical runtime form is the bare triplet so alpha (`/ 0.1`) works.
2. **Map Tailwind theme** to the vars. This app is **Tailwind v4**, so map them in a CSS `@theme inline` block where each `--color-*` value is a **resolvable** color — `@theme inline { --color-background: hsl(var(--background)); --color-primary: hsl(var(--primary)); --color-primary-foreground: hsl(var(--primary-foreground)); … }` — and `--radius-lg: var(--radius); --radius-md: calc(var(--radius) - 2px); --radius-sm: calc(var(--radius) - 4px)`. **Do NOT append the v3 `/ <alpha-value>` placeholder** — v4 does not substitute it, so it emits invalid CSS the browser discards and every token utility silently renders nothing. The bare-triplet `:root` form (point 1) is what makes this work: v4 generates the `/<alpha>` modifier (`bg-primary/10`, `border-border/70`) automatically via `color-mix()` from the bare color. Add `warning`/`warning-foreground`, `success`/`success-foreground`, and the categorical `violet` — these are RIS additions beyond stock shadcn.
3. **Alpha tints** (`primary/10%`, `success/12%`, `border/70%`, etc.) come straight from the slash-alpha syntax — keep them; they are load-bearing for the tinted-status and hover-wash patterns.
4. **Numbers:** add a `tabular`/`tnum` utility (`font-variant-numeric: tabular-nums; font-feature-settings: "tnum"`) and apply it to every metric.
5. **Focus:** keep the global `*:focus-visible { outline: 2px solid hsl(var(--ring)); outline-offset: 2px }` rather than per-component focus styles.
6. **Charts (recharts):** theme series/axes/grid from these tokens — axis/grid in `border`/`muted-foreground`, primary series in `primary`, status series in success/warning/destructive, categorical in violet. (No chart tokens existed in the mockups; derive from the palette, do not invent new chart colors.)

---

## Accessibility posture

- **Contrast:** `foreground` on `background`/`card` is ~AAA. `muted-foreground` (`46.1%` L) on white clears AA for body/secondary text. Status pills use **darkened text variants** (e.g. won text `hsl(142 64% 30%)`, lost `hsl(0 72% 45%)`, amber's deep-brown `warning-foreground`) specifically to clear AA on their light tinted backgrounds — preserve those darker text values; do not substitute the base status hue as pill text.
- **Focus:** single source of truth — global `:focus-visible` = `2px solid {colors.ring}` (the primary blue) at 2px offset. Every focusable element inherits it.
- **Semantics in source:** `aria-current="page"` on active nav, `role="tablist"/"tab"/"aria-selected"` on segmented filters and the layout switcher, `role="checkbox"/"aria-checked"/tabindex` on custom checkboxes, `aria-label` on icon-only buttons and section landmarks (`aria-label="Pipeline summary"`). Keep these; they are part of the system.
- **Keyboard:** tab order follows DOM (rail → header → main); custom checkboxes are `tabindex="0"`. Overlays (popover/toast/tooltip) are non-focus-trapping in the mockup — real implementations must add focus management and `Esc`-to-close (a build-time gap, not a token gap).
- **Coherence-Wave a11y invariants:** every new record page (Company/Contact/Incident) carries a focus-managed page heading + breadcrumb + Back; the `RecordActionZone` keeps the primary action in the keyboard path and above the fold; status pills stay dot+label (never color-only) so the freed-blue→neutral remap never relies on color alone.
