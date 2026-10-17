⚠️ DEGRADED: single-context (spawn_agent unavailable; Assessment A was recorded before detector results were read)

# PMO declutter Discover audit — 2026-10-16

**Mode:** Operate. **Status:** findings and proposed slices only; no implementation or shipment authorized. **Target:** the running PMO UI at app revision `3909b51c`, branch `docs/ux-declutter-audit`, based on `origin/dev`. Product context: [PRODUCT.md](../../PRODUCT.md). Visual authority: [DESIGN.md](../../DESIGN.md).

## Decision in one minute

The quiet shell is worth keeping. The problem is **feature-led task structure**, not a missing visual rebrand. Money, billing and integration setup make the owner assemble an answer from several systems' concepts. A phone amplifies the repeated context and hides the selected job.

1. **Trust before declutter:** reconcile dashboard money across roles; distinguish contract, procurement commitments, recorded ledger spending and incomplete coverage. A shorter wrong number is worse than a long honest explanation.
2. **One project, one money story:** keep one scoped summary leading into Spending, Forecast and Billing. Do not pretend these are interchangeable figures.
3. **Setup once, review exceptions:** propose project/account/list/employee matches, show the business consequence, ask for confirmation when needed, then retain stable links and keep data current. Do not make users administer two products.
4. **Give each screen its job:** make the current task primary; disclose record metadata, rare transfer tools and implementation detail.
5. **Keep safeguards:** do not remove consequential approval, identity confirmation or financial checks in the name of fewer clicks.

No P0 is established in this bounded pass. Empty financial seed data and unavailable local ERP setup prevented several complete journeys; those are coverage limits, not proof that hosted workflows fail.

## Method, coverage and confidence

- Read impeccable (including critique/audit, distill/clarify and Operate references), taste and ui-ux-pro-max. Ran impeccable context **once**; PRODUCT.md now records durable product context. Used the existing design system rather than inventing a new theme. Worktree skills were absent, so the main checkout's vendored skills/tools were read without editing them.
- Assessment A was recorded independently of detector output in this context, not by an independent reviewer. Assessment B used agent-browser, rendered snapshots, screenshots, measured geometry and the impeccable detector. This is deliberately labelled degraded rather than claiming two independent assessments.
- Both **Admin** and **Project Manager**, at **1280×800** and **390×844**. The 21-route matrix below was rendered for both roles; PM-only image coverage is selective because evidence is capped. All paired evidence is viewport-sized PNG, not a claim of physical-device testing.
- Existing rich seed provides projects, purchasing and approval history. Invoice, payment and expense lists are empty; the current personal timesheet week is empty. Rendered create dialogs and a locally edited, unsaved timesheet buffer were inspected. No invoice/payment/expense was submitted; no approval/rejection was committed. One project-link attempt displayed failure; no successful link is claimed.
- No app/source edits, DB reset or reseed. Local app configuration was generated from the existing local stack, not copied from another checkout. Dependency installation repaired the local tool availability without regenerating the tracked lockfile. No push or deploy.
- Every finding has a screenshot link. **SOURCE-ONLY** explicitly means the image is host/context evidence, not a picture of that conditional state. Six findings contain source-only conditional extensions; they need a rendered re-check with suitable seed before acceptance. Missing data was not manufactured into the shared DB.
- This is an open-ended Discover pass, not an exhaustive application/security/accessibility certification. No axe, screen-reader session, measured interaction latency, physical touch or full contrast audit was run. Detector contrast warnings are evaluated below, not promoted blindly to violations. Seed age is not evidence of production staleness.
- Some supplemental scroll captures retain browser-level shell cropping from capture; this is not used as evidence of a shell-clipping defect. Phone forecast rows already exist and are explicitly retained. No broad claim that every table lacks a responsive view is made.

### Route matrix

`P` below means `/projects/41000000-0000-0000-0000-000000000001`; `R` means `/procurement/61000000-0000-0000-0000-000000000008`. These are synthetic local seed records. Every row has Admin + PM rendered inspection and detector runs at both sizes. Matching screenshot pairs use the slug below unless noted.

| Route | Screenshot slug / inspection note |
|---|---|
| `/` | dashboard; different role dashboards |
| `/projects` | projects; table and phone representation |
| `P/overview` | overview; finances, budget-snapshot and erp-link scroll/action states |
| `P/budget` | budget; projection scroll state; projection is not a separately confirmed route |
| `P/procurement` | project-procurement |
| `P/tasks` | tasks; PM snapshot coverage, shared Admin imagery |
| `P/work-orders` | work-orders; PM snapshot coverage |
| `P/billing` | billing and billing-empty; PM snapshot coverage |
| `P/documents` | documents; PM snapshot coverage |
| `P/history` | history; PM snapshot coverage |
| `/sales` | sales |
| `/sales-invoices` | invoices; invoice-new Admin dialog |
| `/incoming-payments` | payments; payment-new Admin dialog |
| `/procurement` | procurement |
| `R` | request-detail; PM snapshot coverage; also selected in approval-request |
| `/approvals` | approvals and approval-request; consequential confirm staged and cancelled |
| `/timesheets` | timesheets; timesheet-entry unsaved buffer |
| `/expenses` | expenses; expense-new unsubmitted dialog |
| `/administration/integrations` | integrations and integration-setup; PM gets the expected access-denied surface |
| `/administration/accounting` | accounting, accounting-maps, account-map-new, tax-accounts, advance-item and expense-map; PM denied |
| `/revenue-by-project` | revenue; PM snapshot coverage |

The role/viewport base matrix has 84 cells. Supplemental dialogs and scroll states are evidence, not additional routes. A selected procurement preview and the canonical procurement detail were both inspected; automation clicks that selected a preview rather than navigating are **not** reported as navigation bugs.

## Design assessment before the detector

**Specificity:** the shared shell, typography, restrained blue primary actions and mostly plain backgrounds are coherent and appropriate for an operator product. It is not a gratuitous gradients/glass/bento problem. The composition becomes category-interchangeable where equal KPI cards and record/admin machinery dictate the page instead of the operator's project-money and decision jobs.

**Strengths to preserve**

- Familiar rail, breadcrumbs, search and consistent shared controls make the application recognizable across modules. The command-palette affordance exists; this is not a claim that keyboard accelerators are absent.
- The desktop approvals queue can preview a request's evidence without leaving the inbox. A confirmation restates the consequential decision; preserve it.
- Existing safeguards/defaults already help: invoice tax readiness is checked; payment amounts are prefilled and reconciled when withholding changes; employee matching already proposes identities and requires confirmation; project matching already has a valid-project picker and connected invoice items already have a picker. Improve these seams, do not rebuild them as if missing.

### Nielsen heuristic scores

These are qualitative, bounded-pass scores, not telemetry or compliance measurements. All ten apply in Operate mode.

| Heuristic | /4 | Deciding observation |
|---|---:|---|
| Visibility of system status | 2 | Connected and not-ready coexist; selected phone tab can be off-screen |
| Match with the real world | 1 | GL/domain/push/ledger and purchasing acronyms mediate daily work |
| User control and freedom | 3 | Cancel/back and confirmations exist; unresolved setup has weak recovery |
| Consistency and standards | 2 | Strong component consistency, conflicting metric/stage vocabulary |
| Error prevention | 2 | Existing safeguards; exact-name account typing and absent draft total add avoidable uncertainty |
| Recognition rather than recall | 2 | Visible navigation, but repeated cross-screen account/project context |
| Flexibility and efficiency | 1 | Per-category setup/edit loops, repeated context and billing handoffs |
| Aesthetic and minimalist design | 1 | Calm styling cannot offset excessive simultaneous jobs/metadata |
| Error recovery | 1 | Repeated generic retry and disconnected setup destinations |
| Help and documentation | 2 | Help exists, but is frequently implementation-led or misplaced |
| **Total** | **17/40** | **Poor in the skill's rubric; structural remediation, not a visual rebrand** |

**Cognitive load:** single focus, minimal choices, working-memory continuity and progressive disclosure fail on the Projects toolbar and project money/setup journeys. Grouping is often visually good, but over-grouping into repeated cards does not reduce the number of decisions. Examples exceed four simultaneous choices: eight project tabs, multiple competing project actions, three import/export actions plus four project views, and eight independent budget-account rows. These are observations, not a rule that navigation may never contain five items.

**Emotional journey:** calm first impression → apparently precise money → conflicting scopes/partial coverage → Connected but unavailable setup → blind retry. The trust low point is uncertainty at financial decisions, not an absent animation. A useful ending would be a reviewed money position or a named unresolved setup action, not another status badge.

**Persona red flags**

- **Owner/power user:** to reconcile a project's money, moves between header, Overview finance, Budget projection, invoices and payments; then reaches account-name chores rather than proposed matches.
- **First-time staff member:** must select an expense's accounting category before entering the receipt; a PM is told to create financial records without an available action.
- **Phone user / accessibility-dependent reader:** the selected project section can disappear beyond the tab strip, meaningful metadata is tiny, and heading navigation does not mirror Billing's visual sections. Screen-reader and effective touch-target tests remain necessary; no unsupported accessibility failure is asserted.

## Summary counts

**85 findings: P0 0 · P1 29 · P2 56 · P3 0. 60 proposed work slices.**

| Owning route/surface | P0 | P1 | P2 | P3 | Total |
|---|---:|---:|---:|---:|---:|
| Cross-cutting | 0 | 5 | 7 | 0 | 12 |
| Dashboard / | 0 | 4 | 1 | 0 | 5 |
| Projects /projects | 0 | 0 | 4 | 0 | 4 |
| Project Overview | 0 | 5 | 6 | 0 | 11 |
| Project Budget / projection | 0 | 3 | 4 | 0 | 7 |
| Project Procurement tab | 0 | 0 | 1 | 0 | 1 |
| Project Tasks tab | 0 | 1 | 1 | 0 | 2 |
| Project Work orders tab | 0 | 0 | 1 | 0 | 1 |
| Project Billing tab | 0 | 1 | 0 | 0 | 1 |
| Project Documents tab | 0 | 0 | 1 | 0 | 1 |
| Project History tab | 0 | 0 | 1 | 0 | 1 |
| Sales pipeline /sales | 0 | 0 | 3 | 0 | 3 |
| Sales invoices /sales-invoices | 0 | 2 | 2 | 0 | 4 |
| Incoming payments /incoming-payments | 0 | 0 | 2 | 0 | 2 |
| Procurement /procurement | 0 | 0 | 2 | 0 | 2 |
| Procurement detail | 0 | 0 | 2 | 0 | 2 |
| Approvals /approvals | 0 | 0 | 2 | 0 | 2 |
| Timesheets /timesheets | 0 | 0 | 2 | 0 | 2 |
| Expenses /expenses | 0 | 0 | 3 | 0 | 3 |
| Administration / integrations | 0 | 3 | 3 | 0 | 6 |
| Administration / accounting | 0 | 4 | 5 | 0 | 9 |
| Conditional copy / matching | 0 | 1 | 3 | 0 | 4 |

Owning-surface counts are exclusive. Cross-cutting and source-only conditional groups are not added again to each affected route. Revenue by Project has no separate route-only finding; its empty-state problem is counted cross-cutting. Detector multiplicity is not the number of UX defects.

Severity: **P0** proven task-blocker; **P1** material confusion/difficulty at a core job; **P2** friction with a workaround; **P3** cosmetic polish. Severity here ranks user harm, not implementation cost or a detector warning level. No decorative preference is inflated into an extra finding.

## Findings register

Each numbered entry states what is visible, who is harmed, one concrete direction and its evidence. Cross-cutting manifestations are counted once. Screenshots are synthetic local data; conditional code evidence is clearly qualified.

### Cross-cutting

#### UX-001 · P1 — Approval work is below the navigation fold

- **Visible symptom:** At 1280×800 the Admin rail shows CRM, Delivery and Finance; Approvals, Expenses and My Tasks are below its visible scroll area.
- **User harm:** An owner checking decisions must know to scroll the rail or detour through Dashboard; the urgent queue is less discoverable than reference directories.
- **Direction:** Keep a persistent, counted Approvals entry near the top; group secondary directories without removing their canonical routes.
- **Screenshot:** [ux-admin-dashboard-1280.png](shots/2026-10-16/ux-admin-dashboard-1280.png)

#### UX-002 · P1 — The project-wide action competes with the selected job

- **Visible symptom:** Change status remains the blue rail action on Tasks, Budget, Billing and Documents, and a fixed phone bar, even when the person is reading costs or adding a document.
- **User harm:** The strongest action changes the whole project rather than completing the tab’s task; it also consumes phone workspace.
- **Direction:** Give the selected job the primary action; retain project transitions in a clearly labelled record-actions disclosure.
- **Screenshot:** [ux-admin-documents-390.png](shots/2026-10-16/ux-admin-documents-390.png)

#### UX-003 · P1 — The record header makes every tab pay an overview tax

