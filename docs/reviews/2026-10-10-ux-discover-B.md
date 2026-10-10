# Area B — director-level UX discovery

**2026-10-10 · Projects, delivery tasks, budgets and meetings · running build on port 5200**

## Five-line verdict

1. **Fix-then-ship:** the delivery foundation works, but handoffs still rely on the user knowing the organization and the application.
2. Project/task creation, inline completion, minutes persistence and another reviewer’s budget/work-order actions were demonstrated with fresh records.
3. Budget drafting stops short of a review handoff; meeting actions stop short of an accountable owner/date; work-order authors discover the reviewer requirement too late.
4. Yesterday’s compact headers, clearer identities, semantic icons and phone stacking are visibly improved; preserve them rather than redesigning the shell again.
5. Prioritize accountable next actions, useful task landing pages and plain bilingual guidance before further visual polish.

## Method, evidence and boundaries

Reviewed the existing running application, using **only browser session `disc-B`**. No application edits, commits, server starts/stops, seed resets or seeded-record deletions. Session `disc-B` was closed after the audit; no other browser session was closed. All five demo roles were signed into: PM and Finance performed the primary journeys; Engineer verified the personal-task/navigation experience; Executive inspected the active budget; Admin inspected meeting/detail affordances. This is not a claim that every role executed every journey.

Created a distinguishable **UX Discover B Delivery Trial**, a Mobilisation phase, Delivery baseline budget, Check mobilisation plan task, UX Discover B Coordination meeting, Confirm site access meeting action and Site mobilisation order. The budget became active through Finance; the work order became issued through Finance. Retained those records. PM and Finance language preferences were returned to organization-default English after the language checks.

**Evidence root (`E/` below):**

`/private/tmp/claude-502/-Users-ariefsaid-Coding-PMO/abd5a194-c2a4-469e-b763-f2a75f07ec08/scratchpad/disc-b/`

`P` means the fresh trial project; `M` means the fresh coordination meeting. Evidence covers the richer seeded delivery project as well, not just the initially empty trial.

### Coverage

| Surface | Rendered coverage |
|---|---|
| Projects Table, Cards, Calendar, Board | All four at 1440×900/light/English and 390×844/light/English; all four at both sizes/dark/Bahasa Indonesia. Calendar phase entry opened its corresponding project. |
| Project Overview, Budget, Procurement, Tasks, Work orders, Billing, Documents, History | All eight at both sizes/light/English and both sizes/dark/Bahasa Indonesia; desktop dark/English also captured. |
| New project, phase/progress, budget version/line/activation, new task/status, work order/issue, billing-line form | Opened and interacted with the relevant forms; fresh successful writes and intentional reviewer separation exercised. Billing-line form inspected but not submitted. |
| My Tasks, Meetings list, meeting detail/minutes/actions | Both sizes/light/English and dark/Bahasa Indonesia; additional light/Bahasa Indonesia and dark/English captures. Key Projects/Tasks/Budget surfaces also cross-checked in light/Bahasa Indonesia and phone dark/English. |
| States | Rich populated lists; fresh empty project tabs; Projects no-results with clear-filter recovery; draft/active budgets; empty billing; dirty-minutes guard; denied author issue and successful reviewer issue; unavailable ERP projection and its recovery affordances. |

Core screenshot families: `projects-{table,cards,calendar,board}-{1440,390}-{light-en,dark-id}.png`, `project-{overview,budget,procurement,tasks,work-orders,billing,documents,history}-{1440,390}-{light-en,dark-id}.png`, plus `my-tasks-*`, `meetings-*`, `meeting-detail-*`. `projects-views-390-dark-id.png` is a corrected four-view montage; use the individual files for full-size judgment.

Loaded agent-browser core/dogfood and the design-review, impeccable critique/audit, taste and ui-ux-pro-max review guidance. Ran the scoped impeccable detector on the Area B page/component surfaces: **no detector findings**. Manual rendered findings below are independent of that result. Browser-injected axe checks of **main content** on desktop light/Indonesian meeting detail and desktop dark/English Projects returned **zero violations** for WCAG A/AA/2.1 AA tags. That is two scoped scans, not a whole-product accessibility certification. Keyboard attendee selection and the unsaved-minutes guard worked. No quantified performance benchmark was run.

An attempted browser network-abort did not produce a visible project-list fetch failure; consequently no general fetch-error-state pass is claimed. Native date-picker automation was inconclusive: no date-picker defect is inferred. Early attendee pointer attempts did not select the intended lower option, but later keyboard and visible pointer selections persisted attendees; **no attendee-save defect is filed**. Post-activation ERP retry was visible after reload: **no permanently missing-retry claim**.

No approved mockup comparison was requested for this Discover pass. The deciding visual references were `DESIGN.md`, the running result and `docs/reviews/2026-10-09-ui-polish-critique.md`; intent references were the seven requested jobs and `docs/jtbd.md` §2. Prior-art sweeps covered project creation and the delivery/budget/meeting/task surfaces. Existing canonical project lifecycle and reviewer separation are constraints, not mistakes to remove.

## Ranked top ten fixes

Effort: **S** = localized copy/layout/permission-aware presentation; **M** = component/data-query change plus tests; **L** = cross-role workflow/state integration. These are relative engineering sizes, not promises of hours.

