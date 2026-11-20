# Spec: Tools register per crew with damage and loss report (#2581)

**Status:** proposed; owner decisions below need sign-off before build. IDs `FR-CTR-###`, `NFR-CTR-###`, `AC-CTR-###`. Plan: `docs/plans/2026-11-20-crew-tools-register.md`. Executor: Orca worker for the register, the report and the task hand-off; no money path (nothing is costed, posted or approved here), so no Director-dispatch tier. Map #2516; blocked by #2528 (crew master). Extends `docs/specs/crews-roster-attendance.spec.md` (crews) and `docs/specs/first-class-tasks.spec.md` (tasks, project optional); uses the existing notification and shared private attachment mechanisms.

## Job story

When a crew's hand tool breaks or goes missing, I want the field controller to report it in a few taps with a photo, so that the equipment coordinator gets a task to replace it and the crew's register shows what it really has.

## Context and boundary

- Hand tools are many, cheap, and counted, not hourly machines. The shipped candidates were weighed (OD-CTR-1):
  - `equipment_assets` (0447) carry usage entries, approval, costing, rental terms and availability metrics (#1519, #2526). A hand tool has none of these; adding the kind would put drills and spanners in machine availability and utilisation figures and in the hire-rate costing screens.
  - `stock_items` with `stock_warehouses` and the append-only stock ledger (0412, 0413) model consumables received, issued and counted by warehouse. A crew is not a warehouse, a tool is issued to a crew for months and comes back, and the single-writer ledger rule makes ad-hoc writes unacceptable.
  - So the register is a **small new table pair** that references the existing `crews` (#2528), and reuses tasks, notifications, attachments and record history. A tool that is really a machine stays an equipment asset and is not registered here.
- A **tool line** is a named tool type held by one crew with a quantity and an optional serial number (quantity 1 when a serial is given).
- A report is a **fact from the field**. It reduces the crew's usable quantity at once; it does not need approval, because delay would leave the register wrong. The coordinator's task is the follow-up, not a gate.
- Replacement purchasing is out of scope. The task is the hand-off; ordering goes through procurement as it does today. No cost, value or cash is recorded here (OQ-CTR-3).

## Definitions

- **Held** quantity: units the crew was issued and has not retired. **Damaged** and **lost** quantities are the sum of open reports of that kind. **Usable** = held - damaged - lost, never negative.
- **Report kind**: `damaged` or `lost`. **Resolution**: `replaced`, `repaired`, `written_off` (set when the coordinator closes it).

## Requirements (EARS)

**Register**
- FR-CTR-001 The system shall keep tool lines per crew: tool name, optional code, optional serial number, held quantity (whole number, at least 1), optional note, and archive (ADR-0018).
- FR-CTR-002 A serial number shall be unique within the organisation among live tool lines; a line with a serial has quantity 1.
- FR-CTR-003 An authorized user shall add a line, change its held quantity, and move a line to another crew; each change is kept in record history with actor and time.
- FR-CTR-004 A crew's tools screen shall show each line with held, damaged, lost and usable quantities, and the crew's open reports.
- FR-CTR-005 A crew cannot be archived while it holds live tool lines (extends FR-CRW-002).

**Report**
- FR-CTR-006 The field controller of a crew (and users allowed to manage crews) shall report a tool line `damaged` or `lost` with a quantity, an optional note, and, for `damaged`, one or more photos through the shared private attachment mechanism (OD-CTR-3). A report date is the organisation's calendar date, not the browser's.
- FR-CTR-007 A report quantity shall not exceed the line's usable quantity; the server refuses a larger one.
- FR-CTR-008 The report, its quantity effect and its coordinator task shall be created in one server call, so a report never exists without its task (OD-CTR-2).
- FR-CTR-009 The report call shall be idempotent on a client key: a retry from a poor connection creates no second report or task.
- FR-CTR-010 The reporter may add a photo or note to their own open report; they may not change its kind or quantity (the coordinator corrects those, with history).

**Task and notification**
- FR-CTR-011 When a report is created, the system shall create one task named from the tool and crew (for example "Replace: <tool> x<qty> (<crew>)"), due in a number of days set by an organisation setting (default 3, OD-CTR-4), with the report linked and the project left empty or set to the crew's current rostered project when exactly one exists (OQ-CTR-2).
- FR-CTR-012 The task assignee shall be the organisation's **equipment coordinator**, a user chosen in settings (OD-CTR-2). When none is set, the task is created unassigned and every user holding the equipment-manager permission is notified instead.
- FR-CTR-013 The system shall notify the assignee through the existing notification mechanism when the task is created, in the user's language, naming the tool, quantity, kind and crew.
- FR-CTR-014 When the task is set to Done, the system shall prompt the coordinator for a resolution; `replaced` adds the quantity back to usable (a new held unit, or the same line restored), `repaired` clears the damaged quantity, `written_off` reduces held and clears the report. Closing a report is allowed only once and by the assignee or a user with the manage permission.
- FR-CTR-015 A report's status shall be `open` or `closed`; an open report older than the due date shall show as overdue on the crew screen and the coordinator's task list (existing task overdue behaviour; no new job).

**Access**
- FR-CTR-016 Actions (manage tool lines, report, close report, set coordinator) shall be registered in the role matrix (#902) and gated by `can()`; RLS and the RPCs enforce. A field controller may report for their own crews only and may not edit lines or close reports.
- FR-CTR-017 Tool lines, reports and the setting carry `org_id` by default, with RLS on every new table; photos follow existing private attachment access.

## Non-functional requirements
- NFR-CTR-001 Phone-usable: report in at most 3 taps from the crew's tools screen, targets large enough, keyboard accessible, `DESIGN.md` tokens, English and Bahasa Indonesia.
- NFR-CTR-002 A crew screen with 200 tool lines reads in one indexed query, bounded pagination.
- NFR-CTR-003 No currency amounts are stored or shown; dates are organisation calendar dates.

## Acceptance criteria and owning layer

Hand calculation: crew A holds 6 hammers. A reports 1 damaged (usable 5), then 2 lost (usable 3), then 4 damaged is refused (3 usable). Closing the damaged report as `repaired` returns usable to 4; closing the lost one as `written_off` makes held 4, usable 4.

| ID | Given / When / Then | Layer |
|---|---|---|
| AC-CTR-001 | Given the hammer example, when the three reports are made, then usable is 5, then 3, and the third is refused with the usable count. | Unit (pure quantity function) + pgTAP |
| AC-CTR-002 | Given a live line with serial S, when another line with S is saved in the same organisation, then refused; an archived line frees S. | pgTAP |
| AC-CTR-003 | Given a damaged report with a photo, when created, then exactly one report and one task exist, the task is assigned to the coordinator and one notification exists for them. | pgTAP |
| AC-CTR-004 | Given the same client key sent twice, when reported, then one report, one task, one notification. | pgTAP |
| AC-CTR-005 | Given no coordinator set, when a report is created, then the task is unassigned and each equipment-manager user is notified once. | pgTAP |
| AC-CTR-006 | Given a damaged report without any photo, when created, then refused; a `lost` report without a photo is accepted. | pgTAP |
| AC-CTR-007 | Given the task is Done and a resolution `repaired` is chosen, when closed, then the damaged quantity clears and usable rises by that quantity; closing twice is refused. | pgTAP |
| AC-CTR-008 | Given a field controller of crew A, when they report on crew B's line, edit a line, or close a report, then refused. | pgTAP |
| AC-CTR-009 | Given a user in another organisation, when they read or write lines, reports or the setting, then refused. | pgTAP |
| AC-CTR-010 | Given a crew with live tool lines, when it is archived, then refused until the lines are archived or moved. | pgTAP |
| AC-CTR-011 | Given an open report past the task due date, when the crew screen renders, then it shows as overdue and the usable figure excludes it. | Unit |
| AC-CTR-012 | Given a field controller on a phone, when they report a damaged tool with a photo, then the crew screen shows the new usable count and the coordinator sees the task and notification. | E2E (one journey) |

## Errors
| Condition | Result |
|---|---|
| Quantity above usable | Field error naming usable quantity |
| Damaged with no photo | Field error ("add a photo") |
| Duplicate serial | Field error |
| Report already closed | Refused, existing resolution shown |
| Offline / retry | Same client key returns the existing report |
| No coordinator set | Task unassigned; reporter sees "sent to equipment managers" |

## Owner decisions (recommended defaults, not rulings)
| ID | Decision and default | If wrong, what breaks |
|---|---|---|
| OD-CTR-1 | Hand tools are a new light register per crew (not equipment assets, not stock items). | If tools are put in equipment assets, hand-tool counts distort machine availability and costing; if in stock, issue and return paperwork slows the field. |
| OD-CTR-2 | The equipment coordinator is one organisation-level user setting; the task is assigned to them, with a fallback to notifying equipment managers. | A wrong or absent person means reports sit unseen. |
| OD-CTR-3 | A photo is required for `damaged`, optional for `lost`. | Required for lost: field cannot report a missing tool; optional for damaged: coordinator cannot judge. |
| OD-CTR-4 | Replacement task due 3 days after the report. | Too long leaves crews short; too short is overdue noise. |
| OQ-CTR-1 | Does a report reduce usable at once (default) or only after the coordinator confirms? | Crews see more usable tools than they have. |
| OQ-CTR-2 | Link the task to the crew's rostered project when exactly one exists, else none. | Task not found in the project's list. |
| OQ-CTR-3 | Do we record a tool value or replacement cost? Default no. | Loss cannot be charged back; adding it later makes this a money path. |
| OQ-CTR-4 | Who may see the register: crew field controller, coordinator, project managers, admin (default). | Field staff see other crews' tools or managers cannot. |

## Delivery checklist
- [ ] Owner signs OD-CTR-1..4, answers OQ-CTR-1..4.
- [ ] #2528 crew master is built first.
- [ ] Glossary: tool line, tool report, equipment coordinator.
