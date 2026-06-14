# Implementation plan — Intent-fix wave (Lens-D remediation)

**Date:** 2026-06-14 · **Branch:** `intent-fix-wave` off `main` · **Planner:** eng-planner
**Spec source:** `docs/reviews/2026-06-14-jtbd-walkthrough.md` §2 (the 9 ranked gaps) + §6 (wave sequence).
**Oracle:** `docs/jtbd.md` (job stories; §3 record verbs — esp. "preview-before-drill-in").
**Charter:** `docs/product-expectations.md` · **Conventions:** `CLAUDE.md` (ADR-0010 test pyramid, ADR-0016 `can()`, ADR-0017 repository seam, ADR-0021 unified `/projects/:id`).

This wave remediates 9 confirmed intent gaps. It is **FE + seed only** — no schema migration (all tables exist at
0030). It introduces **no new write/approval RPC** — the procurement approve/reject reuses the existing
`transition_procurement` path. Reads that don't exist yet are added as thin DAL helpers (no new RLS).

---

## 0. Ground truth established (read before building)

The plan is grounded in these real files/symbols (cited per task):

- **`/approvals` keystone** — `pages/Approvals.tsx` renders two scopes. The **timesheet** scope
  (`pages/timesheets/ApprovalsQueue.tsx`) is the gold-standard: each row has a **disclosure button**
  (`aria-expanded` → `toggleExpanded`) revealing an inline `TimesheetGrid`, with **Approve/Return adjacent**
  (`setPending({kind})` → `ConfirmDialog`). The **procurement** scope
  (`pages/approvals/ProcurementApprovalSection.tsx`) is a `DataTable` whose only affordance is
  `onActivate → navigate('/procurement/:id')`, ending with the literal copy *"Open a request to see its
  full budget impact and approve or reject it."* — the asymmetry.
- **Procurement preview data** — the list row (`ProcurementWithRefs` from `src/lib/db/procurements.ts`) does
  **NOT** carry `items` (line items). The full detail (`ProcurementDetail` with `items`, from
  `src/lib/db/procurementLifecycle.ts`) is fetched per-id by `useProcurementDetail(id)`. Budget impact is
  `pages/procurement/DecisionSupportPanel.tsx` (props `projectId`, `totalValue`, `projectName`).
- **Procurement approve/reject write** — `useProcurementMutations(id).transition.mutate({ to, notes })` with
  `to: 'Approved' | 'Rejected'` (`LEGAL_TRANSITIONS.Requested = ['Approved','Rejected','Cancelled']`). The
  SoD authority is the `transition_procurement` security-definer RPC (P0001/42501). `can('transition','procurement')`
  gates the affordance; `pendingProcurementApprovals(data, selfId)` already applies the SoD-a (`!isRequester`) filter.
- **Exec dashboard** — `pages/ExecutiveDashboard.tsx` desktop branch renders the `BvACard`
  (`src/components/dashboard/BvACard.tsx`) whose rows (`p.id`, `p.name`) are **non-interactive `<div data-row>`**.
  The "Active projects" KPI tile shows `vs={`${data.projects_at_risk} at-risk`}` as plain text.
- **Calendar** — `components/ProjectCalendarView.tsx`: project start/end chips are **already clickable**
  (`ProjectEventChip` button → `onOpen`); **milestone chips are display-only** (`MilestoneEventChip` is a
  `<span>`). The gap is the milestone chip only.
- **Project detail (keystone B)** — `pages/project-detail/ProjectDetail.tsx` order is: header → `MilestoneStrip`
  → `ProjectSCurve` (full-height, `height={240}`) → `PipelineLens` (only `isPipeline`) → `Tabs`. The lifecycle
  branch is `isPipeline = projectStatusGroup(project.status) ∈ {'pipeline','lost'}`. `MilestoneStrip`'s
  overdue predicate is `isOverdueMilestone(milestone)`.
- **Company detail** — `pages/CompanyDetail.tsx` shows only Name + Type + a Contacts list
  (`useContactsByCompany`). No related projects / procurement.
- **My Tasks** — `pages/MyTasks.tsx` groups by project; ordering is server `created_at` asc
  (`useMyTasks` → `listMyTasks`); no overdue flag, no log-time action.
- **Incident** — `incident_reports` has a free-text `location` (`src/lib/db/incidents.ts`) and **NO `project_id`
  FK / project association**. See Open Question OQ-1 — IF-C cannot be a link without a schema change (out of scope).
- **Timesheets prefill** — `pages/Timesheets.tsx` has `addProject(projectId)` and reads no URL param today.
- **CRM seed** — `contacts` + `crm_activities` (migration 0030) are empty in `seed-demo-solar.sql`. Real
  company ids (`cd000000-…-0001` Meridian Client … `-0005` SunVolt Vendor), project ids (`d0000000-…-0001`),
  profile id (`…a2` Diego the PM) are available to attach to.

---

## 1. Wave sequence + collision map (for the Director)

Sequenced Critical-first, then by structural class (dead-display sweep as a class). **File-collision callouts:**

