---
name: PMO Portal
description: >
  A cool-neutral operator workspace with clear canvas and work-surface roles,
  indigo actions, differentiated status colors, and a first-class dark theme.
  The reference design system is the visual target; WCAG AA, accessibility,
  Inter, and PMO's existing icon family take precedence.
colors:
  background: "hsl(210 40% 96.0784%)"
  surface-canvas: "hsl(210 40% 96.0784%)"
  foreground: "hsl(218.1818 12.3596% 17.451%)"
  card: "hsl(0 0% 100%)"
  surface-panel: "hsl(0 0% 100%)"
  panel-border: "hsl(217.5 13% 57%)"
  surface-table-head: "hsl(210 40% 96.0784%)"
  card-foreground: "hsl(218.1818 12.3596% 17.451%)"
  popover: "hsl(0 0% 100%)"
  popover-foreground: "hsl(218.1818 12.3596% 17.451%)"
  secondary: "hsl(220 11.1111% 94.7059%)"
  secondary-foreground: "hsl(216 11.6279% 33.7255%)"
  muted: "hsl(210 14.2857% 97.2549%)"
  muted-foreground: "hsl(216 12% 22%)"
  accent: "hsl(210 14.2857% 97.2549%)"
  accent-foreground: "hsl(218.1818 12.3596% 17.451%)"
  count-foreground: "hsl(216 11.6279% 33.7255%)"
  primary: "hsl(230.8966 67.4419% 57.8431%)"
  primary-foreground: "hsl(0 0% 100%)"
  primary-text: "hsl(230.8966 67.4419% 57.8431%)"
  nav-active-text: "hsl(230.8065 49.2063% 49.4118%)"
  ring: "hsl(230.8929 68.2927% 67.8431%)"
  border: "hsl(217.5 12.9032% 87.8431%)"
  input: "hsl(217.5 13.1148% 52.1569%)"
  success: "hsl(155.1923 65% 31.3725%)"
  success-text: "hsl(154.4828 64.4444% 26.4706%)"
  success-foreground: "hsl(0 0% 100%)"
  warning: "hsl(25.0286 87.0647% 39.4118%)"
  warning-foreground: "hsl(25.2 87.2093% 33.7255%)"
  warning-icon: "hsl(25.0286 87.0647% 39.4118%)"
  destructive: "hsl(3.8028 57.2581% 48.6275%)"
  destructive-solid: "hsl(3.8028 57.2581% 48.6275%)"
  destructive-text: "hsl(3.9024 57.7465% 41.7647%)"
  destructive-foreground: "hsl(0 0% 100%)"
  status-open-text: "hsl(230.8065 49.2063% 49.4118%)"
  status-won-text: "hsl(154.4828 64.4444% 26.4706%)"
  status-lost-text: "hsl(3.9024 57.7465% 41.7647%)"
  status-violet-text: "hsl(250.7692 32.5% 47.0588%)"
  violet: "hsl(250.5495 39.738% 55.098%)"
  scrim-alpha: "0.8"
  status-neutral-surface: "hsl(220 11.1111% 94.7059%)"
  status-success-surface: "hsl(154.2857 36.8421% 96.2745%)"
  status-warning-surface: "hsl(46.875 88.8889% 92.9412%)"
  status-danger-surface: "hsl(4 71.4286% 95.8824%)"
  status-violet-surface: "hsl(250.9091 64.7059% 96.6667%)"
  chart-1: "hsl(217.2067 81.7352% 57.0588%)"
  chart-2: "hsl(173.617 80.5714% 34.3137%)"
  chart-3: "hsl(250.0935 59.7765% 64.902%)"
  chart-4: "hsl(25.1887 86.8852% 47.8431%)"
  chart-5: "hsl(217.5 13.1148% 52.1569%)"
  chart-6: "hsl(4 73.991% 56.2745%)"
  chart-7: "hsl(83.913 80.2326% 33.7255%)"
  chart-8: "hsl(292.2581 68.8889% 55.8824%)"
typography:
  fontFamily: "Inter, system-ui, -apple-system, Segoe UI, sans-serif"
  page-title: { size: "24px", weight: 600, lineHeight: 1.34 }
  heading: { size: "20px", weight: 600, lineHeight: 1.43 }
  group: { size: "16px", weight: 600, lineHeight: 1.5 }
  control: { size: "14px", weight: 400, lineHeight: 1.43 }
  supporting: { size: "12px", weight: 400, lineHeight: 1.34 }
  micro: { size: "10px", weight: 400, lineHeight: 1.2, use: "nonessential metadata only" }
  metric: { size: "24px", weight: 600, lineHeight: 1.34, numeric: "tabular" }
  mono: "Tailwind v4 font-mono stack — identifiers only"
rounded:
  sm: "4px"
  control: "6px"
  lg: "8px"
  overlay: "6px"
  full: "999px"
spacing:
  base: "4px"
  page-gutter: "24px desktop / 16px phone"
  section-inset: "24px where a group needs an inset"
  content-inset: "16px"
  panel-inset: "24px desktop / 16px phone"
  panel-gap: "24px desktop / 16px phone"
  group: "16px"
  section: "32px"
motion:
  ds-ease: "120ms cubic-bezier(0.16, 1, 0.3, 1)"
elevation:
  xs: "0 2px 4px 0 + 0 0 2px 0"
  sm: "0 10px 15px -3px + 0 4px 6px -2px"
  lg: "0 25px 30px -10px + 0 15px 15px -10px"
  overlay: "none by default"
components:
  button-primary: { bg: "{colors.primary}", text: "{colors.primary-foreground}", radius: "{rounded.control}", height: "38px" }
  button-outline: { bg: "{colors.background}", text: "{colors.foreground}", border: "{colors.input}", radius: "{rounded.control}", height: "38px" }
  button-ghost: { bg: "transparent", text: "{colors.foreground}", radius: "{rounded.control}", height: "38px" }
  button-destructive: { bg: "{colors.destructive-solid}", text: "{colors.destructive-foreground}", radius: "{rounded.control}", height: "38px" }
  card: { bg: "{colors.surface-panel}", text: "{colors.card-foreground}", border: "{colors.panel-border}", radius: "{rounded.lg}", padding: "{spacing.panel-inset}" }
  input: { bg: "{colors.background}", text: "{colors.foreground}", border: "{colors.input}", radius: "{rounded.control}", height: "38px" }
  badge-status: { bg: "{colors.status-neutral-surface}", text: "{colors.count-foreground}", radius: "{rounded.full}", height: "20px" }
  table-head: { bg: "{colors.surface-table-head}", height: "52px", inset: "16px" }
  table-row: { min-height: "52px" }
  drawer: { width: "448px", body-inset: "16px" }