- **Visible symptom:** On phone, Back, long identity, status, three record actions, finance disclosure, tax metadata and phase summary precede the tab’s work.
- **User harm:** A PM opening Documents or Tasks spends roughly the first 350px on repeated context before reaching the requested job.
- **Direction:** Use compact identity plus current tab; disclose full metadata and finance outside Overview.
- **Screenshot:** [ux-admin-documents-390.png](shots/2026-10-16/ux-admin-documents-390.png)

#### UX-004 · P1 — The selected tab can be invisible

- **Visible symptom:** Direct Work orders/Documents phone routes show Overview, Budget, Procurement and Tasks in the strip, while the selected destination is off its right edge.
- **User harm:** People cannot tell which section they are in from the visible tab strip and must discover horizontal scrolling to return to it.
- **Direction:** Scroll the active tab into view and expose a labelled section selector or clear overflow affordance.
- **Screenshot:** [ux-admin-work-orders-390.png](shots/2026-10-16/ux-admin-work-orders-390.png)

#### UX-005 · P2 — Tax implementation detail is always on

- **Visible symptom:** Project headers/cards carry “rate not recorded · DPP 1/1”; repeated monetary cells carry tax-basis notes.
- **User harm:** A reader checking progress must parse accounting configuration; the meaningful distinction, whether a figure includes tax, is buried in machinery.
- **Direction:** Keep the honest tax basis beside money; disclose rate/base detail and show a missing-rate action only when it blocks billing.
- **Screenshot:** [ux-admin-overview-1280.png](shots/2026-10-16/ux-admin-overview-1280.png)

#### UX-006 · P2 — Phone controls are visually too small for routine use

- **Visible symptom:** Measured phone boxes include 32px shell buttons, 28px record actions and approximately 16px text-link controls.
- **User harm:** One-handed users have small visible targets beside destructive/record-wide actions; extra care is required on a busy screen.
- **Direction:** Preserve desktop density but enlarge effective phone hit areas and spacing; test the actual pointer target including existing touch-target pseudo-elements.
- **Screenshot:** [ux-admin-overview-390.png](shots/2026-10-16/ux-admin-overview-390.png)

#### UX-007 · P2 — Dense metadata has become microtext

- **Visible symptom:** The projects table uses 8px manager initials; the current-phase marker is 10px and many identifiers/labels are 11px.
- **User harm:** The owner must decode tiny initials and identifiers rather than recognize a person/project at ordinary zoom.
- **Direction:** Show a readable manager name or useful short label and reduce redundant metadata instead of shrinking it.
- **Screenshot:** [ux-admin-projects-1280.png](shots/2026-10-16/ux-admin-projects-1280.png)

#### UX-008 · P2 — The same purchase stage has several names

- **Visible symptom:** Approvals says Requested; procurement detail says Purchase Request; lists use Vendor Quote while the dashboard uses Vendor Quoted.
- **User harm:** Moving between the approval inbox, project and purchasing list requires translating labels for the same work.
- **Direction:** Use one business-facing stage vocabulary across summaries, inboxes and detail; leave stored enums unchanged.
- **Screenshot:** [ux-admin-procurement-1280.png](shots/2026-10-16/ux-admin-procurement-1280.png)

#### UX-009 · P1 — Setup is a collection of scattered chores

- **Visible symptom:** Organization connection, category maps, tax accounts, down-payment item, employee links and per-project links live on different screens.
- **User harm:** The first owner must remember dependencies and return to each failure independently; there is no single reviewed setup outcome.
- **Direction:** Provide one resumable setup review that links to focused steps, proposes matches and lists only unresolved exceptions afterward.
- **Screenshot:** [ux-admin-integrations-1280.png](shots/2026-10-16/ux-admin-integrations-1280.png)

#### UX-010 · P2 — Empty-state instructions ignore the viewer’s ability to act

- **Visible symptom:** PM invoice and payment pages say Create/Record your first item, but provide no corresponding action; Revenue by Project says create invoices and offers Browse Projects.
- **User harm:** A PM follows an impossible instruction; the owner takes a directory detour rather than starting billing.
- **Direction:** Use role-aware empty copy and a real next action: create for authorized users, otherwise identify the responsible team and offer a useful project view.
- **Screenshot:** [ux-pm-invoices-1280.png](shots/2026-10-16/ux-pm-invoices-1280.png)

#### UX-011 · P2 — Finance empty states duplicate the primary action

- **Visible symptom:** Admin Sales Invoices and Incoming Payments each show the same create/receive button in the header and empty body.
- **User harm:** Two equal entry points add visual competition without providing a different route to the goal.
- **Direction:** Keep one primary action and make the empty body explain what will appear.
- **Screenshot:** [ux-admin-invoices-1280.png](shots/2026-10-16/ux-admin-invoices-1280.png)

#### UX-012 · P2 — The document outline privileges the ERP rail over the job

- **Visible symptom:** Billing and Work orders display major section labels as non-heading text, then expose ERPNext Project as h3 after the page h1.
- **User harm:** Heading navigation does not represent the visual work hierarchy; users scanning by headings can miss the actual job sections.
- **Direction:** Make visible work-section titles real h2 headings and subordinate connection details consistently.
- **Screenshot:** [ux-admin-billing-1280.png](shots/2026-10-16/ux-admin-billing-1280.png)
- **Evidence qualification:** pmo-portal/pages/project-detail/ProjectErpLink.tsx and rendered heading snapshots; detector skipped-heading confirmed structurally, not claimed as a standalone WCAG failure.

### Dashboard /

#### UX-013 · P1 — Budget-vs-actual bars actually compare spend with contract

- **Visible symptom:** The card title says Budget vs Actual, but a project row shows spending divided by contract value, not its active budget.
- **User harm:** The owner/PM can read a healthy contract-cost ratio as remaining budget capacity.
- **Direction:** Label the existing series Spending / contract, or deliberately replace its denominator with the active budget and label that decision.
- **Screenshot:** [ux-admin-dashboard-1280.png](shots/2026-10-16/ux-admin-dashboard-1280.png)
- **Evidence qualification:** pmo-portal/src/components/dashboard/BvACard.tsx uses spent / contract_value; budget is used separately for the risk flag.

#### UX-014 · P1 — The PM and Admin see different money for the same project

- **Visible symptom:** The PM dashboard shows $0 for the reference project while Admin/Projects shows $2.36m for that same project.
- **User harm:** A PM coordinating with the owner cannot establish a shared spending position; a zero looks authoritative.
- **Direction:** Reconcile the same-project spending read models and represent unavailable data as unavailable; retain legitimate role-specific portfolio scope differences.
- **Screenshot:** [ux-pm-dashboard-1280.png](shots/2026-10-16/ux-pm-dashboard-1280.png)
- **Evidence qualification:** Compare ux-admin-projects-1280 and ux-admin-dashboard-1280; PMDashboard.tsx builds from useProjects, while the executive dashboard consumes its dashboard read model. This is an observed mismatch, not a proven database cause.

#### UX-015 · P2 — Project-status percentages are unlabeled

- **Visible symptom:** The PM status list ends with 36.7%, 58.0% or Not set beside a different delivery percentage.
- **User harm:** A manager cannot tell whether the trailing figure is margin, progress or budget usage, or what Not set asks them to set.
- **Direction:** Give the column a visible metric name and a meaningful unavailable state; do not mix it with delivery progress.
- **Screenshot:** [ux-pm-dashboard-1280.png](shots/2026-10-16/ux-pm-dashboard-1280.png)
- **Evidence qualification:** PMDashboard.tsx computes this trailing figure as margin.

#### UX-016 · P1 — Attention comes after a KPI tour

- **Visible symptom:** Admin sees six equally weighted cards before approvals; on phone the PM’s KPI cards stack before the project work.
- **User harm:** The owner’s daily question, what needs me now, is delayed by passive totals and forces scrolling on phone.
- **Direction:** Put approvals and genuine project exceptions first; compress secondary portfolio metrics into a quieter summary.
- **Screenshot:** [ux-pm-dashboard-390.png](shots/2026-10-16/ux-pm-dashboard-390.png)

#### UX-017 · P1 — Revenue wording implies cash or realized results

- **Visible symptom:** Revenue on hand and Realized margin sit beside an active-project contract total, while the metric help defines booked contract revenue less costs to date.
- **User harm:** A solo operator can mistake contracted value and interim margin for money received or final profitability.
- **Direction:** Use Contracted revenue and Margin to date with a short scope note; keep cash received as a separately sourced measure.
- **Screenshot:** [ux-admin-dashboard-1280.png](shots/2026-10-16/ux-admin-dashboard-1280.png)
- **Evidence qualification:** pmo-portal/pages/ExecutiveDashboard.tsx metric help defines the existing calculation; this recommendation does not change it.

### Projects /projects

#### UX-018 · P2 — The desktop toolbar is a wall of decisions

- **Visible symptom:** Five scopes, search, three customer/manager selectors, Classification, three transfer actions and four views occupy several rows.
- **User harm:** A daily user scans configuration/import tools before finding a project; the main search competes with infrequent setup actions.
- **Direction:** Keep scope/search/current view visible; group secondary filters and import/export under labelled disclosures.
- **Screenshot:** [ux-admin-projects-1280.png](shots/2026-10-16/ux-admin-projects-1280.png)

#### UX-019 · P2 — Every project identity repeats three codes

- **Visible symptom:** Project rows stack internal number, client code and PO reference under the name while customer/status/money columns wrap.
- **User harm:** The owner loses readable project names and comparisons to identifiers that matter only for lookup or reconciliation.
- **Direction:** Lead with name/customer and one relevant reference; reveal the remaining identifiers on demand or search match.
- **Screenshot:** [ux-admin-projects-1280.png](shots/2026-10-16/ux-admin-projects-1280.png)

#### UX-020 · P2 — Successful completion is drawn as danger

- **Visible symptom:** The completed/close-out project’s 100% delivery bar is red, while earlier progress bars are green or amber.
- **User harm:** A PM scanning the list can interpret finished work as a problem because a high progress value inherits warning-like styling.
- **Direction:** Use neutral/positive completion styling for delivery; reserve danger thresholds for budget/risk metrics.
- **Screenshot:** [ux-admin-projects-1280.png](shots/2026-10-16/ux-admin-projects-1280.png)

#### UX-021 · P2 — The end-customer column loses its name

- **Visible symptom:** The desktop table abbreviates the End customer heading to END and fills the visible rows with dashes.
- **User harm:** The user pays column width and scanning effort for an unclear field that contributes no data in this working set.
- **Direction:** Allow optional columns to be chosen and retain readable labels; hide all-empty optional columns only with a discoverable restore control.
- **Screenshot:** [ux-admin-projects-1280.png](shots/2026-10-16/ux-admin-projects-1280.png)

### Project Overview

#### UX-022 · P1 — One money question has multiple overlapping answers

- **Visible symptom:** Contract and budget appear in the header, drawdown, Project finances and Budget snapshot; the view also carries procurement totals.
- **User harm:** The operator must decide which block answers how much is left rather than receiving one coherent position.
- **Direction:** Make one scoped money summary with drill-downs for spending, billing and forecast; remove repeated headline figures.
- **Screenshot:** [ux-admin-finances-1280.png](shots/2026-10-16/ux-admin-finances-1280.png)

#### UX-023 · P1 — Available spending is presented like a complete total

- **Visible symptom:** Mapped GL costs shows $1.78m prominently while four category rows say Account mapping unavailable.
- **User harm:** The owner may treat the partial mapped amount as total project spending or compare it directly with the $2.36m Actual header.
- **Direction:** Label coverage beside the amount, or withhold a whole-project total until complete; never turn missing categories into zero.
- **Screenshot:** [ux-admin-finances-1280.png](shots/2026-10-16/ux-admin-finances-1280.png)

#### UX-024 · P1 — Missing setup is repeated without a usable next action

- **Visible symptom:** Four rows repeat Account mapping unavailable; a PM has no permitted setup destination on this screen.
- **User harm:** The owner repeatedly reads the same failure, while the PM cannot tell who will fix it or what business information is missing.
- **Direction:** Use one explanation, Spending is incomplete for four categories, with Review setup for the owner and an appropriate team handoff for the PM.
- **Screenshot:** [ux-admin-finances-390.png](shots/2026-10-16/ux-admin-finances-390.png)

#### UX-025 · P1 — Finance labels describe the implementation

- **Visible symptom:** Mapped GL costs, GL actuals, and the unlabelled date are the main cost vocabulary.
- **User harm:** An operator checking project money must understand ledger mapping and guess whether the date is freshness, transaction date or reporting period.
- **Direction:** Use Recorded spending, a clear Updated date, and an optional accounting breakdown.
- **Screenshot:** [ux-admin-finances-1280.png](shots/2026-10-16/ux-admin-finances-1280.png)

#### UX-026 · P2 — Procurement uses Committed for a different amount

