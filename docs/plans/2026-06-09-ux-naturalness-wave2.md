# UX-Naturalness Wave 2 — RBAC view-gating + IxD Wave 2 (naturalness + IA cleanup)

**Date:** 2026-06-09 · **Branch base:** `feat/ux-naturalness-wave1` (Wave-1 + Model B / ADR-0020 on it)
**Plan owner:** design-architect (Frontend + Existing-repo lenses) · **Build agent:** ui-implementer
**Source backlog:** `review/OUTSTANDING.md` Theme A (RBAC view-gates), Theme D (IxD Wave 2), Theme E (IA F4–F8), plus the cheap couplers G2/H6/D14.
**Authorities:** `docs/design/rbac-visibility.md` (role×affordance MAP — WHO sees what), `docs/decisions.md` (OD-UX-1/2/3, OD-PROC-1, OD-TS), ADR-0016 (`can()` is UX-only; **RLS/RPC is the enforcement authority**), ADR-0010 (one AC → lowest sufficient layer), `docs/design-workflow.md` §3a (e2e/component encodes the user's NATURAL journey + the gating-invariant; the app conforms to the test).

> **Scope discipline.** This plan covers Part A (RBAC view-gates) + Part B (IxD Wave 2 + IA F4–F8). It does **not** cover Theme B (lifecycle rework dead-ends), Theme C (mobile responsiveness), Theme F (workflow silent-failures beyond the dead-affordance cleanup), or the polish tails (G/H/I/J) — those are later waves per the OUTSTANDING ordering. A handful of zero-cost couplers that live in files this wave already opens are folded in and flagged as such.

> **Binding gating-invariant rule (every Part-A task).** The FE gate is **clarity, never security**. Each task: (1) reads the intended state from `rbac-visibility.md`; (2) gates the affordance with `can()` / `usePermission` / `<CanWrite>` on the **REAL JWT role** (`useEffectiveRole().realRole`, already what `usePermission` binds — never `effectiveRole`); (3) renders a **clean read-only surface** when denied (static values / absent affordance), never a greyed wall of dead buttons (rbac-visibility reading-rule 5). The owning test asserts both halves: the authorized role **sees+can act**, AND the denied role **does not see the reject-bound control** — that two-sided assertion is the regression invariant.

---

## Owner decisions needed (resolve BEFORE building the flagged tasks)

Five surfaces where `rbac-visibility.md` is silent, ambiguous, or its existing copy conflicts with policy. The Director must resolve these with the owner first; each carries a one-line recommendation. Tasks that depend on a decision are tagged `[BLOCKED-ON: OD-W2-#]`.

| # | Surface / conflict | Why the map doesn't settle it | Recommendation |
|---|---|---|---|
| **OD-W2-1** | **Engineer reaching `/procurement` index** — show own-requests-only, or hard-block the page? | rbac-visibility §A note `*` + §E say Engineer "has no Procurement nav but can raise a request" and "if `/procurement` is opened it shows only their own requests (RLS-scoped) — empty-nav-state copy if none." That's a **own-scoped page**, but it's never been built; the page currently shows the full org index to anyone who types the URL. The map describes the intent but not whether the create CTA + a scoped list is worth building now vs. a simple redirect. | **Build the own-scoped variant** (matches the written map): `/procurement` for an Engineer renders only their own PRs + keeps the "Raise request" CTA + an explanatory empty state. It's cheap (RLS already scopes; just gate the org-wide affordances) and it's what §E already specifies. Confirm. |
| **OD-W2-2** | **Engineer-as-line-manager timesheet approvals** — `policy.ts` `approval.transition = DELIVERY` (Admin·Exec·PM) **denies Engineer**, but OD-TS-1 + the FR-TS-008 RLS read-widening explicitly support an **Engineer who is a line manager** approving their reports. The SQL/RLS allows it; the FE policy forbids it. | Direct policy-vs-SQL conflict (OUTSTANDING A11.a / A5). The ApprovalsQueue gate (Task A2) needs to know: is an Engineer-manager a legitimate approver in the FE, or is approval PM+ only? | **Gate the queue on "is this sheet's approver-set", not on a static role** — i.e. show Approve/Return only when the server would accept it. Cleanest: widen `approval.transition` to include Engineer (the RLS already permits manager-Engineers) and keep the SoD `!self` predicate as the real gate. The awaiting-approval DAL already only returns sheets the caller may see. Confirm — this is the one place to ratify the manager-Engineer path end-to-end. |
| **OD-W2-3** | **Finance contract-value pre-win editability** (rbac-visibility §M.5, OUTSTANDING A11.c) — pre-win, may Finance set/estimate `contract_value`, or only on the won-SoD boundary? | The map flags this as an open question (§M.5). The `editContractValue` predicate currently gives pre-win edit to `DELIVERY` (Admin·Exec·PM — Finance excluded pre-win, included on-won). | **Keep current behavior** (pre-win = Admin·Exec·PM; Finance gains the value only at the won boundary) — the cleanest segregation, already coded. This wave does **not** touch contract-value gating; flagged only so the reviewer reads it as intentional. **No build task** — decision is "ratify as-is." |
| **OD-W2-4** | **Executive on a top-level Tasks nav** (rbac-visibility §M.1) — the matrix lists Task create/edit as Admin·Exec·PM, but there is **no `/tasks` nav at all** (removed; Tasks live in the project tab). | Not a Wave-2 blocker for any listed task, but the role-shaped-nav task (B6, "My Tasks") touches nav composition, so the Exec-Tasks question is adjacent. | **Confirm §M.1 proposal (b):** Exec edits tasks via the project Tasks tab only; no top-level Tasks nav. "My Tasks" (B6) is an **Engineer/IC** landing, distinct from a manager Tasks console — so this decision does not block B6. Recommend ratify-as-is. |
| **OD-W2-5** | **Dead `/reports` route + the bell/Export affordances** (IA F8, F9, OD-UX-3) — hide the `/reports` route entirely, or keep an honest "arrives later" stub? And: delete the no-op notification bell + Sales Export, or make them honest-disabled? | OD-UX-3 set the precedent (Board-pack = visibly-disabled "coming soon", no fake success). The route/affordance disposition isn't individually locked. | **Apply the OD-UX-3 precedent uniformly:** keep `/reports` as the honest placeholder stub (deep-link still resolves), but ensure its breadcrumb/title is correct (covered in E-tasks); **remove** the no-op bell and Sales "Export" (they are not "coming soon" affordances with a known destination — they're dead) OR make Export a disabled "coming soon" if Reports will own it. Recommend: **remove the bell, demote Sales Export to a disabled "Export (with Reports)" tooltip.** Confirm the remove-vs-disable call per affordance. |

