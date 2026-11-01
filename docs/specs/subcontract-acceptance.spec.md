# Subcontract acceptance, caps and variations (SCA)

Issue #1513 (route item T2, `docs/plans/2026-10-30-epc-odoo-build-route.md`). Extends decision #1489 (owner
rulings 2026-10-30) and ADR-0094. Status: **draft for owner sign-off; no implementation before sign-off.**
Executor on sign-off: Director-dispatched (money / SoD).

**Job story.** When a subcontractor reports work done against a subcontract purchase order, I want the
quantity verified on a signed Berita Acara (acceptance record) to be the only thing the vendor bill can claim
— never more than the PO allows — so the project never pays for volume nobody verified or nobody approved
spending on, and any verified excess stays visible until it is approved or disputed.

## Owner rulings this encodes (#1489, 2026-10-30)

1. A subcontract PO carries BoQ lines. Each period a signed acceptance records verified quantities, reusing the
   client-side acceptance shape (ADR-0091).
2. Two caps on a vendor bill: billable quantity ≤ verified quantity and ≤ PO quantity.
3. Need above the PO found **before** the work: site raises a request → the existing budget-backed spend
   approval (requester ≠ approver; budget revision first if it does not fit) → procurement issues a PO revision
   → acceptance and bill may then go to the new quantity. Site never negotiates with the vendor.
4. Work already done above the PO: the acceptance records everything verified; the excess is shown as
   *verified, not on PO* and is unpayable until a variation is approved (then payable) or rejected (vendor
   dispute).
5. Client pass-through: when the extra is client-chargeable, the existing client side handles it (re-measured
   volume above BoQ is claimable; a new client work order covers it). PMO **links** the cost variation to it so
   it is visible whether a variation was passed on.

## Scope

In:
- BoQ lines on a subcontract purchase order (quantity, unit, rate) and a per-line cumulative view: PO qty,
  verified qty, billed qty, payable remaining, verified-not-on-PO.
- Subcontract acceptance: prepare → confirm (signed Berita Acara document attached), cumulative, immutable once
  confirmed, withdrawable while draft. Same lifecycle and RPC pattern as client work-order acceptance (ADR-0091).
- Server-enforced vendor-bill caps at the point a vendor invoice with quantities is captured, and again at the
  point it is pushed to the ERP.
- Variation: a request that rides the existing procurement spend approval route, a PO revision record on
  approval, and a dispute state on rejection.
- A read-only link from a cost variation to an existing client work order (or "not passed on").
- Mirror of the approved PO revision and bill to the ERP through the adapter contract (§ ERP posting).

Out of scope (follow-ups, not built here):
- Retention / holdback on subcontract bills, advance payment recovery on subcontract (separate money rules).
- Auto-creating the client work order or client claim from a variation (T2 only links; creation stays on the
  shipped client path).
- Price (rate) variations; this spec varies **quantity** only. Rate changes need a revised PO and spend approval
  by the same route but no cap logic beyond the amount; handled as a plain PO revision, not a variation line.
- Vendor-portal or vendor-signed acceptance; the signature is a scanned/attached signed document, as client BAST.
- Blanket re-measurement of past client-side data; bulk import of subcontract BoQ (guided CLI load is a follow-up).
- Odoo-side behaviour beyond the adapter contract; Odoo parity is by the same canonical command, validated in O2.

## Terms

- **Subcontract PO** — a `purchase_orders` row whose purchase is flagged subcontract (OQ-1) and which has lines.
- **PO line** — new; quantity of one BoQ work item on that PO at a rate.
- **Verified quantity** — cumulative quantity on the latest Confirmed acceptance for a PO line.
- **Billed quantity** — sum of quantities on non-cancelled captured vendor invoice lines for that PO line.
- **Payable quantity** (per line) = `min(verified, PO qty) − billed`, floored at 0.
- **Verified, not on PO** (per line) = `max(verified − PO qty, 0)`.
- **Variation** — a request to raise PO quantity (and hence spend) on one or more lines.
- **PO revision** — a numbered record of PO line quantities replacing the prior effective set; earlier revisions
  stay readable.

