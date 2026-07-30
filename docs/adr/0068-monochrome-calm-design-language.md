# ADR-0068 — Monochrome-calm design language + reskin-in-place port

> **⚑ Provenance / id-history note (2026-07-27).** This ADR was originally authored on the
> `redesign/design-system` branch as **ADR-0037** — *Monochrome-calm design language*. It landed there
> when `dev`'s `0037` slot was still free; `dev` later took a **different** ADR at `0037`
> (*View-Composition Trusted Core: compiler DSL*), so `DESIGN.md`'s `ADR-0037` citations resolved to the
> **wrong document**. It is landed here at the next free id (**0068**) with `DESIGN.md` and the component
> comments repointed to it; `dev`'s `0037` (compiler DSL) is untouched and still owns the viewspec
> citations. Same class as the `0058`/`0059` collisions fixed in #387. Until the `redesign/design-system`
> branch is deleted by the owner, it remains the only home of the **exploration artifacts** this ADR
> references (mockups + the 3 port plans) — see "Reference artifacts" below.

- **Status:** Accepted (owner-approved 2026-07-01 — "lock the language")
- **Date:** 2026-07-01
- **Deciders:** Owner, Director
- **Related:** ADR-0036 (agent-native pattern — this borrows agent-native's *visual restraint*, keeps agent-as-deputy not host), ADR-0016/0017 (authz + repository seam — untouched by a reskin), the earlier design-adoption brief (see "Reference artifacts" — **superseded in part** by this ADR).
- **Reference artifacts (exploration trail — NOT in-tree on `dev`):** the mockups (`docs/design-mockups/redesign/{diverge,converge,reskin,reskin/ext}/` — HTML/IA sketches), the adoption brief (`docs/plans/2026-06-29-design-system-adoption-brief.md`), the parity inventory (`docs/plans/2026-06-30-reskin-port-parity-inventory.md`), and the port runbook (`docs/plans/2026-07-01-reskin-port-plan.md`) all live **only on `redesign/design-system`**. They are the *source of the look*, not current truth — `DESIGN.md` is the in-tree source of truth for the shipped system. Cited here for provenance; do not treat a missing-on-`dev` link as a broken contract.

## Context
PMO's live UI (`DESIGN.md`) is a light, shadcn-derived "calm/dense" records surface. Across a long
design exploration (2026-06-29→07-01) the owner found the in-flight redesign **too crowded** and its
dark mode unreadable, and reacted positively to **Builder.io's `agent-native` app visual**
(dark-first, near-monochrome, Inter, airy, premium — the Linear/Vercel/Raycast family). Rather than
copy an agent-first chat shell (PMO is a data-dense CRUD ERP), we ran **diverge → converge → reskin**:
- **Diverge:** 4 IA/IxD paradigms.
- **Converge (owner pick):** a **hybrid** — a calm records-workspace backbone + two-pane triage for
  queues + a board view-toggle.
- **Reskin (LOCKED here):** re-tone the converged hybrid into a **monochrome-calm** aesthetic with a
  deliberate action↔density↔whitespace balance.

This ADR locks that design language and how it is ported. It **supersedes the accent/font/theme parts
of the 2026-06-29 brief** (which said keep-PMO-blue + Plus Jakarta/DM Sans + light-default); the
brief's **IA-overhaul intent, big-bang-branch ship strategy, and light+dark+AA discipline still hold**.
The coding-standards adoption (engineering-conventions + structural codemods) from that brief is a
**separate, still-open track** — not part of this visual lock.

## Decision

### 1. The monochrome-calm design language (locked)
- **Monochrome chrome.** Rail, top bar, tables, cards, secondary buttons, text = neutral/greyscale.
  **Colour means something:** PMO blue is reserved for the **single primary action** per surface + the
  focus ring + active-nav; the **semantic status palette** (won/ongoing/on-hold/at-risk/overdue) stays
  but is rendered **restrained** — a **dot/ring + label** or a quiet tint, **never a loud filled slab**.
- **Typography:** **Inter with stylistic sets** (`font-feature-settings: "cv02","cv03","cv04","cv11"`)
  as the single UI family; `tabular-nums` on all figures. (This replaces the brief's Plus Jakarta + DM
  Sans — a deliberate switch the owner preferred.)
- **Shape/motion:** 8px base radius with nested reduction (`calc(radius - 2px)`); soft
  `--ds-ease: 120ms cubic-bezier(0.16,1,0.3,1)`; low, single-layer elevation; hairline borders or none
  (prefer dividers/whitespace over boxes). `prefers-reduced-motion` drops transitions.
- **Icons:** ONE consistent monoline set (1.5px stroke, `currentColor`, override-safe) — replaces the
  hand-rolled `iconPaths`. (Adopt Lucide or Tabler at port time.)
- **Density = deliberate balance (action↔density↔whitespace).** Airier than the converged round
  (generous gutters, ~56–64px rows, **content-over-containers** — drop wrapping cards where
  whitespace/dividers suffice, no nested cards) **while staying action-rich**: exactly one primary
  action visible; essential ERP verbs (Advance/Approve/Return/New) obvious; **rare/secondary actions
  disclosed** in menus, hover/focus, or disclosure rows. *Subtract, don't strip.* Calm after the 100th use.
- **Charts (locked treatment):** quiet neutral axes/gridlines; series fills are status-tinted (when
  the series IS a status) or a single neutral/accent — **never a rainbow categorical palette**; flat
  (resting shadow only on the card).
- **Dark mode is first-class + WCAG-AA in both themes.** Every normal-size text ≥ 4.5:1 on its actual
  surface; verified numerically per surface (the prior "grey on black" failure is fixed via dedicated
  `--ds-primary-text`/`-solid`, status-`-solid`, and lifted dark neutrals).

### 2. IA/IxD (from ADR-0036 + the converge round) — unchanged by the reskin
Calm records-workspace backbone (grouped rail + breadcrumb/⌘K topbar + roomy progressive-disclosure
tables + calm two-column record page) · **two-pane triage** for queue surfaces (Approvals, Procurement)
· **board** as a Projects view-toggle (Table │ Board │ Calendar). Agent stays a **deputy** (ADR-0036),
not the host shell.

### 3. Port method: reskin-IN-PLACE, never rebuild-from-mockups
- Re-tone the **existing** `pmo-portal/pages/` + `src/components/` to the new tokens/aesthetic, keeping
  all logic, data, charts, and actions. **The mockups define the look; the codebase defines what
  exists.** Porting "from the mockups" is forbidden — it drops widgets.
- **Parity gate (binding):** the port-parity inventory (branch-only — see "Reference artifacts")
  enumerates every route/widget/chart/action; a surface ports only when each of its rows has a
  reskinned, AA-verified home (light+dark). The Director verifies **nothing dropped** before merge.
  Removing any feature needs explicit owner sign-off.
- **`DESIGN.md` is rewritten** to this system during the port's Foundation phase (tokens folded from
  the reskin token CSS into the app; `DESIGN.md` becomes the monochrome-calm source of truth). Until
  then, `DESIGN.md` still describes the LIVE app — do not overwrite early.

### 4. Execution substrate: pi + glm-5.2 (Director-orchestrated)
The reskin build is dispatched to the **pi CLI (glm-5.2)** per `docs/pi-delegation.md`; the **Director
orchestrates + verifies every result** (token purity by grep + the pixel/taste lens by rendering — a
text model can't self-judge visuals).

## Consequences
- **Positive:** answers the owner's three standing complaints (too dense · grey-on-black · type). One
  coherent language; a proven, AA-clean dark mode; a low-risk port (restyle working code) with a hard
  no-features-dropped gate; economical execution (pi/glm spares Claude quota).
- **Costs / follow-through:** ~15+ widget types still need their monochrome-calm treatment designed
  before their surfaces port (calendar, kanban, timesheet grid, forms/modals, import wizard, command
  palette, mobile, the 4 non-exec dashboards). Inter+cv + a new icon set are new fonts/deps. The reskin
  is a big-bang branch (off `dev`) — it stays off `main` until the whole app is converted + green.
- **Non-goals:** not migrating onto agent-native (ADR-0036); not changing authz/RLS/repository seams;
  not the coding-standards/codemod track (separate, still-open).
