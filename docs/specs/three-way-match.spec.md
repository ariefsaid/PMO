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
- **AC-TWM-014** Given the match on and a held bill on a purchase, When a reader (Admin, Executive, Project Manager,
  Finance) opens the purchase, Then the held bill is named with "Review match", and its match panel shows the status,
  the reasons and per line ordered, received, billed to date, order rate and bill rate. Owner: RTL
  `pages/procurement/BillMatchDrawer.test.tsx`, `pages/procurement/ProcurementLedger.threeWayMatch.test.tsx`.
- **AC-TWM-015** Given a held bill, When Finance or an Admin approves the exception with a reason Then it is sent to
  `approve_bill_match_exception`; an Executive or Project Manager is offered no approval; a separation-of-duties
  refusal is explained. Owner: RTL `pages/procurement/BillMatchDrawer.test.tsx` (the rule itself: AC-TWM-008/009 pgTAP).
- **AC-TWM-016** Given a held purchase, When a payment is refused (MH001) Then the message names the three-way match
  hold and the way forward, in English and Bahasa Indonesia. Owner: unit `pages/procurement/threeWayMatchError.test.ts`.

## 6. Open questions for the Director / owner

- **OQ-TWM-1** Default: off for every organisation (D-TWM-3). Should organisations with no ERP get it on by default?
- **OQ-TWM-2** ERP organisations: with the match on, ERP-owned purchasing is still not matched (D-TWM-8). Should the
  ERPNext pre-send check (#2411) consult `bill_match_evaluate` instead? That is an edge-function change on the money
  path — a separate ticket.
- **OQ-TWM-3** Screens. *Partly closed (#2622):* the match panel per bill (status, reasons, per-line ordered /
  received / billed, tolerances, the exception record), "Approve exception" (`can('approve','billMatch')`: Admin,
  Finance; SoD in the RPC) and the translated payment-hold refusal ship over `get_bill_match` and
  `approve_bill_match_exception` (AC-TWM-014..016). *Closed by #2634 (section 7):* the Admin on/off + tolerance setting and the receipt- and bill-lines editors.
- **OQ-TWM-4** A sole-member organisation cannot approve an exception (no sole-operator escape, unlike the bill void).

## 7. Follow-up #2634 — Admin setting screen and the line editors

Status: draft for Director review · Map #2516 · Money path (ships alone) · Migration `1357_three_way_match_edit_states.sql`
· Plan `docs/plans/2026-11-21-bill-match-settings.md`

**Job story.** When a vendor bill is held for missing lines, I want to switch the match on, set its tolerance and fix
the lines in the app, so a held bill clears without an exception.

The database already carries the setting writer (`set_three_way_match_settings`, Admin only, 1018 section 8), the two line
writers (`record_receipt_match_lines`, `record_bill_match_lines`, 1018 sections 9 and 10), tenancy and the gate. This
follow-up adds the screens over them, one database change (edit states) and the proofs.

### 7.1 Decisions taken (the Director may overturn any)

| ID | Decision | Why |
|---|---|---|
| D-TWM-10 | The setting screen is a section of **Administration > Accounting setup**, beside the other procurement controls. No new tab or route. | The match is a purchasing control the Admin already configures there; the org settings shell is reused. |
| D-TWM-11 | Lines may be edited only while money has not been posted on them: a **Paid** bill's lines, and the receipt lines of a **Paid** or **Cancelled** purchase, are refused in the database. Today 1018 allows both. | Editing the evidence under a paid bill would change what was matched after the money moved. The edit states belong to the writers, not the screen. |
| D-TWM-12 | Re-recording a bill's lines keeps making the editor the recorder (1018 behaviour, D-TWM-7): whoever fixes a held bill can no longer approve its exception. Receipt edits carry no SoD (a receipt is a physical fact, written by the receipt roles) but are audited with the lines before and after. | Fixing is the intended path out of a hold; the exception is the reviewed path, so the fixer must not also approve. |
| D-TWM-13 | Nothing is switched on by this change. The row is created only when an Admin saves the setting. | OD-SCOPE: new behaviour is off until an organisation setting turns it on. |

### 7.2 Settings

| Setting | Where | Default |
|---|---|---|
| Three-way match on or off | Administration > Accounting setup > Three-way match | Off (no row = off) |
| Quantity tolerance, percent, 0-100 | same | 0 |
| Amount tolerance, percent, 0-100 | same | 0 |

### 7.3 Default-off statement

An organisation that never saves the setting has no settings row; every bill evaluates `not_applicable`, no payment is
held, and no existing screen, rule or test changes. The new editors are offered only while the match is on and the bill is
in scope (FR-TWM-002). The new refusals of D-TWM-11 apply to the two line writers, which nothing calls today and which
refuse an out-of-scope bill anyway, so an organisation without the match sees no difference.

### 7.4 Functional requirements (EARS)

- **FR-TWM-010** (settings screen) — Where the user is an Admin, the system shall show the match setting in Accounting
  setup with on or off and the two tolerances, show the saved values, save through `set_three_way_match_settings`, and
  explain that bills recorded before switching on are not matched. Any other role shall see the saved values read-only
  or nothing, and the database shall refuse their write (FR-TWM-001).
- **FR-TWM-011** (receipt-lines editor) — While the match is on and the purchase is in scope, the system shall let a
  receipt writer set, per goods receipt, the quantity received per ordered item, showing the current lines, and send them
  through `record_receipt_match_lines`; a refusal shall be explained in the user's language.
- **FR-TWM-012** (bill-lines editor) — While the match is on and the bill is in scope and not Paid and has no approved
  exception, the system shall let a bill writer set, per bill, the quantity and rate per ordered item (pre-filled from the
  order), send them through `record_bill_match_lines`, and show the resulting match at once so a bill that now matches
  clears its hold with no exception.
- **FR-TWM-013** (edit states) — If a bill is Paid, then the system shall refuse to replace its match lines
  (`23514`, detail `three-way-match-posted`); if a purchase is Paid or Cancelled, then the system shall refuse to
  replace its receipts' lines (same code). An approved exception keeps freezing the bill's lines (FR-TWM-004).
- **FR-TWM-014** (audit) — When lines are replaced, the system shall audit the lines before and after.

### 7.5 Acceptance criteria

- **AC-TWM-017** (pgTAP `supabase/tests/three_way_match_settings.test.sql`) Given an Executive, Project Manager, Finance
  user and an Engineer, When any sets the match Then refused (`42501`) and the settings row is unchanged; When an Admin of
  another organisation sets it Then only their own row changes; When an Admin saves it Then it is stored and audited.
- **AC-TWM-018** (same file) Given a Paid bill, When its match lines are recorded Then refused (`three-way-match-posted`),
  and the lines are unchanged; Given a Paid or Cancelled purchase, When a receipt's lines are recorded Then refused.
- **AC-TWM-019** (same file) Given a held bill (over-received) and the match on, When the receipt lines are raised to
  cover it, or the bill's lines are corrected, Then the bill is matched with no exception row and the purchase can be paid.
- **AC-TWM-020** (same file) Given a bill whose lines a second user re-recorded, Then that user cannot approve its
  exception and the first user can only if eligible (SoD follows the last recorder); an audit row holds the lines before and after.
- **AC-TWM-021** (mutation, `supabase/tests/three_way_match_edit_mutation.test.sql`) With the Admin check removed from the
  shipped settings writer a Finance user can set it; with the Paid-bill refusal removed from the shipped bill-lines
  writer a Paid bill's lines change; with the Paid-or-Cancelled refusal removed from the receipt-lines writer a Paid
  purchase's receipt lines change. The assertions of AC-TWM-017/018 therefore bind to the shipped code.
- **AC-TWM-022** (RTL `pages/admin/OrgThreeWayMatch.test.tsx`) Given an Admin, Then the section shows the saved state (off when
  never saved) and saving sends on/off and both tolerances; invalid tolerances are refused before sending; a non-Admin
  is offered no save; a refusal is explained; English and Bahasa Indonesia.
- **AC-TWM-023** (RTL `pages/procurement/MatchLinesEditor.test.tsx`, `ProcurementLedger.matchLines.test.tsx`) Given the match on, Then
  the editors list the purchase's ordered items, validate (quantity above zero, no item twice, rate not negative), send
  exactly the RPC payload, hide for roles without write, for a Paid bill and for an approved exception, and show the new match.
- **AC-TWM-024** (curated e2e `pmo-portal/e2e/serial/AC-TWM-024-bill-match-settings.spec.ts` (serial lane: it switches the org-wide match on)) An Admin switches the match on in
  Accounting setup, a held bill's lines are corrected in the app, and the bill clears with no exception.
- **AC-TWM-025** (RTL, same files as AC-TWM-022/023) Both new surfaces render at phone and desktop width with no overflow;
  checked by the saved captures under `docs/evidence/1215/2634/`.

### 7.6 Owner rulings on the open questions (closed)

- **OQ-TWM-5 closed (D-TWM-14).** Receipt edits carry **no separation of duties**; the audit of the lines before and
  after is the control. Reason: small teams enter both the bill and the receipt, and a rule would block them; the
  exception (the reviewed path) keeps its SoD.
- **OQ-TWM-6 closed (D-TWM-15).** An Admin may switch the match off while bills are held (Admin-only, audited by the
  settings writer). The screen shows a notice naming how many bills are held now, before the Admin confirms. The count
  comes from `three_way_match_held_count()` (security-definer read, Admin only, own organisation), added in 1357 (FR-TWM-015).
- **FR-TWM-015** (held count) — Where the user is an Admin, the system shall return how many bills of the organisation
  are held now, and refuse any other role (`42501`). Proven by AC-TWM-017 and bound by the mutation check AC-TWM-021.
