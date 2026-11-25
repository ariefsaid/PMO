# Purchase Request Line — Standard Item Picker with Free Text

## Overview

When raising a purchase request (`/procurement/new?have=need`) or editing lines on a Draft purchase request, requesters previously had only a free-text description box, which invited inconsistent spelling for items that already exist in the organisation's standard item list (`public.stock_items`). Active non-light organisation members already hold read access to `public.stock_items`. This spec lets a requester search and pick an active standard item — including near-duplicate name matching — while keeping free-text entry available, and persists the picked item's identity (`stock_item_id`) on `public.procurement_items`. Receiving and stock-mapping behaviour (`order_stock_mappings`, `map_order_stock`, `receive_order_goods`, `read_order_receiving`) remain unchanged.

## Functional Requirements (EARS)

- **FR-PSI-001**: The system shall add a nullable `stock_item_id` foreign key (`references public.stock_items(id)`) to `public.procurement_items`, expose it on `public.procurement_items_masked`, and accept it on `public.create_procurement_with_items(uuid, jsonb, jsonb)` (including idempotency replay checks).
- **FR-PSI-002**: When inserting or changing `stock_item_id` on `public.procurement_items` to a non-null value, the database shall refuse any item that is archived or belongs to another organisation (`23514`, `PRC_STOCK_ITEM`). Updates that do not change `stock_item_id` shall remain permitted so existing lines whose standard item is later archived can still edit other fields.
- **FR-PSI-003**: When PMO owns purchasing and active standard items exist, the purchase request line description input (on the create screen and Draft line items tab) shall offer matching active standard items as the requester types — including near-duplicate spellings — while still allowing arbitrary free text when no standard item is chosen.
- **FR-PSI-004**: When the requester picks a standard item on a line, the line shall populate the standard item's name, retain its `stock_item_id` on save and reload, and show its standard item code; editing the text away from the picked item shall clear `stock_item_id` so the line becomes free text until another item is picked.
- **FR-PSI-005**: Saving `stock_item_id` on `public.procurement_items` shall not create or modify rows in `public.order_stock_mappings` and shall not change `receive_order_goods` or `read_order_receiving`.

## Acceptance Criteria

### AC-PSI-001 — Near-duplicate suggestion and standard-item pick on a new purchase request
- **Given** an active standard item exists in the organisation's item list and a requester opens `/procurement/new?have=need`
- **When** the requester types a near-duplicate of that item's name into the new line description field
- **Then** the form offers the existing standard item, picking it fills the item's standard name and binds `stock_item_id`, and saving the draft persists `stock_item_id` on the line.

### AC-PSI-002 — Free-text line alongside standard-item line
- **Given** a requester on `/procurement/new?have=need` or a Draft purchase request's Line items tab
- **When** the requester enters a custom description without picking from the standard item list
- **Then** the line saves with `stock_item_id = null` and the typed description preserved.

### AC-PSI-003 — Standard item identity enforced at the database boundary
- **Given** a draft purchase request
- **When** a caller writes a `stock_item_id` belonging to another organisation or to an archived item (via `create_procurement_with_items` or direct insert/update)
- **Then** the database refuses the write with SQLSTATE `23514` and code `PRC_STOCK_ITEM`; whereas updating quantity or rate on a line whose previously valid item was later archived succeeds.

### AC-PSI-004 — Masked view and idempotency preserve `stock_item_id`
- **Given** a purchase request line with a `stock_item_id`
- **When** read through `public.procurement_items_masked` or replayed via `create_procurement_with_items` with the same or differing `stock_item_id`
- **Then** the masked view returns `stock_item_id` while continuing to mask money columns (`rate`, `amount`), an identical replay succeeds, and a conflicting `stock_item_id` replay fails with `23505`.

### AC-PSI-005 — Receiving behaviour unchanged
- **Given** a purchase request line saved with a `stock_item_id`
- **When** the line is saved
- **Then** no `order_stock_mappings` row is automatically created and `read_order_receiving` / `receive_order_goods` continue to read only `order_stock_mappings`.
