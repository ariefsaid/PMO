# JTBD Remediation — Fresh Re-Audit (round 3) + fix-wave-3 plan-of-record

> **Status (2026-06-15).** This is the loop-closer: after fix-wave-1 (27 action-completeness findings) and fix-wave-2 (25 broad-audit findings) landed and gated on branch **`jtbd-remediation`** (`cbdf407`), both oracles were re-run **fresh on the fixed tree**. This doc records what the re-audit found, the 3-reviewer verdicts, the triage (fix-now / backlog / owner-descoped), and the fix-wave-3 plan-of-record. **fix-wave-3 is NOT yet built** when this was written.

## Program state at re-audit time
- **Branch `jtbd-remediation`** = main(`21a0577`) + P0 shared seams + fix-wave-1 (10 consumer pkgs) + fix-wave-2 (G1 budget bug→mig 0033/pgTAP 0075, G2 false-empty+MyTasks, G3 dates+variance, G4 a11y/mobile/resilience). Head `cbdf407`.
- **Gates green:** typecheck 0 · lint 0 · build ok · **2957 unit** · **496 pgTAP** (81 files).
- **3-reviewer battery (on `git diff 21a0577..HEAD`):**
  - **security-auditor — CLEAN** (no Crit/High/Med). Mig 0033 preserves `security invoker`+`search_path`+anon-revoke; derived-budget subquery is RLS-org-scoped; admin mailto is static clipboard; CRM aggregation reads only via RLS'd repos. 2 pre-existing Lows → backlog (client-supplied `logged_by_id`; `mailto` recipient flexibility).
  - **code-quality — SHIP** (no Crit/Imp). Shared seams genuinely reused; mig 0033 "exemplary". 2 Minors → see backlog (useCompanyActivities N+1; dead `||` in WinRateCard.error.test).
  - **spec-reviewer — COMPLIANT** (no Crit/Imp). Every load-bearing finding verified in real code. Minors: AC-JR-W1-09 untested (queue read-only link); AC-id drift from plans (cosmetic).
- **Owner's 5 complaints, post-wave-1/2:** all CONFIRMED addressed; drawer/detail **RESOLVED & clean** (owner note was stale); Gantt/Procurement/Approval/CRM addressed **with localized residuals** (below).

---

## Fresh re-audit results (on the fixed tree)

### Action-completeness census — 0 Critical · 7 Important · 17 Minor
Structural coherence held (every primary record routes to a detail page; one noun; one status registry). Residual debt = **interaction debt**, two families: (1) **dead-display / named-but-not-linked** (largest class); (2) **per-feature interaction divergence**.

### Broad audit (state/a11y/data/mobile/resilience) — 2 Critical · 7 Important · 9 Minor
Two new criticals (one a **residual of my own W2-1 fix**), plus money-tile false-empty + budget line-item resilience + mobile overflow.

---

## Consolidated findings + triage

### ⚑ TIER 0 — fix-wave-3 (Critical + residuals-from-my-waves + clear bugs) — DO NOW
| ID | Sev | Finding | Location | Note |
|---|---|---|---|---|
| B-0.1 | **Crit** | Two delivery hooks share one React-Query cache key, different shapes → non-deterministic wrong/blank budget | `src/hooks/useProjectsDelivery.ts:18-39` | Add `variant:'pct'\|'summary'` discriminator to the key. Pre-existing. |
| B-0.2 | **Crit** | Project-header Spend% divides by dead stored `projects.budget` → header ~0% vs OverviewTab real % | `pages/project-detail/ProjectDetailHeader.tsx:105-107,152` | **Residual of W2-1** — header missed. Use `useProjectBudget(project.id)`. |
| B-0.4 | Imp | OverviewTab budget-utilization "$0 of $0" on load/error (useProjectBudget pending/error collapsed to 0) | `pages/project-detail/tabs/OverviewTab.tsx:64-66,150-177` | **Residual of W2-1/G1** — add isPending/isError + ListState. |
| B-0.5 | Imp | AwaitingApprovalTile "0 / nothing waiting" on query error | `src/components/dashboard/AwaitingApprovalTile.tsx:46-66` | **Residual of G2** — read isError, surface "—" (match ExecutiveDashboard approvalError). |
| B-0.3 | Imp | FinanceDashboard Budget-review "No project spend yet" on RPC error | `src/components/dashboard/FinanceDashboard.tsx:185,357` | Add isError/refetch branch (mirror ReadyToPayTable). |
| B-0.6 | Imp | Budget line-item create/update swallows failure (no toast); edit row never exits | `pages/ProjectBudget.tsx:106-134, btns :223,:321` | Wrap awaits → classifyMutationError + toast (mirror procurement LineItemsSection). |
| B-0.7 | Imp | Budget line-item Save no pending-disable → double-click dupes | `pages/ProjectBudget.tsx:223,321; props :815-825` | Thread isPending → loading/disabled on Save (+ re-entrancy guard). |
| C-PD-1 | Min→**fix** | Gantt **undated** task chips inert while dated bars activate (owner "Gantt unusable", localized) | `pages/project-detail/ProjectGantt.tsx:338-345` | **Residual of my Gantt fix** — thread onActivateTask into UndatedFooter. |
| C-PR-2/E-2 | Min→**fix** | Procurement board nests `ProjectNameLink` (`<Link>`) inside `role=button` KanbanCard → invalid HTML / ambiguous activation | `components/ProcurementBoard.tsx:46-50` | **Residual of fix-wave-1 PA** — stopPropagation or render project as inert text on board cards. |
| C-PR-1 | Min→**fix** | Procurement board shows 7 empty stage columns on zero-result filter (Table view shows one clean empty) | `pages/Procurement.tsx:338-340` | Guard `filtered.length===0` → ListState "No requests match your filters" + Clear. |
| Q-1 | Min | Dead `\|\|` fallback in test assertion | `src/components/dashboard/__tests__/WinRateCard.error.test.tsx:41-45` | code-quality minor — tighten to single getByRole('alert'). |
| S-1 | Min | AC-JR-W1-09 has no owning test (ApprovalsQueue read-only grid project link) | add test mounting ApprovalsQueue | spec-reviewer minor — close traceability gap. |

