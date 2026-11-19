---
status: proposed
date: 2026-11-20
---

# ADR-0103 — Work orders on the cost side: an optional work order and discipline on every cost source

- **Issue:** #2517 (map #2516, contractor field operations). Foundation for #2518 (work-order page), #2519 (plan vs
  actual) and #2523 (stock per work order).
- **Spec:** `docs/specs/work-order-cost-attribution.spec.md`. **Plan:** `docs/plans/2026-11-20-work-order-cost-attribution.md`.
- **Migrations:** `0950_cost_disciplines.sql`, `0951_work_order_cost_attribution.sql`, `0952_timesheet_week_attribution.sql`.
- **Relates to:** ADR-0080 (work orders bill the client — revenue side, unchanged), OD-WO-2 (a work order is the
  client's scope grant, not procurement), ADR-0016/0017/0018/0019, ADR-0058 (outbox; untouched).

## Context

Work orders were revenue-side only: the client's PO for a scoped activity, billed against (0193, 0262, 0337). Only
PO variations (0474) and time-and-materials claims (0516, 0680) referenced a work order from the cost side. A
contractor runs a project as several work orders and needs to see what each one costs, by discipline. Purchases,
stock issues, timesheets and equipment usage linked only to the project.

## Decision

1. **Attribution, not a new cost model.** Seven cost sources gain two nullable columns, `work_order_id` and
   `discipline_id`: purchase requests, purchase orders, goods receipts, vendor bills, timesheet lines, stock documents
   and equipment usage entries. A cost with neither is a **project-level** cost, exactly as before. OD-WO-2 stands:
   a work order still is not a purchase; a cost is merely *attributed* to the scope it was spent on.
2. **The database decides what is allowed, for every writer.** One trigger function (`check_cost_attribution`) on
   all seven tables refuses (SQLSTATE `23514`, a `COST_*:` message):
   - a work order on another project or another org (`COST_WO_PROJECT`);
   - a work order on a record with no project (`COST_WO_NO_PROJECT`) — a stock receipt, adjustment or count, or a
     transfer to a warehouse that is not a project site;
   - a *newly* named cancelled work order (`COST_WO_CANCELLED`) — a row already on it keeps it;
   - a discipline that is not the org's, or is archived, when newly named (`COST_DISCIPLINE`).

   The cost's project is its own `project_id` (timesheet line, equipment usage, stock issue/return), the destination
   **site** warehouse's project (stock transfer: stock bought for the project moves to the work order when it goes
   to that work order's site), or the purchase's project (the four purchase records). A purchase cannot move to
   another project while one of its records names a work order of the old one (same shape as 0699's journal guard).
3. **One write path for people: `set_cost_attribution(source, ids, work_order, discipline)`.** It runs after the
   record exists, so **no create function, status transition, approval, posting or ERP command changes**. Admin,
   Executive, Finance and Project Manager may correct any record of their org; anyone else only their own record
   while it is still theirs to edit (own Draft timesheet, own Draft/Rejected equipment entry, own stock movement,
   own purchase). Every change is audited per record. The timesheet grid is the one exception: its single Save
   already writes the lines, so `save_timesheet_week` (0952) carries `work_order_id`/`discipline_id` per line — a
   line that names neither keeps what it had, so older callers behave as before.
4. **A posted stock document stays immutable except these two columns** (0951 §4). A movement posts on create, so
   its storekeeper attributes it right after; quantities, values and the ledger never change.
5. **One read seam: `work_order_cost_lines`** (security_invoker view): one row per cost record by source, with the
   project, work order, discipline, date, reference and (hours/equipment) quantity. Each source's own RLS decides
   what a caller sees. Money is deliberately not in it — each source keeps its money behind its own read; #2519
   builds plan vs actual on top. The repository exposes it grouped by source (`workOrderCostRepository.costLinesBySource`).
6. **Disciplines are an org-defined list** (`cost_disciplines`: code + name, soft-archived, Admin-kept, every active
   member reads it).

## Consequences

- Project totals are unchanged: no total reads the new columns (pgTAP AC-WCA-006 compares committed spend and actuals
  before and after attribution).
- Attribution is two steps for most forms (create, then attribute). A refusal never undoes the record: the form says
  "saved, but the work order or discipline was not set" and why, and never offers a retry that would duplicate it.
- A record-only purchase or a voided bill refuses attribution through its existing guard — a locked record stays locked.
- A timesheet row is one project's week (unique key `timesheet, project, date` is unchanged), so all of a row's lines
  share one work order. Splitting one day's hours across two work orders of one project is a follow-up.
- A transfer is checked against the site's project when it is written; a later change to a warehouse's project does
  not re-check old transfers.
- The ERP mirrors never set these columns, so an inbound mirror write is never refused by this rule.
- Reversal: `supabase/migrations/rollback/0952_…_down.sql`, `0951_…_down.sql`, `0950_…_down.sql`, in that order.