- **Visible symptom:** The header says Committed $2.36m; Procurement summary says $3.05m committed across four requests, including requests at different stages.
- **User harm:** The owner cannot compare totals without reconstructing what each use of committed includes.
- **Direction:** State the distinct scope, such as Total request value versus committed spend, after confirming the underlying stage calculation.
- **Screenshot:** [ux-admin-budget-snapshot-1280.png](shots/2026-10-16/ux-admin-budget-snapshot-1280.png)
- **Evidence qualification:** Project-procurement screenshot shows the four request values/stages. Scope correction, not an assertion that either arithmetic is wrong.

#### UX-027 · P2 — Budget variance reads as a loss when money remains

- **Visible symptom:** Budget snapshot shows -$2.14m variance when $2.36m has been used against $4.5m.
- **User harm:** The operator must mentally invert a negative number to understand available budget; projection later uses a different variance context.
- **Direction:** Say $2.14m budget remaining or Over budget by X, with the basis explicit.
- **Screenshot:** [ux-admin-budget-snapshot-1280.png](shots/2026-10-16/ux-admin-budget-snapshot-1280.png)
- **Evidence qualification:** Overview rendered Budget snapshot; screenshot captures the block and adjacent procurement summary.

#### UX-028 · P2 — A missing ERP link still offers Change ERP project

- **Visible symptom:** The rail says there is no ERP link yet and presents both Link ERP project and Change ERP project.
- **User harm:** The operator must guess whether to create/match/change, with no recommendation explaining the distinction.
- **Direction:** Offer one Review proposed match entry point; reserve Change for an existing confirmed match.
- **Screenshot:** [ux-admin-erp-link-390.png](shots/2026-10-16/ux-admin-erp-link-390.png)

#### UX-029 · P1 — Link recovery is a blind retry

- **Visible symptom:** Clicking Link ERP project in this local state leaves Project is saved in PMO. ERP linking did not complete; try linking again.
- **User harm:** The owner cannot tell whether this is a missing prerequisite, a temporary failure or a matching decision; the message also implies a save that was not the current task.
- **Direction:** Preserve the project and name the next actionable step or responsible operator; do not ask for an indistinguishable retry when setup needs review.
- **Screenshot:** [ux-admin-erp-link-390.png](shots/2026-10-16/ux-admin-erp-link-390.png)

#### UX-030 · P2 — The wide permanent rail squeezes the work

- **Visible symptom:** A 340px details/ERP column repeats identity beside every tab; the finance/work area is only about 630px at the target desktop width.
- **User harm:** Tables require horizontal scrolling even on desktop, while inactive identifiers occupy a third of the content area.
- **Direction:** Make details a compact disclosure or collapsible rail, and give task tables the recovered width.
- **Screenshot:** [ux-admin-projection-1280.png](shots/2026-10-16/ux-admin-projection-1280.png)

#### UX-031 · P2 — Phase target dates omit the year on overdue work

- **Visible symptom:** Engineering says Target 15 Oct and Procurement Target 31 Jan while the project spans 2025–2026 and today is in October 2026.
- **User harm:** A PM cannot tell which October or January is meant without opening another view; stale seed dates expose a genuine long-lived-project ambiguity.
- **Direction:** Include the year whenever it differs from the current year or the date is overdue across years.
- **Screenshot:** [ux-admin-overview-1280.png](shots/2026-10-16/ux-admin-overview-1280.png)

#### UX-032 · P2 — Settlement help appears without any settlements to explain

- **Visible symptom:** No submitted invoices is followed by Settled against invoices (cash, withholding and credits), not cash received.
- **User harm:** A first-use owner reads a nuanced accounting distinction before there is a relevant number.
- **Direction:** Show settlement help beside an actual settlement value, not in the empty invoice state.
- **Screenshot:** [ux-admin-finances-1280.png](shots/2026-10-16/ux-admin-finances-1280.png)

### Project Budget / projection

#### UX-033 · P2 — The selected budget version is announced repeatedly

- **Visible symptom:** Active budget amount, version selector with Active and amount, then version heading with Active and amount precede the line items.
- **User harm:** The operator spends screen space re-reading the same state before editing or forecasting.
- **Direction:** Keep a single version selector/header with status and amount; archive/history stay secondary.
- **Screenshot:** [ux-admin-budget-390.png](shots/2026-10-16/ux-admin-budget-390.png)

#### UX-034 · P1 — The forecast is buried after the version ledger

- **Visible symptom:** Budget projection sits below the full budget-version line-item table and before another seven-column table.
- **User harm:** A PM asking whether the project will finish within budget must scroll past a different job and reconcile two Actual presentations.
- **Direction:** Provide a clear Forecast subview or anchored entry from the project money summary, with one explicit source per measure.
- **Screenshot:** [ux-admin-projection-390.png](shots/2026-10-16/ux-admin-projection-390.png)

#### UX-035 · P1 — The key forecast outcome is off-screen on desktop

- **Visible symptom:** At 1280px, Projected final, variance and utilization extend to the right of the visible table, squeezed by the details rail. Phone already uses stacked category rows.
- **User harm:** A desktop PM sees inputs without the decision-driving result and must pan horizontally to judge overruns.
- **Direction:** Lead with final cost and budget remaining/overrun; recover table width or prioritize outcome columns, retaining the existing phone rows.
- **Screenshot:** [ux-admin-projection-1280.png](shots/2026-10-16/ux-admin-projection-1280.png)

#### UX-036 · P1 — Unavailable forecast cells look like blank dashes

- **Visible symptom:** Unmapped categories show dashes across actual/final/variance/utilization; the snapshot exposes a long explanation through accessible text, not a visible phone remedy.
- **User harm:** The PM cannot distinguish not applicable from missing spending or understand why a forecast is absent without hover/inspection.
- **Direction:** Show a concise visible reason once per affected category and a summary of forecast completeness.
- **Screenshot:** [ux-admin-projection-390.png](shots/2026-10-16/ux-admin-projection-390.png)

#### UX-037 · P2 — Projection labels force source translation

- **Visible symptom:** Headers include BUDGET (PMO), ACTUALS TO DATE (ERP LEDGER), ETC (PMO); the status says Enforced by ERPNext, repeats that sentence and shows a raw budget document name.
- **User harm:** The owner translates system ownership and an acronym before answering a business question.
- **Direction:** Use Budget, Recorded spending, Cost to finish and Forecast final cost; move source/enforcement/document facts into a details disclosure.
- **Screenshot:** [ux-admin-projection-1280.png](shots/2026-10-16/ux-admin-projection-1280.png)

#### UX-038 · P2 — Utilization does not say that it is forecast usage

- **Visible symptom:** Labor shows 108% alongside only $180k recorded spending against a $400k budget, because the $250k estimate is also included.
- **User harm:** The user may read the percentage as spending already incurred and overreact.
- **Direction:** Label it Forecast budget used, or remove the duplicate percentage when final-cost/overrun figures already answer the job.
- **Screenshot:** [ux-admin-projection-1280.png](shots/2026-10-16/ux-admin-projection-1280.png)

#### UX-039 · P2 — Each cost-to-finish line is a separate editing chore

- **Visible symptom:** Every category has its own Edit control for ETC.
- **User harm:** Updating a project-wide forecast requires repeated open/edit/save cycles rather than one review of related assumptions.
- **Direction:** Offer a compact multi-row Cost to finish edit and one review/save, preserving per-field validation.
- **Screenshot:** [ux-admin-projection-1280.png](shots/2026-10-16/ux-admin-projection-1280.png)

### Project Procurement tab

#### UX-040 · P2 — Tiny lifecycle dots repeat the status without explaining the next step

- **Visible symptom:** Four rows show an unlabelled dot chain next to Approved, Vendor Quote, Purchase Order or Paid.
- **User harm:** The user decodes a miniature lifecycle that adds little beyond the status and does not answer what to do next.
- **Direction:** Keep one plain stage label and a relevant next step; disclose the full journey on the request detail.
- **Screenshot:** [ux-admin-project-procurement-1280.png](shots/2026-10-16/ux-admin-project-procurement-1280.png)

### Project Tasks tab

#### UX-041 · P2 — An inactive integration is placed before task work

- **Visible symptom:** External Integrations, a bi-directional-sync sentence and a Not connected ClickUp card precede the task view selector and list.
- **User harm:** The PM encounters setup noise every visit even when tasks can be managed directly in PMO.
- **Direction:** Move optional connection setup to project settings; show only a compact actionable sync exception in daily Tasks.
- **Screenshot:** [ux-admin-tasks-1280.png](shots/2026-10-16/ux-admin-tasks-1280.png)

#### UX-042 · P1 — ClickUp matching is still a per-project configuration task

- **Visible symptom:** The connected-state control asks for a ClickUp List and Push (seed new tasks) versus Pull (adopt existing).
- **User harm:** An owner scaling beyond one project repeats link decisions and must understand transfer mechanics for a promised two-way integration.
- **Direction:** During organization setup propose project/list matches and clearly separate the one-time initial import choice from ongoing two-way updates.
- **Screenshot:** [ux-admin-tasks-1280.png](shots/2026-10-16/ux-admin-tasks-1280.png)
- **Evidence qualification:** SOURCE-ONLY connected-state extension: pmo-portal/src/components/projects/ProjectIntegrationsCard.tsx. Rendered screenshot proves only the disconnected daily surface; no external connection was made.

### Project Work orders tab

#### UX-043 · P2 — The first-use work-order screen is mostly zero summaries

- **Visible symptom:** Drawdown plus four figures and billing-against-work-orders totals precede No work orders yet and its create action.
- **User harm:** The owner reads an empty financial dashboard before learning how to record the first client order.
- **Direction:** Lead with the first-order task when empty; retain only the contract ceiling needed to make that decision.
- **Screenshot:** [ux-admin-work-orders-390.png](shots/2026-10-16/ux-admin-work-orders-390.png)

### Project Billing tab

#### UX-044 · P1 — The invoice job is split across Billing, Work orders and Sales Invoices

- **Visible symptom:** Billing opens with six summary fields, empty quantities and empty claims; Work orders owns a separate invoice route, and global Sales Invoices starts a generic form.
- **User harm:** The owner cannot see one clear way to bill this project and must know which underlying billing model applies.
- **Direction:** Keep one project Billing home with a Choose billing method action that preserves project/customer/order context; retain work-order records as drill-downs.
- **Screenshot:** [ux-admin-billing-1280.png](shots/2026-10-16/ux-admin-billing-1280.png)

### Project Documents tab

#### UX-045 · P2 — Issued/approved records show a file dash

- **Visible symptom:** Both visible document records carry an issued/approved status while FILE is shown as —.
- **User harm:** A PM opening a deliverable cannot tell whether no file was attached, access is unavailable, or download is still loading.
- **Direction:** Use an explicit No file attached state and the appropriate authorized next action; do not imply approval guarantees an uploaded file.
- **Screenshot:** [ux-admin-documents-390.png](shots/2026-10-16/ux-admin-documents-390.png)

### Project History tab

#### UX-046 · P2 — The history starts as a stream of machine references

- **Visible symptom:** The first entries are System, a timestamp, a payment/RFQ/order code and Created; other entries show empty → reference changes.
- **User harm:** The owner reviewing what changed must mentally reconstruct which business record the event belongs to and why it matters.
- **Direction:** Lead with business outcome and recognizable record title, link to the record, and group bulk/system setup events behind a disclosure.
- **Screenshot:** [ux-admin-history-1280.png](shots/2026-10-16/ux-admin-history-1280.png)

### Sales pipeline /sales

#### UX-047 · P2 — Phone sales has three separate horizontal navigations

- **Visible symptom:** The funnel, stage selector and multi-column board each require horizontal panning; visible tab labels truncate.
- **User harm:** The owner must maintain stage position in several scroll regions to find or compare pipeline projects.
- **Direction:** On phone use one stage selector controlling one readable project list, with funnel summary behind a disclosure.
- **Screenshot:** [ux-admin-sales-390.png](shots/2026-10-16/ux-admin-sales-390.png)

#### UX-048 · P2 — The pipeline card repeats state and tax machinery

- **Visible symptom:** Stage is shown on the column and the card; each card repeats internal/client identifiers, weighted amount, probability and tax-base details.
- **User harm:** Project recognition and the next sales action compete with derivations that could be disclosed once.
- **Direction:** Show name/customer/value and next action; disclose identifiers, weighting and tax calculation detail.
- **Screenshot:** [ux-admin-sales-390.png](shots/2026-10-16/ux-admin-sales-390.png)

#### UX-049 · P2 — Destination naming drifts

- **Visible symptom:** The rail/breadcrumb says Sales Pipeline while the page heading is Pipeline.
- **User harm:** The page loses the clear distinction from delivery and other lifecycle pipelines on a phone.
- **Direction:** Use Sales pipeline consistently in the navigation, heading and saved-view labels.
- **Screenshot:** [ux-admin-sales-390.png](shots/2026-10-16/ux-admin-sales-390.png)

### Sales invoices /sales-invoices

#### UX-050 · P2 — The generic invoice form makes the owner re-establish context

