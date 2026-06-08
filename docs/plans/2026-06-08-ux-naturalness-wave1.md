# Plan — UX-naturalness fix program, Wave 1 (systemic flow-collapse + trust)

Date: 2026-06-08
Audit basis: `review/ixd-master.md` §4 Wave 1 (findings 1,2,3,4,5,8,9,11,12,13,19,39,43,49 → SP-1/2/4/5/7)
+ `review/ia-navigation.md` F1/F2/F3 (the Model B blocker class).
ADR: `docs/adr/0020-canonical-project-opportunity-lifecycle.md` (Model B, owner-approved).
Workflow: `docs/design-workflow.md` §3a (e2e encodes the NATURAL journey, asserts convention-invariants +
post-states), `CLAUDE.md` "BDD authoring rule" (binding), ADR-0010 (test-pyramid, one owning layer per AC).

## Scope & posture

Wave 1 fixes the interaction-design patterns that recur everywhere (write-policy, primary-action
co-location, procurement state legibility) and the surfaces that mislead decision-makers (dashboard
honesty, no-op CTAs, dead nav). It is **FE-only** (routing + components + one list-query scope + dashboard
labels) — **no schema, no data migration, no RPC contract change**. The win/transition state machines
(`transition_project`, `transition_procurement`) and every RLS/SoD policy are **byte-preserved**.

**This is a PLAN.** No app source is edited here. The build runs BDD-first: author the failing
e2e/component/unit tests (the §AC table below), then implement to green, then the 3-lens design review.

## Areas & tasks (ordered; each task is 2–5 min, names exact files + approach + the finding(s) it fixes)

### Area 1 — Model B: one canonical project/opportunity (IA F1/F2/F3 + IxD SP-2/SP-4 sales noun)

1. **Export a `<PipelineLens>` from `OpportunityDetail.tsx`** — extract the success-render body (the two
   Cards: "Opportunity journey" stepper + "Next actions" with Advance/Mark won/Mark lost, the inline SoD
   won-capture panel, and the two `ConfirmDialog`s) into `pages/project-detail/PipelineLens.tsx` as
   `<PipelineLens project={...} />`. It keeps reading the live status from the project row + the
   `useSalesPipeline` cache (for win_probability/weighted) and calls `transitionProject` unchanged. (F1)
2. **Stage-switch in `ProjectDetail.tsx`** — after the header, branch on
   `projectStatusGroup(project.status)`: `pipeline | lost` → render `<PipelineLens project={project} />`
   and **do not render** the `<Tabs>`/tabpanel block; `onHand | internal` → render the existing Tabs +
   tabpanels. Header (`ProjectDetailHeader`) renders in both. (F1)