| Group | Tasks | Primary files | Collision risk |
|---|---|---|---|
| **A** Procurement preview-in-place | A1–A4 | NEW `pages/approvals/ProcurementApprovalRow.tsx` + rewrite `ProcurementApprovalSection.tsx` | Isolated. No overlap with B–F. **Build first (keystone).** |
| **B** Record-detail intent | B1–B3 | `pages/project-detail/ProjectDetail.tsx` (B1+B2 both edit it) + NEW `OverduePhaseLever.tsx` | **B1 and B2 both edit `ProjectDetail.tsx` — build them as ONE serial unit (same agent, one PR), never two parallel agents.** B3 edits `MilestoneStrip.tsx` (separate file). |
| **C** Dead-display sweep | C1–C3 | `BvACard.tsx`, `ExecutiveDashboard.tsx`, `ProjectCalendarView.tsx` | C1+C2 both touch the dashboard surface (`BvACard.tsx` vs the KPI tile in `ExecutiveDashboard.tsx`) — different files, safe to parallelize. C3 isolated. **IF-C (incident) is dropped — see OQ-1.** |
| **D** Company related objects | D1–D2 | `CompanyDetail.tsx` + NEW DAL helpers | Isolated. |
| **E** My-Tasks urgency + log-time | E1–E3 | `MyTasks.tsx` + `Timesheets.tsx` | E3 edits `Timesheets.tsx` (separate from E1/E2 in `MyTasks.tsx`). Safe. |
| **F** Seed enrichment | F1 | `supabase/seed-demo-solar.sql` | Isolated, local-only. |

**Cross-group collisions:** none except the **B1/B2 intra-group** one above. A, C, D, E, F touch disjoint files
and may be built in parallel worktrees if desired.

---

## 2. Group A — Procurement preview-in-place in `/approvals` (CRITICAL, anchor a, gap #1)

**Job restored (`jtbd.md` §2 Procurement / §3 verb 6):** an approver previews budget impact + line items
**in the inbox** and approves/rejects **without navigating away** — matching the timesheet paradigm.

**Design decision (ADR — see §6):** the list row lacks `items`; on expand we lazily fetch the full detail via
`useProcurementDetail(id)` (cached, org-scoped, enabled only when expanded). We **reuse** `DecisionSupportPanel`
(budget impact) and render line items from `detail.items`. Approve/Reject reuse
`useProcurementMutations(id).transition`. No new RPC, no new write path.

### Task A1 — Failing test: row exposes inline preview + adjacent approve/reject (no navigation)
- **File (new test):** `pmo-portal/pages/approvals/__tests__/ProcurementApprovalRow.test.tsx`
- **Steps:**
  1. Render a new `<ProcurementApprovalRow>` (built in A2) with a mocked `useProcurementDetail` returning a
     `Requested` PR with `items: [{name:'Inverter', ...}]`, `total_value: 50000`, `project_id`, `project:{name}`.
     Mock `useProcurementMutations` so `transition.mutate` is a spy. Mock `usePermission` → `can('transition','procurement')=true`.
  2. Assert collapsed state: a disclosure control `getByRole('button', { name: /show budget impact/i })` exists,
     `aria-expanded="false"`, and **no Approve button is in the DOM yet**.
  3. Fire click on the disclosure; assert `aria-expanded="true"`, the budget-impact panel
     (`getByText(/budget impact/i)`) and a line-item (`getByText('Inverter')`) render.
  4. Assert **`Approve` and `Reject` buttons are now present adjacent** (in the expanded panel) — and that
     `useNavigate` mock was **never called** (the Lens-D regression invariant: approve without navigation).
- **AC:** `AC-IFW-PROC-01` — *Given a Requested PR the approver may act on, When they expand its row in
  `/approvals`, Then the budget impact + line items render inline and Approve/Reject appear adjacent with no
  route change.*
- **Verify (red):** `cd pmo-portal && npx vitest run pages/approvals/__tests__/ProcurementApprovalRow.test.tsx`
  → fails (component does not exist).