---
# Design System: PMO Portal

This file defines shared color, type, shape, elevation, and component tokens. The reference design system is the visual target. WCAG AA contrast, accessible interaction, the self-hosted Inter font, and PMO's existing icon family take precedence whenever they conflict. Composition remains governed by owner-approved rendered screens.

## 1. Overview

The visual language separates a cool slate workspace from elevated work surfaces. Indigo identifies actions and navigation; distinct status pairs communicate state; chart channels stay categorical. Inter remains the single UI face, figures use tabular numerals, and the PMO icon set remains unchanged. Both light and dark themes are first-class.

## 2. Colors — light | dark token tables

Colors use bare HSL triplets so Tailwind slash-alpha utilities continue to work. Light is the default; `.dark` redeclares every theme-dependent role. Values are canonical in `pmo-portal/index.css`.

### Surfaces and text
| Token | Light | Dark | Role |
|---|---|---|---|
| `--background` | `210 40% 96.0784%` | `205.7143 13.7255% 10%` | workspace canvas |
| `--surface-canvas` | `var(--background)` | `var(--background)` | main content canvas |
| `--foreground` | `218.1818 12.3596% 17.451%` | `211.2 20.6612% 76.2745%` | default text |
| `--card` / `--popover` | `0 0% 100%` | `210 12.1212% 12.9412%` | work surfaces |
| `--surface-panel` | `var(--card)` | `var(--card)` | framed panel surface |
| `--panel-border` | `217.5 13% 57%` | `210 10% 42%` | panel boundary, ≥3:1 against canvas |
| `--surface-table-head` | `var(--background)` | `var(--background)` | table header follows the canvas |
| `--card-foreground` / `--popover-foreground` | `218.1818 12.3596% 17.451%` | `211.2 20.6612% 76.2745%` | text on work surfaces |
| `--secondary` | `220 11.1111% 94.7059%` | `210 13.7255% 20%` | quiet surface |
| `--secondary-foreground` | `216 11.6279% 33.7255%` | `211.0345 17.7914% 68.0392%` | stronger text on secondary |
| `--muted` | `210 14.2857% 97.2549%` | `206.6667 11.6883% 15.098%` | subdued surface |
| `--muted-foreground` | `216 12% 22%` | `211.0345 17.7914% 68.0392%` | supporting text and 55% neutral chart series; strengthened for AA |
| `--accent` | `210 14.2857% 97.2549%` | `207.2727 12.0879% 17.8431%` | hover wash |
| `--accent-foreground` | `218.1818 12.3596% 17.451%` | `211.2 20.6612% 76.2745%` | text on accent |
| `--count-foreground` | `216 11.6279% 33.7255%` | `211.0345 17.7914% 68.0392%` | neutral counts and quiet labels |

### Action, focus, and navigation
| Token | Light | Dark | Role |
|---|---|---|---|
| `--primary` / `--primary-text` | `230.8966 67.4419% 57.8431%` | `231.25 68.5714% 72.549%` | indigo action and links |
| `--primary-foreground` | `0 0% 100%` | `210 12.1212% 12.9412%` | text on primary action |
| `--primary-hover` | `230.8065 49.2063% 49.4118%` | `231.5493 68.932% 79.8039%` | hovered primary action |
| `--primary-pressed` | `230.5714 49.2958% 27.8431%` | `230.9091 67.3469% 90.3922%` | pressed primary action |
| `--ring` | `230.8929 68.2927% 67.8431%` | `231.5493 68.932% 79.8039%` | focus indicator |
| `--nav-surface` | `214.2857 41.1765% 93.3333%` | `210 12.1212% 12.9412%` | navigation surface |
| `--nav-selected-surface` | `230.9091 67.3469% 90.3922%` | `230.5714 49.2958% 27.8431%` | selected navigation item |
| `--nav-active-text` | `230.8065 49.2063% 49.4118%` | `231.5493 68.932% 79.8039%` | active navigation text, AA on selection |

### Status and feedback
| Token | Light | Dark | Role |
|---|---|---|---|
| `--success` | `155.1923 65% 31.3725%` | `154.8649 39.7849% 63.5294%` | success indicator/fill |
| `--success-foreground` | `0 0% 100%` | `210 12.1212% 12.9412%` | text on success fill |
| `--success-text` / `--status-won-text` | `154.4828 64.4444% 26.4706%` | `154.8 39.6825% 75.2941%` | success text |
| `--warning` | `25.0286 87.0647% 39.4118%` | `46.2069 89.6907% 61.9608%` | warning marker/fill; light amber darkened for 3:1 |
| `--warning-foreground` | `25.2 87.2093% 33.7255%` | `46.2069 89.6907% 61.9608%` | warning text on status surface |
| `--warning-icon` | `25.0286 87.0647% 39.4118%` | `46.2069 89.6907% 61.9608%` | warning icon/marker |
| `--destructive` / `--destructive-solid` | `3.8028 57.2581% 48.6275%` | `4 74.0741% 68.2353%` | error and destructive fill |
| `--destructive-foreground` | `0 0% 100%` | `210 12.1212% 12.9412%` | text on destructive fill |
| `--destructive-text` / `--status-lost-text` | `3.9024 57.7465% 41.7647%` | `3.4483 74.359% 77.0588%` | error/status text |
| `--status-open-text` | `230.8065 49.2063% 49.4118%` | `231.5493 68.932% 79.8039%` | open status text |
| `--status-violet-text` | `250.7692 32.5% 47.0588%` | `249.8361 60.396% 80.1961%` | violet status text |
| `--status-neutral-surface` | `220 11.1111% 94.7059%` | `210 13.7255% 20%` | neutral status fill |
| `--status-success-surface` | `154.2857 36.8421% 96.2745%` | `155.7143 65.625% 12.549%` | success status fill |
| `--status-warning-surface` | `46.875 88.8889% 92.9412%` | `45.7895 54.2857% 13.7255%` | warning status fill |
| `--status-danger-surface` | `4 71.4286% 95.8824%` | `4.2105 57.5758% 19.4118%` | danger status fill |
| `--status-violet-surface` | `250.9091 64.7059% 96.6667%` | `250 32.7273% 21.5686%` | violet status fill |
| `--violet` | `250.5495 39.738% 55.098%` | `250.2439 59.4203% 72.9412%` | non-interactive category accent |
| `--scrim` | `217.5 18.6047% 16.8627%` | `210 20.4724% 49.8039%` | overlay color, paired with alpha |
| `--scrim-alpha` | `0.8` | `0.5` | light/dark overlay opacity |
| `--tooltip-muted` | `217.5 12.9032% 87.8431%` | `217.5 12.9032% 87.8431%` | supporting text on tooltip |

