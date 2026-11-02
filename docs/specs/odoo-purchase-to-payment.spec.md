# Spec — Odoo: purchase through payment (O2, #1505)

- **Status:** Draft for owner sign-off (2026-11-02). Owner approval of this spec is required before any build. Defaults in §0 mirror the shipped ERPNext path (owner ruling 2026-10-31: Odoo defaults MIRROR ERPNext; one adapter contract + contract tests).
- **Route:** EPC prospect build route (#1481), item O2 of `docs/plans/2026-10-30-epc-odoo-build-route.md`, extends #1319. **Blocked by** O1 (#1504, shipped). Blocks T2 when connected to an ERP.
- **Executor tier:** money / SoD ⇒ every slice that commits money is **Director-dispatched per issue** and ships alone (§12, plan).
- **Grounds (read, not re-derived):** ADR-0055 (adapter contract, stock JSON-RPC only, zero Odoo customisation), ADR-0058 (money outbox, held-not-reissued), ADR-0059 (process ownership, side mirror), ADR-0082 (withholding: gross stays gross, withheld is its own figure), ADR-0094 (PMO is the only interface); `docs/money-path-primer.md`; the O1 spec and plan (`docs/specs/odoo-connect-master-data.spec.md`, `docs/plans/2026-10-31-odoo-connect-master-data.md`); the ERPNext procurement path (`docs/specs/erpnext-adapter.spec.md` §5.10, `vendor-payment-from-pmo.spec.md`, `vendor-withholding.spec.md`, `procurement-flexible-entry.spec.md`); the shared seam (`pmo-portal/src/lib/adapterSeam/{contract,dispatch,refs}.ts`, `connect/workflows.ts`, `contractSuite/*`), `supabase/functions/adapter-dispatch`; bed report `docs/research/2026-10-31-odoo20-dev-bed-verification.md`.
- **ID scheme:** `FR-OPP-###`, `NFR-OPP-###`, `AC-OPP-###`, `DD-OPP-#` (decisions taken here), `OQ-OPP-#` (owner decisions), `V-OPP#` (Odoo claims to verify on the dev bed).
- **Layer letters** (ADR-0010): **U** unit (Vitest/Deno, mocked transport), **P** pgTAP, **B** the Odoo dev bed (gated on its dependencies, never on `CI`, as the O1 bed tests are), **E** curated Playwright journey.

---

## 0. Owner decisions (each with the default taken if unanswered, and what breaks if the default is wrong)

Every open question is here. Defaults mirror ERPNext unless the row says Odoo's facts force otherwise.

| # | Decision | Default taken (mirrors ERPNext unless noted) | Named failure if the default is wrong |
|---|---|---|---|
| **OQ-OPP-1** | Does PMO **post** the goods receipt in Odoo (validate the incoming transfer), or only mirror receipts that warehouse staff validate in Odoo? | **PMO posts it** (ERPNext: PMO pushes the Purchase Receipt). PMO is the only interface (ADR-0094). | If it should only mirror: PMO books stock in Odoo for goods nobody confirmed physically arrived, and Odoo's stock valuation moves on a PMO click. |
| **OQ-OPP-2** | Partial receipt. | **Allowed.** The unreceived remainder stays open on the Odoo order; PMO never creates or cancels a backorder itself beyond what Odoo's own validation does for a partial quantity. | Wrong: a short delivery strands an orphan backorder, or closes the line and bills for goods never received. |
| **OQ-OPP-3** | Bill matched to the order (three-way match) or a free-standing bill? | **Matched when the bill names a PMO purchase order:** bill lines carry the order-line link so Odoo's billed quantity and "to invoice" status track. A bill with no order is free-standing (ERPNext: the bill references the PO). | Wrong: the Odoo order shows "to invoice" forever, or PMO and Odoo disagree on billed quantity and a second bill passes unnoticed. |
| **OQ-OPP-4** | Which taxes (PPN input VAT, PPh 23 / 4(2) withholding) go on a bill? | **PMO always sends explicit tax ids chosen from the mirrored tax directory** (O1); with no choice, PMO resolves the company's default purchase tax from the mirror and validates it **before** any write (ERPNext #915: default template looked up and validated first). Odoo's hidden per-product / per-partner defaults are never relied on. | Wrong: Odoo applies a tax PMO did not show; PMO's read-back figure differs from what the user approved. The write is refused as a mismatch (FR-OPP-044), not silently kept. |
| **OQ-OPP-5** | Odoo's own purchase double-validation setting. | **Must be off** (the stock default). PMO's spend-approval routing is the approval. If it is on and an order lands in "to approve", PMO shows "waiting for approval inside Odoo", does **not** call the approve method, and the push is reported as not complete. | Wrong (auto-approving instead): PMO's approver and Odoo's approver are the same click, so Odoo's own control is bypassed. Wrong (this default): orders stick in "to approve" until an admin turns the setting off. |
| **OQ-OPP-6** | Payment journal (which bank or cash book the money leaves). | **An org default chosen once in setup** (auto-proposed when the org has exactly one bank journal, bulk-accepted like the O1 defaults), overridable per payment by Finance from the mirrored journal directory. Needs journals added to the O1 read model (§11). | Wrong: a payment posts from the wrong bank book, the cash ledger is wrong, and a reversal is an accountant task in Odoo. |
| **OQ-OPP-7** | Payment shape. | **One payment settles one bill, in full or in part, never above the bill's outstanding;** on-account / advance payments refused (ERPNext #910). | Wrong: finance cannot run one bank transfer for five bills. |
| **OQ-OPP-8** | PMO-initiated cancellation or reversal of a posted bill or payment. | **Not in O2.** PMO revises an order (FR-OPP-016) and mirrors anything cancelled in Odoo; a posted bill or payment is reversed by an Odoo accountant (credit note, payment reversal) and PMO shows the result. | Wrong: a mistaken bill cannot be reversed from PMO, which contradicts "PMO is the only interface"; needs a follow-up slice. |
| **OQ-OPP-9** | Currency. | **Company currency only,** as ERPNext. A document in another currency is refused before any write with a named reason. | Wrong: a foreign-currency vendor cannot be billed from PMO. |
| **OQ-OPP-10** | An order, bill or payment document ends **held** (Odoo's anchor fields are editable by Odoo users). | **Bills and payments hold on an inconclusive recovery** (ERPNext holds payments only; its bill anchor is immutable, Odoo's is not, so bills move to the stricter class). Orders and receipts reissue only on conclusive absence, otherwise hold. Admin and Finance resolve held rows (adopt the Odoo document, or confirm it never existed). | Wrong (too strict): more held rows an operator must clear. Wrong (too loose): a duplicate bill or a double payment. |
| **OQ-OPP-11** | Status latency. | **Sweep-only is the acceptance bar** (the 5-minute tick) plus an immediate re-read after PMO's own write. Webhook nudges stay optional (OQ-ODC-3). | Wrong: users see an Odoo-side receipt up to five minutes late. |
| **OQ-OPP-12** | An item line whose unit is not mapped (O1 unit map). | **Refused before any write,** naming the unit. | Wrong: unusual-unit lines block the whole order until an Admin maps the unit. |
| **OQ-OPP-13** | A purchase that was started before the Odoo connection existed (cutover). | **No later step is pushed** and an unknown answer refuses (ERPNext `cutover.purchase`, #1601). Such a purchase is linked, not pushed (FR-OPP-083). | Wrong: Odoo gets a bill or payment for an order it never saw, or the same order twice. |

---

## 1. Problem and job stories

**Problem.** O1 gave PMO a connection to a stock Odoo Community and its mappings (partners, items, units, cost accounts, warehouses, accounts, taxes). It moves no money. The prospect buys through PMO (site request → approval → vendor → order), but the order, the receipt, the vendor bill and the payment must land in Odoo's ledger with the project's cost account on them, once each, and PMO must show what Odoo actually holds.

**Job stories.**
- *When purchasing has approved an order, I want it to appear in Odoo as a confirmed order for the right vendor, items and project, exactly once, so the warehouse and accounting work from the same record.*
- *When goods arrive at site, I want to record the receipt in PMO and see the quantity Odoo booked, so stock and the order's received quantity agree.*
- *When a vendor bill arrives, I want to enter it against the order with the taxes and withholding it carries, and see the VAT, the tax withheld and the net payable Odoo computed, so I pay the right amount.*
- *When I pay the vendor, I want one payment against the bill, by someone other than the approver, and the bill to close as paid only when Odoo says so.*
- *When a call times out or Odoo is down mid-way, I want PMO to say "not confirmed yet", never post a second bill or a second payment, and recover on its own or tell me exactly what needs a person.*

## 2. Scope and out of scope

**In scope.** For an org whose `procurement` domain is employed under tier `odoo` (and the org has an activated Odoo binding): push a PMO purchase order (create and confirm) and a revision of it; push a goods receipt (validate the incoming transfer for the received quantities); push a vendor bill (create and post) with VAT and withholding taxes and the project's cost account; push a vendor payment against a bill (create, post, reconcile); read every Odoo purchase document back into PMO's mirror and derive PMO statuses from the Odoo state; link existing Odoo purchase documents without double counting; cutover and activation gates; PMO screens for the status, the Odoo outcome, held rows and the withholding figures; the contract-suite declarations for these workflows.

**Out of scope (owned elsewhere or deferred).** Client invoices and collections (O3 #1506); journal-line actuals and statements (O4 #1507); stock transfers, issues and consumption (O5 #1508); cash journals (O6); hours (O7); fleet (O8); subcontract acceptance caps (T2); user-defined roles (R1 #902); PMO-initiated reversal of a posted bill or payment (OQ-OPP-8); multi-currency (OQ-OPP-9); advance payments (OQ-OPP-7); RFQ and quotation documents (they stay PMO-only on Odoo, as no stock Odoo model is required for them: PMO's case folder keeps them, ERPNext's RFQ push is not mirrored); e-Faktur and PPh slips from Odoo (a separate tax-register concern, as #898 for ERPNext); landed costs; returns to vendor; Odoo Enterprise, Online or custom modules (NFR-OPP-008).

**Hard constraints carried.** Stock JSON-2 API only, zero Odoo customisation (ADR-0055 §2, ADR-0094); Odoo's ledger is the oracle and PMO mirrors its money, never recomputes it (ADR-0048); an unconfirmed outcome is shown as unconfirmed (ADR-0094, NFR-ODC-006); one PMO record mints at most one Odoo document, ever (money-path primer); SoD unchanged (FR-OPP-060).

## 3. Domain terms

Existing terms (`docs/glossary.md`) unchanged. This spec adds no new term; it reuses **anchor**, **held**, **outbox**, **watermark**, **cost account**, **account defaults**, **capability snapshot** from ADR-0058 / O1.

Odoo terms used (stock models, **verify each on the bed**): `purchase.order`, `purchase.order.line`, `stock.picking`, `stock.move`, `account.move` (`move_type = in_invoice`), `account.move.line`, `account.payment`, `account.journal`, `account.tax`, `account.analytic.account`. PMO terms above the adapter contract are unchanged (NFR-ODC-009): purchase order, goods receipt, vendor invoice, payment.

## 4. Data ownership (ADR-0055, ADR-0059, ADR-0094)

| Data | Source of truth | PMO holds | Writable from PMO? |
|---|---|---|---|
| Purchase request, RFQ, quotation, vendor selection, spend approval, case folder | **PMO** | existing tables | Yes (unchanged) |
| Purchase order (document, lines, state) | **PMO authors, Odoo holds the ledgered document** (posture as ERPNext: the order is pushed, the ERP state is mirrored) | `purchase_orders` + `external_refs` + `erp_*` mirror columns | Created and revised by PMO command only; ERP state fields are machine-written |
| Goods receipt (the transfer and its stock moves) | **Odoo** (stock owner) | `procurement_receipts` mirror | PMO command posts it; quantities and state come back from Odoo |
| Vendor bill (amounts, taxes, withheld, outstanding, posted state) | **Odoo** (accounting oracle) | `procurement_invoices` mirror, `withheld_amount`, `erp_outstanding_amount` | PMO command creates and posts it; money fields are read back, never recomputed |
| Vendor payment | **Odoo** | `payments` mirror | PMO command; payer attribution stamped by PMO |
| Chart of taxes, accounts, journals, units, items, cost accounts | **Odoo** (O1 read model) | `external_master_records` | No |
| Who approved, who paid, who entered (SoD stamps) | **PMO** | existing columns | Server-stamped |

A mirrored copy is never a second source of truth. An edit made in Odoo's own UI is legitimate and arrives through the feed.

---

## 5. Requirements (EARS)

### 5.1 Enablement, gating and cutover

- **FR-OPP-001** — The system SHALL treat `procurement` as an ownership-flipping domain for tier `odoo`, employed per org by the same guarded verb as ERPNext (`admin_change_domain_ownership`), only when the org has an **activated** Odoo binding (ADR-0073) and the capability snapshot shows `purchase.order`, `purchase.order.line`, `stock.picking`, `stock.move`, `account.move`, `account.payment` and `account.journal` present and usable by the key.
- **FR-OPP-002** — While the binding is not activated, the kill-switch is off, or the capability snapshot lacks a model a push needs, no procurement command SHALL reach Odoo; the refusal SHALL be classified, name the missing item, and make no ERP call (`cutover.activation`, fail closed).
- **FR-OPP-003** — When a purchase was started before the connection (or its start cannot be determined), the system SHALL push no later step of it; the answer "unknown" SHALL refuse (`cutover.purchase`). Such a purchase SHALL instead be linked to its Odoo documents (FR-OPP-083) when they exist.
- **FR-OPP-004** — Every procurement command SHALL pass, before the outbox row and before any Odoo call: the caller's role gate, the org-scoped link ownership check (a case, vendor or bill belonging to another tenant refuses with `cross-org-link-rejected`, `erpCalls = 0`), the payment SoD gate (FR-OPP-060), and the project-resolution gate (FR-OPP-020). The gates SHALL be keyed on the command's PMO shape, not on the tier name, so one implementation serves ERPNext and Odoo.

### 5.2 Purchase order

- **FR-OPP-010** — When a PMO purchase order is approved for push, the system SHALL create the Odoo order in one command: vendor (the O1-mapped partner), company, currency check (OQ-OPP-9), expected receipt date, one line per PMO item (O1-mapped product, quantity, unit price, mapped unit, taxes per FR-OPP-040) and `analytic_distribution` `{"<cost account id>": 100}` on every line, then confirm it. The system SHALL send the vendor reference and PMO case number in stock text fields so the Odoo order is traceable to the case.
- **FR-OPP-011** — The system SHALL stamp the command's idempotency key into one stock text field on the order that PMO does not otherwise use (the **anchor**; candidates and verification in V-OPP2), and SHALL recover an interrupted create by probing that anchor.
- **FR-OPP-012** — Create and confirm are two Odoo calls and not one transaction. A command that completes the create and not the confirm SHALL be completed by the next attempt reading the order's state: a draft order with our anchor is confirmed, a confirmed one is adopted, never created again (NFR-OPP-005).
- **FR-OPP-013** — If Odoo leaves the confirmed order in "to approve" (OQ-OPP-5) the system SHALL record the order as pushed-not-approved, show the named reason on the case, SHALL NOT call the approve method, and SHALL NOT report the order as issued.
- **FR-OPP-014** — A PMO order line whose item, unit or vendor has no O1 mapping SHALL refuse before any write, naming the unmapped thing (OQ-OPP-12). PMO SHALL NOT create the missing item or partner silently; the user maps it (O1 screens) or sends it (O1 `item.send`, `party.send`).
- **FR-OPP-015** — The order's total in PMO SHALL be the figure Odoo reports after the create (`amount_total`), shown with the PMO-entered figure when they differ, never silently replaced (ADR-0048).
- **FR-OPP-016** — When a PMO order is revised (`purchase-order.revise`, #1513), the system SHALL send the **effective line set of that revision once, keyed `porev:<po id>:<revision>`** by editing the confirmed Odoo order's lines. It SHALL refuse a revision that would take any line's ordered quantity below the quantity already received or billed in Odoo, SHALL never cancel an order that has a receipt or a bill, and SHALL be refused outright (no write) when Odoo's state is cancelled or done. Odoo's edit-in-place makes this the "edit-style tier" that the shipped guard anticipates (`reviseCancels` false for tier `odoo`); the guard SHALL be driven by a per-tier flag, not a literal.
- **FR-OPP-017** — A held order (OQ-OPP-10) SHALL block revise and every later step for that case until an operator resolves it.

### 5.3 Project analytics

- **FR-OPP-020** — The system SHALL resolve the project's cost account through the O1 shared resolver (FR-ODC-102) before any purchase write; an unlinked project, or a link in *needs attention*, SHALL refuse the push with a named reason and no Odoo call. No default account, no guess.
- **FR-OPP-021** — The cost account SHALL be carried on every order line and every bill line (`analytic_distribution`, key a string id, value 100). Lines SHALL NOT be split across projects in O2; a PMO case with several projects is refused (a later slice owns splits).
- **FR-OPP-022** — Once an order has any Odoo document reference (an `external_refs` row for the case), un-linking or re-linking the project SHALL be refused through the single shared check (FR-ODC-073).
- **FR-OPP-023** — A bill created from an order SHALL inherit the order line's distribution; a bill with no order SHALL carry the project's account from FR-OPP-020. The bill's read-back SHALL be checked: if a posted bill line lacks the project's cost account the system SHALL flag the bill *needs attention: cost account missing* and SHALL NOT report the project cost as booked.

### 5.4 Goods receipt

- **FR-OPP-030** — When a user records a goods receipt on a pushed order, the system SHALL validate the order's incoming transfer for the quantities entered: set the done quantity per move, validate, and read the transfer back. The receiving warehouse is the order's (the O1 default receiving warehouse when the order names none).
- **FR-OPP-031** — A receipt quantity above the open quantity of the line SHALL be refused before any write (OQ-OPP-2); a partial quantity validates the received part and leaves the remainder open on Odoo's side.
- **FR-OPP-032** — Validation can return a wizard step (backorder or immediate transfer) in stock Odoo. The adapter SHALL complete the stock wizard with the answer "create backorder" for a partial receipt and nothing for a full one, using stock calls only (V-OPP4); if the stock calls cannot complete it, the capability is reported *unavailable* and the receipt is refused, never worked around with a module (NFR-OPP-008).
- **FR-OPP-033** — Receipt idempotency SHALL rest on the transfer's state: validating a transfer already done SHALL be treated as adopted, not repeated; a retry after a lost response SHALL read the order's received quantities and compare them to the command, adopting when they equal the command's cumulative quantity and holding when they differ (OQ-OPP-10).
- **FR-OPP-034** — PMO SHALL show the quantity Odoo booked per line, and the order's received status derived from Odoo (FR-OPP-081), not the quantity the user typed.

### 5.5 Vendor bill and withholding

- **FR-OPP-040** — When a user records a vendor bill, the system SHALL send the vendor's invoice number as the bill's vendor reference and the vendor's invoice date, plus due date, lines (quantity, price, mapped unit), explicit tax ids (OQ-OPP-4), the order-line link when the bill names an order (OQ-OPP-3) and the project's cost account (FR-OPP-023), then post it. PMO SHALL NOT use the vendor reference as the anchor (it is a user-visible business field).
- **FR-OPP-041** — Create and post are two calls; completion follows FR-OPP-012's rule: a draft bill with our anchor is posted, a posted one is adopted, never created again.
- **FR-OPP-042** — Before any write, the system SHALL validate the chosen tax set from the **mirrored** tax directory, refusing with `config-rejected` naming the tax (never the company or an account): any withholding tax whose rate is negative-and-above-100%, a set whose withholding rates sum to 100% or more, a withholding tax with no liability account, a tax inactive or belonging to another company, a purchase-scope mismatch. A PPh-only set (withholding, no VAT) is well formed. (Mirror of ERPNext DD-VWH-4 in Odoo terms; the bed decides which fields express it, V-OPP6.)
- **FR-OPP-043** — After posting, the system SHALL read the bill's money from Odoo and store, in PMO's existing columns (ADR-0082 shape): gross = the vendor-invoice total before withholding, VAT = the positive tax lines, **withheld = the magnitude of the negative (withholding) tax lines**, net payable = gross − withheld (derived, never stored), outstanding = Odoo's residual amount verbatim. A payload missing any part of the money header SHALL leave the money unwritten, not guessed (DD-VWH-2/5).
- **FR-OPP-044** — The read-back total SHALL be compared with the figure PMO sent. A difference larger than the currency's smallest unit SHALL mark the bill *needs attention: Odoo computed a different total* and SHALL NOT mark it payable until a person confirms; nothing is deleted or reversed automatically.
- **FR-OPP-045** — A bill belonging to a case SHALL not exceed what PMO's existing ceilings allow (`procurement_payment_within_ceiling` and the order cap); the check is PMO's own database rule, applied before the write, unchanged.
- **FR-OPP-046** — The bill's status in PMO SHALL be *Paid* only when Odoo's residual amount is zero and the move is posted (FR-OPP-081).

### 5.6 Vendor payment

- **FR-OPP-050** — A vendor payment SHALL be created against exactly one posted bill, for an amount greater than zero and not above the bill's outstanding net payable (withholding is not owed to the vendor, DD-VWH-3); no bill reference, an unposted bill, a closed case or another currency SHALL refuse before any write.
- **FR-OPP-051** — The command SHALL create the outbound supplier payment in the chosen journal (OQ-OPP-6) with the vendor, the date and a memo carrying the anchor, post it, and reconcile it to the bill's payable line, using stock calls (the payment register wizard or the line reconcile method, V-OPP7). A payment created and not posted, or posted and not reconciled, SHALL be completed by the next attempt reading its state, never created again.
- **FR-OPP-052** — The payment's anchor is **mutable** (an accountant can edit a memo). A recovery probe SHALL adopt only a unique match on the anchor **or** on the deterministic conjunction (outbound, vendor, bill, amount, date window); zero or more than one match after the recovery window SHALL **hold** the command and SHALL NOT reissue (ADR-0058 C-1).
- **FR-OPP-053** — The payer SHALL be stamped by PMO from the verified JWT subject and never from the payload.
- **FR-OPP-054** — After a payment, PMO SHALL show the bill as Paid only after the next Odoo read shows its residual at zero (FR-OPP-081); between the payment and that read the bill SHALL show "payment sent, awaiting Odoo".

### 5.7 Separation of duties and authorization

- **FR-OPP-060** — Separation of duties SHALL be unchanged and server-enforced for tier `odoo`: the payer cannot be the case's approver or the person who entered the bill (SoD-b, the shipped `payment_gate` and the database `transition_procurement` rule); a closed case refuses first (`purchase_closed`), then SoD (403), then `procurement_payment_allowed`, then the ceiling, in the shipped order and with the shipped wording, so a client cannot tell which tier answered.
- **FR-OPP-061** — Roles that may push orders, receipts, bills and payments SHALL be exactly those the ERPNext tier allows today (the shipped `can()` actions and dispatch role gate), with no widening for Odoo. `can()` is UX only; the dispatch gate and RLS are the authority (ADR-0016).
- **FR-OPP-062** — The caller's own JWT identity SHALL decide author-versus-approver; a payload `approved_by`, `author` or `paid_by` field SHALL be ignored.
- **FR-OPP-063** — Held-row resolution (adopt, or confirm absent) SHALL be restricted to Admin and Finance, SHALL write an audit row naming the actor, and SHALL be unavailable to the user who created the held command.

### 5.8 Idempotency, failure and retry

- **FR-OPP-070** — Every Odoo-writing procurement command SHALL go through the shared money outbox (`dispatchMoneyWrite` with the DB-backed deps), so one PMO record mints at most one Odoo document: a generation-fenced claim, the commit, a finalize that records the external reference and the mirror, and a confirm. The idempotency key SHALL be stable across the user's retries (never per click).
- **FR-OPP-071** — Outcome classes SHALL be honest and distinct: *confirmed* (Odoo read-back matches), *pending* (sent, not yet read back), *failed-no-document* (conclusive absence), *held* (inconclusive; needs a person), *refused* (before any call). A timeout, a 5xx or a lost response SHALL be *pending* until a probe settles it, and SHALL NOT be shown as success or as failure.
- **FR-OPP-072** — Recovery SHALL be the next sweep tick or the user's retry re-running `dispatchMoneyWrite` (PQ-10 of the O1 plan): a past-lease `committing` row is quarantined, the anchor is probed, and the row is linked, reissued (only where conclusive absence is allowed) or held. There is no second recovery path.
- **FR-OPP-073** — The numeric relationships of the money-path primer SHALL hold for the Odoo tier: reclaim window > claim budget + request deadline + settle margin; per-attempt deadline × attempts < any lock or clearance that guards it; SoD clearance TTL > the longest an Odoo post can still be in flight; any read cap < the platform row cap. A test SHALL assert each relationship for the Odoo constants.
- **FR-OPP-074** — A 429 / rate-limit or transient failure SHALL retry with the shared bounded policy; a validation error from Odoo SHALL classify as `commit-rejected` with a user-safe reason and SHALL never echo Odoo's body or traceback.
- **FR-OPP-075** — Cancelling a PMO command mid-flight is not offered; a user "retry" reuses the key and so cannot mint a second document.

### 5.9 Read-back, status reconciliation and link-existing

- **FR-OPP-080** — The system SHALL read purchase documents from Odoo into PMO's mirror by the O1 watermark mechanism (`write_date`, id, overlap window, advance after durable apply), per domain: orders, transfers, bills (vendor bills only), payments (outbound supplier only), plus a census for deletions. Each page SHALL be applied by a service-only function that checks the `org_id` of the verified binding, never one from the payload (NFR-ODC-002).
- **FR-OPP-081** — Derived PMO statuses SHALL come from Odoo state, never from PMO's own record: order — draft/sent/to-approve → *Draft*, purchase/done → *Issued*, cancel → *Closed* with the cancellation tombstone (as ERPNext docstatus 2); receipt — transfer done → *Complete*, anything else → *Partial*; bill — posted with residual zero → *Paid*, otherwise *Received*; payment — posted. Cancelled documents SHALL be marked cancelled, never deleted from PMO (#1350).
- **FR-OPP-082** — A bill's money and derived status SHALL refresh from any inbound change that carries the whole money header; a change missing part of it SHALL write none of it (DD-VWH-5).
- **FR-OPP-083** — **Link existing.** Odoo purchase documents that PMO did not create (an order from the Odoo UI, a bill from before the connection) SHALL be mirrored once each at their newest figures and SHALL be attachable to a PMO purchase case without double counting (#1319): a document linked to a case counts once in the case's value, a document listed twice in Odoo counts once, and a document with a PMO anchor but no `external_refs` row (an orphan from a crash) SHALL be proposed for adoption, never created again.
- **FR-OPP-084** — The mirror writers (sweep and webhook nudge) are service-role and SHALL enforce org scoping themselves; the mirror columns SHALL be unwritable by a user JWT (the shipped procurement mirror guard, extended).
- **FR-OPP-085** — A document that disappears from Odoo (hard delete, invisible to the feed) SHALL be found by the census and tombstoned in PMO, never silently counted.

### 5.10 PMO screens

- **FR-OPP-090** — The procurement ledger and case screens SHALL show, per order, receipt, bill and payment, the **Odoo outcome class** (FR-OPP-071) in plain words, the age of the last read, and the next step for *pending*, *held*, *needs attention* and *refused* rows.
- **FR-OPP-091** — While the connection is not healthy (O1 FR-ODC-032/033), purchase screens SHALL keep the last mirrored data with its age; a PMO action that needs Odoo SHALL fail honestly ("Odoo is unreachable, try again") and SHALL NOT be queued.
- **FR-OPP-092** — A bill with tax withheld SHALL show VAT, tax withheld and net payable under its amount (DD-VWH-6, ADR-0082); a bill with none renders exactly as today.
- **FR-OPP-093** — The bill form SHALL offer taxes from the mirrored tax directory and the payment form the mirrored journals; both disabled with a reason when the directory is empty or stale.
- **FR-OPP-094** — A held row SHALL be listed for Admin and Finance with the two resolve actions (FR-OPP-063).
- **FR-OPP-095** — Screens SHALL use the shared form primitives and tokens, `ConfirmDialog` for the money actions, `classifyMutationError`, i18n keys in both `en` and `id`, and reflect the real JWT role (impersonation view-only).

---

## 6. Non-functional requirements

- **NFR-OPP-001 (one document per record)** — Under any interleaving of retries, timeouts, sweeps and crashes, one PMO record mints at most one Odoo document. Proof: the outbox mechanism (P), the recovery tests (U), the bed interruption tests (B).
- **NFR-OPP-002 (tenancy)** — Every table is `org_id`-scoped; service-role writers enforce scope themselves; a two-org test proves org A's push, sweep and recovery cannot read or write org B's rows or documents.
- **NFR-OPP-003 (confidentiality)** — The API key never leaves the server function; no Odoo body, traceback, host or database name appears in a response, log, audit row or test title (public repo, NFR-ODC-010).
- **NFR-OPP-004 (ledger is the oracle)** — PMO mirrors Odoo's money; it never recomputes totals, taxes, withheld or outstanding (ADR-0048). Mismatch is flagged (FR-OPP-044), never reconciled by overwriting.
- **NFR-OPP-005 (resumable multi-step)** — Every two-step command (create+confirm, create+post, create+post+reconcile) completes from any interruption point by reading Odoo state; the steps are state-checked, so a replay is a no-op.
- **NFR-OPP-006 (honesty)** — No screen or response describes an unconfirmed Odoo outcome as success (NFR-ODC-006).
- **NFR-OPP-007 (parity)** — ERPNext and Odoo pass the same procurement contract suites (`purchase.push`, `bill.push`, `vendor-payment.push`, `purchase.link-existing`, `cutover.purchase`, `cutover.activation`, `purchase-order.revise`); a behaviour a shared suite asserts changes both tiers or bumps the workflow version (`connect/workflows.ts`).
- **NFR-OPP-008 (no customisation)** — Works on stock Community with no custom or third-party module and no Studio change; a capability that needs one is reported *unavailable*.
- **NFR-OPP-009 (no Odoo vocabulary above the contract)** — Odoo model and field names live only under `adapterSeam/odoo/**` and the edge functions wrapping it (AC-ODC-083 guard extended).
- **NFR-OPP-010 (reversibility)** — Migrations (slots 0505–0509 only) are reversible with a `rollback/` down script and additive to shared tables.
- **NFR-OPP-011 (accessibility)** — WCAG AA, keyboard operation, 320 px width on the new states.
- **NFR-OPP-012 (public-repo hygiene)** — Synthetic hosts, databases, vendors and amounts only; no prospect identity.

---

## 7. Design decisions taken here (`DD-OPP-#`)

- **DD-OPP-1 — Same domain, same seam, no second dispatch path.** Tier `odoo` registers a resolver and an outbox resolver in `adapter-dispatch` (the registry that "a new ERP tier registers its resolver here"), reusing `dispatchMoneyWrite`. The guards (authorisation, SoD, payment gate, link ownership, project gate, revise guard) become tier-agnostic; ERPNext behaviour stays byte-for-byte (proved by its existing suites).
- **DD-OPP-2 — Four Odoo documents, not one command.** Order, receipt, bill and payment are separate commands with separate keys and anchors, as ERPNext's PO, PR, PI, PE. A step never creates its predecessor.
- **DD-OPP-3 — Two-call commands are state machines.** The adapter reads state first (`draft`, `purchase`, `posted`, `done`) and performs only the missing call. The outbox claim covers the whole command, not each call.
- **DD-OPP-4 — Anchors.** Candidates only; **V-OPP2** decides per model from fields that survive Odoo's own write hooks. Rules: never a business field the user sees as such (vendor reference, invoice number); one stock text field per model; every anchor is treated as editable (C-1) except where the bed proves it is system-owned.
- **DD-OPP-5 — Withholding as negative tax lines.** Stock Indonesian localisation expresses withholding as negative purchase taxes; Odoo's total is therefore already net of withholding. PMO derives gross and withheld from the tax lines and keeps ADR-0082's columns, so the screens and ledger are unchanged.
- **DD-OPP-6 — Journals join the O1 read model.** A `journal` kind (`account.journal`, type bank/cash, company, active) is added to the master-data mirror (one more parser, no new table, DD-ODC-4).
- **DD-OPP-7 — Status is read, not set.** PMO writes no purchase status from its own click once the domain is employed; the sweep and the post-write re-read derive it (ADR-0059).
- **DD-OPP-8 — Guards before outbox.** A refused command leaves no outbox row and touches no ERP (the shipped posture of every gate).
- **DD-OPP-9 — Revise is edit-in-place.** Odoo lets a confirmed order's lines be edited until it is locked; the strict ERPNext cancel-and-amend is not needed. The per-tier flag keeps the "never cancel a billed order" rule true for both.

## 8. Authorization and separation of duties

| Action | Roles allowed | Server enforcement |
|---|---|---|
| Push order, revise | exactly the roles ERPNext allows today | dispatch role gate + link ownership + project gate |
| Record receipt | same as ERPNext receipt | same; plus quantity guard |
| Record bill | same as ERPNext bill | same; plus tax validation, ceiling |
| Record payment | Finance (as ERPNext) | `payment_gate` SoD-b, `procurement_payment_allowed`, ceiling; payer from JWT |
| Resolve a held row | Admin, Finance; never the creator | RPC actor check + audit |
| Set payment journal default | Admin, Finance | actor-checked config RPC (O1 pattern) |
| Read purchase mirror | active org members per existing RLS | unchanged |

**SoD.** Approver ≠ payer, and the user who entered the bill ≠ payer, are unchanged and enforced server-side before the outbox row, on a DB re-read, with the caller id from the verified JWT. The Odoo tier adds no way around them: the dispatched payment IS the money release, so the gate sits on the dispatch (the #910 reasoning). A mapping or journal-default edit never rewrites a posted document; the user who sets the default is recorded.

## 9. Verify on the dev bed (`V-OPP#`)

Closed by plan slice P0 on the stock bed (`scripts/odoo-dev-bed.sh`, under `scripts/with-odoo-lock.sh`) before any code depends on them. Each claim names the code that waits on it.

| # | Claim to verify | Used by |
|---|---|---|
| V-OPP1 | `purchase.order/create` with `order_line` command tuples and `button_confirm` over JSON-2; final state; behaviour with the double-validation setting on (the "to approve" state and the approve method name). | FR-OPP-010/012/013 |
| V-OPP2 | Anchor fields: a stock char/text field on `purchase.order`, `stock.picking`, `account.move` (bill) and `account.payment` that accepts a PMO key, survives confirm/post/validate, is not rewritten by an onchange, and can be filtered with `ilike`. Candidates: order `origin` or `notes`; transfer `origin` or `note`; bill `narration` or `invoice_origin`; payment `memo`. Whether a user edit in Odoo's UI can change it. | FR-OPP-011, DD-OPP-4, OQ-OPP-10 |
| V-OPP3 | Receipt flow: confirming the order creates one incoming `stock.picking` with moves; the field that carries the done quantity in 20; `button_validate` return value when complete; with a partial quantity; behaviour with a lot/serial-tracked product. | FR-OPP-030/031/032 |
| V-OPP4 | The backorder / immediate-transfer wizard can be completed with stock model calls (create the wizard record with context, `process`), or `button_validate` accepts a context that skips it. If not, receipt of a partial quantity is reported unavailable. | FR-OPP-032 |
| V-OPP5 | Bill create with `invoice_line_ids` carrying `purchase_line_id` links and `analytic_distribution`; the bill's `invoice_origin`, the order's billed quantity and `invoice_status` after posting; `action_post`; double `action_post` on a posted move (error or no-op). | FR-OPP-040/041/023 |
| V-OPP6 | Indonesian localisation taxes on the bed: purchase-scope PPN and PPh 23 / PPh 4(2) with their amount sign, `price_include`, the tax's repartition account type (liability), and how `amount_total`, `amount_tax`, `amount_residual` and the tax lines (`tax_line_id`, `tax_base_amount`) express a withholding bill. What the read-back needs to derive gross, VAT and withheld exactly, to the cent. | FR-OPP-042/043, DD-OPP-5 |
| V-OPP7 | Payment: `account.payment` create (outbound, supplier, journal, method line), `action_post`, reconcile with the bill via the register wizard (context `active_model`, `active_ids`) or via `account.move.line` `reconcile`; the bill's `payment_state` and `amount_residual` afterwards, including `in_payment` before bank reconciliation; partial payment; payment above the residual (error or overpay). | FR-OPP-050/051/054, FR-OPP-081 |
| V-OPP8 | Date/time and ordering of `write_date` on the four purchase models and the sweep filters (`move_type = in_invoice`, `payment_type = outbound`, `partner_type = supplier`) as O1's V10/V14 did for master kinds. | FR-OPP-080 |
| V-OPP9 | Updating a confirmed order's lines (add, change quantity, remove) via `write` with line commands; the lock state that refuses it; the error when quantity falls below received or billed. | FR-OPP-016 |
| V-OPP10 | Which of these calls are refused to a minimally-privileged service user, and the smallest group set that passes all of them (extends O1 S0-T13); recorded for the runbook (NFR-ODC-003). | FR-OPP-001, runbook |
| V-OPP11 | The error body shape for a validation error on each call (to classify without echoing). | FR-OPP-074 |

## 10. Acceptance criteria

Each AC has exactly one owning layer. Where a second layer appears it is secondary evidence.

### Enablement, gates, cutover
- **AC-OPP-001 (FR-001, 002; U+B)** — *Given* a not-activated binding, the kill-switch off, or a snapshot missing `account.payment`, *when* any procurement command is sent, *then* it is refused with a classified, item-naming reason and **zero** Odoo calls. *B secondary:* the stock bed is not wrongly refused.
- **AC-OPP-002 (FR-003; U)** — *Given* a purchase started before the connection, started after it, and one whose start is unknown, *when* a receipt, bill or payment is pushed, *then* the first and last are refused with zero calls and the second is accepted (the shared `cutover.purchase` suite, Odoo half).
- **AC-OPP-003 (FR-004; U)** — *Given* a case, vendor or bill that belongs to another tenant or does not exist, *when* a push runs, *then* it refuses `cross-org-link-rejected` with zero calls; the same case for its own tenant is accepted (shared `purchase.push`/`bill.push`/`vendor-payment.push` suites, Odoo half).
- **AC-OPP-004 (FR-001; P)** — *Given* each role and an Operator, *when* the employ-procurement verb is called under a user JWT, *then* only the roles that may employ a domain succeed, and an org with an active ERPNext binding is refused.

### Purchase order
- **AC-OPP-010 (FR-010, 011; B)** — *Given* the bed, a mapped vendor, item, unit and a linked project, *when* an approved order is pushed, *then* exactly one confirmed Odoo order exists with the vendor, lines, quantities, prices and every line's cost-account distribution, and the case shows it *Issued* with Odoo's total.
- **AC-OPP-011 (FR-012, NFR-005; U)** — *Given* a fault after the create and before the confirm, a fault after the confirm, and a lost response, *when* the command is retried, *then* each ends with one confirmed order and no second create (fake Odoo records every call).
- **AC-OPP-012 (FR-013; U)** — *Given* an Odoo that leaves the order in "to approve", *when* pushed, *then* the case shows "waiting for approval inside Odoo", the approve method was never called, and the order is not *Issued*.
- **AC-OPP-013 (FR-014; U)** — *Given* a line with an unmapped item, unit or vendor, *when* pushed, *then* it refuses before any write naming the unmapped thing, and nothing is created in Odoo.
- **AC-OPP-014 (FR-020, 021; U)** — *Given* an unlinked project, a needs-attention link, and a case with two projects, *when* pushed, *then* each refuses with zero calls and a named reason.
- **AC-OPP-015 (FR-015; U)** — *Given* Odoo reports a total different from PMO's, *then* both figures show and PMO's stored total is not replaced.
- **AC-OPP-016 (FR-016; B)** — *Given* a confirmed order with a partial receipt, *when* revision 2 raises one line, lowers another above the received quantity, and a third revision lowers a line below the received quantity, *then* the first two apply once and the third is refused with no write; replaying revision 2 changes nothing; an order with a bill is never cancelled.
- **AC-OPP-017 (FR-016; D)** — *Given* the revise guard with a tier flag, *when* tier `odoo` (edit-in-place) and tier `erpnext` (cancel-and-amend) are evaluated for a billed order, *then* both refuse a cancel, and only `erpnext` evaluates the cancel path.

### Project analytics
- **AC-OPP-020 (FR-023; B)** — *Given* a posted bill raised from an order and a free-standing bill, *then* both bills' lines carry the project's cost account; *given* a bill whose line lacks it, *then* the bill shows *needs attention: cost account missing*.
- **AC-OPP-021 (FR-022; U+P)** — *Given* a case with any Odoo reference, *when* the project is un-linked or re-linked, *then* it is refused through the shared check (U for the logic, P owns the database refusal).

### Goods receipt
- **AC-OPP-030 (FR-030, 034; B)** — *Given* a confirmed order for 10 and 4 units, *when* a receipt of 6 and 4 is recorded, *then* Odoo's transfer is done for 6 and 4, PMO shows the booked quantities from Odoo, and the stock on hand in Odoo rose by 6 and 4.
- **AC-OPP-031 (FR-031, 032; B)** — *Given* an order for 10, *when* 6 are received, *then* the order is partially received, 4 remain open on a backorder, and a later receipt of 4 completes it; *when* 11 is entered, *then* it is refused with no write. If V-OPP4 shows the wizard cannot be completed with stock calls, this AC is replaced by AC-OPP-031b: a partial receipt is refused as *unavailable* with the named reason.
- **AC-OPP-032 (FR-033; U)** — *Given* a lost response after the validate, *when* the receipt is retried with the same cumulative quantities, *then* the transfer is adopted and stock is not booked twice; *given* different quantities, *then* the command is held.

### Vendor bill and withholding
- **AC-OPP-040 (FR-040, 041; B)** — *Given* an order and a bill of 100 with VAT 11% and PPh 23 2% on a service line, *when* recorded, *then* one posted Odoo bill exists with the vendor's invoice number as its reference and the vendor's date, and PMO shows gross, VAT, withheld and net payable equal to Odoo's.
- **AC-OPP-041 (FR-041, NFR-005; U)** — *Given* a fault between create and post, and a lost response, *when* retried, *then* exactly one posted bill results.
- **AC-OPP-042 (FR-042; U)** — *Given* tax sets that are malformed (withholding with no liability account, rates summing to 100%, inactive, another company's, wrong scope) and well-formed (VAT only, PPh only, both), *when* validated from the mirror, *then* the first five refuse naming the tax and the last three pass, with zero Odoo calls for the refusals.
- **AC-OPP-043 (FR-043, 082; U)** — *Given* a bill payload with the whole money header, one missing the residual, and one with no withholding lines, *then* the first writes gross/VAT/withheld/outstanding, the second writes none of them, and the third records withheld 0 (stated, not defaulted).
- **AC-OPP-044 (FR-044; U)** — *Given* Odoo's total differs from the sent figure by more than the smallest unit, *then* the bill is *needs attention* and not payable until confirmed; within a rounding unit it is accepted.
- **AC-OPP-045 (FR-045; P)** — *Given* a bill above the case's ceiling, *when* recorded, *then* the database rule refuses it before the outbox row is inserted.
- **AC-OPP-046 (OQ-OPP-4, FR-040; U)** — *Given* no tax chosen, *then* the company default is resolved from the mirror and validated before the write; an Odoo that would apply a different tax triggers AC-OPP-044's mismatch path.

### Vendor payment
- **AC-OPP-050 (FR-050, 051; B)** — *Given* a posted bill with net payable 98, *when* Finance pays 98 from the chosen journal, *then* one posted supplier payment exists, reconciled to the bill, the bill's residual is 0 and PMO shows it *Paid* only after the next read; paying 40 then 58 settles it in two payments; paying 99 refuses.
- **AC-OPP-051 (FR-050; U)** — *Given* no bill reference, an unposted bill, a closed case, or a currency other than the company's, *then* each refuses before any write.
- **AC-OPP-052 (FR-051, NFR-005; U)** — *Given* a fault after create, after post, after reconcile, and a lost response, *when* retried, *then* exactly one posted, reconciled payment results and PMO shows no second payment.
- **AC-OPP-053 (FR-052; U)** — *Given* a post-window probe that finds zero matches, two matches, and a unique match on the conjunction, *then* the command is held, held, and adopted respectively; it is never reissued. *Mutation check:* making the decision always "reissue" turns this test red.
- **AC-OPP-054 (FR-053, 060, 062; D+P)** — *Given* the approver, the bill's author, and a third Finance user, *when* each pays under their own JWT (with a payload claiming a different `paid_by`), *then* only the third succeeds, the payer recorded is the JWT subject, and a refused payment leaves no outbox row and no Odoo call. *Mutation check:* setting the gate to allow turns it red.
- **AC-OPP-055 (FR-054; U)** — *Given* a payment accepted by Odoo and a read that still shows a residual, *then* the bill shows "payment sent, awaiting Odoo", not Paid.

### Idempotency and recovery
- **AC-OPP-060 (FR-070; P)** — *Given* two concurrent claims for one key, *then* exactly one proceeds (the shipped outbox mechanism, exercised with `tier = 'odoo'` rows).
- **AC-OPP-061 (FR-071, 072; U)** — *Given* a timeout, a 5xx, a 429 and a validation error, *then* they classify as pending, pending, retry-then-pending and commit-rejected respectively, and no response or log contains an Odoo body.
- **AC-OPP-062 (FR-072; B)** — *Given* the bed with its network cut after the commit and before the response (proxy kill), *when* the sweep tick runs, *then* the row is linked and confirmed with one Odoo document; *given* the anchor edited in Odoo before recovery, *then* the row ends held.
- **AC-OPP-063 (FR-073; U)** — The reclaim, deadline, clearance and read-cap relationships hold for the Odoo constants (one assertion each).
- **AC-OPP-064 (FR-063; D+P)** — *Given* a held row, *when* the creator, an engineer, Finance and Admin try to resolve it, *then* only Finance and Admin who are not the creator succeed, with an audit row.

### Read-back and link-existing
- **AC-OPP-070 (FR-080, 084; P)** — *Given* two orgs, *then* org A's user cannot write any purchase mirror column, and a service-role page apply with org B's context cannot touch org A's rows.
- **AC-OPP-071 (FR-081; U)** — *Given* order states draft, sent, to-approve, purchase, done, cancel; transfer states; bill states with residuals; *then* the derived PMO statuses are as FR-081 states, and a cancelled document is marked, not deleted.
- **AC-OPP-072 (FR-083; U)** — *Given* an ERP-native order and bill, the same bill listed twice, and an anchored orphan, *then* each is mirrored once at its newest figures (shared `purchase.link-existing` suite, Odoo half) and the orphan is proposed for adoption.
- **AC-OPP-073 (FR-085; B)** — *Given* a mirrored bill hard-deleted in Odoo, *when* the census runs, *then* it is tombstoned and no longer counted in the case's value.
- **AC-OPP-074 (FR-080; U)** — *Given* a page that fails halfway, *then* the cursor did not advance and a replay yields identical rows; a record committed late with an earlier `write_date` is picked up (the O1 sweep tests, per purchase domain).

### Screens and cross-cutting
- **AC-OPP-080 (FR-090, 091, 094; U)** — *Given* each outcome class and an unhealthy connection, *then* the ledger shows the plain-words state, the age, and the next step; actions that need Odoo fail honestly and queue nothing.
- **AC-OPP-081 (FR-092, 093; U)** — *Given* a withheld bill, a plain bill, and an empty tax or journal directory, *then* the three figures show only on the first and the pickers disable with a reason on the third.
- **AC-OPP-082 (FR-095; U)** — *Given* each role and an impersonating Admin, *then* only controls the real role may use render; i18n parity (en/id) and the axe check pass; 320 px renders without horizontal scroll.
- **AC-OPP-083 (NFR-009; U)** — The vocabulary guard fails if Odoo model or field names appear in `pmo-portal/src` outside the adapter directory.
- **AC-OPP-084 (NFR-007; U)** — `contractSuite/parity.test.ts` passes with Odoo declaring `purchase.push`, `bill.push`, `vendor-payment.push`, `purchase.link-existing`, `cutover.purchase`, `cutover.activation` and `purchase-order.revise` **supported**, each at the suite's current version.
- **AC-OPP-090 (ticket acceptance; B+E)** — *Given* a stock Odoo Community bed with no custom module and an approved purchase, *when* a user receives goods, records a bill with withholding, and a different Finance user pays it, *then* PMO shows the authoritative Odoo outcomes (order, received quantities, VAT/withheld/net payable, paid), the project's cost account is on the order and bill lines, and after an interruption and recovery at each of the four steps Odoo holds exactly one order, one receipt, one bill and one payment. Composite of AC-OPP-010, 030, 040, 050, 052, 062; the curated journey is **E** (`e2e/AC-OPP-090-odoo-purchase-to-payment.spec.ts`), asserting DB rows and the rendered figures.

## 11. Data model (indicative; the builder confirms against the shipped DDL at `origin/dev`)

Migration slots **0505–0509 only**; a slot unused at the end of the build is returned to the Director, never reused.

- **0505 — enable `procurement` under tier `odoo`.** Extend the guarded employ verb and `org_has_active_*_binding`-style checks so the domain can be employed for `odoo`; confirm whether `external_command_outbox` and `external_refs` need any tier or kind CHECK widened (the outbox already stores `external_tier text`); add the audit rows. No new table.
- **0506 — purchase mirror columns.** Additive columns on `purchase_orders`, `procurement_receipts`, `procurement_invoices`, `payments` only where the shipped `erp_*` set cannot hold an Odoo fact (Odoo state, cancel tombstone, mismatch flag); extend the procurement mirror guard so a user JWT cannot write them. Reversible.
- **0507 — purchase feed apply.** A service-only function that upserts a page of purchase documents **and** advances that domain's watermark in one transaction (PD-2 of the O1 plan), org taken from the verified binding; census/tombstone function. Domains `purchase-order`, `receipt`, `bill`, `payment` under tier `odoo`.
- **0508 — payment gate and held-resolution.** Any change the shipped payment SoD and `procurement_payment_allowed` functions need to read an Odoo-tier payment, and the actor-checked held-row resolution RPC with audit.
- **0509 — journal kind and payment-journal default.** Allow kind `journal` in the master-record table, the binding-config key for the default payment journal and its actor-checked setter.

Every new function that is `SECURITY DEFINER` is added to the pgTAP 0178 allow-list and the 0136/0137 inventories in the same slice.

## 12. Slice split

See `docs/plans/2026-11-02-odoo-purchase-to-payment.md` §3. Money-committing slices (P3–P6) are Director-dispatched, ship alone, and pass the three-reviewer battery with `security-auditor` mandatory; P2 (the dispatch wiring and gate generalisation) also ships alone because it changes the money path's gates for both tiers.
