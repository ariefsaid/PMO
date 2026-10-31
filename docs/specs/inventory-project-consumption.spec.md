# Spec: Inventory and project consumption (#1512, route item T1)

> **Status:** Draft for owner sign-off, 2026-10-31. Author: spec worker, no live owner interview; every owner choice is
> an **Open question** below with the default this spec takes. Nothing here is built until the owner signs the spec
> and the proposed [ADR-0094](../adr/0094-pmo-standalone-erp-route.md).
> **Route:** map #1481, [`docs/plans/2026-10-30-epc-odoo-build-route.md`](../plans/2026-10-30-epc-odoo-build-route.md) item T1.
> Decision tickets that set scope: #1487 (material consumption), #1485 (ownership split), #1486 (adapter scope),
> #1484 (Odoo coverage).
> **Binding:** ADR-0016 (FE `can()` is UX only), ADR-0017 (repository seam), ADR-0018 (soft archive), ADR-0019
> (server-enforced SoD), ADR-0055 + ADR-0059 + ADR-0094 (ownership), ADR-0058 (outbox, applies to #1508 only),
> ADR-0070 (rank, not role lists), ADR-0010 (test pyramid).
> **Executor:** money tier (stock valuation) → Director-dispatched, every slice, through Orca workers (§12).
> **Ids:** `FR-STK-###`, `NFR-STK-###`, `AC-STK-###`, rulings `OQ-STK-n`. (`INV` is taken by the invites spec.)
> **Migrations:** none reserved. Each slice takes the next free number when it starts (`scripts/renumber-migration.sh`
> on collision); one is moving (billing kinds renumbers to 0410 at the time of writing).
> **Out of this spec:** connected-ERP posting and reconciliation (#1508), Odoo master data (#1504), offline queue
> (#1520), daily site report (#1522). Their seams are specified in §6.

## 0. Open questions for the owner (each with the default taken)

**Owner sign-off, 2026-10-31:** spec approved with all ten defaults (OQ-STK-1..10); ADR-0094 approved.

Defaults let a builder start; a different answer changes only the slice named.

| # | Question | Default taken | Slice touched |
|---|---|---|---|
| OQ-STK-1 | "Consumption vs BoQ": a BoQ line is a priced work item (e.g. "concrete pour, 50 m³"), not a material. What quantity does material usage compare against? | An explicit **material allowance** per BoQ line and item (planned quantity, set by PM / QS / Finance). A line with no allowance shows issued quantity only and is never flagged. No inference from item codes. | S5 |
| OQ-STK-2 | Who may move stock? Built-in roles have no storekeeper. | A **keeper assignment** per warehouse (Admin assigns users). A user posts receive / transfer / issue / return only on a warehouse they keep; Admin may post on any (audited). Today's site storekeeper is the built-in Engineer role (the #902 interim). Replaced by the #902 role × scope matrix when it ships. | S1, S2 |
| OQ-STK-3 | Does standalone issue value change project actuals / budget vs actual? | **No.** Consumption value is shown beside committed spend, never added to it (a PO already counts as committed spend; adding stock value would count the same money twice). Connected: #1508 posts the project cost to the ERP ledger and defines how it reaches actuals. | S5 |
| OQ-STK-4 | Transfer central → site: one step (stock moves at once) or two (in transit until the site confirms receipt)? | **One step**, poster keeps the source warehouse. In-transit adds a state, a "lost in transit" path and a second actor; add as a follow-up if loss in transit is a real pain. | S2 |
| OQ-STK-5 | Valuation method. | **Moving average per item per warehouse.** Stock stays out of FIFO layers (no lot trace). ERPNext and Odoo both offer it, so #1508 reconciles like with like. | S2 |
| OQ-STK-6 | Issue when system stock is too low (site used cement before the receipt was keyed). | **Refuse** (`STK_INSUFFICIENT`) with the shortfall shown. Offline captures that fail on sync land in #1520's "Needs fixing" list with this reason. Negative stock would make valuation and the reorder basis meaningless. | S2 |
| OQ-STK-7 | Issue beyond the material allowance. | **Allow and flag** "over allowance" in the report and on the issue's confirmation. No block, no approval: a site must not stop for paperwork. | S5 |
| OQ-STK-8 | Reorder suggestion inputs. | Usage window 90 days; safety 7 days; order cycle 30 days; lead time per item, 14 days when unset. Constants in one SQL function, no settings screen in v1. | S6 |
| OQ-STK-9 | Does a stock receipt advance the procurement case or check per-line quantities? | **No.** A receipt may cite a procurement case for traceability; case status stays on the shipped Goods Receipt path. Per-line goods-receipt matching is the deferred OD-PROC-2 / spine gap 11 prerequisite. | S2 |
| OQ-STK-10 | Units: controlled list or free text; conversions (bag ↔ kg)? Who sees unit cost? | A small **org unit list** with a "whole numbers only" flag, **no conversions** (one base unit per item). Quantities visible to all active members; unit cost and value to Project Manager and above (rank ≥ 20, ADR-0070). | S1, S2 |

**Dependency, not a question:** ADR-0094 is *Proposed*. This spec's ownership model (§6) restates it; the owner approving
this spec without ADR-0094 leaves §6 resting on an unsigned decision.

## 1. Problem and job stories

The prospect cannot say how much material a project used in a month, who issued it, or when to reorder: nothing records
stock after goods are received. Procurement stops at a header-only Goods Receipt (`procurement_receipts`, 0006); no table
holds an item, warehouse or stock movement (verified: `scripts/prior-art.sh` for inventory, warehouse, stock, reorder,
consumption finds none; roadmap spine gap 11 records the domain as missing).

- **Storekeeper.** When goods arrive or site crews draw material, I want to record the movement in a few taps against
  the right project and work item, so stock on hand is true and nobody argues about who took what.
- **Project manager / QS.** When the month closes, I want consumption per project, item and period against what each
  BoQ work item should use, so I can answer "how much cement did Project X use in October" and spot overuse.
- **Finance / head office.** When I review stock, I want quantities and value per warehouse and a trail from receipt to
  issue, so I can trust the figures and approve write-offs from a count.
- **Procurement.** When stock runs low, I want a reorder level suggested from real usage, so purchase requests start
  before a site stops.

## 2. Scope

**In (standalone mode, PMO authority):** units, items, central and site warehouses, warehouse keepers; documents for
**receive, transfer, issue, return, adjustment, count**; an append-only stock ledger and balances with moving-average
valuation; stock-on-hand, movement trace, **consumption by project / item / period against BoQ allowance**,
**reorder suggestions from usage**; authorization, SoD, audit; idempotent, replay-safe writes for the offline capture in
#1520; the connected-mode seams in §6.

**Out:** posting to, or reading from, any ERP (#1508, #1504); the ledger / GL (ADR-0048 stands); lot, batch, serial or
expiry tracking; unit conversions; in-transit state (OQ-STK-4); landed cost, manufacturing / BoM, barcode scanning;
automatic purchase requests (a suggestion never creates spend); per-line goods-receipt matching (OQ-STK-9); period
closing; user-defined roles (#902 / R1: the actions register in its matrix when it lands); equipment and fuel (T8);
daily site report UI (#1522); assistant (agent) tools over stock.

## 3. Domain terms (add to `docs/glossary.md` in slice S1; names here are the canonical ones)

- **Stock item** — a material the organisation holds and tracks by quantity. Has a code, name and one base unit. Not a
  procurement line (`procurement_items` is free text) and not a BoQ line.
- **Unit** — a base unit of measure on an org-owned list (bag, m, kg …) with a "whole numbers only" flag. No conversion.
- **Warehouse** — a place that holds stock: **central** (head-office store) or **site**. Not a PMO Entity, not a project.
- **Keeper** — a user assigned to a warehouse who may record its stock movements.
- **Stock document** — one recorded movement event with a system-assigned number: **Receive**, **Transfer**,
  **Issue**, **Return**, **Adjustment**, **Count**. Posted documents are immutable; a mistake is corrected by a later
  document, never an edit. Distinct from the **Goods Receipt** procurement record, which stays header-only.
- **Stock ledger entry** — one signed quantity-and-value line per item and warehouse written when a document posts.
  Append-only. The ledger is the trace.
- **On hand** — quantity and value of an item at a warehouse now: the sum of its ledger entries (kept in a balance row).
- **Moving-average cost** — value on hand ÷ quantity on hand at the moment of a stock-out.
- **Work item** — a BoQ line (`boq_items`). **Every issue names a project and a work item** of that project.
- **Material allowance** — the planned quantity of an item for a work item.
- **Consumption** — net quantity (and value) of an item taken to a project work item: issues minus returns, by period.
  It is operational and is **not** committed spend or an ERP actual (§6, OQ-STK-3).
- **Reorder level / suggestion** — the on-hand quantity at which an item should be reordered at a warehouse; a
  *suggestion* is computed from past usage and only a person turns it into a level.

## 4. Shipped work this extends (verified at `origin/dev` 4acce5091, 2026-10-31)

| Reused | Where | How |
|---|---|---|
| BoQ work item | `boq_items` (0250; `line_no`, `import_key`, `earning_basis` from 0337) | An issue's work item is a `boq_items` row of the issue's project. Same-project check follows `check_boq_item_work_order_same_project` (0250 §2). `boq_items` is not altered. |
| Contract scope | `work_order_lines` (0337) | Not touched. Consumption can be filtered by work order through the BoQ line's allocations later; v1 does not. |
| Procurement | `procurements`, `purchase_orders`, `procurement_receipts` (0001, 0035, 0006), `advance_procurement_on_record` (0362) | A receipt cites `procurement_id` (nullable). No change to the procurement state machine, receipts or items. |
| Numbering | `next_procurement_doc_number(org, prefix)` (0006, definer, internal-only) | Reused for document numbers (`RCV`, `TRF`, `ISS`, `RTN`, `ADJ`, `CNT`) or a sibling with the same shape, so numbers are gap-tolerant and collision-free (OD-PROC-3). |
| Tenancy / RLS | `stamp_org_id`, `auth_org_id()`, `is_active_member()`, FORCE RLS, column-level grants (0250 pattern) | Every new table. |
| Rank and SoD | `role_rank()` (0178; Admin 50 > Executive 40 > Finance 30 > Project Manager 20 > Engineer 10), ADR-0070, ADR-0019 | Adjustment / count approval and cost visibility by rank. No new role lists in predicates. |
| Audit | `log_audit` (0076) | Master-data changes and Admin override posts. |
| Ownership switch | `external_domain_ownership`, `domain_externally_owned()`, `operator_set_domain_ownership` (0087) | Domain key `inventory` (§6). The table takes any domain text; `PmoDomain` is `string` (`adapterSeam/contract.ts`). |
| Adapter seam | `adapterSeam/contract.ts`, `dispatch.ts`, `capabilityMap.ts`, `external_refs` (0088), ADR-0058 outbox | Not changed here; #1508 uses them. |
| Reporting precedent | `org_current_month` and `organizations.default_timezone` (0245) | Month boundaries in the org's timezone. |
| Cost visibility precedent | NFR-CAT-003 (cost-attribution spec): sensitive values narrowed to spend-approval rank | Unit cost and value narrowed the same way. |
| UI pattern | Companies slice (`pages/Companies.tsx`, `src/lib/db/companies.ts`), repositories (`src/lib/repositories/`), `can()` (`src/auth/policy.ts`), `MASTER_DATA_ROLES` (`src/auth/coarseRoles.ts`) | Screens, repository, policy entities for stock. |

## 5. Contract (stable: slices build against this; column names are the plan's to finalise)

All tables: `org_id` stamped by `stamp_org_id` (never sent by the client), FORCE RLS with `is_active_member()`
conjoined, column-level grants, no client INSERT / UPDATE / DELETE on tables marked *machine-written*. **Cost is read
only through RPCs:** `stock_ledger` and `stock_balances` have no client SELECT grant, and `stock_document_lines.unit_cost`
is not in the SELECT column grant; the read RPCs scope by the caller's org and apply the rank gate of FR-STK-063. (Column
grants cannot differ per rank, so a rank-gated column on a client-readable table is not possible.)

| Table | Shape | Notes |
|---|---|---|
| `stock_units` | `code`, `name`, `whole_only bool`, `archived_at` | unique `(org, lower(code))` |
| `stock_items` | `code`, `name`, `description`, `unit_id`, `lead_time_days int null (0..365)`, `archived_at` | unique `(org, lower(code))`; no hard delete (ADR-0018) |
| `stock_warehouses` | `code`, `name`, `kind ('central'\|'site')`, `project_id null` (informational default for issues; **not** a restriction), `archived_at` | unique `(org, lower(code))` |
| `stock_warehouse_keepers` | `(warehouse_id, user_id)` | written by Admin only |
| `stock_documents` | `number`, `kind`, `status ('Draft'\|'Posted'\|'Cancelled')`, `warehouse_id` (receive: destination; transfer: source; issue / adjustment / count: the warehouse; return: destination), `to_warehouse_id` (transfer), `project_id` (issue, return), `procurement_id` (receive, optional), `reason`, `note`, `occurred_on date`, `client_request_id uuid null`, `created_by/at`, `posted_by/at`, `cancelled_by/at` | unique `(org, number)`; unique `(org, created_by, client_request_id)` where not null; per-kind shape enforced by CHECK / trigger |
| `stock_document_lines` | `document_id`, `item_id`, `quantity (>0, numeric(14,3))`, `unit_cost numeric(14,4) null` (receive, adjust-in), `boq_item_id` (issue), `source_line_id` (return: the issue line returned), `counted_quantity` (count), `expected_quantity` (count, stamped at post) | Draft editable; Posted immutable |
| `stock_ledger` *(machine-written, append-only)* | `document_id`, `line_id`, `item_id`, `warehouse_id`, `project_id`, `boq_item_id`, `kind`, `qty_delta (≠0)`, `value_delta numeric(14,2)`, `occurred_on`, `posted_at`, `posted_by` | no UPDATE / DELETE grant, plus a trigger refusing both; indexes on `(org, item, warehouse, posted_at)` and `(org, project_id, boq_item_id, occurred_on)` |
| `stock_balances` *(machine-written)* | `(item_id, warehouse_id)`, `qty_on_hand`, `value_on_hand` | `CHECK (qty_on_hand >= 0 AND value_on_hand >= 0)` is the backstop behind the row lock |
| `boq_material_allowances` | `boq_item_id`, `item_id`, `planned_quantity (>0)` | unique `(boq_item_id, item_id)`; BoQ line's project is the scope |
| `stock_reorder_levels` | `(item_id, warehouse_id)`, `reorder_level (≥0)`, `reorder_quantity null`, `set_by/at` | written only by accepting / editing |

Read / write RPCs (definer, `search_path` pinned, `EXECUTE` revoked from `public, anon`, registered in the repo's
definer-RPC allow-list and guard test as 0250 does): `create_stock_document` (create Draft, or create-and-post in one
call for field speed), `post_stock_document`, `cancel_stock_document`, `get_stock_on_hand`, `get_stock_ledger` (keyset
paged), `get_project_consumption`, `get_reorder_suggestions`. Errors carry a **stable code** in the message prefix for
`classifyMutationError` and #1520's "Needs fixing" list: `STK_INSUFFICIENT`, `STK_NOT_KEEPER`, `STK_OWNED_BY_ERP`,
`STK_SELF_APPROVE`, `STK_RANK`, `STK_PROJECT_NOT_ACTIVE`, `STK_BOQ_MISMATCH`, `STK_RETURN_EXCEEDS`, `STK_ARCHIVED`,
`STK_FRACTION`, `STK_BACKDATE`.

## 6. Data ownership (PMO vs ERP, ADR-0055 / ADR-0059 / ADR-0094)

ADR-0094: quantity and valuation belong to the connected ERP; **the project and work item an issue is tagged to belong to
PMO's process** ("an issue of stock records project and work item in PMO while the connected ERP owns quantity and
valuation"). The standalone schema therefore keeps the two classes of fact in separate places.

| Fact | Standalone (this spec) | Connected (#1508, not built here) |
|---|---|---|
| Item, unit, warehouse **master** | PMO | ERP-owned master, PMO read-model (#1504 maps item / unit / warehouse / location) |
| Document header, **project, work item**, actor, time, reason, `client_request_id` | PMO | **PMO stays the author** (Posture-B-like, ADR-0059): PMO row is the record; ERP receives the outcome |
| **Quantity on hand, valuation, unit cost, ledger value** | PMO (`stock_balances`, `stock_ledger`) | **ERP** (Posture A for these columns): PMO tables become a machine-written copy, shown with freshness |
| ERP posting status of a document | n/a | a side-mirror table created by #1508 (ADR-0059 §3 invariant 7: `drop table` loses no PMO data). **Not** a status on `stock_documents`. |
| Material allowance, reorder level | PMO | PMO (planning artifacts; not ERP-native, Odoo orderpoints stay an ERP matter) |
| Consumption report | derived from PMO ledger | derived from PMO usage facts with ERP value; discrepancies shown, never hidden |

**Seam rules this slice must hold so #1508 changes no usage table:**

- **FR-STK-070 Ownership guard.** While `domain_externally_owned(org, 'inventory')` is true, `post_stock_document` and
  `create_stock_document` in post mode refuse (`STK_OWNED_BY_ERP`) before any write; reads keep working. This is the
  "no dual writers" rule: standalone authority exists only until the domain is employed. Fail closed: a guard that
  cannot read the ownership row refuses.
- **FR-STK-071 Immutable post = stable push key.** A Posted document never changes, so a future derived key
  `inv:<document_id>:<posted_at>` (ADR-0059 §4) is stable. Corrections are new documents.
- **FR-STK-072 Single writer.** Only the posting RPC writes `stock_ledger` / `stock_balances`; #1508 swaps the valuation
  source inside that one path or replaces the writer with the sync writer. No other code path touches them.
- **FR-STK-073 Live crossing.** What happens to standalone history when an org employs `inventory` is #1508's decision
  (ADR-0055 §5A epoch rule: earlier history read-only, never adopted). This spec only guarantees history stays readable
  and that employing the domain is *not* blocked by this slice; #1508 must also refuse employing while a Draft document
  exists (revenue precedent, 0262), or the Draft is stranded.
- **FR-STK-074 No ERP vocabulary.** Table, column and RPC names use PMO terms (ADR-0055 §2).

The connected posting must show an uncertain or failed ERP write honestly (ADR-0094), via the outbox (ADR-0058).
That is #1508.

## 7. Requirements (EARS)

### A. Master data

- **FR-STK-001** The system shall hold per-org units with a code, name and "whole numbers only" flag; codes are unique
  per org ignoring case.
- **FR-STK-002** The system shall hold per-org stock items with a unique code, name, one unit, and an optional lead time.
- **FR-STK-003** The system shall hold central and site warehouses, each with a unique code.
- **FR-STK-004** When an Admin assigns or removes a keeper, the system shall record it with actor and time (audit event).
- **FR-STK-005** Where a unit is flagged "whole numbers only", the system shall refuse any line quantity or count with a
  fraction for items of that unit (`STK_FRACTION`).
- **FR-STK-006** The system shall archive, never delete, items, units and warehouses; archiving an item or warehouse is
  refused while it has stock on hand; an archived item or warehouse accepts no new document line. A hard delete is
  refused while anything references the row (FK `23503`, "in use").
- **FR-STK-007** Master-data creation and changes shall be limited to the master-data roles (Admin, Executive, Project
  Manager, Finance); keeper assignment to Admin only.
- **FR-STK-008** The system shall refuse to change an item's unit once any document line references the item.

### B. Documents and posting (common)

- **FR-STK-010** The system shall mint a unique, gap-tolerant document number per org on creation.
- **FR-STK-011** When a user creates a document, the system shall create it as Draft; a create-and-post call shall do
  both atomically. A Draft may be edited by its author and cancelled by its author or an Admin.
- **FR-STK-012** When a document posts, the system shall, in one transaction: re-check every precondition in the
  database (never from the payload), lock the affected `(item, warehouse)` balance rows in a fixed order, write one
  ledger entry per affected item and warehouse, update the balances, and set `Posted`, `posted_by`, `posted_at`.
  Any failure shall roll back everything.
- **FR-STK-013** A Posted document and its lines shall be immutable, and shall not be deletable or cancellable.
- **FR-STK-014** The system shall refuse a post that would take any balance below zero (`STK_INSUFFICIENT`, naming item,
  warehouse, available and requested).
- **FR-STK-015** Where `client_request_id` is supplied, the system shall make create (and create-and-post) idempotent
  per creator: a replay returns the existing document unchanged and never writes a second ledger entry.
- **FR-STK-016** The system shall record `occurred_on` (default today in the org timezone). It shall refuse a future
  date and a date older than 31 days for anyone but Admin (`STK_BACKDATE`). `occurred_on` selects the reporting period
  only; valuation is always computed in posting order, and a backdated document never revalues earlier ones.
- **FR-STK-017** The system shall derive every cost it writes (issue value, transfer value, return value) on the server
  from the balance or the cited issue line, never from a client-supplied cost; only receive and adjust-in lines accept an
  input unit cost.

### C. The six document kinds

- **FR-STK-020 Receive.** When a Receive posts, the system shall add each line's quantity to the destination warehouse at
  the line's unit cost (required, ≥ 0). It may cite a procurement case of the same org (and the same project when the
  case has one); it shall not change that case (OQ-STK-9).
- **FR-STK-021 Transfer.** When a Transfer posts, the system shall remove each line from the source warehouse at its
  moving-average cost and add the same quantity and value to the destination in the same transaction. Source and
  destination shall differ.
- **FR-STK-022 Issue.** An Issue shall name a project and, on every line, a work item (`boq_item_id`) of that project;
  a missing or foreign work item is refused (`STK_BOQ_MISMATCH`). The project shall be an active delivery project
  (status "Ongoing Project", not archived; `STK_PROJECT_NOT_ACTIVE`). When it posts, the system shall remove stock at
  moving-average cost and write ledger entries carrying the project and work item.
- **FR-STK-023 Return.** A Return shall cite the issue line it returns (`source_line_id`) and take project and work item
  from it, not from the client. The cumulative returned quantity of an issue line shall not exceed its issued quantity
  (`STK_RETURN_EXCEEDS`). When it posts, stock re-enters at the cost the cited issue line left at.
- **FR-STK-024 Adjustment.** An Adjustment shall carry a reason. Adjust-out removes at moving-average cost; adjust-in
  adds at the line's unit cost (required when on-hand is zero, otherwise defaulting to the moving average).
- **FR-STK-025 Count.** A Count line records the counted quantity per item. When it posts, the system shall stamp
  `expected_quantity` (on hand at that instant), post the difference as one adjustment entry per line (out at moving
  average; in at moving average or, if on-hand is zero, at a required unit cost), and post nothing for zero variance.

### D. Valuation

- **FR-STK-030** The system shall value stock by moving average per item per warehouse: a stock-out's value is
  `round(quantity × value_on_hand / qty_on_hand, 2)`; a stock-in adds its value; a stock-out of the entire remaining
  quantity takes the entire remaining value, so no rounding residue stays behind.
- **FR-STK-031** For every `(item, warehouse)`, the sum of ledger quantities and values shall equal the balance row's
  quantity and value at all times (invariant, checked in tests after a mixed sequence).
- **FR-STK-032** A transfer shall conserve value: value out of the source equals value into the destination.
- **FR-STK-033** Amounts are `numeric` with the precision in §5; the system shall never use floating point for quantity or
  value (client display formats only).

### E. Reports

- **FR-STK-040 Stock on hand.** The system shall list, per warehouse and item, quantity on hand (and value for callers
  entitled to cost), filterable by warehouse, item and "below reorder level".
- **FR-STK-041 Trace.** The system shall list ledger entries for an item, warehouse, project, work item, document or
  date range, newest first, each showing document number and kind, actor, time, occurred date, warehouse, project and
  work item, quantity in / out, and running balance per `(item, warehouse)`. A document page shall show its lines and
  entries. Paging is keyset-based and stable (no silent truncation at the 1000-row API cap).
- **FR-STK-042 Consumption vs BoQ.** For a project and date range the system shall return, per work item, item and
  month (org timezone): issued, returned, **net consumed**, and value (cost-entitled callers only). For each work item
  and item with an allowance it shall also return the **cumulative net consumed to the end of the range**, the allowance
  and the variance; a row over its allowance is flagged. Per-month rows show consumption only (allowances are not
  periodised).
- **FR-STK-043** Where a work item and item have no allowance, the system shall show consumption only, no variance and no
  flag (OQ-STK-1). It shall also list items issued under a work item that has no allowance row so PMs can see what is
  unplanned.
- **FR-STK-044** Reports shall aggregate in the database (RPC), never in the browser; a report that cannot compute shall
  show an error state, never a fabricated zero.
- **FR-STK-045** A project page shall expose its consumption report; a stock page shall expose on-hand, trace and
  documents. Stock-moving screens shall be usable on a phone (NFR-STK-004).

### F. Allowance and reorder

- **FR-STK-050** A PM, Executive, Finance or Admin member shall be able to set, change and clear a material allowance
  on a BoQ line of an org project; the BoQ line's project is the scope (same-org, same-project checks).
- **FR-STK-051 Suggestion.** For an item and warehouse the system shall compute usage = issues + transfers out
  (excluding transfers to a central warehouse) − returns into that warehouse, over the trailing window, and suggest
  `level = ceil(avg_daily_usage × (lead_time + safety_days))` and
  `quantity = ceil(avg_daily_usage × order_cycle_days)` (to the unit's precision), with the constants of OQ-STK-8. It
  shall return the inputs (window used, usage, average, lead time) beside the figures.
- **FR-STK-052** Where there are fewer than 28 days of history or fewer than 3 usage movements in the window, the system
  shall return "not enough history" and no figure.
- **FR-STK-053** A suggestion shall change nothing. A level changes only when an authorised user accepts or edits it; the
  change is audited (before / after, actor).
- **FR-STK-054** The system shall list items whose on-hand is at or below their set level, per warehouse, as a worklist.
  It shall not create a purchase request or any spend.

### G. Authorization, SoD, visibility

- **FR-STK-060** Every write shall be server-enforced (definer RPC or RLS). Client roles shall have no direct write to
  documents' posted state, ledger, balances, keepers or ownership.
- **FR-STK-061** Receive, Transfer, Issue, Return: the poster shall be a keeper of the document's warehouse (source for
  Transfer) or an Admin (audited, OQ-STK-2). Otherwise `STK_NOT_KEEPER`.
- **FR-STK-062 Two-person write-off.** An Adjustment or Count with any non-zero variance shall be posted by a user who is
  not its author, with rank ≥ Project Manager (`role_rank ≥ 20`). The rule holds for Admin too (no self-approval, OD-PROC-8).
  A Count whose variances are all zero may be posted by its author.
- **FR-STK-063** A user shall see quantities for the whole org's stock; unit cost, value and any report value column
  only at rank ≥ Project Manager. The server shall omit cost fields for lower ranks (not hide them in the UI).
- **FR-STK-064** `can()` shall gate the affordances with the **real** JWT role; view-as impersonation is view-only and
  cannot post (ADR-0016). New policy entities: stock item, warehouse, stock document, allowance.
- **FR-STK-065** Org A shall never read or write org B's rows; an `org_id` or a foreign `item_id` / `warehouse_id` /
  `project_id` / `boq_item_id` / `source_line_id` in a payload shall be refused by RLS and the parent-org checks.
- **FR-STK-066** Master-data changes, keeper changes, Admin override posts and reorder-level changes shall each write an
  `audit_events` row.

### H. Offline-readiness (consumed by #1520 / #1522)

- **FR-STK-080** A queued Issue or Return replayed after reconnect shall be revalidated by the same posting rules (stock,
  project state, work item, keeper, `occurred_on` window) and either post once or fail with a stable `STK_*` code and
  the numbers needed to explain it. Replays with the same `client_request_id` never double-post (FR-STK-015).

## 8. Non-functional requirements

- **NFR-STK-001 Tenancy.** Org scope comes from the JWT and column defaults, never an argument; FORCE RLS on every table;
  pgTAP isolation proof per table.
- **NFR-STK-002 Concurrency.** Posting locks balance rows with `FOR UPDATE` in `(item_id, warehouse_id)` order, so
  concurrent posts cannot deadlock or oversell; the balance CHECK is the backstop. (pgTAP is single-session and proves the
  mechanism, not an interleaving; the plan names how the lock order is asserted.)
- **NFR-STK-003 Performance.** Stock-on-hand reads balances, not the ledger. The consumption report and trace read the
  indexed ledger. At build time, record `EXPLAIN (ANALYZE, BUFFERS)` for the report at 200k ledger rows over 20 projects;
  p95 target ≤ 1 s locally. No N+1; no row cap truncation.
- **NFR-STK-004 Phone use.** Receive, Issue and Return forms work at 360 px width, with touch targets per `DESIGN.md`,
  and the item picker searches by code or name.
- **NFR-STK-005 Accessibility.** WCAG AA; forms label every field, errors announced, lists keyboard-reachable;
  `axe-core` gate on the new routes.
- **NFR-STK-006 Reversibility.** Each migration has a rollback file; `drop table` of the stock tables loses no data
  outside the stock domain; RLS on every business table.
- **NFR-STK-007 No float.** Quantity and money never pass through JS floating arithmetic for a decision; the server
  computes them and the client formats the returned decimals.
- **NFR-STK-008 Boundary.** The inventory migration changes no existing table's shape and no existing RPC body
  (procurement, BoQ, work orders, budget). Public-repo hygiene: no tenant data, hostnames or secrets in seed or docs.
- **NFR-STK-009 Money-path hygiene.** Per `docs/money-path-primer.md`, the five failure buckets are checked in review:
  duplicate (FR-STK-015), wrong adoption (not applicable until #1508), SoD (FR-STK-061/062), tenancy (FR-STK-065), wrong
  number on screen (FR-STK-044, NFR-STK-003).

## 9. Acceptance criteria (Given / When / Then) with owning layer (ADR-0010)

Each AC has one owning test at the lowest sufficient layer, tagged with its id (pgTAP leading token; Vitest `it(...)`
title; Playwright `e2e/AC-STK-###-<slug>.spec.ts`).

| AC | Given / When / Then | FR | Owning layer |
|---|---|---|---|
| **AC-STK-001** *(the issue's acceptance)* | **Given** 100 bags of an item at a warehouse and a project with a BoQ work item, **when** a keeper issues 30 bags to that work item, **then** the warehouse shows 70; the ledger trace lists the issue with actor, time, project and work item; and the project's consumption report shows 30 consumed for that work item and month, against its allowance. | 022, 041, 042 | **E2E** (curated cross-stack journey) |
| AC-STK-002 | Given a Receive of 100 at cost 50 and a later Receive of 100 at cost 70, when 50 are issued, then the issue value is 3,000 (average 60) and value on hand is 9,000. | 030 | pgTAP |
| AC-STK-003 | Given 3 units on hand worth 100.01, when all 3 are issued, then the issue takes 100.01 and value on hand is 0.00. | 030 | pgTAP |
| AC-STK-004 | Given a mixed sequence of receive, transfer, issue, return and adjustment, then for every item and warehouse the ledger sums equal the balance row. | 031 | pgTAP |
| AC-STK-005 | Given 5 on hand, when an issue of 6 posts, then it is refused `STK_INSUFFICIENT` with available 5 / requested 6, and no ledger entry or balance change exists. | 014 | pgTAP |
| AC-STK-006 | Given a Transfer of 40 from central to a site, when it posts, then central falls by 40 and the site rises by 40 at equal value, in one transaction (a forced failure on the second leg leaves neither). | 021, 032 | pgTAP |
| AC-STK-007 | Given an Issue with no work item on a line, or a work item of another project or org, when created or posted, then it is refused `STK_BOQ_MISMATCH`. | 022, 065 | pgTAP |
| AC-STK-008 | Given a project that is not Ongoing, or archived, when an issue is posted to it, then it is refused `STK_PROJECT_NOT_ACTIVE`. | 022 | pgTAP |
| AC-STK-009 | Given an issue line of 10 and a prior return of 7, when a return of 4 is posted, then it is refused `STK_RETURN_EXCEEDS`; a return of 3 posts, restores stock at the issue's cost, and net consumption falls by 3. | 023 | pgTAP |
| AC-STK-010 | Given a client-supplied cost on an Issue, Transfer or Return line, then it is ignored or refused; the ledger value equals the server-derived value. | 017 | pgTAP |
| AC-STK-011 | Given a Posted document, when anyone (including Admin) updates a line, deletes it, cancels it, or updates / deletes a ledger row, then the write is refused. | 013 | pgTAP |
| AC-STK-012 | Given the same `client_request_id` submitted twice, then one document and one set of ledger entries exist and the second call returns the first. | 015, 080 | pgTAP |
| AC-STK-013 | Given a user who keeps warehouse A, when they post an Issue on warehouse B, then `STK_NOT_KEEPER`; an Admin may, and an `audit_events` row records the override. | 061, 066 | pgTAP |
| AC-STK-014 | Given a Count with a non-zero variance authored by user U, when U (even an Admin) posts it, then `STK_SELF_APPROVE`; a different user below Project Manager rank gets `STK_RANK`; a different Project Manager posts it and an adjustment entry equal to the variance exists. | 025, 062 | pgTAP |
| AC-STK-015 | Given a Count with zero variance on every line, when its author posts it, then it posts and writes no ledger entry. | 025, 062 | pgTAP |
| AC-STK-016 | Given a fractional quantity for an item whose unit is whole-numbers-only, then `STK_FRACTION`. | 005 | pgTAP |
| AC-STK-017 | Given an item or warehouse with stock on hand, when archived, then refused; with none, archived and absent from pickers but present in history. | 006 | pgTAP |
| AC-STK-018 | Given an org whose `inventory` domain is externally owned, when a document is posted, then `STK_OWNED_BY_ERP` and nothing is written; reads still return history. A mutation check (`allowed := true`) turns this test red. | 070 | pgTAP |
| AC-STK-019 | Given orgs A and B, then neither reads nor writes the other's stock tables, and foreign ids in payloads are refused, for each new table and RPC. | 065, NFR-001 | pgTAP |
| AC-STK-020 | Given a caller below Project Manager, when stock-on-hand, trace and consumption are read, then quantities are returned and unit cost / value fields are absent from the response. | 063 | pgTAP |
| AC-STK-021 | Given a backdated document older than 31 days or dated in the future, then `STK_BACKDATE` for non-Admins; a backdated Admin post lands in the older month's consumption without changing any earlier ledger value. | 016 | pgTAP |
| AC-STK-022 | Given issues in two months and a return in the second, when the report runs for the project, then rows show per-month net consumption in the org timezone, and cumulative net to date equals the sum. | 042 | pgTAP |
| AC-STK-023 | Given an allowance of 100 and cumulative net consumption of 120, then the row shows variance +20 and the over-allowance flag; with no allowance it shows consumption only and no flag; the unplanned-item list names it. | 042, 043 | pgTAP |
| AC-STK-024 | Given a PM of the project sets an allowance on a BoQ line of another project, then refused; an Engineer cannot set one. | 050, 065 | pgTAP |
| AC-STK-025 | Given 90 days of steady usage of 2/day, lead time 14, then the suggested level is 42 and the quantity 60; a whole-number unit rounds up; the inputs are returned. | 051 | pgTAP |
| AC-STK-026 | Given under 28 days of history or under 3 usage movements, then "not enough history" and no figure; a transfer to a central warehouse does not count as usage. | 051, 052 | pgTAP |
| AC-STK-027 | Given a suggestion, when nobody accepts it, then no level exists; when an authorised user accepts, the level is set and one audit row records before / after. | 053 | pgTAP |
| AC-STK-028 | Given a ledger over 1000 rows for one project, when the trace is paged, then every row appears exactly once with a correct running balance and no truncation. | 041 | pgTAP |
| AC-STK-029 | Given a Receive citing a procurement case, then the case's status and records are unchanged; citing another org's case is refused. | 020, OQ-9 | pgTAP |
| AC-STK-030 | Given the Receive / Issue / Return form at 360 px, then fields are reachable, item search by code or name works, the shortfall error is shown beside the quantity, and a keyboard-only user can complete an issue. | NFR-004/005 | Unit (RTL) + `axe-core` gate |
| AC-STK-031 | Given a storekeeper (Engineer role, keeper of a site) and a PM, when stock is received at central, transferred to the site, and issued to a project work item, then the PM sees the full chain on the trace and the consumption report, and an Engineer who is not a keeper cannot post. | 020–022, 041, 042, 061 | **E2E** (second curated journey) |
| AC-STK-032 | Given each screen state (loading, empty, error, populated, archived), then the right state renders and an RPC failure shows an error, never a zero. | 044, 045 | Unit (RTL) |
| AC-STK-033 | Given `can()` for each built-in role and the real vs impersonated role, then affordances match FR-STK-061/062/064, deny by default. | 064 | Unit (Vitest) |
| AC-STK-034 | Given a member below Project Manager (Engineer), when they create or edit a unit, item or warehouse, then it is refused; only Admin changes keepers; an item's unit cannot change after a line references it. | 007, 008 | pgTAP |

Money / SoD mutation checks (per CLAUDE.md): AC-STK-013, 014, 018 are re-run with the rule broken to prove red.

## 10. Edge cases and decisions recorded

- **Issue outpaces keying:** refused (OQ-STK-6); the count / adjustment path fixes the book, and #1520 surfaces the failure.
- **Same item, two warehouses:** independent balances and averages; a transfer carries value, so no valuation drift.
- **Return of an issue from a closed project:** allowed (it reduces consumption and restores stock); the project-active rule applies to issues only.
- **Warehouse linked to a project:** informational; an issue may name any active project.
- **Count while stock moves:** the variance is taken at post time against current on-hand; `expected_quantity` records what the
  system held. Accepted; a count freeze is a follow-up if sites count during activity.
- **Item changes unit after movements:** refused (a unit change would reinterpret history).
- **Item code collision with a BoQ `item_code`:** none; the two are independent (OQ-STK-1).
- **Currency:** values are in the org's default currency (`organizations.default_currency`, as 0245 reads it); multi-currency stock is out.
- **Assistant:** no tools in this spec; any later tool goes through the same RPCs under the user's identity (ADR-0036).

## 11. Verification note

Every shipped file, table and function named here was checked present at `origin/dev` 4acce5091 on 2026-10-31
(`git cat-file` / `git grep`): migrations 0001, 0006, 0035, 0076, 0087, 0088, 0178, 0245, 0250, 0337, 0362, 0376; code
`adapterSeam/{contract,dispatch,capabilityMap}.ts`, `auth/{policy,coarseRoles}.ts`, `lib/repositories/`,
`pages/Companies.tsx`, `lib/db/companies.ts`, `classifyMutationError`. **Not shipped, by search of five sources (ADRs,
migrations, decisions, enforcement scripts, issues, including closed):** any inventory item, warehouse, stock movement
or consumption table. "Nothing exists" is scoped to those sources. Odoo claims (no analytic distribution on stock moves)
come from `docs/research/2026-10-30-odoo20-native-coverage.md` §2.1 and are **not** verified on a running instance; that
is #1504 / #1508's check.

## 12. Slice split (one builder each; Director-dispatched Orca workers; each slice ships schema, RLS, repository, UI where listed, and its proofs)

Order: S1 → S2a → S2b → (S3, S4 parallel) → S5 → S6. Shared-resource rules apply (DB work under `scripts/with-db-lock.sh`).
Migration numbers are taken when each slice starts. ADR: S2a writes one ADR (stock ledger, valuation, and the hybrid
ownership of §6); no other slice needs one.

| Slice | Builds | Owns ACs | Blocked by |
|---|---|---|---|
| **S1 Master data** | `stock_units`, `stock_items`, `stock_warehouses`, `stock_warehouse_keepers`; RLS, audit; repository; Admin screens (units, items, warehouses, keepers); `can()` entities; glossary terms; seed rows for later slices (rich: 12 items, central + 3 sites) | 019 (its tables), 033, 034 | none |
| **S2a Posting engine, in-flows** | `stock_documents`, `stock_document_lines`, `stock_ledger`, `stock_balances`; numbering; `create/post/cancel_stock_document`; **Receive** and **Transfer**; moving-average valuation; negative guard; archive-with-stock rule; fraction rule; idempotency; ownership guard; keeper rule; backdate rule; ADR | 002, 003, 005, 006, 010 (receive / transfer), 011, 012, 013, 016, 017, 018, 019 (its tables), 021, 029 | S1 |
| **S2b Posting engine, out-flows** | **Issue** and **Return** posting (project + work item checks, return cap, server-derived cost); the whole-sequence ledger-equals-balance proof | 004, 007, 008, 009, 010 (issue / return), 019 (its RPCs) | S2a |
| **S3 Movement screens** | Stock on hand, ledger trace (keyset RPC), document list / detail, create-and-post forms for Receive / Transfer / Issue / Return (phone-first), project "Materials" entry; repository + hooks; **E2E** | 001, 020 (on-hand and trace), 028, 030, 031, 032 | S2b |
| **S4 Adjustment and count** | Adjustment and Count documents, two-person post rule, counted-vs-expected UI; money SoD mutation checks | 014, 015 | S2a (UI after S3's shared components) |
| **S5 Allowance and consumption report** | `boq_material_allowances`; allowance editor on the BoQ screen; `get_project_consumption`; project consumption report with over-allowance flag and unplanned list | 020 (consumption), 022, 023, 024 | S2b, S3 |
| **S6 Reorder** | `stock_reorder_levels`, `get_reorder_suggestions`, accept / edit flow with audit, below-level worklist | 025, 026, 027 | S2b |

Done per slice = the repo's local final gate (`check:guards`, typecheck, eslint, touched tests, touched pgTAP, touched e2e,
`scripts/ux-proof.sh` on touched routes) and the three reviewers; UI slices add one rendered Discover pass whose findings
graduate (ADR-0030). Coverage ≥ 80% of changed lines. Each UI slice does the ~30-second owner sketch-glance before build.

## 13. Follow-ups this spec files rather than builds

In-transit transfers (OQ-STK-4) · unit conversions · count freeze · per-line goods-receipt matching (OD-PROC-2) ·
purchase-request prefill from the reorder worklist · organisation-tunable reorder constants · registration of stock actions
in the #902 role matrix when R1 lands · connected posting and reconciliation (#1508) · offline queue (#1520) · daily site
report (#1522).
