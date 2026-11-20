# Spec: Client material requisitions tracked per work order (#2585)

**Status:** proposed; owner decisions below need sign-off before build. IDs `FR-CSR-###`, `NFR-CSR-###`, `AC-CSR-###`. Plan: `docs/plans/2026-11-20-client-material-requisitions.md`. Executor: the rollup and screens are Orca slices; the pickup that posts to the stock ledger is a stock-value path and is Director-dispatched, shipping alone. Map #2516; blocked by #2517 (work order on stock documents) and #2523 (zero-cost client-supplied tag, yard/staging locations, document paper); reads `docs/specs/stock-site-work.spec.md` and `docs/specs/material-requests.spec.md` first. Extends the shipped stock posting engine (0413) and `work_order_lines` (0337); does not replace material requests (#2524), which move the organisation's own stock.

## Job story

When a work order needs material that the client supplies, I want to record each requisition from the take-off, through the client's reservation, to the pickup, so that the work order shows what is reserved, what has been collected and what is still to collect, and collected material lands in stock at no cost.

## Context and boundary

- A **client-supplied requisition** asks the client to release material for one work order. It is a different thing from a material request (#2524): that moves the organisation's own purchased stock under an approval chain; this tracks material the organisation does not own until pickup.
- The **take-off** is the quantity worked out for the work order's contract items. It is typed or imported per line; this spec does not compute take-offs from drawings.
- The **reservation** is the client's confirmation that a quantity is set aside. The organisation records it with the client's own reference; PMO does not talk to the client's system.
- The **pickup** is the physical collection. It posts a stock receipt through the existing posting engine into a location the organisation chooses, for an item carrying the zero-cost client-supplied tag (#2523), so the ledger value is 0.
- Out of scope (per map): the client's own system integration, and close-out reconciliation of what was never collected or was returned. Extra material cost, returns to the client and cost-plus billing of supplied material are not handled.
- Only quantities are tracked here. No requisition field holds an amount of money.

## Definitions (used by the acceptance criteria)

For one requisition line:
- **Take-off quantity**: the quantity the work order needs, as entered.
- **Requested quantity**: the quantity asked of the client (defaults to the take-off; may differ).
- **Reserved quantity** = sum of recorded reservations minus sum of recorded releases (a release is the client withdrawing part of a reservation).
- **Collected quantity** = sum of posted pickups.
- **Still to collect** = reserved - collected. **Awaiting reservation** = requested - reserved, never below zero.
- A work order's figures are the sums of its lines, per stock item and in unit; lines in different units are never added together.

## Requirements (EARS)

**Requisition and take-off**
- FR-CSR-001 The system shall let an authorized user create a requisition for one work order, in `draft`, with a number from the existing document-number sequence, an optional client reference and one or more lines, each naming a stock item (carrying a zero-cost tag, #2523), a take-off quantity and a requested quantity, and optionally the contract item (`work_order_lines`) it serves.
- FR-CSR-002 A line's contract item, when named, shall belong to the same work order; the work order shall not be Closed or Cancelled.
- FR-CSR-003 Where the organisation bulk-loads take-off lines, the system shall accept them through the existing import template path with the same validation as manual entry.
- FR-CSR-004 When a user sends a requisition, the system shall move it from `draft` to `open`, freeze its lines, and record who sent it and when. A requisition can be cancelled while no pickup is posted; a cancelled requisition keeps its history.
- FR-CSR-005 Create and send shall be idempotent on a client-generated `client_request_id`.

**Reservation**
- FR-CSR-006 When the client confirms a reservation, an authorized user shall record it against a line: quantity, the client's reference, the date reserved and an optional note. Reservations are append-only events; a correction is a release event, never an edit.
- FR-CSR-007 Reserved quantity shall not exceed requested quantity unless the organisation allows it (OD-CSR-3); the server refuses the event otherwise.
- FR-CSR-008 When the client withdraws part of a reservation, an authorized user shall record a release with a reason; the release shall not take reserved below collected.
- FR-CSR-009 When a reservation is recorded on a requisition, the system shall notify the requisition's creator through the existing notification mechanism.

**Pickup**
- FR-CSR-010 When goods are collected, a stock keeper of the receiving location shall record a pickup against a line: quantity, date, collector name or reference (free text), receiving location and optional delivery paper; the system shall post it as one stock receipt in the same transaction.
- FR-CSR-011 The receipt shall be created through the existing stock document creation and posting path, so the ledger single-writer rule (ADR-0097) still holds; no requisition code writes `stock_ledger` or `stock_balances`.
- FR-CSR-012 The receipt line shall have unit cost 0 and its ledger value 0. The server refuses a pickup for an item that is not zero-cost tagged (OD-CSR-2) and never accepts a cost from the client.
- FR-CSR-013 A pickup shall not exceed still-to-collect for its line, checked in the database under a row lock so two concurrent pickups cannot both succeed past the limit.
- FR-CSR-014 The receipt shall carry the requisition's work order (#2517) so the stock on hand per work order (#2523) includes collected client-supplied material.
- FR-CSR-015 Pickup and its receipt are idempotent on a client-generated `client_request_id`; a replay returns the original.
- FR-CSR-016 When the receiving location's domain is owned by a connected ERP, the system shall refuse the pickup with the existing ownership refusal (`STK_OWNED_BY_ERP`) before writing anything (OQ-CSR-2).
- FR-CSR-017 A posted pickup is not edited or deleted. A mistaken pickup is reversed by a stock adjustment on the stock side (existing correction rule), and the requisition shows the pickup as reversed through the link (OQ-CSR-3).

**Work order view**
- FR-CSR-018 The work order shall show, per stock item and for the whole work order: requested, reserved, collected, still to collect and awaiting reservation, each with its unit, and the list of reservations and pickups behind them.
- FR-CSR-019 Figures shall be derived at read time from the event and pickup rows; no stored counter exists. A work order with no requisition shows an empty state, not zero.
- FR-CSR-020 A requisition with lines still awaiting reservation or still to collect shall show as open on the work order; it shall never be marked complete automatically (close-out is out of scope).

**Access and audit**
- FR-CSR-021 Actions (create, send, cancel, record reservation, record release, record pickup, view) shall be registered in the role matrix (#902) and gated by `can()`; RLS and the RPCs enforce. Recording a pickup requires keeping the receiving location (or Admin), as `create_stock_document` already does.
- FR-CSR-022 Requisition, line, reservation and pickup rows carry `org_id` by default with RLS (and FORCE RLS) on every new table; no client role holds insert, update or delete; every write goes through a security-definer RPC.
- FR-CSR-023 Each transition and event is written to record history with actor, time and reason.

## Non-functional requirements
- NFR-CSR-001 The work order view reads per-line figures in one indexed query per page; indexes on (work_order_id, status) and (line_id).
- NFR-CSR-002 Quantities are exact decimals (`numeric(14,3)`), positive and bounded by the item's unit rules (whole units only where the unit demands it); never floating point.
- NFR-CSR-003 Phone-usable at 320px, keyboard accessible, `DESIGN.md` tokens, English and Bahasa Indonesia; the organisation's own word for client-supplied (#2529) is used wherever the tag is shown.

## Acceptance criteria and owning layer

Hand calculation for one line: take-off 100, requested 100. Reservations 60 and 20, release 10, pickups 50. Reserved = 60 + 20 - 10 = **70**; collected = **50**; still to collect = 70 - 50 = **20**; awaiting reservation = 100 - 70 = **30**.

| ID | Given / When / Then | Layer |
|---|---|---|
| AC-CSR-001 | Given the hand calculation above, when the work order rollup is read, then reserved 70, collected 50, still to collect 20, awaiting reservation 30, and the event list sums to the same. | Unit (pure function) + pgTAP (read function) |
| AC-CSR-002 | Given two lines of different units, when the work order total is read, then they are shown separately, never added. | Unit |
| AC-CSR-003 | Given a work order with no requisition, when the view opens, then it shows an empty state, not zeros. | Unit |
| AC-CSR-004 | Given a line with requested 100, when a reservation takes reserved to 101, then refused; at 100 accepted (default OD-CSR-3). | pgTAP |
| AC-CSR-005 | Given reserved 70 and collected 50, when a release of 30 is recorded, then refused; a release of 20 is accepted. | pgTAP |
| AC-CSR-006 | Given still to collect 20, when a pickup of 21 is recorded, then refused and no stock document exists; a pickup of 20 posts. | pgTAP |
| AC-CSR-007 | Given two concurrent pickups of 15 against still to collect 20, then exactly one succeeds. | pgTAP |
| AC-CSR-008 | Given a posted pickup of 50 for a zero-cost item, when read, then one receipt exists with unit cost 0, ledger `value_delta` 0, the work order named, and quantity on hand at the location up by 50. | pgTAP |
| AC-CSR-009 | Given a client-supplied cost in the pickup payload or an item without the zero-cost tag, when recorded, then refused and nothing is written. Mutation check: remove the zero-cost rule; the test must go red. | pgTAP |
| AC-CSR-010 | Given a replayed pickup `client_request_id`, when sent twice, then one receipt and one pickup row exist. | pgTAP |
| AC-CSR-011 | Given a user who does not keep the receiving location and is not Admin, when they record a pickup, then refused. | pgTAP |
| AC-CSR-012 | Given a connected-ERP-owned inventory domain, when a pickup is recorded, then refused with the ownership refusal and nothing is written. | pgTAP |
| AC-CSR-013 | Given a Draft requisition, when sent, then it is `open` and its lines are frozen; a send replay is a no-op. Given a pickup already posted, when cancel is attempted, then refused. | pgTAP |
| AC-CSR-014 | Given a line naming a contract item of another work order, or a Closed work order, when saved, then refused. | pgTAP |
| AC-CSR-015 | Given a reservation recorded, when it saves, then the creator gets one notification. | pgTAP |
| AC-CSR-016 | Given an event or pickup row, when any client role attempts a direct write, update or delete, then refused (mutation check on the grant). | pgTAP |
| AC-CSR-017 | Given a user in another organisation or without permission, when they read or write, then refused. | pgTAP |
| AC-CSR-018 | Given a pickup, when stock on hand per work order (#2523) is read, then it includes the 50 collected. | pgTAP |
| AC-CSR-019 | Given a keeper on a phone, when they raise a requisition from the take-off, record the client's reservation and a pickup, then the work order shows reserved, collected and still to collect matching AC-CSR-001 and stock holds the material at zero value. | E2E (one journey) |

## Errors
| Condition | Result |
|---|---|
| Reservation above requested | Field error: "Reserved would exceed requested by n" |
| Release below collected | Refused with the collected quantity |
| Pickup above still to collect | Refused with the remaining quantity |
| Item not zero-cost tagged | Refused: "This item is not client-supplied" |
| Cost sent with a pickup | Ignored never; refused |
| Not a keeper of the receiving location | Refused (existing stock keeper message) |
| Inventory owned by a connected ERP | Refused with the existing ownership message |
| Work order Closed or Cancelled | Refused with reason |

## Owner decisions (recommended defaults, not rulings)
| ID | Decision and default | If wrong, what breaks |
|---|---|---|
| OD-CSR-1 | A requisition has only `draft`, `open`, `cancelled`; progress (reserved, collected) is derived from events, not a status chain. | If the client process needs named stages (for example "submitted to client"), planners cannot filter by them and will keep a side list. |
| OD-CSR-2 | Pickups are accepted only for items carrying a zero-cost tag; collected client material always costs 0. | If the organisation owes the client a charge for some items, their cost never reaches the work order and project cost is understated. |
| OD-CSR-3 | Reserved may not exceed requested. | If the client routinely reserves more than asked, staff cannot record it and fall back to a side note. |
| OD-CSR-4 | The pickup records and posts the receipt in one step by the receiving location's keeper; no separate Draft receipt. | If a second person must confirm receipt, stock goes up on one person's word. |
| OD-CSR-5 | Take-off is typed or imported; no calculation from drawings. | If the take-off must tie to contract quantities, over-requesting is not caught. |
| OQ-CSR-1 | Should requested be capped at the contract item's remaining quantity on the work order? Default no cap, warn only. | Over-requests slip through, or legitimate buffer is blocked. |
| OQ-CSR-2 | When inventory is owned by a connected ERP, should pickup create the receipt in the ERP instead of refusing? Default refuse; out of scope until the inventory connector ships. | Connected organisations cannot use pickups. |
| OQ-CSR-3 | How is a wrong pickup undone: stock adjustment only (default), or a reverse pickup event? | The requisition keeps counting material that was written off. |
| OQ-CSR-4 | Does the reservation need proof (client confirmation file)? Default optional, via the shared private attachment mechanism. | Disputes over what the client agreed. |

## Delivery checklist
- [ ] Owner signs OD-CSR-1..5, answers OQ-CSR-1..4.
- [ ] #2523 (zero-cost tag, work-order receipt) has shipped or is built first.
- [ ] Rollup/screens slices and the pickup-posting slice ship separately; the latter alone (stock value).
- [ ] Glossary: client material requisition, take-off, reservation, pickup.
