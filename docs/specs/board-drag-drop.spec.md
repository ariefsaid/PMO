# Board drag and drop: Sales Pipeline and project Tasks (DND)

Issue #1637. Owner ruling **OD-GRILL-20261101 "Reel differences (#1593)"** (`docs/decisions.md:3618`): "build
drag-and-drop on the Sales Pipeline board and the project Tasks board (same rules and confirms as the status menu;
the menu stays for keyboard users)". Status: **Draft, 2026-11-01** (open questions below each carry a recommended
default for owner sign-off). Plan: `docs/plans/2026-11-01-board-drag-drop.md`.

This ruling **supersedes OD-W3-4** (`docs/decisions.md:336-337`, "No drag-and-drop … stage change on the board; the
detail page stays the single place to advance a deal"). The Director should add a one-line "superseded by
OD-GRILL-20261101" note under OD-W3-4 when this spec is signed.

**Job story.** When I am grooming the pipeline or my project's tasks on the board, I want to drag a card to the
column it now belongs in, so that the board is updated in one gesture, while the app still stops me from making a
move the status menu would not allow and still asks me to confirm (or to enter contract details) exactly where the
menu does.

## Owner rulings this encodes

1. Drag and drop on two boards only: the Sales Pipeline board (`/sales`, Board view) and the project Tasks board
   (project detail, Tasks tab, Board view). (OD-GRILL-20261101.)
2. Same rules and confirms as the status menu. A drop is a second way to ask for the same transition; it never
   allows a move the menu does not offer, and never skips a confirm or a form the menu shows.
3. The status menu stays. It is the keyboard and screen-reader path. Drag is a pointer/touch shortcut on top.
4. Not built (same ruling): an "In review" task status. The board keeps the four shipped task statuses.
5. Mark won carries contract value separation of duties (ADR-0019) through the shipped win-eligibility check and
   the `transition_project` RPC. Drag reuses them; it does not re-implement or relax them.

## What ships today (grounded in code at `origin/dev` 6440a961)

### Sales Pipeline board

- The board is `SalesKanbanBoardView` in `pmo-portal/components/SalesKanbanBoard.tsx:196-281`. It renders the
  columns from `SALES_COLUMNS` (`pmo-portal/components/salesPipeline.ts:66-88`): five open stages (Leads,
  Pre-Qual = `PQ Submitted`, Quotation = `Quotation Submitted`, Tender = `Tender Submitted`, Negotiation), a terminal
  **Won** column collecting `ON_HAND_STATUSES` (`Won, Pending KoM`, `Ongoing Project`, `On Hold`, `Close Out`) and a
  terminal **Lost** column collecting `LOST_STATUSES` (`Loss Tender`, `Declined`).
- Cards (`DealCard`, `SalesKanbanBoard.tsx:42-93`) only open the deal (`onOpen`). The board has **no per-card status
  control** today. The desktop board renders at `pmo-portal/pages/sales-pipeline/PipelineResults.tsx:127`; on a phone
  the page forces the stage list presentation (`pages/SalesPipeline.tsx:86`, `PipelineResults.tsx:195`), not the
  board.
- The page is view-gated to `can('transition','project')` = Admin, Executive, Project Manager, Finance
  (`pages/SalesPipeline.tsx:59`, `src/auth/policy.ts:223`).

### The project status menu (the rule source for the pipeline)

`pmo-portal/components/ProjectStatusControl.tsx` ("Change status", mounted on the project/opportunity detail header
`pages/project-detail/ProjectDetailHeader.tsx:523` and rail `ProjectDetailRail.tsx:117`):

- Rule table: `LEGAL_PROJECT_TRANSITIONS` in `pmo-portal/src/lib/db/projectTransitions.ts:36-49`, documented as the
  "single TS source, mirrors the SQL literal inside transition_project()" (`:30-33`), with
  `isLegalProjectTransition` (`:82-87`) and `projectStatusGroup` (`:93-98`). The menu offers exactly
  `LEGAL_PROJECT_TRANSITIONS[status]` (`ProjectStatusControl.tsx:66`, `:215-226`).
- Role gate: hidden unless `can('transition','project')` (`:67`, `:122`); hidden when no legal targets (`:125`).
- **Win** (`Won, Pending KoM`): offered only when the read-only preflight `project_win_eligibility`
  (`supabase/migrations/0394_action_eligibility.sql:31-50`, hook `useProjectWinEligibility`,
  `src/hooks/useProjectTransitions.ts:70-78`, `staleTime: 0`) returns `allowed`; otherwise the menu shows one of
  three fixed messages instead of the option (`ProjectStatusControl.tsx:23-39`: checking / "Win eligibility is
  unavailable…" / "Ask an active supervisor…" / "Ask your supervisor or a more senior reviewer to confirm the value
  before winning this project."). Choosing it opens the inline form "Win — enter contract details" with required
  customer contract ref and contract date (`:246-301`); Confirm calls the transition with both (`:160-170`). The
  form's Confirm is the confirm step (no extra dialog, `:131-136`).
- **Every other target** opens a `ConfirmDialog` before any write (`:137-142`, `:303-324`): lost targets
  (`projectStatusGroup === 'lost'`, i.e. `Loss Tender`, `Declined`) use the destructive tone, title "Mark project as
  lost", label "Mark lost"; others use "Move project to {target}?" / "Move to {target}". Confirm calls
  `mutateAsync` and toasts "Project updated" or "Status change failed" with the server message (`:147-158`).
- Write: `useProjectTransition` (`src/hooks/useProjectTransitions.ts:50-67`) → repository → `transitionProject`
  RPC wrapper (`src/lib/db/projectTransitions.ts:113-125`). On success it invalidates the project projections,
  including `sales-pipeline`, `won-deals`, `lost-deals` (`src/hooks/projectQueryKeys.ts:9-15`), and runs the ERP
  project sync after a win (`useProjectTransitions.ts:59`). No optimistic update today.
- Server authority: `transition_project` enforces legality and the win inputs (pgTAP
  `supabase/tests/0028_project_transition_legality.test.sql`), role/org authorization
  (`0027_project_transition_authz.test.sql`) and the win path (`0029_project_win_path.test.sql`).

### Project Tasks board and its status menu

- `TaskBoard` in `pmo-portal/pages/project-detail/tabs/TasksTab.tsx:927-1008`, rendered at `:816-828`, four columns
  `BOARD_STATUSES = ['To Do','In Progress','Blocked','Done']` (`:76`). Its doc comment already calls the per-card
  status `<select>` "a keyboard-first alternative to drag" (`:939-943`).
- The menu is the per-card `SelectField` with all four statuses (`:993-1001`, `STATUS_OPTIONS` `:77`), shown only when
  `canSetStatus(task)` (`:422-423`, `may('edit','taskStatus', {currentUserId, record:{assignee_id}})`), else a static
  pill. Policy: delivery roles any task; Engineer and Finance only their own assigned task
  (`src/auth/policy.ts:429-438`), mirroring RLS `tasks_update_own_status`.
- **There is no transition table and no confirm for tasks**: any status to any other status, applied on select
  (`onStatusChange`, `TasksTab.tsx:458-475`): no-op if unchanged, write via `updateStatus.mutateAsync`, toast
  "Status updated" / classified error (`classifyWriteError`, `:394-395`).
- Write: `useTaskMutations().updateStatus` (`src/hooks/useTasks.ts:127-155`) → `updateTaskStatus`
  (`src/lib/db/tasks.ts:260-268`), which routes to the connected task system when the project's tasks are externally
  owned (ADR-0056) and shows the `TaskPushBadge` pending-push state. ADR-0056 already anticipates "the board drag may
  apply the optimistic `pushing`-immediately variant" (`docs/adr/0056-clickup-tasks-flip-routing-and-pending-push.md:54`)
  and ADR-0055 §4 calls for "optimistic UI per surface with a visible pending state" for board drag
  (`docs/adr/0055-external-system-adapters-sot-enhancement.md:79`).

### Shared board shell and libraries

- `Kanban` / `KanbanColumn` in `pmo-portal/src/components/ui/Kanban.tsx:22-117` (no drop-target support).
- No drag-and-drop code exists in `pages/`, `components/` or `src/` (searched `draggable`, `onDragStart`, `onDrop=`,
  `dataTransfer`; the only hit is file drop in `src/components/panel/Composer.tsx:142-152`).
- **No DnD library is installed**: `pmo-portal/package.json` and `package-lock.json` contain no `@dnd-kit/*`,
  `react-dnd`, `@hello-pangea/dnd` or `react-beautiful-dnd`. Library choice: see the plan §2.2 and OQ-1.

## Scope

In:
- Pointer and touch drag of a card between columns on the desktop Sales Pipeline board and on the project Tasks
  board (all widths it renders at).
- One shared rule and confirm path per board, used by both the menu and the drop (extracted from the shipped code,
  no second rule table).
- Optimistic placement with rollback on refusal or server error; visible pending state.
- Drop-target feedback (allowed vs not allowed) and screen-reader announcements for pointer drags.

Out of scope:
- Reordering cards within a column (no order column exists on `projects` or `tasks`; a drop inside the card's own
  column is a no-op).
- Keyboard dragging (dnd-kit `KeyboardSensor`). The keyboard path is the status menu (ruling 3). See OQ-4.
- A per-card status menu on the Sales board (OQ-3), drag on the phone pipeline stage list, the Projects kanban
  (`components/ProjectKanbanBoard.tsx`), the Procurement board, Gantt drag-to-reschedule (ADR-0031 Phase B).
- An "In review" task status; the "Signed" pill and pipeline stage-date history (separate items of the same grill).
- Any change to `transition_project`, `project_win_eligibility`, task RLS or the transition map.

## Terms

- **Menu** — the shipped status control: `ProjectStatusControl` for deals, the per-card `SelectField` for tasks.
- **Drop resolution** — what dropping card *c* (status *s*) on column *k* means: `noop`, `refused`, one `target`
  status, or a `choice` of several target statuses. Derived from the menu's rule source only.
- **Pending move** — a card shown in its target column while the move is waiting for a confirm or for the server.

## Functional requirements (EARS)

### Shared rule source

- **FR-DND-001** The system shall decide every pipeline drop from `LEGAL_PROJECT_TRANSITIONS`
  (`src/lib/db/projectTransitions.ts`) and the column membership in `SALES_COLUMNS`; the legal targets for a drop on
  column *k* are `LEGAL_PROJECT_TRANSITIONS[s] ∩ k.statuses`.
- **FR-DND-002** The system shall decide every task drop from the same `canSetStatus` predicate the task menu uses
  (`may('edit','taskStatus', …)`), with the four shipped statuses as legal targets.
- **FR-DND-003** The menu and the drop shall share one confirm/commit implementation per board (one confirm dialog,
  one win-details form, one commit function); there shall be no second transition table or copy of the win-gate
  messages.

### Pipeline drop

- **FR-DND-010** When a user drops a deal on the column that already holds its status, the system shall do nothing
  (no write, no dialog, no message).
- **FR-DND-011** If the drop resolves to no legal target, then the system shall return the card to its column, write
  nothing, and show a non-blocking message naming the deal, its current stage and the column
  ("{deal} can't move from {stage} to {column}."). (The menu has no refusal text because it never lists an illegal
  move; this message is new copy for the one case a drop can express that the menu cannot.)
- **FR-DND-012** When the drop resolves to one non-win target, the system shall open the same confirm the menu opens
  for that target (same title, description, tone and confirm label) and shall write only on Confirm.
- **FR-DND-013** When the drop resolves to more than one target (the Lost column from an open stage: `Loss Tender`
  and `Declined`), the system shall open the menu's "Mark project as lost" confirm with a required choice between
  the legal targets, defaulting to none selected, and shall write only on Confirm with the chosen status. (OQ-2.)
- **FR-DND-014** When the drop resolves to `Won, Pending KoM`, the system shall fetch a fresh win-eligibility
  decision (same query key and `staleTime: 0` as the menu) before showing anything else.
  - **FR-DND-014a** If the decision is `allowed`, then the system shall open the same win-details form (customer
    contract ref and contract date, both required) and shall write only when it is submitted.
  - **FR-DND-014b** If the decision is anything else or the check fails, then the system shall return the card and
    show the same message the menu shows for that decision.
- **FR-DND-015** When the user cancels a confirm or the win form (Cancel, Esc, scrim), the system shall return the
  card to its original column and write nothing.
- **FR-DND-016** Where a deal's card is on the board, the system shall make it draggable only if
  `can('transition','project')` is true for the real JWT role and its status has at least one legal target.

### Task drop

- **FR-DND-020** When a user drops a task they may set the status of on another column, the system shall apply that
  status immediately with no confirm (the task menu has none), with the same success and error toasts as the menu.
- **FR-DND-021** Where `canSetStatus(task)` is false, the system shall not make the card draggable (it keeps the
  static pill it shows today).
- **FR-DND-022** Where the project's tasks are externally owned, the system shall route the write through the
  shipped `updateStatus` path and show the shipped pending-push badge while it is in flight.

### Optimistic update and rollback (both boards)

- **FR-DND-030** While a confirm or win form opened by a drop is open, the system shall show the card in the target
  column marked as pending.
- **FR-DND-031** When a move is committed, the system shall keep the card in the target column marked as saving
  (`aria-busy`), and shall not let that card be dragged again until the write settles.
- **FR-DND-032** If the server refuses or the write fails, then the system shall return the card to its original
  column and show the server's message through the same toast the menu uses.
- **FR-DND-033** When the write succeeds, the system shall clear the pending mark only after the board's own query
  has refetched, so the card never flickers back to its old column.
- **FR-DND-034** The system shall never write `org_id` from the client and shall send exactly the payload the menu
  sends (`transition_project(p_id, p_to, p_customer_contract_ref, p_contract_date)`; `tasks.status` only).

### Drag feedback and accessibility

- **FR-DND-040** While a card is being dragged, the system shall mark each column as an allowed or not-allowed drop
  target using the same drop resolution, with a non-colour cue (icon or text) as well as colour.
- **FR-DND-041** The system shall announce drag start, the column under the pointer (with "allowed"/"not allowed"),
  drop and cancel in a polite live region, in the active locale.
- **FR-DND-042** The system shall keep the menu (task `SelectField`, deal "Change status") unchanged and reachable by
  keyboard and screen reader; drag adds no keyboard behaviour and does not change card focus order or roles.
- **FR-DND-043** A click or tap on a card that does not move past the activation threshold shall keep opening the
  card exactly as today.
- **FR-DND-044** When the user presses Esc during a drag, the system shall cancel it and return the card.

## Non-functional requirements

- **NFR-DND-001 Authority.** `can()` is UX only; `transition_project` and task RLS stay the enforcement authority
  (ADR-0016, ADR-0019). A drop by a role the server refuses rolls back with the server message.
- **NFR-DND-002 Touch.** Drag works with touch on tablets and phones without stealing vertical or horizontal board
  scroll: touch drag starts after a press-and-hold (default 250 ms, 5 px tolerance); pointer drag after 6 px.
- **NFR-DND-003 Bundle.** At most one new runtime dependency, pinned to an exact version, loaded only in the board
  chunks; the build's chunk report shows the added weight (target ≤ 20 kB gzipped).
- **NFR-DND-004 Performance.** Dragging over a 200-card pipeline board stays responsive (no re-render of every card
  on each pointer move; columns compute their allowed state once per drag start).
- **NFR-DND-005 Accessibility.** No new axe violations on either board in default, dragging and dialog states;
  WCAG 2.2 SC 2.5.7 (Dragging Movements) is met by the menu as the single-pointer alternative.
- **NFR-DND-006 i18n.** New copy lives in its own namespace `boardDrag` (`public/locales/{en,id}/boardDrag.json`),
  per `docs/e2e-parallel-conventions.md`; status enum values stay untranslated as today.
- **NFR-DND-007 UI.** DESIGN.md tokens only; drop-target and pending states rendered and reviewed per the UI lane
  (`scripts/ux-proof.sh` on `/sales` and a project Tasks tab).

## Acceptance criteria (Given / When / Then)

- **AC-DND-001** Given each pair (status, column) on the pipeline board, when the drop is resolved, then the result
  equals `LEGAL_PROJECT_TRANSITIONS[status] ∩ column.statuses` (noop for its own column, refused when empty, target
  for one, choice for several), for every status and column.
- **AC-DND-002** Given a PM on `/sales` and a deal in Leads, when it is dragged to Tender, then the card returns to
  Leads, no transition request is sent, and the message "… can't move from Leads to Tender." is shown.
- **AC-DND-003** Given a deal in Quotation, when it is dragged to Tender, then the confirm "Move project to Tender
  Submitted?" opens; on Cancel the card is back in Quotation and nothing is written; on Confirm the transition is
  sent once with `to = 'Tender Submitted'` and the card stays in Tender.
- **AC-DND-004** Given a deal in Negotiation with win eligibility `allowed`, when it is dragged to Won, then the
  win-details form opens; submitting without a contract ref or date is blocked; submitting both sends the transition
  with them; Cancel returns the card to Negotiation with nothing written.
- **AC-DND-005** Given a deal whose win eligibility is `reviewer_required` (or `inactive_reviewer`, `unavailable`,
  or the check errors), when it is dragged to Won, then the card returns and the same message the menu shows for that
  decision is displayed; no form opens and nothing is written.
- **AC-DND-006** Given a deal in Tender, when it is dragged to Lost, then the destructive "Mark project as lost"
  confirm opens with a required choice of Loss Tender or Declined; Confirm is disabled until one is chosen; Confirm
  sends the chosen status.
- **AC-DND-007** Given a confirmed pipeline move that the server refuses (e.g. the deal changed stage in another
  tab), then the card returns to its original column and the "Status change failed" toast shows the server message.
- **AC-DND-008** Given a confirmed move that succeeds, then the card is shown saving in the target column until the
  pipeline queries have refetched, and is never shown back in the old column in between.
- **AC-DND-009** Given an Engineer on a Tasks board, when they drag their own task from To Do to In Progress, then
  the status is written with no confirm and "Status updated" shows; a task assigned to someone else is not draggable.
- **AC-DND-010** Given a PM, when a task drop is refused by the server or fails, then the card returns to its
  original column and the classified error toast shows (external-owned projects: the push-failed badge too).
- **AC-DND-011** Given the menu path on either board, then its behaviour is unchanged: every existing
  `ProjectStatusControl` and `TasksTab` test still passes after the shared-flow extraction.
- **AC-DND-012** Given a drag in progress, then columns are marked allowed/not allowed by the drop resolution with a
  non-colour cue, and the live region announces start, over-column (allowed or not), drop and cancel.
- **AC-DND-013** Given a pointer click (movement under 6 px) on a deal or task card, then the card opens as today and
  no drag starts.
- **AC-DND-014** Given an Exec on `/sales` (real browser, real DB) and a self-created deal in Quotation, when it is
  dragged to Leads, then it stays in Quotation with the refusal message; when it is dragged to Tender and confirmed,
  then after reload it is in the Tender column; when it is then dragged to Won and contract details are submitted,
  then after reload it is in the Won column. *(Cross-stack journey.)*
- **AC-DND-015** Given a PM on a project Tasks board (real browser, real DB), when a self-created task is dragged
  from To Do to Done, then after reload it is in Done. *(Cross-stack journey.)*
- **AC-DND-016** Given both boards in default, mid-drag and confirm-open states, then axe reports no violations.

## Traceability (owning layer, ADR-0010)

| AC | Owning layer | Test (detail in the plan §5) |
|---|---|---|
| 001 | Vitest (pure) | `components/salesPipeline.drop.test.ts` |
| 002, 003, 004, 005, 006, 007, 008 | Vitest/RTL (mocked hooks; drop driven through the `BoardDnd` seam) | `pages/sales-pipeline/__tests__/DraggableSalesBoard.test.tsx` |
| 012, 013 | Vitest/RTL | `src/components/kanban/__tests__/BoardDnd.test.tsx` |
| 009, 010 | Vitest/RTL | `pages/project-detail/__tests__/TasksTab.boardDnd.test.tsx` |
| 011 | Vitest/RTL (existing suites, unchanged) | `components/ProjectStatusControl.test.tsx`, `pages/project-detail/__tests__/TasksTab.*.test.tsx` |
| 014 | Playwright | `e2e/AC-DND-014-pipeline-drag.spec.ts` |
| 015 | Playwright | `e2e/AC-DND-015-tasks-drag.spec.ts` |
| 016 | Playwright + axe | inside the two e2e journeys (`@axe-core/playwright`) |
| server enforcement | pgTAP (existing, unchanged) | `0027`, `0028`, `0029` project transition tests; task own-status RLS `supabase/tests/0052_task_engineer_status.test.sql` |

No new pgTAP: the drop sends the same RPC/update as the menu, whose server contract is already proven.

## Open questions (owner signs; each has a recommended default)

1. **OQ-1 Library.** Recommended: add `@dnd-kit/core` (exact pin `6.3.1`), not native HTML5 drag and drop and not
   `@hello-pangea/dnd`. Native HTML5 DnD has no touch drag on iPhone Safari, no keyboard or announcement support,
   and a fixed browser drag image; `@hello-pangea/dnd` is built for list reordering, is heavier (it bundles Redux) and
   fights our own column layout. `@dnd-kit/core` gives pointer and touch sensors with activation thresholds, built-in
   live-region announcements, and is small. Comparison in plan §2.2.
2. **OQ-2 Dropping on Lost (two legal statuses).** Recommended: one destructive confirm with a required choice
   (Loss Tender / Declined), no preselection, so a decline is never recorded as a lost tender by default.
3. **OQ-3 A status menu on Sales board cards?** Recommended: no. The board's keyboard path is the card → deal page →
   "Change status" (shipped). Adding a card menu is a separate UX change.
4. **OQ-4 Keyboard drag (dnd-kit KeyboardSensor)?** Recommended: no, per the ruling ("the menu stays for keyboard
   users"); it would also clash with Enter/Space opening the card.
5. **OQ-5 Delivery moves inside the Won column** (Won, Pending KoM → Ongoing / On Hold / Close Out). Recommended:
   not by drag; they share one column, so a drop there is a no-op and the deal page menu remains the path.
6. **OQ-6 Touch drag on the phone Tasks board** (single stacked column). Recommended: enabled with press-and-hold
   (NFR-DND-002); the per-card select stays the primary phone path.

## Follow-ups

Drag on the Projects kanban and the Procurement board using the same shell; a Sales board card menu (if OQ-3
changes); within-column ordering (needs an order column); Gantt drag-to-reschedule (ADR-0031 Phase B).