| Rank | Finding | Fix | Severity | Effort |
|---:|---|---|---|---|
| 1 | B-01 | Give meeting actions owner, due date and an adjacent open/assign path. | High | M |
| 2 | B-02 | Turn “someone else activates” into an explicit budget review handoff with a review destination. | High | L |
| 3 | B-03 | Preflight work-order reviewer eligibility; replace the late technical rejection with a human next step. | High | M |
| 4 | B-04 | Put the actionable task list before unused ClickUp setup. | Medium | S–M |
| 5 | B-05 | Expose My Tasks to a PM who is assigned work, without changing write authority. | Medium | S |
| 6 | B-06 | Make My Tasks a working queue: active by default, search/status controls, easy completed access. | Medium | M |
| 7 | B-13 | Give calendar phases visible project identity before users drill in. | Medium | S |
| 8 | B-08 | Translate system statuses, breadcrumbs and integration guidance consistently. | Medium | M |
| 9 | B-09 | Keep persistent warnings out of phone dialog action areas. | Medium | S–M |
| 10 | B-10 | Explain phase weight, position and progress override in delivery language. | Medium | S |

## Seven real jobs — effort and outcome

**Counting convention:** `S/C/F/D` = distinct page/dialog surfaces / deliberate clicks or selections / typed data fields / domain decisions. A selected dropdown option counts as one selection; typing a slash command is identified separately. Repeated screenshots, viewport/theme/language switches, login persona selection, investigation retries and tool waits are excluded. Counts below are **normalized successful/attempted UI traces**, not stopwatch telemetry; a direct record URL is disclosed rather than counted as a discovered navigation path. ERP minimums are design lower bounds for the same job and governance, not measurements of a named competing product.

| Job and actual trace | Observed S/C/F/D | Outcome | Sensible ERP minimum | Avoidable burden |
|---|---|---|---|---|
| **1. Start delivery for a won opportunity, with PM and dates.** Projects → New project exposes lead/internal creation, not a separate won conversion. Alternative exercised: create a new Internal Project with name/customer/PM/value, then open it. | Won-route discovery: **2/1/0/1**. Alternative new internal record: about **3/7/3/3**; date completion not demonstrated. | **Requested won-start path not completed via New project.** Alternative internal creation persisted. A won project is already the canonical project; do not create a duplicate. | Open the existing won project → edit PM/dates: about **3/3/2/2**, with existing customer/value retained. | Ambiguous creation intent invites unnecessary re-entry. Provide the existing-record route, not another conversion wizard. B-07. |
| **2. Add a phase/milestone and report progress.** Overview → add phase → save Mobilisation → edit progress → save 25%. | **3/4/2/2**, excluding inconclusive date-picker experiments. | Phase and 25% progress persisted. Target-date entry was explored but not proven saved. | Same **3/4/2/2** for two separate writes; explain defaults rather than removing controls. | Mostly interpretation: phase/milestone naming, relative weight, position and override semantics. B-10. |
| **3. Draft a budget and send it for activation.** Budget → New version → create → extra confirmation → add Labor line → save. | **2/6/3/3** to a saved version/line. | **Draft saved; no explicit send-for-review action found in the rendered draft.** Actor switch/direct link substituted for a product handoff. | About **2/5/3/3**, including a real review submission; version naming can default. | Empty-version confirmation spends a click without delivering a handoff. The missing handoff adds unbounded external coordination, not merely one more click. B-02/B-11. |
| **4. Finance/Executive activates another author’s budget.** Finance opened the supplied project Budget URL → Activate → confirm. | **2/2/0/1** after the supplied link; author’s work is separate. | **Active** budget demonstrated through Finance. ERP projection remained unavailable; retry appeared after reload. Executive subsequently read the active version. | **2/2/0/1** after a discoverable review item/link. Keep explicit activation confirmation and another reviewer. | Activation mechanics are already efficient. Finding the draft and understanding “active in PMO” versus external projection are the burdens. B-02/B-12. |
| **5. Add/assign a task, then mark it Done.** Project Tasks → Add task → title/assignee → Create → inline status Done. PM’s personal list also inspected. | About **2/6/1/2**. | Assigned task persisted; Done update worked. | Approximately the same **2/6/1/2**; no detail-page round trip is necessary. | Good write path. Finding that work later is harder for PM; completed items and integration setup dilute the queue. B-04/B-05/B-06. |
| **6. Record a meeting, minutes and accountable follow-up.** Meetings → New → project/title → create → minutes → Save → `/action` → task title → Create → Save minutes; attendee added. | About **4/10/3/3**, plus the typed `/action` command; unsuccessful initial pointer attempts excluded. | Meeting/minutes/action persisted; action became a real project task. **Follow-up was unassigned and undated.** | About **4/8–10/4/4**, with title/owner/date at creation and attendees captured in the same workflow. One additional meaningful field is preferable to a hidden follow-up repair journey. | Present saving success is not accountable follow-up success. Repair currently requires finding the task elsewhere. B-01. |
| **7. Create/issue a work order and understand billing/headroom.** PM Work orders → New → title/PO/value/tax treatment → Save → Issue → confirm → rejection. Finance direct record → Issue → confirm; then inspect Billing. | PM about **3/6/4/3**, Finance **2/2/0/1**; Billing adds **1/1/0/1**. | **Issued** through another reviewer. Read 20% drawdown, $100,000 contract headroom and $25,000 left to invoice. No invoice or billing line was created. | About **4/6–7/4/4** across two actors, plus the Billing tab. Reviewer separation is intrinsic, not waste. | The denied author confirmation is avoidable. Human handoff and reliable readiness explanation are missing; routine entry remains manageable. B-03/B-14/B-15. |

