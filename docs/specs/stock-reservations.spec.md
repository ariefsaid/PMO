# Stock reservations and borrowing (RSV)

Issue #2693 (map #2516). Status: **Draft for Director sign-off, 2026-11-21**. Plan `docs/plans/2026-11-21-stock-reservations.md`.
IDs `FR-RSV-###`, `AC-RSV-###`. Owner ruling: `docs/decisions.md` OD-SCOPE-9 (settled, not re-decided here). **Stock-ledger and approval
rules.** Nothing here posts to the ledger or changes a balance; reservations are a separate book beside it. Ships alone; stacked on #2691
(migrations 1315-1319 only). Reads: `stock-site-work`, `stock-vendor-location`, `stock-two-step-transfer`, `stock-work-order-transfer`,
`material-requests` (approval chain, SoD, stand-ins). Do not depend on #2685 (approver inbox) or #2686 (usage thresholds). #2676 stacks on this.

**Job story.** When stock is shared across work orders, I want to hold a quantity for one work order, so its planned material is there when it asks.

## 1. AS-IS
- `get_stock_on_hand` (0415, vendor-aware in 1300) reports quantity per item and location. Nothing says that some of it is spoken for.
- A material request (`mrq_submit`, 1001) snapshots the org's approval chain (`approval_chain_steps`: ordered role steps, optionally "only when over
  plan"), is decided step by step with server-enforced SoD (author never decides, nobody decides two steps, stand-ins), and on the last approval
  creates a transfer draft. A request names no source location; the coordinator picks it at the final step (OQ-MRQ-2).
- Two work orders can therefore plan on the same units, and the first one to ask takes them without anyone having agreed.

## 2. Design decisions
1. **A separate book, not a ledger entry.** `stock_reservations` holds "work order W holds q of item I at location L". It is never written by,
   and never writes to, `stock_ledger`, `stock_balances` or `stock_write_entry`. The ledger stays the only authority on physical quantity.
2. **Free = on hand minus active reservations, per location, never negative in display.** For one item at one location:
   `free = max(0, qty_on_hand - sum(remaining of active reservations))`, `reserved = sum(remaining of active reservations)`. When on hand falls
   below what is reserved (goods used or moved without a request) free reads 0 and the screen shows the shortfall as "reserved, short by n"; no
   reservation is silently changed. Free is computed on read, never stored, so it cannot drift from the ledger.
3. **Active.** A reservation is active while its status is `active`, its remaining quantity is above zero, its date `expires_on` (optional) has not
   passed in the organisation's calendar, and its work order is Draft or Issued. A closed or cancelled work order's reservation stops counting at once
   (read-time rule); a sweep (`release_stale_reservations`, run lazily by every reservation write and callable by an Admin) records it as `released`
   or `expired` with an event so history is complete. No scheduled job is required.
4. **Reserve is bounded by free.** A reservation may not exceed the free quantity at its location at the moment it is made (`RSV_EXCEEDS_FREE`), under
   an advisory lock per organisation, item and location, so two people cannot both reserve the last units. A later fall in on hand is allowed (decision 2).
   One active reservation per work order, item and location; reserving again adds to it (an event records the change). Reserving is allowed only at
   `central`, `site`, `yard` and `staging` locations that are not archived (not vendor, not transit), for a work order of the organisation that is Draft or Issued.
5. **Who may reserve.** The keeper of the location, an Admin (audited `stock.admin_post` style entry `stock.reservation_admin`), or a stock planner
   (the existing master-data rank: Project Manager and above, `stock_master_writer()`). Release and adjust: the same people. View-only impersonation
   cannot (the real role is the authority). No new role.
5a. **Own reservation first, and where.** A request is evaluated at submit, per line and per item across the organisation's reservable locations (a request
   names no source location). Of the quantity asked, the part covered by the work order's own remaining reservations (less what its other pending
   requests already claim) is `reserved_use_qty`; the part covered by free stock (sum over locations of per-location free) is plain; the rest takes
   another work order's reserved stock and is `borrowed_qty`. A request with any `borrowed_qty > 0` is **borrowing**.