---

# PART A — RBAC view-gating (BLOCKER-class)

Eight tasks. Each gates a reject-bound or leaked affordance on the real role per `rbac-visibility.md`. RLS stays the authority; these fix FE trust/correctness (leaked modules, dead-end UIs, author-blind edit).

### A-1 — Gate `PipelineLens` write affordances on the real role *(OUTSTANDING A7 · HIGH)*
**File:** `pmo-portal/pages/project-detail/PipelineLens.tsx`
**Intended state (rbac-visibility §B2 row "Lifecycle control (win/lose/hold)"):** Admin·Exec·PM = ●; Finance·Engineer = ○ (read-only). The mirror is already in `ProjectDetailHeader.tsx` (`const may = usePermission(); const canEdit = may('edit','project')`).
**Approach:**
- Import `usePermission`; compute `const canTransition = may('transition', 'project')` (policy `project.transition = Admin·Exec·PM·Finance`). **Note:** the policy's `transition` set includes Finance, but the **map** (§B2) makes pipeline lifecycle Admin·Exec·PM only. Use the narrower **delivery** gate here to match the map: gate the Advance / Mark-won / Mark-lost block on `may('edit','project')` (Admin·Exec·PM — the same predicate the header's `canEdit` uses for lifecycle-adjacent edits), NOT `transition`. (Resolve any residual ambiguity under the existing OD — this is delivery lifecycle, PM-led, Finance read-only on the pipeline per §C.)
- Wrap the entire `{!isTerminal && (<div className="flex flex-wrap gap-2">…)}` action cluster + the inline won panel + the Mark-lost `ConfirmDialog` so they render **only when `canTransition`**.
- When denied: the lens still renders the stats, the journey stepper, and a read-only `GateNotice variant="ready"`/neutral note ("Pipeline managed by the deal owner") in place of the action card body — a clean read-only surface, not disabled buttons.
**States:** loading (unchanged — lens reads cached pipeline), denied-read-only (new), authorized (unchanged).
**a11y:** the read-only note is plain text (no focusable dead control); no change to focus order for authorized users.
**DESIGN.md tokens:** reuse `GateNotice`, `Card/CardHead/CardPad`, `Button` variants — no new visual decisions.
**BDD acceptance (natural journey + gating-invariant):**
- `AC-W2-RBAC-001` *(component, RTL — owning layer)* — "When an **Engineer** opens a pipeline deal at `/projects/:id`, the deal detail shows the stage and journey but offers **no** Advance / Mark-won / Mark-lost control." Render `PipelineLens` with `realRole='Engineer'`; assert the three lifecycle buttons are **absent** and the read-only note is present.
- `AC-W2-RBAC-002` *(component, RTL)* — "When a **PM** opens the same deal, Advance / Mark-won / Mark-lost are present and actionable." Assert the buttons render for `realRole='Project Manager'`.

### A-2 — Gate `ApprovalsQueue` Approve/Return on the actual approver *(OUTSTANDING A5 · BLOCKER)* `[BLOCKED-ON: OD-W2-2]`
**File:** `pmo-portal/pages/timesheets/ApprovalsQueue.tsx` (line 133 — `timesheetActions(sheet.status, false, true)` hard-codes `isApprover=true`).
**Intended state (rbac-visibility §I):** Approve others' timesheets = Admin·Exec·PM (●◆) and (per OD-W2-2) manager-Engineer; Finance = ○. SoD: never self (the queue already excludes own sheets).
**Approach:**
- Replace the hard-coded `true` with a real role gate: `const may = usePermission(); const isApprover = may('transition', 'approval');` then `timesheetActions(sheet.status as TimesheetStatus, false, isApprover)`.
- **Depends on OD-W2-2:** if the owner ratifies the manager-Engineer path, widen `approval.transition` in `policy.ts` to include `Engineer` (the awaiting-approval DAL + RLS already only surface sheets the caller manages, and `timesheetActions` keeps `!isOwner`). The `policy.ts` edit is a **Part-A foundation change** (ui-implementer may touch `src/auth/policy.ts` since it is FE policy, not app business logic — but flag it for the spec-reviewer as a deliberate matrix change).
- When `isApprover` is false (Finance, or a non-manager who can still *read* the queue): the SoD `GateNotice` stays, the rows render **read-only** (status pill + hours, no Approve/Return buttons), and the empty-state copy already explains "from your reports."
**States:** loading/error/empty unchanged; denied-but-can-read (new — Finance lands here via the Timesheets toggle even though Finance has no Timesheets nav, and via direct `/approvals` URL).
**DESIGN.md tokens:** `ApprovalRow`, `StatusPill`, `GateNotice`, `Button` — unchanged.
**BDD acceptance:**
- `AC-W2-RBAC-003` *(component, RTL — owning layer)* — "When **Finance** opens the approvals queue, each submitted row shows the owner + hours + status but **no** Approve or Return button." Assert buttons absent for `realRole='Finance'`.
- `AC-W2-RBAC-004` *(component, RTL)* — "When a **PM** (line manager) opens the queue, each report's submitted week shows Approve + Return." Assert present for `realRole='Project Manager'`.
- `AC-W2-RBAC-005` *(component, RTL — only if OD-W2-2 ratifies manager-Engineer)* — "When an **Engineer who is a line manager** opens the queue, Approve + Return are offered." Gate on the widened policy.