Do not optimize these numbers by eliminating meaningful decisions, reviewer separation, activation confirmation or dirty-form protection. Optimize hunting, repeat explanations, routine confirmations and dead-end actions.

## Five-lens screen sweep

Each cell records the rendered judgment, not an assertion that a source-code checklist passed. `✓` means no material issue found in this pass; IDs point to the findings below.

| Screen/state | 1 · Consistency | 2 · Best practice / accessibility | 3 · Effort | 4 · Logic | 5 · Guidance / labels |
|---|---|---|---|---|---|
| Projects Table | Improved canonical identity; B-08 | Phone card treatment works | Search/clear filters useful | Delivery list includes won onward | New-project intent B-07 |
| Projects Cards | Same entities as table; B-08 | Readable responsive cards | Dense financial context, but no new blocker | Opens same project | System status translation B-08 |
| Projects Calendar | Same canonical project destination | Event is clickable/labelled | Visual project identification B-13 | Phase dates, not full project schedule | Explain calendar scope B-13 |
| Projects Board | Shares delivery lifecycle | Phone stage navigation works | Horizontal columns remain usable | Won/internal stages coherent | Mixed-language statuses B-08 |
| New project | Shared modal/form primitives | Required-field presentation usable | Avoid re-entering won data B-07 | Creation is not won conversion | Describe lead/internal purpose B-07 |
| Overview / phase modal | Compact common header preserved | Dirty-form guard present; B-09 | Numeric concepts need explanation | Weight/override matter to progress B-10 | Phase/milestone vocabulary B-10 |
| Budget draft | Same project/tab route | Line table has labelled scroll region | Routine confirmation B-11; repeated summary B-16 | Review handoff stops B-02 | Name next reviewer/action B-02 |
| Budget active / projection | Active version remains canonical | Explicit activation confirmation good | No extra reviewer write needed | PMO active versus ERP projection B-12 | Recovery status B-12 |
| Procurement tab | Shares project context | Readable request rows/status ladder | Adjacent New request; ✓ | Opens related procurement entity | B-08; no new flow defect found |
| Tasks tab | Multiple task views share tasks | Labels/inline controls usable | Integration before work B-04 | Assignment/Done succeeds | Setup should not imply task prerequisite B-04/B-08 |
| My Tasks | Same inline task actions | Phone rows/actions readable | Queue/search/completed burden B-06 | Assigned PM tasks exist, nav omits home B-05 | Bilingual status B-08 |
| Work orders | Same project and record primitives | Phone cards, no observed body overflow | Create action below summaries B-14 | Author issue dead end B-03 | Human review next step B-03 |
| Billing / add-line form | Shared modal, selected work order | Empty state and labelled quantities | ERP identifier lookup burden B-15 | Assessment/claim/invoice distinctions visible | Explain item source/readiness B-15 |
| Documents | Register rather than a competing project home | Search, categories and rows readable | Adjacent Add document; ✓ | Remains project-scoped | No material new issue found |
| History | Existing entity tabs/filter vocabulary | Readable desktop and phone feed | Entity filters available | No alternative project route introduced | Existing history-copy work remains separate; no duplicate new finding |
| Meetings list / create | Same meeting entity destination | Responsive list/create form | Basic create path straightforward | Project-linked meeting persisted | B-08; owner/date gap is in follow-up, not meeting creation |
| Meeting detail / minutes / action | Real task created, not a second task system | Keyboard attendee path and unsaved guard work | Hidden repair journey B-01 | Saved action lacks accountability B-01 | Task link/assign/date and status B-01/B-08 |

### Additional design-review lenses

- **Lens A — Visual/correctness.** Strengths: retained Inter/blue/neutral identity, calmer header, readable phone cards, focusable labelled table-scroll regions; scoped axe scans clean. Issues: B-08/B-09/B-14/B-16/B-17. No Critical issue confirmed. No blanket contrast, performance or all-state certification.
- **Lens B — IxD/task naturalness.** Strengths: inline task completion, clear-filter recovery, protected dirty minutes and calendar-to-project opening. Issues: B-01/B-02/B-03/B-04/B-06/B-10/B-11/B-12/B-15. The major friction is switching from “I saved it” to “the next person can act.”
- **Lens C — IA/navigation.** Strengths: one canonical project across four list views/eight tabs; linked meeting opens that same project; no separate duplicate meeting-action repository. Issues: B-05/B-07/B-13. Do not solve these with another project URL or list.
- **Lens D — Intent/JTBD.** Project-list job: when work is won, PM wants the existing record ready for delivery, not a duplicate. Budget job: when a draft is ready, PM wants a reviewer able to activate it. Task job: when assigned work begins, Engineer/PM wants the next actionable task. Meeting job: after a coordination discussion, PM wants each commitment owned and dated. Financial job: before issuance/billing, PM/Finance wants remaining capacity and the next valid reviewer/action. Against those jobs: B-01/B-02/B-03 are Important; B-04/B-05/B-06/B-12/B-14/B-15 are Important supporting gaps. B-07 is a Minor entry-point guidance opportunity, not a demonstrated lifecycle/data defect. No Critical issue confirmed.

