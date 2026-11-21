# Material on a validated daily report posts a stock issue (DRS)

Issue #2676 (map #2516). Status: **Draft for sign-off, 2026-11-21**. Plan `docs/plans/2026-11-21-daily-report-stock-issue.md`.
IDs: `FR-DRS-###`, `AC-DRS-###`. **Money path: stock ledger.** The ledger stays written only by `stock_write_entry` (FR-STK-072);
this feature calls the unchanged engine (`stock_post_core`, `stock_insert_lines`). Ships alone. Stacked on #2693 (reservations).
Owner ruling: OD-SCOPE-8 (`docs/decisions.md`). Builds on `docs/specs/daily-site-report.spec.md` (FR-DSR-005, FR-DSR-018) and
`docs/specs/stock-site-work.spec.md` (work-order issues).

**Job story.** When the daily report is validated, I want the material it names to leave site stock, so stock and progress agree without a second entry.

**Not in this ticket.** Working material out from progress quantities when no material lines are typed (Q1 2027).

## 1. AS-IS
- A report records "consumables used": rows of (stock item, quantity, unit) in `dsr_consumables` (1040). FR-DSR-005 says it posts no stock.
- `dsr_validate` (1041) freezes rates, sets `validated`, and when the report is a correction marks the older version superseded
  (`dsr_correct`, 1041, makes the correction as a copy). Neither touches stock.
- A work order has a project but **no site location**. A stock issue to a work order exists (`stock_documents.kind='issue'` with
  `work_order_id`, 1029/1031); the engine requires an Ongoing project, a work item (`boq_item_id`) of that project on every line, a keeper
  or Admin poster, and refuses to go below zero on hand (`STK_INSUFFICIENT`, `stock_write_entry` 0413). A return cites its issue lines and
  cannot exceed them (`stock_apply_return`, 0414; work order inherited, 1102).
- Reservations (1315) hold stock for a work order but lock nothing; an issue needs no reservation hook (stock-reservations spec, decision 2c).

## 2. Design decisions
1. **Material line = the existing consumable row.** No new entry screen. "Consumables and installed material" are both rows of
   `dsr_consumables`; the ticket's two words name one list. One optional addition: `work_order_line_id` (which contract item the material
   went into), because the engine needs a work item on every issue line. Entered in the same form as progress lines.
2. **Hook = a trigger, not an edit of `dsr_validate`.** An AFTER UPDATE trigger on `daily_site_reports` fires when `status` becomes
   `validated` and calls `dsr_post_stock(report)`. It runs in the validator's transaction, so a posting failure that is *not* a shortage can
   never block validation either (see 5). `dsr_validate` is not restated.