### Task A2 — Build `ProcurementApprovalRow` (expand-in-place, mirrors ApprovalsQueue row)
- **File (new):** `pmo-portal/pages/approvals/ProcurementApprovalRow.tsx`
- **Steps (real code direction — mirror `ApprovalsQueue.tsx` lines 343–436):**
  1. Props: `{ row: ProcurementWithRefs }`. Local `const [expanded, setExpanded] = useState(false)`.
  2. Lazy detail: `const detail = useProcurementDetail(expanded ? row.id : undefined)` (the hook is
     `enabled: Boolean(orgId && id)`, so passing `undefined` while collapsed costs no query).
  3. Mutations: `const { transition } = useProcurementMutations(row.id)`. Staged confirm state
     `const [pending, setPending] = useState<'Approved'|'Rejected'|null>(null)` (mirror the timesheet
     `PendingApproval` pattern — nothing approves on a single click).
  4. Collapsed row: reuse the same `Card`/row markup as the section's DataTable cell content (title, code,
     project, requester, value, age via the existing `daysAgo` helper — lift it to a shared util or copy).
     A leading-edge disclosure `<Button variant="ghost" size="icon" aria-expanded={expanded}
     aria-controls={panelId} aria-label={`Show budget impact for ${row.title}`} onClick={() => setExpanded(v=>!v)}>`
     with the `Icon name="chev"` rotate pattern (copy the className from ApprovalsQueue line 370).
  5. Expanded panel (`id={panelId}`): on `detail.isPending` show `<ListState variant="loading" rows={3} />`;
     on `detail.isError` show `<ListState variant="error" … onRetry={detail.refetch} />`; on data render
     `<DecisionSupportPanel projectId={detail.data.project_id} totalValue={detail.data.total_value}
     projectName={detail.data.project?.name} />` then a line-items list (`detail.data.items.map` → name +
     `formatCurrency(item.total ?? item.unit_price*item.quantity)` per the `procurement_items` shape).
  6. Action footer in the expanded panel (mirror ApprovalsQueue lines 410–434): `<Button variant="primary"
     onClick={() => setPending('Approved')}>Approve</Button>` and `<Button variant="outline"
     onClick={() => setPending('Rejected')}>Reject</Button>`. Gate both with `usePermission()` →
     `may('transition','procurement')` (defence in depth; the section already filters to approver rows).
  7. `ConfirmDialog` (mirror ApprovalsQueue lines 444–463): Approve = `tone="default"` restating the money
     (`Approve ${row.title} — ${formatCurrency(row.total_value)}?`); Reject = `tone="destructive"`. On confirm:
     `transition.mutate({ to: pending }, { onSuccess: () => { setPending(null); toast(...) }, onError: (e) =>
     { setPending(null); const {headline,detail}=classifyMutationError(e); toast(headline,detail,'warning'); } })`.
     `useProcurementMutations` already invalidates the detail key; also invalidate the list so the row leaves
     the inbox (add `queryClient.invalidateQueries({ queryKey: ['procurements'] })` on success, mirroring how
     the page reads `useProcurements`).
- **AC covered:** `AC-IFW-PROC-01`, `AC-IFW-PROC-02` (below).
- **Verify (green):** `cd pmo-portal && npx vitest run pages/approvals/__tests__/ProcurementApprovalRow.test.tsx`.

### Task A3 — Failing test: approve fires `transition({to:'Approved'})`, reject fires `{to:'Rejected'}`, `can()`-gated
- **File:** same test file `ProcurementApprovalRow.test.tsx` (add cases).
- **Steps:**
  1. With `can=true`, expand, click Approve → confirm → assert `transition.mutate` called with
     `{ to: 'Approved' }`. Repeat for Reject → `{ to: 'Rejected' }`.
  2. With `usePermission` mocked so `may('transition','procurement')=false`, render expanded → assert **no
     Approve/Reject buttons** (the `can()` UX gate; RLS remains the authority).
- **AC:** `AC-IFW-PROC-02` — *Given an approver expands a Requested PR, When they confirm Approve (or Reject),
  Then the existing `transition_procurement` path is invoked with `to:'Approved'` (or `'Rejected'`); and a role
  without `can('transition','procurement')` sees no action buttons.*
- **Verify:** `cd pmo-portal && npx vitest run pages/approvals/__tests__/ProcurementApprovalRow.test.tsx`.

### Task A4 — Wire the row into `ProcurementApprovalSection` (replace navigate-only DataTable)
- **File:** `pmo-portal/pages/approvals/ProcurementApprovalSection.tsx` (rewrite the body; keep the
  `pendingProcurementApprovals` selector + loading/empty/error states).
- **Steps:**
  1. Replace the `DataTable` + `onActivate={navigate}` with a list of `<ProcurementApprovalRow row={r} />`,
     one per `rows` (keep the same `Card`/`CardHead` shell + the count `({rows.length})`).
  2. **Delete** the footer copy *"Open a request to see its full budget impact…"* (the asymmetry is gone —
     replace with nothing, or a one-liner "Expand a request to review its budget impact and act").
  3. Remove the now-unused `useNavigate` import. Keep loading/empty/error.
- **AC covered:** `AC-IFW-PROC-01` (section-level wiring; the regression invariant lives in A1's no-navigate
  assertion — keep that as the canonical lock).
- **Verify:** `cd pmo-portal && npx vitest run pages/approvals` (section + row tests) and
  `npm run typecheck`.

> **`can()` + RLS note (A):** Approve/Reject affordances are gated by `may('transition','procurement')`
> (ADR-0016 UX-only). The **`transition_procurement` RPC** is the SoD authority — author≠approver (P0001),
> role check (42501). No FE change touches that enforcement. RLS unchanged.

---

## 3. Group B — Record-detail intent (anchor c, gaps #3 + #5)

> **COLLISION (Director):** B1 and B2 BOTH edit `pages/project-detail/ProjectDetail.tsx`. Build them as a
> single serial unit (one agent, one PR). B3 edits `MilestoneStrip.tsx` and may be separate.