- **Visible symptom:** The first choices are Customer and Project; no source project/order is carried into this global entry form.
- **User harm:** The operator navigates away from the project they were billing and repeats recognition/selection work.
- **Direction:** Add a project-scoped New invoice entry using known project/customer/order context; retain a generic global entry for genuinely unscoped starts.
- **Screenshot:** [ux-admin-invoice-new-390.png](shots/2026-10-16/ux-admin-invoice-new-390.png)

#### UX-051 · P2 — Optional item code competes with the description

- **Visible symptom:** This rendered form shows Item code with ITEM-001 before Description, but neither label explains that a description alone can satisfy a native line.
- **User harm:** The owner may search ERPNext for an item code unnecessarily instead of describing the work.
- **Direction:** Lead with Description and label item selection optional when the workflow permits it; use the existing item picker when connected.
- **Screenshot:** [ux-admin-invoice-new-390.png](shots/2026-10-16/ux-admin-invoice-new-390.png)
- **Evidence qualification:** SalesInvoices.tsx already has a connected-state ERP item Combobox; do not build a duplicate picker or claim that all states use free text.

#### UX-052 · P1 — There is no review total before creating the draft

- **Visible symptom:** The create dialog lists quantity/rate and Add line item, then Create invoice; its shipped form has no visible calculated summary.
- **User harm:** Even a draft money entry gives the owner no compact way to catch the total/tax consequence before creating it.
- **Direction:** Show a verified subtotal/tax/total review using the selected project’s recorded treatment; show what is missing when a total cannot be established.
- **Screenshot:** [ux-admin-invoice-new-1280.png](shots/2026-10-16/ux-admin-invoice-new-1280.png)
- **Evidence qualification:** SalesInvoices.tsx SalesInvoiceFormModal render inspected through its closing tag; this is draft review, not permission to weaken approval.

#### UX-053 · P1 — The client-delivery handoff is not explained

- **Visible symptom:** The create subtitle promises a draft and a different approver; the inspected row-menu flow leads to approval and Download PDF, without an explained sending step.
- **User harm:** An owner asked to raise and send an invoice cannot tell when the client has actually received anything.
- **Direction:** After approval present Ready to send with the supported PDF/manual-delivery handoff and a clear received-date step; add direct sending only after an owner decision.
- **Screenshot:** [ux-admin-invoice-new-1280.png](shots/2026-10-16/ux-admin-invoice-new-1280.png)
- **Evidence qualification:** SOURCE-ONLY post-create extension: SalesInvoices.tsx rowMenu and received-date modal. Empty seed invoice list prevented rendering or completing this handoff; no claim of an app-wide email capability audit.

### Incoming payments /incoming-payments

#### UX-054 · P2 — Withholding complexity is always expanded

- **Visible symptom:** The payment dialog always shows cash/applied amounts, withheld amount, slip number and their explanatory paragraphs.
- **User harm:** Most no-withholding receipts make the owner scan specialist fields, especially on phone.
- **Direction:** Keep an explicit Tax withheld? disclosure; reveal required evidence when used and preserve the existing automatic no-withholding amount prefill.
- **Screenshot:** [ux-admin-payment-new-390.png](shots/2026-10-16/ux-admin-payment-new-390.png)

#### UX-055 · P2 — Paid Amount and Received Amount require repeated translation

- **Visible symptom:** The user must read helper paragraphs to distinguish total applied to the invoice from actual cash.
- **User harm:** A hurried owner can enter the cash figure into both fields when withholding applies.
- **Direction:** Use Amount settled on invoice and Cash received, with a clear cash + tax withheld reconciliation when applicable.
- **Screenshot:** [ux-admin-payment-new-1280.png](shots/2026-10-16/ux-admin-payment-new-1280.png)

### Procurement /procurement

#### UX-056 · P2 — The introduction is an acronym/process diagram

- **Visible symptom:** Purchase requests through PR → VQ → PO → GR → VI → Paid, with separation-of-duties gates is permanent introductory copy.
- **User harm:** The owner must learn the implementation vocabulary before buying something; the sentence does not help complete the current request.
- **Direction:** Use Request, order and pay for project purchases; explain checks and individual stages only where they affect the next action.
- **Screenshot:** [ux-admin-procurement-1280.png](shots/2026-10-16/ux-admin-procurement-1280.png)

#### UX-057 · P2 — Bulk data transfer tools crowd the daily purchasing toolbar

- **Visible symptom:** Export, Import and Import cycle data sit beside filtering and the table/board switch on every visit.
- **User harm:** Rare initial-load tools have similar prominence to finding an open purchase.
- **Direction:** Group transfer tools in More; leave scope, search and Raise request visible.
- **Screenshot:** [ux-admin-procurement-1280.png](shots/2026-10-16/ux-admin-procurement-1280.png)

### Procurement detail

#### UX-058 · P2 — The phone presents Approve twice

- **Visible symptom:** The request detail shows an inline Approve next to Reject/Cancel request and a second full-width fixed Approve at the bottom.
- **User harm:** The user sees two competing copies of the same consequential action rather than one coherent decision area.
- **Direction:** Use one responsive decision area containing the complete permitted decision set; preserve safeguards and explanatory context.
- **Screenshot:** [ux-admin-request-detail-390.png](shots/2026-10-16/ux-admin-request-detail-390.png)

#### UX-059 · P2 — Request context repeats without adding decision evidence

- **Visible symptom:** Project identity is repeated in the header, PR value caption and Budget impact links; policy prose occupies a full block before details.
- **User harm:** The approver scrolls through repeated location/policy text before reaching supporting line items and budget evidence.
- **Direction:** Keep one recognizable identity/value block and concise decision policy beside evidence; disclose repeated metadata.
- **Screenshot:** [ux-admin-request-detail-390.png](shots/2026-10-16/ux-admin-request-detail-390.png)

### Approvals /approvals

#### UX-060 · P2 — Mobile all-pending is still two interaction systems

- **Visible symptom:** Purchase requests use expandable previews; timesheets appear in a separate Team approvals queue with their own Select button and inline actions.
- **User harm:** The approver learns different selection/review behavior inside a supposedly unified inbox and may miss the second queue below the fold.
- **Direction:** Use one queue/preview grammar for all types while preserving each type’s evidence and decision rules.
- **Screenshot:** [ux-admin-approvals-390.png](shots/2026-10-16/ux-admin-approvals-390.png)

#### UX-061 · P2 — Select is an ambiguous bulk-mode command

- **Visible symptom:** The button above the queue is simply Select, and its scope differs between desktop and phone presentations.
- **User harm:** The owner must click to find out whether it selects an item, selects all or starts batch decisions.
- **Direction:** Label the action Select items and state the eligible scope/count when selection mode opens.
- **Screenshot:** [ux-admin-approvals-390.png](shots/2026-10-16/ux-admin-approvals-390.png)

### Timesheets /timesheets

#### UX-062 · P2 — Personal entry and team review compete at entry

- **Visible symptom:** The manager/Admin lands on an empty personal Draft week, while Review 2 awaiting is a secondary link above it.
- **User harm:** The operator reviewing staff hours first lands in a data-entry job for themselves.
- **Direction:** Offer clearly named My time / Team review destinations with role-sensitive entry and a durable route to the canonical Approvals inbox.
- **Screenshot:** [ux-admin-timesheets-1280.png](shots/2026-10-16/ux-admin-timesheets-1280.png)

#### UX-063 · P2 — Save is available before there is any time to save

- **Visible symptom:** The empty week shows Save enabled and Submit disabled with Enter hours to submit.
- **User harm:** The owner can spend a pointless interaction saving an empty state and cannot infer whether there is unsaved work.
- **Direction:** Disable Save when there are no changes and explain unsaved/saved draft status consistently with the phone action strip.
- **Screenshot:** [ux-admin-timesheets-1280.png](shots/2026-10-16/ux-admin-timesheets-1280.png)

### Expenses /expenses

#### UX-064 · P2 — Expense capture starts by creating an empty shell

- **Visible symptom:** New claim asks for title/project/category/purpose and says Add lines and receipts on the next screen.
- **User harm:** A staff member with a receipt must first create a container before reaching the evidence and amounts they came to record.
- **Direction:** Let one draft capture surface accept the first receipt/line with context, without requiring a separate empty-record step.
- **Screenshot:** [ux-admin-expense-new-390.png](shots/2026-10-16/ux-admin-expense-new-390.png)

#### UX-065 · P2 — Claimants must choose an accounting route before entering the expense

- **Visible symptom:** Budget category appears before any line/receipt and the helper explains which approver this determines.
- **User harm:** Staff must understand internal budget classification rather than simply describe what they spent; a guess also changes the review path.
- **Direction:** Propose a category from project/expense type, explain it simply and allow review/correction without silently changing approval policy.
- **Screenshot:** [ux-admin-expense-new-390.png](shots/2026-10-16/ux-admin-expense-new-390.png)

#### UX-066 · P2 — Title and Purpose duplicate the first description task

- **Visible symptom:** A new claim has both a Title and Purpose before there are line items.
- **User harm:** The user must decide how to split the same short explanation between two fields.
- **Direction:** Use one clear What was this for? description and derive an editable title where possible.
- **Screenshot:** [ux-admin-expense-new-390.png](shots/2026-10-16/ux-admin-expense-new-390.png)

### Administration / integrations

#### UX-067 · P1 — Connected is visually louder than not ready

- **Visible symptom:** ERPNext has a green Connected badge, but its setup checklist cannot be read and the main service action is a red Disconnect.
- **User harm:** The owner sees apparent success without knowing what work is usable, while the most obvious available operation dismantles the connection.
- **Direction:** Present connection and task readiness separately, lead with Finish/check setup, and move disconnect into a secondary menu.
- **Screenshot:** [ux-admin-integration-setup-390.png](shots/2026-10-16/ux-admin-integration-setup-390.png)

#### UX-068 · P1 — Verification is delegated back to the human

- **Visible symptom:** The card says To confirm data is usable, check an actual transferred record, not the connection alone, without a record link or proof.
- **User harm:** The owner must leave settings and manually search for evidence of a two-way sync.
- **Direction:** Show a verified transferred-record link and time when available; otherwise say Not yet verified and offer a concrete verification task.
- **Screenshot:** [ux-admin-integration-setup-1280.png](shots/2026-10-16/ux-admin-integration-setup-1280.png)

#### UX-069 · P2 — An all-clear queue is phrased as a warning

- **Visible symptom:** A warning triangle accompanies 0 outbound items pending or need attention.
- **User harm:** The owner must parse whether zero is safe and whether pending work and failed work mean the same thing.
- **Direction:** Show No updates waiting quietly, and separate actionable failures from normal in-progress transfers.
- **Screenshot:** [ux-admin-integration-setup-390.png](shots/2026-10-16/ux-admin-integration-setup-390.png)

#### UX-070 · P2 — Connection ownership is a paragraph instead of navigation

- **Visible symptom:** The intro explains organization versus personal connections and mentions My integrations as text.
- **User harm:** A user who is on the wrong connection surface still has to find the other destination themselves.
- **Direction:** Use a short organization-scope sentence and a direct My integrations link; explain prerequisites only next to the affected service.
- **Screenshot:** [ux-admin-integrations-1280.png](shots/2026-10-16/ux-admin-integrations-1280.png)

#### UX-071 · P2 — Source-of-truth domains are exposed as an unexplained job

- **Visible symptom:** Employed domains (source of truth), No employed domains set and data-provenance language expose internal ownership concepts.
- **User harm:** The owner cannot tell which business information will update automatically, or whether this is another required mapping task.
- **Direction:** Describe the concrete data groups and update direction; keep adapter/domain/provenance details in operator diagnostics.
- **Screenshot:** [ux-admin-integration-setup-390.png](shots/2026-10-16/ux-admin-integration-setup-390.png)
- **Evidence qualification:** Rendered empty ownership section plus IntegrationsView.tsx conditional copy; never infer a configured source from a connection badge.

#### UX-072 · P1 — Setup failure offers only the same retry

- **Visible symptom:** ERP setup unavailable says The checklist could not be read. Try again, while the connection remains marked Connected.
- **User harm:** In this local failure state the owner has no route to identify the unfinished work or hand it to the operator.
- **Direction:** Preserve the last known setup state if known, distinguish unknown readiness and offer a concise operator handoff after retry fails.
- **Screenshot:** [ux-admin-integration-setup-390.png](shots/2026-10-16/ux-admin-integration-setup-390.png)
- **Evidence qualification:** Local-state usability finding only; no claim that hosted setup fails or about the underlying cause.

### Administration / accounting

#### UX-073 · P2 — Project numbering lives in Accounting despite Project setup

- **Visible symptom:** The first Accounting setup section is Project number pattern, while Project setup is a sibling destination.
- **User harm:** An owner configuring accounts must pass unrelated numbering work; someone changing project numbering is sent to the wrong conceptual home.
- **Direction:** Move numbering to Project setup while retaining a compatibility deep link.
- **Screenshot:** [ux-admin-accounting-390.png](shots/2026-10-16/ux-admin-accounting-390.png)

