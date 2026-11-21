# Spec: Material issued against progress, with a mismatch warning (#2674)

**Status:** proposed, Phase 1. Map #2516. Target 15 December 2026. IDs `FR-MIP-###`, `NFR-MIP-###`, `AC-MIP-###`, `OQ-MIP-#`.
Plan: `docs/plans/2026-11-21-material-issued-vs-progress.md`. Executor: Orca worker. It reads the stock ledger and adds one org setting; it posts nothing and changes no stock-ledger rule, so it is not in the money-path tier.

## Job story

When material is issued to a work order, I want to compare the issued share with the progress share, so that over-issue is noticed early.

## Context (checked against `origin/dev`, 21 Nov 2026)

Everything needed already exists; this ticket adds one derived read, one setting and one banner.

- **Planned material per work order and item**: `mrq_plan_quantity(work_order, item)` (1001, rule OQ-MRQ-1): the BoQ material allowances (`boq_material_allowances.planned_quantity`, 0417) of the BoQ lines the work order carries (`work_order_lines`, 0337), prorated by the share of each BoQ line's quantity the work order holds. No allowance gives 0. `work_order_plan_lines` (0997) holds money and hours only, no material quantity, so it is not used.
- **Issued per work order and item**: `get_work_order_stock_balance(work_order, null)` (1031, standalone ledger) returns `issued_qty` per item and location, already net of returns (`kind in ('issue','return')`, 1102 lets a return inherit its issue's work order). Quantities come back as text. Value is role-gated there; this ticket uses quantity only, so no money is read or shown.
- **Progress per work order**: the work-order page's overall percent is value-weighted (BoQ rate x quantity) from allocated contract lines against Confirmed acceptances (`pmo-portal/src/lib/workOrderProgress.ts`, FR-WORP-020). The daily site report adds validated quantities per work-order line (`dsr_progress_lines`, status `validated`, not superseded, not archived; 1040/1041; used the same way by the performance-indices spec).
- **Where it shows today**: the stock held for a work order is read by `pages/stock/WorkOrderStockBalance.tsx` (project work-order card, behind the stock expander). The record page `pages/work-order-detail/` has no stock section.
- **Settings home**: org-wide settings tables are one row per organisation, written by an Admin-only definer function (`org_three_way_match_settings`, 1018). #2686 owns `material_request_settings`; this ticket does not touch it and adds its own table.

## Definitions (the ruling this spec makes)

**Issued share** of an item on a work order = net issued quantity / planned quantity, as a percent. It is computed **per item, by quantity**, in the item's own unit. Net issued is issues minus returns to that work order.

**Progress share** of the work order = one percent, value-weighted over its allocated contract lines: for each line, done quantity is the greater of the Confirmed accepted quantity and the validated daily-report quantity, capped at the allocated quantity; progress = sum(rate x done) / sum(rate x allocated) x 100. It is the page's shipped percent, with validated daily quantities counted so the figure is current between acceptances (OQ-MIP-1).

**Gap** = issued share minus progress share, in percentage points. An item **warns** when the gap is strictly greater than the organisation's threshold.

Why per item and by quantity: planned material exists only as an item quantity (the BoQ allowance), in different units (metres, bags, kilograms), so a work-order-wide share by quantity would add unlike units. A work-order-wide share by value needs a planned price, and no planned price exists (allowances carry none; issue value is the ledger's moving cost and may be zero-cost client stock or hidden from the role). Per item by quantity needs only data that exists, shows which item is ahead, and shows no money. The work order's own summary is "N items ahead of progress", never a blended percent (a second blended formula would invite the argument OQ-WOS-2 already avoided).

Only **ahead** warns (issued share above progress share): the ticket's worry is over-issue. Material issued behind progress is normal (bulk is issued early only when it is a problem, late is a delivery matter). OQ-MIP-2 asks whether behind should also warn.

## Requirements (EARS)

**Setting**
- FR-MIP-001 The system shall hold one optional divergence threshold per organisation: a percentage-point figure from 0 to 100 with at most two decimals, or unset. It is unset for every organisation until an Admin sets it.
- FR-MIP-002 Where the threshold is unset, the system shall compute and show no comparison, no warning and no banner anywhere (default off).
- FR-MIP-003 When an Admin saves the threshold, the system shall store it, stamp who and when, and write one audit row with the before and after value. Only an Admin may save it; any other role is refused by the database. Clearing the figure turns the feature off again.

**Read**
- FR-MIP-010 The database shall expose one read for a work order returning the threshold, the progress share, and one row per item that has a planned quantity or a net issued quantity: item, unit, planned quantity, net issued quantity, issued share, gap and a warn flag. Quantities are decimal strings; shares and the gap carry one decimal.
- FR-MIP-011 The progress share shall be as defined above, and shall be absent (not zero) when the work order has no allocated lines or a line has no rate.
- FR-MIP-012 An item with a net issued quantity but no planned quantity shall be listed as unplanned: no issued share, no gap, no warning (the material-request over-plan rule already covers it).
- FR-MIP-013 An item with a planned quantity and nothing issued has issued share 0 and never warns.
- FR-MIP-014 An item shall warn only when the threshold is set, the progress share is present and the gap is strictly greater than the threshold. A gap equal to the threshold does not warn.
- FR-MIP-015 The read shall only read the caller's organisation (a work order of another organisation reads as not found), and shall require an active member, as the stock balance does.
- FR-MIP-016 The read shall never write, post, block or change any stock, request, progress or money record. A warning never blocks an issue, a request or a report.

**Display**
- FR-MIP-020 Where the work order's stock balance is shown, and the threshold is set, and at least one item warns, the screen shall show a warning banner above it naming how many items are ahead of progress, with a row per warning item: item, issued share, progress share, gap. Where nothing warns the screen shall show no banner and nothing new.
- FR-MIP-021 The banner shall work on a phone (one column, items as stacked rows) and a desktop, use `DESIGN.md` tokens and the shared warning pattern, and say in words what the figures are ("issued 80% of planned, progress 40%"), never colour alone. English and Bahasa Indonesia strings.
- FR-MIP-022 Where inventory is connected to an external ERP, the stock balance already reports itself unavailable; the banner shall not show either.
- FR-MIP-023 An Admin shall set or clear the threshold in the stock setup screen, with the unit (percentage points) and a one-line explanation of the definition. Other roles do not see the control.

## Settings

| Setting | Where | Default |
|---|---|---|
| Issued-versus-progress warning threshold (percentage points, 0 to 100, or unset) | New table `work_order_stock_settings`, one row per organisation, `issue_progress_threshold_pct numeric(5,2) null`; Admin-only `set_work_order_issue_threshold`; control in stock setup | unset (off) |

## Default-off statement

A new organisation, and every existing one, has no settings row, so the threshold is unset. With no threshold the read returns no comparison, the banner never renders and the stock balance screen is byte-for-byte what it is today. No existing function, policy, trigger or screen is changed; the stock setup screen gains one panel visible to Admins only. Existing tests are untouched.

## Non-functional

- NFR-MIP-001 The read reuses `get_work_order_stock_balance` and `mrq_plan_quantity`; it does not re-derive issued or planned quantities.
- NFR-MIP-002 The read is stable and one call per work order (no per-item round trips).
- NFR-MIP-003 No client name, day count, percentage or list is coded; the threshold and all item and unit names are data.

## Acceptance criteria

| ID | Given / When / Then | Owning layer |
|---|---|---|
| AC-MIP-001 | Given an organisation with no settings row, when any member reads a work order's comparison, then the threshold is null, there are no rows and nothing warns. | pgTAP |
| AC-MIP-002 | Given an Admin, when they save 20, then the row holds 20.00, stamped, with one audit row; when they save null, then the threshold is null again. A value of -1 or 101 is refused. | pgTAP |
| AC-MIP-003 | Given a non-Admin (Finance, Project Manager, Storekeeper), when they call the save, then it is refused with 42501 and nothing changes. | pgTAP |
| AC-MIP-004 | Given allowance 100 for an item, issued 60 net of a 0 return, progress 40, threshold 10, when read, then issued share 60.0, gap 20.0, warn true. | pgTAP |
| AC-MIP-005 | Given the same data with threshold 20, when read, then gap 20.0 equals the threshold and warn is false (strict). | pgTAP |
| AC-MIP-006 | Given issued 60 and a posted return of 20 to the work order, when read, then net issued is 40, issued share 40.0. | pgTAP |
| AC-MIP-007 | Given an issued item with no allowance, when read, then it is listed as unplanned with no share and no warning. | pgTAP |
| AC-MIP-008 | Given two lines of unequal rate, one fully accepted and one with a validated daily quantity, when read, then progress is the rate-weighted percent using the greater of accepted and validated per line, capped at allocated; a draft or superseded daily report adds nothing. | pgTAP |
| AC-MIP-009 | Given a work order with no lines, when read with a threshold set, then progress is null and nothing warns. | pgTAP |
| AC-MIP-010 | Given a work order of another organisation, when read, then it fails as not found; given an anonymous caller it is refused. | pgTAP (tenancy) |
| AC-MIP-011 | Given the read ran, then no row in the stock ledger, documents, requests, daily reports or acceptances changed. | pgTAP |
| AC-MIP-012 | Given threshold unset or nothing warning, when the stock balance renders, then no banner and no extra request beyond the read. | Unit (Vitest/RTL) |
| AC-MIP-013 | Given one warning item, when the stock balance renders, then the banner names 1 item with its issued share, progress share and gap, in English and in Bahasa Indonesia, and the table below is unchanged. | Unit |
| AC-MIP-014 | Given external inventory ownership, when it renders, then no banner. | Unit |
| AC-MIP-015 | Given an Admin in stock setup, when they enter 20 and save, then the repository sends it; a non-Admin does not see the control; an out-of-range value shows a field error. | Unit |
| AC-MIP-016 | Given the threshold set and an item issued ahead of progress, when an Admin opens the project's work-order card and its stock, then the warning shows and the work order can still be edited and issued to. | E2E (one journey, written, not run in this lane) |

**Mutation notes (run by the orchestrator):** (1) change `gap > threshold` to `gap >= threshold`: AC-MIP-005 must go red. (2) remove the Admin check in `set_work_order_issue_threshold`: AC-MIP-003 must go red. (3) drop the `org_id` filter on the work order lookup: AC-MIP-010 must go red. (4) count `draft` daily reports: AC-MIP-008 must go red.

## Open questions

| ID | Question | Default taken |
|---|---|---|
| OQ-MIP-1 | Should progress count validated daily-report quantities, or only Confirmed acceptances (what the page shows today)? | Greater of the two per line, so over-issue is caught between month-end acceptances. If the owner wants the page's percent exactly, drop the daily term in the read; no schema change. |
| OQ-MIP-2 | Should an item issued well behind progress also warn? | No: only ahead warns. |
| OQ-MIP-3 | One organisation-wide threshold, or per work order? | Organisation-wide. A per-work-order override is a later column. |
| OQ-MIP-4 | Show the banner on the work-order record page as well? | Only where the stock balance shows today, as the ticket asks; the record page has no stock section. |

## Out of scope

A blended work-order share by value; blocking an issue; a notification or email; per-section shares; changing the progress formula on the page.