### Task B1 — Failing test: pre-win detail leads with sales levers; delivery planner + S-curve demoted/hidden
- **File (new test):** `pmo-portal/pages/project-detail/__tests__/ProjectDetail.prewin.test.tsx`
- **Steps:**
  1. Render `<ProjectDetail>` (within a router at `/projects/:id`) with `useProjects` mocked so the record is
     **not** in the active cache and `useOpportunity` returns a `status:'Leads'` project (so
     `isPipeline=true`). Mock `useMilestones` to return `[]` (empty planner) and `useSalesPipeline`.
  2. Assert DOM order: the `PipelineLens` "Opportunity journey" / "Next actions" card appears **before** the
     delivery `MilestoneStrip` ("Delivery phases") and **before** the `ProjectSCurve` ("Progress curve").
     Use `getAllByRole('heading')` index comparison or `compareDocumentPosition`.
  3. Assert the **S-curve is NOT rendered** for a pre-win record (`queryByText('Progress curve')` is null).
- **AC:** `AC-IFW-RECORD-01` — *Given a pre-win (pipeline/lost) record, When ProjectDetail renders, Then the
  Opportunity-journey + Next-actions (sales levers) appear above the delivery planner, and the empty S-curve
  is hidden until won.*
- **Verify (red):** `cd pmo-portal && npx vitest run pages/project-detail/__tests__/ProjectDetail.prewin.test.tsx`.

