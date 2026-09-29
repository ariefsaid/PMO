# RIS Admin setup-to-first-project route × oracle matrix — spec (#688)

**Status:** proposed, 2026-09-28. **Authority:** `docs/design/2026-09-26-enterprise-coherence-brief.md`
(work package 7 and the "Start with an empty RIS organization" contract); `docs/qa-portfolio.md`
(`routes × oracles` denominator and graduation registry); `DESIGN.md` (Navigation, Organization
integration readiness, Overlays, Record-Open Rule, Accessibility posture); ADR-0010 (one owning test per
AC at the lowest sufficient layer); `docs/e2e-parallel-conventions.md`.

## Job story

When I, a RIS organization Admin, set up my organization and create our first project, I want every screen
on that route to tell me its state, my next permitted action, and how to get back, on desktop and phone, in
English and Bahasa Indonesia, so I can finish setup and start delivery work without guessing.

## What this issue delivers, and what it does not

1. A route × oracle matrix for the RIS Admin route. Each cell names the **deciding artifact**: an existing
   test (file › exact title), a shared-primitive test plus the route's wiring line, a sibling issue's AC,
   a new test added by this issue, or a follow-up finding.
2. Only the new lowest-layer tests that prove an outcome nothing proves today (AC-RAM-002..005), plus
   **one** curated cross-stack Playwright journey (AC-RAM-001).
3. Confirmed rendered findings recorded in the `docs/qa-portfolio.md` graduation registry.