### A-3 — Engineer leak: gate the `/procurement` index page *(OUTSTANDING A1 · BLOCKER)* `[BLOCKED-ON: OD-W2-1]`
**Files:** `pmo-portal/pages/Procurement.tsx`, `pmo-portal/src/hooks/useRecordSearch.ts`.
**Intended state (rbac-visibility §A`*`/§E):** Engineer has no Procurement nav but **can raise a request** and, if they reach `/procurement`, sees **only their own** requests (RLS-scoped) with an explanatory empty state. The create CTA stays (Engineer may raise).
**Approach (per OD-W2-1 recommendation = own-scoped variant):**
- Add `const may = usePermission()` (already imported) — compute `const canViewAll = may('view','procurement')`-style or, simpler, read the real role: when `realRole === 'Engineer'`, the page header copy + empty-state copy shift to "your requests" and the list is already RLS-scoped to own rows server-side (no client filter needed; the DAL returns only what RLS permits). Keep `canCreate = may('create','procurement')` (already true for Engineer).
- **⌘K leak (`useRecordSearch.ts`):** the Records index pushes every procurement row from `procurements.data`. For an Engineer that cache is already RLS-scoped to own PRs, so ⌘K only surfaces their own — **verify** this (RLS on `procurements_select`); if the cache is org-wide for any role that shouldn't browse, the fix is to not index procurement rows for roles without `view`-procurement. Add a guard: only index a module's records when the real role may view that module's index. (This also fixes the Sales leak — A-4.)
**States:** Engineer own-scoped (header/empty copy), non-Engineer org index (unchanged).
**DESIGN.md tokens:** `ListState` empty variant, `Button` Raise-request — unchanged.
**BDD acceptance:**
- `AC-W2-RBAC-006` *(component, RTL — owning layer)* — "When an **Engineer** opens `/procurement`, the page reads as *their* requests (not the org index) and still offers **Raise request**." Assert own-scoped copy + Raise-request present.
- `AC-W2-RBAC-007` *(unit, Vitest)* — "`useRecordSearch` does not index procurement records for a role without procurement-view." Assert the Records array excludes procurement rows when the gating predicate is false (or assert the RLS-scoped cache contains only own rows — whichever the implementation chooses; the invariant is *no cross-scope leak via ⌘K*).