### TIER 1 — fix-wave-3 (the owner's coherence/CRM complaints, completed) — DO (bounded, high-value)
| ID | Sev | Finding | Location | Fix |
|---|---|---|---|---|
| E-1 | **Imp** | No shared `CompanyNameLink`/`ContactNameLink` (only ProjectNameLink) → Company/Contact/Vendor names dead text on ~9 surfaces | see below | **Extract `CompanyNameLink`+`ContactNameLink` siblings of ProjectNameLink**, apply everywhere. Closes D-1, PL-1, PL-2, PRD-1, CD-2, AD-1. **The dominant dead-display class.** |
| ↳ sites | | Customer cell `Projects.tsx:293-299`; card client `ProjectCardShell.tsx:104-107`; vendor `ProcurementDetails.tsx:534,540`; margin bars `ProjectedMarginBars.tsx:51-74`(D-1); activity contact `CompanyDetail.tsx:659-675`(CD-2) | | |
| B (consistency) | **Imp** | Approval row-shell divergence (chevron *order* fixed by ADR-0028, *container* not): Timesheet uses shared `ApprovalRow` (gap-3/py-[11px]/items-center/avatar) vs Procurement bespoke div (gap-2/py-3/items-start/no avatar) | `ApprovalRow.tsx:46-69` vs `ProcurementApprovalRow.tsx:103-144` | Route ProcurementApprovalRow through shared `ApprovalRow` shell (or extract `ApprovalRowShell`). **Owner's chevron complaint, root cause.** |
| CD-1/CT-1 | **Imp** | CRM activity timeline is write-only — can't open/edit/delete a logged activity | `CompanyDetail.tsx:659-675`, `ContactDetail.tsx:396-414` | Per-row edit/delete gated by `can(...,'contactActivity')` + crmActivities update/delete mutation (check 0030 RLS supports it). |
| CD-3 | Min→fix | Related Procurement only shows when `company.type==='Vendor'` → dual-role accounts hide real PRs | `CompanyDetail.tsx:221-223,435-451` | Render whenever `useProcurementsByVendor` returns rows, not gated on `type`. |
| CD-4 | Min→fix | Contactless company shows NO Activity section (cold-start dead-end) | `CompanyDetail.tsx:581-583` | Render empty Activity card w/ "Add a contact to start logging activity" → opens Add-contact. |
| D-2 | Min→fix | BvA at-risk row: trailing chevron is a false affordance (only name navigates) | `src/components/dashboard/BvACard.tsx:59-65` | Make whole row one Link or drop the chevron. |
| C-Mobile | **Imp** | PageHeader + BvACard don't wrap/truncate @390 → overflow on every record page + landing dashboard | `src/components/ui/PageHeader.tsx:52-68`; `BvACard.tsx:40-55` | flex-wrap + min-w-0 + truncate + shrink-0; **add @390 PageHeader test**. (ProgressBar cn min-w trap `ProgressBar.tsx:55` compounds — address here.) |
| D (consistency) | Min | `ROLE_PILL`/`VERSION_PILL` local maps bypass the CW-2 registry; ROLE_PILL reuses workflow-green for a category | `AdminUsers.tsx:60-66`, `ProjectBudget.tsx:32-36` | Move into `statusVariants.ts` (roleVariant/budgetVersionVariant, categorical tints). |
| C (consistency) | Min | Noun: "Couldn't load lost **deals**" vs sub "lost **projects**" in one card | `SalesPipeline.tsx:447` | → "lost projects". |
| Dead-code | Min | Delete dead components (only remaining hardcoded-status-colour + stale-noun sources) | `ProjectPipelineStepper.tsx`, `ProjectStatusBadge.tsx`, `TimesheetStatusBadge.tsx`; stale ContactDrawer comment `ContactDetail.tsx:37` | Delete; add guard tests (no primary onActivate→Drawer; no local status-pill map). |
| Resilience | Min | xlsx export no `.catch` → silent fail (button appears dead) | `src/components/export/useExport.ts:19-39` | catch → toast "Export failed". |