## Functional requirements (EARS)

### PO lines and revisions
- **FR-SCA-001** The system shall let a Project Manager, Finance or Admin add BoQ lines (BoQ item, quantity > 0,
  rate ≥ 0, unit) to a Draft subcontract PO, and shall total them into the PO amount.
- **FR-SCA-002** When a PO is Issued, the system shall freeze its revision-1 lines; later change shall only be by
  a PO revision (FR-SCA-021).
- **FR-SCA-003** Where a subcontract PO has lines, the system shall derive the PO amount from the effective
  revision and shall refuse a hand-edited amount that disagrees (fail closed).

### Acceptance
- **FR-SCA-010** The system shall let the project's PM or Finance rank+ prepare a subcontract acceptance
  (period date, per-line cumulative verified quantity, optional note) against an Issued subcontract PO.
- **FR-SCA-011** When confirming an acceptance, the system shall require a same-project signed Berita Acara
  document with a file, and shall record the confirmer and basis (`standard` | `sole_operator`).
- **FR-SCA-012** If the confirmer is the preparer, the system shall refuse unless the confirmer is the sole
  active org member by the exact 0298 predicate (same as ADR-0091).
- **FR-SCA-013** The system shall accept verified quantities above the PO quantity on a line (work already done)
  and shall never block the acceptance for that reason; it shall show them as *verified, not on PO*.
- **FR-SCA-014** The system shall refuse a verified quantity lower than the latest confirmed cumulative for that
  line, except through withdrawal of a Draft (confirmed rows are immutable).
- **FR-SCA-015** Confirmed acceptances and their lines shall be immutable; clients read under RLS and hold no
  direct DML grants.

### Bill caps
- **FR-SCA-020** When a vendor invoice is captured against a subcontract PO with lines, the system shall require
  line quantities and shall refuse any line whose cumulative billed quantity would exceed
  `min(verified, PO qty)` (error `SC001`, naming line, verified, PO qty, billed).
- **FR-SCA-021** The cap shall be checked under a per-PO advisory lock so two concurrent captures cannot both
  consume the same headroom.
- **FR-SCA-022** The cap shall be re-checked at ERP push; if a guard cannot evaluate, it shall refuse, not pass.
- **FR-SCA-023** A line's unit rate on the bill shall not exceed the PO rate; the bill amount shall equal
  quantity × rate for each line plus tax (rate/price disputes are a plain rejection, not a variation).
- **FR-SCA-024** Cancelling a captured invoice shall release its quantity back to billed headroom.

### Variation
- **FR-SCA-030** When site needs quantity above the PO before doing the work, the system shall let any project
  member raise a variation request (lines, additional quantity, reason) linked to the PO.
- **FR-SCA-031** The system shall route the variation through the existing spend approval resolver
  (`spend_approval_route`, ADR-0075) on the additional amount, with requester ≠ approver and the budget-line
  headroom check; if it does not fit the budget line, it shall route to the senior set as shipped.
- **FR-SCA-032** On approval, a procurement-role user shall issue a PO revision that raises PO line quantities by
  the approved amounts; the revision shall be refused if it exceeds the approved quantities or amount.
- **FR-SCA-033** When a revision is issued, the per-line cap shall use the new PO quantity immediately; billed
  headroom shall be recomputed from the effective revision.
- **FR-SCA-034** If the extra work was already done (verified > PO qty), the system shall let a user open a
  variation from the *verified, not on PO* amount; on approval and revision, that excess becomes payable up to
  the new PO quantity; on rejection, it shall move to **Disputed** and remain visible, still unpayable.
- **FR-SCA-035** The system shall show per PO and per project the total *verified, not on PO* value and the
  Disputed value.
- **FR-SCA-036** The variation shall reuse the approver ≠ requester and author ≠ approver SoD of
  `transition_procurement`; the revision issuer shall not be the variation's approver unless sole operator.

