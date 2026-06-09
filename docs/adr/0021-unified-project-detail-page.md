# ADR-0021 — Unified project/opportunity detail page (supersedes ADR-0020 §1)

Status: Accepted (owner-directed override, 2026-06-09)
Supersedes: **ADR-0020 §1** (the stage-adaptive lens that HID the delivery tabs pre-win). ADR-0020 §2-5
(canonical route, `/sales/:id` redirect, disjoint Projects/Pipeline partitions, stage-correct breadcrumb,
single ⌘K index) **stand unchanged**.
Companion: `pages/project-detail/ProjectDetail.tsx`, `pages/project-detail/PipelineLens.tsx`,
`pages/project-detail/ProjectDetailHeader.tsx`.

## Context

ADR-0020 §1 made `/projects/:id` render a **stage-adaptive lens**: a pre-win (`pipeline`) or terminal
(`lost`) record showed ONLY the `PipelineLens` (deal stepper + Advance/Mark won/Mark lost + Value/Win-
probability/Weighted) and **hid the delivery tabs** (Overview/Budget/Procurement/Tasks/Documents), on the
stated assumption that "a pre-win deal has accrued no budget/PRs/tasks yet, so hiding is the honest
presentation (no empty-tab tease)."

Rendered, this proved **unusable**. A PM pursuing a deal cannot see or plan its budget, tasks, or
procurement — the exact work you do *while* pursuing a deal. The owner rejected it after seeing it live:
*"why is there no budget in the project during pipeline. it needs to look like the project detail page …
its not usable currently."* The "hide tabs pre-win" assumption was wrong: pre-win planning is a core need,
and the backend already permits it (the budget RPC `0005`, `tasks` RLS, and `procurements` RLS gate on
org/role, **not** on the parent project's status — verified), so the tabs are fully functional pre-win.

This is also the stronger CRM/ERP convention (Salesforce/HubSpot opportunity pages: a stage path at the
top, full detail tabs below).

## Decision

**Unify the detail page across ALL stages.** `/projects/:id` always renders the full project detail
layout — `ProjectDetailHeader` + the five tabs (Overview / Budget / Procurement / Tasks / Documents). For a
`pipeline | lost` record, the deal-progression surface (`PipelineLens`: stage stepper + Advance / Mark won
/ Mark lost + Value / Win-probability / Weighted, with its inline SoD won-capture) renders as a **banner
above the tabs** (the owner's chosen placement). On win the banner simply disappears and the delivery
header tiles appear; the tabs persist — one page, continuous across the lifecycle.

- The header's **delivery stat tiles** (Contract/Committed/Actual/margin/Spend) and the **contract-value
  SoD editor** stay delivery-lens-only (`isDelivery`) — they are meaningless pre-win; the deal's figures
  live in the banner. No double metrics.
- The tabs are **fully functional pre-win**: a PM can build a prospective budget, plan tasks, and raise
  procurement against a deal still in the pipeline (the backend has no project-status gate on those writes).

## Unchanged

ADR-0020 §2-5: the canonical route `/projects/:id`, the `/sales/:id` → `/projects/:id` redirect, the
disjoint Projects (on-hand ∪ internal) vs Pipeline (pre-win) list partitions, the stage-correct breadcrumb,
and the single ⌘K index. The state machine (`transition_project`, `LEGAL_PROJECT_TRANSITIONS`,
`projectStatusGroup`), RLS, and the SoD RPCs (ADR-0019) are untouched. **FE-only — one component
re-architecture, no migration.**

## Consequences

- **Positive:** the detail page is usable at every stage — plan budget/tasks/procurement while still
  pursuing the deal; continuity across win (the page doesn't become a different page); matches CRM/ERP
  convention.
- **Negative / watch:** pre-win tabs show empty states until filled (acceptable — fillable, not a tease);
  the OverviewTab budget snapshot reads $0 pre-win until a budget version exists.
- **BDD:** the canonical-record e2e journey (AC-IXD-PROJ-001) updates its *steps* — a pipeline deal now
  shows the delivery tabs + a deal banner — while the goal-oracle (one record, one URL, one page) is
  preserved. A new acceptance encodes the owner's journey: a PM planning a pipeline deal can open its
  Budget tab.