### Borders and interaction states
| Token | Light | Dark | Role |
|---|---|---|---|
| `--border` | `217.5 12.9032% 87.8431%` | `210 13.7255% 20%` | quiet divider only |
| `--border-subtle` | `220 11.1111% 94.7059%` | `206.6667 11.6883% 15.098%` | secondary divider |
| `--input` | `217.5 13.1148% 52.1569%` | `210.8571 14.2857% 51.9608%` | standalone control boundary |
| `--input-subtle` | `222.8571 10.7692% 12.7451% / 16.0784%` | `209 50.8475% 76.8627% / 16.0784%` | stroke only when another cue defines the control |
| `--surface-hover` | `210 14.2857% 97.2549%` | `207.2727 12.0879% 17.8431%` | neutral hover |
| `--surface-pressed` | `220 11.1111% 94.7059%` | `210 13.7255% 20%` | neutral pressed |
| `--surface-selected` | `210 14.2857% 97.2549%` | `207.2727 12.0879% 17.8431%` | neutral selected |
| `--surface-disabled` | `222.8571 10.7692% 12.7451% / 3.9216%` | `210 63.4146% 83.9216% / 3.9216%` | disabled surface |
| `--text-disabled` | `222.8571 10.7692% 12.7451% / 32.1569%` | `210.5263 80.2817% 86.0784% / 27.8431%` | disabled text |
| `--surface-shadow` | `222.8571 10.7692% 12.7451% / 16.0784%` | `205.7143 13.7255% 10%` | shadow ink |

### Chart channels
| Token | Light | Dark |
|---|---|---|
| `--chart-1` | `217.2067 81.7352% 57.0588%` | `217.0286 91.623% 62.549%` |
| `--chart-2` | `173.617 80.5714% 34.3137%` | `173.625 76.1905% 41.1765%` |
| `--chart-3` | `250.0935 59.7765% 64.902%` | `250 60% 68.6275%` |
| `--chart-4` | `25.1887 86.8852% 47.8431%` | `25.125 80% 60.7843%` |
| `--chart-5` | `217.5 13.1148% 52.1569%` | `218.5714 13.0841% 58.0392%` |
| `--chart-6` | `4 73.991% 56.2745%` | `3.8849 73.545% 62.9412%` |
| `--chart-7` | `83.913 80.2326% 33.7255%` | `83.7805 80.3922% 40%` |
| `--chart-8` | `292.2581 68.8889% 55.8824%` | `291.9018 84.456% 62.1569%` |
| `--chart-status-fill-tint` | `100%` | `100%` | solid chart status marks, adapted to meet 3:1 non-text contrast |

## 3. Typography

Inter remains self-hosted and is used without stylistic alternates. The root remains 16px so rem-based utilities keep their established scale. Semantic roles use regular 400 and medium 600 weights; all changing or comparable figures use `tabular-nums`.

| Role | Size / line height | Weight |
|---|---:|---:|
| Page title | 24px / 32.16px | 600 |
| Section | 20px / 28.6px | 600 |
| Group | 16px / 24px | 600 |
| Control/body | 14px / 20.02px | 400 |
| Supporting | 12px / 16.08px | 400 |
| Micro metadata | 10px / 12px | 400 |
| Metric | 24px / 32.16px | 600, tabular |

10px text is limited to nonessential metadata; labels and status copy use at least 12px. Mono remains for identifiers only.

## 4. Geometry, motion, and elevation

**Radius:** panels use `--radius: 8px`; controls use `--control-radius: 6px`; compact controls use `--control-radius-sm: 4px`; overlays use `--overlay-radius: 6px`; pills use `999px`.

**Controls:** the default height is 38px and compact height is 30px. Coarse-pointer hit targets remain at least 44px without shrinking the visual type scale.

**Shared layout roles:** pages use a 24px desktop gutter and 16px phone gutter. Sections are separated by 32px; related groups by 16px. Panels use a 24px desktop gap and 16px phone gap, with a 24px inset (16px on phone); tables remain flush to the panel edge. Table headers are 52px with 52px minimum rows and 16px cell insets; the default drawer is 448px wide with 16px body insets. The app shell, headers, cards, toolbars, figure groups, tables, drawers and overlays consume these roles.

**Elevation:** panels, drawers, and modals stay flat by default. `--shadow-xs` is for tooltips, `--shadow-sm` for dropdowns, and `--shadow-lg` for toasts; each uses a soft offset shadow tinted to its theme. `--shadow-overlay` is `none`. Do not add a global card shadow.

**Motion:** `--ds-ease: 120ms cubic-bezier(0.16, 1, 0.3, 1)` remains the shared easing token. Reduced-motion preferences continue to remove transitions and animations.

## 5. Components

Interactive controls use 38px default and 30px compact heights with 6px and 4px control radii. Coarse-pointer targets remain at least 44px. Tables use 52px header and minimum row heights; content may grow for wrapping.

### Buttons
- **Shape:** `control` radius, 38px tall, `0 12px` padding, ~7px gap to a 16–20px icon. Small (`btn-sm`): 30px. Icon-only controls keep a 44px coarse-pointer hit target.
- **Primary:** `primary` bg, `primary-foreground` text, and distinct hover/pressed colors. Keep one filled primary action per surface.
- **Outline:** `background` fill, `input` stroke, `foreground` text. Hover → `accent` wash.
- **Ghost:** transparent, `foreground`/`muted-foreground` text. Hover → `accent` wash. Home for header
  icon buttons and rare/secondary actions (the overflow menu is the calm home for Edit/Archive/Export).
  Shell icon-buttons (top-bar bell/theme-toggle/rail-toggle/search-trigger) render at
  `text-muted-foreground` **at rest** in both themes, flipping to `text-foreground` only on hover —
  never `text-foreground` at rest (a quiet-by-default control, not a highlighted one).
- **Destructive:** `destructive-solid` bg, `destructive-foreground` text. Reserved for irreversible actions (Mark lost, Delete).
- **Focus:** global `:focus-visible` — `outline: 2px solid hsl(var(--ring)); outline-offset: 2px; border-radius: var(--control-radius-sm)`.

### Badges / Status Pills
- **Status pill:** 20px tall, full radius, 14px label, and a semantic text/surface pair. Status remains paired with a label; do not encode it by color alone. Neutral badge uses `status-neutral-surface` and `count-foreground`.
- **Count badge** (nav rail / kanban): quiet `count-foreground`; active navigation uses `nav-active-text` on `nav-selected-surface`.
- **Unread-count chip** (notification bell): `bg-foreground` / `text-background` — a maximal-AA-contrast
  NEUTRAL pair, never `destructive`. A count is not a severity signal (that's the notification's own
  dot+label inside the inbox popover); `destructive` stays reserved for the actual destructive verb.

