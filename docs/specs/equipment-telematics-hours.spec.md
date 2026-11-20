# Spec: Vehicle and equipment GPS hours into equipment use (#2582)

> **Review 20 Nov (checked against `origin/dev` and `origin/land/1215-r1`).** Changed: #2526 is no longer spec-only
> — it is built on `land/1215-r1` as **1032–1034** (`equipment_status_days`, statuses `ready|standby|broken|at_vendor|
> waiting_parts`), so the availability-conflict flag is a landing dependency, not a future spec. The **approved
> logged** figure had no shipped source: `work_order_cost_amounts`'s hire-rate branch takes Approved entries only, but
> `work_order_cost_amounts_unpriced` returns **every** non-archived entry and `rollupProject.hourFigures` sums it, so
> a Draft/Submitted entry's hours already appear as actual equipment hours — contrary to FR-EQU-012 ("only approved
> entries shall count in any allocation, project figure or export"). The comparison now requires that read to be
> approval-filtered, with AC-TEL-018 as the proof. "Plan remaining" was planned − **tracker** hours, which spends the
> plan on unapproved machine data and disagrees with every other "actual" on the screen; the default is now planned −
> **approved** hours, with tracker hours beside it and the tracker-vs-logged gap shown (new OD-TEL-7). FR-TEL-002
> promised "record history" for the identifier, but `equipment_assets` is not registered in
> `record_history_config` (0260) — what exists is `log_audit`; registering the table is an owner decision. AC-TEL-004
> said a re-import of the AC-TEL-003 file reports "already there" for every row, which cannot hold for its two invalid
> rows — restated for a valid file. Matching now ignores archived assets, so a retired machine's identifier cannot
> pull a reading (FR-TEL-005/006).
> **Open owner decisions:** OD-TEL-7 (remaining basis); whether `equipment_assets` joins the record-history registry;
> whether the conflict flag ships in this ticket now that #2526 is built but unlanded.

**Status:** proposed; scheduled for when a second client asks, so nothing here is built until then. Owner decisions below need sign-off first. IDs `FR-TEL-###`, `NFR-TEL-###`, `AC-TEL-###`. Plan: `docs/plans/2026-11-20-equipment-telematics-hours.md`. Executor: Orca worker for the import and comparison slices; the step that turns a reading into a usage entry writes a cost-bearing record (once approved), so it is Director-dispatched and ships alone. Map #2516. The import and proposal slices depend only on shipped work. The comparison slice reads the shipped work-order plan figures (`work_order_plan_lines`, 0997, #2519, with its plan-versus-actual screen on `dev`) and fixes that screen's equipment-hours read to count Approved entries only (AC-TEL-018); its availability-conflict flag depends on #2526 (equipment availability), which is **built on `land/1215-r1` (1032–1034) but not on `dev`**, so that flag is optional and ships only after #2526 lands. Extends `docs/specs/equipment-usage.spec.md` (#1519) and `equipment_assets` (0447); reuses the import wizard (ADR-0027, `pmo-portal/src/lib/import/`, #2530) and the dispatch pattern of ADR-0055 (see the connector bullet below). Does not replace the manual usage log, its approval, or its costing settings.

## Job story

When a machine's hours are already recorded by a tracker on the machine, I want those hours and its place to arrive against that machine and day and be compared with what we planned and what people logged, so that nobody retypes tracker data and a gap between the tracker and the logbook is visible before it reaches a cost.

## Context and boundary

