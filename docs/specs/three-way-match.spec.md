# Three-way match — vendor bill checked against order and receipt before payment (#2525)

Status: draft for Director review · Map #2516 · Money path (ships alone) · Migration `1018_three_way_match.sql`

## 1. Overview and user value

**Job story.** When a vendor bill arrives, a finance team wants it checked against what was ordered and what was
actually received before anyone pays it, so the organisation never pays for goods it did not get or at a price it did
not agree, and any deliberate exception is on record with a reason from someone other than the person who entered it.

Today the only matching is ERP-side: Odoo bill-to-order linking (`docs/specs/odoo-purchase-to-payment.spec.md`
OQ-OPP-3) and an ERPNext pre-send check (PR #2411). Organisations without an ERP have no match at all. Subcontract
purchases already refuse a bill over the accepted quantity (`0472`, hard cap at capture); goods purchases do not.

## 2. Decisions taken (no live interview — the Director may overturn any of these)

| ID | Decision | Why |
|---|---|---|
| D-TWM-1 | The **order lines** are the purchase's ordered items (`procurement_items`: quantity, rate). | They are the only per-line order data a goods purchase has; `purchase_order_lines` is subcontract-only (BoQ). |
| D-TWM-2 | **Receipt lines** and **bill match lines** are new tables keyed on the ordered item. | Goods receipts and bills are header-only today (glossary). Subcontract bill lines (`procurement_invoice_lines`) are BoQ-keyed and capture-only. |
| D-TWM-3 | The match is **off by default for every organisation**; an Admin switches it on. Bills recorded before the switch are not matched. | "Orgs with an ERP keep their current behaviour unless the match is switched on" — and switching it on must not suddenly hold every historical bill. |
| D-TWM-4 | A held bill is **computed, not stored**. A receipt arriving (or a corrected line) releases it by itself. | No stale state; one evaluator is the only place the rule lives. |
| D-TWM-5 | Cumulative quantity counts the bills **matched before** this one (match order), so a later over-bill never holds an earlier bill. | Paying an earlier, correct bill should not wait on a later wrong one. |
| D-TWM-6 | The gate holds the **whole purchase**: while any of its bills is held, no payment is added or paid, the bill is not marked Paid and the purchase is not moved to Paid. | Native payments are recorded against the purchase (invoice reference optional), so a per-bill gate would leak. |
| D-TWM-7 | SoD: the approver is neither the bill's **author** (actor of its create audit) nor the person who **recorded its match lines**. No sole-operator escape. Unknown author ⇒ refused. | Both people set the money being released (ADR-0019; primer bucket 3). Fail closed. A sole-member org simply leaves the match off. |
| D-TWM-8 | ERP-owned purchasing, record-only purchases, ERP-mirrored bills (`erp_docstatus` set) and subcontract purchases are **out of scope** of the match, even with it switched on. | Do not change existing ERP postings; subcontract already has a stricter cap. |

## 3. Functional requirements (EARS)

- **FR-TWM-001** (settings) — Where an organisation's Admin sets the three-way match, the system shall store on/off, a
  quantity tolerance and an amount tolerance (each 0–100 %), stamp the switch-on time when it turns on, and audit the
  change. Any other role shall be refused.
- **FR-TWM-002** (scope) — The system shall match a bill only while: the organisation's match is on; the bill was
  recorded at or after the switch-on time; the purchase is neither subcontract nor record-only; purchasing is not owned
  by an ERP; and the bill is PMO-native and live (not ERP-mirrored, cancelled or voided).
- **FR-TWM-003** (receipt lines) — When a receipt writer (Admin, Executive, Project Manager, Finance) records a goods
  receipt's lines, the system shall replace that receipt's lines with one quantity per ordered item of the same
  purchase, refusing unreadable input, an item named twice, an item of another purchase, an ERP receipt and a
  subcontract purchase.
- **FR-TWM-004** (bill lines) — When a bill writer (Admin, Executive, Project Manager, Finance) records a bill's match
  lines, the system shall replace them (quantity and rate per ordered item), record who recorded them, and refuse the
  same inputs as FR-TWM-003 and any bill whose exception was approved.
- **FR-TWM-005** (the match) — The system shall hold a bill in scope when it has no match lines, or when for any line:
  the item is not on the order; the quantity billed so far exceeds the received quantity, or the ordered quantity, by
  more than the quantity tolerance; or the billed rate exceeds the order rate by more than the amount tolerance; or when
  the bill's pre-tax amount differs from the sum of its lines by more than the amount tolerance.
- **FR-TWM-006** (status) — The system shall report each bill's match as `not_applicable`, `matched`, `held` or
  `exception_approved`, with the reasons per line and for the bill, to the roles that may read bills.
- **FR-TWM-007** (the gate) — While a purchase has a held bill, the system shall refuse (SQLSTATE `MH001`) any new
  payment on it, any payment moving to Paid, the held bill moving to Paid and the purchase moving to Paid — whichever
  writer attempts it.
- **FR-TWM-008** (exception) — When an Admin or Finance user approves a held bill's exception with a reason (1–1000
  characters), the system shall record who, when, why and the match as it stood, audit it, release the hold, and freeze
  the bill's lines. An exception is permanent and approved once.