For these additional lenses, **High/Medium findings are Important; Low findings are Minor**. Findings below supply the route, broken outcome, evidence and fix. This pass produced before/current evidence, not fabricated “after” screenshots: implementation and re-rendering belong to the follow-up builder.

## Numbered findings

### B-01 — A saved meeting action is not yet an accountable commitment

**High · M · lenses 1/3/4/5 · `/meetings/:M` → project Tasks.**

- **What breaks:** PM records “Confirm site access” with `/action`. The creation form asks for title, then the action is saved as a real project task without assignee or due date. Its minute block/summary supplies no clear open/assign affordance. A meeting can look complete while nobody owns its follow-up.
- **Evidence:** `E/meeting-action-create-1440-light-en.png`, `meeting-action-saved-1440-light-en.png`, `meeting-detail-390-light-en.png`; corresponding task observed in the fresh project. Violates the meeting job’s “so we can act on decisions” outcome and analogous task-create/preview conventions.
- **Fix:** reuse the project-task assignee/date controls in action creation; permit an explicit unassigned choice but mark it visibly as needing assignment. Make both embedded block and summary expose an accessible task link plus adjacent Assign/Edit. Do not create a separate action-item entity.
- **EN / ID copy:** “Create follow-up task” / “Buat tugas tindak lanjut”; “Owner” / “Penanggung jawab”; “Due date” / “Tenggat”; “Unassigned — assign an owner” / “Belum ditugaskan — pilih penanggung jawab”; “Open task” / “Buka tugas”.
- **Graduate:** extend `MinutesEditor.test.tsx` and `ActionItemView.test.tsx` for owner/date inputs, missing-owner cue and keyboard task link. Extend `e2e/AC-MTG-060-meeting-minute-action.spec.ts` to create an owned, dated action and verify the same task in the assignee’s queue. Matrix: meeting detail × actionable follow-up; note the interaction paradigm in `DESIGN.md`/decisions after acceptance.

### B-02 — Budget draft has an instruction but no review handoff

**High · L · lenses 3/4/5 · `/projects/:P/budget`.**

- **What breaks:** the PM can draft v1 and line items, and is told another person must activate. There is no adjacent submit/request-review action in the rendered draft. This review completed activation by switching persona and using the known project URL, not through a product-owned handoff. Finance’s inspected Approvals surface displayed purchase requests, not an evident budget-review destination. This is a scoped UI observation, not a claim about every notification/integration path.
- **Evidence:** `E/budget-draft-1440-light-en.png`, `trial-budget-390-dark-id.png`, `finance-approvals-budget-handoff-1440-dark-en.png`. Budget JTBD requires turning a ready draft into an actionable review, not merely explaining why Activate is unavailable.
- **Fix:** introduce an explicit review request and discoverable reviewer destination, reusing the approval/notification model where appropriate. Include project, version, total, author and direct review link; show requested/changes-needed/ready status. This is product workflow work requiring Director scope approval, not a one-line button illusion. Keep another reviewer and the activation confirmation.
- **EN / ID copy:** “Request activation” / “Ajukan aktivasi”; “Ready for review. Send this version to Finance or an Executive.” / “Siap ditinjau. Kirim versi ini ke Keuangan atau Eksekutif.”; “Requested — awaiting reviewer” / “Diajukan — menunggu peninjau”.
- **Graduate:** unit coverage for draft/requested states and duplicate-request prevention; curated two-role journey from PM request to reviewer’s actionable queue to Active. Keep existing activation/reviewer proofs intact. Matrix: project Budget × cross-role handoff; Approvals × budget discovery. Record the lifecycle decision before implementation.

### B-03 — Work-order author is invited into a predictable dead end

**High · M · lenses 2/3/4/5 · `/projects/:P/work-orders`.**

- **What breaks:** PM creates/sets the order’s value, sees Issue, opens and confirms it, and only then learns that another reviewer is required. The rejection includes technical rather than task-oriented language. Finance subsequently issues the same record successfully: the two-person rule is working, but its UX arrives too late.
- **Evidence:** `E/work-order-issue-blocked-1440-light-en.png`, `work-order-success-1440-light-en.png`. Preserve the shipped reviewer rule; this is not a request to let the author issue their own value.
- **Fix:** evaluate author/reviewer eligibility before offering the write confirmation. Show why the current actor cannot issue and give a review handoff/open-link action. Reserve the confirm dialog for an eligible reviewer. Classify the denial into plain next-step copy rather than exposing implementation jargon.
- **EN / ID copy:** “Another reviewer must issue this order” / “Work order ini harus diterbitkan oleh peninjau lain”; “You set its value. Ask Finance or an Executive to review and issue it.” / “Anda menetapkan nilainya. Minta Keuangan atau Eksekutif meninjau dan menerbitkannya.”; “Request review” / “Ajukan peninjauan”.
- **Graduate:** `WorkOrdersTab.test.tsx`: author sees explanation/handoff, another reviewer sees Issue, technical error maps to human copy. Curated two-person issue journey; retain enforcement tests unchanged. Matrix: Work orders × valid next action/reviewer separation.