#### UX-074 · P2 — Account work has no local wayfinding

- **Visible symptom:** Tax default, approvers, withholding, tax accounts, down-payment item, budget map and expense map form one long page.
- **User harm:** The owner must repeatedly scroll to the specific setup failure they came to resolve, especially at phone width.
- **Direction:** Add focused sub-sections/anchors and direct remediation links; separate rare configuration from current setup exceptions.
- **Screenshot:** [ux-admin-accounting-390.png](shots/2026-10-16/ux-admin-accounting-390.png)

#### UX-075 · P2 — Number-pattern help contradicts the stored example

- **Visible symptom:** The instructions require CLIENT, YY and SEQ4 exactly once each, but the displayed saved pattern includes only YY and SEQ4.
- **User harm:** The owner cannot tell whether the existing setting is valid and may change a working numbering scheme unnecessarily.
- **Direction:** Make the helper reflect the real validator/allowed pattern contract and preview the next proposed number without changing existing references.
- **Screenshot:** [ux-admin-accounting-390.png](shots/2026-10-16/ux-admin-accounting-390.png)

#### UX-076 · P1 — Budget accounts require exact-name typing

- **Visible symptom:** Map Subcontractors opens a single required ERP account textbox, not a searchable catalogue or recommended account.
- **User harm:** The owner must retrieve an exact identifier elsewhere and can make transcription/selection mistakes before financial data can be used.
- **Direction:** Use the connected company’s valid-account picker with proposed category matches and explicit human review.
- **Screenshot:** [ux-admin-account-map-new-390.png](shots/2026-10-16/ux-admin-account-map-new-390.png)

#### UX-077 · P2 — The map leads with transfer mechanics and per-row chores

- **Visible symptom:** Eight categories each expose Map/Add/Edit/Remove, Budget push and blocks every push; Labor also exposes a multi-account push choice.
- **User harm:** The owner must understand reading-versus-posting mechanics and repeatedly configure categories one at a time.
- **Direction:** Review proposed matches together; show the main posting account plainly and put additional read accounts/rare changes in a disclosure.
- **Screenshot:** [ux-admin-accounting-maps-390.png](shots/2026-10-16/ux-admin-accounting-maps-390.png)

#### UX-078 · P1 — Four tax-account fields demand ERP account spelling

- **Visible symptom:** Receipt withholding and vendor VAT/PPh account fields all ask for the exact ERPNext account name.
- **User harm:** The operator must cross into ERPNext or copy identifiers for a setup that should remain in PMO, with no proposed matches.
- **Direction:** Provide filtered valid-account choices and recommended matches for each tax purpose, with explicit confirmation.
- **Screenshot:** [ux-admin-tax-accounts-390.png](shots/2026-10-16/ux-admin-tax-accounts-390.png)

#### UX-079 · P1 — Down-payment setup asks for an item code and ledger knowledge

- **Visible symptom:** The Down payment item field asks for an exact ERP code and explains that its income account must be the customer-advance account.
- **User harm:** The owner cannot confidently enable this billing mode from business language alone; a wrong item has a consequential accounting meaning.
- **Direction:** Propose a verified advance-billing item and explain the consequence; route unresolved setup to the operator inside PMO.
- **Screenshot:** [ux-admin-advance-item-390.png](shots/2026-10-16/ux-admin-advance-item-390.png)
- **Evidence qualification:** OrgDownPaymentItem.tsx and the rendered Down payments section.

#### UX-080 · P1 — Expense-map recovery contradicts the connection screen

- **Visible symptom:** Expense account map says Connect ERPNext before mapping expense accounts; Organization integrations simultaneously says Connected.
- **User harm:** The owner is sent around a connection loop instead of being told that expense-posting readiness is unavailable or incomplete.
- **Direction:** Use the same readiness vocabulary across both screens and link to the missing expense setup step, not generic reconnect.
- **Screenshot:** [ux-admin-expense-map-1280.png](shots/2026-10-16/ux-admin-expense-map-1280.png)
- **Evidence qualification:** Compare the rendered organization ERPNext Connected badge with the expense-map region.

#### UX-081 · P2 — Standard role rules does not reveal who approves

- **Visible symptom:** Both approver sections say Nobody listed — the standard role rules apply.
- **User harm:** The operator cannot verify the actual approval route from the setup screen and must remember policy from elsewhere.
- **Direction:** Show the resolved fallback roles/eligible reviewers and distinguish an intentional default from an unconfigured list.
- **Screenshot:** [ux-admin-tax-accounts-390.png](shots/2026-10-16/ux-admin-tax-accounts-390.png)

### Conditional copy / matching

#### UX-082 · P1 — Unmatched employees have no resolution choice here

- **Visible symptom:** EmployeeLinkConfirm can explain No PMO user is matched to this employee and withholds Confirm when the match is undecidable, but provides no fallback picker.
- **User harm:** An owner trying to attribute staff hours correctly reaches a dead end if the proposal is absent or wrong.
- **Direction:** Offer Choose PMO user/Review another match with explicit identity confirmation; never silently auto-confirm identity links.
- **Screenshot:** [ux-admin-approvals-1280.png](shots/2026-10-16/ux-admin-approvals-1280.png)
- **Evidence qualification:** SOURCE-ONLY: pmo-portal/src/components/timesheets/EmployeeLinkConfirm.tsx, full render inspected. No proposed employee links were present in the live seed; screenshot shows the host inbox, not this conditional state.

#### UX-083 · P2 — Finance failure and cancellation copy leaks system state

- **Visible symptom:** Conditional invoice/payment cancels say docstatus 1→2; budget unmapping says fail closed; recovery says next recovery pass; project finance says Incomplete — ERP outstanding missing.
- **User harm:** At a consequential moment, the user must interpret backend state instead of understanding what will happen and what to do next.
- **Direction:** Use business consequences, missing information and honest timing; retain technical details only in an optional diagnostics view.
- **Screenshot:** [ux-admin-invoices-1280.png](shots/2026-10-16/ux-admin-invoices-1280.png)
- **Evidence qualification:** SOURCE-ONLY: SalesInvoices.tsx cancel dialog, IncomingPayments.tsx cancel dialog, BudgetAccountMap.tsx unmap confirm, BudgetProjection.tsx hold-release toast, ProjectFinancesSection.tsx missing-outstanding branch. These conditional states were not rendered with the current seed.

#### UX-084 · P2 — Timesheet status names describe a push engine

- **Visible symptom:** Pending ERP push, Pushing to ERP, Pushed to ERP and ERP push held are the user-facing badge labels.
- **User harm:** A staff member cannot distinguish time approval from accounting synchronization without learning the transfer engine.
- **Direction:** Keep approval status primary; use Updating accounting / Up to date / Accounting update needs attention as secondary exception states.
- **Screenshot:** [ux-admin-timesheets-1280.png](shots/2026-10-16/ux-admin-timesheets-1280.png)
- **Evidence qualification:** SOURCE-ONLY: pmo-portal/src/components/timesheets/PushStateBadge.tsx. The live week had no push mirror state; screenshot shows its host surface only.

#### UX-085 · P2 — Setup actions name adapter concepts

- **Visible symptom:** Conditional setup exposes Employ ERP domains, Refresh Company defaults, Set activity and receivable defaults, and ClickUp binding map.
- **User harm:** The owner must understand domains, bindings and refresh mechanics instead of confirming which business information should stay updated.
- **Direction:** Use Choose data to keep updated, Review company settings and Project connections, with proposed existing values and a clear business consequence.
- **Screenshot:** [ux-admin-integration-setup-390.png](shots/2026-10-16/ux-admin-integration-setup-390.png)
- **Evidence qualification:** SOURCE-ONLY: ErpSetupChecklist.tsx and IntegrationsView.tsx successful/connected branches. The current checklist was unavailable and ClickUp disconnected; no claim these controls were live-rendered.


## Cross-cutting information architecture

This is a direction to validate, not permission to delete modules or move role/financial boundaries.

| Layer | Current burden | Recommended shape |
|---|---|---|
| Daily entry | Dashboard is a metric tour; approvals and exceptions have weak persistence | Home starts with decisions and exceptions; secondary portfolio totals are quieter |
| Global navigation | Feature/directory list extends beyond the rail viewport | Stable daily destinations: Home, Projects, Approvals, Finance; role-relevant My work and a clearly labelled More/Setup grouping. Sales remains a recognizable destination, not silently folded into delivery |
| Project identity | Full record header, tax detail and permanent details rail repeated on all tabs | Compact identity, visible current section, task-owned primary action; record metadata/actions on demand |
| Project money | Header, finance, budget, projection, drawdown, work orders, invoices and payments all contribute overlapping answers | One money summary with explicitly different Spending, Forecast and Billing drill-downs; never merge unlike totals merely to reduce cards |
| Billing | Billing models and global invoice creation require context reconstruction | One project Billing entry that preserves project/customer/order, supports the existing models and explains the approval-to-client handoff |
| Organization setup | Connection badge, domains, accounting, category maps, item code, project/list/employee matches | One resumable setup review over focused steps; propose existing matches, confirm consequences, show readiness by task and retain stable accepted links |
| Ongoing integration work | Repeated project linking and generic retry messages | Quiet current state; visible exceptions for ambiguity, new entities or consequential changes, with a concrete recovery owner/action |

**Setup-once boundary:** recommendations are not automatic permission to fuzzy-link people, repoint accounts or alter financial rules. Existing matches should be retained by stable identity; new/ambiguous matches should be proposed, explained and reviewed. Subsequent data updates should not make users re-confirm the same unchanged relationship. PMO must remain the human work surface: `docs/decisions.md` **OD-ERP-3** already assigns ERP operator work away from client users, including accountants. Asking them to open ERPNext to fix PMO is not the recommendation.

## Task friction and click accounting

Counts start after sign-in with the target record known. A click means a navigation/action activation, not scrolling, typing or every field-focus click. Required selection work is called out separately. Do not confuse opening a form with completing the business goal.

| Goal and start | Observed route/action count | What remains / why the count is limited |
|---|---|---|
| See reference project's money, from Dashboard | **2 navigation clicks:** Projects → project; Overview finance then needs scrolling, not another tab | This reaches several figures, not one trustworthy reconciled answer. Header procurement Actual is $2.36m; mapped ledger total is $1.78m with four unavailable categories. Interpretation still requires context |
| See forecast, from project Overview | **1 tab click:** Budget, then scroll past version line items; desktop also horizontal panning | Phone has existing stacked forecast rows; its problem is long entry depth and unclear unavailable states, not a missing responsive table implementation |
| Raise project invoice, global entry from Dashboard as Admin | **2 clicks to open:** Sales Invoices → New invoice; **3 action clicks including Create invoice**, excluding field work | Customer and Project are repeated choices; selecting both adds at least four open/select activations in this path, plus line entry. A lower bound of **7** is not an end-to-end observed create/send total. Draft creation was not committed |
| Raise from project Billing | **3 clicks from Dashboard to reach Billing:** Projects → project → Billing | Current empty billing models do not provide one obvious generic invoice start; do not invent a completed count through empty work orders/quantity claims |
| Send invoice to client | **Not end-to-end measurable in this seed** | Inspected source: draft → different approver → approved invoice row menu → Download PDF. Menu + download are two post-approval actions, not proof of delivery. Manual sending/receipt recording must be explained; no direct email-send control was established in the inspected invoice flow |
| Approve requested purchase from inbox | **3 actions:** select request → Approve → confirmation Approve | Selection and first Approve were executed; the money-aware confirmation was inspected then cancelled. Final action count is source-confirmed; no decision was committed. If the correct request is already selected, it is two |
| Same approval from Dashboard | **4 actions:** Review → select request → Approve → confirm | Both role dashboards offer Review. Phone adds scrolling to reach it but not an extra action on this route; rail navigation can add opening the phone menu |
| Staff hours submission | Existing Submit can autosave before its confirmation | Do **not** add Save as a mandatory step. The finding is empty/unchanged Save state and mixed personal/team entry, not a missing autosave capability |
| Review account setup | At least **two action clicks per unmapped budget category** (Map → Save), plus exact-name entry and external lookup effort | A proposal review should remove repeated lookup/recognition work, not eliminate consequential human confirmation. Typing time and decisions matter more than a cosmetically reduced click count |

## Jargon replacement register

This covers the jargon encountered in the rendered matrix and the explicitly inspected conditional components, not an unsupported claim to have inventoried every string in the repository. **R** rendered; **S** source-only conditional. Quoted language not rendered is not passed off as a live screenshot. Proposed copy must retain the true calculation/state; names alone cannot repair the money model.

