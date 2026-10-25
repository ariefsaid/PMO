# Administration and integrations — #806 phase 2

Builder brief; Operate mode; source baseline `d18ba06b`. Whole-page recomposition, docs only here. Authority: OD-VISUAL-RESET, OD-REDESIGN-SCOPE and amended OD-ROUTE-JTBD in [decisions](../../decisions.md), [UX-STANDARD](../UX-STANDARD.md), [PRODUCT](../../../PRODUCT.md), [shell frame](shell.md). ADR-0068 colours/fonts/radii stay; never delete data/schema; synthetic evidence only.

## PA-00 comes first

[Every route × all five personas](admin-inventory.md#pa-00-route-jobs) states arrival expectation and finished job, including denied roles and the separate Operator capability. Keep the nine named administration jobs and personal connections; Admin/Executive visibility does not grant edit rights.
Decisions: MERGE accounting’s embedded cost-attribution body into `/administration/cost-attribution`; replace it with a named link, redirect `/administration/accounting#cost-attribution` there. MERGE repeated connection/ownership cards into each service’s detail. RETIRE the always-visible untracked-list roll call, duplicate hosting notes and completed setup checklist; their useful records/options live in service disclosures. RETIRE fallback as a page: replace URL with the role-appropriate destination. Reasons and compatibility targets: [decision register](admin-inventory.md#merge-and-retirement-decisions).

## Shared composition contract

Adopt shell’s area bar → named return/breadcrumb → one route-job h1 → scope → toolbar → content → action bar (PA-01/02, N-01–04). Desktop uses a compact named section list beside a full content track; phone shows one “Administration sections” disclosure, closed on arrival; distinct jobs are links, never a long tab strip (N-03).
Search → filters/scope → sort → view → secondary → creation, omitting irrelevant controls (C-01). Label sort explicitly; columns identity → context → status/date → amount → actions; selection first only for batch review (C-03/04/05). Preserve filter/sort/section in URL and Back context (N-02/04).
Show each fact once with its decision (PA-03/04). Known empty offers the permitted first step; no-match offers Clear filters; failed reads offer Retry, never fabricated zero/Off/Disconnected (C-02/06, S-03). One abnormal-condition caveat per page combines affected scopes and remedies (S-04); field validation remains beside fields (E-04).
One filled primary in the active view; opening an editor transfers it to that editor’s final action after evidence, background actions quiet (A-01/02). Immediate switches need no artificial Save; read-only/settled views may have no primary. Verb + object, pending/saved/error feedback, cancellation and consequential confirmations remain (A-03/04, E-02–04).

## Target pages, in reading order

Detailed columns, disclosures, both ASCII widths and phone first screens: [page contracts](admin-inventory.md#target-page-contracts-and-sketches). Each row below is a whole page, not a card patch.

| Route (`/administration/` unless absolute) | Ordered body; one primary |
|---|---|
| `users` | Workspace scope → search/status/sort toolbar + **Invite user** → name/manager/role/status directory → row actions; invite/role/manager/status forms disclose only on request. Executive reads. |
| `integrations` | Shared scope + personal link → service rows with current readiness → selected service’s required decisions → completed setup/options disclosure. **Connect service**, **Finish setup**, or **Accept all clear matches**, one at a time. |
| `accounting` | Task section selector → selected saved values and evidence → editor; sections: posting accounts, tax/advances, purchase rules, spend approvers; cost attribution links to its canonical route. **Accept all clear matches** during account setup; otherwise **Save accounts** only inside its editor; immediate settings have no page Save. |
| `projects` | Future-project scope → numbering pattern + preview → service-line/sector options; separate named editors, one open at a time; **Save pattern** or **Save options** in active editor. |
| `credits` | Workspace scope → exact credit balance and unit → Operator **Grant credits** editor; read-only viewers have no primary. No usage duplicate. |
| `exchange-rates` | USD/IDR display-reference scope → latest-date sort / secondary New rate / **Upload rates** → publication date, source, exact IDR-per-USD rate → pagination → upload preview/overwrite confirmation. |
| `cost-attribution` | Scope and business effect → search/status/sort + **Add rule** → rule, projects/splits, effective dates/status, match, actions → edit/preview/end disclosure; version inside detail. |
| `usage` | Operator scope → period/action controls → monthly consumption table → **Diagnostics** disclosure with existing metrics and cache trend. No primary; Retry only on failure. |
| `features` | Operator scope → named capability rows + consequence → immediate switches and saved outcome → Preview and Always included disclosures. No page Save or invented primary. |
| `/integrations` | Personal scope → Microsoft 365 status/date → **Connect Microsoft 365** or **Reconnect Microsoft 365** → quiet Disconnect with confirmation; unknown status gets Retry. No organization setup here. |
| entry / fallback | `/administration` and unknown section replace to Users, or Exchange rates for Finance; legacy budget/numbering hashes preserve their targets. No extra page or primary. |

## Setup once, then exceptions

Auto-propose clear account/project/list matches at setup; present all proposals together, select clear matches by default and accept them in one batch. Ambiguous matches remain unselected and editable; preserve existing matches. Use “Project connections”, “Posting accounts”, “Start with PMO tasks” / “Start with existing list tasks”, not binding/tier/push-seed/pull-adopt (L-01/02).
Show the initial task source once for the ClickUp batch, with per-exception overrides and one consequence review; never make routine setup a project-by-project modal tour. Saved setup disappears from the action queue and stays under “View configured connections”. A new exception, ambiguity or consequential change reopens only affected work. Do not promise bulk completion if the service cannot confirm it: retain failed rows and truthful outcomes.
Usage diagnostics preserve the existing line figure, axes, units, legend and footprint across any period/action controls (S-02); insufficient data stays inside the figure frame. Missing pricing/data is unavailable, never zero (S-03), with one scoped remedy (S-04). Exact money/currency remains visible (S-05); credits remain credits.

## Builder acceptance

- [ ] Use the [inventory](admin-inventory.md#current-inventory) as content truth, the [PA-00 table](admin-inventory.md#pa-00-route-jobs) before composing, and the [capture matrix](admin-inventory.md#builder-screenshot-matrix) for decision-relevant route × role × state coverage at 1440×900 and 390×844, EN/ID, light/dark; pair before/after actions and navigation, recording URL and synthetic role.
- [ ] Verify PA-00–04, N-01–04, A-01–04, E-01–04, C-01–06, S-01–05, L-01/02: single fact, one primary, visible scope/sort, reachable canonical records, preserved confirmations/permissions, empty/no-match distinction and truthful unknowns. First phone screen must match each page’s stated job, not a menu wall.
- [ ] Machine evidence on recomposed routes: one h1; no document overflow at 390; ≥44×44 phone targets; axe serious/critical = 0; empty detector findings; existing semantic tokens only; `scripts/ux-proof.sh` clean. Owner judges rendered screenshots.
- [ ] Follow [test disposition](admin-inventory.md#test-disposition): delete look-only assertions at recomposition; retain behaviour, money, role, locale and a11y proofs with deliberate navigation-step updates. This docs delivery changes no tests or application code.
Evidence: `/shape`, source `/critique`, `/layout`, `/distill`, `/onboard`, Taste hierarchy/repetition/identity/state lenses and five requested UI/UX Pro Max searches applied; [methods and limitations](admin-inventory.md#method-and-static-detector). Static detector: **0 findings** on `pmo-portal/pages`, `pmo-portal/src/components/integrations`, `pmo-portal/src/components/admin`; pages scope includes unrelated pages. No rendered pass claimed.