### B-04 — Task work sits behind an unused integration setup surface

**Medium · S–M · lenses 2/3/5 · `/projects/:id/tasks`.**

- **What breaks:** a PM/Engineer arriving to manage tasks sees a prominent “ClickUp Task Sync” panel and empty “Link project in ClickUp” setup before the actual list. On phone, this occupies scarce space even though local task creation and completion work independently.
- **Evidence:** `E/project-tasks-1440-dark-en.png`, `project-tasks-390-light-id.png`, `project-tasks-390-dark-id.png`. Task JTBD puts active work and Add task before optional integration configuration; do not reopen yesterday’s common-header findings.
- **Fix:** move connection setup below the list or into a collapsed, contextual Integrations section. Keep a compact sync indicator near tasks only when connected or attention is required. Show task counts/filters/primary action first.
- **EN / ID copy:** “Tasks” / “Tugas”; “Optional integration: ClickUp” / “Integrasi opsional: ClickUp”; “You can manage tasks here without connecting ClickUp.” / “Anda dapat mengelola tugas di sini tanpa menghubungkan ClickUp.”
- **Graduate:** `TasksTab.test.tsx` for local-only state and task-before-setup ordering; phone visual/DOM-position assertion that task heading/action is reachable before optional setup. Matrix: project Tasks × decision-relevant first viewport.

### B-05 — PM’s assigned-work home is supported but absent from the rail

**Medium · S · lenses 1/3/4/5 · primary navigation → `/my-tasks`.**

- **What breaks:** the PM is assigned tasks and the direct My Tasks route renders them, but the PM desktop rail omits My Tasks. Engineer and Admin navigation expose it. A PM must know the URL or another entry point rather than discover their own cross-project work consistently.
- **Evidence:** PM rail in `E/my-tasks-1440-light-en.png`; Engineer rail/drawer in `engineer-my-tasks-1440-dark-en.png`, `engineer-navigation-390-dark-en.png`. Scope is the rendered primary navigation; this does not assert that no dashboard/deep-link entry exists.
- **Fix:** expose the canonical My Tasks home for roles that can receive and read assigned tasks. Do not add a second personal task list or broaden write permissions.
- **EN / ID copy:** “My Tasks” / “Tugas Saya”; “Your assigned work across projects” / “Tugas Anda di seluruh proyek”.
- **Graduate:** role-specific `AppShell.test.tsx`/`AppShell.mobile.test.tsx`; extend `AC-W2-IXD-001-my-tasks-landing.spec.ts` for PM navigation and assigned task presence. Matrix: PM navigation × personal-work discovery.

### B-06 — My Tasks behaves like an archive rather than a focused working queue

**Medium · M · lenses 2/3/4 · `/my-tasks`.**

- **What breaks:** the rich personal list groups many tasks by project, includes Done work, and has no rendered search/status filter at the page top. Project-task controls offer richer navigation. A person looking for today’s open work must scan project groups and completed rows.
- **Evidence:** `E/my-tasks-1440-light-en.png`, `my-tasks-390-light-id.png`, `engineer-my-tasks-1440-dark-en.png`. The current per-row due/overdue cues and inline status/comments/log-time actions are strengths to retain.
- **Fix:** default to active assigned work; provide All/Completed plus search and useful due/blocked filters. Preserve project context and stable links. Do not hide completed work permanently or reset filters unexpectedly.
- **EN / ID copy:** “Open tasks” / “Tugas aktif”; “Completed” / “Selesai”; “Search your tasks” / “Cari tugas Anda”; “Due soon” / “Segera jatuh tempo”.
- **Graduate:** `pages/__tests__/MyTasks.test.tsx` and `MyTasks.urgency.test.tsx`: default, clear, completed access, overdue sorting/filter behavior. Phone queue screenshot with rich seed. Matrix: My Tasks × actionable queue, not merely assigned-row existence.

### B-07 — Creation intent can be clearer before entering the form

**Low · S · lenses 1/3/4/5 · `/projects` → New project; guidance opportunity, not a confirmed lifecycle defect.**

- **Observed burden:** following the requested won-start job through New project opens lead/internal creation and requires backing out to find the existing won record. The form already explicitly says that on-hand work is reached by winning in Pipeline, never created directly. That guidance helped reveal the wrong entry choice; it is not absent, and no duplicate won record or wrong lifecycle transition was demonstrated.
- **Evidence:** `E/projects-table-1440-light-en.png`, `project-create-1440-light-en.png`. Existing won records already appear in delivery views. Preserve that lifecycle and URL.
- **Suggested refinement, subject to owner preference:** put creation purpose at the entry/form introduction, and make the existing-record/Pipeline destination actionable where appropriate. Explain where to set PM/dates. Do not add another delivery entity or conversion wizard. This is lower priority than the confirmed handoff defects.
- **EN / ID copy:** “Already won? Open the existing project and set its manager and dates.” / “Sudah menang? Buka proyek yang ada lalu atur manajer dan tanggalnya.”; “Create a new lead or internal project” / “Buat lead atau proyek internal baru”.
- **Graduate:** `ProjectFormModal` copy/locale tests and Projects delivery navigation tests; journey opens a won record and edits PM/dates without creating another project. Matrix: Projects × won-to-delivery continuity. Document the canonical-entity guidance.

