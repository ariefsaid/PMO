# Spec: Tools register per crew with damage and loss report (#2581)

**Status:** proposed; owner decisions below need sign-off before build. IDs `FR-CTR-###`, `NFR-CTR-###`, `AC-CTR-###`. Plan: `docs/plans/2026-11-20-crew-tools-register.md`. Executor: Orca worker for the register, the report and the task hand-off; no money path (nothing is costed, posted or approved here), so no Director-dispatch tier. Map #2516; blocked by #2528 landing on `dev`. The crew master is on `origin/land/1215-r1` as `1035_crews_roster.sql` (renumbered from `0988` on the feature branch) and not on `dev`; the names below were re-read on `land/1215-r1` on 20 Nov and must be re-checked once it lands. Extends `docs/specs/crews-roster-attendance.spec.md` (crews) and `docs/specs/first-class-tasks.spec.md` (tasks, project optional); uses the existing `notifications` table and a per-report file table that follows the shipped `*_files` pattern (OD-CTR-5).

## Review 20 Nov

Read against `origin/land/1215-r1` (`1035_crews_roster.sql`, `0970`/`1042` people register, `0206`, `0036`, `0048`, `0447`, `0412`/`0413`) and `origin/dev` (the same files except the crew master, which `dev` does not have).

- **The people table changed name on the landing branch.** Crew members reference the shared **`public.people`** register (`0970`, extended by `1035`; read through `people_directory`), not the feature branch's `crew_workers`; the crew master is `1035`, not `0988`.
- **`held_qty` could not reach 0.** A `written_off` close took held down by the report quantity, so the plan's `held_qty >= 1` check would have refused it; it is now `>= 0` with a create/edit `>= 1` (FR-CTR-001, AC-CTR-007).
- **The task link had no home.** "Linked to the report" now names a new nullable `tasks.crew_tool_report_id` (`on delete restrict`, the `tasks.meeting_id` precedent of `0206`); #2587's record links do not include this type.
- **The task could be set Done behind the report.** FR-CTR-014/AC-CTR-014 now refuse a direct Done (`CTR_RESOLVE_REQUIRED`); only the close call sets both.
- **Photo upload happens before the report exists.** OD-CTR-5 now says the storage write policy checks organisation, role and the 4-segment path only; the report call binds the path and inserts the photo rows, so a damaged report still cannot exist without one.
- **Smaller fixes:** the file org comes from its report; a moved line must name a same-organisation crew; the reporter can close nothing (only the assignee or a crew manager, AC-CTR-008); the register's read rule matches the crew master's (OQ-CTR-4).

Open owner decision: **OQ-CTR-4** (the default is now all active members, as for crews; the old text said all roles and a narrower default in the same spec). Build note: registering `crew_tool_lines` in `record_history_config` bumps the catalog gate's hard-coded entity count from 17, and `tasks.crew_tool_report_id` must be classified in the `task` registry row.

## Job story

When a crew's hand tool breaks or goes missing, I want the field controller to report it in a few taps with a photo, so that the equipment coordinator gets a task to replace it and the crew's register shows what it really has.

## Context and boundary