| Current language | Evidence | User-facing direction / caveat |
|---|---|---|
| Executive Dashboard / My Dashboard | R dashboard | Dashboard, with role-relevant content rather than a different mental model |
| Revenue on hand | R dashboard | Contracted revenue; state scope |
| Realized margin | R dashboard | Margin to date, if that is the existing calculation; never imply cash/final profit |
| Budget vs Actual | R dashboard + BvACard | Spending / contract for the current calculation; use Budget only if the denominator changes deliberately |
| On-hand margin | R project header | Margin to date, with explicit basis |
| Actual / Committed / Spend | R project header, lists, summary | Name the actual source/scope: procurement spend, confirmed commitments, request value or budget used; do not collapse them into synonyms |
| Mapped GL costs | R Overview | Recorded spending, with visible completeness |
| GL actuals | R Overview | Recorded spending by category |
| Account mapping unavailable | R Overview | Spending unavailable for this category; owner: Review account setup; PM: explain who can resolve it |
| Incomplete — ERP outstanding missing | S ProjectFinancesSection | Invoice balance unavailable; name what cannot yet be calculated |
| Lifetime to date | R Overview | Since project start |
| Variance (spent minus budget) | R Overview | Budget remaining / Over budget by |
| Variance (budget minus forecast) | R projection | Forecast remaining / Forecast overrun; retain the different formula |
| Budget (PMO) | R projection | Budget; source in details |
| Actuals to date (ERP ledger) | R projection | Recorded spending; source in details |
| ETC (PMO) | R projection | Cost to finish |
| Projected final | R projection | Forecast final cost |
| Utilization | R projection | Forecast budget used |
| Enforced by ERPNext / raw budget document name | R projection | Budget checks active; optional linked accounting reference |
| excl. PPN / net of tax | R monetary surfaces | Before VAT / tax excluded; preserve jurisdiction and recorded basis in details |
| DPP 1/1 / rate not recorded | R project header | Taxable base / VAT rate not set, only in relevant detail or billing readiness |
| Won, Pending KoM | R project status | Won — kickoff pending |
| Contract ceiling / Drawdown | R project billing/work orders | Contract limit / Billed and remaining, once the exact measure is confirmed |
| Billing claim / quantities done / down payment recovered | R Billing | Progress invoice / completed quantities / advance applied; keep contractual meanings available |
| PR → VQ → PO → GR → VI → Paid | R Procurement | Request → Quotes → Order → Delivery → Supplier invoice → Paid, preferably only in detail |
| Requested / Purchase Request | R inbox/detail | Awaiting approval / Purchase request as a document name; do not use the document name as an inconsistent stage |
| Vendor Quote / Vendor Quoted | R procurement/dashboard | Getting supplier quotes, consistently |
| Separation-of-duties gates | R procurement intro | A different person reviews the request; explain relevant policy at the decision |
| Import cycle data | R procurement toolbar | Import purchase history, inside transfer tools; preserve importer scope |
| Paid Amount | R payment form | Amount settled on invoice |
| Received Amount | R payment form | Cash received |
| Withheld tax / withholding slip | R payment form | Tax withheld / withholding certificate; reveal the evidence fields when applicable |
| docstatus 1→2 | S invoice/payment cancellation | Cancel approved invoice / Cancel recorded payment, with the concrete consequence |
| Pending ERP push / Pushing to ERP | S timesheet badge | Accounting update waiting / Updating accounting |
| Pushed to ERP / ERP push failed / ERP push held | S timesheet badge | Accounting up to date / Accounting update failed / Accounting update needs attention; retain approval state separately |
| ERPNext Project / returned identifier | R rail, S dialog help | Accounting project connection; use the existing valid-project picker and explain the proposed match |
| Bi-directional sync / Push / Pull | R Tasks intro, S connected controls | Updates in both tools / Start with PMO tasks / Start with existing ClickUp tasks; distinguish initial import from ongoing updates |
| ClickUp List / binding map | S connected integration controls | Connected task list / Project connections |
| Employ ERP domains / Employed domains | S setup action, R ownership section | Choose data to keep updated / Data shared automatically |
| Source of truth / data provenance | R/S integration ownership | Where updates come from / Data source, in optional details |
| 0 outbound items pending or need attention | R integrations | No updates waiting; list failures separately from normal waiting work |
| ERP setup unavailable | R checklist failure | Could not check accounting readiness, with specific next action/handoff |
| Refresh Company defaults | S setup checklist | Review connected company settings |
| Set activity and receivable defaults | S setup checklist | Set up time recording and customer billing |
| Exact ERPNext account name | R accounting fields | Choose account; searchable valid choices and proposed matches |
| Budget push / use for budget push | R category map | Main budget account / Use as main budget account, with posting consequence in details |
| Not mapped — blocks every push | R category map | Budget setup incomplete — choose accounts for the remaining categories |
| Fail closed | S budget unmap confirmation | Budget updates stop until the account is replaced; do not soften the actual consequence |
| Next recovery pass | S projection recovery toast | Will retry automatically, only if true; provide an honest next check/action without inventing an ETA |
| Standard role rules apply | R approver setup | Show the actual default approving roles/eligible reviewers |
| Project number pattern | R accounting | Project number format, under Project setup |
| Created / empty → raw reference | R History | Describe the business event and recognizable linked record |
| Select | R Approvals bulk-mode entry | Select items, with scope and eligible count |

## AI tells and deterministic evidence

There is no evidence here that changing the font, adding brand flourishes or deleting every card would improve the operator's job. The authored visual system is a strength. The generated-feeling signals are **structural**: equal-weight KPI tours, exhaustive feature controls, duplicated empty-state CTAs, machine-led copy and repeated metadata. Those have user harm and are already numbered above; they are not additional unnumbered defects.

### Detector protocol

Authenticated rendered URL scans used the bundled impeccable CLI with JSON output, once per route/role/viewport. A temporary local-only bootstrap proxy supplied the browser's existing local session; session material stayed outside tracked files. An initial unauthenticated login preflight is excluded. All final scan JSON was checked as parseable output; exit 2 means findings, not a crash.

The browser mutation preflight succeeded. The live detector script was injected on **Billing, Projects, Budget and Accounting**; overlay nodes and impeccable console messages were observed (Projects 21 overlay nodes, Budget 11, Accounting 1 at the inspected phone state). This was headless browser evidence, **not a visible Human tab offered to the owner**. DOM-overlay counts are not the CLI's full CSS-inclusive counts. Overlays were not baked into the committed clean PNGs. The live helper, proxies and local review server are stopped after evidence collection.

### Full scan totals

| Role | Scans | Primary warnings | Advisories | Total raw signals |
|---|---:|---:|---:|---:|
| Admin | 42 | 255 | 12 | 267 |
| PM | 42 | 248 | 10 | 258 |
| **Total** | **84** | **503** | **22** | **525** |

Counts are raw detector hits, including repeated nodes, across role/viewport states. Advisory rules stay advisory. These are not 525 separately verified UX findings.

| Rule | Admin hits | PM hits | Kind |
|---|---:|---:|---|
| `tiny-text` | 46 | 46 | Primary warning |
| `overused-font` | 42 | 42 | Primary warning |
| `bounce-easing` | 42 | 42 | Primary warning |
| `nested-cards` | 39 | 36 | Primary warning |
| `undersized-ui-text` | 16 | 16 | Primary warning |
| `clipped-overflow-container` | 11 | 9 | Primary warning |
| `cramped-padding` | 10 | 10 | Primary warning |
| `text-overflow` | 10 | 10 | Primary warning |
| `text-occlusion` | 8 | 8 | Primary warning |
| `skipped-heading` | 8 | 8 | Primary warning |
| `em-dash-overuse` | 6 | 6 | Advisory |
| `edge-flush-cards` | 6 | 6 | Primary warning |
| `flat-type-hierarchy` | 6 | 6 | Primary warning |
| `first-viewport-column-overflow` | 5 | 5 | Primary warning |
| `low-contrast` | 4 | 4 | Primary warning |
| `gpt-thin-border-wide-shadow` | 4 | 2 | Advisory |
| `repeating-stripes-gradient` | 2 | 2 | Advisory |
| `line-length` | 2 | 0 | Primary warning |

### Per-route scan output counts

Cells are **primary + advisory**. Route locations resolve through the matrix above. PM Administration cells scan the expected denied surface, not the Admin setup controls. No login scan is substituted.

| Route slug | Admin desktop | Admin phone | PM desktop | PM phone |
|---|---:|---:|---:|---:|
| dashboard | 3 + 1 | 3 + 1 | 2 + 0 | 2 + 0 |
| projects | 22 + 0 | 22 + 0 | 22 + 0 | 22 + 0 |
| overview | 7 + 2 | 8 + 2 | 7 + 2 | 8 + 2 |
| budget | 8 + 1 | 12 + 1 | 8 + 1 | 10 + 1 |
| project-procurement | 4 + 0 | 6 + 0 | 4 + 0 | 6 + 0 |
| tasks | 11 + 1 | 6 + 1 | 11 + 1 | 7 + 1 |
| work-orders | 4 + 0 | 5 + 0 | 4 + 0 | 5 + 0 |
| billing | 6 + 0 | 5 + 0 | 6 + 0 | 5 + 0 |
| documents | 5 + 0 | 6 + 0 | 5 + 0 | 6 + 0 |
| history | 5 + 1 | 6 + 1 | 5 + 1 | 7 + 1 |
| sales | 18 + 0 | 19 + 0 | 18 + 0 | 19 + 0 |
| invoices | 3 + 0 | 3 + 0 | 3 + 0 | 3 + 0 |
| payments | 3 + 0 | 3 + 0 | 3 + 0 | 3 + 0 |
| procurement | 3 + 0 | 2 + 0 | 3 + 0 | 2 + 0 |
| approvals | 4 + 0 | 5 + 0 | 3 + 0 | 4 + 0 |
| timesheets | 2 + 0 | 2 + 0 | 2 + 0 | 3 + 0 |
| expenses | 2 + 0 | 2 + 0 | 2 + 0 | 2 + 0 |
| integrations | 4 + 0 | 4 + 0 | 2 + 0 | 3 + 0 |
| accounting | 3 + 0 | 2 + 0 | 2 + 0 | 2 + 0 |
| revenue | 2 + 0 | 2 + 0 | 2 + 0 | 2 + 0 |
| request-detail | 6 + 0 | 7 + 0 | 6 + 0 | 7 + 0 |

### Detector disposition, not automatic defect promotion

| Signal | Interpretation / action |
|---|---|
| `overused-font` | All scans detect Inter. **Rejected as an actionable defect:** Inter is the established DESIGN.md choice; popularity is not user harm. Retain it |
| `bounce-easing` | CSS contains `var(--animate-bounce)`. No visible bouncing element was established in these task states. Do not remove a dependency/token merely because its rule exists |
| `tiny-text`, `undersized-ui-text` | Corroborate the readable-metadata finding. The 8px initials and 10px Current label deserve correction; a blanket claim that all 11px metadata is inaccessible would be unsupported |
| `skipped-heading` | Confirmed outline mismatch on Billing/Work orders/procurement/approvals variants; prioritize meaningful work-section headings, not a mechanical tag rename alone |
| `nested-cards`, `cramped-padding`, `edge-flush-cards` | Useful prompts for the repeated KPI/preview/table containers. Some table headers and intentionally separate evidence panels are misclassified as cards; keep necessary grouping. Act through the numbered hierarchy/toolbar/preview findings, not 39 independent card removals |
| `first-viewport-column-overflow` | Corroborates the long work column next to permanent identity/ERP metadata. A long page alone is not a defect; the wasted constrained task width is the actionable symptom |
| `text-overflow` | Most project-phone hits are an intentionally ellipsized shell title (`max-width` + `text-overflow: ellipsis`). Full identity remains in the page. Do not report this alone as text loss. Off-screen selected tabs and meaningful desktop table outcomes are separately evidenced |
| `text-occlusion` | **False-positive in sampled Budget phone state:** detected money values are inside a closed Financial summary `<details>`. Browser `checkVisibility()` returned false for $2.36m, $2.89m and 52%, with `open=false`. No claim that a visible toolbar covered these figures |
| `clipped-overflow-container` | Often the intentional full-height shell clip around a positioned descendant. No cut-off tooltip/popover was demonstrated. Treat as a candidate, not a verified broken overlay |
| `low-contrast` | Sampled warnings target disabled Export on empty invoice/payment lists. Inactive controls are not grounds for the claimed AA text failure. No live-body contrast violation or pass is asserted |
| `flat-type-hierarchy`, `line-length` | Minor prompts, not automatic re-tokenization: phone heading steps and accounting help prose need task hierarchy first. Improve the numbered copy/IA problems rather than inventing a separate typography defect |
| `em-dash-overuse` | **Advisory**, often the repeated unavailable-value dashes in Budget/Tasks rather than prose cadence. Do not replace honest missing values to make a detector green; explain their meaning |
| `gpt-thin-border-wide-shadow`, `repeating-stripes-gradient` | **Advisory**, not proof of AI authorship or user harm. No extra finding or gratuitous restyling follows without a demonstrated problem |

## Ordered, bounded work slices

These are proposed independent issue briefs, **not** a signed implementation plan. Each finding appears in exactly one slice below. Slice order puts misleading money and blocked setup understanding first, then task structure, then local friction. Different slices may touch the same component; serialize those changes rather than dispatching overlapping edits in parallel.