- **FR-TWM-009** (SoD) — If the approver is the bill's author or the person who recorded its match lines, or the
  bill's author is not recorded, then the system shall refuse the approval (`42501`).

## 4. Non-functional requirements

- **NFR-TWM-001 Tenancy** — every new table has forced RLS (select only, own org, active member, parent visible);
  `org_id` is stamped by the definers, never the client. Cross-org reads and writes return not-found.
- **NFR-TWM-002 Enforcement in the database** — the rule, gate and SoD live in SQL (one evaluator, triggers, a
  security-definer RPC), proven by pgTAP and an in-transaction mutation check of the shipped functions.
- **NFR-TWM-003 Concurrency** — every line writer, the exception approval and the gate lock the purchase row first (the
  same order as `a0_payments_lock_procurement`); an organisation without the match never takes the gate's lock.
- **NFR-TWM-004 Reversibility** — `rollback/1018_three_way_match_down.sql`, refused while an approved exception exists.
- **NFR-TWM-005 No ERP change** — nothing writes to an ERP; ERP-owned purchasing behaves exactly as before.

## 5. Acceptance criteria (owning layer: pgTAP, `supabase/tests/three_way_match.test.sql` unless noted)

- **AC-TWM-001** Given an organisation, When a non-Admin sets the match Then it is refused; When an Admin sets an
  out-of-range tolerance Then it is refused; When an Admin switches it on Then the tolerances and switch-on time are stored.
- **AC-TWM-002** Given 60 received and the match on, When a bill for 80 is recorded Then it is held (over-received)
  and no payment can be added to the purchase, through the RPC or a direct write.
- **AC-TWM-003** Given 80 received of 100 ordered at the order rate, When the bill for 80 is evaluated Then it is
  matched and the purchase can be paid.
- **AC-TWM-004** Given a 5 % quantity tolerance and 80 received, When bills bring the cumulative total to 83 Then it is
  matched, and at 85 Then that later bill is held while the earlier one stays matched; receipt-line input is validated.
- **AC-TWM-005** Given a 2 % amount tolerance, When a rate is 4 % over the order rate Then the line shows a price
  variance; When the bill amount is 10,000 off its lines Then it is held for an amount mismatch.
- **AC-TWM-006** Given the match on, When a bill with no match lines is recorded Then it is held (no lines).
- **AC-TWM-007** Given a bill held over-received, When the missing receipt is recorded Then the bill is matched with no
  exception.
- **AC-TWM-008** Given a held bill, When an Executive or Project Manager approves Then refused; When no reason Then
  refused; When a matched bill is approved Then refused; When an eligible Admin approves with a reason Then the
  exception is recorded (who, why, the match as it stood), audited, permanent, approved once, the lines freeze, and
  with every hold released the purchase can be paid.
- **AC-TWM-009** Given a held bill, When its author or the person who recorded its lines approves Then refused
  (separation of duties); When the bill's author is not recorded Then refused.
- **AC-TWM-010** Given bills recorded before the switch, subcontract bills, an ERP-owned organisation with the match on,
  and an organisation that never switched it on, Then none is matched and their payments behave as before.
- **AC-TWM-011** Given a held bill, Then the bill cannot be marked Paid, the purchase cannot be moved to Paid, and an
  earlier scheduled payment cannot be paid.
- **AC-TWM-012** Grants and tenancy: anon cannot execute the RPCs; the evaluator and gate are not client-executable;
  clients cannot write match rows; another org cannot read or approve; an Engineer cannot read bill matches.
- **AC-TWM-013** (owning test `supabase/tests/three_way_match_mutation.test.sql`) With the SoD line removed from the
  shipped approval the author can approve, and with the over-received rule removed from the shipped evaluator an
  over-billed purchase can be paid — so AC-TWM-009 and AC-TWM-002 bind to the shipped code.

## 6. Open questions for the Director / owner

- **OQ-TWM-1** Default: off for every organisation (D-TWM-3). Should organisations with no ERP get it on by default?
- **OQ-TWM-2** ERP organisations: with the match on, ERP-owned purchasing is still not matched (D-TWM-8). Should the
  ERPNext pre-send check (#2411) consult `bill_match_evaluate` instead? That is an edge-function change on the money
  path — a separate ticket.
- **OQ-TWM-3** Screens: this slice is database-only. The bill and receipt screens need a lines editor, a match panel
  and an "Approve exception" action (repository seam + `can()` gate + `restructure`) — the next slice.
- **OQ-TWM-4** A sole-member organisation cannot approve an exception (no sole-operator escape, unlike the bill void).