- Hand tools are many, cheap, and counted, not hourly machines. The shipped candidates were weighed (OD-CTR-1):
  - `equipment_assets` (0447) carry usage entries, approval, costing, rental terms and availability metrics (#1519, #2526). A hand tool has none of these; adding the kind would put drills and spanners in machine availability and utilisation figures and in the hire-rate costing screens.
  - `stock_items` with `stock_warehouses` and the append-only stock ledger (0412, 0413) model consumables received, issued and counted by warehouse. A crew is not a warehouse, a tool is issued to a crew for months and comes back, and the single-writer ledger rule makes ad-hoc writes unacceptable.
  - So the register is a **small new table pair** that references the existing `crews` (#2528), and reuses tasks, notifications, attachments and record history. A tool that is really a machine stays an equipment asset and is not registered here.
- **Crew master names (from #2528, `1035_crews_roster.sql` on `land/1215-r1`):** `crews(id, org_id, code, name, discipline_id, field_controller_id, kind own|vendor, vendor_company_id, archived_at)`, `crew_standard_roles`, `crew_members(crew_id, worker_id references people(id), standard_role_id, valid_from, valid_to)`, `work_order_crews(work_order_id, crew_id, valid_from, valid_to)`. People are the shared `public.people` register (`0970`, extended by `1035`; menu reads go through `people_directory`). The **field controller of a crew** is the user with `crews.field_controller_id = auth.uid()` (a `profiles.id`, not a `people` id). Crew managers are `crew_can_manage()` (Admin, Executive, Project Manager), mirrored by `can('manage','crew')`.
- A **tool line** is a named tool type held by one crew with a quantity and an optional serial number (quantity 1 when a serial is given); its crew is `on delete restrict`, so a crew holding lines cannot be hard-deleted (23503 "in use").
- A report is a **fact from the field**. It reduces the crew's usable quantity at once; it does not need approval, because delay would leave the register wrong. The coordinator's task is the follow-up, not a gate.
- Replacement purchasing is out of scope. The task is the hand-off; ordering goes through procurement as it does today. No cost, value or cash is recorded here (OQ-CTR-3).

## Definitions

- **Held** quantity: units the crew was issued and has not retired. **Damaged** and **lost** quantities are the sum of open reports of that kind. **Usable** = held - damaged - lost, never negative.
- **Report kind**: `damaged` or `lost`. **Resolution**: `replaced`, `repaired`, `written_off` (set when the coordinator closes it).

## Requirements (EARS)

**Register**
- FR-CTR-001 The system shall keep tool lines per crew: tool name, optional code, optional serial number, held quantity (a whole number, at least 1 when created or edited; a `written_off` close may take it to 0, FR-CTR-014), optional note, and archive (ADR-0018).
- FR-CTR-002 A serial number shall be unique within the organisation among live tool lines; a line with a serial has quantity 1.
- FR-CTR-003 An authorized user shall add a line, change its held quantity, and move a line to another crew of the same organisation (the server refuses a crew of another organisation); each change is kept in record history with actor and time.
- FR-CTR-004 A crew's tools screen shall show each line with held, damaged, lost and usable quantities, and the crew's open reports.
- FR-CTR-005 A crew cannot be archived while it holds live tool lines (extends FR-CRW-002); a hard delete is FK-blocked while any line names it (23503). Concretely: the archive guard on #2528 is the `crews` branch of `public.guard_crew_refs()` (trigger `zz_crews_refs`), which raises `CRW_ARCHIVE_IN_USE` for open or future `crew_members` and `work_order_crews`. The tools migration replaces that function (`create or replace`, copying the `1035` body unchanged, including its `people` branch) adding a third `exists` on `crew_tool_lines` (`crew_id = new.id and archived_at is null`) to the same condition, with the same error code; it does not add a second trigger. Blocked until #2528 is on `dev`.

**Report**
- FR-CTR-006 The field controller of the crew (`crews.field_controller_id = auth.uid()`) and crew managers (`crew_can_manage()`) shall report a tool line `damaged` or `lost` with a quantity, an optional note, and, for `damaged`, one or more photos as rows of `crew_tool_report_files` in the private `crew-tool-files` bucket (OD-CTR-3, OD-CTR-5); the call inserts the photo rows from the client-supplied storage paths, so a damaged report cannot be created without one. A report date is the organisation's calendar date, not the browser's.
- FR-CTR-007 A report quantity shall not exceed the line's usable quantity; the server refuses a larger one, checking under a row lock on the line so two concurrent reports cannot both pass.
- FR-CTR-008 The report, its quantity effect, its photo rows and its coordinator task shall be created in one server call, so a report never exists without its task (OD-CTR-2).
- FR-CTR-009 The report call shall be idempotent on a client key: a retry from a poor connection creates no second report or task.
- FR-CTR-010 The reporter may add a photo or note to their own open report; they may not change its kind or quantity. A crew manager (FR-CTR-016 `.manage`) may correct the kind or quantity before the report is closed, with a reason; the usable check re-runs and the correction is audited. A report is closed only by the close act (FR-CTR-014), by the task assignee or a crew manager.

**Task and notification**
- FR-CTR-011 When a report is created, the system shall create one task named from the tool and crew (for example "Replace: <tool> x<qty> (<crew>)"), due in `task_due_days` from the organisation setting row (default 3, OD-CTR-4), linked to the report through a new nullable `tasks.crew_tool_report_id` (`on delete restrict`, following the `tasks.meeting_id` parent precedent of 0206; #2587's record links do not include this type), with the project left empty, or set to `work_orders.project_id` when the crew has exactly one `work_order_crews` row covering the report date (the #2528 exclusion constraint already allows at most one) (OQ-CTR-2).
- FR-CTR-012 The task assignee shall be the organisation's **equipment coordinator**, a user chosen in the one-row-per-organisation table `org_crew_tool_settings(org_id primary key, coordinator_id, task_due_days, updated_by, updated_at)`; `coordinator_id` must be an active profile of the same organisation, and the server refuses another organisation's user. No generic organisation settings table exists; the shipped pattern is a one-row `org_*_settings` table per feature (`material_request_settings` 1000, `org_three_way_match_settings` 1018, `org_imprest_settings` 0422), so this follows it (OD-CTR-2). When no coordinator is set, the task is created unassigned and every active user whose role can write the equipment register (Admin and Project Manager: `EQUIPMENT_REGISTER_WRITE` in `policy.ts`, mirrored server-side by the `equipment_assets` insert and update policies of 0447) is notified instead. There is no separate "equipment manager" role.
- FR-CTR-013 The system shall notify the assignee through the existing notification mechanism when the task is created, in the user's language, naming the tool, quantity, kind and crew.
- FR-CTR-014 When the task is set to Done, the system shall prompt the coordinator for a resolution; the allowed resolutions are `replaced`, `repaired` (damaged reports only) and `written_off`. Each closes the report, so its quantity leaves the open damaged or lost sum. `replaced`: held unchanged, usable rises by the report quantity (the replacement unit restores it). `repaired`: held unchanged, usable rises by the report quantity. `written_off`: held falls by the report quantity, usable unchanged. Closing happens once, in one server call that also sets the task Done, by the task assignee or a crew manager. A tool task's status is written only by that call: setting it Done directly (on the task screen or by any other path) while its report is open is refused (`CTR_RESOLVE_REQUIRED`), so a report is never left open behind a Done task.
- FR-CTR-015 A report's status shall be `open` or `closed`; an open report older than the due date shall show as overdue on the crew screen and the coordinator's task list (existing task overdue behaviour; no new job).

**Access**
- FR-CTR-016 A new entity `crewTool` shall be registered in `pmo-portal/src/auth/policy.ts` (with `policy.test.ts`) and gated by `can()`; RLS and the RPCs enforce (ADR-0016). Actions and roles:
  - `view`: all active members, the crew master's own read rule (`1035`); narrowing is OQ-CTR-4.
  - `manage` (add, edit, move, archive lines): Admin, Executive, Project Manager (the `crew_can_manage()` set; `allowUnlessViewOnly`).
  - `report`: those roles, or the user whose id equals `record.field_controller_id` of that crew.
  - `close`: those roles, or the user who is the task assignee (`tasks.assignee_id`, 0001, passed to `can()` as `record.assignee_id`).
  - `configure` (coordinator and due days): Admin and Project Manager (the register-write set).
  A field controller may report for their own crews only and may not edit lines or close reports unless also in a role above.
- FR-CTR-017 `crew_tool_lines`, `crew_tool_reports` and `org_crew_tool_settings` carry `org_id` with the `stamp_org_id` trigger and enable plus force RLS; `crew_tool_report_files` copies `org_id` from its report (the 0036 parent-stamp pattern) and every file write policy also checks the parent report is in the caller's organisation. Photos follow OD-CTR-5.

## Non-functional requirements
- NFR-CTR-001 Phone-usable: report in at most 3 taps from the crew's tools screen, targets large enough, keyboard accessible, `DESIGN.md` tokens, English and Bahasa Indonesia.
- NFR-CTR-002 A crew screen with 200 tool lines reads in one indexed query, bounded pagination.
- NFR-CTR-003 No currency amounts are stored or shown; dates are organisation calendar dates.

## Acceptance criteria and owning layer

Hand calculation: crew A holds 6 hammers. A reports 1 damaged (usable 5), then 2 lost (usable 3), then 4 damaged is refused (3 usable). Closing the damaged report as `repaired` leaves held 6 and open lost 2, so usable is 4. Closing the lost one as `written_off` makes held 4, open 0, usable 4. If instead the lost report is closed as `replaced`, held stays 6 and usable is 6.

| ID | Given / When / Then | Layer |
|---|---|---|
| AC-CTR-001 | Given the hammer example, when the three reports are made, then usable is 5, then 3, and the third is refused with the usable count. | Unit (pure quantity function) + pgTAP |
| AC-CTR-002 | Given a live line with serial S, when another line with S is saved in the same organisation, then refused; an archived line frees S. | pgTAP |
| AC-CTR-003 | Given a damaged report with a photo, when created, then exactly one report and one task exist, the task is assigned to the coordinator and one notification exists for them. | pgTAP |
| AC-CTR-004 | Given the same client key sent twice, when reported, then one report, one task, one notification. | pgTAP |
| AC-CTR-005 | Given no coordinator set, when a report is created, then the task is unassigned and each user whose role can write the equipment register (Admin, Project Manager) is notified once. | pgTAP |
| AC-CTR-006 | Given a damaged report without any photo, when created, then refused; a `lost` report without a photo is accepted. | pgTAP |
| AC-CTR-007 | Given the hammer example, when the damaged report is closed `repaired`, then held 6 and usable 4; when the lost report is then closed `replaced`, held 6 and usable 6; with `written_off` instead, held 4 and usable 4; `repaired` on a lost report and a second close are refused. | pgTAP |
| AC-CTR-008 | Given a field controller of crew A, when they report on crew B's line, edit a line, or close a report they neither manage nor are assignee of, then refused. | pgTAP |
| AC-CTR-009 | Given a user in another organisation, when they read or write lines, reports or the setting, then refused. | pgTAP |
| AC-CTR-010 | Given a crew with live tool lines, when it is archived, then refused until the lines are archived or moved. | pgTAP |
| AC-CTR-011 | Given an open report past the task due date, when the crew's tool summary is computed, then the report reads overdue and the usable figure excludes its quantity. | Unit |
| AC-CTR-012 | Given a field controller on a phone, when they report a damaged tool with a photo, then the crew screen shows the new usable count and the coordinator sees the task and notification. | E2E (one journey) |
| AC-CTR-013 | Given a damaged report of 2 with a photo, when a crew manager corrects it to 1 with a reason, then usable rises by 1 and the correction is audited; without a reason, or after the report is closed, refused. | pgTAP |
| AC-CTR-014 | Given an open tool report, when its task is set to Done directly instead of through the close call, then refused (`CTR_RESOLVE_REQUIRED`); the close call sets both in one transaction. | pgTAP |

## Errors
| Condition | Result |
|---|---|
| Quantity above usable | Field error naming usable quantity |
| Damaged with no photo | Field error ("add a photo") |
| Duplicate serial | Field error |
| Report already closed | Refused, existing resolution shown |
| Direct Done on the tool task | Refused: choose a resolution (`CTR_RESOLVE_REQUIRED`) |
| Correction after close, or without a reason | Refused |
| Offline / retry | Same client key returns the existing report |
| No coordinator set | Task unassigned; reporter sees "sent to Admin and Project Manager" |

## Owner decisions (recommended defaults, not rulings)
| ID | Decision and default | If wrong, what breaks |
|---|---|---|
| OD-CTR-1 | Hand tools are a new light register per crew (not equipment assets, not stock items). | If tools are put in equipment assets, hand-tool counts distort machine availability and costing; if in stock, issue and return paperwork slows the field. |
| OD-CTR-2 | The equipment coordinator is one organisation-level user setting (`org_crew_tool_settings.coordinator_id`); the task is assigned to them, with a fallback to notifying Admin and Project Manager users. | A wrong or absent person means reports sit unseen. |
| OD-CTR-3 | A photo is required for `damaged`, optional for `lost`. | Required for lost: field cannot report a missing tool; optional for damaged: coordinator cannot judge. |
| OD-CTR-4 | Replacement task due 3 days after the report. | Too long leaves crews short; too short is overdue noise. |
| OD-CTR-5 | Photos are rows of `crew_tool_report_files` (id, org_id, report_id on delete cascade, title, file_path, uploaded_by_id, created_at, archived_at; partial index on (report_id, created_at desc) where live), the shipped `*_files` shape of `0036_procurement_record_files.sql`. They use a new private bucket `crew-tool-files` (images only, 5 MB) with paths `{org}/{report_id}/{file_id}/{filename}`. Storage read: in-organisation. Because the object is uploaded before the report row exists, the storage write policy checks organisation, the caller's role and the 4-segment shape only, not the parent row; the report id is sent with the client key, and the report call inserts the report, its file rows and the task in one transaction, so a path is bound to the caller's own report. The file-table write policy additionally requires the parent report and the caller's field-controller/crew-manager relationship. The procurement bucket is not reused: its write policy gates on a procurement row and procurement roles. | A field controller cannot attach photos (too strict) or any member can write to others' reports (too loose), or a required photo upload is refused because its report does not exist yet. |
| OQ-CTR-1 | Does a report reduce usable at once (default) or only after the coordinator confirms? | Crews see more usable tools than they have. |
| OQ-CTR-2 | Link the task to the crew's rostered project when exactly one exists, else none. | Task not found in the project's list. |
| OQ-CTR-3 | Do we record a tool value or replacement cost? Default no. | Loss cannot be charged back; adding it later makes this a money path. |
| OQ-CTR-4 | Who may see the register: default all active members, exactly as the crew master's read rule (`1035`); should it narrow to the field controller, coordinator, project managers and admin? | Field staff see other crews' tools, or managers cannot. |

## Delivery checklist
- [ ] Owner signs OD-CTR-1..5 and answers OQ-CTR-1..4 (OQ-CTR-4's default is now the crew master's read rule).
- [ ] #2528 crew master is built first.
- [ ] Build notes: `held_qty` check is `>= 0` with a create/edit check `>= 1`; registering `crew_tool_lines` in `record_history_config` bumps the catalog gate's hard-coded entity count (17 -> 18), and `tasks.crew_tool_report_id` must be classified in the `task` registry row.
- [ ] Glossary: tool line, tool report, equipment coordinator.