3. **Site location is work-order data:** new nullable `work_orders.site_warehouse_id` (a site, yard or staging location of the work
   order's project, same organisation), set by the roles that may already edit a work order (Admin, Executive, Project Manager, Finance).
   No location, no posting: the report validates and is flagged `no_location`.
4. **Which items count is client data plus one setting.** `stock_items.consumable` (default false) is item data. The setting
   `dsr_stock_issue_items` is `all` (default: every item on a material line posts) or `consumables` (only flagged items post; others are
   recorded `not_stocked`, no warning, because the client chose not to stock-track them).
5. **Short stock: post nothing for that line, flag it.** The engine never lets a location go below zero (`STK_INSUFFICIENT`), and a
   negative-stock override would make every moving-average value after it wrong, so none is offered. For each line in order, on hand at the
   site location (less what earlier lines of the same report already take) is compared to the quantity: enough, post; not enough, the **whole
   line** is left unposted with `short_by` recorded (never a part quantity, so what the report says and what the ledger says are never
   silently different). Other lines still post. Any other engine refusal (project not Ongoing, item archived, location archived) is caught
   per document in a sub-transaction: nothing of it posts, the report stays validated, the reason code is recorded. Validation is never blocked.
6. **Poster identity.** The validator is a site or project person and often not the location's keeper. The report's validation is the
   authorisation, so the keeper rule is waived for this one path by a transaction-local marker set only inside `dsr_post_stock`
   (precedent: `pmo.stock_system_write`, 1312). `stock_assert_keeper` is restated with that single added clause; everything else about it is
   unchanged. The audit trail names the validator (`created_by`, `posted_by`) and the report number is in the document note.
7. **Dates.** The issue is dated the work date; if that is more than 31 days back (the engine's rule for non-Admins) it is dated the
   validation day and the note says so. The reversal is dated the validation day of the correction.
8. **Correction = reverse once, re-post.** When a correction report is validated, the older version's issued lines are returned by one
   `return` document that cites each issue line (engine cap, 0414), then the correction's lines post fresh. Reversal runs even if the
   setting has since been turned off (undoing a posting it made); re-posting only if the setting is on. If the older version posted nothing,
   nothing is reversed.
9. **Retry.** Stock arrives late. `dsr_retry_stock(report)` (validator roles) re-attempts the lines flagged `short`/`failed` of a current
   validated report; a line already posted is never posted again. It does not touch a superseded report.
10. **Idempotence lives in the database.** One `dsr_stock_postings` row per report (unique `report_id`); one `dsr_stock_posting_lines`
    row per material line (unique `consumable_id`) carrying the ledger line it posted as (unique `issue_line_id`); one reversal
    (`reversed_at` set once, guarded). Re-running the post, a retried request or a second validation call posts nothing twice.

## 3. Requirements (EARS)

**Settings and default-off**
- FR-DRS-001 The organisation shall have `dsr_stock_issue` (default off) and `dsr_stock_issue_items` (`all` default | `consumables`), changed only by an Admin through `set_dsr_stock_issue(p_on, p_items)`, audited. While off, validation, correction and every screen behave exactly as today and no row of this feature is written.
- FR-DRS-002 Where the organisation's inventory is run in a connected ERP, turning the setting on shall be refused (`STK_OWNED_BY_ERP`), as for every stock posting.
- FR-DRS-003 `work_orders.site_warehouse_id` shall accept only a non-archived site, yard or staging location of the work order's project in the same organisation (`DRS_LOCATION`); a work order of another project cannot borrow it. `stock_items.consumable` shall be editable by whoever edits the item today.

**Posting**
- FR-DRS-010 While the setting is on, when a report's status becomes `validated`, the system shall, in the same transaction, post one `issue` stock document from the work order's site location to the work order's project and work order, containing every material line that is in scope, in stock, and has a work item.
- FR-DRS-011 A line's work item shall be its `work_order_line_id`'s contract item, else the report's only progress contract item, else the work order's only contract item; if none is unique the line is unposted with state `no_work_item`.
- FR-DRS-012 If a line's quantity exceeds the stock on hand at the location (after earlier lines of the same report), then the system shall post nothing for that line, record state `short` and `short_by`, and still validate the report.
- FR-DRS-013 If the work order has no site location, then no line posts, each is `no_location`, and the report still validates. If an item is out of scope under `consumables`, its line is `not_stocked`.
- FR-DRS-014 If the engine refuses the document for any other reason, then nothing of it posts, each affected line is `failed` with the engine's reason code, and the report still validates.
- FR-DRS-015 The system shall never write the ledger directly and never allow negative stock; every ledger row comes from `stock_post_core`.
- FR-DRS-016 The posting shall be idempotent (decision 10): the same report never posts the same line twice, whatever the number of calls.
- FR-DRS-017 When a line is retried (`dsr_retry_stock`) and stock is now sufficient, it shall post in a new issue document; lines already posted are not touched.

**Correction**
- FR-DRS-020 When a correction report is validated, the system shall reverse the older version's posted issue lines with one `return` document citing them, exactly once, and then post the correction's lines as FR-DRS-010.
- FR-DRS-021 If the older version had nothing posted, then no reversal document shall be created.
- FR-DRS-022 If reversal is refused by the engine, then the correction shall still validate, the report state shall be `failed` and `reversal_pending`, and `dsr_retry_stock` shall retry the reversal before anything else posts (the new lines never post on top of an unreversed issue).

**Reading and warning**
- FR-DRS-030 `dsr_stock_status(report)` shall return the report state and, per line, state, `short_by`, posted quantity, document number; org-scoped, quantities only (no cost) for roles that may not see cost.
- FR-DRS-031 The report screen shall show a Stock section on a validated report: "Issued to stock" with the document number, or a warning listing each flagged line with its reason in words ("short by 3 at <location>", "no site location on this work order", "no work item named"), with the retry action for validators. The validation action shall show the same warning in its result. The validation queue and report list shall carry a "stock flagged" marker.
- FR-DRS-032 The work-order screen shall show and edit the site location (roles of FR-DRS-003); the item form shall show the consumable flag. Settings screen: one Admin card for FR-DRS-001.
- FR-DRS-033 All strings exist in English and Bahasa Indonesia; the screens work at 390 px and 1440 px.

**Access**
- FR-DRS-040 The two new tables grant `authenticated` SELECT only, under org RLS with `(select helper())` wrappers; every write is by the definer functions. Functions callable by clients are inventoried; internal ones are revoked from everyone.
- FR-DRS-041 The keeper waiver is valid only inside `dsr_post_stock`; a client calling `post_stock_document` or `create_stock_document` as a non-keeper is still refused.

## 4. Settings (all in organisation settings, Admin only)
| Setting | Default | Meaning |
|---|---|---|
| `dsr_stock_issue` | off | Validated reports post stock |
| `dsr_stock_issue_items` | `all` | `all` items post, or only items flagged consumable |
Data (not settings): `work_orders.site_warehouse_id`, `stock_items.consumable`, `dsr_consumables.work_order_line_id`.

## 5. Default-off
With `dsr_stock_issue` off (every existing organisation): the trigger returns at once without reading or writing anything; `dsr_validate`,
`dsr_correct`, the queue, the list and the screens are unchanged (the Stock section, the markers and the setting card are hidden or inert;
the work-order location and item flag fields appear only for an organisation with the setting on). Added columns are nullable or defaulted.
The three restated functions (`stock_assert_keeper`, `dsr_replace_lines`, `dsr_correct`) are byte-equivalent in behaviour while the marker is
unset / the new column is absent. Existing tests stay untouched.

## 6. Acceptance criteria
| ID | Criterion | Layer |
|---|---|---|
| AC-DRS-001 | Given the setting off, when a report with material lines is validated, then no document, ledger row, posting row exists and `dsr_validate` returns as before. | pgTAP |
| AC-DRS-002 | Given the setting on, a site location with 10 of item A, a report using 4 A, when validated, then one posted issue document to the work order and project, ledger -4 at the location, line state `posted`. | pgTAP |
| AC-DRS-003 | Given on-hand 3 and a line of 5, when validated, then the report is `validated`, the line is `short` with `short_by` 2, nothing posted for it, a sibling in-stock line posted, ledger never negative. | pgTAP (mutation-check) |
| AC-DRS-004 | Given no site location on the work order, when validated, then validated, every line `no_location`, no document. | pgTAP |
| AC-DRS-005 | Given `consumables` scope and an unflagged item, then its line is `not_stocked` and no warning; flagged items post. | pgTAP |
| AC-DRS-006 | Given a validator who is not the keeper, when validated, then the issue posts; and the same person calling `post_stock_document` on a draft at that location is still refused `STK_NOT_KEEPER`. | pgTAP (mutation-check) |
| AC-DRS-007 | Given an Ongoing-project rule failure (project closed), when validated, then validated, lines `failed` with `STK_PROJECT_NOT_ACTIVE`, nothing posted. | pgTAP |
| AC-DRS-008 | Given the posting trigger is fired twice for one report (and `dsr_retry_stock` called twice), then ledger rows and documents are unchanged after the first. | pgTAP (mutation-check) |
| AC-DRS-009 | Given a validated posted report corrected with 3 instead of 4 and validated, then one return document cites the old lines (ledger +4), then a new issue posts 3; net on hand = start - 3; the reversal exists once. | pgTAP (mutation-check) |
| AC-DRS-010 | Given a second reversal attempt on the same report, then no second return document and the engine cap is not exceeded. | pgTAP (mutation-check) |
| AC-DRS-011 | Given the older version posted nothing, when its correction is validated, then no return document. Given the setting turned off after the first posting, then the reversal still happens and nothing new posts. | pgTAP |
| AC-DRS-012 | Given a short line and later stock received, when `dsr_retry_stock` runs, then that line posts once and the posted lines are untouched. | pgTAP |
| AC-DRS-013 | Given material lines without a unique work item, then `no_work_item`; with `work_order_line_id` set, it posts to that item's work item. | pgTAP |
| AC-DRS-014 | Given a non-Admin, `set_dsr_stock_issue` is refused; Admin changes it with one audit row; ERP-owned inventory refuses on. | pgTAP |
| AC-DRS-015 | Given a location of another project, an archived one, or another organisation's, `site_warehouse_id` is refused `DRS_LOCATION`. | pgTAP |
| AC-DRS-016 | Given another organisation's user, then posting rows, status and documents are invisible and `dsr_stock_status` refuses. | pgTAP |
| AC-DRS-017 | Given a work date older than 31 days, then the issue is dated the validation day and still posts. | pgTAP |
| AC-DRS-018 | Given a validated report with flagged lines, the report screen shows the warning with each reason in words, in English and Bahasa Indonesia; a posted one shows the document number; with the setting off neither section nor marker appears. | Unit (Vitest/RTL) |
| AC-DRS-019 | Journey: a field controller enters material and submits; a validator validates a short line; the report is validated with the warning, stock receives, the validator retries, the warning clears and the work order's stock balance shows the use; at 390 px and 1440 px. | E2E |
| AC-DRS-020 | Given the DAL, then material lines send `work_order_line_id`, the status read maps states, and the settings card writes through the RPC only for Admin. | Unit |

## 7. Mutation notes (marked `-- mut:` in the SQL; the orchestrator runs them)
`mut:drs_on` (ignore the setting, AC-001) · `mut:drs_short` (post a short line anyway, AC-003) · `mut:drs_keeper_marker` (leave the waiver on after the call, or drop the marker check so any caller bypasses, AC-006) · `mut:drs_idem_posting` / `mut:drs_idem_line` (drop the unique guards or the already-posted early return, AC-008) · `mut:drs_reverse_once` (reverse twice, AC-009/010) · `mut:drs_reverse_before_post` (post the new lines before the reversal, AC-009) · `mut:drs_scope` (ignore `consumables`, AC-005) · `mut:drs_location_check` (drop the location validation, AC-015) · `mut:drs_org` (drop the org filter of the read, AC-016).

## 8. Open questions for the owner
1. The keeper waiver (decision 6) is the one place a stock rule is relaxed. Alternative: the posting stays Draft until a keeper posts it; slower, and "stock and progress agree without a second entry" then fails. Recommended: waive.
2. A part quantity for a short line (post what is there) is refused by decision 5; confirm whole-line-or-nothing.
3. A multi-item work order with no `work_order_line_id` and several progress items leaves material `no_work_item`; recommended default (never guess the cost allocation).