Each slice must reproduce its listed symptom, add the lowest sufficient behavior/visual regression, implement only its bounded change, and re-render Admin/PM at both target sizes. Preserve role rules, financial definitions and consequential confirmation. Proposed matches need deterministic fixtures for confident, ambiguous and unmatched states, not silent fuzzy acceptance. Choose the executor using the standing factory workflow; money/identity semantics need the appropriate heightened review. Nothing in this audit authorizes bypassing that routing.

| Slice | Bounded change | Finding IDs — exact-once ownership | Completion oracle |
|---|---|---|---|
| S-01 | Reconcile dashboard/project spending read models | UX-014 | The same seeded project produces the same spending basis for Admin and PM; unavailable is not a false zero, and legitimate portfolio scopes remain distinct. |
| S-02 | Name the existing contract comparison honestly | UX-013 | Assert the visible title/denominator together; keep the existing calculation unless the owner signs a different metric. |
| S-03 | Make partial spending unmistakable | UX-023, UX-024 | Cover complete, partly mapped and unavailable costs, including role-appropriate recovery; no missing category may silently become zero. |
| S-04 | Create one project money entry summary | UX-022 | Reuse existing distinct figures without changing their formulas; verify no repeated headline blocks and clear drill-down destinations. |
| S-05 | Clarify existing project money labels | UX-025, UX-026, UX-027, UX-032 | Verify request-value versus commitment scope, both variance signs, freshness label and empty settlement help; no arithmetic changes. |
| S-06 | Add a bounded setup-review entry surface | UX-009 | Link existing focused steps, retain progress and list unresolved exceptions; matcher implementations remain separate slices below. |
| S-07 | Unify organization connection/readiness presentation | UX-067, UX-068, UX-072 | Test connected-but-unknown, verified-ready and retry-failed states; preserve connection and show a real operator handoff. |
| S-08 | Repair the expense-setup connection loop | UX-080 | A connected-but-expense-unready fixture names the missing task and links to it rather than suggesting reconnect. |
| S-09 | Replace exact-name budget-account input | UX-076 | Use a valid-account selector with a reviewed proposal; cover loading, ambiguity, no match and retained existing choices. |
| S-10 | Replace four exact-name tax-account inputs | UX-078 | Filter valid choices by purpose; require explicit review and preserve existing posting semantics. |
| S-11 | Offer a verified advance-billing item choice | UX-079 | Explain and validate the existing accounting consequence; show operator action when no suitable item exists. |
| S-12 | Add a reviewed fallback to an existing proposal | UX-082 | Keep identity confirmation; cover correct suggestion, wrong suggestion, absent identity and deliberate alternate selection. |
| S-13 | Make project linking one understandable decision | UX-028, UX-029 | Reuse the existing valid-project picker, propose a match and offer useful failed-link recovery; no successful link is implied until confirmed. |
| S-14 | Review initial project/list matches once | UX-042 | Reuse list catalogue/accepted links; separate initial import direction from ongoing sync; cover new and ambiguous lists. |
| S-15 | Add a draft review total and sensible item entry | UX-051, UX-052 | Bind tests to real item/line calculations and tax readiness; description-first native entry must preserve connected item selection. |
| S-16 | Explain the approved-invoice delivery handoff | UX-053 | Existing PDF/manual-delivery path is honest about Draft, Approved and Delivered; no direct-send capability is invented. |
| S-17 | Establish one project billing start | UX-043, UX-044 | Empty work-order/quantity/native methods explain the next step without repeated zero dashboards; retain all billing models. |
| S-18 | Explain unavailable forecast values visibly | UX-036 | Cover partly mapped categories and incomplete totals without hover-only recovery or misleading zeros. |
| S-19 | Expose the forecast without a budget-line-item detour | UX-034 | Add a clear bounded subview/anchor from Budget and project money; preserve budget version operations. |
| S-20 | Put desktop forecast outcomes in view | UX-035 | Verify final cost and overrun at 1280px without lateral panning; retain the existing stacked phone rows. |
| S-21 | Compact repeated identity on non-Overview sections | UX-003 | Assert the task starts earlier at phone width while identity and full metadata remain discoverable. |
| S-22 | Let the selected project task own its primary action | UX-002 | Preserve permitted project transitions and confirmations, but remove record-wide visual priority from unrelated jobs. |
| S-23 | Keep the selected section visible | UX-004 | Direct-link each of the eight sections at 390px and assert selected-state visibility plus keyboard access. |
| S-24 | Keep daily approvals persistently reachable | UX-001 | Test the Admin/PM rail at 800px height and phone menu with long navigation; no role-sensitive route is removed. |
| S-25 | Put attention ahead of passive KPI cards | UX-016 | Render rich/empty queues at both sizes; first actionable work precedes secondary portfolio statistics. |
| S-26 | Clarify booked money and project margin | UX-015, UX-017 | Match labels/help to shipped calculations and label the trailing PM percentage; no financial calculation changes. |
| S-27 | Carry project context into the existing invoice form | UX-050 | Project/customer/order are retained when starting from a project; global creation still works and all permission checks remain. |
| S-28 | Make invoice/payment/revenue empties role-aware | UX-010, UX-011 | One create action for authorized users and an achievable next step for PM; avoid duplicate CTAs and wrong directory detours. |
| S-29 | Normalize purchasing vocabulary | UX-008, UX-056 | Assert one stage vocabulary across dashboard/inbox/list/detail and replace the acronym-led intro without altering stored states. |
| S-30 | Make work-section headings reflect the task outline | UX-012 | Verify real h2 work sections before subordinate ERP details on affected variants; run targeted semantic/a11y checks. |
| S-31 | Improve effective phone action targets | UX-006 | Measure actual pointer areas including pseudo-elements and spacing, especially adjacent record-wide/destructive actions; retain desktop density. |
| S-32 | Replace functional microtext with readable recognition | UX-007 | Cover manager identity and Current marker at normal zoom; reduce metadata rather than shrinking it further. |
| S-33 | Disclose tax detail at the right moment | UX-005 | Preserve honest before/after-tax basis and missing-rate billing safeguards; remove always-on DPP machinery from unrelated tasks. |
| S-34 | Simplify the project-list control hierarchy | UX-018 | Keep search/scope/current view immediate; secondary filters and transfer tools remain discoverable and stateful. |
| S-35 | Make project rows recognizable and semantically clear | UX-019, UX-020, UX-021 | Cover long names/references, all-empty optional columns and successful 100% delivery styling without changing budget risk colors. |
| S-36 | Recover desktop work width from permanent metadata | UX-030 | Keep details reachable; visual regression on wide forecast/document/task content at 1280px plus phone placement. |
| S-37 | Disambiguate cross-year phase targets | UX-031 | Date-format tests cover prior-year, current-year and overdue-cross-year dates with no timezone regression. |
| S-38 | Remove repeated active-version announcements | UX-033 | One selector/header exposes version/status/amount; clone/archive/history remain accessible and correct. |
| S-39 | Make forecast terms and percentages explicit | UX-037, UX-038 | Assert Cost to finish, Forecast final cost and Forecast budget used; source/enforcement references remain on demand. |
| S-40 | Edit related cost-to-finish lines in one review | UX-039 | Multi-row draft save preserves existing field validation, cancel and financial consequences; test partial invalid input. |
| S-41 | De-emphasize lifecycle repetition and bulk transfer | UX-040, UX-057 | Keep recognizable stage/next step and Raise request; full journey/importers remain reachable without repeating on each row. |
| S-42 | Move disconnected integration setup out of daily tasks | UX-041 | Disconnected state does not displace tasks; connected actionable exceptions remain visible without a permanent setup tour. |
| S-43 | Distinguish no attachment from an unavailable download | UX-045 | Test issued/approved records without files, files present and permission-appropriate remediation. |
| S-44 | Lead event history with a business outcome | UX-046 | Group bulk/system events, retain exact references/timestamps on demand and link recognizable records. |
| S-45 | Use one phone stage navigation and readable list | UX-047 | Preserve funnel/board power on desktop; stage state, result count and project actions work without three independent phone scrollers. |
| S-46 | Remove repeated sales metadata and naming drift | UX-048, UX-049 | Consistent Sales pipeline title; concise card keeps identity/value/next action with identifiers and weighting details available. |
| S-47 | Make cash/settlement/withholding understandable | UX-054, UX-055 | Preserve existing prefill/reconciliation; test no-withholding and withholding evidence with an honest cash-plus-tax equation. |
| S-48 | Consolidate request-detail decisions and evidence | UX-058, UX-059 | One responsive decision area retains approve/reject/cancel and confirmation; remove redundant identity/policy blocks, not safeguards. |
| S-49 | Give phone approval types one review grammar | UX-060, UX-061 | Procurement and timesheets share selection/preview semantics; bulk entry names its scope and preserves type-specific evidence. |
| S-50 | Separate personal entry from team review | UX-062, UX-063 | Role-appropriate entry, visible saved/dirty status and disabled unchanged Save; existing Submit autosave remains intact. |
| S-51 | Capture the first expense line/receipt in the draft | UX-064, UX-066 | Remove the empty-shell detour and duplicate Title/Purpose burden while preserving cancel, evidence and later lines. |
| S-52 | Propose a budget route in business language | UX-065 | User can review/correct the proposed expense category; existing approval routing is unchanged and visible. |
| S-53 | Explain connection ownership and queue state plainly | UX-069, UX-070, UX-071 | Link personal settings, separate waiting/failure counts and describe concrete data groups; zero does not carry warning styling. |
| S-54 | Add focused setup wayfinding and relocate numbering | UX-073, UX-074 | Stable anchors/deep links reach tax, approvers, maps and items; project-number controls move to Project setup with a compatibility route. |
| S-55 | Align number-format help with the real validator | UX-075 | Test supported token combinations and preview without renumbering any existing record. |
| S-56 | Review proposed budget matches as a group | UX-077 | Show main posting account versus additional read accounts clearly; changes remain explicit and existing links are retained. |
| S-57 | Show the resolved default approval route | UX-081 | Empty explicit list resolves into readable default roles/eligible reviewers; distinguish default from truly unconfigured. |
| S-58 | Replace internal state in financial confirmations/recovery | UX-083 | Assert cancellation consequences, unmapped-budget consequence, outstanding-data absence and honest retry wording; no state/control changes. |
| S-59 | Distinguish approval from accounting update status | UX-084 | Real badge component covers waiting/updating/current/failed/held without implying a different approval state. |
| S-60 | Rename conditional adapter/setup controls | UX-085 | Concrete data/setup outcomes replace domains/bindings/default-mechanics labels; keep source details and original operations available. |

### Graduation and acceptance

This findings-only commission does **not** satisfy ADR-0030's graduation requirement by itself. On implementation, each finding's owning slice must add the durable test, a routes × oracles cell and a DESIGN.md/decisions retention note, then complete the required reviewers and rendered Discover re-check. Do not mark these 85 findings graduated because this document or an image exists. Shared-code changes still need the prescribed local scoped gates and CI's full-suite proof; no app test suite was rerun for a docs-only audit.

## Owner decisions — questions with recommendations

These are strategy/scope choices, not claims that source defaults are new owner rulings. Existing OD-ERP-3 remains in force.

1. **What should the current dashboard bar mean: budget usage or spend relative to contract?** Recommend **rename the current calculation first** to Spending / contract; a deliberate budget metric can follow with a separate traceable contract. Do not silently change the denominator while decluttering.
2. **Should project money default to all apparently available totals, or one reconciled scoped position?** Recommend **one scoped position with explicit missing coverage**, distinct commitment/ledger/billing drill-downs and a source/freshness disclosure. Never substitute zero for unavailable.
3. **Where should Sales sit in the owner's daily navigation: a persistent top-level destination or a secondary job group?** Recommend **retain its recognizable identity while testing daily usage**, and make Approvals persistently reachable before removing any destination. A five-item ideal is not a reason to hide a daily owner task.
4. **Should ERP/account/list setup be client self-service, operator-assisted, or entirely operator-owned?** Recommend **PMO-guided proposal review with operator recovery inside PMO**; clients should not need ERPNext access. This extends, rather than reopens, OD-ERP-3.
5. **May confident proposed matches be applied silently?** Recommend **no silent identity or financial-account reassignment**. Review the first consequential match, persist stable links, auto-maintain unchanged data and surface only ambiguity/new exceptions afterward.
6. **Does “send an invoice” mean manual PDF delivery first or integrated email delivery now?** Recommend **make the existing approved-PDF handoff explicit first**, including delivery/received state; treat email delivery as a separately signed capability. Never label a generated draft or downloaded PDF Sent.
7. **Should billing models remain visible as separate parallel empty panels?** Recommend **one project Billing start with a business-labelled method choice**, retaining contract/work-order/quantity differences underneath rather than deleting them.
8. **Should phone use be full operational parity or primarily review/approval?** Recommend **daily parity for checking money, approving, and recording time/receipts**, with comfortable responsive controls; rare bulk configuration can remain desktop-optimized but must not dead-end a phone user.
9. **Can finance terminology be simplified without changing calculations?** Recommend **plain business labels plus accounting/source details on demand**, with a glossary/formula review for ambiguous words such as Actual, Committed and Margin before replacing them.
10. **Should a claim begin with a shell record or its receipt/first expense line?** Recommend **receipt/line-first draft capture**, retaining the same approval route and evidence requirements.