### Task B2 — Build the lifecycle-aware layout in `ProjectDetail.tsx`
- **File:** `pmo-portal/pages/project-detail/ProjectDetail.tsx`
- **Steps (real code direction):**
  1. Compute `isPipeline` (already exists, line 135). Restructure the return so the render order branches:
     - **Pre-win (`isPipeline`):** render `PipelineLens` **first** (the deal levers), then `MilestoneStrip`
       (demoted, below — the planner the PM may still pre-fill), then the `Tabs`. **Do not render
       `ProjectSCurve`** (the actual is empty pre-win — `buildSCurve([])` shows the empty chart; hide it to
       cut noise per the gap fix). Guard: `{!isPipeline && <ProjectSCurve … />}`.
     - **Delivery (`!isPipeline`):** header → `MilestoneStrip` → `Tabs` **moved up directly under the
       stepper**, and `ProjectSCurve` **demoted below the tabs** (or wrapped in a collapsed
       `<details>`/Analytics affordance) so the record tabs surface above the fold (anchor-c residual #5).
       Keep `ProjectSCurve` in the tree (delivery has real data) but no longer between stepper and tabs.
  2. Keep the `MilestoneStrip` always rendered (ADR-0021 — strip renders at every stage). Only the **S-curve
     placement/visibility** and the **tab elevation** change. No data/route change.
- **AC covered:** `AC-IFW-RECORD-01` (pre-win), `AC-IFW-RECORD-02` (delivery — below).
- **Verify:** `cd pmo-portal && npx vitest run pages/project-detail` and `npm run typecheck`.

### Task B2b — Failing test: delivery detail surfaces tabs above the S-curve
- **File:** `pmo-portal/pages/project-detail/__tests__/ProjectDetail.scurve-demote.test.tsx` (new)
- **Steps:** render a **delivery** record (in `useProjects` cache, `status:'Ongoing Project'`), mock
  `useMilestones` with phases. Assert the `Tabs` (`getByRole('tablist')`) precedes the "Progress curve"
  heading in document order (the S-curve is demoted below the tabs).
- **AC:** `AC-IFW-RECORD-02` — *Given a delivery project, When ProjectDetail renders, Then the record tabs
  appear above the S-curve so the actionable surface is above the fold.*
- **Verify:** `cd pmo-portal && npx vitest run pages/project-detail/__tests__/ProjectDetail.scurve-demote.test.tsx`.
  (Write this test before B2's delivery-branch edit — red first.)

### Task B3 — Overdue-phase lever: failing test + build (link overdue phase → its tasks)
- **Files:** test `pmo-portal/pages/project-detail/__tests__/MilestoneStrip.overdueLever.test.tsx` (new);
  impl `pmo-portal/pages/project-detail/MilestoneStrip.tsx` (edit `MilestonePhaseCard`).
- **Steps:**
  1. **Red test:** render `MilestoneStrip` with one phase where `isOverdueMilestone` is true (target_date in the
     past, `effective_pct < 100`, `task_count > 0`). Assert a link/button **"View blocking tasks"** (or
     "Open tasks") exists in that overdue card whose action navigates to the project's Tasks tab
     (`/projects/:projectId/tasks`). Assert it is **absent** for a non-overdue phase.
  2. **Impl:** in `MilestonePhaseCard`, when `isOverdueMilestone(milestone)`, render a small text link
     (One-Blue text link, not a solid button) below the header: `<Link to={`/projects/${projectId}/tasks`}>
     View blocking tasks</Link>` — pass `projectId` down as a new prop to `MilestonePhaseCard` (thread from
     `MilestoneStrip`'s `projectId`). This is the "now-what" lever the gap (#5) asks for. (Tasks tab is the
     blocking-work surface; procurement is reachable from the same record's Procurement tab.)
- **AC:** `AC-IFW-RECORD-03` — *Given an overdue delivery phase, When it renders in the stepper, Then it
  exposes an adjacent "View blocking tasks" link to the project's Tasks tab.*
- **Verify:** `cd pmo-portal && npx vitest run pages/project-detail/__tests__/MilestoneStrip.overdueLever.test.tsx`.

---

## 4. Group C — Dead-display sweep (gaps #2, #4, #9; #8 dropped — OQ-1)

Uniform pattern: a record-naming / exception-signaling element becomes a link.

### Task C1 — Exec "Budget vs Actual" rows become links to `/projects/:id`
- **Files:** test `pmo-portal/src/components/dashboard/__tests__/BvACard.link.test.tsx` (new);
  impl `pmo-portal/src/components/dashboard/BvACard.tsx`.
- **Steps:**
  1. **Red test:** render `<BvACard projects={[{id:'d1', name:'Meridian', spent, contract_value, budget}]}/>`
     within a router. Assert `getByRole('link', { name: /Meridian/i })` (or a button) navigates to
     `/projects/d1`. (Currently the row is a non-interactive `<div data-row>`.)
  2. **Impl:** wrap each row's name (or the whole `data-row`) in a `react-router` `<Link to={`/projects/${p.id}`}>`
     (keep the `data-row` for the existing layout tests; make the **name** the link to preserve the progress
     bar's own `aria-label` without nesting interactives — name-link + bar sibling). Keep DESIGN.md tokens
     (`hover:text-primary`, focus-visible ring as in `Projects.tsx` name buttons).
- **AC:** `AC-IFW-DASH-01` — *Given the exec Budget-vs-Actual card, When the exec clicks a project row's name,
  Then they navigate to that project's `/projects/:id` record.* **(Lens-D regression invariant: the BvA row name
  is a link to `/projects/:id`.)**
- **Verify:** `cd pmo-portal && npx vitest run src/components/dashboard/__tests__/BvACard.link.test.tsx`.

### Task C2 — Exec "N at-risk" subtext links to the at-risk filter
- **Files:** test `pmo-portal/pages/__tests__/ExecutiveDashboard.atRiskLink.test.tsx` (new or extend an
  existing dashboard test); impl `pmo-portal/pages/ExecutiveDashboard.tsx`.
- **Steps:**
  1. **Red test:** render the executive view (mock `useDashboard` with `projects_at_risk: 2`). Assert a link
     "2 at-risk" → `/projects?filter=at-risk` exists. (Today the `vs` text is plain.)
  2. **Impl:** the "Active projects" `KPITile` (line 230) already drills to `/projects?filter=Ongoing`. The
     **whole tile is one link** (a11y: no nested interactive — the code comment at line 228 says so). Resolve
     by making the **at-risk count a separate small `<Link>` rendered below/next to the tile band** (not nested
     inside the tile link), e.g. a one-line `<Link to="/projects?filter=at-risk">{n} at-risk →</Link>` in the
     KPI section, OR (simpler, no a11y conflict) point the Active-projects tile's secondary affordance at
     at-risk. **Decision:** add a discrete link element in the KPI band — do not nest it inside the tile.
     Filter value is `at-risk` (matches `Projects.tsx` `VALID_URL_FILTERS`), not `At%20risk`.
- **AC:** `AC-IFW-DASH-02` — *Given the exec dashboard shows N at-risk projects, When the exec clicks the
  at-risk indicator, Then they land on `/projects?filter=at-risk` (the at-risk list).* **(Regression invariant:
  an at-risk link to `/projects?filter=at-risk` exists when N>0.)**
- **Verify:** `cd pmo-portal && npx vitest run pages/__tests__/ExecutiveDashboard.atRiskLink.test.tsx`.

> **Note on the gap-report URL:** the report wrote `/projects?filter=At%20risk`; the real `Projects.tsx`
> accepts `?filter=at-risk` (lowercase token in `FILTERS`). Use `at-risk` — verified against the source.

### Task C3 — Calendar milestone chips become clickable (open their project)
- **Files:** test `pmo-portal/components/__tests__/ProjectCalendarView.milestoneLink.test.tsx` (new);
  impl `pmo-portal/components/ProjectCalendarView.tsx`.
- **Steps:**
  1. **Red test:** render `<ProjectCalendarView projects={[…]} milestoneDates={[{projectId:'d1',
     name:'KoM', targetDate}]} onOpenProject={spy} initialCursor={…matching month}/>`. Assert the milestone
     chip is a **button** (`getByRole('button', { name: /KoM/ })`) and clicking it calls `onOpenProject('d1')`.
     (Today `MilestoneEventChip` is a `<span>` — not clickable.)
  2. **Impl:** change `MilestoneEventChip` to a `<button type="button" onClick={() => onOpen(event.projectId)}>`
     (mirror `ProjectEventChip` exactly — same classes + focus ring) and thread `onOpen` into it via the
     `EventChip` switch (pass `onOpen` to the milestone branch). Keep the `chipClass('milestone')` styling.
- **AC:** `AC-IFW-CAL-01` — *Given a milestone entry in the project calendar, When the user clicks it, Then
  the calendar opens that milestone's project (`onOpenProject(projectId)`).* **(Regression invariant: every
  calendar chip — project AND milestone — is an interactive control that opens its project.)**
- **Verify:** `cd pmo-portal && npx vitest run components/__tests__/ProjectCalendarView.milestoneLink.test.tsx`.

> **IF-C (incident location) — DROPPED this wave.** `incident_reports.location` is free text with **no
> `project_id` FK / project association** in the schema (verified `src/lib/db/incidents.ts` + the incident
> type). Linking it to `/projects/:id` would require a schema migration (out of scope per the brief). See OQ-1.

---

## 5. Group D — Company-detail related objects (gap #6)

**Job restored:** a vendor/client record shows related **projects** (+ **procurement** for vendors) so the user
can "act in context". Both are clickable lists.

### Task D1 — DAL helpers: projects-by-client + procurement-by-vendor (no new RLS)
- **Files:** test `pmo-portal/src/lib/db/companies.related.test.ts` (new) + impl in
  `pmo-portal/src/lib/db/projects.ts` (add `listProjectsByClient(clientId)`) and
  `pmo-portal/src/lib/db/procurements.ts` (add `listProcurementsByVendor(vendorId)`), exposed via the existing
  hooks file `pmo-portal/src/hooks/useCompanies.ts` (add `useProjectsByClient` / `useProcurementsByVendor`).
- **Steps:**
  1. **Red test:** assert `listProjectsByClient` issues `.from('projects').select(SELECT).eq('client_id', id)`
     (no `org_id` sent — RLS scopes); `listProcurementsByVendor` → `.from('procurements').select(SELECT)
     .eq('vendor_id', id)`. Mock the supabase client (mirror the existing `projects.test.ts` / `procurements.test.ts`
     mocking style).
  2. **Impl:** thin reads mirroring `listProjects` / `listProcurements` with an added `.eq()`. **`org_id` is
     NEVER sent** — RLS (`projects_select`, `procurements` select) scopes by org. New hooks key on
     `['projects','by-client', orgId, clientId]` / `['procurements','by-vendor', orgId, vendorId]`, `enabled`
     on `orgId && id`.
- **Repository-method flag (Director):** these are **new DAL reads** (no existing by-client/by-vendor query).
  They are simple equality filters on owned columns — **no new RLS, no migration**. They live in `src/lib/db/*`
  consistent with the existing company/project DAL (the repository seam in `src/lib/repositories/*` is for the
  CRM entities; projects/procurement still expose `src/lib/db/*` reads — follow the established pattern).
- **AC covered:** supports `AC-IFW-COMPANY-01` (D2 owns the behavior assertion).
- **Verify:** `cd pmo-portal && npx vitest run src/lib/db/companies.related.test.ts && npm run typecheck`.

### Task D2 — Render related projects + (vendor) procurement on CompanyDetail
- **Files:** test `pmo-portal/pages/CompanyDetail.related.test.tsx` (new); impl
  `pmo-portal/pages/CompanyDetail.tsx`.
- **Steps:**
  1. **Red test:** render `<CompanyDetail>` for a `Client` company with `useProjectsByClient` mocked → one
     project. Assert a "Related projects" card lists it and the row is a link to `/projects/:id`. For a
     `Vendor` company with `useProcurementsByVendor` mocked → assert a "Procurement" card lists it linking to
     `/procurement/:id`. Assert the procurement card is **absent for a Client** (vendor-only).
  2. **Impl:** add two `Card`s after the existing Contacts card (reuse the `CompanyContactsList` list pattern —
     `<ul>` of link buttons). "Related projects" always shows (via `useProjectsByClient(company.id)`);
     "Procurement" renders only when `company.type === 'Vendor'` (via `useProcurementsByVendor(company.id)`).
     Each row → `navigate('/projects/:id')` / `navigate('/procurement/:id')`. Handle loading/empty
     ("No related projects yet" / "No procurement yet") like `CompanyContactsList`.
- **AC:** `AC-IFW-COMPANY-01` — *Given a company record, When CompanyDetail renders, Then related projects are
  listed as links to `/projects/:id`, and for a Vendor, related procurement is listed as links to
  `/procurement/:id`.* **(Regression invariant: CompanyDetail renders a related-projects list with project
  links.)**
- **Verify:** `cd pmo-portal && npx vitest run pages/CompanyDetail.related.test.tsx`.

---

## 6. Group E — My-Tasks urgency ordering + log-time (gap #7)

### Task E1 — Failing test: urgency ordering + overdue flag
- **File:** `pmo-portal/pages/__tests__/MyTasks.urgency.test.tsx` (new).
- **Steps:** render `<MyTasks>` with `useMyTasks` mocked: one overdue task (`end_date` past, status `To Do`),
  one future task, one `Done`. Assert (a) within a project group, the **overdue task sorts first** and carries
  an **"Overdue" flag** (a `StatusPill variant="warn"` or text badge), and (b) a `Done` task does not sort
  above an open one. (Today rows are server `created_at` order with no flag.)
- **AC:** `AC-IFW-TASKS-01` — *Given my assigned tasks, When My Tasks renders, Then tasks are ordered by due
  urgency (overdue first), overdue tasks carry a flag, and Done tasks sink below open ones.*
- **Verify (red):** `cd pmo-portal && npx vitest run pages/__tests__/MyTasks.urgency.test.tsx`.

### Task E2 — Build urgency ordering + overdue flag in MyTasks
- **File:** `pmo-portal/pages/MyTasks.tsx`
- **Steps:**
  1. Add a pure sort comparator (within the `grouped` build or per-group): order key = `(status==='Done' ? 2 :
     isOverdue ? 0 : 1)` then by `end_date` asc (nulls last). `isOverdue = task.end_date && task.end_date <
     todayIso() && task.status !== 'Done'`. Keep JS sort stable.
  2. Render a `StatusPill variant="warn"` "Overdue" (text+shape, not color-only — matches the at-risk pill
     convention) next to the task name when `isOverdue`.
- **AC covered:** `AC-IFW-TASKS-01`.
- **Verify:** `cd pmo-portal && npx vitest run pages/__tests__/MyTasks.urgency.test.tsx`.

### Task E3 — "Log time" action prefilling the task's project (MyTasks → Timesheets `?project=`)
- **Files:** tests `pmo-portal/pages/__tests__/MyTasks.logtime.test.tsx` (new) +
  `pmo-portal/pages/__tests__/Timesheets.prefill.test.tsx` (new); impl `pmo-portal/pages/MyTasks.tsx` +
  `pmo-portal/pages/Timesheets.tsx`.
- **Steps:**
  1. **Red (MyTasks):** assert each task row has a "Log time" link → `/timesheets?project=${task.project_id}`.
  2. **Red (Timesheets):** render `<TimesheetsPage>` at `/timesheets?project=d1` with `useProjects` mocked to
     include project `d1` (status `Ongoing Project`). Assert project `d1` is auto-added as a timesheet row
     (the grid shows its name) without manual picker use.
  3. **Impl (MyTasks):** add a `<Link to={`/timesheets?project=${task.project_id}`}>Log time</Link>` (text
     link) in each task row's action cluster (next to the status select).
  4. **Impl (Timesheets):** read `const [params] = useSearchParams()` (already imports react-router); in a
     `useEffect` (guarded to run once per param + only when `allProjects` is loaded and the project is a valid
     `Ongoing Project` not already present), call `addProject(params.get('project'))`. Reuse the **existing**
     `addProject` — no new write. Clear the param after consuming (optional) to avoid re-add on week change.
- **AC:** `AC-IFW-TASKS-02` — *Given a task in My Tasks, When the user clicks "Log time", Then Timesheets opens
  with that task's project pre-added as a row.* **(Regression invariant: a My-Tasks row exposes a Log-time link
  carrying `?project=<id>`; Timesheets consumes it to pre-add the row.)**
- **Verify:** `cd pmo-portal && npx vitest run pages/__tests__/MyTasks.logtime.test.tsx pages/__tests__/Timesheets.prefill.test.tsx`.

---

## 7. Group F — Seed enrichment (CRM contacts + activity, LOCAL-ONLY)

### Task F1 — Add contacts + crm_activities seed rows
- **File:** `supabase/seed-demo-solar.sql` (append a new section after the existing inserts; local seed only —
  **never prod**, per CLAUDE.md).
- **Steps (real SQL direction — column shapes verified against migration 0030):**
  1. `insert into contacts (id, company_id, full_name, title, email, phone) values …` — attach ~2 contacts to
     a **Client** (`cd000000-…-0001` Meridian Steelworks) and ~2 to a **Vendor** (`cd000000-…-0005` SunVolt
     Modules Co.) so both gap-#6 surfaces and `/contacts` are demonstrable. `org_id` defaults (column default
     `…0001`); `created_at` defaults. Use fixed `ct000000-…` ids for idempotency + `on conflict (id) do nothing`.
  2. `insert into crm_activities (id, contact_id, company_id, kind, subject, body, occurred_at, logged_by_id)
     values …` — 2–3 activities per contact (`kind ∈ {'Call','Email','Meeting','Note'}`), `logged_by_id =
     '00000000-…-a2'` (Diego, the PM), `occurred_at` = recent timestamps, `company_id` matching the parent.
     `org_id` defaults. `on conflict (id) do nothing`.