### B-08 — Indonesian navigation and system state remain partly English

**Medium · M · lenses 1/2/5 · Projects, all project tabs, My Tasks and Meetings.**

- **What breaks:** Bahasa Indonesia renders “Proyek”, “Tugas Saya” and “Rapat” alongside English breadcrumbs, system statuses such as “Ongoing Project”, “Won, Pending KoM”, “To Do”/“In Progress”, Calendar “Today”, task-sync guidance and the notification accessible label. Localized controls do not guarantee localized decision-state comprehension.
- **Evidence:** `E/projects-views-390-dark-id.png`, `project-tasks-1440-dark-id.png`, `my-tasks-390-light-id.png`, `meeting-detail-1440-light-id.png`; accessible snapshot retained the English notification label.
- **Fix:** translate system-owned labels/statuses through the shared dictionary, including accessible names and empty/recovery guidance. Do not translate user-authored project/task names or provider brands. Decide once whether domain borrowings such as Work Order/Pipeline remain approved; an English technical noun alone is not the defect.
- **EN / ID copy:** “Projects” / “Proyek”; “Meetings” / “Rapat”; “Today” / “Hari ini”; “To Do” / “Belum dimulai”; “In Progress” / “Sedang dikerjakan”; “Won — kickoff pending” / “Menang — menunggu rapat awal”; “Notifications, 0 unread” / “Notifikasi, 0 belum dibaca”.
- **Graduate:** dictionary/component locale tests for all listed system strings and accessible labels; route/state sweep in Indonesian at both breakpoints. Existing generic no-English checks must exclude user content and agreed brands. Matrix: each listed route × localized system state. Retain approved glossary decisions.

### B-09 — Persistent warning can cover phone discard-dialog actions

**Medium · S–M · lenses 2/3 · phase editing at 390×844.**

- **What breaks:** after a phase/progress warning, opening the discard confirmation leaves a persistent toast over the dialog’s lower actions. Keep editing became reliably reachable after the toast was dismissed. The protection itself works; the layered surfaces compete for the same touch area.
- **Evidence:** `E/milestone-date-discard-390-light-en.png`. This is an overlay geometry issue, not a confirmed native date-input defect or data-loss claim. Violates the responsive/modal action-accessibility intent in `DESIGN.md`.
- **Fix:** place global notifications outside the modal action footprint, suppress/reposition obsolete notifications when a blocking dialog opens, and ensure small-screen actions remain visible and tappable. Do not remove the unsaved-change guard.
- **EN / ID copy:** “Keep editing” / “Lanjutkan mengedit”; “Discard changes” / “Buang perubahan”. No extra copy can substitute for fixing the overlap.
- **Graduate:** toast/ConfirmDialog integration test and a 390×844 persistent-warning + dirty-dialog visual/geometry test; assert action centers are unobscured and pointer/keyboard actions work. Matrix: phase modal × dirty-dialog overlay geometry; shared-modal regression sweep.

### B-10 — Phase controls expose implementation concepts without explaining their consequence

**Medium · S · lenses 1/3/4/5 · Overview → phase/progress form.**

- **What breaks:** the delivery overview speaks in phases while the create modal uses milestone wording. Numeric Weight, sort/position and PM progress override invite decisions without explaining how they affect aggregate progress or task-derived progress. The trial phase and 25% override persisted, but the user must infer the model.
- **Evidence:** `E/milestone-create-390-light-en.png`, `milestone-edit-390-light-en.png`; the latter shows the 25% entry. Persistence was checked in the browser after saving. The issue is guidance, not an assertion that the progress calculation is wrong.
- **Fix:** use consistent “phase” naming where the object is a delivery phase; explain relative weights and optional overrides. Hide advanced ordering behind a simple Position label or an appropriate reorder affordance. Do not relabel relative weights as percentages without a deliberate model change.
- **EN / ID copy:** “New phase” / “Fase baru”; “Relative weight” / “Bobot relatif”; “Higher weight gives this phase more influence on total progress.” / “Bobot lebih besar memberi fase ini pengaruh lebih besar pada progres total.”; “PM progress override (optional)” / “Progres yang ditetapkan PM (opsional)”; “Leave blank to use linked-task progress.” / “Kosongkan untuk menggunakan progres tugas terkait.”
- **Graduate:** `MilestoneFormModal`/`MilestoneStrip` label/help tests in both locales; retain `AC-DEL-022-milestone-journey.spec.ts` and add task-derived versus explicit override verification at the lowest sufficient layer. Matrix: Overview × comprehensible progress model.

### B-11 — Creating an empty draft budget asks for an unnecessary second confirmation

**Medium · S · lenses 2/3 · Budget → New version.**