### Client pass-through link
- **FR-SCA-040** The system shall let a PM or Finance link a variation to one existing client work order on the
  same project, or mark it "not passed on" with a reason.
- **FR-SCA-041** The system shall show, on the variation and on the work order, the link state; it shall not
  create or change the work order, claim or invoice.

### Visibility
- **FR-SCA-050** The PO detail shall show, per line: PO qty, verified, billed, payable now, verified-not-on-PO.
- **FR-SCA-051** The invoice capture form for a subcontract PO shall pre-fill payable quantity per line (editable
  down, never above payable), and shall state the cap in words when a line is at zero.

## Data model sketch (names indicative; eng-planner finalises)

Reuse, do not fork: `purchase_orders`, `procurement_invoices`, `boq_items`, `project_documents`,
`work_order_acceptances` shape, `spend_approval_route`, `transition_procurement`.

| Table | Key columns | Notes |
|---|---|---|
| `purchase_order_lines` | `po_id`, `revision`, `boq_item_id`, `quantity numeric(14,3)`, `rate numeric(14,2)`, `unit` | Same project as the PO's procurement; unique `(po_id, revision, boq_item_id)`. Rows are immutable after the revision is Issued. |
| `purchase_order_revisions` | `po_id`, `revision int`, `status` (Issued), `variation_id`, `issued_by`, `issued_at` | Latest = effective. Revision 1 created at PO issue. |
| `subcontract_acceptances` | like `work_order_acceptances` but `po_id`; status Draft/Confirmed/Withdrawn; `prepared_by`, `confirmed_by`, `confirm_basis`, `document_id` | Header immutable once Confirmed. No final/closing in this slice (OQ-5). |
| `subcontract_acceptance_lines` | `acceptance_id`, `po_line_boq_item_id`, `quantity` | Cumulative verified qty; primary key `(acceptance_id, boq_item_id)`. |
| `procurement_invoice_lines` | `invoice_id`, `boq_item_id`, `quantity`, `rate` | Only for subcontract POs; sum must reconcile to invoice net. |
| `po_variations` | `po_id`, `lines jsonb`/child table, `reason`, `origin` (`pre_work` \| `post_work`), `status` (Requested/Approved/Revised/Rejected/Disputed), `requested_by`, `approved_by`, `work_order_id null`, `not_passed_reason null` | Approval state delegates to the shipped procurement spend approval; this table holds line detail and link. |

Server-only writes via audited SECURITY DEFINER RPCs (`prepare_/confirm_/withdraw_subcontract_acceptance`,
`request_po_variation`, `issue_po_revision`, cap check inside the shipped invoice-capture path). FORCE RLS on all,
org stamped by default/trigger (never from the client), children inherit tenancy through their parent
(ADR-0091 pattern), RLS-reachable columns checked against `role_table_grants`. Reversible migration.

Derived read (one summary RPC as the read seam, indexed / pre-aggregated, ADR-0091): per PO line
`po_qty`, `verified`, `billed`, `payable`, `verified_not_on_po`, with null → unknown, never fabricated 0.

## Roles and separation of duties

| Action | Who | SoD |
|---|---|---|
| Add / edit PO lines (Draft) | PM, Finance, Admin | existing procurement write matrix |
| Prepare acceptance | project PM or Finance rank+ (`may_record_project_progress`) | — |
| Confirm acceptance | Admin / Finance | preparer ≠ confirmer unless sole operator (0298) |
| Capture vendor bill with lines | existing invoice-capture roles | cap enforced regardless of role |
| Raise variation | any project member | — |
| Approve variation | per spend approval route | requester ≠ approver; budget headroom or senior set |
| Issue PO revision | procurement role (PM/Finance/Admin) | issuer ≠ variation approver unless sole operator |
| Link to client work order | PM, Finance | — |

`can()` gates UX only; RLS and the RPCs are the authority (ADR-0016/0019). Money-path mutation test required:
break the cap (`allowed := true`) and the SC001 tests must go red.

## ERP posting via the adapter contract