3. **Hide the delivery tabs pre-win** — the tab block is simply not mounted in the `pipeline | lost`
   branch from task 2 (no empty-tab tease). Confirm `ProjectDetailHeader` does not render the
   contract-value SoD editor for `pipeline | lost` status (a deal has no contract yet) — gate that block
   on `projectStatusGroup === 'onHand' || 'internal'` inside `ProjectDetailHeader.tsx`. (F1, IxD #26)
4. **Redirect `/sales/:opportunityId` → `/projects/:opportunityId`** — in `App.tsx`, replace the
   `<Route path="/sales/:opportunityId" element={<OpportunityDetail />} />` with an element that renders
   `<Navigate to={`/projects/${opportunityId}`} replace />` (read the param via a tiny inline wrapper or
   `useParams`). Remove the `OpportunityDetail` lazy import as a route target. `/sales` (the pipeline
   index) is untouched. (F1/F3)
5. **Scope `listProjects` to on-hand ∪ internal** — in `src/lib/db/projects.ts`, default the list to
   `status in [...ON_HAND_STATUSES, ...INTERNAL_STATUSES]` (import the arrays from `projectTransitions.ts`;
   use PostgREST `.in('status', [...])`). Keep the optional `params.status` override for callers that
   want a specific status (e.g. a future "lost" filter). (F2)
6. **Drop the "Leads" SegFilter tab from `Projects.tsx`** — remove `'Leads'` from `FILTERS` and the
   `LEADS` branch in `filtered`; the surviving filters are All / My Projects / Ongoing / Completed.
   Update the page sub-copy ("Track every project and lead from pipeline through delivery") to drop the
   "lead" framing (leads live in the Pipeline now). (F2)
7. **Breadcrumb ancestry by stage** — in `src/components/shell/routeMatch.ts`, when resolving a
   `/projects/:id` detail crumb, choose the module label by the record's status group: pass the resolved
   record's status (already available via the cached lists in `App.tsx`) and emit
   `Sales Pipeline > <name>` for `pipeline | lost`, `Projects > <name>` for `onHand | internal`. Wire the
   status through `recordLabelForPath`/`breadcrumbForPath` (the cached `projects` + `pipeline.projects`
   lists carry status). (F3)
8. **⌘K: index a pipeline record once, drill to the canonical route** — in `useRecordSearch.ts`, repoint
   the `sales:` rows' `run()` from `navigate('/sales/'+id)` to `navigate('/projects/'+id)`. After the
   task-5 scope change the `projects` cache no longer holds pre-win rows, so the projects loop and the
   pipeline loop no longer both emit the same record; keep the pipeline loop as the sole pre-win source
   (sales icon, `sub: 'Sales Pipeline'`). (F2 ⌘K de-dupe)

### Area 2 — App-wide write policy (IxD SP-1, findings 5/19/43/49)

**The rule (define once, apply everywhere):** a write gets a `ConfirmDialog` **iff** it is destructive,
irreversible, or moves money — concretely the set **{Approve, Reject, Cancel, Mark-as-Paid, delete/
archive, contract-value edit}**. Every other **routine, reversible forward transition** is **single-click
+ a quiet success toast** (no modal). Financial confirms that are kept **must restate the amount +
consequence in the body** (the contract-value SoD confirm is the template).

9. **Procurement: drop the confirm on routine forward steps** — in `pages/ProcurementDetails.tsx`,
   `stageTransition` currently stages a `ConfirmDialog` for **every** transition. Change it so the routine
   forward steps **commit directly** (call `commitConfirm`'s transition path inline) + toast: `Submit
   Request` (Draft→Requested), `Request Vendor Quotes` (Approved→Vendor Quoted), `Generate Purchase
   Order`, `Select Quote`→ (covered in Area 5), `Confirm Receipt` (Ordered→Received), `Mark Vendor
   Invoiced` (Received→Vendor Invoiced). Keep the `ConfirmDialog` ONLY for `Approved` (Approve),
   `Rejected` (Reject), `Cancelled` (Cancel request), and `Paid` (Mark as Paid). (#5, #49)
10. **Procurement: Approve/Mark-Paid confirms restate the amount** — for the kept `Approve` and `Mark as
    Paid` confirms, set the `ConfirmDialog` description to include the PR value + project + requester
    (e.g. "Approve PR-… for **$85,000** on *Project X*, requested by *Alice*?"). Read `p.total_value`,
    `p.project?.name`, `p.requested_by?.full_name`. (#19)
11. **Toast cap: one visible, auto-dismiss 3–5s** — confirm the `ToastProvider`/`useToast` caps to one
    visible toast and auto-dismisses (3–5s); if it currently queues/stacks, cap to one and drop the queue.
    (Verify in `src/components/ui/Toast.tsx`.) (#43)
12. **Sales (now `<PipelineLens>`): keep Advance single-click? No — Advance stays a confirm? Reconcile to
    the rule.** Under the Area-2 rule, a routine forward `Advance to <stage>` is **reversible and routine →
    single-click + toast** (drop the current `confirmAction === 'advance'` modal in `PipelineLens.tsx`).
    `Mark lost` (terminal/destructive) keeps its destructive `ConfirmDialog`; `Mark won` keeps its inline
    SoD capture panel (it captures contract ref + date — that IS the consequential confirm). (#5 applied to
    sales; aligns sales to procurement to Tasks.)

> Tasks status-change (single-click, no confirm) and Approvals approve (single action) are already
> correct (the in-app gold standard the audit cites) — **do not touch them**; this area brings procurement
> and sales into line with them.

### Area 3 — Timesheet Save + Submit (IxD SP-2 + SP-3, findings 8/9/10/36)

13. **Co-locate Save + Submit in the grid footer** — in `pages/Timesheets.tsx`, move the Submit affordance
    out of the page `head` (currently a header `Button` ~340px from Save) into the editable grid footer
    bar (the `{editable && (<div className="flex justify-end gap-2 …">` block). Footer becomes: secondary
    **Save** (`variant="outline"`/secondary) + primary **Submit timesheet** (`variant="primary"`),
    co-located, one action zone. Remove the `view === 'grid' && actions.submit && <Button>` from `head`.
    (#8)
14. **Render Submit from first paint, disabled until a draft exists** — Submit is shown in the footer in
    the editable render even when `currentTimesheet == null` (no draft yet) or no hours are saved: render
    it `disabled` with helper text/tooltip "Save your hours first" until `currentTimesheet?.status ===
    'Draft'` with at least one persisted entry (i.e. `actions.submit` true). It must not be hidden. (#9)
15. **Save fires a quiet toast, no view change** — confirm `commitSave`'s success path only toasts
    ("Timesheet saved · N changes saved") and does not navigate or switch view (it already does — assert
    it). Suppress the "0 changes saved" no-op toast: when `changeCount === 0`, toast "Nothing to save — no
    changes" (info) or suppress entirely. (#15 / #32 folds in)
16. **Drop the redundant rollup panels from the entry screen** — remove the `{gridRows.length > 0 && (...)}`
    two-up block ("By project this week" `HoursBar` + "Recent entries this week" `EntryList`) from
    `Timesheets.tsx`. The grid's own TOTAL column + DAILY-TOTAL row + header weekly total already carry
    every number; the rollups live on the dashboard only (Engineer dashboard already has them). (#10/#36/SP-3)

### Area 4 — Lying surfaces (IxD SP-7 + SP-9, findings 1/2/3/4/39)

17. **Fix the "On-hand margin" KPI label↔value contradiction** — in `pages/ExecutiveDashboard.tsx` the
    `kpi-on-hand-margin` tile labels `formatCurrency(data.on_hand_value)` (a **revenue** figure, can
    exceed total contract value) as "On-hand margin". Rename the tile label to **"Revenue on hand"** and
    keep the `vs="X% realized"` sub (which already shows the true margin %). The number now matches its
    label. (#1)
18. **De-duplicate "Projected margin"** — the `kpi-pipeline-projected-margin` tile dual-toggles between
    `onHandPct` (on-hand realized %) and `weightedPct` (pipeline projected %) under one label "Projected
    margin" — two different metrics, one name. Drop the on-hand option from the dual toggle and rename the
    tile to **"Pipeline forecast margin"** showing `weightedPct` only (the on-hand % already lives on the
    "Revenue on hand" tile's `vs`). One metric name = one number. (#2)
19. **Board pack → disabled "coming soon"** *(owner: keep-as-disabled)* — the `Board pack` outline button
    in `DashPageHead` fires `toast('Generating board pack…')` and does nothing. **Make it a visibly
    `disabled` "coming soon" affordance** (remove the onClick/toast; mirror the document file-upload
    placeholder pattern) so the capability is discoverable but never fakes success. A real export lands
    with the Reports module, separately scoped. (#3)
20. **Reports nav → demote/hide until built** — `/reports` is a Rail item (#2 slot for exec/finance) that
    renders an empty `PlaceholderPage`. Hide the `/reports` Rail item until the module ships (remove it
    from `Rail.tsx`'s `ALL_ITEMS`); keep the `<Route>` so a stray deep link still resolves to the honest
    "arrives later" placeholder. (#4) (Cross-ref IA F8.)
21. **Mark-won form shows the value being booked** — in `<PipelineLens>` (the extracted won-capture
    panel), add a line "Booking **$<contract_value>** to contract value on win" above the contract-ref/date
    inputs, so the user confirms against the money. Read the opportunity's `contract_value`. (#39)

### Area 5 — Procurement state legibility (IxD SP-4 + SP-5, findings 11/12/13)

22. **One canonical label per state across button/badge/toast/stepper** — audit the procurement label
    surfaces (`components/procurement.ts` `stageLabelForStatus`/`PR_STAGES`, the action labels in
    `allowedActions`, the toast strings in `commitConfirm`, the badge `stageLabelForStatus`). Pick ONE
    user-facing noun per state and use it identically: the button verb names the state the badge will then
    show; the toast names that same state. Define the canonical label map in `components/procurement.ts`
    and reference it from the page (no inline literals that drift). (#13)
23. **Stepper advances on Approve (add an "Approved" node)** — today Approve leaves the stepper on step 1
    (`Draft/Requested/Approved` all map to stage 0 in `STATUS_TO_STAGE`), so an Approve is invisible. Add
    an explicit position for `Approved` in the lifecycle stepper model (`components/procurement.ts`
    `lifecycleSteps` / `STATUS_TO_STAGE`) so the visible state moves when the user approves. (#11)
24. **Stop "Select Quote" pre-jumping the badge to "Purchase Order"** — `Quote Selected` currently maps to
    stage 2 (Purchase Order) in `STATUS_TO_STAGE`, so selecting a quote jumps the badge/stepper to PO
    before any PO exists. Fold `Quote Selected` into the Vendor-Quote node (stage 1) so the badge reads the
    vendor-quote stage until a PO is actually generated (Ordered → stage 2). (#11)
25. **Bind the "Selected quote" summary to the chosen quotation** — the `Selected quote` StatTile shows
    `selectedQuote ? formatCurrency(...) : 'Pending'` and a `${p.quotations.length} received` sub; verify
    that once a quote is selected the tile shows the **selected vendor + amount** (not "Pending — 0
    received" through Paid) and mark the selected quotation row "Selected" in `QuotationsSection`. (#12)
26. **Remove the persistent GR/VI "Create" buttons at terminal Paid** — `canShowGRForm`/`canShowVIForm`
    are true for `Paid`, so "Create Goods Receipt"/"Create Vendor Invoice" full-width primaries persist
    under "No further actions" at the terminal Paid state. Gate the GR form to `Ordered | Received` only
    and the VI form to `Vendor Invoiced` only (drop `Paid` from both), and demote a created GR/VI to a
    quiet read-only summary in the stage card once its stage has passed. (#14 carry-in / SP-3)

**Task count by area:** Area 1 = 8 · Area 2 = 4 · Area 3 = 4 · Area 4 = 5 · Area 5 = 5. **Total = 26 tasks.**

---

## BDD acceptance criteria + traceability (the heart — author RED first, then implement to green)

Authored to the **natural journey**, asserting **convention-invariants + expected post-states**
(design-workflow §3a). Each AC names its **owning test layer** (ADR-0010: lowest sufficient layer) and is
**AC-id-tagged** in the owning test's title (Vitest `it(...)`, pgTAP leading token, Playwright
`test(...)` title + file `e2e/<AC-id>-<slug>.spec.ts`). The two owner-authored journeys are written
**verbatim** as `AC-IXD-PROJ-001` and `AC-IXD-TS-001`.

### Area 1 — Model B canonical record

| AC-id | Given / When / Then (natural journey · convention-invariant · post-state) | Owning layer | File / location |
|---|---|---|---|
| **AC-IXD-PROJ-001** | **Given** a PM has created a project, **when** they open it from EITHER the Projects list OR the Sales Pipeline, **then** both resolve to ONE detail page at the SAME URL (`/projects/:id`), showing the **stage-appropriate lens** (pipeline lens while pre-win, delivery lens once won). *Invariant:* one entity → one canonical URL. | **e2e** | `e2e/AC-IXD-PROJ-001-canonical-record.spec.ts` |
| **AC-IXD-PROJ-001a** (corollary) | **Given** a newly created `Leads` deal, **when** the PM views the active Projects list and the Sales Pipeline, **then** the deal appears in the **Pipeline** and is **absent** from the active Projects list (disjoint stage partitions). | **e2e** | same file |
| AC-IXD-PROJ-002 | **Given** the route `/sales/:opportunityId`, **when** it is visited, **then** the app redirects (replace) to `/projects/:opportunityId` (no `OpportunityDetail` route renders). | **e2e** | `e2e/AC-IXD-PROJ-001-canonical-record.spec.ts` |
| AC-IXD-PROJ-003 | **Given** `listProjects()` is called, **then** it returns only rows whose status ∈ on-hand ∪ internal (a `Tender Submitted` row is excluded; an `Ongoing Project` row is included). *Data-scope invariant.* | **unit** | `src/lib/db/__tests__/projects.listScope.test.ts` (mocked supabase, asserts the `.in('status',[...])` filter) |
| AC-IXD-PROJ-004 | **Given** a pre-win (`pipeline`) project detail page, **then** the delivery tabs (Budget/Procurement/Tasks/Documents) and the contract-value SoD editor are NOT rendered; the pipeline lens (deal stepper + Advance/Mark won/Mark lost) IS rendered. **And** for an on-hand project the tabs + SoD editor ARE rendered and the pipeline lens is not. | **component** | `pages/project-detail/__tests__/ProjectDetail.lens.test.tsx` (RTL, both status groups) |
| AC-IXD-PROJ-005 | **Given** a `pipeline`-status record's detail page, **then** the breadcrumb reads `Sales Pipeline > <name>`; **and** for an `onHand` record it reads `Projects > <name>`. *Wayfinding-by-stage invariant.* | **unit** | `src/components/shell/__tests__/routeMatch.stage.test.ts` (`breadcrumbForPath` with status) |
| AC-IXD-PROJ-006 | **Given** a pipeline-status record, **when** ⌘K is searched for its name, **then** exactly ONE record row appears and its `run()` navigates to `/projects/:id` (not a second `/sales/:id` row). *⌘K de-dupe invariant.* | **unit** | `src/hooks/__tests__/useRecordSearch.dedupe.test.ts` |

### Area 2 — App-wide write policy

| AC-id | Given / When / Then | Owning layer | File / location |
|---|---|---|---|
| **AC-IXD-WP-001** | **Given** a procurement at a routine forward step (e.g. an Approved PR a sourcing user can move to Vendor Quoted), **when** the user clicks **Request Vendor Quotes**, **then** NO confirm dialog appears, the state advances on the single click, and a quiet success toast confirms it. *Routine reversible writes are single-click.* | **e2e** | `e2e/AC-IXD-WP-001-routine-write-no-confirm.spec.ts` |
| AC-IXD-WP-002 | **Given** a Requested PR a non-requester approver views, **when** they click **Approve**, **then** a `ConfirmDialog` appears whose body restates the **amount + project + requester**; **and** clicking **Mark as Paid** on a Vendor-Invoiced PR also confirms with the amount. *Consequential/financial writes still confirm, against the money.* | **e2e** | `e2e/AC-IXD-WP-002-consequential-write-confirms.spec.ts` |
| AC-IXD-WP-003 | **Given** a PR a user may cancel, **when** they click **Cancel request**, **then** a destructive `ConfirmDialog` (Cancel request / Keep request) appears before the write. | **component** | `pages/__tests__/ProcurementDetails.writePolicy.test.tsx` (RTL — asserts dialog opens for {Approve, Reject, Cancel, Mark-Paid}, NOT for the routine forward steps) |
| AC-IXD-WP-004 | **Given** an open deal in the pipeline lens, **when** the user clicks **Advance to <stage>**, **then** no confirm appears, the stage advances on the single click + toast; **and** clicking **Mark lost** still opens the destructive confirm. *Sales aligned to the same rule.* | **component** | `pages/project-detail/__tests__/PipelineLens.writePolicy.test.tsx` |
| AC-IXD-WP-005 | **Given** rapid successive transitions, **then** at most one toast is visible at a time and it auto-dismisses within 3–5s (no pile-up). | **component** | `src/components/ui/__tests__/Toast.cap.test.tsx` |

### Area 3 — Timesheet Save + Submit

| AC-id | Given / When / Then | Owning layer | File / location |
|---|---|---|---|
| **AC-IXD-TS-001** | **Given** the timesheet entry screen, **then** the engineer sees **Save AND Submit together from first paint** (Submit visible, disabled with "Save your hours first" until a draft with hours exists); **when** she enters hours and clicks **Save**, the hours **persist with a quiet confirmation and no forced summary view** (she stays on the editable grid); **when** she clicks **Submit**, the week becomes **read-only Submitted**. *Co-located primaries + explicit post-states.* | **e2e** | `e2e/AC-IXD-TS-001-save-submit-colocated.spec.ts` |
| AC-IXD-TS-002 | **Given** the editable grid footer, **then** Save and Submit render in the same footer action zone (not Submit-in-header + Save-in-footer); Submit is `primary`, Save is secondary. *No split-region primaries.* | **component** | `pages/__tests__/Timesheets.footer.test.tsx` (RTL — both controls in the footer container; header has no Submit) |
| AC-IXD-TS-003 | **Given** no changes since last save, **when** Save is clicked, **then** the toast does NOT say "0 changes saved" (it says "Nothing to save — no changes" or is suppressed). | **unit** | `src/lib/__tests__/timesheet-edit.noop.test.ts` (changeCount-0 message branch) — or component if message lives in the page |
| AC-IXD-TS-004 | **Given** the timesheet entry screen, **then** the "By project this week" and "Recent entries this week" rollup panels are NOT rendered below the grid (the grid totals are the single source of truth). | **component** | `pages/__tests__/Timesheets.footer.test.tsx` |

### Area 4 — Lying surfaces (dashboard honesty + dead nav)

| AC-id | Given / When / Then | Owning layer | File / location |
|---|---|---|---|
| **AC-IXD-DASH-001** | **Given** the executive dashboard, **then** the revenue-on-hand KPI is labeled to its value: the tile showing `on_hand_value` reads **"Revenue on hand"** (NOT "margin"), so no tile prints a "margin $" larger than total contract value. *A metric label is a promise about the number.* | **component** | `pages/__tests__/ExecutiveDashboard.honesty.test.tsx` (RTL — tile label text) |
| AC-IXD-DASH-002 | **Given** the dashboard, **then** exactly ONE tile is named for the projected/forecast margin (the pipeline one, "Pipeline forecast margin"); there are not two tiles both named "Projected margin" showing different numbers. *One metric name = one number.* | **component** | same file (asserts no duplicate "Projected margin" label) |
| AC-IXD-DASH-003 | **Given** the dashboard, **when** the user looks at the "Board pack" control, **then** it is a visibly **disabled** "coming soon" affordance that fires **no** action or toast (no fake "Generating…" success). *A CTA either does the thing or is clearly disabled — it never fakes success.* | **e2e** | `e2e/AC-IXD-DASH-003-no-noop-cta.spec.ts` |
| AC-IXD-PROJ-007 | **Given** a `Loss Tender` (lost) deal, **then** it appears in the **Pipeline** (a terminal "Lost" kanban column + a "Lost" table filter, both reachable — no clipping) and is **absent** from the active Projects list. *Lost deals are sales history, not delivery work.* | **e2e** | `e2e/AC-IXD-PROJ-007-lost-in-pipeline.spec.ts` |
| AC-IXD-DASH-004 | **Given** a role that sees the nav rail, **then** an unbuilt module is not a top-slot nav item leading to an empty stub: "Reports" is absent from the Rail (demoted/hidden until built). *Don't promote unbuilt features to prime nav.* | **component** | `src/components/shell/__tests__/Rail.reports.test.tsx` (Reports not in rail items) |
| AC-IXD-DASH-005 | **Given** the mark-won capture panel, **then** it shows the value being booked ("Booking $X to contract value on win") before the user confirms. *Confirm against the money.* | **component** | `pages/project-detail/__tests__/PipelineLens.markwon.test.tsx` |

### Area 5 — Procurement state legibility

| AC-id | Given / When / Then | Owning layer | File / location |
|---|---|---|---|
| **AC-IXD-PROC-001** | **Given** a procurement transition (e.g. Submit Request), **then** the button verb, the resulting badge, and the success toast all name the **same canonical state** (one noun per state across button/badge/toast/stepper); the badge does not show a different name than the user transitioned to. | **unit** | `components/__tests__/procurement.labels.test.ts` (the canonical label map: button→state→badge→toast agree) |
| **AC-IXD-PROC-002** | **Given** a Requested PR, **when** a non-requester approver Approves it, **then** the lifecycle stepper/badge **advances to an "Approved" position** (the approval is visible), instead of staying on step 1. *Visible state = reality, moves on action.* | **component** | `pages/__tests__/ProcurementDetails.stepper.test.tsx` (stepper index for Approved > index for Requested) |
| AC-IXD-PROC-003 | **Given** a Vendor-Quoted PR, **when** a user Selects a quote, **then** the badge/stepper does NOT jump to "Purchase Order" (it stays at the vendor-quote stage); the badge only reads Purchase Order once a PO is actually generated (Ordered). *No pre-jump.* | **unit** | `components/__tests__/procurement.stages.test.ts` (`stageIndexForStatus('Quote Selected')` === vendor-quote stage, not PO) |
| AC-IXD-PROC-004 | **Given** a PR with a selected quote, **then** the "Selected quote" summary shows the selected vendor + amount (not "Pending"/"0 received") and the chosen quotation row is marked "Selected" through to Paid. | **component** | `pages/__tests__/ProcurementDetails.selectedQuote.test.tsx` |
| AC-IXD-PROC-005 | **Given** a terminal **Paid** PR under "No further actions", **then** there are no persistent "Create Goods Receipt"/"Create Vendor Invoice" primary buttons (their stages have passed); any created GR/VI shows as a quiet read-only summary. *Controls disappear once their stage passes.* | **component** | `pages/__tests__/ProcurementDetails.terminal.test.tsx` |

### Traceability summary

| Area | ACs | Owning layers |
|---|---|---|
| 1 — Model B canonical record | PROJ-001, 001a, 002, 003, 004, 005, 006 (7) | e2e ×3, component ×1, unit ×3 |
| 2 — write policy | WP-001, 002, 003, 004, 005 (5) | e2e ×2, component ×3 |
| 3 — timesheet Save+Submit | TS-001, 002, 003, 004 (4) | e2e ×1, component ×2, unit ×1 |
| 4 — lying surfaces | DASH-001, 002, 003, 004, 005 (5) | e2e ×1, component ×3, unit-via-component |
| 5 — procurement legibility | PROC-001, 002, 003, 004, 005 (5) | unit ×2, component ×3 |
| **Total** | **26 ACs** | **e2e ×7, component ×12, unit ×7** |

> Pyramid note (ADR-0010): the structural/flow invariants that need a real cross-stack journey (one-URL
> resolution, redirect, routine-write-no-confirm, save→submit post-states, no-op-CTA) own at **e2e** (7
> curated — within the ~6–8 budget; some share a file). Render/disclosure invariants (lens-by-stage,
> footer co-location, dashboard labels, stepper position, terminal controls) own at **component** (RTL).
> Pure data-logic (list scope, stage-index math, label-map agreement, no-op message, ⌘K dedupe) own at
> **unit**. No RLS/SoD contract changes in this wave → **no new pgTAP** (the win/transition RPC pgTAP is
> untouched and must stay green).

## Out of scope (later waves — recorded so it isn't silently dropped)

- **Wave 2 (IA / role-shaping + noise):** My-Tasks IC home (#6), "+ New opportunity" on the Sales header
  (#7), Needs-approval queue + SoD-handoff-up-front (#17/#18), exec dashboard collapse to ≤4 cards (#22),
  sales stat-strip + column scroll (#23), hide Approvals for non-approvers (#24), default Projects to "My
  Projects" for ICs (#35), Companies/Documents visible row verbs (#27/#28), empty-$0-PR integrity (#16),
  tabs-as-URL (IA F5), Companies/Incidents → first-class MODULES (IA F6), Administration label (IA F7),
  Approvals dual-home (IA F4).
- **Wave 3 (polish):** timesheet note demotion (#31), incident date default + Type select (#33/#34),
  task/company detail drawers (#40/#41), ⋯ popover clipping (#42), SoD note during edit (#47), seed a
  Vendor-Invoiced PR (#48), task-dependencies decision (#30).
- **Deferred end-state:** Model A (separate `opportunities` table + Convert-at-Won) — ADR-0020.

## Dispatch note (for the Director)

BDD-first: author the 26 failing tests above (e2e/component/unit) → `ui-implementer` implements Areas 1–5
to green strictly to `DESIGN.md` tokens → the 3-lens design review (visual + IxD + IA) re-runs on the
running app → owner UX sign-off → merge. The 3-lens review must re-confirm F1/F2/F3 are closed and SP-1/
SP-2/SP-4/SP-5/SP-7 no longer reproduce.