- `equipment_assets` (0447) carries `code`, `name`, `default_unit`, and an `external_tier` / `external_ref` pair reserved for the ERP asset mirror (0854). That pair names the ERP's record of the asset, not the tracker's unit; this spec adds a separate tracker unit identifier (FR-TEL-001) and leaves the pair alone.
- `equipment_usage_entries` (0447) hold one entry per asset, project, day and kind (`work` or `standby`), with status Draft, Submitted, Approved or Rejected. Only Approved entries count. An entry requires a project, and may name a work order and discipline (0951). A tracker knows the machine and the day, not the project, so a tracker reading is **not** a usage entry: it is held as a **reading** and a person turns it into a Draft entry by choosing the project (FR-TEL-009).
- Approval, separation of duties (approver is not the author) and costing stay exactly as shipped (`transition_equipment_usage`, `equipment_can_approve`, and the core body most recently replaced in 0878). Imported data never enters that path as Approved.
- The planned side is the `equipment_hours` plan figure in `work_order_plan_lines` (0997, shipped, #2519): one figure per work order and optional discipline (unique on work order, discipline and kind), a non-negative number with at most 2 decimals, in hours. It is **not** per asset and not per day, so it is compared with the work order's hours in total, never asset by asset; a work order with plan figures for several disciplines has a plan equal to their sum. The plan lines are readable only by Admin, Executive, Finance and Project Manager, and the comparison inherits that. The actual side is the work order's **approved** equipment hours, defined by FR-WPVA-011 of `docs/specs/work-order-plan-vs-actual.spec.md` read with FR-EQU-012 ("only approved entries shall count in any allocation, project figure or export"). That read is incomplete today: `work_order_cost_amounts_unpriced` returns every non-archived entry as a `not-posted` line, which `rollupProject.hourFigures` sums, so this ticket also fixes it (AC-TEL-018). The daily planned reference is `equipment_status_days` from #2526: **built on `land/1215-r1` as 1032–1034, awaiting landing** — the conflict check is optional and ships only after #2526 lands (FR-TEL-015).
- Integration is through a **file import first** (the existing import wizard, a template of unit identifier, date, hours, optional place) and a **readings adapter** for a later API feed. No vendor is named, no vendor schema is assumed, and the adapter is the only place a vendor's shape may live. ADR-0055 and its adapter contract (`pmo-portal/src/lib/adapterSeam/contract.ts`: `Adapter`, `AdapterCommand`, classified `AdapterError`) are about external systems that own a domain and take commands down; their dispatch runs in the `adapter-dispatch` edge function (`supabase/functions/adapter-dispatch/`). A tracker owns no PMO domain and takes no commands, so the readings adapter does not implement `Adapter`: it reuses the dispatch pattern (a per-organisation connection, edge-function execution, `AdapterError` classes for unreachable and rejected) and keeps PMO's canonical shape as the seam. ADR candidate: **generic inbound feed adapter** (written when the first real feed is requested).
- Out of scope: live tracking, maps, routes, speed, driver identity, fuel from the tracker, maintenance alerts, and writing anything back to a tracker.

## Definitions (used by the acceptance criteria)

- **Tracker unit identifier**: the text a feed uses to name one machine (a plate, a device number). Unique per organisation across live assets, compared after trimming surrounding spaces and lower-casing (the same rule as `equipment_assets_code_live`).
- **Reading**: one tracker figure for one unit and one calendar day: engine hours that day and an optional place label. Held separately from usage entries, with its batch, and never counted in any cost or total.
- **Reading status**: `pending` (not yet acted on), `proposed` (a Draft usage entry was created from it), `dismissed` (a person chose to ignore it, with reason), `unmatched` (no asset has that identifier).
- **Engine hours (day)**: hours the engine ran that day, decimal with at most 2 places, 0 to 24. A file that holds a running meter total instead is handled by OD-TEL-2.
- **Place label**: the short text for where the machine was (a site or yard name as the feed or file states it). No coordinates are stored by default (OD-TEL-3).
- **Discrepancy**: for an asset and day, the difference between the reading's engine hours and the sum of the asset's non-archived `work` usage entries that day, in hours.

## Requirements (EARS)

**Mapping a machine**
- FR-TEL-001 The system shall let an authorized user record a tracker unit identifier on an equipment asset. Identifiers shall be unique among live assets of the organisation, compared after trimming surrounding spaces and lower-casing, and shall be written only through a server function, not by direct table update (`equipment_assets` grants INSERT/UPDATE only on its existing column list, 0447, so the new column has no client grant).
- FR-TEL-002 The identifier shall be written to an audit event (`log_audit`) and listed on the asset's screen. `equipment_assets` is **not** registered in `record_history_config` (0260), so it has no record-history strip today; adding that registration is an owner decision (it would start capturing every asset change, not just the identifier).

**Import (file first)**
- FR-TEL-003 The system shall add an **equipment readings** `ImportDescriptor` (`pmo-portal/src/lib/import/types.ts`) to the existing import wizard (#2530 generic template and failed-rows download apply): columns unit identifier, date, engine hours (day), optional place label. Rows are validated at preview with zero writes, and rows already stored are flagged at preview through the descriptor's `existingKeys`.
- FR-TEL-004 The system shall create readings through one server function, stamping the organisation, recording a batch (source `file`, file name, counts, importer, time) and matching each row to an asset by tracker unit identifier. The wizard calls the descriptor's `create` once per valid row, so the function takes a batch id the descriptor generates once per wizard session plus that row, creates the batch on its first call and keeps its counts current; the file and the feed use the same function.
- FR-TEL-005 A row with an unknown identifier shall be kept as `unmatched` with its identifier, so the user can map the machine and re-match (FR-TEL-006), and shall be counted separately in the result. Matching considers **live** assets only; an identifier that belongs only to an archived asset leaves the reading `unmatched` (it is never attached to a retired machine).
- FR-TEL-006 When a tracker unit identifier is later recorded on an asset, the system shall offer to match that organisation's `unmatched` readings with that identifier to the asset (live assets only, as FR-TEL-005).
- FR-TEL-007 Import shall be idempotent: a row whose unit identifier and date already have a reading with the same hours is reported as already there; a row with a different value for an existing identifier and date is a row error and does not overwrite (OD-TEL-4).
- FR-TEL-008 A date in the future (organisation calendar), hours outside 0 to 24, or a non-number shall be a row error naming the field. The row cap is the wizard's `MAX_IMPORT_ROWS`.

**From reading to usage**
- FR-TEL-009 The system shall let an authorized user select `pending` readings and, choosing a project (and optionally a work order and discipline on that project) for each, create a **Draft** `work` usage entry per reading with quantity equal to the engine hours, unit `hours`, by calling the shipped `save_equipment_usage(p_entry jsonb)` (0447, current body in 0878) for each reading with no entry id, so its validation, Draft status, org stamping and author (`auth.uid()`, the person who proposed it) are unchanged; when a work order or discipline is chosen, the proposal then sets them on the new Draft through `set_cost_attribution` (0951, source `equipment_usage`), which the author may do while the entry is Draft. No row is inserted into `equipment_usage_entries` directly. The reading becomes `proposed` and keeps a link to the entry.
- FR-TEL-010 An imported or proposed entry shall never be created as Submitted or Approved. It follows the ordinary submit and approve path; the approver is not its author (existing rule), so a person who proposed it cannot approve it.
- FR-TEL-011 If the asset already has a non-archived `work` entry for that project and day, the system shall not create a second one; the row reports "already logged" with the existing entry's hours, and the reading stays `pending`.
- FR-TEL-012 A user may dismiss a reading with a reason (up to 500 characters); a dismissed reading is kept, not deleted, and is excluded from the comparison.

**Comparison**
- FR-TEL-013 The system shall show, per asset and day, the reading's engine hours beside the logged hours (non-archived `work` entries, any status, with their statuses stated) and the **discrepancy**, and shall show the unlogged days (a reading and no entry) and the unreadable days (an entry and no reading) separately.
- FR-TEL-014 Where a work order has `equipment_hours` plan figures (0997), the system shall show, on the work order's plan-versus-actual section, the planned hours (the sum of its equipment_hours plan lines) beside **tracker hours** and the **approved logged hours** (FR-WPVA-011 read with FR-EQU-012; the shipped read is corrected by AC-TEL-018). Tracker hours are the engine hours of readings for an asset and day on which a non-archived `work` entry names that work order; a reading on a day where the asset's entries name more than one work order is shown as unattributed, not split. **Plan remaining is planned hours less approved logged hours** (OD-TEL-7); tracker hours stand beside it with the tracker-minus-logged gap, and are never subtracted from the plan — an unapproved tracker figure must not spend the plan. Where no plan figure exists the plan column is absent, not zero. The section is readable by the roles that read plan lines.
- FR-TEL-015 (optional, only after #2526 is on `dev`) Where `equipment_status_days` has a row, a reading with engine hours above 0 on a day whose status is `broken`, `at_vendor` or `waiting_parts` shall be flagged as a conflict. Until #2526 lands there is no flag and no status query, and nothing else in this ticket depends on it.
- FR-TEL-016 Comparison figures shall be exact decimals rounded only for display, and shall be reproducible from the underlying rows (the screen offers the day-by-day table).
- FR-TEL-017 Readings shall be excluded from every cost, allocation, project figure and export of usage; only Approved usage entries count, as today.

**Location**
- FR-TEL-018 The system shall store only the place label stated in the file or feed, and no coordinates, by default. Coordinates (one last point per day) are stored only behind an explicit organisation-level opt-in the owner enables (OD-TEL-3); the schema has no coordinate column and the template no coordinate column until that opt-in is built, and the template then carries a disclosure note. A place label is shown on the asset's day in the comparison, readable only by the usage audience (FR-TEL-021).
- FR-TEL-019 Readings (including place labels) older than the retention period shall be deleted by a scheduled `pg_cron` job, `equipment-readings-purge`, following the pattern of `clickup-webhook-inbox-purge`, `alert-send-log-purge` and `notifications-purge` (migration 0565: `cron.schedule` with a plain `delete`, a nightly slot); the default period is stated in OD-TEL-5. Both new tables and the job are entered in `docs/retention.md`, which `scripts/check-retention.mjs` enforces. Deleting a reading never deletes a usage entry created from it.

**Connector seam (later)**
- FR-TEL-020 The system shall define a **readings adapter** interface (inbound feed, not the ADR-0055 `Adapter` command contract): given an organisation's connection and a date range, it returns readings in the canonical shape (unit identifier, date, engine hours, optional place label). It shall write only through the same server function as the file import (FR-TEL-004) with source `connector` and the adapter key, so file and feed behave identically and no adapter writes a table directly. When a real adapter is requested it runs from the `adapter-dispatch` pattern. No vendor-specific adapter is part of this ticket.

**Access**
- FR-TEL-021 Actions (map identifier, import readings, propose usage, dismiss, view comparison) shall be registered in the role matrix (#902) and gated by `can()`; RLS and the server functions enforce. Import and propose are open to the roles that may create equipment usage today; the comparison and place labels are readable by Admin, Finance, Executive and Project Manager, and an Engineer reads only readings of assets for which they authored a usage entry that day. That Engineer rule is **narrower than FR-EQU-062** on purpose: FR-EQU-062 lets an Engineer read each asset's usage totals, and a reading also carries a place label, so the reading rule is the entry-scoped one.
- FR-TEL-022 Batches and readings carry `org_id` by default, with RLS on every new table. `org_id` is never read from the file or the client.

## Non-functional requirements
- NFR-TEL-001 A month of readings for 200 assets (about 6,000 rows) is read by the comparison in one indexed query per page, bounded pagination. Index on organisation, asset and date.
- NFR-TEL-002 Phone-usable for the review and propose list; `DESIGN.md` tokens; English and Bahasa Indonesia, including template headers and notes.
- NFR-TEL-003 Dates are organisation calendar dates (`equipment_org_today`), never browser time. Hours are exact decimals.
- NFR-TEL-004 File contents and place labels are never logged or sent to analytics; only counts are.
- NFR-TEL-005 The import is create-only; it never updates or deletes an existing reading or usage entry.

## Acceptance criteria and owning layer

Hand calculation for the test day: asset `LD-01` has tracker identifier `TRK-1`. Reading for 2026-03-10: 7.50 engine hours. A person logged 6.00 `work` hours that day on project P against work order W (Draft) and 1.00 on project Q (Approved). Logged total = 7.00. Discrepancy = 7.50 - 7.00 = **+0.50 h**. On 2026-03-11 the reading is 6.50 and 6.00 `work` hours are logged on project P against W (Approved). W has one `equipment_hours` plan line of 40.00 (no discipline): tracker hours attributed to W are 7.50 + 6.50 = **14.00**, approved logged **6.00** (the 2026-03-10 P entry is Draft), plan remaining = 40.00 - 6.00 = **34.00**, and the tracker gap is 14.00 - 6.00 = **+8.00**. The Draft entry is not counted in the plan figures (AC-TEL-018).

| ID | Given / When / Then | Layer |
|---|---|---|
| AC-TEL-001 | Given the test day above, when the comparison is read, then logged is 7.00, discrepancy +0.50, and the day table sums to the same. | Unit (pure function) + pgTAP (read model) |
| AC-TEL-002 | Given a work order with a 40.00 hour plan and the figures above, when its comparison is read, then planned 40.00, tracker hours 14.00, approved logged 6.00, remaining 34.00 and tracker gap +8.00 are shown; with a second plan line for a discipline of 10.00 the plan is 50.00 and remaining 44.00; with no plan line the plan column is absent. | Unit |
| AC-TEL-018 | Given one Draft and one Approved equipment entry on a work order, when the plan-vs-actual equipment hours are read, then only the Approved entry's hours are counted (the shipped read's `not-posted` line is excluded); mutation check: drop the approval filter and the Draft entry reappears, the test goes red, restore. | pgTAP + Unit |
| AC-TEL-003 | Given a file of 5 rows where 1 has an unknown identifier, 1 has hours 25 and 1 a future date, when imported, then 2 readings are created, 1 is `unmatched`, 2 fail naming their field, and the failed-rows file holds exactly the 2 failures. | Unit |
| AC-TEL-004 | Given a file of valid rows imported twice, when run again, then every row reports already there and none is created; given the same identifier and date with different hours, then the row fails and the stored reading is unchanged. | pgTAP + Unit |
| AC-TEL-005 | Given an `unmatched` reading, when the identifier is recorded on an asset and matching is accepted, then the reading is linked to that asset and counted in the comparison. | pgTAP |
| AC-TEL-006 | Given two live assets, when the second is given the first's identifier differing only in case or surrounding spaces, then it is refused; an archived asset's identifier may be reused. | pgTAP |
| AC-TEL-007 | Given a pending reading of 7.50 hours, when a user proposes it on project P, then one Draft `work` entry of 7.50 hours authored by that user exists, the reading is `proposed` and linked, and no Submitted or Approved entry was created. | pgTAP |
| AC-TEL-008 | Given a proposed entry, when its proposer tries to approve it, then refused by the existing separation-of-duties rule (`equipment_usage_transition_core` refuses an approver who is the entry's author, and the `equipment_usage_sod` table check backs it; the proposer is the author because the entry is created under the proposer's own session by `save_equipment_usage`); when another authorized approver does, it becomes Approved and only then counts in usage totals. | pgTAP (mutation-checked: relax the approver check, test must go red, restore) |
| AC-TEL-009 | Given a pending reading and an existing non-archived `work` entry for the same asset, project and day, when proposed, then no second entry is created, "already logged" reports the existing hours, and the reading stays `pending`. | pgTAP |
| AC-TEL-010 | Given readings in any status, when usage totals, allocations, project actuals and usage exports are read, then none includes a reading's hours. | pgTAP (mutation-checked) |
| AC-TEL-011 | Given a dismissed reading with a reason, when the comparison is read, then it is excluded and the reason and dismisser are kept. | pgTAP |
| AC-TEL-012 | (optional, only once #2526 is on `dev`) Given a reading over 0 hours on a day the asset is `broken` in `equipment_status_days`, when the comparison is read, then it is flagged; given no status data exists, then no flag and no error. | Unit |
| AC-TEL-013 | Given a template download and a filled example, when imported, then the round trip creates the readings, and the template has no coordinate column unless OD-TEL-3 enables it. | Unit |
| AC-TEL-014 | Given readings older than the retention period, when the `equipment-readings-purge` statement runs, then they are deleted, readings within the period remain, and an entry created from a deleted reading remains; and `docs/retention.md` lists both tables and the job (the retention guard passes). | pgTAP + `check:guards` |
| AC-TEL-015 | Given a stub adapter returning canonical readings, when its sync runs, then readings are created through the same batch function with source `connector` and the adapter key, and a row the file path would refuse is refused identically. | Unit + pgTAP |
| AC-TEL-016 | Given a user in another organisation, or an Engineer with no entry on that asset and day, or a role without permission, when they read or write batches, readings or the identifier, then refused or empty. | pgTAP |
| AC-TEL-017 | Given a project manager with a month of tracker readings, when they import the file, review the unlogged days, propose three to Draft on a project and an approver approves them, then the usage totals show the three days and the comparison shows no discrepancy for them. | E2E (one journey) |

## Errors
| Condition | Result |
|---|---|
| Unit identifier not found | Reading kept as unmatched; shown "no machine has this identifier" with a link to map it |
| Identifier belongs only to an archived asset | Reading kept as unmatched (FR-TEL-005); it is never attached to a retired machine |
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
| OD-TEL-3 | Store the place label only, no coordinates. Coordinates (a last point per day) only behind an organisation-level opt-in the owner enables, with a disclosure in the template notes; not built until then. | Storing coordinates by default records where a machine, and so possibly a driver, was, which many organisations will not want; storing nothing loses a site match some will want. |
| OD-TEL-4 | Import is create-only and never overwrites a reading. A corrected figure is a dismissed reading and a new import (a different key is not needed because the old one is dismissed). | An overwrite silently changes a figure someone already proposed an entry from. |
| OD-TEL-5 | Readings are kept 90 days then deleted by the nightly `equipment-readings-purge` job; usage entries made from them stay. | Too short loses the comparison for a late-closing work order; too long keeps location history longer than needed. |
| OD-TEL-6 | A discrepancy never blocks approval; it is shown to the approver. | Blocking approval on a tracker gap would stop payment of rented hours when a tracker is offline. |
| OD-TEL-7 | Plan remaining = planned hours less **approved** logged hours; tracker hours and the tracker-minus-logged gap are shown beside it and never subtracted from the plan. | If tracker hours spend the plan, an unapproved or wrong machine figure silently shrinks a work order's headroom and the screen disagrees with every cost figure beside it; if the gap is hidden, the whole reason for comparing is lost. |
| OQ-TEL-1 | Is the working-hour record the engine-on hours or the hours worked (engine idle excluded)? Default: engine hours as stated; the template note says so. | Hours billed and hours tracked differ by idle time. |
| OQ-TEL-2 | Which projects may a reading be proposed to: any project the asset has ever been used on, or any active project? Default: any active project the proposer can see. | A reading is proposed to a project the machine never worked on. |
| OQ-TEL-3 | Should the weekly comparison feed the #2526 utilisation figure as a second source? Default: no; utilisation stays on approved usage. | Two utilisation figures that disagree. |

## Delivery checklist
- [ ] Wait for a second client to ask; then owner signs OD-TEL-1..7, answers OQ-TEL-1..3, and confirms the file columns with that client.
- [ ] Slice order: the shipped-read correction (AC-TEL-018, a plan-vs-actual fix with its own test); identifier and readings import; then proposal to Draft (alone, Director); then comparison (needs only the shipped #2519 plan lines; the status-conflict flag waits for #2526 to land); the connector interface last, with no vendor adapter.
- [ ] Glossary: reading, tracker unit identifier, place label, discrepancy.
