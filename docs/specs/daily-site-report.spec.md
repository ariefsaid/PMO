# Spec: Daily site report per work order (#1522)

**Status:** accepted by the Director, including the defaults below (2026-11-20). Revised 2026-11-20 for the contractor field-operations map (#2516). Supersedes the 2026-11-02 draft (offline-first). IDs `FR-DSR-###`, `NFR-DSR-###`, `AC-DSR-###`. Plan: `docs/plans/2026-11-20-daily-site-report.md`. Executor: Orca worker; the validation gate and revenue figure are money-adjacent, so those slices are Director-dispatched and ship alone.

**Assumes landed first:** #2517 (work order and discipline on every cost line) and #2520 (per-contract unit-rate catalogue with location-variant rates). Names below ("work-order cost-line attribution", "rate catalogue") are the contracts those tickets ship; reconcile to their final column and function names before build.

## Reconciled names (Slice 0, 2026-11-20)

- **Work-order attribution (#2517, 0951):** `work_order_id` + `discipline_id` on `equipment_usage_entries`, `timesheet_entries`, `stock_documents` and the procurement tables; the report reads equipment hours by `(project_id, work_order_id, work_date)`.
- **Rate catalogue (#2520, 0955):** `rate_catalogue_items` / `rate_catalogue_variants` (the **work location**) / `rate_catalogue_rates` (append-only, `effective_from`) / `rate_catalogue_stage_weights`. A contract item is a `work_order_lines` row whose `boq_items` line carries `catalogue_item_id` + `catalogue_variant_id`.
- **Rate for a progress line** (`dsr_line_rate`, 1005): the catalogue rate in force on the work date at the report's location (else the line's priced location, else the project default). A **sub-stage** is a stage in the catalogue's stage weights; its rate is the item rate x the stage's weight share (resolves OD-DSR-1). A line priced by hand (no catalogue item) uses its contract rate (`boq_items.rate` > 0) and has no stages. Otherwise "no rate".
- **Roles until #902 adds field-controller and QS:** enter/submit = Admin, Engineer, or the project's PM; validate/return/correct = Admin, Finance (QS stand-in), or the project's PM; revenue reads = the rate catalogue's readers (Admin, Finance, Executive, the project's PM).
- Migrations `1040_daily_site_reports.sql`, `1005_daily_site_report_rpcs.sql`.

## Job story

When a field controller finishes a day on a work order, I want to enter what was done, who and what worked, what held us up and a photo of the paper form on my phone, so that the quantity-surveyor can validate it the next day and the day's revenue for that work order is known from agreed rates, with no retyping.

## Context and boundary

- **Online first.** Offline capture follows the owner's native-app ruling (#2534) and is out of scope here. The previous draft's #1520-queue requirements (FR-DSR-003/004/005/008/011) are removed; nothing here may block a later queue, so every create call carries a client-generated `client_request_id` (idempotent retry, same pattern as `stock_documents.client_request_id`, 0413).
- One report = one work order x one work date. Existing contract-line quantities (`work_order_lines`, 0337) are the "contract items"; a **sub-stage** is a named stage of a contract item (open question OQ-DSR-1).
- Existing `progress_assessment_quantities` (0250) are cumulative month-end figures; a daily quantity is a delta and never overwrites them (carried from the previous draft, FR-DSR-007).
- Hours of people and equipment come from their own sources (timesheets 0007, equipment usage 0447, crew attendance #2528, equipment status #2526); the report **links** to them and shows them, it does not copy or replace them.
- The report is evidence plus a revenue figure. It is not an invoice, progress claim, stock posting or approval of any other record.

## Requirements (EARS)

**Capture**
- FR-DSR-001 The system shall let a user with report-entry permission create a draft report for one work order and one work date, on a phone-width screen, with the sections in FR-DSR-002 to 008.
- FR-DSR-002 The report shall record **progress**: zero or more lines of (contract item on the work order, optional sub-stage, quantity done that day, unit). Quantity is finite and positive; the unit is the contract item's unit.
- FR-DSR-003 The report shall record **working hours** for the day (start, end, total) and zero or more **idle periods**, each with minutes and a reason picked from an organisation-managed idle-reason list (Admin-maintained, archivable, seeded with a neutral default set).
- FR-DSR-004 The report shall record **weather** as a choice from an organisation-managed list (e.g. clear, rain, heavy rain) with an optional note.
- FR-DSR-005 The report shall record **consumables used**: zero or more lines of (stock item, quantity, unit) as a record of use. It shall not post stock; issuing stock stays in the stock module (`stock_documents`, 0413).
- FR-DSR-006 The report shall show **equipment hours** for the work order and date by reading equipment usage entries (0447) attributed to that work order and date, and shall let the user add a missing usage entry through the equipment-usage create interface (draft only).
- FR-DSR-007 The report shall show **people hours** for the work order and date from crew attendance/timesheet entries (#2528) read-only; this spec never creates timesheet hours.
- FR-DSR-008 The report shall hold one or more **photos of the paper form** and other photos as attachments through the shared private attachment mechanism; a draft may be saved without a photo, and validation requires at least one (OD-DSR-4).
- FR-DSR-009 The system shall let a user save a draft repeatedly; a draft is editable by its author and by users with report-entry permission on the work order's project until it is submitted for validation.

**Revenue**
- FR-DSR-010 The system shall compute each progress line's **daily revenue** = quantity x the rate in force for that contract item, sub-stage and work location on the work date, from the rate catalogue (#2520), as exact decimals. When no rate exists the line shall show "no rate" and contribute nothing, and the report shall list it as an unrated line.
- FR-DSR-011 The rate used shall be **frozen on the line when the report is validated** (rate id and amount), so later catalogue changes do not change validated history. A draft shows the live rate.
- FR-DSR-012 The report shall show its total daily revenue and, per work order, the sum of validated reports to date next to the work order's contract value.

**Validation**
- FR-DSR-013 When the author submits a draft, the report shall move to `submitted` and show in the QS validation queue; status values are `draft`, `submitted`, `validated`, `returned`.
- FR-DSR-014 When a user with the validate permission validates a submitted report, the report shall become `validated` with validator and time; only validated reports count toward revenue and progress figures (FR-DSR-012) and dashboards.
- FR-DSR-015 The validator shall not be the report's author (server-enforced SoD, ADR-0019); where only one eligible user exists the report stays `submitted` and the queue says so. No sole-user exception.
- FR-DSR-016 When a validator returns a report, a reason is required, the report goes to `returned`, and the author may edit and resubmit; the reason and each transition are kept in history.
- FR-DSR-017 The validation queue shall list submitted reports oldest first, with work order, date, author, total revenue and unrated-line count. **Next-day** is a target, not a block: a report submitted after the day shows "due" with its age (OD-DSR-3).
- FR-DSR-018 A validated report is immutable. A correction is a new report version created by an authorized user (admin or validator) with a reason, which supersedes the earlier one for figures; the earlier one stays visible.
- FR-DSR-019 There shall be at most one non-superseded report per work order and work date.

**Access and lists**
- FR-DSR-020 The system shall register report actions (view, enter, submit, validate) with the role matrix (#902); the new "field controller" role may enter and submit for work orders in its crews' scope but not validate (OD-DSR-5). `can()` gates the UI; RLS and RPC enforce.
- FR-DSR-021 Lists shall filter by project, work order, date range and status, newest first with a stable tie-breaker, bounded pagination. Archive follows ADR-0018.

## Non-functional requirements

- NFR-DSR-001 Works at 320 CSS pixels, keyboard and screen-reader labels, `DESIGN.md` tokens, shared form primitives, English and Bahasa Indonesia complete.
- NFR-DSR-002 `org_id` seam, RLS on every new table, indexes on (work_order_id, work_date) and status. Photos follow existing private attachment access.
- NFR-DSR-003 Money is exact decimal (`exactDecimal`), never float; dates are project-local calendar dates.
- NFR-DSR-004 Create and submit calls are idempotent on `client_request_id`.

## Acceptance criteria and owning layer

| ID | Given / When / Then | Layer |
|---|---|---|
| AC-DSR-001 | Given a work order with two contract items, when a field controller saves a draft with progress, hours, an idle reason, weather and consumables, then it saves as `draft` and reopens unchanged. | Unit (form) + pgTAP (insert/RLS) |
| AC-DSR-002 | Given a contract item not on the report's work order, when saved, then the server rejects it and no report line exists. | pgTAP |
| AC-DSR-003 | Given quantity 10 at a rate of 5 for that location and date, when viewed, then daily revenue is 50 exact; with 0.1 x 3 lines the total has no float error. | Unit |
| AC-DSR-004 | Given no rate for an item, when viewed, then the line shows "no rate", counts as unrated and adds 0. | Unit |
| AC-DSR-005 | Given a submitted report, when its own author tries to validate, then the server refuses; another eligible user can. | pgTAP (+ mutation check) |
| AC-DSR-006 | Given a validated report, when the catalogue rate later changes, then the report's revenue is unchanged; a draft shows the new rate. | pgTAP |
| AC-DSR-007 | Given draft and submitted reports and one validated, when work-order revenue to date is read, then only the validated one counts. | pgTAP |
| AC-DSR-008 | Given a validator returns a report with a reason, when the author edits and resubmits, then it is `submitted` again and history lists return and resubmit. | pgTAP + Unit |
| AC-DSR-009 | Given a validated report, when anyone edits it directly, then the write is refused; a correction creates a superseding version and revenue uses only that one. | pgTAP |
| AC-DSR-010 | Given a report exists for a work order and date, when a second non-superseded one is created, then it is refused. | pgTAP |
| AC-DSR-011 | Given equipment usage entries on the work order and date, when the report opens, then equipment hours are shown from them and consumables post no stock document. | Unit + pgTAP |
| AC-DSR-012 | Given a user in another organisation or without the permission, when they read or write a report, then access is refused and no photo link is exposed. | pgTAP |
| AC-DSR-013 | Given a field-controller user on a 320px phone, when they photograph the paper form, fill the report and submit, then it reaches the QS queue with the photo attached; a validate action is not offered to them. | E2E (one journey) |
| AC-DSR-014 | Given a repeated create call with the same `client_request_id`, when sent twice, then one report exists. | pgTAP |
| AC-DSR-015 | Given reports across dates and statuses, when filtered and paged, then only matching reports appear in stable order. | Unit + pgTAP |

## Errors

| Condition | Result |
|---|---|
| Item not on work order, non-positive quantity, unknown idle reason | Field error; nothing saved |
| Second report for same work order and date | "A report exists for this date" with a link |
| Validate by author or without permission | Refused with reason; stays `submitted` |
| No eligible validator | Shows "waiting for a validator" in the queue |
| Photo upload fails | Draft kept; photo shows retry |

## Director-accepted defaults

| ID | Decision and default | If wrong, what breaks |
|---|---|---|
| OD-DSR-1 (OQ) | **Sub-stage** is a per-contract-item list of named stages that the rate catalogue (#2520) can price separately. Default: an organisation list per contract item, optional. | Items priced by stage cannot be rated; if the catalogue has no stage concept, revenue falls back to the item rate. Confirm with #2520. |
| OD-DSR-2 | Validators: QS role (new permission on an existing role set) and Project Manager; field controller cannot. | A field controller self-validating inflates revenue. |
| OD-DSR-3 | Next-day validation is a target with an "overdue" flag, not a hard block. | A hard block stalls revenue on a missed day. |
| OD-DSR-4 | A photo of the paper form is required to validate, not to save a draft. | Requiring it to save blocks entry on a bad connection. |
| OD-DSR-5 | Field controller entry scope = work orders where their crews (#2528) are rostered. | Wider scope lets anyone report on any work order. |
| OD-DSR-6 | Consumables are a usage record only; stock issue stays separate. | Auto-posting changes stock and valuation before the keeper checks. |
| OD-DSR-7 | Revenue uses the rate in force on the work date at the work location, frozen at validation. | Using the latest rate restates validated history. |

## Delivery checklist

- [x] Director accepts OD-DSR-1..7 defaults; reconcile #2517/#2520 names.
- [ ] Migrations in the number range the Director assigns at build; reversible, with rollback.
- [ ] Server slice (tables, RPCs, pgTAP, mutation check on SoD) ships alone; screen slice follows.
- [ ] One E2E journey, `scripts/ux-proof.sh` on touched routes, 320px render review.