PMO owns the acceptance, the cap and the variation process (ADR-0094, ADR-0059: PMO-SoT side mirror). The ERP
owns the vendor bill document, ledger and payment. No ERP-side custom field or module is required.

- **PO revision → ERP.** ERPNext: amend is cancel + new Purchase Order; Odoo: edit the purchase order
  quantities. Both go through a canonical adapter command `purchase-order.revise` carrying `po_id`, `revision`
  and the full effective line set, sent through the money outbox with an idempotency key derived from
  `(po_id, revision)`: one PMO revision mints at most one ERP revision. Recovery follows ADR-0058; PO is an
  immutable-anchor kind that may reissue on an inconclusive probe, but a revision after a bill exists must
  never cancel a PO that has a submitted bill (guard fails closed).
- **Vendor bill → ERP.** The cap is enforced in PMO **before** the existing purchase-invoice command is
  enqueued and re-evaluated at claim time (FR-SCA-022). The ERP does not enforce the verified cap (it has no
  notion of Berita Acara); PMO is the only gate. An ERP-origin bill linked in later (ADR-0093) that exceeds the
  cap is shown as a reconciliation exception, not silently adopted as payable.
- **Acceptance** is not posted to the ERP (PMO-owned process). If the ERP route later needs a receipt, it is a
  separate follow-up (stock/service receipt per O2).
- **Standalone mode (no ERP):** all caps and revisions work from PMO tables alone; nothing waits on #1505.
  Connected mode is blocked by #1505 (O2, purchase through payment); this spec defines the command, #1505
  delivers the transport for both ERPNext and Odoo parity.
- Uncertain outcomes are shown as such (queued / held / failed), never as ERP success (ADR-0094).

## Non-functional requirements

- **NFR-SCA-001 Money correctness.** All quantity math numeric(14,3), money numeric(14,2); rounding per line
  `round(qty × rate, 2)`; property tests for cap invariants (billed ≤ min(verified, PO) over random sequences).
- **NFR-SCA-002 Concurrency.** Cap check and revision issue take advisory locks (PO scope); locking order
  documented; a pgTAP proves the mechanism, a two-session test proves the interleave where feasible.
- **NFR-SCA-003 Tenancy.** `org_id` seam on every table; service-role paths (sweep, webhook) enforce org scoping
  themselves.
- **NFR-SCA-004 Fail closed.** A cap that cannot be evaluated (missing acceptance read, unreadable PO lines)
  refuses the bill.
- **NFR-SCA-005 Honest numbers.** Summary reads bounded below `max_rows`; no `$0` fabricated from a failed read.
- **NFR-SCA-006 Auditability.** Every prepare/confirm/withdraw/request/approve/revise/link writes an audit event.
- **NFR-SCA-007 Reversibility.** Down migration documented; revisions and acceptances are exported before drop.
- **NFR-SCA-008 UI.** Existing primitives (`EntityFormModal`, `ConfirmDialog`), DESIGN.md tokens, all states;
  UI issues need rendered review per the UI lane.

## Acceptance criteria (Given / When / Then)

- **AC-SCA-001** Given a PO line of 100 and a confirmed acceptance of 120, when a bill for 120 is captured, then
  it is refused with SC001 naming verified 120, PO 100, billed 0; a bill for 100 is accepted; payable now = 0
  after it; *verified, not on PO* = 20 remains visible. *(Issue acceptance.)*
- **AC-SCA-002** Given verified 120 > PO 100 and a rejected variation, then the 20 shows Disputed and a bill for
  101 is refused.
- **AC-SCA-003** Given verified 120, PO 100 and an approved variation to 120 with an Issued revision 2, when a
  bill for the remaining 20 is captured, then it is accepted; no SoD step was bypassed (requester ≠ approver,
  issuer ≠ approver, proven by refusing each violation).
- **AC-SCA-004** Given verified 80 and PO 100, when a bill for 90 is attempted, then it is refused (verified
  cap); a bill for 80 is accepted.