## Evidence index

100 PNGs, 50 desktop/phone pairs. Filenames identify role and width. `1280` means 1280×800; `390` means 390×844. Supplemental names identify dialog/scroll states, not routes. Seed identities and business records are fictional; no real customer/account material was used.

| Role / state | 1280×800 | 390×844 |
|---|---|---|
| admin-account-map-new | [ux-admin-account-map-new-1280.png](shots/2026-10-16/ux-admin-account-map-new-1280.png) | [ux-admin-account-map-new-390.png](shots/2026-10-16/ux-admin-account-map-new-390.png) |
| admin-accounting | [ux-admin-accounting-1280.png](shots/2026-10-16/ux-admin-accounting-1280.png) | [ux-admin-accounting-390.png](shots/2026-10-16/ux-admin-accounting-390.png) |
| admin-accounting-maps | [ux-admin-accounting-maps-1280.png](shots/2026-10-16/ux-admin-accounting-maps-1280.png) | [ux-admin-accounting-maps-390.png](shots/2026-10-16/ux-admin-accounting-maps-390.png) |
| admin-advance-item | [ux-admin-advance-item-1280.png](shots/2026-10-16/ux-admin-advance-item-1280.png) | [ux-admin-advance-item-390.png](shots/2026-10-16/ux-admin-advance-item-390.png) |
| admin-approval-request | [ux-admin-approval-request-1280.png](shots/2026-10-16/ux-admin-approval-request-1280.png) | [ux-admin-approval-request-390.png](shots/2026-10-16/ux-admin-approval-request-390.png) |
| admin-approvals | [ux-admin-approvals-1280.png](shots/2026-10-16/ux-admin-approvals-1280.png) | [ux-admin-approvals-390.png](shots/2026-10-16/ux-admin-approvals-390.png) |
| admin-billing | [ux-admin-billing-1280.png](shots/2026-10-16/ux-admin-billing-1280.png) | [ux-admin-billing-390.png](shots/2026-10-16/ux-admin-billing-390.png) |
| admin-billing-empty | [ux-admin-billing-empty-1280.png](shots/2026-10-16/ux-admin-billing-empty-1280.png) | [ux-admin-billing-empty-390.png](shots/2026-10-16/ux-admin-billing-empty-390.png) |
| admin-budget | [ux-admin-budget-1280.png](shots/2026-10-16/ux-admin-budget-1280.png) | [ux-admin-budget-390.png](shots/2026-10-16/ux-admin-budget-390.png) |
| admin-budget-snapshot | [ux-admin-budget-snapshot-1280.png](shots/2026-10-16/ux-admin-budget-snapshot-1280.png) | [ux-admin-budget-snapshot-390.png](shots/2026-10-16/ux-admin-budget-snapshot-390.png) |
| admin-dashboard | [ux-admin-dashboard-1280.png](shots/2026-10-16/ux-admin-dashboard-1280.png) | [ux-admin-dashboard-390.png](shots/2026-10-16/ux-admin-dashboard-390.png) |
| admin-documents | [ux-admin-documents-1280.png](shots/2026-10-16/ux-admin-documents-1280.png) | [ux-admin-documents-390.png](shots/2026-10-16/ux-admin-documents-390.png) |
| admin-erp-link | [ux-admin-erp-link-1280.png](shots/2026-10-16/ux-admin-erp-link-1280.png) | [ux-admin-erp-link-390.png](shots/2026-10-16/ux-admin-erp-link-390.png) |
| admin-expense-map | [ux-admin-expense-map-1280.png](shots/2026-10-16/ux-admin-expense-map-1280.png) | [ux-admin-expense-map-390.png](shots/2026-10-16/ux-admin-expense-map-390.png) |
| admin-expense-new | [ux-admin-expense-new-1280.png](shots/2026-10-16/ux-admin-expense-new-1280.png) | [ux-admin-expense-new-390.png](shots/2026-10-16/ux-admin-expense-new-390.png) |
| admin-expenses | [ux-admin-expenses-1280.png](shots/2026-10-16/ux-admin-expenses-1280.png) | [ux-admin-expenses-390.png](shots/2026-10-16/ux-admin-expenses-390.png) |
| admin-finances | [ux-admin-finances-1280.png](shots/2026-10-16/ux-admin-finances-1280.png) | [ux-admin-finances-390.png](shots/2026-10-16/ux-admin-finances-390.png) |
| admin-history | [ux-admin-history-1280.png](shots/2026-10-16/ux-admin-history-1280.png) | [ux-admin-history-390.png](shots/2026-10-16/ux-admin-history-390.png) |
| admin-integration-setup | [ux-admin-integration-setup-1280.png](shots/2026-10-16/ux-admin-integration-setup-1280.png) | [ux-admin-integration-setup-390.png](shots/2026-10-16/ux-admin-integration-setup-390.png) |
| admin-integrations | [ux-admin-integrations-1280.png](shots/2026-10-16/ux-admin-integrations-1280.png) | [ux-admin-integrations-390.png](shots/2026-10-16/ux-admin-integrations-390.png) |
| admin-invoice-new | [ux-admin-invoice-new-1280.png](shots/2026-10-16/ux-admin-invoice-new-1280.png) | [ux-admin-invoice-new-390.png](shots/2026-10-16/ux-admin-invoice-new-390.png) |
| admin-invoices | [ux-admin-invoices-1280.png](shots/2026-10-16/ux-admin-invoices-1280.png) | [ux-admin-invoices-390.png](shots/2026-10-16/ux-admin-invoices-390.png) |
| admin-overview | [ux-admin-overview-1280.png](shots/2026-10-16/ux-admin-overview-1280.png) | [ux-admin-overview-390.png](shots/2026-10-16/ux-admin-overview-390.png) |
| admin-payment-new | [ux-admin-payment-new-1280.png](shots/2026-10-16/ux-admin-payment-new-1280.png) | [ux-admin-payment-new-390.png](shots/2026-10-16/ux-admin-payment-new-390.png) |
| admin-payments | [ux-admin-payments-1280.png](shots/2026-10-16/ux-admin-payments-1280.png) | [ux-admin-payments-390.png](shots/2026-10-16/ux-admin-payments-390.png) |
| admin-procurement | [ux-admin-procurement-1280.png](shots/2026-10-16/ux-admin-procurement-1280.png) | [ux-admin-procurement-390.png](shots/2026-10-16/ux-admin-procurement-390.png) |
| admin-project-procurement | [ux-admin-project-procurement-1280.png](shots/2026-10-16/ux-admin-project-procurement-1280.png) | [ux-admin-project-procurement-390.png](shots/2026-10-16/ux-admin-project-procurement-390.png) |
| admin-projection | [ux-admin-projection-1280.png](shots/2026-10-16/ux-admin-projection-1280.png) | [ux-admin-projection-390.png](shots/2026-10-16/ux-admin-projection-390.png) |
| admin-projects | [ux-admin-projects-1280.png](shots/2026-10-16/ux-admin-projects-1280.png) | [ux-admin-projects-390.png](shots/2026-10-16/ux-admin-projects-390.png) |
| admin-request-detail | [ux-admin-request-detail-1280.png](shots/2026-10-16/ux-admin-request-detail-1280.png) | [ux-admin-request-detail-390.png](shots/2026-10-16/ux-admin-request-detail-390.png) |
| admin-revenue | [ux-admin-revenue-1280.png](shots/2026-10-16/ux-admin-revenue-1280.png) | [ux-admin-revenue-390.png](shots/2026-10-16/ux-admin-revenue-390.png) |
| admin-sales | [ux-admin-sales-1280.png](shots/2026-10-16/ux-admin-sales-1280.png) | [ux-admin-sales-390.png](shots/2026-10-16/ux-admin-sales-390.png) |
| admin-tasks | [ux-admin-tasks-1280.png](shots/2026-10-16/ux-admin-tasks-1280.png) | [ux-admin-tasks-390.png](shots/2026-10-16/ux-admin-tasks-390.png) |
| admin-tax-accounts | [ux-admin-tax-accounts-1280.png](shots/2026-10-16/ux-admin-tax-accounts-1280.png) | [ux-admin-tax-accounts-390.png](shots/2026-10-16/ux-admin-tax-accounts-390.png) |
| admin-timesheet-entry | [ux-admin-timesheet-entry-1280.png](shots/2026-10-16/ux-admin-timesheet-entry-1280.png) | [ux-admin-timesheet-entry-390.png](shots/2026-10-16/ux-admin-timesheet-entry-390.png) |
| admin-timesheets | [ux-admin-timesheets-1280.png](shots/2026-10-16/ux-admin-timesheets-1280.png) | [ux-admin-timesheets-390.png](shots/2026-10-16/ux-admin-timesheets-390.png) |
| admin-work-orders | [ux-admin-work-orders-1280.png](shots/2026-10-16/ux-admin-work-orders-1280.png) | [ux-admin-work-orders-390.png](shots/2026-10-16/ux-admin-work-orders-390.png) |
| pm-accounting | [ux-pm-accounting-1280.png](shots/2026-10-16/ux-pm-accounting-1280.png) | [ux-pm-accounting-390.png](shots/2026-10-16/ux-pm-accounting-390.png) |
| pm-approvals | [ux-pm-approvals-1280.png](shots/2026-10-16/ux-pm-approvals-1280.png) | [ux-pm-approvals-390.png](shots/2026-10-16/ux-pm-approvals-390.png) |
| pm-budget | [ux-pm-budget-1280.png](shots/2026-10-16/ux-pm-budget-1280.png) | [ux-pm-budget-390.png](shots/2026-10-16/ux-pm-budget-390.png) |
| pm-dashboard | [ux-pm-dashboard-1280.png](shots/2026-10-16/ux-pm-dashboard-1280.png) | [ux-pm-dashboard-390.png](shots/2026-10-16/ux-pm-dashboard-390.png) |
| pm-expenses | [ux-pm-expenses-1280.png](shots/2026-10-16/ux-pm-expenses-1280.png) | [ux-pm-expenses-390.png](shots/2026-10-16/ux-pm-expenses-390.png) |
| pm-integrations | [ux-pm-integrations-1280.png](shots/2026-10-16/ux-pm-integrations-1280.png) | [ux-pm-integrations-390.png](shots/2026-10-16/ux-pm-integrations-390.png) |
| pm-invoices | [ux-pm-invoices-1280.png](shots/2026-10-16/ux-pm-invoices-1280.png) | [ux-pm-invoices-390.png](shots/2026-10-16/ux-pm-invoices-390.png) |
| pm-overview | [ux-pm-overview-1280.png](shots/2026-10-16/ux-pm-overview-1280.png) | [ux-pm-overview-390.png](shots/2026-10-16/ux-pm-overview-390.png) |
| pm-payments | [ux-pm-payments-1280.png](shots/2026-10-16/ux-pm-payments-1280.png) | [ux-pm-payments-390.png](shots/2026-10-16/ux-pm-payments-390.png) |
| pm-procurement | [ux-pm-procurement-1280.png](shots/2026-10-16/ux-pm-procurement-1280.png) | [ux-pm-procurement-390.png](shots/2026-10-16/ux-pm-procurement-390.png) |
| pm-projects | [ux-pm-projects-1280.png](shots/2026-10-16/ux-pm-projects-1280.png) | [ux-pm-projects-390.png](shots/2026-10-16/ux-pm-projects-390.png) |
| pm-sales | [ux-pm-sales-1280.png](shots/2026-10-16/ux-pm-sales-1280.png) | [ux-pm-sales-390.png](shots/2026-10-16/ux-pm-sales-390.png) |
| pm-timesheets | [ux-pm-timesheets-1280.png](shots/2026-10-16/ux-pm-timesheets-1280.png) | [ux-pm-timesheets-390.png](shots/2026-10-16/ux-pm-timesheets-390.png) |

## Run record and limits

Target slug: `pmo-portal-app-tsx`. No critique ignore file existed at the checked repository-root or app-root location. Assessment independence is degraded as declared. Native critique snapshot/trend persistence is replaced by this explicitly requested audit artifact; no historical score trend is claimed. Context ran once. Detector and overlay counts remain advisory evidence, with false-positive handling above. No reliable owner-visible browser presentation was available; screenshots and snapshots are the fallback.

The requested tracked scope is only PRODUCT.md, this audit and its PNG evidence. Local sessions/configuration and detector intermediates are not committed. Browser sessions, live helper, temporary authentication bootstrap material and app process are cleaned up; the shared DB lock is released. No push. No speculative external issue or public security report is created.

Questions skipped: findings-only commission; decision questions and recommendations are recorded above rather than opening an implementation interview.
