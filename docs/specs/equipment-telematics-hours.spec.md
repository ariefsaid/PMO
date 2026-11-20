# Spec: Vehicle and equipment GPS hours into equipment use (#2582)

**Status:** proposed; scheduled for when a second client asks, so nothing here is built until then. Owner decisions below need sign-off first. IDs `FR-TEL-###`, `NFR-TEL-###`, `AC-TEL-###`. Plan: `docs/plans/2026-11-20-equipment-telematics-hours.md`. Executor: Orca worker for the import and comparison slices; the step that turns a reading into a usage entry writes a cost-bearing record (once approved), so it is Director-dispatched and ships alone. Map #2516; blocked by #2526 (equipment availability, for the planned-versus-actual comparison) and #2519 (equipment hours plan per work order) for the comparison slice only; the import slice depends only on shipped work. Extends `docs/specs/equipment-usage.spec.md` (#1519) and `equipment_assets` (0447); reuses the import wizard of `docs/specs/field-data-import-templates.spec.md` (#2530) and the adapter model of ADR-0055. Does not replace the manual usage log, its approval, or its costing settings.

## Job story

When a machine's hours are already recorded by a tracker on the machine, I want those hours and its place to arrive against that machine and day and be compared with what we planned and what people logged, so that nobody retypes tracker data and a gap between the tracker and the logbook is visible before it reaches a cost.

## Context and boundary

- `equipment_assets` (0447) carries `code`, `name`, `default_unit`, and an `external_tier` / `external_ref` pair reserved for the ERP asset mirror (0854). That pair names the ERP's record of the asset, not the tracker's unit; this spec adds a separate tracker unit identifier (FR-TEL-001) and leaves the pair alone.
- `equipment_usage_entries` (0447) hold one entry per asset, project, day and kind (`work` or `standby`), with status Draft, Submitted, Approved or Rejected. Only Approved entries count. An entry requires a project, and may name a work order and discipline (0951). A tracker knows the machine and the day, not the project, so a tracker reading is **not** a usage entry: it is held as a **reading** and a person turns it into a Draft entry by choosing the project (FR-TEL-009).
- Approval, separation of duties (approver is not the author) and costing stay exactly as shipped (`transition_equipment_usage`, `equipment_can_approve`). Imported data never enters that path as Approved.
- The planned side is the `equipment_hours` plan figure per work order (`work_order_plan_lines`, 0997, #2519). That figure is a total per work order, not per day; the daily planned reference is the machine's availability status (#2526). Where either does not exist yet the comparison shows only the figures that do (FR-TEL-013).
- Integration is through a **file import first** (the existing import wizard, a template of unit identifier, date, hours, optional place) and a **connector adapter interface** for a later API feed. No vendor is named, no vendor schema is assumed, and the adapter interface is the only place a vendor's shape may live (ADR-0055: PMO's canonical model is the seam).
- Out of scope: live tracking, maps, routes, speed, driver identity, fuel from the tracker, maintenance alerts, and writing anything back to a tracker.

## Definitions (used by the acceptance criteria)

- **Tracker unit identifier**: the text a feed uses to name one machine (a plate, a device number). Unique per organisation across live assets.
- **Reading**: one tracker figure for one unit and one calendar day: engine hours that day and an optional place label. Held separately from usage entries, with its batch, and never counted in any cost or total.
- **Reading status**: `pending` (not yet acted on), `proposed` (a Draft usage entry was created from it), `dismissed` (a person chose to ignore it, with reason), `unmatched` (no asset has that identifier).
- **Engine hours (day)**: hours the engine ran that day, decimal with at most 2 places, 0 to 24. A file that holds a running meter total instead is handled by OD-TEL-2.
- **Place label**: the short text for where the machine was (a site or yard name as the feed or file states it). No coordinates are stored by default (OD-TEL-3).
- **Discrepancy**: for an asset and day, the difference between the reading's engine hours and the sum of the asset's non-archived `work` usage entries that day, in hours.

## Requirements (EARS)

**Mapping a machine**
- FR-TEL-001 The system shall let an authorized user record a tracker unit identifier on an equipment asset. Identifiers shall be unique among live assets of the organisation (case and space insensitive) and shall be written only through a server function, not by direct table update.
- FR-TEL-002 The identifier shall be audited in record history and shall be listed on the asset's screen.