### Status / AA text tokens (single source of truth in `index.css`)
Semantic text roles are named CSS custom properties and pair with their corresponding surface roles.
Status text applies them as `hsl(var(--token))`. See §6 for the verified contrast numbers.

### Cards / Containers
- **Corner:** `lg` radius (8px). When a card sits above a toolbar+table assembly, top corners round and the seam squares (`var(--radius) var(--radius) 0 0`).
- **Canvas and panel:** the page content uses `surface-canvas`; `Card` uses `surface-panel` with a dedicated `panel-border` that is at least 3:1 against the canvas. Panels stay flat at rest.
- **Border:** use a panel only to group one question; never put a panel inside another panel. `bare` content belongs inside a panel, not as a replacement for section grouping.
- **Padding:** 24px desktop / 16px phone for panel headers and content. Tables remain flush against the panel edge, with the header row using `surface-table-head`.
- **CardHead:** a 16px/600 real heading (default `h2`), optional subline, and right-aligned action slot. Keep the page outline gap-free and keep card titles in heading navigation. `CardFoot` is an optional footer separated by a divider.
- **KPI Tile** (signature): `card` surface, 16px padding, [30px tinted icon tile] + [label, `muted-foreground`
  12.5px] + [help `?`], a ~23px/700 tabular value, and a foot row with a tinted delta chip + `muted`
  "vs." comparison. **ONE treatment app-wide** (`KPITile`); the in-header metric strip is `StatTiles`.

### Inputs / Fields
- `background` fill, 1px `input` border, `control` radius, 38px tall, `0 10px` padding. Placeholder = `muted-foreground`. Focus = global ring.
- **Checkbox:** 16px, 1.5px `input` border, 4px radius; checked → `primary` fill + `primary` border +
  white check. Exposed with `role="checkbox"` + `aria-checked` + `tabindex`. Takes an accessible name
  (`label`, required) OR — preferred whenever a visible label sentence sits next to it — a
  `labelledBy` id pointing at that visible text, so the accessible name and the on-screen copy are
  ONE source of truth instead of a duplicated `aria-label` a screen reader announces twice (once as
  the name, again as adjacent page prose). **⚑ The primitive itself ships NO visible-label click
  target** — it is a 16px icon-only hit area; every conventional checkbox lets you click the LABEL
  TEXT to toggle, and this one does not do that for free. A consumer rendering adjacent label text
  MUST wire its own click handler on that text (see `AnalyticsOptOutToggle`, which also guards
  against double-toggling when the click lands on the box itself, which already has its own
  handler) — this will bite the next consumer that assumes label-click parity comes standard.
- **Validation contract (Coherence Wave):** `EntityFormModal`/`useEntityForm` validate **on blur / on
  submit**, never on mount — no eager "Fix N fields" banner on an untouched form.

### Data Table (signature)
Header and row geometry follow the shared table tokens. Header cells use a 52px minimum, 14px/600 sentence-case label, canvas fill, and a 1px bottom rule. Rows use a 52px minimum and 14px body text; wrapped content may grow. Numeric columns right-align. Row menu triggers remain visible to touch and keyboard users.
- **Row actions:** on the desktop table branch, the generated `rowMenu` column sticks to the right
  during horizontal scrolling. Its header stacks above its body cells; both use the opaque `card`
  surface with a 1px inset-hairline divider (`--border`) that remains visible in every state. The
  left-cast gradient from the `foreground` token (dark at the column edge fading out over 12px) is a
  scroll affordance: render it only while the horizontal scrollport overflows and more than 1px of
  content remains hidden to its right; omit it when the table fits or reaches its right end
  (AC-TBL-STICKY-001). Chromium pins, honored by the implementation: a collapsed cell border does
  not travel with a sticky cell (hence the inset hairline); an outset box-shadow on a sticky cell is
  never painted (hence the positioned gradient strip); and the cell sticks 1px past the scrollport
  edge (`-right-px`) so the scroller's own clip closes the seam pixel its background would otherwise
  miss at `right-0` — scrolled text must never show right of the ⋯ column. The mobile card branch
  keeps its existing top-right action placement.