### Backlog (deferred — NOT in fix-wave-3)
- **Incident items (owner-descoped this program, "remove incident for now"):** IN-1 reporter "Reported by" field; IN-2 Admin delete/archive on incident.
- **AD-2 — Admin deactivate/offboard user:** needs a security-definer RPC + `profiles.status` column (real backend feature) → its own signed issue. Interim: in-context note. (Honestly deferred, documented in `AdminUsers.tsx` header.)
- **SP-1 — Sales kanban "Won" column never populates:** decide `useWonDeals()` (ON_HAND_STATUSES) vs drop the column. Small; owner decision.
- **useCompanyActivities N+1** (code-quality minor): add a batch `listActivitiesForContacts` DAL method (`.in('contact_id', ids)`; index `crm_activities_contact_idx` exists).
- **Cosmetic data minors:** `formatCompactCurrency` `$1000.0K` near M boundary; `formatDocNumber` local-TZ parts; Gantt reversed-range clamps to 0.
- **a11y minor:** Funnel filter segments lack `aria-pressed` (color-only selected state) — `Funnel.tsx:32-47`.
- **Security Lows (pre-existing):** server-stamp `logged_by_id = auth.uid()` on crm_activities; `mailto` recipient sanitization.
- **PMDashboard delivery chips / CompanyDetail primary-contact / TasksTab milestone-error** — graceful-degradation minors (acceptable; optional muted "—").

---

## fix-wave-3 plan-of-record (sequential groups on `jtbd-remediation`)
> Same executor model as wave-2: **sequential non-worktree implementer groups** (the Workflow worktree-fork was inconsistent — see LESSONS). Each group TDD → commit on `jtbd-remediation`; central gate after; then a **final fresh re-audit** to confirm 0 Crit / 0 Imp before PR.

- **G3a — Criticals + W1/W2 residuals (TIER 0): ✅ DONE** (`e1e2b0d`, 2986 unit / typecheck 0 / lint 0). All 12 items: B-0.1 cache-key, B-0.2 header budget, B-0.4 OverviewTab tile, B-0.5 AwaitingApprovalTile, B-0.3 FinanceDashboard, B-0.6/0.7 ProjectBudget line-item, C-PD-1 Gantt undated, C-PR-2 board link-in-button (project name → inert text, single activation), C-PR-1 board empty-state, Q-1 + S-1 test fixes.
- **G3b — Shared link class + approval shell (TIER 1 coherence, owner complaints): ✅ DONE** (`9774e5c`, 3004 unit / typecheck 0 / lint 0). `CompanyNameLink`+`ContactNameLink` + applied (E-1: D-1 margin-bars→/sales?status= + SalesPipeline reads it, PL-1 Customer cell, PL-2 card client [grid; kanban stays inert — invalid-HTML guard], PRD-1 vendor, CD-2 activity contact, AD-1 manager scroll-to-row, D-2 dropped false chevron); `ProcurementApprovalRow` routed through shared `ApprovalRow` shell (B — identical container/avatar).
- **G3c — CRM hub completion:** CD-1/CT-1 editable/deletable activity; CD-3 type-independent procurement; CD-4 cold-start empty.
- **G3d — Mobile overflow + consistency + dead-code:** PageHeader/BvACard @390 (+test, ProgressBar cn); ROLE_PILL/VERSION_PILL→registry (D); noun (C); delete dead components + guard tests; xlsx export catch.

**Pre-assigned numbers:** no new migration expected (all FE/test); if CRM activity delete needs an RLS check, confirm 0030 already grants it (no new migration). Next ADR if needed: **0030**. Next migration if needed: **0034**. Next pgTAP if needed: **0076**.

## LESSONS (this program — for the durable record)
- **Workflow `isolation:'worktree'` forked from INCONSISTENT bases** (some pre-P0 `main`, some post-P0 HEAD) → 7/10 consumer pkgs re-created `ProjectNameLink`; integrated via post-P0 plain merges + pre-P0 `-X ours` (P0 seam wins) + manual dedup. **For waves that overlap prior in-flight work, build SEQUENTIALLY on the integration branch, not parallel worktrees.**
- **Run `typecheck` after EVERY edit batch** — lint/build/vitest do NOT full-typecheck (a removed import surfaced only at the next `tsc`).
- **The fresh re-audit earns its keep:** it caught 2 residuals from my own waves (header budget, AwaitingApprovalTile) + a pre-existing critical (cache-key) the first broad pass missed.
- **"Find as many as possible" on a real app is unbounded** — each exhaustive pass surfaces a fresh minor tail. Convergence criterion adopted: **fix all Critical + Important + my-own-residuals, backlog the cosmetic/again-deeper minors, then one final re-audit; declare converged when it returns 0 Crit / 0 Imp.**