**Import (file first)**
- FR-TEL-003 The system shall add an **equipment readings** descriptor to the existing import wizard (#2530 generic template and failed-rows download apply): columns unit identifier, date, engine hours (day), optional place label. Rows are validated at preview with zero writes.
- FR-TEL-004 The system shall create readings through one server function that takes the whole batch, stamps the organisation, records a batch (source `file`, file name, counts, importer, time) and matches each row to an asset by tracker unit identifier.
- FR-TEL-005 A row with an unknown identifier shall be kept as `unmatched` with its identifier, so the user can map the machine and re-match (FR-TEL-006), and shall be counted separately in the result.
- FR-TEL-006 When a tracker unit identifier is later recorded on an asset, the system shall offer to match that organisation's `unmatched` readings with that identifier to the asset.
- FR-TEL-007 Import shall be idempotent: a row whose unit identifier and date already have a reading with the same hours is reported as already there; a row with a different value for an existing identifier and date is a row error and does not overwrite (OD-TEL-4).
- FR-TEL-008 A date in the future (organisation calendar), hours outside 0 to 24, or a non-number shall be a row error naming the field. The row cap is the wizard's `MAX_IMPORT_ROWS`.

**From reading to usage**
- FR-TEL-009 The system shall let an authorized user select `pending` readings and, choosing a project (and optionally a work order and discipline on that project) for each, create a **Draft** `work` usage entry per reading with quantity equal to the engine hours, unit `hours`, through the same validation as `save_equipment_usage`. The new entry's author is the person who proposed it. The reading becomes `proposed` and keeps a link to the entry.
- FR-TEL-010 An imported or proposed entry shall never be created as Submitted or Approved. It follows the ordinary submit and approve path; the approver is not its author (existing rule), so a person who proposed it cannot approve it.
- FR-TEL-011 If the asset already has a non-archived `work` entry for that project and day, the system shall not create a second one; the row reports "already logged" with the existing entry's hours, and the reading stays `pending`.
- FR-TEL-012 A user may dismiss a reading with a reason (up to 500 characters); a dismissed reading is kept, not deleted, and is excluded from the comparison.

**Comparison**
- FR-TEL-013 The system shall show, per asset and day, the reading's engine hours beside the logged hours (non-archived `work` entries, any status, with their statuses stated) and the **discrepancy**, and shall show the unlogged days (a reading and no entry) and the unreadable days (an entry and no reading) separately.
- FR-TEL-014 Where a work order's `equipment_hours` plan figure exists (#2519), the system shall show for that work order the planned hours beside the tracker hours and the approved logged hours for the assets in its usage, over the work order's usage dates; where no plan figure exists the plan column is absent, not zero.
- FR-TEL-015 Where asset status exists (#2526), a reading with engine hours above 0 on a day whose status is `broken`, `at_vendor` or `waiting_parts` shall be flagged as a conflict. Where it does not exist, no flag is shown.
- FR-TEL-016 Comparison figures shall be exact decimals rounded only for display, and shall be reproducible from the underlying rows (the screen offers the day-by-day table).
- FR-TEL-017 Readings shall be excluded from every cost, allocation, project figure and export of usage; only Approved usage entries count, as today.

**Location**
- FR-TEL-018 The system shall store only the place label stated in the file or feed, not coordinates, unless the owner enables coordinates (OD-TEL-3). A place label is shown on the asset's day in the comparison, readable only by the usage audience (FR-TEL-021).
- FR-TEL-019 Readings (including place labels) older than the retention period shall be deleted by a scheduled job; the default period is stated in OD-TEL-5. Deleting a reading never deletes a usage entry created from it.

**Connector seam (later)**
- FR-TEL-020 The system shall define a **readings adapter** interface: given an organisation's connection and a date range, it returns readings in the canonical shape (unit identifier, date, engine hours, optional place label). It shall write only through the same batch function as the file import (FR-TEL-004) with source `connector` and the adapter key, so file and feed behave identically and no adapter writes a table directly. No vendor-specific adapter is part of this ticket.

**Access**
- FR-TEL-021 Actions (map identifier, import readings, propose usage, dismiss, view comparison) shall be registered in the role matrix (#902) and gated by `can()`; RLS and the server functions enforce. Import and propose are open to the roles that may create equipment usage today; the comparison and place labels are readable by Admin, Finance, Executive and Project Manager, and an Engineer reads only readings of assets for which they authored a usage entry that day (mirrors FR-EQU-062).
- FR-TEL-022 Batches and readings carry `org_id` by default, with RLS on every new table. `org_id` is never read from the file or the client.

## Non-functional requirements
- NFR-TEL-001 A month of readings for 200 assets (about 6,000 rows) is read by the comparison in one indexed query per page, bounded pagination. Index on organisation, asset and date.
- NFR-TEL-002 Phone-usable for the review and propose list; `DESIGN.md` tokens; English and Bahasa Indonesia, including template headers and notes.
- NFR-TEL-003 Dates are organisation calendar dates (`equipment_org_today`), never browser time. Hours are exact decimals.
- NFR-TEL-004 File contents and place labels are never logged or sent to analytics; only counts are.
- NFR-TEL-005 The import is create-only; it never updates or deletes an existing reading or usage entry.

## Acceptance criteria and owning layer

Hand calculation for the test day: asset `LD-01` has tracker identifier `TRK-1`. Reading for 2026-03-10: 7.50 engine hours. A person logged 6.00 `work` hours that day on project P (Draft) and 1.00 on project Q (Approved). Logged total = 7.00. Discrepancy = 7.50 - 7.00 = **+0.50 h**. Planned: the work order on project P has an `equipment_hours` plan of 40.00; tracker hours for its assets over its usage dates are 7.50 + 6.50 = **14.00**, approved logged **1.00**, plan remaining against tracker hours **26.00**.

| ID | Given / When / Then | Layer |
|---|---|---|
| AC-TEL-001 | Given the test day above, when the comparison is read, then logged is 7.00, discrepancy +0.50, and the day table sums to the same. | Unit (pure function) + pgTAP (read model) |
| AC-TEL-002 | Given a work order with a 40.00 hour plan and the figures above, when its comparison is read, then tracker hours 14.00, approved logged 1.00 and remaining 26.00 are shown; with no plan figure the plan column is absent. | Unit |
| AC-TEL-003 | Given a file of 5 rows where 1 has an unknown identifier, 1 has hours 25 and 1 a future date, when imported, then 2 readings are created, 1 is `unmatched`, 2 fail naming their field, and the failed-rows file holds exactly the 2 failures. | Unit |
| AC-TEL-004 | Given the same file imported twice, when run again, then all rows report already there and none is created; given the same identifier and date with different hours, then the row fails and the stored reading is unchanged. | pgTAP + Unit |
| AC-TEL-005 | Given an `unmatched` reading, when the identifier is recorded on an asset and matching is accepted, then the reading is linked to that asset and counted in the comparison. | pgTAP |
| AC-TEL-006 | Given two live assets, when the second is given the first's identifier (any case, extra spaces), then it is refused; an archived asset's identifier may be reused. | pgTAP |
| AC-TEL-007 | Given a pending reading of 7.50 hours, when a user proposes it on project P, then one Draft `work` entry of 7.50 hours authored by that user exists, the reading is `proposed` and linked, and no Submitted or Approved entry was created. | pgTAP |
| AC-TEL-008 | Given a proposed entry, when its proposer tries to approve it, then refused by the existing separation-of-duties rule; when another authorized approver does, it becomes Approved and only then counts in usage totals. | pgTAP (mutation-checked: relax the approver check, test must go red, restore) |
| AC-TEL-009 | Given a pending reading and an existing non-archived `work` entry for the same asset, project and day, when proposed, then no second entry is created, "already logged" reports the existing hours, and the reading stays `pending`. | pgTAP |
| AC-TEL-010 | Given readings in any status, when usage totals, allocations, project actuals and usage exports are read, then none includes a reading's hours. | pgTAP (mutation-checked) |
| AC-TEL-011 | Given a dismissed reading with a reason, when the comparison is read, then it is excluded and the reason and dismisser are kept. | pgTAP |
| AC-TEL-012 | Given a reading over 0 hours on a day the asset is `broken`, when the comparison is read, then it is flagged; given no status data exists, then no flag and no error. | Unit |
| AC-TEL-013 | Given a template download and a filled example, when imported, then the round trip creates the readings, and the template has no coordinate column unless OD-TEL-3 enables it. | Unit |
| AC-TEL-014 | Given readings older than the retention period, when the scheduled clean-up runs, then they are deleted, readings within the period remain, and an entry created from a deleted reading remains. | pgTAP |
| AC-TEL-015 | Given a stub adapter returning canonical readings, when its sync runs, then readings are created through the same batch function with source `connector` and the adapter key, and a row the file path would refuse is refused identically. | Unit + pgTAP |
| AC-TEL-016 | Given a user in another organisation, or an Engineer with no entry on that asset and day, or a role without permission, when they read or write batches, readings or the identifier, then refused or empty. | pgTAP |
| AC-TEL-017 | Given a project manager with a month of tracker readings, when they import the file, review the unlogged days, propose three to Draft on a project and an approver approves them, then the usage totals show the three days and the comparison shows no discrepancy for them. | E2E (one journey) |

## Errors
| Condition | Result |
|---|---|
| Unit identifier not found | Reading kept as unmatched; shown "no machine has this identifier" with a link to map it |
| Hours outside 0 to 24, not a number, future date | Row error naming the field |
| Same identifier and date, different hours | Row error "a reading already exists with different hours"; nothing overwritten |
| Identifier already used by another live asset | Field error naming that asset |
| Reading already logged for the project and day | Not created; "already logged" with the existing hours |
| Template out of date | Wizard's out-of-date message; nothing imported |
| Over the row cap | Existing over-cap refusal |
| Feed unreachable (connector, later) | Classified as an external error with retry; no partial batch is kept |

## Owner decisions (recommended defaults, not rulings)
| ID | Decision and default | If wrong, what breaks |
|---|---|---|
| OD-TEL-1 | Tracker readings are held as readings and a person proposes the Draft entry, choosing the project. Default: no automatic creation of entries. | If entries were created automatically, a project manager would find hours on a project nobody chose, and approvers would approve unreviewed machine data. |
| OD-TEL-2 | The file carries engine hours for the day. A running meter total (needing yesterday's value) is out of scope; the template states the column meaning. | A user who pastes a meter total gets hours above 24 refused, or wrong hours accepted if under 24. A later cumulative option is additive. |
| OD-TEL-3 | Store the place label only, no coordinates. Coordinates (a last point per day) only if the owner enables them for the organisation, with a disclosure in the template notes. | Storing coordinates by default records where a machine, and so possibly a driver, was, which many organisations will not want; storing nothing loses a site match some will want. |
| OD-TEL-4 | Import is create-only and never overwrites a reading. A corrected figure is a dismissed reading and a new import (a different key is not needed because the old one is dismissed). | An overwrite silently changes a figure someone already proposed an entry from. |
| OD-TEL-5 | Readings are kept 90 days then deleted; usage entries made from them stay. | Too short loses the comparison for a late-closing work order; too long keeps location history longer than needed. |
| OD-TEL-6 | A discrepancy never blocks approval; it is shown to the approver. | Blocking approval on a tracker gap would stop payment of rented hours when a tracker is offline. |
| OQ-TEL-1 | Is the working-hour record the engine-on hours or the hours worked (engine idle excluded)? Default: engine hours as stated; the template note says so. | Hours billed and hours tracked differ by idle time. |
| OQ-TEL-2 | Which projects may a reading be proposed to: any project the asset has ever been used on, or any active project? Default: any active project the proposer can see. | A reading is proposed to a project the machine never worked on. |
| OQ-TEL-3 | Should the weekly comparison feed the #2526 utilisation figure as a second source? Default: no; utilisation stays on approved usage. | Two utilisation figures that disagree. |

## Delivery checklist
- [ ] Wait for a second client to ask; then owner signs OD-TEL-1..6, answers OQ-TEL-1..3, and confirms the file columns with that client.
- [ ] Slice order: identifier and readings import; then proposal to Draft (alone, Director); then comparison once #2519 and #2526 ship; the connector interface last, with no vendor adapter.
- [ ] Glossary: reading, tracker unit identifier, place label, discrepancy.