- **AC-SCA-005** Given a pre-work variation request that exceeds the budget line, when it is routed, then it goes
  to the senior set (shipped rule), and the requester cannot approve it.
- **AC-SCA-006** Given a Draft acceptance prepared by A, when A confirms it in an org with other active members,
  then refused; when a different Finance/Admin confirms with a signed document, then Confirmed and immutable
  (update/delete refused 42501/23514). Sole active member confirms with basis `sole_operator`.
- **AC-SCA-007** Given two concurrent captures each for the last 10 of headroom, then exactly one succeeds.
- **AC-SCA-008** Given a captured bill later cancelled, then its quantity returns to payable.
- **AC-SCA-009** Given a rejected or Draft acceptance's quantities, then they never raise payable (only latest
  Confirmed counts).
- **AC-SCA-010** Given a variation linked to a client work order on another project, then the link is refused;
  same project is accepted and shown on both sides; "not passed on" requires a reason.
- **AC-SCA-011** Given a connected ERP and a revision issue that fails mid-way, then recovery produces at most
  one ERP revision per PMO revision and the UI shows queued/held, not success.
- **AC-SCA-012** Given a PO revision after a submitted bill, when the ERP revise would cancel the billed PO, then
  the command is refused (fail closed).
- **AC-SCA-013** Given a mixed org, a user of org B cannot read org A's acceptances, lines, variations or
  revisions (isolation probe).
- **AC-SCA-014** Given the cap guard mutated to always allow, then AC-SCA-001/004 tests go red (mutation check).
- **AC-SCA-015** Given a subcontract PO, then the PO detail shows per-line PO / verified / billed / payable /
  verified-not-on-PO and the totals reconcile to the invoice lines.

## Traceability (owning layer, ADR-0010)

| AC | Layer |
|---|---|
| 001, 002, 003, 004, 007, 008, 009, 014 | pgTAP (cap RPC + concurrency + mutation) |
| 005, 006, 010, 013 | pgTAP (SoD / RLS / tenancy) |
| 011, 012 | Deno (adapter-dispatch guard + outbox recovery) |
| 015 | Vitest/RTL (render all states) |
| one curated journey | Playwright: prepare → confirm → capture bill → refusal → variation → revision → bill |

## Open questions (owner signs; each has a recommended default)

1. **OQ-1 How is a PO marked "subcontract"?** Recommended: an explicit flag on the purchase (`is_subcontract`),
   set at creation; caps apply only when the PO has lines.
2. **OQ-2 Do ordinary (non-subcontract) POs get the same caps?** Recommended: no; subcontract only now; goods
   remain on receipts. Revisit after T1 inventory.
3. **OQ-3 Is a variation a new procurement or part of the same PO purchase?** Recommended: part of the same
   purchase, a child variation record riding the same spend approval route on the additional amount.
4. **OQ-4 Who issues the PO revision?** Recommended: PM/Finance/Admin with issuer ≠ approver unless sole operator.
5. **OQ-5 Is there a final acceptance that closes the subcontract (like final client BAST)?** Recommended: not in
   this slice; a PO is closed manually; final acceptance with closing value is a follow-up.
6. **OQ-6 Are rate (price) changes in scope?** Recommended: no; quantity only; rate change is a plain PO
   revision by spend approval.
7. **OQ-7 Verified excess not approved and not rejected for a long time?** Recommended: stays *verified, not on
   PO* (unpayable) with age shown; no automatic expiry.
8. **OQ-8 Cap on tax and retention?** Recommended: cap is quantity on pre-tax lines; retention is out of scope.
9. **OQ-9 Should acceptance be postable to the ERP as a receipt?** Recommended: no, PMO-owned; revisit in O2.
10. **OQ-10 Bills linked in from the ERP that exceed the cap?** Recommended: shown as a reconciliation exception;
    payment refused from PMO until cleared by variation or credit note.

## Follow-ups

Retention on subcontract bills; final acceptance with closing value; subcontract BoQ bulk load; automatic
client work-order draft from a variation; vendor-side portal acceptance; stock/service receipt in the ERP.