- **Column budget:** a new column must not push the row `⋯` trigger out of the 1440 view — merge related
  facts into one cell first (a primary value over a `muted` second line, as the e-Faktur number + date
  cell does, #893) before adding a column.
- **Column kinds:** `primary` is a two-line-clamped, wrapping identity title with an optional muted secondary line; its full title remains in `title`. `text`/`meta` wrap. `status` keeps the 12px StatusPill readable (112–220px, default 140px); money/date/status stay nowrap. No blanket body-cell nowrap.
- **Body cells:** 14px, 52px minimum height (wrapped content may grow), 16px inset, horizontal `border` dividers. Row hover uses `surface-hover`; selected rows use `surface-selected`.
- **Sort / grouping / caveats:** sortable headers show a quiet two-direction cue before activation; `aria-sort` remains authoritative. Group headers and per-currency subtotal/total rows stay aligned inside the table, with totals in `<tfoot>` and never summed across currencies. A caveated column marks its header and points to one table-level footnote/remedy.
- **Saved widths:** every production `DataTable` has a stable, unique, page-scoped kebab-case `tableId`; widths persist by table and authenticated user on that device, with unknown columns ignored and restored sizes clamped.
- **Money cells:** `tabular` is **mandatory** on every figure and on the `—` that stands in its place
  (§3) — a column that loses it stops aligning against the table above it.
- **Responsive statement totals:** on narrow card stacks, place short Current/Previous labels above
  full-width amount values; keep the full supplied date ranges and currency in the section context,
  and retain at least 100px for each value cell at a 390px viewport. Desktop headers keep their full
  date and currency captions. Amounts may wrap when longer than the available width; they must not
  be clipped or reduced to one digit per line.
- **In-cell:** project cell (28px mono icon + 2-line name/code, code in `font-mono`); money (`tabular`,
  sub-values `muted`); win-% bar (track `secondary`, fill `success`/`warning`/`destructive` by
  threshold); age chip (turns `warning`/`destructive` when aging/stale).
- **Footer:** totals row, `secondary/40%` bg, 1.5px top border, `tabular` values.
- **Toolbar / Action bar:** `card` bg seamed to the table top, holds `control` chips, a `seg` segmented
  filter, a `search-mini`, trailing icon controls. **The list-toolbar slot order is fixed by the
  `ListPage` shell (§7).**
- **Reflow (OD-W4-4):** single-renders — `<table>` at `md` (768px), stacked card list below. One branch
  in the DOM (no flash, no `aria-hidden` dup). Touch targets extend to ≥44px via `.touch-target`.

**Recognition before compression** (2026-10-09, UI polish UIP-003/007; refined for S-14, 2026-10-16). Primary record identity gets enough
space to distinguish same-prefix records before ancillary columns. On the desktop Projects table, target a
minimum 240px identity region and two readable lines; at 1440 the whole table fits with no clipped control
(customer ≥12 visible characters; assigned PM initials retain the full accessible name, while an unassigned
PM is the plain `Unassigned` label, never a person-like avatar). Keep the project name and customer immediate;
the table keeps the stable PMO Project Number beneath the title, while client code and customer contract
reference stay disclosed; compact grid cards disclose all three. Keep status/search/current view immediate, group secondary filters
and transfer tools in labelled disclosures, and offer a discoverable restore control whenever data-empty
optional columns are hidden. Delivery progress stays primary until completion, then success; it never borrows a budget-risk threshold. Use bounded table scrolling only below
~1280 — never reduce a name to a few characters. Keep full accessible names, numeric comparison alignment
and available fields. Repeating procurement rows share one column template
(header and cells from one definition) with aligned headers and a gutter between adjacent numeric columns.

### Kanban Card (signature)
`card` surface, `lg` radius, ~11px padding, flat at rest; hover uses `surface-hover`; selected uses the
selected-state token and focus ring. 26px icon,
name + customer, ~15px/700 tabular value, win-% chip, foot row (age + owner avatar + mini status pill).
For project cards, the title uses the text-column width beside the icon and wraps without a line clamp;
status follows the complete title, before client/code. Grid project cards retain their two-line title
and top-right status placement.
Columns in a horizontal-scroll grid of `minmax(258px, 1fr)` tracks with scroll-snap (one column per
gesture on touch) + a right-edge mask fade. **ONE `ProjectCard` + ONE `KanbanBoard`** drive every board.

### Lifecycle Stepper (signature) — ONE stepper only
The canonical stepper is the even-flex **BAR** stepper: equal-flex steps each with a 6px rounded `jbar`
(track `secondary`); `done` → `success`, `current` → `primary`, `paid` → `success`. Used for budget,
project-stage, and procurement lifecycles. The `current` step using `primary` is intentional — the bar
stepper is a **journey indicator**, not a status/category pill, so the Freed-Blue rule does not govern it.
The numbered-circle `node` variant is retired; the `inline` pip (9px dots in table rows) remains.

### Navigation
- **Rail:** `--rail-w: 224px`, `nav-surface` bg, right `border`. Brand block (56px). Grouped items under
  Overline labels. **Nav item:** 36px tall, `sm` radius, 13.5px/500, 17px stroke-2 icon, optional quiet
  count. Hover → `surface-hover`; active → `nav-selected-surface` bg + `nav-active-text` + 600 +
  `aria-current="page"`. Personal profile, language, theme, and sign out live in the account menu;
  the non-destination Assistant toggle uses `aria-pressed`.
- **Top bar:** `--header-h: 56px`, `background` bg, bottom `border`. Mobile menu + breadcrumb (`muted` →
  `foreground` on hover, `>` separators, bold current) + spacer + `cmdk` search (`⌘K`) + icon button with
  a `destructive` notification dot + user chip (avatar gradient + name/role, hidden on phone).
- **Mobile:** below 920px the rail collapses (`--rail-w: 0`); hamburger appears; `cmdk` shrinks to an
  icon. (Two breakpoints: 920px rail-collapse, 768px table→card reflow.)
- **Route-backed setup:** Administration section links are native navigation links. The selected
  section, breadcrumb, panel heading, and URL use one label and one route; compatibility redirects
  do not add a history stop. Personal **My integrations** remains distinct from organization setup.
  Project Managers get a direct **My Tasks** entry while the project-scoped Tasks page remains the
  project-oversight destination; keep both destinations distinct in the rail and command palette.
  Finance gets a **Vendors** doorway to the existing Companies list filtered to vendors, independent
  of unrelated CRM navigation visibility; Companies remains the canonical vendor record. Shared
  route labels should be reused by navigation, command-palette results, and breadcrumbs, including
  the localized parent label on an expense-claim breadcrumb and the localized pending/not-found
  state crumbs on detail routes. When an async panel owns a URL fragment,
  focus and scroll its target after the panel mounts. A background access refresh keeps a settled
  panel visible; pending access applies only before membership resolves, and an unavailable check has
  a recoverable error state.

### Organization integration readiness
- A connection, service activation, outbound queue state, and verified data movement are separate
  facts. A connected binding receives a neutral **Connected** status; it never implies a successful
  transfer. Only a trustworthy success event may be labeled as the last successful sync.
- Read each service and each supporting map source independently. A slow or failed source shows an
  explicit loading or unavailable state with a source-specific retry; it cannot turn known sibling
  data into an empty or disconnected claim. The Admin's next permitted recovery action stays nearby.
- Keep credential, Company activation, and disconnect failures in their originating dialog. Preserve
  entered values and selections for retry, and describe the outcome conservatively until the write
  actually succeeds. Use the same status, card, button, and dialog primitives in both languages.

### Tabs / Segmented Controls
- **Inline segmented (`seg`):** 52px track and 14px regular labels; selected state uses an underline or selected-surface role. `role="tablist"`/`role="tab"`/`aria-selected`.
- **View switch (`ViewToggle`):** the shared `Table / Board / Calendar / Cards` label set, right-aligned
  icon segmented.

### Overlays
- **Popover menu:** `popover` bg, `border`, `overlay` radius, `shadow-sm`, 5px padding; 38px items, `surface-hover`
  hover, `danger` items in `destructive-text`, hairline separator.
- **Modal dialog — error + focus rules (locked 2026-07-28, OD-FORM-A11Y).** Rules 1 and 2 live inside
  `EntityFormModal` and every consumer inherits them with no opt-in. Rule 3 requires the consumer to pass
  `submitError` or to keep an equivalent persistent error in the dialog. The rollout is now guarded by
  `src/lib/__tests__/entityFormModal.saveErrorCoverage.test.ts`: every consumer is wired or carries a
  reasoned exemption, and stale exemptions fail. The previous “2 of 18” rollout count described the
  2026-07-28 state and is no longer current.
  1. **Blur-surfaced errors must never drive focus; only submit-surfaced ones do.** Validation-on-blur plus
     "focus the first invalid field" composes into a keyboard trap (WCAG 2.1.2) — the user can never leave
     the field. Focusing the first invalid field on **submit** is correct and stays.
  2. **The error summary is a post-submit verdict.** Before a save is attempted, the field's own inline
     error is the whole story — a top banner restating it is premature and duplicated.
  3. **A mutation failure inside a dialog gets a persistent in-dialog error region, not only a transient
     corner toast.** Tokens: `border-destructive/30` + `bg-destructive/[0.07]` surface, `alert` icon in
     `text-destructive`, headline in `text-destructive-text`, body in `muted-foreground`; `role="alert"`,
     `tabIndex={-1}`, and focus returns to the region (never to the submit button — that risks an
     accidental re-submit). It states that nothing was saved and that the entries are intact.
     **Text on a destructive tint always uses `destructive-text`, never `destructive`** — `destructive`
     is reviewed only against `canvas`/`raised` backgrounds and fails WCAG AA on the `destructive/[0.07]`
     tint (found live on the M365 disconnect-failure alert, issue #689, fixed by this same rule).
  - **Inline field errors use `text-destructive-text` in both themes.** `FieldError` owns the
    token; AC-A11Y-FIELD-001 binds it to the component and proves AA contrast on background/popover.
  Plus: while a modal dialog is open the app background (`[data-app-shell="root"]`) is `inert` —
  `aria-modal` alone does not remove it from the tab order.
- **Toast:** `popover` bg, `border` + 3px left accent stripe (`primary` for info, `success` for ok,
  `warning` for warning, `destructive` for error), bottom-right, slide-in (`.toast-anim`).
  **Toast timing (DD-TOAST-1):** warning and error messages persist until dismissed because they
  carry remedies. Info and success auto-dismiss after `max(4s, 60ms × displayed characters)`, capped
  at 10s. Hover or keyboard focus pauses that timer. Every toast has a visible, keyboard-reachable
  dismiss control. The provider mounts its polite `role="status"` and assertive `role="alert"` live
  regions once, empty, then inserts each announcement into the existing region.
- **Persistent toast + blocking dialog:** when a modal opens, keep persistent warning/error toasts
  visible but move them to the safe top edge; never dismiss a remedy or cover the modal's actions.
  Confirmations with context-dependent decisions restate the current record identity and caller-supplied,
  authoritative amount inside the existing confirmation. Keep the safeguard and existing consequence; do
  not add another confirmation layer or infer financial values in the shared presentation component.
- **Long phone entry forms:** keep the completion action beside the work in a fixed mobile strip, reserve
  content space beneath it, and account for device safe areas. For week-based timesheet entry, show the
  localized total and existing Save/Submit actions without removing days or changing Submit's auto-save;
  the final field and its inline validation remain scroll-reachable above the strip. The strip also clears
  the non-production environment badge rather than placing that marker over a control.
- **Evidence preview:** use a shared, keyboard-dismissible preview for supported image/PDF receipts, using
  the caller's existing authorized short-lived URL retrieval. Preserve a single Download original action
  for unsupported files and preview failures; closing returns focus to the opener.
- **Tooltip (`.tooltip-surface`):** constant dark surface, 14px/20px type, 4px radius, 4px/8px padding,
  `shadow-xs`, max 280px; bold title + `tabular` key/value rows; `tooltip-muted` for supporting body.
  `--tooltip-muted` is shared by both themes.

## 6. Do's and Don'ts

### Do:
- **Do** hold `--primary` to the ONE primary action + ring + active-nav; keep it under ~10% of any screen.
- **Do** render status with a marker and label using the matching status surface and AA text tokens.
- **Do** define structure with the single 1px `border` + surface-tone contrast; use a card where it
  groups one job's content, never a card inside a card.
- **Do** apply `tabular-nums` to every figure (currency, %, counts, deltas, ages).
- **Do** use 38px default and 30px compact controls, with 6px and 4px control radii; retain 44px coarse-pointer targets.
- **Do** use `font-mono` only for machine IDs/codes and the `⌘K` chip; other UI text uses default Inter forms.
- **Do** expose the global `:focus-visible` ring on every focusable element; keep `role`/`aria-*` on tabs,
  checkboxes, nav, dialogs.
- **Do** reserve violet/status hues for non-interactive meaning — never as action colors.
- **Do** route every status/severity/category pill through `src/lib/status/statusVariants.ts`.
- **Do** open every primary entity as a routable `/x/:id` page (The Record-Open Rule, §7).
- **Do** give every item of a responsive `grid`/`flex` layout an explicit `min-w-0` the moment ANY
  descendant is intrinsically wide and un-wrappable (a `LifecycleStepper`-style scroll row, a mono id,
  `whitespace-nowrap`): the CSS default `min-width: auto` floors the shared track/item at that
  descendant's content-based minimum, overflowing a narrow viewport, even when a nested
  `overflow-hidden` sits several levels further down (AC-RAM-003, #688 — `PipelineLens`'s two-card
  grid panned to 618px at 390px before this).

### Don't:
- **Don't** ship the "AI SaaS marketing" aesthetic (dark+purple-gradients, neon, glassmorphism, hero
  type, floating-card soup).
- **Don't** put a drop shadow on a static card — give it a border (Flat-By-Default).
- **Don't** use `rgba(0,0,0,…)` at high opacity for shadows; desaturated near-black at low alpha only.
- **Don't** invent colors outside the defined semantic roles or add another font family.
- **Don't** color body text with a fully saturated status hue, or fill a status pill solid.
- **Don't** make default/compact controls taller or shorter than 38px/30px or invent radii outside the 4/6/8/999 scale.
- **Don't** assign the action-blue (`open` variant) to any status/severity/category pill.
- **Don't** build a record as a URL-less drawer, leave a list row inert, or build a second
  stepper/KPI-tile/project-card/list-toolbar grammar — reuse the §7 molecule.
- **Don't** invent a per-feature create verb. Use **"New &lt;Entity&gt;"**; keep a domain verb only where
  the domain uses it, and make button + modal title + submit all say the same phrase.

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
4. **Alpha tints** come from slash-alpha syntax. Prefer named semantic surface tokens for statuses and
   interaction states; use alpha for authored overlays and accents, and check contrast against the
   final composited surface.
5. **Numbers:** apply `.tabular`/`.tnum` to every metric.
6. **Focus:** keep the global `*:focus-visible { outline: 2px solid hsl(var(--ring)); outline-offset: 2px;
   border-radius: var(--control-radius-sm) }` rather than per-component focus styles.
7. **Charts (recharts):** theme via `chartTheme` (`src/components/ui/chartTheme.ts`) — axis/grid in
   `muted-foreground`/`border`, primary series in `primary`, status series in success/warning/destructive,
   categorical in violet. **`chartTheme.ts` still holds legacy hardcoded categorical hues** (the old
   blue/violet/green/amber/red literals) — a known follow-up to re-tone in a chart surface slice; the
   axis/grid/series already derive from tokens. Time-series use a time/value axis (`type='number'` +
   `scale='time'`, `dataKey` = epoch-ms), never a categorical index; date math via date-fns (UTC-stable).

## Accessibility posture

Text uses at least 4.5:1 contrast (3:1 for large text); meaningful non-text boundaries and chart marks use at least 3:1. Disabled text and controls are exempt, but disabled styling never carries essential information. Check the actual foreground, rendered surface, and alpha together.

`--input` is the strong standalone control boundary. `--border` and `--input-subtle` are quiet separators only and must not be the sole cue for an interactive control. Status text uses its matching status surface. `--warning-icon` is the legible marker role; `--warning-foreground` pairs with `--status-warning-surface`. The `--primary-text` role is for canvas/card text, while active navigation uses `--nav-active-text` against `--nav-selected-surface`.

Primary and destructive fills pair with their theme-specific foreground tokens. The eight chart channels are checked against both card and canvas surfaces in both themes. Chart status fills use solid marks so the data graphics retain at least 3:1 contrast. Detailed text, boundary, status, and chart pair measurements are kept in the private token verification report.

**Focus:** single source of truth — global `:focus-visible` = `2px solid hsl(var(--ring))` at 2px offset.
**Semantics:** `aria-current="page"` on active nav, `role="tablist"/"tab"/"aria-selected"` on segmented filters, `role="checkbox"/"aria-checked"/tabindex` on custom checkboxes, `aria-label` on icon-only buttons and landmarks. **Keyboard:** tab order follows DOM; overlays add focus management + `Esc`-to-close.
**Coherence-Wave invariants:** every new record page carries a focus-managed heading + breadcrumb + Back;
`RecordActionZone` keeps the primary action in the keyboard path and above the fold; status pills stay
dot+label (never color-only).

**Scrollable regions (2026-09-28):** a horizontally scrolling region with no focusable children gets
`role="group"`, a label, and `tabIndex={0}` — otherwise a keyboard user has no way to reach its overflow
(axe `scrollable-region-focusable`). Skip this when the region already contains its own focusable
children (e.g. `Funnel` stages rendered with `onSelect`); adding it there would only insert a redundant
tab stop ahead of the first real control.

**Milestone card, narrow-card readability — CLOSED (AC-RAM-004, #688, round 3, 2026-09-29).** A
grid of secondary metric cards (e.g. `MilestoneStrip`'s `milestone-card-grid`) must size its
columns off the grid's OWN rendered width, not a viewport breakpoint — a card embedded in a
narrower record-layout column (e.g. `ProjectDetail`'s two-column `lg:grid-cols-[minmax(0,1fr)_340px]`)
can be far narrower than the viewport implies, and a fixed column count (`xl:grid-cols-4`) will
squeeze the title until it has no readable width left. Prefer CSS `auto-fit`/`minmax` (a
content-driven floor per card) over a viewport-keyed column count; keep the title on one column
and its secondary metric (the effective %) in a reserved column beside it, sized so the floor
covers both plus the card's own padding and any corner affordance (the `⋯` menu) — narrow cards
should drop a column before a title runs out of room, never squeeze the title to fit one.

**Status dots** are graphical (≥3:1) and always paired with a text label (WCAG-exempt); light
success-dot 3.92 / warn-dot 3.17 / neutral-dot 4.22 on canvas; dark dots already clear 3:1 at the vivid
hues (success 8.75 / warn 11.01 / neutral 3.12).

**Standalone-control boundaries — CLOSED (2026-07-28 Discover-pass → fixed same day).** A control
whose ONLY visual indication is its `border-input` outline (no fill, no icon, no adjacent text
until it's checked) must clear WCAG 1.4.11's 3:1 non-text floor against the surface it actually
renders on. Dark `--input` (`240 4% 30%`) measured **2.13:1** on dark `--background` — an empty
outline that was, in practice, invisible. Fixed by raising dark `--input` to `240 4% 42%` (see the
"Lines / fields" table above) — a token-level fix, so **any other bordered-only control in dark
theme likely inherited the same gap**; don't assume a border-only control is visible in dark just
because it renders in light. (WCAG 1.4.11 exempts `disabled` controls — a dimmed/`opacity-45`
control is a different, exempt case, not covered by this note.) Deterministic gates:
`checkboxBorderContrast.test.ts` (token math, `AC-A11Y-CHECKBOX-001`) +
`AC-VISUAL-CHECKBOX-001-dark-contrast.spec.ts` (rendered computed-style, e2e).

**Focus:** single source of truth — global `:focus-visible` = `2px solid hsl(var(--ring))` at 2px offset.
**Semantics:** `aria-current="page"` on active nav, `role="tablist"/"tab"/"aria-selected"` on segmented
filters, `role="checkbox"/"aria-checked"/tabindex` on custom checkboxes, `aria-label` on icon-only
buttons and landmarks. **Keyboard:** tab order follows DOM; overlays add focus management + `Esc`-to-close.
**Coherence-Wave invariants:** every new record page carries a focus-managed heading + breadcrumb + Back;
`RecordActionZone` keeps the primary action in the keyboard path and above the fold; status pills stay
dot+label (never color-only).

**Scrollable regions (2026-09-28):** a horizontally scrolling region with no focusable children gets
`role="group"`, a label, and `tabIndex={0}` — otherwise a keyboard user has no way to reach its overflow
(axe `scrollable-region-focusable`). Skip this when the region already contains its own focusable
children (e.g. `Funnel` stages rendered with `onSelect`); adding it there would only insert a redundant
tab stop ahead of the first real control.
**When the scroll viewport already carries `role="list"` (2026-09-29, `LifecycleStepper` bar variant,
AC-RAM-004):** don't put `role="group"` on that same element — a `listitem` child requires a `list`
ancestor, so swapping the role breaks `aria-required-parent`. Add a wrapping `role="group"`/`tabIndex={0}`
div one level OUT, and drop `aria-label` from it (leave the label on the inner `role="list"`) — an
`aria-label` on both would give `getByLabel(label)` two matches for one component.

**Bottom-aligned row indicators (2026-09-28, `Funnel` bars):** a fixed top margin and a bare
`margin-top: auto` each solve only half of "pin an indicator to the bottom of every card in a
stretched row, with a guaranteed minimum gap above it": a fixed margin loses cross-row alignment the
moment one sibling's content wraps taller, and `margin-top: auto` alone collapses to a 0px gap
whenever every sibling's natural height is already equal (the common case, since a flex column with
no imposed extra height gives an auto margin nothing to consume). Use both together — a fixed
padding-floor (e.g. `pt-2`) on a transparent wrapper for the minimum gap, plus `mt-auto` on that same
wrapper for the cross-row alignment — and never put the padding on the indicator's own visible/filled
element, or the fill color paints through the gap.

**Focus ring inside a scrolling ancestor (2026-09-28, `Funnel` stages):** the global outward
`:focus-visible` ring (2px width, 2px offset) assumes its element's nearest scrolling ancestor has
`overflow: visible`. Setting only `overflow-x: auto` on an ancestor still computes `overflow-y` to
`auto` too (the CSS overflow spec forces the paired axis once either axis leaves `visible`), so that
ancestor clips the ring's top/bottom edge along with everything else it clips. A focusable element
whose nearest scrolling ancestor is itself the clip boundary (not a further-out page scroller) must
draw its ring INWARD instead — `focus-visible:outline-offset-[-2px]` with the same width/color
token — so the ring never crosses into the ancestor's own clip region on any side.

---

## Icons — the `<Icon name=…>` monoline facade (ADR-0068, locked look)

The app renders every icon through ONE facade: `<Icon name=…>` (`src/components/ui/icons.tsx`) backed by
the `ICON_PATHS` registry (`src/components/ui/iconPaths.tsx`). The facade is the locked monoline look:
`viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`, `strokeWidth={2}`, round caps/joins,
`width/height="1em"` (sized by font-size), and `aria-hidden` unless an `aria-label`/`title` is passed.

**One licensed geometry family.** UI glyph geometry comes from a pinned Lucide
release, copied into the typed icon registry with source provenance and the
distributed license/attributions. `<Icon name=…>` is the public facade; legacy
named icon exports delegate to it. Do not mix independent 1.5px/2px families.
Keep 24×24 / stroke 2 / round caps and joins / currentColor. Keep existing
rendered sizes: about 17px rail, 15px controls; icons remain decorative unless
explicitly named. Vendor marks and charts are not UI-glyph substitutions.

**Entity semantics stay stable.** Projects uses FolderKanban; Procurement uses
ShoppingCart; Pipeline uses SquareKanban; Companies Building2; Contacts
ContactRound; Approvals ListChecks; My Tasks ListTodo; Expenses Receipt;
Incoming Payments Banknote; Management pack FileSpreadsheet. Use Menu for
the phone drawer trigger, never the Board/Columns glyph. Rail, Navigate and
record-search metadata agree for the same entity. Preserve old icon aliases
until callers are deliberately mapped; do not repurpose financial chart keys
globally to fix a navigation metaphor.

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
- **Token rule (Blocker-6):** the "Approved ✓" paragraph MUST use `text-[hsl(var(--success-text))]`.
  Never a hard-coded green literal; the semantic token preserves the paired light/dark status color.
  Enforced by a Vitest test.
- **Control-height rule (Blocker-9):** Approve/Deny buttons use the 38px default control height.
- **Shape:** `overlay` radius border, `secondary` bg. Approve = `primary`/`primary-foreground`; Deny
  = `input` outline `foreground`. Resolved states remove buttons; "Approved ✓" in `success-text`,
  "Denied" in `muted-foreground`.
- **A11y (NFR-AW-A11Y-001/003):** container `aria-live="assertive"`; when `phase==='needs-approval'`,
  AssistantPanel renders a distinct `role="status" aria-live="polite"` "A write action awaits your
  decision" region; the composer textarea carries `aria-disabled` via `needsApproval`.
- **Per-chip state keyed by `pendingId` (Blocker-8):** `ChipStateMap = Record<string, ApprovalChipState>`
  keyed by `pendingId` — NOT a single global atom (a global corrupts earlier chips on sequential
  proposals). See `docs/decisions.md` OD-A3-CHIP.

### Budget editor scroll containment (2026-10-05, #804)

The existing DataTable positioned-scroller rule also applies to budget editor tables: `overflow-x-auto` wrappers must be `relative`, so absolutely positioned accessible labels remain clipped at375px. AC-CAT-007 retains this regression.

### Finance filters and narrow record cards (2026-10-05)

Status filters that exceed a narrow page use a width-capped horizontal scroll region with a label, keyboard focus, and the shared focus-ring token. Budget table scroll regions are keyboard reachable and remain positioned for label containment. On a wrapping version-card header, keep a visible gap between status and total and reserve the total's width. In narrow invoice cards, the tax-basis note takes its own full-width line alongside the amount group. Text on dark primary surfaces uses the existing `primary-text` AA token.

### Project classification filters (2026-10-05, #770)

Project classification filters stay available to Engineers as well as managers. At phone width,
Engineers use a separate Classification disclosure; customer and project-manager controls remain in
the manager Filters disclosure. Clearing a classification restores the role's default project scope.
Filter-clearing text uses the existing `primary-text` AA token in both themes. The shared project
form keeps all five classification fields in its scrollable body with the save footer visible.
Read-only setup lists pair each term with its definition; explanatory helper text sits outside the
definition list so assistive technology receives valid list semantics.

### Tax detail disclosure (S-39, 2026-10-18)

Keep a record’s saved inclusive/exclusive tax basis beside its amount. Selected record surfaces disclose the saved rate and base through a labelled keyboard/touch control; unknown facts stay unknown. Escape closes the disclosure and restores focus to its trigger. The shared control keeps its ordinary inline default and explicit basis-only aggregate mode. Disclosure does not activate a surrounding card or approve an invoice, and genuine billing prerequisites keep their existing remedy. Use the shared 44px coarse-pointer target with the 38px visual control.

### Reference search identities (2026-10-18, S-40)

Command-palette results retain canonical reference tokens on one line while allowing the surrounding label to wrap. Keep cached navigation available during reference loading or retry; each result opens its canonical detail screen. A bounded result list asks the user to refine a broad query. The reference search component and persisted Finance journey retain these checks.

### Daily purchasing rows (S-19, 2026-10-18)

Daily request lists show the shared current-state name and a descriptive next step; the full lifecycle stays on the request detail screen. Preserve the approval gate and quote-selected stage. Import/export tools live behind the labelled More disclosure while search, status and request creation remain immediate. Executive purchasing charts describe the PMO request register and distinguish it from ERP-native purchasing.

### Recoverable expense capture (S-29, 2026-10-19)

Place the first receipt and expense line before secondary claim details. Leave the expense type unknown until chosen; any started line requires its date, type, description and positive amount. A filename or description may suggest the title until the claimant edits it. Suggest only that claimant’s newest explicit category for the selected project and show its source. After a partial receipt failure, keep the saved draft and original inputs, explain what remains, and offer retry or the saved draft. Long forms scroll above their visible save footer in both themes and languages.