- **AC:** `AC-IFW-SEED-01` — *Given a fresh local DB reset, When the demo seed runs, Then Meridian (Client) and
  SunVolt (Vendor) each have contacts, and those contacts have activity history.* **(Owned by an integration/
  smoke check, not a Vitest unit — see traceability.)**
- **Verify:** `supabase db reset` (from repo root) succeeds, then
  `psql "$LOCAL_DB_URL" -c "select count(*) from contacts; select count(*) from crm_activities;"` returns >0;
  app: `/companies/cd000000-0000-0000-0000-000000000005` shows contacts. (No prod push — local only.)

---

## 8. Traceability table (AC → owning layer → file)

Each AC owned at the **lowest sufficient layer** (ADR-0010). All behavior ACs are **Unit (Vitest/RTL)** —
they are component render/interaction proofs; none requires a cross-stack e2e. Seed is a DB smoke check.

| AC | Behavior | Owning layer | Owning test file | Impl file(s) |
|---|---|---|---|---|
| `AC-IFW-PROC-01` | Inline preview + adjacent approve, no navigation | Unit (RTL) | `pages/approvals/__tests__/ProcurementApprovalRow.test.tsx` | `pages/approvals/ProcurementApprovalRow.tsx`, `…/ProcurementApprovalSection.tsx` |
| `AC-IFW-PROC-02` | Approve→`{to:'Approved'}` / Reject→`{to:'Rejected'}`; `can()`-gated | Unit (RTL) | same file | `pages/approvals/ProcurementApprovalRow.tsx` |
| `AC-IFW-RECORD-01` | Pre-win leads with sales levers; S-curve hidden | Unit (RTL) | `pages/project-detail/__tests__/ProjectDetail.prewin.test.tsx` | `pages/project-detail/ProjectDetail.tsx` |
| `AC-IFW-RECORD-02` | Delivery tabs above S-curve | Unit (RTL) | `…/__tests__/ProjectDetail.scurve-demote.test.tsx` | `pages/project-detail/ProjectDetail.tsx` |
| `AC-IFW-RECORD-03` | Overdue phase → "View blocking tasks" link | Unit (RTL) | `…/__tests__/MilestoneStrip.overdueLever.test.tsx` | `pages/project-detail/MilestoneStrip.tsx` |
| `AC-IFW-DASH-01` | BvA row name links to `/projects/:id` | Unit (RTL) | `src/components/dashboard/__tests__/BvACard.link.test.tsx` | `src/components/dashboard/BvACard.tsx` |
| `AC-IFW-DASH-02` | At-risk indicator → `/projects?filter=at-risk` | Unit (RTL) | `pages/__tests__/ExecutiveDashboard.atRiskLink.test.tsx` | `pages/ExecutiveDashboard.tsx` |
| `AC-IFW-CAL-01` | Milestone chip opens its project | Unit (RTL) | `components/__tests__/ProjectCalendarView.milestoneLink.test.tsx` | `components/ProjectCalendarView.tsx` |
| `AC-IFW-COMPANY-01` | Related projects (+vendor procurement) as links | Unit (RTL) | `pages/CompanyDetail.related.test.tsx` | `pages/CompanyDetail.tsx`, `src/lib/db/projects.ts`, `…/procurements.ts`, `src/hooks/useCompanies.ts` |
| `AC-IFW-TASKS-01` | Urgency ordering + overdue flag | Unit (RTL) | `pages/__tests__/MyTasks.urgency.test.tsx` | `pages/MyTasks.tsx` |
| `AC-IFW-TASKS-02` | Log-time prefills task's project | Unit (RTL) | `pages/__tests__/MyTasks.logtime.test.tsx` + `…/Timesheets.prefill.test.tsx` | `pages/MyTasks.tsx`, `pages/Timesheets.tsx` |
| `AC-IFW-SEED-01` | Demo seed has contacts + activity | DB smoke | `supabase db reset` + psql count (no Vitest) | `supabase/seed-demo-solar.sql` |