6. **Borrowing goes through the existing approval steps, not a new engine, and without restating any shipped function.** The Admin sets, beside the
   reservation setting, a borrowing approver: a role and a label (`reservation_borrow_role`, `reservation_borrow_label`). When a request is submitted
   (status becomes `pending`), a trigger on `material_requests` splits each line (decision 5a) and, if the request is borrowing and the mode is `approve`,
   appends one extra row to that round's `material_request_steps` snapshot as the **last** step with that role and label. Order, SoD (author never decides,
   nobody decides two steps), stand-ins, pins and the queue are the shipped ones, because it is an ordinary step row. A borrowing request with no
   borrowing approver set is refused at submit (`RSV_NO_BORROW_APPROVER`, the trigger raises and the submit rolls back). Org setting
   `reservation_borrow_mode`: `approve` (default once reservations are on) or `warn` (borrowed quantity is shown and recorded; no extra step). The shipped
   `approval_chain_steps`, `mrq_set_chain`, `mrq_submit` and `mrq_decide_step` are not edited, so a chain edit cannot drop the borrowing step.
7. **Consumption happens at final approval, not at posting.** When the request's last step is approved (status becomes `approved`), a database trigger, in the
   same transaction, consumes the request's reservations: first the work order's own (oldest first) by `reserved_use_qty`, then the lenders by
   `borrowed_qty` (largest remaining first, ties by oldest). Reasons: (a) approval is the commitment and the keeper's transfer may lag days or be
   retried (`mrq_retry_transfer`), so holding the reservation until posting would double-count the units for days; (b) the posting engine and the
   ledger stay untouched, which is the lane rule; (c) #2676 posts issues from daily reports and needs no reservation hook. Cost: if an approved
   request's transfer is never posted its units stay consumed; an Admin or the lender's planner re-reserves (a visible, audited act). Recheck at the last
   step: borrowing is recomputed; if borrowed quantity is now higher than the snapshot the approval is refused `RSV_BORROW_CHANGED` (resubmit), so nobody
   approves a smaller borrow than the one that happens. Rejected, returned or cancelled requests consume nothing.
8. **Release, expire, cancel.** Release (whole or part) by the people in decision 5, with a reason; expiry by date (decision 3); work-order close
   releases (decision 3). Consumed quantity cannot be released. History is append-only in `stock_reservation_events`
   (`reserve`, `adjust`, `release`, `expire`, `consume`, `lend`). A reservation row is never deleted.
9. **Off until an Admin turns it on.** `organizations.stock_reservations` (default false) gates everything. Off: every reservation RPC refuses
   `RSV_OFF`, the new read returns nothing, `mrq_submit` behaves exactly as shipped (the borrowing computation is skipped, no step is filtered
   differently), the approval trigger is a no-op, and no screen, link, chain flag or column renders. Admin only, audited `stock.reservations`.
   Turning it on needs the organisation to run its own inventory (`stock_assert_standalone`). Turning off keeps data and stops all effects.
10. **Reads.** `get_stock_on_hand` is not edited. A new read `get_stock_free_reserved(warehouse, item)` returns per item and location: on hand, reserved, free
   (never negative), `short_by`, and the reserving work orders (id, number, name, remaining, expires on) for the one-tap list; reserver names are not returned.
   Quantity only for everyone; no cost.
11. **Tenancy.** Every table has `org_id` (stamped by trigger, never from the client), RLS enabled and forced, member-only select with `(select ...)`
   wrapped helpers, no client write grants. Every RPC bounds by `auth_org_id()`; a work order, item or location of another organisation is `RSV_NOT_FOUND`.