### A-4 — Engineer leak: gate `/sales` + `/sales/:id` and its ⌘K rows *(OUTSTANDING A2 · HIGH)*
**Files:** `pmo-portal/pages/SalesPipeline.tsx`, `pmo-portal/src/hooks/useRecordSearch.ts`, `pmo-portal/App.tsx`.
**Intended state (rbac-visibility §C):** Sales Pipeline = Admin·Exec·PM·Finance view; **Engineer = ○ (no nav, no page).** The rail already hides it; the **route does not**.
**Approach:**
- Add a page-level view gate to `SalesPipeline.tsx`: compute the real role; when `realRole === 'Engineer'`, render a clean **"You don't have access to the Sales Pipeline"** GateNotice/empty-state with a Back-to-Dashboard action (not a blank page, not the org pipeline). A small `useEffectiveRole().realRole` check + early return is sufficient; no new primitive.
- **⌘K (`useRecordSearch.ts`):** the pipeline loop pushes `pipeline.data?.projects` rows as Records. For an Engineer these should not be indexed. Reuse the A-3 view-gate guard (only index a module's records when the real role may view it) so Engineer ⌘K never surfaces pipeline opportunities.
- The Model B redirect `/sales/:id → /projects/:id` (App.tsx) is fine — the gate that matters is on `PipelineLens` (A-1), which an Engineer reaching `/projects/:id` already gets read-only. So `/sales/:id` needs no separate gate beyond the index gate.
**States:** Engineer-denied (new), all other roles unchanged.
**a11y:** the denied state is a titled region with a focusable Back action (keyboard-reachable), WCAG-AA contrast via existing tokens.
**DESIGN.md tokens:** `ListState`/`GateNotice`, `Button` — unchanged.
**BDD acceptance:**
- `AC-W2-RBAC-008` *(component, RTL — owning layer)* — "When an **Engineer** navigates to `/sales`, they see an access-denied surface with a way back, not the pipeline board." Assert the board is absent and the denied region + Back action render for `realRole='Engineer'`.
- `AC-W2-RBAC-009` *(unit, Vitest)* — "`useRecordSearch` excludes pipeline opportunity rows for an Engineer." Asserts no `sub:'Sales Pipeline'` rows for the Engineer gating context.

### A-5 — Engineer leak: gate `/companies` write + page per the map *(OUTSTANDING A3 · HIGH)*
**File:** `pmo-portal/pages/Companies.tsx`, `pmo-portal/src/hooks/useRecordSearch.ts` (companies aren't ⌘K-indexed today — verify).
**Intended state (rbac-visibility §D):** Companies view = Admin·Exec·PM·Finance; **Engineer = ○ (no nav, no page).** Create/edit = Admin·Exec·PM·Finance; archive = Admin·Exec; delete = Admin.
**Approach:**
- The write affordances are **already gated** (`canCreate/canEdit/canArchive/canDelete` via `may(...,'company')`, and `Engineer` is in none of those sets) — so an Engineer reaching `/companies` already sees a **clean read-only directory** (no New, no row menu). That is *almost* the map, except the map says Engineer should have **no page at all** (○).
- Add a page-level view gate mirroring A-4: when `realRole === 'Engineer'`, render the access-denied surface instead of the directory. (Engineer has no business reason to browse the company master-data directory per §D.)
- Confirm Companies is not ⌘K-indexed (it isn't in `useRecordSearch` today) — no ⌘K change needed.
**States:** Engineer-denied (new), all-other read/write unchanged.
**DESIGN.md tokens:** reuse the A-4 denied surface — same component, consistent copy.
**BDD acceptance:**
- `AC-W2-RBAC-010` *(component, RTL — owning layer)* — "When an **Engineer** navigates to `/companies`, they see an access-denied surface, not the company directory." Assert directory absent + denied region present for `realRole='Engineer'`.
- (Write-gating for the other roles is already covered by existing Companies tests — no new AC; this task only adds the Engineer page gate.)

### A-6 — Finance leak: gate the `/timesheets` editable grid *(OUTSTANDING A4 · BLOCKER)*
**File:** `pmo-portal/pages/Timesheets.tsx` (line 139 — `editable` derives from ownership+status only, never role).
**Intended state (rbac-visibility §I + policy `timesheet.create/edit` = Admin·Exec·PM·Engineer — Finance excluded):** Finance has **no Timesheets nav** and must not get a savable grid. RLS currently lets an own-Draft insert through, so Finance can actually persist hours — a real wrong-permission write path.
**Approach:**
- Gate `editable` on the real role too: `const may = usePermission(); const canEnter = may('create','timesheet');` then `const editable = canEnter && (currentTimesheet == null || (own && Draft))`. Finance → `canEnter` false → the grid renders **read-only** (no Save/Submit footer, no Add-project, no editable cells).
- Better still per the map (Finance has no Workforce surface at all): add a **page-level view gate** — when `realRole === 'Finance'`, render the access-denied surface (mirror A-4/A-5), since Finance reaching `/timesheets` by URL has no legitimate task there. (The Approvals queue toggle is also Workforce; Finance is ○ for Approvals per §I, so the whole `/timesheets` page is denied for Finance.)
- Keep the existing owner/Draft editability for the legitimate roles unchanged.
**States:** Finance-denied page (new), legitimate-role editable grid (unchanged), read-only submitted/approved (unchanged).
**DESIGN.md tokens:** the A-4 denied surface; no grid token changes.
**BDD acceptance:**
- `AC-W2-RBAC-011` *(component, RTL — owning layer)* — "When **Finance** opens `/timesheets`, they cannot enter or save hours." Assert the editable grid + Save/Submit footer are absent (denied surface or read-only) for `realRole='Finance'`.
- `AC-W2-RBAC-012` *(component, RTL)* — "When an **Engineer** opens their Draft week, the grid is editable with Save + Submit." Regression guard that the gate doesn't over-block the legitimate role.
- *(Defense-in-depth note for the Director: the real fix is also server-side — an RLS/policy tightening so Finance cannot insert own-Draft entries. That is a **pgTAP-owned** AC in a security follow-up, NOT this FE wave. Flag to security-auditor: `AC-W2-RBAC-011-RLS` — "Finance cannot insert timesheet_entries" — owned at the **integration/pgTAP** layer, tracked separately.)*

### A-7 — Documents "Edit" must check author *(OUTSTANDING A6 · BLOCKER)*
**File:** `pmo-portal/pages/project-detail/tabs/DocumentsTab.tsx` (lines 220–225 — `rowMenu` shows Edit to anyone with `canEdit` for any non-Closed doc; never checks `author_id === currentUser`).
**Intended state (rbac-visibility §H):** **Edit = ◆ author** (Admin·Exec·PM·Finance *who authored it*); Approve/transition = ●◆ approver ≠ author (already enforced via `isOwnDocument`). Delete = Admin.
**Approach:**
- The component already has `isOwnDocument(d)` and `currentUserId`. Gate the Edit menu item on authorship: in `rowMenu`, push **Edit** only when `canEdit && d.status !== 'Closed' && (isOwnDocument(d) || isAdminBreakGlass)`.
  - **Author rule:** non-Admin write-roles edit **only their own** documents. Admin = break-glass (may edit any) per reading-rule 4 (Admin = break-glass except SoD; edit is not an SoD axis). Compute `const isAdmin = realRole === 'Admin'` (or add an explicit `can('edit','document',{record:{author_id}})` predicate — see below).
- **Cleaner (recommended): push the authorship check into `policy.ts`** so the gate is declarative and testable: extend `document.edit` to a record-scoped predicate `edit: (role, ctx) => has(MASTER_DATA, role) && (role === 'Admin' || ctx.record?.author_id === ctx.currentUserId)`. Then the call-site is `may('edit','document',{ currentUserId, record: { author_id: d.author_id } })`. This mirrors the existing `taskStatus` record-scoped predicate and keeps the matrix as the single source of truth.
- When denied (not author, not Admin): the Edit item is **absent** (the row may still show Approve/Reject if the viewer is a non-author approver — that path is already gated). A non-author with no actions sees a clean row (no menu, or only the actions they may take).
**States:** author (Edit shown), non-author manager (Edit hidden, Approve/Reject may show per SoD), Admin (Edit shown — break-glass), Engineer (no document write at all — unchanged).
**DESIGN.md tokens:** `RowMenuItem`, `GateNotice` (reuse the existing SoD gate pattern if a "why can't I edit" reason is wanted — optional).
**BDD acceptance:**
- `AC-W2-RBAC-013` *(unit, Vitest — owning layer for the predicate)* — "`can('edit','document')` is true only for the author (or Admin)." Table-test the predicate: author→true, non-author PM→false, Admin non-author→true, Engineer→false.
- `AC-W2-RBAC-014` *(component, RTL)* — "When a **PM who did not author** a Draft document opens its row menu, there is **no Edit** action." Assert Edit absent for a non-author; present for the author.

### A-8 — Foundation: the shared access-denied surface + the ⌘K view-gate guard *(supports A-3/A-4/A-5/A-6)*
**Files:** `pmo-portal/src/components/ui/` (a small `AccessDenied`/`PageGate` presentational component, or reuse `ListState variant="empty"` with a Back action), `pmo-portal/src/hooks/useRecordSearch.ts`.
**Approach:**
- Extract the repeated "you don't have access to this page" surface used by A-4/A-5/A-6 into one component so the copy + tokens are consistent (title, sub, Back-to-Dashboard action). Use existing `ListState`/`GateNotice` tokens — **no new visual decision**, just a named wrapper to avoid three divergent copies.
- In `useRecordSearch.ts`, introduce a per-module view predicate (reads the real role) so the Records index only includes a module's rows when the real role may view that module — fixing A-3 + A-4 ⌘K leaks in one place. The hook gains a role/permission input (thread `usePermission` or the real role through from `ShellChrome`).
**States:** n/a (foundation).
**DESIGN.md tokens:** `ListState`, `GateNotice`, `Button`, page heading scale — all existing.
**BDD acceptance:**
- `AC-W2-RBAC-015` *(unit, Vitest — owning layer)* — "`useRecordSearch` indexes a module's records only when the viewer may view that module." One table-test covering procurement (Engineer→excluded) + sales (Engineer→excluded) + projects (all→included). This is the single canonical ⌘K-leak proof; A-3/A-4's ⌘K ACs reference it.

---

# PART B — IxD Wave 2 (naturalness + IA F4–F8 cleanup)

Eleven tasks. Role-shaped landings, discoverable workflow verbs, dead-affordance honesty, and the F4–F8 nav-chrome fixes.

### B-1 — "My Tasks" IC landing + widget *(OUTSTANDING D1 · Blocker)*
**Files:** new `pmo-portal/pages/MyTasks.tsx` (route), `pmo-portal/App.tsx` (route), `pmo-portal/src/components/shell/Rail.tsx` (Engineer nav item), `pmo-portal/src/components/shell/routeMatch.ts` (MODULES + breadcrumb), `pmo-portal/src/components/dashboard/EngineerDashboard.tsx` (widget).
**Intended state:** an IC must not project-hunt the all-projects financial table to find own work. Give an Engineer a "My Tasks" destination (their assigned tasks across projects) + a dashboard widget that links to it.
**Approach:**
- **Data:** confirm a cross-project own-task read exists. The Tasks tab is project-scoped (`TasksTab projectId`); "My Tasks" needs an **assignee-scoped, cross-project** read. If no such hook/RLS read exists, this task **depends on a small DAL/RLS read** (assignee = self across projects) — flag to the Director: this may need a tiny data slice before the UI (own-tasks query). If the read is purely RLS-scoped on an existing `tasks` select, it's FE-only.
- **Nav:** add a "My Tasks" Rail item in the `Workforce` (or a new `My work`) group, `roles:[Engineer]` (and optionally Admin for parity). Register it in `MODULES` + `PLACEHOLDER_TITLES` so the breadcrumb resolves (couples to E-tasks).
- **Widget:** in `EngineerDashboard`, add a "My open tasks (N)" card linking to `/my-tasks`, beside the existing hours cards — turning the passive dashboard into a "what do I do today" surface (also addresses D4 partially).
- **Page:** `MyTasks.tsx` lists own tasks grouped by project, each row showing status + due; the Engineer can change **own task status** inline (the `taskStatus` predicate already permits own-task status edits) — reuse the Tasks tab's inline status control pattern.
**States:** loading (skeleton), empty ("No tasks assigned to you"), error (retry), populated.
**Responsive:** the list reflows to cards on mobile (defer the full mobile pass to Theme C; ship a non-broken stacked layout now).
**a11y:** the status control is a labeled `SelectField`; row links are keyboard-reachable; the widget card is a labeled region.
**DESIGN.md tokens:** `DataTable`/list, `StatusPill`, `SelectField`, `KPITile`/`Card`, `ListState` — all existing.
**BDD acceptance:**
- `AC-W2-IXD-001` *(e2e, Playwright — owning layer; it's a real cross-screen journey)* — file `e2e/AC-W2-IXD-001-my-tasks-landing.spec.ts`. "When an Engineer signs in, they reach their assigned tasks **without** opening the all-projects financial table — a 'My Tasks' nav item / dashboard widget takes them straight to their own work, and changing a task's status there persists." Assert the nav/widget exists, lands on own-task list, and a status change round-trips. *(Natural journey: IC's real goal is "see and update my work", asserted directly — not "a tasks table exists".)*
- `AC-W2-IXD-002` *(component, RTL)* — empty/loading/error states of `MyTasks` render correctly.

### B-2 — Role-shaped nav: hide unusable Approvals from ICs; Finance "Needs approval (N)" *(OUTSTANDING D3, D5 · Maj)*
**Files:** `pmo-portal/src/components/shell/Rail.tsx`, `pmo-portal/pages/Procurement.tsx` (Finance segment).
**Intended state:** the Approvals nav (`/approvals`) is offered to Engineer in `Rail.ALL_ITEMS` (`roles:[…,Engineer,…]`) but **an Engineer can never approve** (per A-2/§I unless OD-W2-2 makes manager-Engineers approvers). And Finance has no quick "what's pending my procurement approval" queue (D5).
**Approach:**
- **Approvals nav:** remove `Engineer` from the `/approvals` item's roles **unless OD-W2-2 ratifies manager-Engineers as approvers** — in which case keep it but only for Engineers who actually manage reports (the queue itself is empty for non-managers, so the nav is honest either way). Recommendation: gate the Approvals nav to roles that can approve; if manager-Engineer is ratified, the empty-queue state already handles non-manager Engineers, so leaving it is acceptable. **Director picks per OD-W2-2.** `[BLOCKED-ON: OD-W2-2]`
- **Finance procurement queue (D5):** add a "Needs approval (N)" segment/filter to `Procurement.tsx` for Finance/PM (and a count) — surfaces `Requested` PRs awaiting the viewer's approval, instead of hunting the mixed table. Reuse the existing `ViewToggle<StatusFilter>` SegFilter pattern; add a "Needs approval" segment computed from `status === 'Requested'` AND the viewer is a non-requester approver. Optionally thread the count to the rail later (defer rail-count).
**States:** Finance with pending approvals (segment shows count), none (segment shows 0 / empty), unchanged for other roles.
**DESIGN.md tokens:** `ViewToggle` SegFilter, `StatusPill` count — existing.
**BDD acceptance:**
- `AC-W2-IXD-003` *(component, RTL — owning layer)* — "An IC's nav does not offer Approvals" (asserts `/approvals` absent from the rail for a non-manager Engineer), AND/OR "Finance's Procurement view offers a 'Needs approval' segment surfacing PRs awaiting their approval." Two assertions, one per sub-change. *(If OD-W2-2 keeps Engineer-approvals, the nav assertion narrows to "non-manager Engineer sees an empty Approvals destination, not a dead one.")*

### B-3 — "+ New opportunity" CTA on the Sales Pipeline *(OUTSTANDING D2 · Blocker)*
**File:** `pmo-portal/pages/SalesPipeline.tsx` (header currently has only `Export`; create lives on Projects as "New deal").
**Intended state (rbac-visibility §C):** New deal (= new opportunity) = Admin·Exec·PM (●); Finance·Engineer ○. The natural place to start a deal is the pipeline you're looking at, not the Projects list.
**Approach:**
- Add a `<CanWrite action="create" entity="project">`-gated **"+ New opportunity"** primary CTA to the Sales Pipeline header (the existing project-create modal — `ProjectFormModal` — creates a pre-win project/opportunity per OD-UX-2 Model B). On create, land on the new deal's `/projects/:id` (pipeline lens) or refresh the board.
- Reuse the exact create flow Projects uses (same modal, same mutation) — no new create path; this is a surfacing fix.
- Demote/keep `Export` per OD-W2-5 (remove or disable-with-tooltip).
**States:** create modal (loading/validation handled by `EntityFormModal`/`useEntityForm`), success toast + navigate.
**a11y:** primary CTA labeled; modal focus-trapped (existing `EntityFormModal`).
**DESIGN.md tokens:** `Button variant="primary"`, `Icon name="plus"`, `EntityFormModal` — existing.
**BDD acceptance:**
- `AC-W2-IXD-004` *(e2e, Playwright — owning layer; cross-screen create journey)* — file `e2e/AC-W2-IXD-004-new-opportunity-from-pipeline.spec.ts`. "When a PM is on the Sales Pipeline and starts a new opportunity, they create it **from the pipeline** (a '+ New opportunity' CTA), and the new deal appears in the pipeline." Assert the CTA exists for a PM, opens the create modal, and the created deal lands in the pipeline/its detail. *(Natural journey: start a deal where you manage deals.)*
- `AC-W2-IXD-005` *(component, RTL)* — "The '+ New opportunity' CTA is hidden for Finance/Engineer." Gating regression.

### B-4 — Surface hover-only ⋯ workflow verbs (Companies, Documents) *(OUTSTANDING D11, D12, G1 · Maj)*
**Files:** `pmo-portal/pages/Companies.tsx`, `pmo-portal/pages/project-detail/tabs/DocumentsTab.tsx`, `pmo-portal/src/components/ui/DataTable.tsx` (row-action discoverability).
**Intended state:** Companies edit/archive and Documents Issue/Approve are buried in a **hover-only, 28px, opacity-0** ⋯ menu (`DataTable.tsx:261`) — undiscoverable on touch and low-discoverability on desktop. Surface the primary workflow verb as a visible row control (like the Tasks tab's inline status dropdown).
**Approach:**
- **DataTable (G1 coupler):** make the row-action trigger **always visible** (drop `opacity-0 group-hover:opacity-100`; keep `focus-visible`), and ensure the trigger meets the ≥44px touch target (couples to the `.touch-target` hook — but the full Button 44px pass is Theme C; here just the row-action trigger). This single change improves every list (Companies/Incidents/AdminUsers/Documents).
- **Documents:** surface **Issue** (Draft) and **Approve/Reject** (Issued, non-author) as a visible inline status control on the row — the document's current `statusActions` become a visible primary verb + the ⋯ holds the secondary (Edit/Delete). Mirror the Tasks inline status `SelectField` affordance so the workflow is one click, not a hover-hunt.
- **Companies:** the row ⋯ (Edit/Archive/Delete) stays a menu but becomes discoverable (always-visible trigger from the DataTable change). A full company detail/drawer is **deferred** (D11's larger half) — note it.
**States:** the row control respects the existing RBAC gating (only shows verbs the role+SoD permit, per A-5/A-7).
**a11y:** the always-visible trigger is keyboard-reachable and labeled; the inline status control is a labeled select; popover flip-above near row edges is a separate nit (I7) — defer.
**DESIGN.md tokens:** `RowMenuItem`/menu trigger, `SelectField`, `StatusPill` — existing; touch-target hook.
**BDD acceptance:**
- `AC-W2-IXD-006` *(component, RTL — owning layer)* — "A list row's actions are reachable without hover" (assert the row-action trigger is rendered/visible without a hover event, and keyboard-focusable). Single canonical proof on `DataTable`; Companies/Documents reference it.
- `AC-W2-IXD-007` *(component, RTL)* — "On an Issued document, a non-author reviewer sees a visible Approve/Reject affordance (not hidden behind hover)." Asserts the surfaced verb for the authorized reviewer.

### B-5 — Remove / honest-disable dead affordances *(OUTSTANDING D13, F9 · Maj/MED)* `[partially BLOCKED-ON: OD-W2-5]`
**Files:** `pmo-portal/pages/project-detail/tabs/DocumentsTab.tsx` (Attach-file placeholder — already a disabled tooltip, **OK** per OD-UX-3), `pmo-portal/pages/procurement/QuotationsSection.tsx` + `ProcurementDocumentsSection.tsx` (Attach-file peers), `pmo-portal/src/components/shell/ContextBar.tsx` (notification bell, no `onClick`), `pmo-portal/pages/SalesPipeline.tsx` (Export, no handler).
**Intended state (OD-UX-3 precedent):** no fake-success / no-op primary affordances. A "coming soon" with a known destination = visibly-disabled + tooltip; a truly-dead control = removed.
**Approach (per OD-W2-5):**
- **DocumentsTab Attach-file:** already a disabled tooltip-wrapped button (lines 275–282) — **leave as-is** (it's the OD-UX-3 pattern), but verify the procurement Attach-file peers (`QuotationsSection`, `ProcurementDocumentsSection`) match that honest-disabled pattern; if either is a live-looking peer of the primary, demote it to the same disabled tooltip.
- **Notification bell (`ContextBar.tsx`):** no handler → **remove** (no known destination; it's dead, not "coming soon"). Per OD-W2-5 recommendation.
- **Sales Export (`SalesPipeline.tsx`):** **demote to disabled "Export — arrives with Reports"** tooltip (a known future destination = OD-UX-3 disabled pattern), OR remove — Director picks per OD-W2-5.
- **a11y coupler (G5):** any disabled-with-tooltip control must wrap a **focusable** element (a disabled `<button>` doesn't fire hover/focus → wrap a focusable span, as DocumentsTab already does) so keyboard users reach the explanation.
**States:** disabled-with-reason (focusable), or removed.
**DESIGN.md tokens:** `Tooltip`, `Button` disabled — existing.
**BDD acceptance:**
- `AC-W2-IXD-008` *(component, RTL — owning layer)* — "No primary-looking affordance is a silent no-op: the notification bell is removed (or wired), and Sales Export is either removed or honest-disabled with a keyboard-reachable reason." Assert: bell absent; Export absent OR `disabled` + reachable tooltip. *(Encodes the OD-UX-3 honesty invariant.)*

### B-6 — IA F4: `/approvals` breadcrumb falls through to "Dashboard" *(OUTSTANDING E1 · Maj)*
**Files:** `pmo-portal/src/components/shell/routeMatch.ts`, `pmo-portal/App.tsx`.
**Intended state:** `/approvals` is a real route but is in neither `MODULES` nor `PLACEHOLDER_TITLES`, so `breadcrumbForPath` falls through to the `"Dashboard"` fallback (the wrong top-bar title — also flagged by visual-exec #4).
**Approach:**
- Add `'/approvals': 'Approvals'` to `PLACEHOLDER_TITLES` (the minimal fix — it's a workforce sub-page, not a ⌘K module). The breadcrumb then reads "Approvals" not "Dashboard". (If the Director prefers it as a first-class module with a ⌘K target, add it to `MODULES` instead — but it has no detail route, so `PLACEHOLDER_TITLES` is the right home.)
- Verify the `/approvals` standalone page vs. the Timesheets "Approvals queue" toggle: F4 also notes two homes with different chrome. **Out of scope to unify** here (larger IA call); the breadcrumb-title fix is the in-scope half.
**States:** n/a (routing/title).
**BDD acceptance:**
- `AC-W2-IA-001` *(unit, Vitest — owning layer; pure breadcrumb fn)* — "`breadcrumbForPath('/approvals')` resolves to `[{label:'Approvals'}]`, not `[{label:'Dashboard'}]`." Direct assertion on the pure helper.

### B-7 — IA F6: `/companies` + `/incidents` are real pages, not placeholders *(OUTSTANDING E3 · Min)*
**Files:** `pmo-portal/src/components/shell/routeMatch.ts` (MODULES + PLACEHOLDER_TITLES), `pmo-portal/src/components/shell/Rail.tsx` (ALL_ITEMS).
**Intended state:** `/companies` and `/incidents` are full CRUD pages but resolve via the legacy `PLACEHOLDER_TITLES` map and aren't in `MODULES`; the IA is described in two unsynced places (`MODULES` vs `Rail.ALL_ITEMS`).
**Approach:**
- Promote `companies` and `incidents` to first-class `MODULES` entries (index `path`, label, icon) so the breadcrumb + ⌘K Navigate group resolve them as modules (and ⌘K can navigate to them). Incidents has no detail route yet (the page is list+modal); Companies likewise — so MODULES entries with no `detail` are correct.
- Remove `'/companies'` and `'/incidents'` from `PLACEHOLDER_TITLES` once they're in `MODULES` (a module index already resolves its own crumb).
- Note the `MODULES` vs `Rail.ALL_ITEMS` duplication: this wave doesn't unify them (larger refactor), but promoting both consistently reduces the drift. Flag the dedupe as a future cleanup.
**States:** n/a.
**BDD acceptance:**
- `AC-W2-IA-002` *(unit, Vitest — owning layer)* — "`breadcrumbForPath('/companies')` and `('/incidents')` resolve to their own labels via MODULES (not the placeholder map), and ⌘K Navigate includes them." Assert crumb labels + that `MODULES` contains both modules.

### B-8 — IA F7: `/administration` ↔ crumb ↔ `<h1>Users` label mismatch *(OUTSTANDING E4 · Min)*
**Files:** `pmo-portal/pages/AdminUsers.tsx` (`<h1>`), `pmo-portal/src/components/shell/routeMatch.ts` (crumb label).
**Intended state:** route `/administration` ↔ breadcrumb "Administration" ↔ page `<h1>Users` is a three-way mismatch. The route and crumb say "Administration"; the page says "Users".
**Approach:**
- Pick one label and make all three agree. Recommendation: the route is `/administration` and the rail item is "Administration", but the page is a Users directory — so set the page `<h1>` to **"Administration › Users"** (or "Users" with an "Administration" breadcrumb parent). Cleanest: keep the breadcrumb "Administration" and title the page **"Users"** with a clear sub, OR rename the crumb to "Administration · Users". Resolve to one canonical label so the breadcrumb and `<h1>` don't disagree.
- Smallest honest fix: page `<h1>` → "Administration" with a "Users" section sub-heading (matches the route + crumb + rail), since Administration will later hold more than users.
**States:** n/a.
**BDD acceptance:**
- `AC-W2-IA-003` *(component, RTL — owning layer)* — "The Administration page's heading matches its route/breadcrumb label." Assert the `<h1>`/page title agrees with the "Administration" crumb (no "Users"-only `<h1>` while the crumb says "Administration").

### B-9 — IA F5: `/projects/:id/budget` asymmetric route *(OUTSTANDING E2 · Min)*
**Files:** `pmo-portal/App.tsx` (routes), `pmo-portal/pages/project-detail/ProjectDetail.tsx` (tab from URL).
**Intended state:** `/projects/:projectId/budget` is a separate route for what is a TAB; the other 4 tabs have no URL — a half-applied deep-link.
**Approach (smallest coherent fix):** either (a) **generalize** to `/projects/:id/:tab?` so all five tabs are deep-linkable symmetrically (the clean end-state noted as a Model-B prerequisite), or (b) **remove** the `/budget` special-case route and rely on in-page tab state (drop the asymmetry). Recommendation: **(a) generalize** — it's a small `routeMatch`/`ProjectDetail` change (read the `:tab` param, default `overview`), makes every tab shareable, and removes the special-case. Keep the `/budget` route as a redirect/alias for back-compat. **Director picks (a) vs (b)** — (a) is more work but removes the asymmetry properly; (b) is cheaper but loses deep-linkability.
**States:** unknown `:tab` → default to overview (no crash).
**BDD acceptance:**
- `AC-W2-IA-004` *(component, RTL — owning layer)* — "Opening `/projects/:id/<tab>` pre-selects that tab for each of the five tabs (symmetry), and an unknown tab falls back to Overview." (For option (b): assert the budget special-case is gone and tab state works without the URL.)

### B-10 — IA F8: dead `/reports` route disposition *(OUTSTANDING E5 · Min)* `[BLOCKED-ON: OD-W2-5]`
**Files:** `pmo-portal/App.tsx` (route), `pmo-portal/pages/PlaceholderPage.tsx`, `pmo-portal/src/components/shell/routeMatch.ts` (PLACEHOLDER_TITLES).
**Intended state:** Reports is demoted from the rail (Wave-1 done), but the route still renders an empty placeholder stub; a typed `/reports` URL lands on a dead stub.
**Approach (per OD-W2-5):** keep the route (deep-link should resolve, not 404) but make the stub **honest** — a "Reports arrive in a later release" message with a clear next step (back to Dashboard / link to the data it'll summarize), consistent with OD-UX-3. Ensure its breadcrumb title is correct (already in `PLACEHOLDER_TITLES` as "Reports"). Confirm the placeholder isn't a fake-functional teaser.
**States:** the placeholder is the only state.
**BDD acceptance:**
- `AC-W2-IA-005` *(component, RTL — owning layer)* — "`/reports` renders an honest 'arrives later' placeholder with a way back, not a fake-functional stub." Assert the placeholder copy + a Back/next-step action.

### B-11 — Coupler: Engineer Projects list defaults to "My Projects" + em-dash sweep in touched files *(OUTSTANDING D14, H6 — zero-cost couplers)*
**Files:** `pmo-portal/pages/Projects.tsx` (D14 default filter), and em-dash placeholders (H6) **only in files this wave already edits** (`Procurement.tsx`, `SalesPipeline.tsx`, `DocumentsTab.tsx`).
**Approach:**
- **D14:** an Engineer's Projects list defaults to "All" (leads/lost/all); default it to "My Projects" (assigned) so an IC lands on relevant work. Small filter-default change keyed on the real role. *(Only if a "My Projects" filter/scope exists; if not, defer — don't invent a scope.)*
- **H6:** replace literal em-dash placeholders (`—`) with the project's standard empty-cell token/component **in the files this wave touches anyway** (don't open new files for this). Cosmetic, do-while-here only.
**States:** n/a.
**BDD acceptance:**
- `AC-W2-IXD-009` *(component, RTL — owning layer, only if the My-Projects scope exists)* — "An Engineer's Projects list defaults to their assigned projects." Assert the default scope for `realRole='Engineer'`. *(If deferred, drop this AC and note D14 as carried.)*

---

## Traceability table (AC → owning layer per ADR-0010)

| AC | Task | Owning layer | File (test) |
|---|---|---|---|
| AC-W2-RBAC-001/002 | A-1 PipelineLens gate | component (RTL) | `pages/project-detail/__tests__/PipelineLens.rbac.test.tsx` |
| AC-W2-RBAC-003/004/005 | A-2 ApprovalsQueue gate | component (RTL) | `pages/timesheets/__tests__/ApprovalsQueue.rbac.test.tsx` |
| AC-W2-RBAC-006 | A-3 Procurement Engineer scope | component (RTL) | `pages/__tests__/Procurement.rbac.test.tsx` |
| AC-W2-RBAC-007/009/015 | A-3/A-4/A-8 ⌘K leak | unit (Vitest) | `src/hooks/__tests__/useRecordSearch.rbac.test.ts` |
| AC-W2-RBAC-008 | A-4 Sales page gate | component (RTL) | `pages/__tests__/SalesPipeline.rbac.test.tsx` |
| AC-W2-RBAC-010 | A-5 Companies page gate | component (RTL) | `pages/__tests__/Companies.rbac.test.tsx` |
| AC-W2-RBAC-011/012 | A-6 Timesheets Finance gate | component (RTL) | `pages/__tests__/Timesheets.rbac.test.tsx` |
| AC-W2-RBAC-011-RLS | A-6 server tightening | **integration (pgTAP)** | *security follow-up — tracked separately, NOT this wave* |
| AC-W2-RBAC-013 | A-7 document.edit predicate | unit (Vitest) | `src/auth/__tests__/policy.document.test.ts` |
| AC-W2-RBAC-014 | A-7 Documents Edit author gate | component (RTL) | `pages/project-detail/tabs/__tests__/DocumentsTab.rbac.test.tsx` |
| AC-W2-IXD-001 | B-1 My Tasks landing | **e2e** | `e2e/AC-W2-IXD-001-my-tasks-landing.spec.ts` |
| AC-W2-IXD-002 | B-1 My Tasks states | component (RTL) | `pages/__tests__/MyTasks.test.tsx` |
| AC-W2-IXD-003 | B-2 role-shaped nav / Finance queue | component (RTL) | `src/components/shell/__tests__/Rail.rbac.test.tsx` + `pages/__tests__/Procurement.needs-approval.test.tsx` |
| AC-W2-IXD-004 | B-3 New opportunity from pipeline | **e2e** | `e2e/AC-W2-IXD-004-new-opportunity-from-pipeline.spec.ts` |
| AC-W2-IXD-005 | B-3 CTA gating | component (RTL) | `pages/__tests__/SalesPipeline.cta.test.tsx` |
| AC-W2-IXD-006 | B-4 row-action discoverability | component (RTL) | `src/components/ui/__tests__/DataTable.discoverable.test.tsx` |
| AC-W2-IXD-007 | B-4 Documents visible verb | component (RTL) | `pages/project-detail/tabs/__tests__/DocumentsTab.verbs.test.tsx` |
| AC-W2-IXD-008 | B-5 dead-affordance honesty | component (RTL) | `src/components/shell/__tests__/ContextBar.test.tsx` + `pages/__tests__/SalesPipeline.export.test.tsx` |
| AC-W2-IA-001 | B-6 /approvals crumb | unit (Vitest) | `src/components/shell/__tests__/routeMatch.test.ts` |
| AC-W2-IA-002 | B-7 companies/incidents modules | unit (Vitest) | `src/components/shell/__tests__/routeMatch.test.ts` |
| AC-W2-IA-003 | B-8 Admin label | component (RTL) | `pages/__tests__/AdminUsers.heading.test.tsx` |
| AC-W2-IA-004 | B-9 tab deep-link symmetry | component (RTL) | `pages/project-detail/__tests__/ProjectDetail.tabs.test.tsx` |
| AC-W2-IA-005 | B-10 /reports honest stub | component (RTL) | `pages/__tests__/PlaceholderPage.test.tsx` |
| AC-W2-IXD-009 | B-11 Engineer My-Projects default | component (RTL) | `pages/__tests__/Projects.engineer-default.test.tsx` |

## Build order
1. **Owner decisions** (OD-W2-1…5) resolved by the Director with the owner.
2. **A-8 foundation** (shared denied surface + ⌘K view-gate guard) — unblocks A-3/A-4/A-5/A-6.
3. **Part A gates** A-1, A-2 (after OD-W2-2), A-3 (after OD-W2-1), A-4, A-5, A-6, A-7 — the BLOCKER-class FE correctness; do first.
4. **Part B IA cleanup** B-6, B-7, B-8, B-9, B-10 — small, pure-function-heavy, low-risk; batch them.
5. **Part B naturalness** B-3, B-4, B-5, B-2, then B-1 (largest; may need a data slice). B-11 couplers fold into whichever task opens those files.
6. Each task: red component/e2e/unit test → implement → `/design-review` three-lens battery on the touched surfaces → merge within the signed plan.

## Out of scope (carried to later waves — see OUTSTANDING ordering)
Theme B (lifecycle rework dead-ends B1–B3), Theme C (mobile responsiveness C1–C6), Theme F (silent-failure data bugs F1–F8 beyond the dead-affordance honesty), Themes G/H/I/J polish tails (except the G1/G5/H6 couplers folded above). The A-6 **server-side** RLS tightening (Finance cannot insert timesheet entries) is a **security follow-up** owned at the pgTAP layer, flagged to security-auditor, not built here.