- **What breaks:** after entering the version label and clicking create, the user must confirm another dialog even though this creates an empty editable draft, not the active financial baseline. This spends the user’s confirmation attention before the consequential activation step.
- **Evidence:** `E/budget-create-confirm-1440-light-en.png`; contrast `budget-activate-confirm-1440-light-en.png`.
- **Fix:** create the reversible draft with one save and a clear result. Keep activation/archive confirmation when consequential; do not generalize “fewer clicks” into removing financial review.
- **EN / ID copy:** “Create draft version” / “Buat versi draf”; “Draft created. Add budget lines.” / “Draf dibuat. Tambahkan baris anggaran.”
- **Graduate:** `ProjectBudget.test.tsx`/`BudgetTab.test.tsx`: one create intent causes one draft write, no extra modal; activation still requires explicit confirmation. Matrix: Budget × routine versus consequential confirmation.

### B-12 — Active PMO budget and unavailable ERP projection need a clearer combined result

**Medium · M · lenses 1/4/5 · active Budget / ERP projection.**

- **What breaks:** Finance successfully activates the version, then encounters an unavailable external projection/link state. The screen mixes a completed PMO business action with failed/unavailable integration work. Immediately after activation the recovery display was less helpful; retry became visible after reload. A reviewer should not need reload or technical inference to decide whether the baseline is active.
- **Evidence:** `E/budget-active-1440-light-en.png`, `trial-budget-390-dark-id.png`, `executive-budget-1440-dark-en.png`. Do not claim a permanent absence of Retry, or that the activation itself failed.
- **Fix:** state PMO success separately from ERP projection readiness; show the valid recovery next action immediately, with last attempt/status and a direct project-link/setup path where applicable. Disable only unavailable external work, not the usable active-budget view.
- **EN / ID copy:** “Budget active in PMO. ERP projection is not ready yet.” / “Anggaran aktif di PMO. Proyeksi ERP belum siap.”; “Link ERP project” / “Hubungkan proyek ERP”; “Retry projection” / “Coba ulang proyeksi”.
- **Graduate:** `BudgetProjection.test.tsx` and budget activation component tests for immediate active+projection-unavailable render and subsequent retry; test reload is not required to see the appropriate recovery. Matrix: Budget × independent business/integration outcomes. Record the status-language distinction.

### B-13 — Calendar entries have weak project scent

**Medium · S · lenses 1/3/5 · `/projects?view=calendar`.**

- **What breaks:** the month entry visible in the Indonesian phone capture is the generic phase name “Procurement”, without a visible project name/code. Clicking correctly opens the project, but a user deciding which project needs attention must first drill in or rely on hover/accessibility metadata. This is not the old “unclickable calendar” criticism.
- **Evidence:** `E/projects-calendar-390-dark-id.png`, `projects-calendar-1440-light-en.png`; verified calendar-to-project click.
- **Fix:** show short project identity plus phase name in the event, and explain that the calendar represents phase target dates. Preserve the canonical project destination; do not add a competing project-calendar route.
- **EN / ID copy:** “Phase target dates” / “Tanggal target fase”; “Select a phase to open its project.” / “Pilih fase untuk membuka proyeknya.”; event pattern “PRJ-… · Procurement” / “PRJ-… · Pengadaan”.
- **Graduate:** calendar event render test includes visible project identity; retain calendar link journey; visual sample with multiple projects sharing phase names. Matrix: Projects Calendar × entity scent before drill-in.

### B-14 — Phone work-order creation is below a large summary stack

**Medium · S · lenses 2/3 · `/projects/:id/work-orders` at 390×844.**

- **What breaks:** contract/headroom/drawdown summaries consume the entry viewport before the Work orders heading and New work order action. Those metrics are useful, but the PM who arrived to create the next order has to scroll to find the lever.
- **Evidence:** `E/project-work-orders-390-light-en.png`, `work-order-table-390-light-en.png`, `work-order-record-390-dark-id.png`. Phone record cards fit the body; no global horizontal overflow was observed.
- **Fix:** lead the tab with Work orders and its primary action; keep compact headroom adjacent, and collapse/detail the rest below. Preserve the financial context rather than deleting it. This is tab-specific action placement, not a reopened common-header finding.
- **EN / ID copy:** “New work order” / “Work order baru”; “Contract headroom” / “Sisa nilai kontrak”.
- **Graduate:** extend `AC-BWO-004-work-order-billing-geometry.spec.ts` or a scoped visual test: at phone width the tab heading/action precede the extended summaries and remain unobscured. Matrix: Work orders × adjacent next action.

### B-15 — Billing-line creation requires an ERP identifier without a selection path

**Medium · M–L · lenses 3/4/5 · Billing → Add line.**