**Lens-D regression invariants** (design-workflow §3a — each locks an intent fix so it can't silently
regress): `AC-IFW-PROC-01` (approve-without-navigation), `AC-IFW-DASH-01` (BvA row is a link),
`AC-IFW-DASH-02` (at-risk link), `AC-IFW-CAL-01` (every calendar chip is interactive), `AC-IFW-COMPANY-01`
(related-objects list), `AC-IFW-TASKS-02` (log-time carries `?project=`). These are the canonical
non-regression assertions.

---

## 9. Quality gates (per CLAUDE.md)

- Full suite green: `cd pmo-portal && npm test`.
- `cd pmo-portal && npm run typecheck` (zero errors) + `npm run lint` (zero warnings).
- ≥80% line coverage on changed code; tests assert behavior (the regression invariants above), not numbers.
- `can()` UX gate + RLS authority unchanged for A (no new RPC). No new RLS / migration anywhere.
- One PR for the wave (or per-group PRs if parallelized) on `intent-fix-wave`.

---

## 10. Open questions for the Director

- **OQ-1 (IF-C, gap #8 — incident location link): BLOCKED, dropped from this wave.** `incident_reports` has only
  a free-text `location` column and **no `project_id` FK / project association** (verified). The gap-report
  fix-direction was conditional ("*if a project association exists*") — it does not. Making it a link needs a
  schema migration (add `incident_reports.project_id` + backfill + RLS), which is **out of scope** for this
  FE+seed wave. **Recommendation:** file as a separate small schema issue (Minor severity), or close as
  won't-fix. Confirm.
- **OQ-2 (C2 at-risk link placement):** the "Active projects" KPI tile is a single whole-tile link (a11y: no
  nested interactive). I plan a **discrete** at-risk link in the KPI band rather than nesting it in the tile.
  Confirm that's acceptable vs. relocating the tile's drill target.
- **OQ-3 (B2 S-curve demotion form):** the plan demotes the delivery S-curve **below the tabs** (keeps it in
  the tree, data is real). If you prefer it moved to a dedicated **Analytics** affordance/tab instead, that's a
  slightly larger change — flag if so; otherwise I proceed with below-the-tabs.

INTENT-FIX-PLAN-DONE