## 3. Requirements (EARS)
- FR-RSV-001 The system shall provide `reserve_stock(work order, item, location, quantity, expires on, note, client request id)`; it shall create or top up the active reservation, write a `reserve` event, and refuse beyond free (`RSV_EXCEEDS_FREE`).
- FR-RSV-002 The system shall refuse a reservation at a vendor, transit or archived location, for a closed, cancelled or other-organisation work order, for an archived or other-organisation item, and for a non-positive or over-precise quantity (`RSV_LOCATION`, `RSV_WORK_ORDER`, `RSV_NOT_FOUND`, `RSV_INVALID`).
- FR-RSV-003 Only the location's keeper, an Admin or a stock planner shall reserve, adjust or release (`RSV_FORBIDDEN`); replays with one client request id return the original (idempotent).
- FR-RSV-004 The system shall provide `release_reservation(id, quantity or all, reason)` and `release_stale_reservations()`; consumed quantity is never released; every change writes an event.
- FR-RSV-005 Free, reserved and short-by shall follow decision 2 and 3 and be computed on read; the ledger and `get_stock_on_hand` shall be unchanged.
- FR-RSV-006 `get_stock_free_reserved` shall list per item and location the figures of decision 10 with the reserving work orders; organisation-isolated, member-only.
- FR-RSV-007 When a request becomes pending while reservations are on, a trigger shall (under the work order's existing advisory lock held by submit) split each line into own-reservation, free and borrowed quantity (decision 5a) under the existing per-work-order advisory lock, store them on the line, and mark the request `borrowing`.
- FR-RSV-008 While `reservation_borrow_mode` is `approve`, the trigger shall append the borrowing step (role and label from the settings) as the last step of the round only for a borrowing request, and refuse a borrowing request when no borrowing approver is set (`RSV_NO_BORROW_APPROVER`); in `warn` mode no step is appended.
- FR-RSV-009 On the last approval the system shall, in the same transaction, consume own then lent reservations by the stored quantities, write `consume` and `lend` events naming the request, and refuse the approval when borrowing grew (`RSV_BORROW_CHANGED`); a consumed or released quantity shall never exceed what was reserved (`RSV_OVERDRAW`, table check plus trigger).
- FR-RSV-010 The reservation tables shall be writable only by the RPCs and the approval trigger; no client write grant; events are append-only.
- FR-RSV-011 `set_stock_reservations(on, borrow_mode, borrow_role, borrow_label)` shall be Admin-only, audited, standalone-only; the borrowing approver is any existing role; the chain editor is not changed.
- FR-RSV-012 The stock-on-hand screen shall show "x free + y reserved" with a tap-through list of the reserving work orders, the work-order stock balance shall show the work order's reservations, and the request screens shall show the borrowed quantity and its approval step, only while reservations are on; on a phone (390 px) and a desktop, in English and Bahasa Indonesia, with the shared form primitives and DESIGN.md tokens.
- FR-RSV-013 A reservation form (work order, item, location, quantity, optional expiry, note) shall be offered to people who may reserve; release and expiry shall be visible with the history.

## 4. Settings
| Setting | Where | Default | Meaning |
|---|---|---|---|
| Reservations | `organizations.stock_reservations`, Stock setup (Admin) | off | on enables reserve, free/reserved reads, borrowing detection |
| Borrowing mode | `organizations.reservation_borrow_mode` (`approve` or `warn`) | `approve` (applies only once reservations are on) | approve: borrowing needs the flagged chain step; warn: shown and recorded only |
| Who approves borrowing | `organizations.reservation_borrow_role` and `reservation_borrow_label`, Stock setup (Admin) | none | the role (and step name) that approves a borrowing request, as the last step |
No names, limits, day counts or lists of one client are coded.

## 5. Default-off statement
New tables, new defaulted columns (`material_requests.borrowing` false, line quantities 0), new organisation settings that default off. While off nothing renders; every new function refuses or returns empty; the two new triggers on `material_requests` return at once; no shipped function is re-created;
`get_stock_on_hand` and the stock ledger are not edited. Existing tests are not edited; the material-request and stock tests re-run unchanged (AC-RSV-016).

## 6. Acceptance criteria
| AC | Given / When / Then | Owning layer |
|---|---|---|
| AC-RSV-001 | Given reservations on and 10 on hand at a site, when the keeper reserves 4 for work order A, then one active reservation of 4 and a `reserve` event exist, the read shows free 6 reserved 4 and the ledger and `get_stock_on_hand` are unchanged. | pgTAP |
| AC-RSV-002 | Given 6 free, when 7 is reserved then `RSV_EXCEEDS_FREE` and nothing is written; after a reserve of 4 a second of 3 is refused, of 2 works; reserving twice for one work order tops up one row. | pgTAP (mutation-check) |
| AC-RSV-003 | Given on hand falls to 3 while 4 is reserved, then free reads 0, short-by 1, the reservation is unchanged, and no value is negative. | pgTAP + Unit |
| AC-RSV-004 | Given a vendor, transit, archived location, a closed or cancelled work order, another organisation's item or work order, a zero or fractional quantity of a whole-unit item, then each is refused with its own error. | pgTAP |
| AC-RSV-005 | Given a user who is neither keeper, Admin nor planner (or an impersonating view-only), then reserve, adjust and release are refused `RSV_FORBIDDEN`; keeper, planner and Admin succeed. | pgTAP (mutation-check) |
| AC-RSV-006 | Given a reservation with a past expiry date, a closed work order, then it stops counting at once and `release_stale_reservations` records `expired` or `released` events; consumed quantity cannot be released; a partial release leaves the rest. | pgTAP |
| AC-RSV-007 | Given reservations off, then every reservation RPC refuses `RSV_OFF`, the read returns nothing, and turning on and off is Admin-only, audited, standalone-only. | pgTAP |
| AC-RSV-008 | Given work order A holds 5 and free is 0, when A requests 5, then `reserved_use_qty` 5, `borrowed_qty` 0, not borrowing, and the shipped chain applies. | pgTAP |
| AC-RSV-009 | Given work order A holds 5, free is 0 and B requests 3, then B's line shows `borrowed_qty` 3 and the request is borrowing; given free 3, then B is not borrowing. | pgTAP |
| AC-RSV-010 | Given mode `approve` and a borrowing approver set, when B's borrowing request is submitted, then its snapshot ends with that step and a non-borrowing request's does not, and editing the chain later changes neither; with no borrowing approver set the submit is refused `RSV_NO_BORROW_APPROVER`. | pgTAP (mutation-check) |
| AC-RSV-011 | Given mode `warn`, then a borrowing request is marked and shows the borrowed quantity with no extra step. | pgTAP |
| AC-RSV-012 | Given the borrowing step, then order, author-never-decides, nobody-decides-two-steps and stand-in rules of material requests apply to it unchanged. | pgTAP (existing rules, new case) |
| AC-RSV-013 | Given the last approval of a borrowing request for 5 (own 2, free 1, borrowed 2), then A's own reservation drops by 2 and the lender's by 2 in the same transaction with `consume` and `lend` events; a rejected, returned or cancelled request consumes nothing. | pgTAP (mutation-check) |
| AC-RSV-014 | Given borrowing grew between submit and the last approval, then the approval is refused `RSV_BORROW_CHANGED` and nothing is consumed; a consume beyond remaining is refused `RSV_OVERDRAW`. | pgTAP (mutation-check) |
| AC-RSV-015 | Given two organisations, then each sees and changes only its own reservations, events and settings, and another organisation's ids are `RSV_NOT_FOUND`; no client can write the tables directly. | pgTAP |
| AC-RSV-016 | Given reservations off, then the material-request and stock tests (1001, 1045, 1100, 1120, 0415, 1300 families) pass unedited and a submit gives the shipped result. | pgTAP (existing files re-run) |
| AC-RSV-017 | Given reservations on, then the stock screen shows "x free + y reserved" and one tap lists the reserving work orders; off, it renders as today; English and Bahasa Indonesia. | Unit |
| AC-RSV-018 | Given a keeper on a phone, when they reserve 4 for a work order, a planner then submits a request that borrows, and the approver approves, then the stock screen reads the new free and reserved figures. | E2E (one journey) |

## 7. Mutation notes (to run by the orchestrator, one marker per rule)
`-- mut:rsv_exceeds_free` (drop the free check, AC-002 red) · `-- mut:rsv_perm` (drop the keeper/planner/Admin check, AC-005) · `-- mut:rsv_borrow_step`
(append the borrowing step always or never, AC-010) · `-- mut:rsv_consume` (skip lender consume, AC-013) · `-- mut:rsv_borrow_recheck` (drop the recheck, AC-014) ·
`-- mut:rsv_overdraw` (drop table check and trigger, AC-014) · `-- mut:rsv_org` (drop the org bound on a read, AC-015) · `-- mut:rsv_off` (ignore the setting, AC-007).

## 8. Open questions (to the Director)
## Restated functions
None. Reservations add behaviour only through new functions and two triggers on `material_requests`; `mrq_submit` (head 1001, restated later by #2686 in 1332), `mrq_decide_step` (head 1045), `mrq_set_chain`, `mrq_waiting_for_me`, `create_procurement_with_items`, `record_*_match_lines`, `get_stock_on_hand` and the balance functions are NOT re-created.

1. A request names no source location, so borrowing is evaluated per item across the organisation's reservable locations and rechecked at the last step. Acceptable? (Alternative: ask for a source location at submit; larger change to the request form.)
2. Consumption at approval (decision 7) over consumption at posting. Confirm.
3. Planner = existing master-data rank (Project Manager and above). Confirm no narrower role is wanted.
