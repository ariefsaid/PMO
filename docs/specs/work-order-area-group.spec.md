# Spec: Work-order area and group (#2668)

**Status:** proposed (phase 1). IDs `FR-WAG-###`, `AC-WAG-###`. Plan: `docs/plans/2026-11-21-work-order-area-group.md`. Map #2516, size S, ships for 15 December (OD-SCOPE-1). No process in code (OD-SCOPE-2): the area and group lists are the organisation's own data.

## Job story

When I run many work orders across areas and operations, I want to group them and see each one's status at a glance, so I find the ones that need attention without opening each.

## Shipped facts relied on (checked 2026-11-21)

- The work-order list is the project page's work-orders tab: `pmo-portal/pages/project-detail/tabs/WorkOrdersTab.tsx`. It renders a **Draft orders** block (`WorkOrdersDraftOrders.tsx`) and one **card per non-draft order** (`WorkOrderCustomerOrderCard.tsx`). There is no cross-project `/work-orders` list; `/work-orders/:id` is the record page.
- Status colour already exists on the non-draft cards: `StatusPill` (`src/components/ui/StatusPill.tsx`) with tone Closed = won, Cancelled = lost, else progress (`WorkOrderCustomerOrderCard.tsx:187,253`). Draft rows carry none.
- `cost_disciplines` (`0950`) is the template for an organisation list: Admin-written, all active members read, unique live code, soft-archive (`archived_at`), admin page `pages/admin/CostDisciplines.tsx`.
- `work_orders` insert/update are column-grant lists (`0193 §5`); a new column is not writable unless granted.

## Requirements (EARS)

- **FR-WAG-001** The system shall keep two organisation lists, work-order **areas** and work-order **groups**, each entry having a code and a name, unique by code among live entries.
- **FR-WAG-002** An Admin shall be able to add, rename and archive entries; every active member of the organisation shall be able to read them. An entry is never hard-deleted while a work order names it (FK blocks); archiving hides it from pickers but a work order keeping it still shows it.
- **FR-WAG-003** A work order shall have an optional area and an optional group (two nullable columns). Both are set from the work-order form, in any status where the body is editable today.
- **FR-WAG-004** The database shall refuse an area or group that belongs to another organisation (composite foreign key on `(org_id, id)`), and shall refuse newly naming an archived entry (a work order already naming it keeps it).
- **FR-WAG-005** While the organisation has at least one live area or group, the work-order list shall show a "Group by" control with the options None / Area / Group (only for the lists that have entries) and, when grouped, one heading per entry (plus "No area" / "No group") with a count, ordered by entry name, the unassigned heading last. Default is None, so the order is as today.
- **FR-WAG-006** While the organisation has at least one live area or group, each work-order row, including Draft rows, shall show its area and group as text and its status as a `StatusPill`. Non-draft cards already show the pill, so only Draft rows gain it.
- **FR-WAG-007** While the organisation has no areas and no groups (and no work order names one), the work-order list and form shall render exactly as today: no new column, no grouping control, no picker.
- **FR-WAG-008** Area and group names shall come from organisation data; no name is coded. Labels "Area" / "Group" are general words in English and Bahasa Indonesia (renameable terms is #2529, not this ticket).

## Decisions taken (flag if wrong)

- **Status colour:** reuse `StatusPill`/the existing status tones; no new tokens. Chosen to put the Draft-row pill **behind the same "has lists" condition** (no org setting), so an existing organisation sees no change.
- **Two tables, not one polymorphic table**: simpler FKs and RLS; identical shape.
- **Grouping is view state only** (URL search param `groupBy`, not stored).
- **Area and group each single-valued** per work order.

## Acceptance criteria (Given/When/Then)

- **AC-WAG-001** (pgTAP) Given an Admin, when they insert an area with a duplicate live code, it is refused; an archived code can be reused; a non-Admin insert/update is refused; a member of another organisation sees none.
- **AC-WAG-002** (pgTAP) Given a work order in org A, when its area or group is set to an entry of org B, the write is refused (FK); the same-org entry is accepted; both null is valid.
- **AC-WAG-003** (pgTAP) Given an archived area, when a work order newly names it, refused; a work order that already names it keeps it on unrelated edits.
- **AC-WAG-004** (pgTAP) Given an area in use, a hard delete is refused (23503); archive succeeds.
- **AC-WAG-005** (unit) Given an organisation with no areas or groups, the work-orders tab renders no "Group by" control, no area/group text and no pill on Draft rows (existing tests unchanged).
- **AC-WAG-006** (unit) Given areas exist, "Group by Area" renders one heading per area with counts and "No area" last; "None" restores the flat order.
- **AC-WAG-007** (unit) Given areas exist, each Draft row shows a status pill and the row's area/group text.
- **AC-WAG-008** (unit) The work-order form shows area/group pickers only when the lists have live entries, lists only live entries, and sends the two ids on save.
- **AC-WAG-009** (unit) Admin lists page: add, rename, archive an area and a group; non-Admin has no write controls.
- **AC-WAG-010** (e2e, one journey) Admin adds an area, sets it on a work order, groups the list by Area and sees the heading; the strings exist in English and Bahasa Indonesia (unit i18n check).

## Out of scope

Cross-project work-order list, saved views, filtering by area, colour per area, renameable "Area"/"Group" terms (#2529), custom fields (Q1 2027).