It changes no app behavior. Every new test is expected to pass against shipped code, except that
AC-RAM-004 (axe in both themes) has never run on these routes. If it finds violations, they are findings
and the Director decides whether this issue fixes them (see the plan's stop rule).

**Code proof vs live RIS proof.** Every "proven" cell below is **code proof**: the seed-org sample Admin
(`admin@acme.test`) on the local stack, with external services mocked or seeded. It proves layout,
navigation, states, and contracts. It does **not** prove that the RIS organization's Microsoft 365 or
ERPNext connections move real data. Those are separate manual acceptance items (§ Live RIS proof). This
matrix marks none of them as proven.

## Routes (rows) and oracles (columns)

| Row | Route | Owns |
|---|---|---|
| R1 | `/administration/users` | the organization's people and roles |
| R2 | `/administration/integrations` | organization connections (ClickUp, ERPNext, Microsoft 365 organization approval) |
| R3 | `/administration/accounting` | default tax treatment + budget account map |
| R4 | `/administration/credits` | organization credit balance (grant is Operator-only) |
| R5 | `/integrations` | the Admin's own Microsoft 365 connection card |
| R6 | `/projects` | the delivery list and the "New project" create entry |
| R7 | `/sales` | the pipeline list where a newly created (Leads) project lives |
| R8 | `/projects/:id` | the first project's record (pipeline lens pre-win, delivery lens after win) and its return path |

| Col | Oracle | Passes when |
|---|---|---|
| O1 | loading | a busy state shows; no stale or empty claim is made while loading |
| O2 | empty | an empty collection is identified as empty, distinct from zero matches |
| O3 | error + retry | a failed read is identified as a failure, with a retry or stated remedy |
| O4 | permission | the Admin sees the permitted action; other roles see a read-only or denied state |
| O5 | pending | an in-flight write shows progress and cannot be repeated by accident |
| O6 | success | success names the changed record or state, without overclaiming (for example, "connected" is not "synced") |
| O7 | keyboard / focus | the task completes by keyboard; focus lands predictably |
| O8 | accessible names | controls and regions have accessible names (axe WCAG 2 A/AA name rules) |
| O9 | 390px | no horizontal bleed at 390px; the primary controls stay reachable |
| O10 | light / dark | WCAG-AA contrast holds in both themes |
| O11 | EN / ID | fixed copy renders in English and Bahasa Indonesia |
| O12 | return path | Back, breadcrumb, or return link lands where the user came from |

**Cell status codes.** **P** proven by a test of this route · **S** proven by a shared-primitive test,
with the route's wiring line cited · **N** unproved; a new test in this issue owns it · **F** unproved and
failing by code evidence, recorded as a follow-up finding · **D** owned by an in-flight sibling issue's AC ·
**NA** the route does not own this state (reason given).

## Summary grid

|    | O1 | O2 | O3 | O4 | O5 | O6 | O7 | O8 | O9 | O10 | O11 | O12 |
|----|----|----|----|----|----|----|----|----|----|-----|-----|-----|
| R1 | P | P | P | P | S | P | P | N | P | N | F | P |
| R2 | P | P | P | P | P | P | S | N | P | N | F | P |
| R3 | P | NA | F | P | N | P | P | N | P | N | F | P |
| R4 | N | NA | N | P | S | P | P | N | P | N | F | P |
| R5 | D | P | P | P | P | P | D | N | N | N | D | P |
| R6 | P | P | P | P | S | P | P | N | P | N | F | P |
| R7 | P | P | P | P | S | P | P | N | P | N | F | N |
| R8 | P | P | F | P | S | P | P | N | N | N | P | P |

**96 cells:** 55 P + 6 S = **61 proven** (all code proof) · 22 N (closed by AC-RAM-001..005 in this
issue) · 8 F (follow-ups F-1, F-2, F-5, F-6) · 3 D (#689) · 2 NA.

## Matrix detail — the deciding artifact per cell

Paths are relative to `pmo-portal/`. A test is cited as `file` › "exact title".

### R1 `/administration/users`

| Oracle | St | Deciding artifact |
|---|---|---|
| O1 | P | `pages/AdminUsers.test.tsx` › "AC-AU-001: loading skeleton while pending" |
| O2 | P | `pages/AdminUsers.test.tsx` › "AC-AU-001: empty state when no users" |
| O3 | P | `pages/AdminUsers.test.tsx` › "AC-AU-001: error state with retry" |
| O4 | P | `pages/AdminUsers.test.tsx` › "AC-AU-002: Executive gets a read-only directory — no Invite user, no row actions, a read-only notice"; › "AC-AU-002: a non-admin, non-exec role (Engineer) reaching the route sees an Admin-only gate, not the directory" |
| O5 | S | `src/components/ui/__tests__/EntityFormModal.test.tsx` › "loading => spinner + aria-busy and the Esc/scrim close is blocked"; wiring `pages/AdminUsers.tsx:448,463,475,484` |
| O6 | P | `e2e/serial/AC-AU-001-admin-users-crud.spec.ts` › "AC-AU-001 + AC-AU-003 + AC-AU-004: an Admin views the directory, changes a role (with confirm), and assigns a manager — goal oracle: the role pill and manager column reflect the changes" |
| O7 | P | `pages/AdministrationShell.test.tsx` › "AC-ADMIA-005: Tab walks the section links in order and Enter activates the destination"; `pages/AdminUsers.test.tsx` › "AC-AU-003: Edit role opens a focused modal; a high-impact role change routes through a confirm before the mutation" |
| O8 | N | AC-RAM-004 › "AC-RAM-004 administration-users @light passes axe-core (WCAG-AA)" |
| O9 | P | `e2e/AC-ADMIA-005-administration-mobile.spec.ts` › "AC-ADMIA-005: Administration destinations stay reachable and overflow-free at desktop, phone, and phone dark mode" |
| O10 | N | AC-RAM-004 › "AC-RAM-004 administration-users @dark passes axe-core (WCAG-AA)" (dark-theme 390px overflow is already P in AC-ADMIA-005) |
| O11 | F | **F-1.** The panel's copy in `pages/AdminUsers.tsx` is hard-coded English (for example `title="Couldn't load users"`, `title="Invite user"`, `label="Role"`). Only the shell `pages/Administration.tsx` is in the i18n completeness gate (`src/lib/i18n/launch-scope-routes.txt`, `/administration/:section`). |
| O12 | P | `e2e/AC-ADMIA-001-administration-navigation.spec.ts` › "AC-ADMIA-001: an org Admin journeys through the four destinations with coherent location/heading/panel and Back restores the prior section" |

### R2 `/administration/integrations`

| Oracle | St | Deciding artifact |
|---|---|---|
| O1 | P | `src/components/integrations/IntegrationsView.test.tsx` › "shows loading skeleton while fetching"; › "AC-IRUX-007 shows a loading state while ownership loads (read only)" |
| O2 | P | same file › "AC-EAS-015 (a) empty ownership ⇒ connect cards render with Not connected status, Employed domains section empty"; › "AC-IRUX-007 empty ownership shows an explicit empty state and no write controls" |
| O3 | P | same file › "AC-IRUX-001 binding-read failure: connection state is unknown (not disconnected), Retry is offered, and the permitted Connect remains (no Disconnect from an unknown binding)"; › "AC-IRUX-007 unavailable ownership shows an explicit error + Retry and no write controls" |
| O4 | P | same file › "renders cards WITHOUT Connect/Disconnect buttons for Engineer" (and the Project Manager and Finance cases); › "OD-INT-6 a non-Admin sees no Select Company control (server is the real gate)"; › "AC-M365SEP-017: the M365 organisation-approval affordance is NOT rendered for a non-Admin (FE Admin-only; edge re-enforces)" |
| O5 | P | same file › "AC-IRUX-005 a failed activation keeps the dialog open, retains the selection, shows a generic error, and permits another attempt"; `src/components/integrations/__tests__/M365OrgApprovalCard.test.tsx` › "FR-M365SEP-005: a double-click does not fire two initiate calls (in-flight guard)"; wiring `src/components/integrations/IntegrationsView.tsx:663,729,809` |
| O6 | P | same file › "AC-IRUX-002: a successful binding is labelled Connected, and absent connector identity is not shown as a blank field"; `e2e/AC-EAC-018-connect-link-sync.spec.ts` › "AC-EAC-018: admin connects ClickUp → links project → edits task → webhook converges back; card names live verification; outbox confirmed". Code proof only; LIVE-3 and LIVE-4 below. |
| O7 | S | `src/components/ui/__tests__/EntityFormModal.test.tsx` › "Tab from the last focusable wraps to the first (focus trap)"; `src/components/ui/__tests__/ConfirmDialog.test.tsx` › "AC-CONFIRM-004: while loading, Escape does NOT close"; wiring as O5 |
| O8 | N | AC-RAM-004 › "AC-RAM-004 administration-integrations @light passes axe-core (WCAG-AA)" |
| O9 | P | AC-ADMIA-005 (title as R1 O9); `IntegrationsView.test.tsx` › "FR-IRUX-010: the tier header reflows (flex-wrap) so the long activation status never overflows at 390px" |
| O10 | N | AC-RAM-004 › "AC-RAM-004 administration-integrations @dark passes axe-core (WCAG-AA)" |
| O11 | F | Partial: `IntegrationsView.test.tsx` › "renders Bahasa readiness copy for an Admin on an unactivated ERPNext binding"; › "AC-ICI-002 shows the translated fallback in Bahasa and never the English string". `IntegrationsView.tsx` is not named in the i18n gate, so completeness is unproved (**F-1**). |
| O12 | P | AC-ADMIA-001 (title as R1 O12) |

### R3 `/administration/accounting`

| Oracle | St | Deciding artifact |
|---|---|---|
| O1 | P | `pages/admin/BudgetAccountMap.test.tsx` › "shows a loading state while the map is fetching" |
| O2 | NA | The map always lists the seven budget categories; the org default is `not null default 'exclusive'` (`supabase/migrations/0207_org_default_tax_treatment.sql:26`). There is no empty collection. |
| O3 | F | Map: P, `BudgetAccountMap.test.tsx` › "shows an error state with retry on a failed fetch". Tax default: **F-6.** `useOrgTaxDefault` returns only `data`, and `OrgTaxDefault.tsx:81` renders the loading skeleton while the value is `undefined`. A failed read therefore shows a skeleton indefinitely, with no error or retry. |
| O4 | P | `BudgetAccountMap.test.tsx` › "a non-Admin (Engineer) sees the same rows read-only — no write affordances"; `pages/admin/OrgTaxDefault.test.tsx` › "#548: %s sees the value but NO control — an accounting posture is an Admin decision" |
| O5 | N | AC-RAM-005 (tax default select disabled while the write is in flight; wiring `OrgTaxDefault.tsx:90`). Map: `ConfirmDialog.test.tsx` › "AC-CONFIRM-006: clicking confirm while loading does not re-fire onConfirm (double-click guard)", wiring `BudgetAccountMap.tsx:264,335` |
| O6 | P | `BudgetAccountMap.test.tsx` › "maps a previously-unmapped category (create)"; `OrgTaxDefault.test.tsx` › "#548: changing it writes through the repository seam" |
| O7 | P | `BudgetAccountMap.test.tsx` › "AC-ADMIA-004 deep-links via #budget-account-map: the map scrolls into view and receives focus" |
| O8 | N | AC-RAM-004 › "AC-RAM-004 administration-accounting @light passes axe-core (WCAG-AA)" |
| O9 | P | AC-ADMIA-005 (title as R1 O9) |
| O10 | N | AC-RAM-004 › "AC-RAM-004 administration-accounting @dark passes axe-core (WCAG-AA)" |
| O11 | F | **F-1.** `pages/admin/BudgetAccountMap.tsx` is hard-coded English (for example "Budget account map", "Not mapped — blocks every push"); `OrgTaxDefault.tsx` uses `t()` but is not named in the gate. |
| O12 | P | AC-ADMIA-001 (title as R1 O12; includes the historical `#budget-account-map` link) |

### R4 `/administration/credits`

| Oracle | St | Deciding artifact |
|---|---|---|
| O1 | N | AC-RAM-002 › "AC-RAM-002: while the balance loads, a busy skeleton shows and no balance figure is claimed" |
| O2 | NA | A balance is a number, including zero: `pages/__tests__/AdministrationCredits.balanceUnit.test.tsx` › "renders the balance with the \"credits\" unit, not a bare number" |
| O3 | N | AC-RAM-002 › "AC-RAM-002: a failed balance read shows an error with Retry, and Retry re-reads to the balance" |
| O4 | P | `e2e/AC-CRE-004-grant.spec.ts` › "AC-CRE-004: the Operator grants credits and an org Admin subsequently sees the updated balance read-only — goal oracle: the grant persists across sessions" |
| O5 | S | Grant is Operator-only; `EntityFormModal.test.tsx` loading test (as R1 O5); wiring `pages/AdministrationCredits.tsx:132` |
| O6 | P | AC-CRE-004 (as O4); `pages/__tests__/AdministrationCredits.saveError.test.tsx` › "AC-ERR-001: the rejection is shown IN the dialog and is still there after the toast has gone" |
| O7 | P | `AdministrationShell.test.tsx` › "AC-ADMIA-005: Tab walks the section links in order and Enter activates the destination" (the Admin has no control inside this panel) |
| O8 | N | AC-RAM-004 › "AC-RAM-004 administration-credits @light passes axe-core (WCAG-AA)" |
| O9 | P | AC-ADMIA-005 (title as R1 O9) |
| O10 | N | AC-RAM-004 › "AC-RAM-004 administration-credits @dark passes axe-core (WCAG-AA)" |
| O11 | F | **F-1.** `pages/AdministrationCredits.tsx` is hard-coded English ("Couldn't load balance", "Org balance", "credits", "Grant credits"). |
| O12 | P | AC-ADMIA-001 (title as R1 O12) |

### R5 `/integrations` (personal Microsoft 365 card)

| Oracle | St | Deciding artifact |
|---|---|---|
| O1 | D | #689 AC-M365LOC-001 (no current test asserts the "Checking Microsoft 365 connection status…" state) |
| O2 | P | `src/components/integrations/__tests__/M365ConnectionCard.test.tsx` › "AC-M365-022: an absent connection renders \"Not connected\" + a Connect button (the default)" |
| O3 | P | same file › "AC-M365-023: a 500 INTERNAL_ERROR on the status fetch → unknown banner, NOT \"Connected\", NO Disconnect". The stated remedy is a page refresh; #689 deliberately keeps this state machine. A failed disconnect gains retry under #689 AC-M365LOC-005. |
| O4 | P | same file › "AC-M365-012: hidden when the org is NOT entitled (and the status fetch never fires)"; › "AC-M365SEP-016: an entitled member (any role) renders the card with an enabled Connect button" |
| O5 | P | same file › "AC-M365-016: two rapid clicks invoke initiate_connect exactly once" |
| O6 | P | same file › "AC-M365-017: shows Connected + Disconnect, and the param is removed from the URL"; `e2e/AC-M365SEP-018-integrations-route.spec.ts` › "AC-M365SEP-018: callback return ?m365_connected=true resolves on a real page (personal connect success)". Code proof only; LIVE-2 below. |
| O7 | D | #689 AC-M365LOC-005 (focus moves to the in-dialog alert); shared `ConfirmDialog.test.tsx` › "AC-CONFIRM-004: while loading, Escape does NOT close" |
| O8 | N | AC-RAM-004 › "AC-RAM-004 personal-integrations @light passes axe-core (WCAG-AA)"; localized dialog names come with #689 AC-M365LOC-003 |
| O9 | N | AC-RAM-003 › "AC-MOBILE-OVERFLOW-001 personal-integrations (AC-RAM-003) @390" |
| O10 | N | AC-RAM-004 › "AC-RAM-004 personal-integrations @dark passes axe-core (WCAG-AA)" |
| O11 | D | #689 AC-M365LOC-002. The page shell is P: `pages/Integrations.test.tsx` › "labels the route as personal integrations with a separating description", with `pages/Integrations.tsx` in the i18n gate. |
| O12 | P | `src/components/shell/__tests__/breadcrumb-nav.test.ts` › "AC-ADMIA-006: the PERSONAL route breadcrumb resolves to \"My integrations\", distinct from the organization section label"; `src/components/shell/__tests__/Rail.test.tsx` › "AC-ADMIA-006: the personal rail item is labelled \"My integrations\" when the m365 entitlement is on" |

### R6 `/projects`

| Oracle | St | Deciding artifact |
|---|---|---|
| O1 | P | `pages/Projects.test.tsx` › "shows loading state while pending (AC-405)" |
| O2 | P | same file › "C3: shows the teaching empty state with a live New project CTA when zero rows (AC-406)"; › "shows a filter-no-match empty state with a clear-filters action (AC-D)" |
| O3 | P | same file › "shows error state with retry on failure (AC-408)" |
| O4 | P | same file › "AC-PRJ-007: Finance does NOT see \"New project\" (FE stricter than RLS — Finance owns money, not delivery)"; `src/auth/policy.test.ts` › "ADR-0016: create project = Admin·Exec·PM (Finance excluded in FE, Engineer no)" |
| O5 | S | `src/components/ui/__tests__/useEntityForm.test.tsx` › "isSubmitting is true while an async onValid is in flight then false after"; `EntityFormModal.test.tsx` loading test; wiring `components/ProjectFormModal.tsx:305` |
| O6 | P | same file › "AC-PRJ-003: a valid create submits name/status/client/PM/value to the mutation (origination = Leads)"; AC-RAM-001 additionally proves that the success message names the created project. Candidate **F-4**: the success message offers no route to the new record, and the list it was created from does not contain it. |
| O7 | P | `src/components/ui/__tests__/DataTable.rowclick.test.tsx` › "AC-ROWCLICK-DATATABLE-2: pressing Enter on the first-cell button activates the row (keyboard path)"; `pages/__tests__/Projects.mobileToolbar.test.tsx` › "AC-PRJUX-003: opening Filters moves focus into the first field"; `src/components/ui/__tests__/EntityFormModal.a11y.test.tsx` › "C-1: initial focus lands on the first FORM field, not the close button" |
| O8 | N | AC-RAM-004 › "AC-RAM-004 projects @light passes axe-core (WCAG-AA)" |
| O9 | P | `e2e/AC-MOBILE-OVERFLOW-001-no-horizontal-bleed.spec.ts` › "AC-MOBILE-OVERFLOW-001 projects-list @390"; `e2e/AC-PRJUX-003-mobile-disclosure-switch.spec.ts` › "AC-PRJUX-003: switching mobile toolbar disclosures keeps the tapped action reachable" |
| O10 | N | AC-RAM-004 › "AC-RAM-004 projects @dark passes axe-core (WCAG-AA)" |
| O11 | F | List: P (`pages/Projects.tsx` is in the gate). Create form: **F-2.** `components/ProjectFormModal.tsx` is outside the gate and hard-coded English ("Project name", "Client company", "Origination stage", "Create project"). |
| O12 | P | `pages/project-detail/__tests__/ProjectDetail.test.tsx` › "AC-NAV-007: \"Back to Projects\" navigates to the Projects module index (no tab)". Return with filters preserved: D #681/#682/#683 AC-LRC-003. |

### R7 `/sales`

| Oracle | St | Deciding artifact |
|---|---|---|
| O1 | P | `pages/SalesPipeline.test.tsx` › "AC-SP-203: loading renders the skeleton ListState (no spinner), aria-busy" |
| O2 | P | same file › "AC-SP-203 / C3: empty renders the teaching empty state with NO dead CTA"; `components/SalesKanbanBoard.test.tsx` › "AC-SP-204: an empty column shows the per-stage empty message" |
| O3 | P | same file › "AC-SP-203: error renders an alert + Retry that calls refetch" |
| O4 | P | same file › "AC-SP-202 / C3: renders the page title \"Pipeline\", the live Export action, and the live \"New project\" CTA for PM"; `policy.test.ts` create-project test (as R6 O4) |
| O5 | S | Same create modal as R6 O5 |
| O6 | P | `e2e/AC-W2-IXD-004-new-opportunity-from-pipeline.spec.ts` › "AC-W2-IXD-004: PM creates a new project from the Pipeline and it appears in the pipeline" |
| O7 | P | `pages/__tests__/SalesPipeline.funnel.test.tsx` › "AC-JR-W4-03: Funnel stage cell is keyboard-operable (Enter key)"; `src/components/ui/__tests__/composites.test.tsx` › "card Enter activates" |
| O8 | N | AC-RAM-004 › "AC-RAM-004 sales @light passes axe-core (WCAG-AA)" |
| O9 | P | `AC-MOBILE-OVERFLOW-001-no-horizontal-bleed.spec.ts` › "AC-MOBILE-OVERFLOW-001 sales-pipeline @390". Phone Kanban title readability: D #685. |
| O10 | N | AC-RAM-004 › "AC-RAM-004 sales @dark passes axe-core (WCAG-AA)" |
| O11 | F | Page: P (`pages/SalesPipeline.tsx` is in the gate). **F-2.** `components/SalesKanbanBoard.tsx` is outside the gate and hard-coded English: the board's accessible name "Sales pipeline board" and each empty column's `No projects in …` text. It also opens `ProjectFormModal`, which is outside the gate. Funnel amounts: D #687. |
| O12 | N | AC-RAM-001 (record → "Back to Sales Pipeline" → `/sales` containing the new project). Return with filters preserved: D AC-LRC-004. |

### R8 `/projects/:id` (the first project's record)

| Oracle | St | Deciding artifact |
|---|---|---|
| O1 | P | `pages/project-detail/__tests__/ProjectDetail.test.tsx` › "shows a loading state on a cold deep-link before the cache resolves" |
| O2 | P | same file › "switches to the Procurement tab and shows its real (empty) state"; › "switches to the real Tasks tab and shows its empty register (AC-TASK-001)" |
| O3 | F | Not found: P, same file › "I7: the not-found render keeps the \"Back to Projects\" escape route". Failed read: **F-5.** `pages/project-detail/ProjectDetail.tsx:171-193` does not read the list's or the by-id query's error state. When both reads fail, the page says "Project not found… or you don't have access" and offers no Retry. |
| O4 | P | `src/auth/policy.test.ts` › "ADR-0016: project lifecycle transition = Admin·Exec·PM·Finance (the shipped WRITE_ROLES)"; › "ADR-0016: archive project/company = Admin·Exec only" |
| O5 | S | Edit-header modal: wiring `components/ProjectFormModal.tsx:305` (as R6 O5) |
| O6 | P | `e2e/AC-PRJ-001-projects-crud.spec.ts` › "AC-PRJ-003 + AC-PRJ-004 + AC-PRJ-005: PM creates a project (Leads → in the Pipeline), edits its header on the canonical detail page, then Exec archives it"; `e2e/AC-1011-win-project.spec.ts` › "AC-1011: a PM wins a deal — open it from the Pipeline, Mark won, enter customer contract ref + date, confirm; the deal becomes Won and shows in the active Projects list with the entered ref" |
| O7 | P | `pages/project-detail/__tests__/wave5-c3-pr2.test.tsx` › "AC-IXD-PROJ-W5-C3-14: \"Back to Sales Pipeline\" link is keyboard-reachable (tabIndex not negative)"; `src/components/shell/__tests__/AppShell.test.tsx` › "route change moves focus to main (focus-on-route-change), but never on first mount" |
| O8 | N | AC-RAM-004 › "AC-RAM-004 project-pipeline-lens @light passes axe-core (WCAG-AA)" and "AC-RAM-004 project-delivery-lens @light passes axe-core (WCAG-AA)" |
| O9 | N | Delivery lens: P, "AC-MOBILE-OVERFLOW-001 project-overview @390". Pipeline lens (where the first project starts): AC-RAM-003 › "AC-MOBILE-OVERFLOW-001 project-pipeline-lens (AC-RAM-003) @390" |
| O10 | N | AC-RAM-004 › the same two surfaces "@dark" |
| O11 | P | `npm run check:i18n` over `pages/project-detail/*.tsx` (launch-scope `/projects/:projectId`), which includes `PipelineLens.tsx` |
| O12 | P | `ProjectDetail.test.tsx` › "AC-NAV-007: \"Back to Projects\" navigates to the Projects module index (no tab)"; › "C-IMP-1: BackBar is present on the success render on mobile (< 768px viewport)"; `wave5-c3-pr2.test.tsx` › "AC-IXD-PROJ-W5-C3-13: \"Back to Sales Pipeline\" link is present in the Next-actions card at rest (before any transition)"; the journey is AC-RAM-001 |

## Findings from building the matrix (code evidence; rendered confirmation pending)

Each finding names who is affected and what goes wrong. The rendered Discover pass (plan Task 14)
confirms each finding before it enters the graduation registry. None is a security weakness.

| ID | Finding | Who is affected, and how | Cells |
|---|---|---|---|
| F-1 | The i18n completeness gate names only `pages/Administration.tsx` for `/administration/:section`. The gate's own comment says that this keeps "every Administration label" inside it, but an entry covers only the files it names. The panel components `AdminUsers.tsx`, `IntegrationsView.tsx`, `admin/OrgTaxDefault.tsx`, `admin/BudgetAccountMap.tsx`, and `AdministrationCredits.tsx` are unchecked, and three of them contain hard-coded English. | A RIS Admin working in Bahasa sees English Users, Accounting, and Credits panels. | R1–R4 O11 |
| F-2 | Components on the first-project route are outside the gate: `components/ProjectFormModal.tsx` (reached from `/projects` and `/sales`) and `components/SalesKanbanBoard.tsx` (the default `/sales` view). Both contain hard-coded English, including the board's accessible name. | A RIS Admin working in Bahasa creates the first project in an English form; a screen reader announces the board in English. | R6, R7 O11 |
| F-3 | Money inputs show a hard-coded `$`: `components/ProjectFormModal.tsx:384,413` (Estimated value, tax amount) and `pages/project-detail/ProjectDetailHeader.tsx:322,345` (Contract value, tax amount). This contradicts the FR-L10N-020 rule, and the `currencySymbol` helper already exists in `src/lib/format.ts:151`. | A RIS Admin in an IDR organization enters an estimated or contract value beside a dollar sign. | money data-correctness, R6/R8 (outside the O1–O12 grid) |
| F-4 | Creating a project from `/projects` (origination Leads) shows "Project created · <name>" but no link to the record. The Projects list excludes pre-win projects (ADR-0020), so in an empty organization the list stays empty after a successful create. | A first-time RIS Admin may believe the create failed and create the project again. **Ruled 2026-09-28 (Director, revisitable):** create opens the new record at `/projects/:id`, matching the Meetings precedent (`pages/Meetings.tsx` create handler). Fixed in this issue (FR-RAM-009, AC-RAM-006). | R6 O6 |
| F-5 | The project record treats a failed read as "not found" (details in R8 O3). | A RIS Admin on a poor connection is told that the first project does not exist, with no retry. | R8 O3 |
| F-6 | The default tax treatment shows a loading skeleton indefinitely when its read fails (details in R3 O3). | A RIS Admin cannot tell whether an outage has happened or the page is still loading, and has no way to recover. | R3 O3 |
| F-7 | The pipeline-lens record (`/projects/:id`, R8) panned to ~618px at 390px/360px: `PipelineLens`'s two-card grid had no `min-w-0` on either grid item, so the Journey card's un-wrapped `LifecycleStepper` step row set the shared single-column track's floor past the viewport (AC-RAM-003). | A RIS Admin opening their first project on a phone has to pan the whole page sideways to read the Next-actions card. **Fixed here** (AC-RAM-003, `PipelineLens.tsx` `grid-cols-1` + `min-w-0`). | R8 O9 |

## Live RIS proof (separate manual acceptance; never claimed here)

The owner runs these with a real RIS sign-in on the hosted environment. Each passes only on a
**data-carrying** check, per the brief's exit evidence. This matrix and its tests do not satisfy any of
them.

| ID | Live check | Code-proof cells it extends |
|---|---|---|
| LIVE-1 | A RIS Admin signs in with a real RIS identity and reaches Administration › Users with the organization's own members listed. | R1 O4/O6 |
| LIVE-2 | The RIS Admin connects their own Microsoft 365 account on `/integrations`, sees Connected, and then sees one real OneDrive or calendar item from that account inside a project. | R5 O6 |
| LIVE-3 | The RIS tenant's Microsoft 365 administrator approves the PMO Portal app from Organization integrations, and a member's personal connection then succeeds. | R2 O6 |
| LIVE-4 | The RIS Admin connects and activates ERPNext for the RIS Company, one PMO outbound record is confirmed in ERPNext, and one ERPNext record is read back into PMO. | R2 O6 |

## Requirements (EARS)

- **FR-RAM-001 (ubiquitous):** The matrix shall assign every cell of R1–R8 × O1–O12 exactly one status
  (P, S, N, F, D, NA) and name its deciding artifact; a P or S cell shall cite a file and an exact test
  title.
- **FR-RAM-002 (ubiquitous):** The matrix shall label its proofs as code proof on the seed-org sample
  Admin and shall not mark any LIVE item as proven.
- **FR-RAM-003 (event-driven):** When the sample Admin goes from Administration › Organization integrations
  to Projects, creates a project, lands on its new record, and activates "Back to Sales Pipeline", the application shall show a success message naming the
  project, open the canonical `/projects/:id` record in its pipeline lens, and return to `/sales` with the
  project visible.
- **FR-RAM-004 (state-driven):** While the Credits balance is loading, the Credits section shall show a
  busy state and no balance figure. When that read fails, it shall show an error with Retry, and Retry
  shall re-read the balance.
- **FR-RAM-005 (state-driven):** While an Admin's change to the default tax treatment is being written,
  the control shall be disabled.
- **FR-RAM-006 (ubiquitous):** The personal integrations page, with its Microsoft 365 card rendered, and a
  pipeline-lens project record shall have no element that extends past the viewport's right edge and no
  horizontal page pan at 390px and 360px.
- **FR-RAM-007 (ubiquitous):** Each RIS Admin surface R1–R8, including both project lenses, shall have no
  axe-core WCAG 2 A/AA violation in the light or dark theme when settled with seed data.
- **FR-RAM-008 (event-driven):** When the rendered Discover pass confirms a finding, the finding shall be
  recorded in the `docs/qa-portfolio.md` graduation registry with its owning test, matrix cell, and
  `DESIGN.md` or decision note.
- **FR-RAM-009 (event-driven):** When an Admin creates a project from `/projects` and the create succeeds, the application shall show a success message naming the project and open its canonical `/projects/:id` record.
- **NFR-RAM-001:** New e2e specs shall be `read-only` or `self-isolated` (no serial-lane additions), mock
  `functions/v1` instead of depending on served edge functions, and use the seed-org sample Admin.
- **NFR-RAM-002:** This issue shall change no application source, schema, route, permission, or
  configuration, except the FR-RAM-009 create destination and a token-level or one-file fix the Director admits under the AC-RAM-004 stop rule.
  **Director admission (2026-09-29):** the AC-RAM-004 axe run and the AC-RAM-003 overflow sweep both
  found real gate-test defects; fixing them (rather than reporting-only) is admitted under this NFR.
  Files touched, beyond FR-RAM-009/AC-RAM-006: `pmo-portal/index.css` (dark `--destructive` token,
  §"Unverified solids"), `pmo-portal/pages/Projects.tsx` (dropped `/80` opacity on the customer-contract
  cell), `pmo-portal/src/components/ui/StatTiles.tsx` (`text-success` → `text-success-text`),
  `pmo-portal/src/components/ui/Tabs.tsx` (active-tab `text-primary` → `text-primary-text`),
  `pmo-portal/src/components/milestones/MilestonePhaseHeader.tsx` ("Current" badge and Edit-progress
  link, same token swap plus dropping the contrast-losing `opacity-60`),
  `pmo-portal/src/components/ui/LifecycleStepper.tsx` (bar-variant scroll viewport: `role=group` +
  `tabIndex=0` wrapper, `scrollable-region-focusable`), `pmo-portal/pages/project-detail/PipelineLens.tsx`
  (`grid-cols-1` base + `min-w-0` on both grid items, the AC-RAM-003 overflow root cause).
  **Director admission (2026-09-29, second round — regression + Discover follow-ups):** the first
  AC-RAM-004 fix darkened `--destructive` itself and broke `text-destructive`/the dot/bar (sub-AA in
  dark); a second rendered pass then found two further clipping/overlap gaps the axe scan itself
  cannot see. Both are fixed and gate-tested under this same admission. Additional files touched:
  `DESIGN.md` (§0/§"Unverified solids" — documents the `--destructive`/`--destructive-solid` split),
  `pmo-portal/index.css` (restores `--destructive` to its original dark hue; adds a dedicated
  `--destructive-solid` token in both themes), `pmo-portal/src/components/ui/buttonClasses.ts` (the
  `destructive` Button variant reads `bg-destructive-solid`, not `bg-destructive`),
  `pmo-portal/src/components/ui/__tests__/destructiveSolidToken.test.ts` (new — the token-split
  regression gate), `pmo-portal/pages/project-detail/MilestoneStrip.tsx` (mobile "Current" badge:
  `text-primary` → `text-primary-text`), `pmo-portal/src/components/milestones/MilestonePhaseHeader.tsx`
  (name column `break-words` + `min-w-0`, percentage column `min-w-[44px]`, so a long milestone name
  cannot render under the percentage at the 4-column desktop card width; `data-testid` added to both
  for the geometry gate), `pmo-portal/e2e/AC-RAM-004-ris-admin-geometry.spec.ts` (new — the focus-ring
  and name/percentage geometry gates), `pmo-portal/e2e/AC-RAM-004-ris-admin-axe.spec.ts` (adds a 390px
  re-scan of the two project-lens surfaces), `pmo-portal/src/components/ui/LifecycleStepper.tsx` (focus
  ring drawn inward — `outline-offset-[-2px]` — so the scroll region's clipping wrapper can no longer hide
  it; `data-testid="stepper-clip-wrapper"` added for the geometry gate).
  **Director admission (2026-09-29, third round — readability follow-up):** the second round's
  `break-words`+`min-w[44px]` fix stopped the name/percentage overlap but not the underlying squeeze —
  the milestone card grid was sized off the *viewport* (`sm:grid-cols-2 xl:grid-cols-4`) while it actually
  renders inside `ProjectDetail`'s narrower two-column record layout, so a forced 4th column at 1280/1440px
  left the name column readable-width-zero and `break-words` cut words mid-letter ("Enginee/ring",
  "Procure/ment"). Fixed and gate-tested under this same admission. Files touched:
  `pmo-portal/pages/project-detail/MilestoneStrip.tsx` (`milestone-card-grid`: `grid-cols-[repeat(auto-fit,minmax(220px,1fr))]`
  sizes columns off the grid's own rendered width instead of a viewport breakpoint),
  `pmo-portal/e2e/AC-RAM-004-ris-admin-geometry.spec.ts` (new describe block — every phase name's words
  render on one line at 1280px/1440px), `DESIGN.md` (milestone card note on narrow-card behavior),
  `docs/qa-portfolio.md` (new graduation row).

## Acceptance criteria and owning proof

| ID | Given / When / Then | Owning layer · test |
|---|---|---|
| **AC-RAM-001** | Given the seed-org sample Admin on desktop, when they open Administration › Organization integrations, go to Projects from the rail, create a uniquely named project, land on its new record, and activate "Back to Sales Pipeline", then: the success message names the project, the record opens at `/projects/:id` with the "Project stage journey" pipeline lens and the project heading, and `/sales` shows the project again. | E2E (curated journey) · `e2e/AC-RAM-001-ris-admin-first-project.spec.ts` |
| **AC-RAM-002** | Given the Credits section, when the balance read is pending, then a busy skeleton shows and no balance appears; when the read fails, then "Couldn't load balance" and Retry appear, and Retry re-reads and shows the balance. | Unit · `pages/__tests__/AdministrationCredits.states.test.tsx` |
| **AC-RAM-003** | Given the sample Admin at 390px and 360px, when `/integrations` (entitled, status unavailable) and the pipeline-lens record `/projects/40000000-0000-0000-0000-000000000011` settle, then no element extends past the right edge and the page does not pan horizontally. | E2E (L1 sweep) · `e2e/AC-MOBILE-OVERFLOW-001-no-horizontal-bleed.spec.ts` (routes labelled `(AC-RAM-003)`) |
| **AC-RAM-004** | Given the sample Admin at desktop width, when each of the nine surfaces (R1–R7, plus the pipeline and delivery lenses of R8) settles with seed data in the light theme and then the dark theme, then axe-core reports no WCAG 2 A/AA violation. | E2E (L1 gate) · `e2e/AC-RAM-004-ris-admin-axe.spec.ts` |
| **AC-RAM-006** | Given an Admin on `/projects`, when they submit a valid new project and the create succeeds, then the success message names the project and the app navigates to `/projects/<new id>`; when the create fails, the modal stays open and no navigation happens. | Unit · `pages/__tests__/Projects.createNavigation.test.tsx` |
| **AC-RAM-005** | Given an Admin on Accounting setup, when they change the default tax treatment and the write has not settled, then the control is disabled, and it becomes enabled again after the write settles. | Unit · `pages/admin/OrgTaxDefault.test.tsx` |

## Dependencies (referenced, not re-implemented)

| Issue | What this matrix relies on |
|---|---|
| #681/#682/#683 | `docs/specs/list-working-set-return.spec.md` AC-LRC-003 (Projects filtered return), AC-LRC-004 (Sales filtered return; the Sales link may carry a captured URL), AC-LRC-012 (empty vs zero-match), AC-LRC-013 (390px and Bahasa return). AC-RAM-001 enters `/sales` unfiltered, so it holds either way. |
| #684 | `docs/specs/personal-locale-completion.spec.md` AC-PLC-004/009 (money display and entry per locale). F-3 touches the same inputs. |
| #685 | Phone Kanban title readability on `/sales` and the Projects board (R7 O9) |
| #687 | Sales funnel amounts (R7 O11 data) |
| #689 | `m365-personal-connection-localization` AC-M365LOC-001..005 (R5 O1, O7, O11) |
| Shipped | PR #674 account menu, #676 Administration IA (AC-ADMIA-*), #678 integration readiness (AC-IRUX-*), #686 connector identity (AC-ICI-*) |

## Boundaries

No new route, dashboard, guided tour, or setup checklist. No change to permissions, RLS, schema, or edge
functions. No claim of live RIS readiness and no production promotion. Findings F-1 to F-3, F-5 and F-6 are
follow-ups; this issue records them and does not fix them. F-4 and F-7 are fixed here (AC-RAM-006,
AC-RAM-003 respectively) — F-7 under the NFR-RAM-002 Director-admission carve-out (2026-09-29), the seven
AC-RAM-004 axe-contrast/scroll-region fixes fall under the same admission.