- **What breaks:** the form asks for an ERP item identifier alongside description/unit/quantity/rate. There is no rendered item-search selection path explaining what code to use. The project’s ERP link was also unavailable/unset, but that observation does not establish that project linking is a prerequisite for global item lookup. The reviewer inspected and closed the form; no invalid item submission or invoicing failure is claimed.
- **Evidence:** `E/billing-line-create-1440-dark-id.png`, `project-billing-1440-light-en.png`. For Finance’s billing-preparation job, identifier recall is extra work and a likely correction loop.
- **Fix:** use a validated ERP-item picker when the catalog is available; explain the item-code source and actual catalog availability requirement when unavailable. Do not invent a project-link prerequisite. Retain manual entry only as a clearly labelled supported path, not the only unexplained route. Make quantity/rate units explicit. Item-catalog integration may need a separately scoped feature.
- **EN / ID copy:** “ERP item code” / “Kode item ERP”; “Search invoice items” / “Cari item invoice”; “Use the item code from your ERP item catalog.” / “Gunakan kode item dari katalog item ERP Anda.”
- **Graduate:** `BoqItemFormModal.test.tsx` for connected picker/unavailable guidance and valid selection; curated line-to-billing journey only if the catalog integration is in scope. Matrix: Billing × identifier discovery/readiness. Do not move a simple copy assertion into heavy e2e.

### B-16 — Budget repeats the selected version/status/total before the useful content

**Low · S · lenses 1/3 · Budget tab, especially phone.**

- **What breaks:** the selected budget summary and the version editor repeat version/status/total in adjacent cards. On a small screen this pushes the line items and reviewer controls down without adding a distinct decision.
- **Evidence:** `E/project-budget-1440-dark-en.png`, `project-budget-390-light-en.png`, `trial-budget-390-dark-id.png`. Applies inside the budget tab; yesterday’s common-header simplification remains accepted.
- **Fix:** use one compact selected-version header with status/total/actions; retain separate projection/actual information only where it answers a different question.
- **EN / ID copy:** “v1 · Delivery baseline · Active” / “v1 · Baseline pelaksanaan · Aktif”; use the actual user-entered version name unchanged.
- **Graduate:** component assertion for one selected-version summary plus phone visual baseline. Matrix: Budget × nonduplicated decision context.

### B-17 — Budget action styling has a different hierarchy from sibling record actions

**Low · S · lenses 1/2 · active Budget actions.**

- **What breaks:** Archive/Clone are bespoke colored text actions, unlike the neutral shared record-action treatment in neighboring screens. Warning-colored Archive looks like an outstanding financial warning rather than a deliberate secondary action, making the page’s status/action distinction less consistent.
- **Evidence:** `E/budget-active-1440-light-en.png`, `executive-budget-1440-dark-en.png`. `DESIGN.md` reserves the blue accent for action/selection and distinguishes status color from action hierarchy; use the shared outline/ghost primitives instead of new visual semantics.
- **Fix:** adopt shared neutral secondary actions with consistent sizing/focus states; keep the consequential confirmation, and reserve destructive emphasis for the dialog where appropriate.
- **EN / ID copy:** “Archive version” / “Arsipkan versi”; “Clone to revise” / “Salin untuk revisi”.
- **Graduate:** budget action component test plus light/dark visual snapshot and keyboard-focus check. Matrix: Budget × shared action hierarchy. Retain token identity; no new aesthetic.

## Cross-area patterns and follow-up

1. **Saved is not handed off.** Budget draft, work-order review and meeting action all demonstrate the same intent gap: a persisted entity is not a person’s actionable next job. Coordinate with approval/inbox work; do not add unrelated ad-hoc notification mechanisms.
2. **Business state and integration state are different.** Active budget versus unavailable ERP projection; usable local tasks versus disconnected ClickUp. Shared wording/components should make that distinction. Other areas should be checked for the same pattern, not assumed defective from this review.
3. **Primary task first, context adjacent.** The common project header is now better. Task sync and phone work-order summaries still precede the lever. Apply the same decision-relevance principle inside tabs, without another shell rewrite.
4. **One entity, one home.** Four project views and eight tabs correctly converge on the same record. Meeting actions correctly create real tasks. Improve previews/links/navigation while preserving those successes.
5. **Personal-work navigation should follow assignment, not a narrow role label.** The PM/Engineer difference is concrete here. Coordinate with dashboard/navigation owners before adding redundant task homes.
6. **Localization must include states and accessible names.** Shared statuses, breadcrumbs, calendar controls and notification labels are good portfolio-level candidates. Brand/domain borrowings require a glossary decision, not blanket English-word removal.
7. **Overlay geometry belongs to shared regression coverage.** The toast/discard collision is observed here; shared toast/dialog ownership should graduate it once and sweep other modal routes afterward.
8. **Confirmation budget is finite.** Reserve it for activation, issuance, archive and dirty discard; avoid training users to confirm routine empty-draft creation automatically.

### Graduation/acceptance contract

This document is the **only repository artifact written by this pass**. No tests, matrix cells or design notes were edited because app-code changes and additional documents were out of scope. The test/matrix/retention entries above are proposed graduation work, **not claims of completed regression coverage**.

Route fixes to the UI implementer; scope B-02 and external-item lookup explicitly with the Director. For each accepted finding: first add the binding failing test at the lowest sufficient layer, fix the application without weakening current tests, add its `routes × oracles` cell and retention note, and re-render the demonstrated state at the affected breakpoints/themes/locales. Capture actual after screenshots against this evidence. Close any preference-only item the owner declines instead of laundering it into a correctness requirement.

**Overall assessment: fix-then-ship.** No confirmed Critical defect from this pass. Highest value is closing accountable handoffs, not more generic polish. Existing reviewer separation, canonical project routing, working task writes, protected minutes and yesterday’s visual improvements must survive the fixes.
