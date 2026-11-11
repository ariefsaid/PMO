# Spec — Odoo: client invoices, collections and tax documents (O3, #1506)

- **Status:** Signed by the owner 2026-11-02 with every owner-decision default as written (OD-SIGN-20261102). Defaults in §0 mirror the shipped ERPNext revenue path (owner ruling 2026-10-31: Odoo defaults MIRROR ERPNext; one adapter contract + contract tests) and reuse the O2 defaults where the question is the same (`docs/specs/odoo-purchase-to-payment.spec.md` §0).
- **Route:** EPC prospect build route (#1481), item O3 of `docs/plans/2026-10-30-epc-odoo-build-route.md`. **Blocked by** O1 (#1504, shipped) and, for time-and-materials claims only, #1514. Built on the O2 slices where they share machinery (gates, outbox wiring, journals); see the plan's dependency section.
- **Executor tier:** money / SoD ⇒ every slice that commits money is **Director-dispatched per issue** and ships alone (plan §3).
- **Grounds (read, not re-derived):** ADR-0055 (adapter contract, stock JSON-RPC only, zero Odoo customisation), ADR-0058 (money outbox, held-not-reissued), ADR-0059 (process ownership, side mirror), ADR-0077 (down payment as advance-item invoice lines), ADR-0082 (withholding: gross stays gross, withheld is its own figure), ADR-0094 (PMO is the only interface); `docs/money-path-primer.md`; the O1 and O2 specs and plans; the ERPNext revenue path (`docs/specs/erpnext-adapter-p3a-sales-ar.spec.md`, `progress-billing.spec.md`, `ppn-invoice-change.spec.md`, `invoice-pdf.spec.md`, `uxs-031-tax-evidence-labels.spec.md`; decisions DD-RCPT-1, DD-DUE-1); the shared seam (`pmo-portal/src/lib/adapterSeam/{contract,dispatch,refs}.ts`, `connect/workflows.ts`, `contractSuite/{revenue,harness,parity}*`), `supabase/functions/adapter-dispatch`; bed reports `docs/research/2026-10-30-odoo20-native-coverage.md`, `docs/research/2026-10-31-odoo20-dev-bed-verification.md`.
- **ID scheme:** `FR-OCI-###`, `NFR-OCI-###`, `AC-OCI-###`, `DD-OCI-#` (decisions taken here), `OQ-OCI-#` (owner decisions), `V-OCI#` (Odoo claims to verify on the dev bed).
- **Layer letters** (ADR-0010): **U** unit (Vitest/Deno, mocked transport), **P** pgTAP, **D** Deno served-handler test, **B** the Odoo dev bed (gated on its dependencies, never on `CI`, as the O1 bed tests are), **E** curated Playwright journey.

---

## 0. Owner decisions (each with the default taken if unanswered, and what breaks if the default is wrong)

Every open question is here. Defaults mirror ERPNext unless the row says Odoo's facts force otherwise.

| # | Decision | Default taken (mirrors ERPNext unless noted) | Named failure if the default is wrong |
|---|---|---|---|
| **OQ-OCI-1** | When does an invoice reach Odoo: at draft, or at approval? | **At approval ("submit"), as one command: create the customer invoice and post it** (ERPNext: draft authoring is PMO-only and ungated, the ERP create+submit is the money commitment). Drafts never exist in Odoo. | Wrong: finance wants the draft visible to Odoo accountants first, and cannot see it until approval; or a half-created Odoo draft is stranded when approval is refused. |
| **OQ-OCI-2** | SoD on invoice approval. | **Approver ≠ author, server-enforced, unchanged** (ERPNext FR-SAR-195, the shipped `submit_sales_invoice` rule). Odoo adds no way around it. Receipts carry **no** SoD (ERPNext: a receipt settles an already-committed receivable). | Wrong (stricter wanted on receipts): one person can enter and record a receipt. Wrong (looser): an author approves their own invoice and books revenue. |
| **OQ-OCI-3** | Taxes on an invoice (PPN output VAT). | **PMO always sends explicit tax ids from the mirrored tax directory** (O1): the project's VAT flag decides (flag on → the org's default sales tax from the mirror, validated before any write; flag off → an **explicit empty tax set**, so Odoo's hidden per-product defaults are never applied). Same posture as ERPNext DD-PBL-13 and OQ-OPP-4. | Wrong: Odoo applies a product-default tax PMO did not show; the read-back total differs; the invoice is flagged, not silently kept (FR-OCI-024). |
| **OQ-OCI-4** | Down payment. | **A one-line invoice on an org-configured down-payment item whose Odoo income account is the customer-advance (liability) account; recovery is a negative line on the same item in the later claim** (ADR-0077, ERPNext). Odoo's sale-order down-payment wizard is **not used** (no sales module, no sale order). One live down payment per project. | Wrong: the accountant wants Odoo's native down-payment document chain; PMO's advance does not appear as an Odoo down payment and a hand-made Odoo reconciliation is needed. |
| **OQ-OCI-5** | Retention. | **Out of scope, as ERPNext** (DD-PBL-11: PPN is charged on the full progress value, so a negative retention line would wrongly cut the tax base). A retention line an Odoo accountant adds in Odoo arrives through the feed as an ordinary line and is mirrored, never interpreted. | Wrong: the prospect's contract holds retention (the build route lists it for the prospect); claims overstate cash due until a follow-up owner ruling on tax base and a retention account. **This is the one default most likely to be overturned; ask first.** |
| **OQ-OCI-6** | Time-and-materials claims (#1514). | **No T&M-specific Odoo command.** A T&M claim is a PMO claim whose lines are approved quantities × contract rates; it rides the same invoice command as a volume claim. PMO is the source of the quantities; Odoo's timesheet-to-sales-order delivered-quantity route is **not** used (no sale order). Ships after #1514 lands. | Wrong: Odoo accountants expect hours to come from Odoo timesheets; PMO and Odoo hours disagree and the invoice cannot be traced to Odoo's hours. |
| **OQ-OCI-7** | PMO-initiated cancellation or correction of a posted invoice or a posted receipt. | **Not in O3** (consistent with OQ-OPP-8). PMO shows what Odoo holds; a mistaken invoice is reversed by an Odoo accountant (credit note, or reset-and-cancel) and PMO mirrors the result, including a credit note as a negative document linked to its invoice. ERPNext's in-PMO cancel and re-issue (`ppn-invoice-change.spec.md`) is **not** offered for tier `odoo`. | Wrong: a mistaken invoice or a wrong PPN rate cannot be fixed from PMO, contradicting "PMO is the only interface"; the VAT-correction journey does not exist for this tier until a follow-up slice. |
| **OQ-OCI-8** | Receipt shape. | **One receipt settles one invoice, in full or in part, never above the invoice's outstanding;** on-account / unallocated receipts refused (ERPNext). | Wrong: a client pays five invoices in one transfer and Finance must enter five receipts. |
| **OQ-OCI-9** | Receipt journal (which bank or cash book the money lands in). | **An org default chosen once in setup** (the O2 payment-journal default, reused; auto-proposed when the org has exactly one bank journal), overridable per receipt by Finance from the mirrored journal directory. | Wrong: money lands in the wrong bank book; a reversal is an accountant task in Odoo. |
| **OQ-OCI-10** | Tax the client withheld from a receipt (PPh 23 / 4(2) paid by the client to the tax office). | **Supported, shape mirrors ERPNext DD-RCPT-1: cash received + withheld = amount settled against the invoice; the invoice closes in full; PMO keeps settled, cash and withheld as three facts.** In Odoo the withheld part is booked to an org-configured **tax-prepaid account** as the receipt's payment difference. Needs a bukti-potong number (ERPNext rule). Same-currency only. | Wrong: Odoo's register-payment difference handling cannot express it on stock calls (V-OCI8) → the capability is declared *unavailable* and a receipt with withholding is refused with a named reason, never worked around with a module. |
| **OQ-OCI-11** | e-Faktur / Coretax: what "expose ERP-generated tax documents" means. | **Two layers, the first proven before the second is claimed.** (a) **Parity with ERPNext, claimed at once:** PMO records the issued e-Faktur number and date on the invoice by hand, as today (#893, `EfakturModal`); nothing is uploaded to the tax office. (b) **Odoo-held tax document, claimed only if the bed proves it:** read back whatever stock Community 20 holds on the invoice for the tax invoice (number, status, and the Coretax export file if a stock call produces one) and show it as "held by Odoo". Until V-OCI9–11 pass, capability `tax-document.read` is declared **unavailable** and the UI says nothing about Odoo-generated tax documents. PMO never uploads to the tax authority and never edits Odoo's tax-document fields. | Wrong (claiming (b) early): users trust an Odoo tax document that stock Community does not produce. Wrong (never doing (b)): Finance types numbers PMO could have shown, as on ERPNext today. |
| **OQ-OCI-12** | The client-facing invoice PDF. | **Out of scope for O3** (ERPNext proxies the ERP's own print, DD-PDF-1; Odoo's print is an HTTP report route, not a JSON-2 model call, V-OCI12). If the bed shows a stock call that returns it, a later slice adds it; until then the Odoo-tier invoice shows "PDF not available for this ERP". | Wrong: Finance cannot send the client a PDF from PMO for an Odoo-connected org. |
| **OQ-OCI-13** | Currency. | **Company currency only,** as ERPNext and OQ-OPP-9. A document in another currency is refused before any write with a named reason. | Wrong: a foreign-currency client cannot be invoiced from PMO. |
| **OQ-OCI-14** | An invoice or receipt document ends **held** (Odoo's anchor fields are editable by Odoo users). | **Both hold on an inconclusive recovery** (ERPNext holds receipts only because its invoice anchor is immutable; Odoo's is not, so invoices move to the stricter class, as O2 did for bills). Admin and Finance resolve held rows (adopt the Odoo document, or confirm it never existed); never the user who created the command. | Wrong (too strict): more held rows an operator must clear. Wrong (too loose): a duplicate invoice (double revenue) or a double receipt. |
| **OQ-OCI-15** | Status latency. | **Sweep-only is the acceptance bar** (5-minute tick) plus an immediate re-read after PMO's own write (OQ-OPP-11). | Wrong: a receipt posted in Odoo shows in PMO up to five minutes late. |
| **OQ-OCI-16** | An invoice that exists in both PMO and Odoo from before the connection (cutover). | **Linked, not pushed:** a PMO invoice raised before the connection pushes nothing; pairing it with the same Odoo invoice is the shared `invoice.pair-existing` workflow (#1602, pending owner answer OQ-ECA-3); employing `revenue` is refused while PMO drafts would be stranded (`cutover.revenue`). Odoo's declaration of both stays `pending` until their shared suites exist. | Wrong: the Odoo invoice and the PMO invoice both count and revenue doubles; or employing revenue silently abandons PMO drafts. |
| **OQ-OCI-17** | AR ageing and overdue for an Odoo-connected org. | **Derived from the mirror** (open invoices, their Odoo due date, PMO's receipt-based due date per DD-DUE-1); **no Odoo ageing report call in O3.** | Wrong: PMO's ageing disagrees with Odoo's own partner ledger report on a corner case (a part-receipt on a credit-noted invoice). |

---

## 1. Problem and job stories

**Problem.** O1 connected PMO to a stock Odoo Community; O2 moves purchasing money. Nothing yet carries the prospect's revenue: a client claim approved in PMO has no customer invoice in Odoo's ledger, the client's payment is not recorded there, and no tax document comes back. ERPNext-connected orgs already do all of this. The Odoo tier must give the same journeys, over stock Odoo with no customisation, without ever booking one claim twice.

**Job stories.**
- *When a client has signed off a claim (volume, or hours at contract rates), I want it to appear in Odoo as one posted customer invoice for the right client, lines and project, exactly once, so revenue and receivables are in the ledger.*
- *When the contract has a down payment, I want it invoiced into the advance account and recovered proportionally on later claims, so the ledger holds the advance until it is earned.*
- *When the client pays, I want to record one receipt against the invoice, with any tax the client withheld, and see the invoice close only when Odoo says so.*
- *When the tax office needs the e-Faktur, I want to record its number against the invoice, and to see what Odoo holds for it where Odoo holds one, never a claim it cannot back.*
- *When a call times out or Odoo is down mid-way, I want PMO to say "not confirmed yet", never post a second invoice or a second receipt, and recover on its own or tell me what needs a person.*

## 2. Scope and out of scope

**In scope.** For an org whose `revenue` domain is employed under tier `odoo` (and the org has an activated Odoo binding): push an approved PMO sales invoice, ordinary or from a billing claim (progress claim, down payment, recovery; time-and-materials lines once #1514 ships), as one posted Odoo customer invoice with the project's cost account on every line; push a customer receipt against one invoice, with client-withheld tax; read every Odoo customer invoice, credit note and incoming payment back into PMO's mirror and derive PMO statuses from Odoo state; record the e-Faktur number and date by hand (parity) and read back Odoo's tax-document facts where V-OCI9–11 prove them; link existing Odoo invoices without double counting (shared workflow); cutover and activation gates; PMO screens for outcome, held rows, tax document; the contract-suite declarations for these workflows.

**Out of scope (owned elsewhere or deferred).** Purchasing (O2 #1505); journal-line actuals, statements and Odoo ageing reports (O4 #1507); T&M claim assembly itself (#1514, T3 of the route; O3 only carries its lines); retention (OQ-OCI-5); PMO-initiated cancel, credit note, amend or re-issue of a posted invoice or receipt (OQ-OCI-7); on-account and advance receipts (OQ-OCI-8); multi-currency (OQ-OCI-13); the client invoice PDF (OQ-OCI-12); upload of e-Faktur / Coretax to the tax authority, and any Coretax schema maintenance (OQ-OCI-11); Odoo sales orders, quotations, subscriptions and the sales-order down-payment wizard; invoice approval *routing inside Odoo* (PMO approves); Odoo Enterprise, Online or custom modules (NFR-OCI-008).

**Hard constraints carried.** Stock JSON-2 API only, zero Odoo customisation (ADR-0055 §2, ADR-0094); Odoo's ledger is the oracle and PMO mirrors its money, never recomputes it (ADR-0048); an unconfirmed outcome is shown as unconfirmed (NFR-ODC-006); one PMO record mints at most one Odoo document, ever (money-path primer); SoD unchanged (FR-OCI-060); **no ERP tax-document capability is claimed until it is tested on stock Community 20** (the route's O3 rule; FR-OCI-090).

## 3. Domain terms

Existing terms (`docs/glossary.md`) unchanged. Reused from ADR-0058 / O1 / O2: **anchor**, **held**, **outbox**, **watermark**, **cost account**, **account defaults**, **capability snapshot**. PMO terms above the adapter contract are unchanged (NFR-ODC-009): sales invoice, billing claim, down payment, receipt, e-Faktur.

Odoo terms used (stock models, **verify each on the bed**): `account.move` (`move_type = out_invoice`, `out_refund` for credit notes), `account.move.line`, `account.payment` (`payment_type = inbound`, `partner_type = customer`), `account.payment.register` (the register wizard), `account.journal`, `account.tax`, `account.account`, `account.analytic.account`, and the Indonesian localisation's tax-document fields on `account.move` (names are a bed finding, V-OCI9).

## 4. Data ownership (ADR-0055, ADR-0059, ADR-0094)

| Data | Source of truth | PMO holds | Writable from PMO? |
|---|---|---|---|
| Billing claim, BoQ, assessment, evidence, client sign-off, draft invoice, author, approver | **PMO** | existing tables | Yes (unchanged) |
| Customer invoice (document, lines, taxes, totals, posted state, outstanding) | **PMO authors, Odoo holds the ledgered document** (ERPNext posture: pushed at approval, ERP state mirrored) | `sales_invoices` + `external_refs` + `erp_*` mirror columns | Created by PMO command only; money and state fields are machine-written |
| Customer receipt | **Odoo** | `incoming_payments` mirror (+ settled / cash / withheld facts) | PMO command; recorder stamped by PMO |
| Credit notes and reversals made in Odoo | **Odoo** | mirrored as negative documents linked to the invoice | No |
| e-Faktur number and date | **The tax office issues; PMO records** (ERPNext parity, #893) | existing invoice columns | Yes, by hand (existing form) |
| Odoo-held tax-document facts (number, status, export file) | **Odoo**, if V-OCI9–11 prove it | read-only mirror columns | No |
| Chart of taxes, accounts, journals, items, cost accounts, partners | **Odoo** (O1 read model) | `external_master_records` | No |
| Who authored, who approved, who recorded (SoD stamps) | **PMO** | existing columns | Server-stamped |

A mirrored copy is never a second source of truth. An edit made in Odoo's own UI is legitimate and arrives through the feed.

---

## 5. Requirements (EARS)

### 5.1 Enablement, gating and cutover

- **FR-OCI-001** — The system SHALL treat `revenue` as an ownership-flipping domain for tier `odoo`, employed per org by the same guarded verb as ERPNext (`admin_change_domain_ownership`), only when the org has an **activated** Odoo binding (ADR-0073), the capability snapshot shows `account.move`, `account.move.line`, `account.payment`, `account.journal`, `account.tax` and `account.account` present and usable by the key, and the cutover rule (FR-OCI-003) is satisfied.
- **FR-OCI-002** — While the binding is not activated, the kill-switch is off, or the capability snapshot lacks a model a push needs, no revenue command SHALL reach Odoo; the refusal SHALL be classified, name the missing item, and make no ERP call (`cutover.activation`, fail closed).
- **FR-OCI-003** — When PMO sales-invoice drafts exist that employing `revenue` would strand, the employ verb SHALL refuse with a count and a next step (`cutover.revenue`, OQ-OCI-16). An invoice PMO raised before the connection SHALL push no later step; the answer "unknown" SHALL refuse. Such an invoice SHALL instead be paired with its Odoo document when one exists (FR-OCI-083).
- **FR-OCI-004** — Every revenue command SHALL pass, before the outbox row and before any Odoo call: the caller's role gate, the org-scoped link ownership check (a customer, project, work order or invoice belonging to another tenant, or absent, refuses `cross-org-link-rejected`, `erpCalls = 0`), the process gates (`require_project_on_si`, default on), the invoice-approval SoD gate (FR-OCI-060) for an invoice, and the project-resolution gate (FR-OCI-020). The gates SHALL be keyed on the command's PMO shape, not on the tier name, so one implementation serves ERPNext and Odoo.

### 5.2 Customer invoice (ordinary and billing claim)

- **FR-OCI-010** — When an invoice is approved for push, the system SHALL create the Odoo customer invoice in one command: the O1-mapped partner, company, currency check (OQ-OCI-13), invoice date, one line per PMO invoice line (O1-mapped product or the line's explicit income account, quantity, unit price, mapped unit, explicit tax ids per FR-OCI-023) with `analytic_distribution` `{"<cost account id>": 100}` on every line, then post it. The client's PO / contract reference SHALL travel in the stock customer-reference field (V-OCI2), resolved exactly as the ERPNext path resolves it (invoice reference, else work-order PO number, else the project's contract reference) before the outbox snapshots the command.
- **FR-OCI-011** — The system SHALL stamp the command's idempotency key into one stock text field on the invoice that PMO does not otherwise use (the **anchor**; candidates and verification in V-OCI2), and SHALL recover an interrupted create by probing that anchor. The customer reference and the invoice number are user-visible business fields and SHALL NOT be the anchor.
- **FR-OCI-012** — Create and post are two Odoo calls and not one transaction. A command that completed the create and not the post SHALL be completed by the next attempt reading the invoice's state: a draft invoice with our anchor is posted, a posted one is adopted, never created again (NFR-OCI-005).
- **FR-OCI-013** — A line whose item, unit or customer has no O1 mapping, or whose income account cannot be resolved, SHALL refuse before any write, naming the unmapped thing. PMO SHALL NOT create the missing item or partner silently; the user maps it (O1 screens) or sends it (O1 `item.send`, `party.send`).
- **FR-OCI-014** — The invoice's total, tax and outstanding in PMO SHALL be the figures Odoo reports after the post, shown with the PMO-computed total when they differ, never silently replaced (ADR-0048; FR-OCI-024).
- **FR-OCI-015** — PMO SHALL NOT push a due date (ERPNext DD-DUE-1; Odoo derives it from the partner's payment terms). The PMO-recorded received date stays PMO-only, because no stock Odoo field carries it and customisation is out (NFR-OCI-008); PMO's receipt-based due date display is unchanged, and Odoo's own due date is shown beside it where they differ.
- **FR-OCI-016** — The invoice number SHALL be the number Odoo assigns on post, read back and stored; PMO SHALL NOT mint or reserve a number. A posted invoice SHALL appear in PMO as *Submitted* only after the read-back confirms the posted state.

### 5.3 Billing claims, down payment, recovery, time and materials

- **FR-OCI-017** — A progress claim SHALL push as one invoice with one line per claimed BoQ line (net-of-tax quantity × rate, PMO's figures, OD-TAX-1) and, when the project has a live down payment, one **negative recovery line on the down-payment item** for the claim's recovery amount (ADR-0077, DD-PBL-5). The system SHALL NOT interpret or recompute BoQ, assessment or recovery logic; it transports the lines PMO's claim record fixed (a claim is immutable once created, DD-PBL-7).
- **FR-OCI-018** — A down-payment claim SHALL push as one invoice with one line on the org's down-payment item, whose Odoo income account SHALL be the configured customer-advance account. Before the push the system SHALL check from the mirrored account directory that the item's income account is that account; a mismatch SHALL refuse with `config-rejected` naming the item, and after posting the read-back line account SHALL be compared with the configured one (a difference flags *needs attention*, never silently kept). No default advance account is assumed.
- **FR-OCI-019** — A claim line carrying the claim's work order SHALL record that work order's PO number as the invoice's customer reference (FR-OCI-010) and SHALL retain the PMO `work_order_id` on the PMO invoice row (#766); the Odoo invoice carries no work-order concept.
- **FR-OCI-019a** — A time-and-materials claim (#1514) SHALL push through this same command: its lines are the approved quantities (hours, equipment units) at the contract rates the claim fixed, with the same cost-account distribution. Unsigned hours SHALL NOT appear in a command (that is the claim's rule, #1514); this spec adds no Odoo-side check beyond FR-OCI-013/020/023. The slice that wires it SHALL NOT merge before #1514 has.

### 5.4 Project analytics

- **FR-OCI-020** — The system SHALL resolve the project's cost account through the O1 shared resolver (FR-ODC-102) before any invoice write; an unlinked project, or a link in *needs attention*, SHALL refuse the push with a named reason and no Odoo call. No default account, no guess. With the process gate `require_project_on_si` off, an invoice with no project SHALL push with no distribution and roll up as *Unassigned* in PMO (ERPNext FR-SAR-191).
- **FR-OCI-021** — The cost account SHALL be carried on every invoice line (`analytic_distribution`, key a string id, value 100) including a negative recovery line and a down-payment line. Lines SHALL NOT be split across projects in O3.
- **FR-OCI-022** — Once an invoice has any Odoo document reference (an `external_refs` row), un-linking or re-linking its project SHALL be refused through the single shared check (FR-ODC-073).
- **FR-OCI-022a** — After posting, the read-back SHALL be checked: if a posted line lacks the project's cost account the system SHALL flag the invoice *needs attention: cost account missing* and SHALL NOT report the project revenue as booked.

### 5.5 Taxes and money read-back

- **FR-OCI-023** — Every invoice line SHALL carry explicit tax ids (OQ-OCI-3): the project's VAT flag on → the org's default sales tax resolved from the mirrored tax directory and validated before the write (active, same company, sale scope, PPN output); flag off → an explicit empty set. A tax that is inactive, another company's, or the wrong scope SHALL refuse `config-rejected` naming the tax (never the company or an account).
- **FR-OCI-024** — After posting, the system SHALL read the invoice's money from Odoo and store, in PMO's existing columns: untaxed total, tax total, grand total, **outstanding = Odoo's residual amount verbatim**. A payload missing any part of the money header SHALL leave the money unwritten, not guessed (DD-VWH-2/5). The read-back total SHALL be compared with the figure PMO sent; a difference larger than the currency's smallest unit SHALL mark the invoice *needs attention: Odoo computed a different total* and nothing is deleted or reversed automatically. A tax withheld by the client is a **receipt** fact (FR-OCI-051), never an invoice column.
- **FR-OCI-025** — The invoice's status in PMO SHALL be *Paid* only when Odoo's residual is zero and the move is posted (FR-OCI-081).

### 5.6 Customer receipt (collection)

- **FR-OCI-050** — A customer receipt SHALL be created against exactly one posted invoice, for an amount greater than zero and not above the invoice's outstanding; no invoice reference, an unposted invoice, another currency, or an invoice of another tenant SHALL refuse before any write (OQ-OCI-8).
- **FR-OCI-051** — The command SHALL create the inbound customer payment in the chosen journal (OQ-OCI-9) with the customer, the date and a memo carrying the anchor, post it, and reconcile it to the invoice's receivable line, using stock calls (the register-payment wizard or the line reconcile method, V-OCI7). A payment created and not posted, or posted and not reconciled, SHALL be completed by the next attempt reading its state, never created again. A receipt for a tax the client withheld SHALL send cash and withheld as the ERPNext DD-RCPT-1 shape, booking the withheld part to the configured tax-prepaid account as the payment difference (V-OCI8); it requires the bukti-potong number, same-currency accounts, and cash + withheld = settled, each refused before any write (ERPNext rules). If V-OCI8 shows the stock wizard cannot express it, a receipt with withholding is refused as *unavailable* with a named reason (OQ-OCI-10).
- **FR-OCI-052** — The receipt's anchor is **mutable** (an accountant can edit a memo). A recovery probe SHALL adopt only a unique match on the anchor **or** on the deterministic conjunction (inbound, customer, invoice, amount, date window); zero or more than one match after the recovery window SHALL **hold** the command and SHALL NOT reissue (ADR-0058 C-1; ERPNext FR-SAR-123).
- **FR-OCI-053** — The recorder SHALL be stamped by PMO from the verified JWT subject and never from the payload.
- **FR-OCI-054** — After a receipt, PMO SHALL show the invoice as Paid only after the next Odoo read shows its residual at zero; between the receipt and that read the invoice SHALL show "receipt sent, awaiting Odoo".
- **FR-OCI-055** — The receipt SHALL resolve its invoice and customer in the same revenue scope (the AR same-scope invariant, ERPNext FR-SAR-161); a receipt whose invoice is not mirrored or belongs to another org SHALL refuse.

### 5.7 Separation of duties and authorization

- **FR-OCI-060** — Invoice approval SoD SHALL be unchanged and server-enforced for tier `odoo`: the approving user SHALL differ from the invoice's author (the shipped `submit_sales_invoice` rule and its append-only author set, typed `sod-self-approval`), enforced before the outbox row on a database re-read, with the approver's id from the verified JWT. Draft authoring stays ungated. A refused approval leaves no outbox row and no Odoo call. The dispatched post IS the money commitment, so the gate sits on the dispatch.
- **FR-OCI-061** — Roles that may author, approve and record SHALL be exactly those the ERPNext tier allows today (the shipped `can()` actions and dispatch role gate), with no widening for Odoo. `can()` is UX only; the dispatch gate and RLS are the authority (ADR-0016).
- **FR-OCI-062** — The caller's own JWT identity SHALL decide author-versus-approver; a payload `approved_by`, `author` or `recorded_by` field SHALL be ignored.
- **FR-OCI-063** — Held-row resolution (adopt, or confirm absent) SHALL be restricted to Admin and Finance, SHALL write an audit row naming the actor, and SHALL be unavailable to the user who created the held command (the O2 resolution RPC, extended to the revenue kinds).

### 5.8 Idempotency, failure and retry

- **FR-OCI-070** — Every Odoo-writing revenue command SHALL go through the shared money outbox (`dispatchMoneyWrite` with the DB-backed deps): a generation-fenced claim, the commit, a finalize that records the external reference and the mirror, and a confirm. The idempotency key SHALL be stable across the user's retries (never per click): `si:<invoice id>` for an invoice, `ip:<receipt id>` for a receipt.
- **FR-OCI-071** — Outcome classes SHALL be honest and distinct: *confirmed* (read-back matches), *pending* (sent, not yet read back), *failed-no-document* (conclusive absence), *held* (inconclusive; needs a person), *refused* (before any call). A timeout, a 5xx or a lost response SHALL be *pending* until a probe settles it, and SHALL NOT be shown as success or as failure.
- **FR-OCI-072** — Recovery SHALL be the next sweep tick or the user's retry re-running `dispatchMoneyWrite`: a past-lease `committing` row is quarantined, the anchor is probed, and the row is linked, reissued (only where conclusive absence is allowed) or held. There is no second recovery path.
- **FR-OCI-073** — The numeric relationships of the money-path primer SHALL hold for the Odoo constants (reclaim window > claim budget + request deadline + settle margin; per-attempt deadline × attempts < any lock or clearance that guards it; SoD clearance TTL > the longest an Odoo post can still be in flight; any read cap < the platform row cap). A test SHALL assert each.
- **FR-OCI-074** — A 429 or transient failure SHALL retry with the shared bounded policy; a validation error from Odoo SHALL classify as `commit-rejected` with a user-safe reason and SHALL never echo Odoo's body or traceback.
- **FR-OCI-075** — Cancelling a command mid-flight is not offered; a user "retry" reuses the key and so cannot mint a second document.

### 5.9 Read-back, status reconciliation, credit notes and pairing

- **FR-OCI-080** — The system SHALL read revenue documents from Odoo into PMO's mirror by the O1 watermark mechanism (`write_date`, id, overlap window, advance after durable apply), per domain: customer invoices (`out_invoice` posted or cancelled), credit notes (`out_refund`), incoming customer payments, plus a census for deletions. Each page SHALL be applied by a service-only function that checks the `org_id` of the verified binding, never one from the payload.
- **FR-OCI-081** — Derived PMO statuses SHALL come from Odoo state, never from PMO's own record: invoice — draft → not mirrored, posted with residual > 0 → *Unpaid* (or *Overdue* by the shared overdue rule once #1457 lands), posted with residual zero → *Paid*, cancel → *Cancelled* with a tombstone; receipt — posted. A document cancelled in Odoo SHALL be marked cancelled, never deleted from PMO (#1350). Payment classification SHALL follow the direction Odoo states (inbound/customer → receipt, outbound/supplier → vendor payment, anything else skipped, never guessed): the shared `receipt.read` suite, Odoo half.
- **FR-OCI-082** — An invoice's money and derived status SHALL refresh from any inbound change that carries the whole money header; a change missing part of it SHALL write none of it.
- **FR-OCI-083** — **Pair existing** (shared `invoice.pair-existing`, #1602): Odoo invoices PMO did not create SHALL be mirrored once each at their newest figures, proposed for pairing with PMO invoices of the same client, reference and amount, and counted once after Finance accepts; a document with a PMO anchor but no `external_refs` row (an orphan from a crash) SHALL be proposed for adoption, never created again. Until the shared suite exists the Odoo declaration stays `pending` on #1602.
- **FR-OCI-084** — A credit note posted in Odoo against a mirrored invoice SHALL be mirrored as a negative document linked to it, and the invoice's outstanding SHALL come from Odoo's residual; PMO SHALL show the credit note on the invoice and SHALL NOT create one (OQ-OCI-7).
- **FR-OCI-085** — The mirror writers (sweep and webhook nudge) are service-role and SHALL enforce org scoping themselves; the mirror columns SHALL be unwritable by a user JWT (the shipped revenue mirror guard, extended).
- **FR-OCI-086** — A document that disappears from Odoo (hard delete, invisible to the feed) SHALL be found by the census and tombstoned in PMO, never silently counted in billed-to-date, receivables or the management pack.

### 5.10 Tax documents

- **FR-OCI-090** — The system SHALL NOT claim, label or enable any Odoo-held tax-document capability until the bed has proved it on stock Community 20 (V-OCI9–11). Until then the capability `tax-document.read` is declared `unavailable` with a reason, and no PMO screen mentions Odoo-generated tax documents.
- **FR-OCI-091** — For tier `odoo` the existing e-Faktur record (number + date, entered by hand against a numbered, VAT-bearing invoice; `EfakturModal`, #893, UXS-031 labels) SHALL work unchanged, because it writes only PMO columns (parity, OQ-OCI-11a).
- **FR-OCI-092** — Where V-OCI9–11 prove that a posted Odoo invoice exposes tax-invoice facts to a stock read (number, status), the system SHALL mirror them read-only and show them on the invoice as "held by Odoo", beside (never overwriting) the number recorded by hand; a disagreement SHALL show both and flag *needs attention*.
- **FR-OCI-093** — Where V-OCI11 proves that a stock call yields the Coretax export for an invoice, the system SHALL let Admin and Finance download it through PMO's server (the key never leaves the server function), as a proxied file like the ERPNext PDF (DD-PDF-1); otherwise the control SHALL be absent, not disabled-with-hope.
- **FR-OCI-094** — PMO SHALL NOT upload to, call, or schedule anything with the tax authority, and SHALL NOT write any Odoo tax-document field.

### 5.11 PMO screens

- **FR-OCI-100** — The sales-invoice list and detail screens SHALL show, per invoice and receipt, the **Odoo outcome class** (FR-OCI-071) in plain words, the age of the last read, and the next step for *pending*, *held*, *needs attention* and *refused* rows.
- **FR-OCI-101** — While the connection is not healthy (O1 FR-ODC-032/033), invoice screens SHALL keep the last mirrored data with its age; a PMO action that needs Odoo SHALL fail honestly ("Odoo is unreachable, try again") and SHALL NOT be queued.
- **FR-OCI-102** — A receipt with tax withheld SHALL show settled, cash received and tax withheld (DD-RCPT-1, ADR-0082); one without renders exactly as today. The receipt form SHALL offer journals from the mirror, disabled with a reason when the directory is empty or stale.
- **FR-OCI-103** — An invoice SHALL show its Odoo document number, the project attribution (cost account), the payments and credit notes against it, the e-Faktur record (FR-OCI-091) and, only where FR-OCI-092/093 apply, the Odoo-held tax document.
- **FR-OCI-104** — A held row SHALL be listed for Admin and Finance with the two resolve actions (FR-OCI-063).
- **FR-OCI-105** — Screens SHALL use the shared form primitives and tokens, `ConfirmDialog` for the money actions, `classifyMutationError`, i18n keys in both `en` and `id`, and reflect the real JWT role (impersonation view-only).

---

## 6. Non-functional requirements

- **NFR-OCI-001 (one document per record)** — Under any interleaving of retries, timeouts, sweeps and crashes, one PMO record mints at most one Odoo document. Proof: the outbox mechanism (P), the recovery tests (U), the bed interruption tests (B).
- **NFR-OCI-002 (tenancy)** — Every table is `org_id`-scoped; service-role writers enforce scope themselves; a two-org test proves org A's push, sweep and recovery cannot read or write org B's rows or documents.
- **NFR-OCI-003 (confidentiality)** — The API key never leaves the server function; no Odoo body, traceback, host or database name appears in a response, log, audit row or test title (public repo, NFR-ODC-010).
- **NFR-OCI-004 (ledger is the oracle)** — PMO mirrors Odoo's money; it never recomputes totals, taxes or outstanding after the post (ADR-0048). Mismatch is flagged, never reconciled by overwriting.
- **NFR-OCI-005 (resumable multi-step)** — Every two- or three-step command (create+post, create+post+reconcile) completes from any interruption point by reading Odoo state; steps are state-checked, so a replay is a no-op.
- **NFR-OCI-006 (honesty)** — No screen or response describes an unconfirmed Odoo outcome as success, and none describes an unproven tax-document capability as available (NFR-ODC-006, FR-OCI-090).
- **NFR-OCI-007 (parity)** — ERPNext and Odoo pass the same revenue contract suites (`invoice.push`, `receipt.read`, and — when written — `invoice.pair-existing`, `cutover.revenue`, plus the shared `cutover.activation`); a behaviour a shared suite asserts changes both tiers or bumps the workflow version (`connect/workflows.ts`).
- **NFR-OCI-008 (no customisation)** — Works on stock Community with no custom or third-party module and no Studio change; a capability that needs one is reported *unavailable*.
- **NFR-OCI-009 (no Odoo vocabulary above the contract)** — Odoo model and field names live only under `adapterSeam/odoo/**` and the edge functions wrapping it (AC-ODC-083 guard extended).
- **NFR-OCI-010 (reversibility)** — Migrations (slots 0510–0514 only) are reversible with a `rollback/` down script and additive to shared tables.
- **NFR-OCI-011 (accessibility)** — WCAG AA, keyboard operation, 320 px width on the new states.
- **NFR-OCI-012 (public-repo hygiene)** — Synthetic hosts, databases, clients and amounts only; no prospect identity.

---

## 7. Design decisions taken here (`DD-OCI-#`)

- **DD-OCI-1 — Same domain, same seam, no second dispatch path.** Tier `odoo` registers a revenue resolver and outbox resolver in `adapter-dispatch`, reusing `dispatchMoneyWrite`. The revenue guards (authorisation, link ownership, project gate, process gates, invoice-approval SoD) are keyed on the command's PMO shape; ERPNext behaviour stays byte-for-byte (proved by its existing suites). O2's generalised gates are reused, not redone.
- **DD-OCI-2 — Two documents, not one command.** Invoice and receipt are separate commands with separate keys and anchors, as ERPNext's SI and PE-receive. A step never creates its predecessor.
- **DD-OCI-3 — Multi-call commands are state machines.** The adapter reads state first (`draft`, `posted`, payment `posted`, reconciled) and performs only the missing call. The outbox claim covers the whole command.
- **DD-OCI-4 — Anchors.** Candidates only; **V-OCI2** decides per model from fields that survive Odoo's own write hooks. Rules: never a business field the user sees as such (customer reference, invoice number); one stock text field per model; every anchor is treated as editable (C-1) except where the bed proves it is system-owned. Candidates: invoice `invoice_origin` or `narration`; payment `memo`.
- **DD-OCI-4 amendment (2026-11-03, Director ruling after C0, mirroring DD-OPP-4).** The invoice **and** the inbound payment anchor is a stock external identifier (`ir.model.data`, module `pmo`, name derived from the key with safe characters: `si_<uuid>`, `ip_<uuid>`), written immediately after creation. The create-to-anchor gap is closed by a composite probe that **holds on any doubt and never reissues**: invoice (`out_invoice`, customer, `amount_total`, date window), payment (inbound, customer, customer, amount, date window, reconciled invoice). A unique match adopts; none or several after the recovery window hold (OQ-OCI-14). The payment memo still carries the key as a secondary trace, never as the deciding anchor. The service user's Access Rights group is an elevated grant and an OWNER go-live check (`docs/environments.md`). Code reads every anchor choice from `ODOO_REVENUE_ANCHORS`.
- **DD-OCI-5 — Down payment is two ordinary invoice lines, not an Odoo down-payment document.** The advance account is the item's income account (ADR-0077); Odoo's native down payment needs a sales order, which is a module PMO does not use.
- **DD-OCI-6 — Withheld-by-client is a receipt fact.** The invoice stays gross (ADR-0082); the receipt's payment difference books the withheld part to the tax-prepaid account, exactly as ERPNext's deduction row.
- **DD-OCI-7 — Status is read, not set.** PMO writes no invoice status from its own click once `revenue` is employed; the sweep and the post-write re-read derive it (ADR-0059).
- **DD-OCI-8 — Guards before outbox.** A refused command leaves no outbox row and touches no ERP.
- **DD-OCI-9 — Tax documents: claim only what is proved.** Capability `tax-document.read` is a declared, versioned capability that starts `unavailable`; the bed result decides the flip, in the same slice that adds its screen. The manual e-Faktur record is parity and needs no capability.
- **DD-OCI-10 — Journals and tax-prepaid account come from O1/O2.** The receipt journal default is the O2 default setter; the tax-prepaid account is one more account default (the O1 account-defaults mechanism), set once by Admin or Finance.

## 8. Authorization and separation of duties

| Action | Roles allowed | Server enforcement |
|---|---|---|
| Author / edit a draft invoice, create a claim | exactly the roles ERPNext allows today | role gate; RLS |
| Approve (post) an invoice | exactly the roles ERPNext allows today, **not the author** | `submit_sales_invoice` RPC + dispatch gate; typed `sod-self-approval`; pgTAP-proven |
| Record a receipt | Admin, Finance (as ERPNext) | dispatch role gate + same-scope check; recorder from JWT |
| Resolve a held row | Admin, Finance; never the creator | RPC actor check + audit |
| Set receipt journal / tax-prepaid account | Admin, Finance | actor-checked config RPC (O1/O2 pattern) |
| Record e-Faktur number by hand | as today | unchanged |
| Download Odoo-held tax document (if proved) | Admin, Finance | server-side proxy; role gate |
| Read revenue mirror | active org members per existing RLS | unchanged |

**SoD.** Approver ≠ author is unchanged and enforced server-side before the outbox row. The Odoo tier adds no way around it; a mapping or default edit never rewrites a posted document.

## 9. Verify on the dev bed (`V-OCI#`)

Closed by plan slice C0 on the stock bed (`scripts/odoo-dev-bed.sh`, under `scripts/with-odoo-lock.sh`) before any code depends on them. Each claim names the code that waits on it. The bed needs `account project analytic l10n_id` installed (bed report's list; `l10n_id_efaktur_coretax` is installed as a dependency of `l10n_id`).

| # | Claim to verify | Used by |
|---|---|---|
| V-OCI1 | `account.move/create` (`out_invoice`) with `invoice_line_ids` command tuples, then `action_post`; final `state`, `name`, `amount_*`; behaviour when a product's default taxes exist and `tax_ids` is sent empty or explicit; a **negative-quantity or negative-price line** on a customer invoice (recovery); posting an invoice whose total is zero or negative. | FR-OCI-010/012/017/023 |
| V-OCI2 | Anchor fields on `account.move` (invoice) and `account.payment`: a stock char/text field that accepts a PMO key, survives post, is not rewritten by an onchange, and can be filtered with `ilike`; whether a UI user can edit it. The stock customer-reference field (`ref`) vs `payment_reference` vs `invoice_origin`: which one prints as the client's PO on the invoice. | FR-OCI-010/011, DD-OCI-4, OQ-OCI-14 |
| V-OCI3 | Line-level `account_id` override (down-payment item to the advance account) and a product with a distinct income account; the read-back of the posted line's account. | FR-OCI-018 |
| V-OCI4 | `analytic_distribution` on an invoice line (`{"<id>": 100}`), on negative lines, and surviving post. | FR-OCI-021/022a |
| V-OCI5 | PPN output tax on the bed (Indonesian localisation sale taxes, `price_include`, amounts to the cent); how `amount_untaxed`, `amount_tax`, `amount_total`, `amount_residual` and tax lines express a 11% invoice and a reduced-base invoice. | FR-OCI-023/024 |
| V-OCI6 | Double `action_post` on a posted move (error or no-op); `payment_state` and `amount_residual` after post. | FR-OCI-012/025 |
| V-OCI7 | Customer payment: `account.payment` create (inbound, customer, journal, payment method line), `action_post`, reconcile with the invoice via the register wizard (context `active_model`, `active_ids`) or `account.move.line` `reconcile`; `payment_state` after (`in_payment` before bank reconciliation), partial receipt, receipt above the residual (error or overpay). | FR-OCI-050/051/054, FR-OCI-081 |
| V-OCI8 | Client-withheld tax on a receipt: the register wizard with `payment_difference_handling = reconcile` and a write-off account (tax-prepaid), or an equivalent stock call; the resulting journal lines; invoice residual zero. | FR-OCI-051, OQ-OCI-10 |
| V-OCI9 | Which tax-invoice facts a stock read of a posted Indonesian customer invoice exposes: tax-invoice number (NSFP) fields, status, transaction-code fields, on `l10n_id_efaktur_coretax` and whether the number is assigned automatically or only on export; whether any exists without Enterprise. | FR-OCI-090/092 |
| V-OCI10 | Whether a stock model call can produce the Coretax export for one invoice (the method name, its return value, whether it needs a wizard, whether it needs partner data a bare invoice lacks); the failure body when mandatory tax fields are missing. | FR-OCI-092/093 |
| V-OCI11 | The export's content type and size over the key's access, and whether the file can be fetched by a stock `ir.attachment` read; a minimally-privileged user's access. | FR-OCI-093 |
| V-OCI12 | Whether the invoice print can be obtained by a stock JSON-2 model call (it is normally an HTTP report route). | OQ-OCI-12 |
| V-OCI13 | `write_date` shape and ordering on `account.move` and `account.payment`, and the sweep filters (`move_type in (out_invoice, out_refund)`, `payment_type = inbound`, `partner_type = customer`) as O1's V10/V14 did; a credit note's `reversed_entry_id` link. | FR-OCI-080/084 |
| V-OCI14 | Which of these calls are refused to a minimally-privileged service user, and the smallest group set that passes all of them (extends O1 S0-T13 and V-OPP10); recorded for the runbook (NFR-ODC-003). | FR-OCI-001, runbook |
| V-OCI15 | The error body shape for a validation error on each call (to classify without echoing). | FR-OCI-074 |

**Verdicts (plan slice C0, 2026-11-03; evidence in `docs/research/2026-10-31-odoo20-dev-bed-verification.md` §10; spec deltas SD-6…SD-15 in the plan §1).** All fifteen claims are closed on the stock bed. None hit the plan's stop rule.

- **V-OCI1 verified.** Create with tuples then post works; omitted `tax_ids` applies the product default, `[[6,0,[]]]` and `[[5,0,0]]` give an explicit empty set; a negative line beside a positive posts; **a negative-total invoice is refused on post (422)**; a zero-total invoice posts and reads paid.
- **V-OCI2 closed, no invisible anchor.** External identifier plus a composite hold-on-doubt probe, per model (SD-6, SD-7). `ref` prints as "Reference" (the client's PO).
- **V-OCI3 verified.** V-OCI4 verified. V-OCI5 verified (the 11% tax is named "12% (Non-Luxury Good)"; resolve by id). V-OCI6 verified (second post is 422).
- **V-OCI7 verified.** Wizard and line reconcile both work; the wizard **accepts an over-receipt** (PMO's cap is the only guard); no `in_payment` state observed.
- **V-OCI8 verified.** The stock wizard books the client-withheld part to a write-off account and closes the invoice.
- **V-OCI9 nothing numbered.** Coretax exposes a transaction code and a document link, no tax-invoice number or status (SD-11). **V-OCI10 verified:** `download_efaktur` exists, needs no wizard, and writes a document and attachment in Odoo (SD-12). **V-OCI11 verified:** XML, ~1.5 KB, readable through `ir.attachment` `raw`.
- **V-OCI12 no.** The print is not reachable by a JSON-2 call. **V-OCI13 verified** (keyset at 200 and 1000; the reversal wizard needs `journal_id` and `company_id`, SD-13). **V-OCI14 verified:** Billing + Access Rights (SD-14). **V-OCI15 verified:** six-key body, classify on `name` (SD-15).

## 10. Acceptance criteria

Each AC has exactly one owning layer. Where a second layer appears it is secondary evidence.

### Enablement, gates, cutover
- **AC-OCI-001 (FR-001, 002; U+B)** — *Given* a not-activated binding, the kill-switch off, or a snapshot missing `account.payment`, *when* any revenue command is sent, *then* it is refused with a classified, item-naming reason and **zero** Odoo calls. *B secondary:* the stock bed is not wrongly refused.
- **AC-OCI-002 (FR-003; U)** — *Given* an org with PMO draft invoices, *when* `revenue` is employed under `odoo`, *then* it is refused with a count; an invoice raised before the connection, and one whose start is unknown, push nothing (the shared `cutover.revenue` suite, Odoo half, when it exists).
- **AC-OCI-003 (FR-004; U)** — *Given* a customer, project or invoice belonging to another tenant or absent, *when* an invoice or receipt is pushed, *then* it refuses `cross-org-link-rejected` with zero calls; the same for its own tenant is accepted (the shared `invoice.push` suite, Odoo half: the six existing cases).
- **AC-OCI-004 (FR-001; P)** — *Given* each role and an Operator, *when* the employ-revenue verb is called under a user JWT, *then* only the roles that may employ a domain succeed, and an org with an active ERPNext binding is refused.
- **AC-OCI-005 (FR-004, 020; U)** — *Given* `require_project_on_si` on and an invoice with no project, *then* it is refused with `project-required` and zero calls; *given* it off, *then* the invoice pushes with no distribution and rolls up as *Unassigned*.

### Customer invoice
- **AC-OCI-010 (FR-010, 011, 016; B)** — *Given* the bed, a mapped client, item and unit and a linked project, *when* an approved invoice is pushed, *then* exactly one posted Odoo customer invoice exists with the client, lines, quantities, prices, the client's PO as customer reference and every line's cost-account distribution; PMO shows Odoo's invoice number and status *Submitted*.
- **AC-OCI-011 (FR-012, NFR-005; U)** — *Given* a fault after the create and before the post, a fault after the post, and a lost response, *when* the command is retried, *then* each ends with one posted invoice and no second create (fake Odoo records every call).
- **AC-OCI-012 (FR-013; U)** — *Given* a line with an unmapped item, unit or client, or no resolvable income account, *when* pushed, *then* it refuses before any write naming the unmapped thing, and nothing is created in Odoo.
- **AC-OCI-013 (FR-014, 024; U)** — *Given* Odoo reports a total different from PMO's by more than the smallest unit, *then* both figures show, the invoice is *needs attention*, and PMO's stored total is not replaced; within a rounding unit it is accepted.
- **AC-OCI-014 (FR-015; U)** — *Given* an invoice with a PMO-recorded received date, *then* the command contains no due date and no received-date field, and PMO shows its receipt-based due date beside Odoo's.
- **AC-OCI-015 (FR-023; U)** — *Given* VAT-flag-on and -off projects and a product with a default tax in the mirror, *then* the on case sends the validated default sales tax id, the off case sends an explicit empty set, and an inactive, foreign-company or wrong-scope tax refuses naming it with zero calls.
- **AC-OCI-016 (FR-024; U)** — *Given* a read-back payload with the whole money header, one missing the residual, then the first writes untaxed/tax/total/outstanding and the second writes none.

### Billing claims, down payment, recovery, T&M
- **AC-OCI-020 (FR-017; B)** — *Given* a project with a live 200,000 down payment at 20% recovery and a claim of one BoQ line (10 km × 50,000), *when* the claim invoice is pushed, *then* Odoo holds one invoice with the BoQ line, a recovery line of −40,000 on the down-payment item and the project's distribution on both, and PMO's totals equal Odoo's.
- **AC-OCI-021 (FR-018; B)** — *Given* the bed with a down-payment item mapped to a customer-advance account, *when* a 200,000 down payment is billed and approved by a second user, *then* the posted invoice's line account is the advance account, and PMO shows it.
- **AC-OCI-022 (FR-018; U)** — *Given* a down-payment item whose mirrored income account is not the configured advance account, *then* the push refuses `config-rejected` naming the item with zero calls; *given* a read-back line on a different account, *then* the invoice is *needs attention* and not reported as booked.
- **AC-OCI-023 (FR-017, 019; U)** — *Given* a claim line set with a work order, *then* the command's lines equal the claim's recorded lines exactly (no recomputation), the work order's PO number is the customer reference, and the PMO row keeps `work_order_id`.
- **AC-OCI-024 (FR-019a; U)** — *Given* a signed T&M claim of 120 h × a contract rate (once #1514 has merged), *then* the command's lines are 120 × rate on the project's distribution and nothing for unsigned hours. *Mutation check:* sending an unsigned line turns it red.

### Project analytics
- **AC-OCI-030 (FR-022a; B)** — *Given* a posted invoice and a free-standing one, *then* all lines carry the project's cost account; *given* a posted line lacking it, *then* the invoice shows *needs attention: cost account missing* and revenue is not reported as booked.
- **AC-OCI-031 (FR-020, 021; U)** — *Given* an unlinked project, a needs-attention link, and an invoice with two projects, *when* pushed, *then* each refuses with zero calls and a named reason.
- **AC-OCI-032 (FR-022; U+P)** — *Given* an invoice with any Odoo reference, *when* the project is un-linked or re-linked, *then* it is refused through the shared check (U for the logic, P owns the database refusal).

### Customer receipt
- **AC-OCI-040 (FR-050, 051, 054; B)** — *Given* a posted invoice of 111,000, *when* Finance records a receipt of 111,000 into the chosen journal, *then* one posted customer payment exists, reconciled to the invoice, residual 0, and PMO shows *Paid* only after the next read; receipts of 40,000 then 71,000 settle it in two; 112,000 refuses.
- **AC-OCI-041 (FR-050, 055; U)** — *Given* no invoice reference, an unposted invoice, another tenant's invoice, or a currency other than the company's, *then* each refuses before any write.
- **AC-OCI-042 (FR-051, NFR-005; U)** — *Given* a fault after create, after post, after reconcile, and a lost response, *when* retried, *then* exactly one posted, reconciled receipt results and PMO shows no second receipt.
- **AC-OCI-043 (FR-052; U)** — *Given* a post-window probe that finds zero matches, two matches, and a unique match on the conjunction, *then* the command is held, held, and adopted respectively; never reissued. *Mutation check:* making the decision always "reissue" turns this red.
- **AC-OCI-044 (FR-051, 102; B)** — *Given* an invoice of 111,000 where the client withheld 2,000 income tax, *when* Finance records cash 109,000 + withheld 2,000 with a bukti-potong number, *then* the invoice closes (residual 0), the withheld part sits on the tax-prepaid account, and PMO shows settled 111,000, cash 109,000, withheld 2,000. If V-OCI8 shows stock calls cannot do this, this AC is replaced by AC-OCI-044b: a receipt with withholding is refused as *unavailable* with the named reason, and everything else in the group stands.
- **AC-OCI-045 (FR-051; U)** — *Given* withheld > 0 with no tax-prepaid account, no bukti-potong number, different account currencies, or cash + withheld ≠ settled, *then* each refuses before any write.
- **AC-OCI-046 (FR-053, 060, 062; U)** — *Given* a payload claiming a different `recorded_by`, *then* the recorder stored is the JWT subject.

### Separation of duties
- **AC-OCI-050 (FR-060, 062; D+P)** — *Given* the invoice's author and a different approver, *when* each tries to approve under their own JWT (with a payload claiming a different approver), *then* only the different user succeeds, the approver recorded is the JWT subject, and a refused approval leaves no outbox row and no Odoo call. *Mutation check:* setting the gate to allow turns it red.
- **AC-OCI-051 (FR-061; U)** — *Given* each role, *then* only roles the ERPNext tier allows may author, approve or record on the Odoo tier; `can()` and the dispatch gate agree.
- **AC-OCI-052 (FR-063; D+P)** — *Given* a held row, *when* the creator, an engineer, Finance and Admin try to resolve it, *then* only Finance and Admin who are not the creator succeed, with an audit row.

### Idempotency and recovery
- **AC-OCI-060 (FR-070; P)** — *Given* two concurrent claims for one key, *then* exactly one proceeds (the shipped outbox mechanism, exercised with `tier = 'odoo'` rows and revenue kinds).
- **AC-OCI-061 (FR-071, 072, 074; U)** — *Given* a timeout, a 5xx, a 429 and a validation error, *then* they classify as pending, pending, retry-then-pending and commit-rejected respectively, and no response or log contains an Odoo body.
- **AC-OCI-062 (FR-072; B)** — *Given* the bed with its network cut after the commit and before the response (proxy kill), *when* the sweep tick runs, *then* the row is linked and confirmed with one Odoo invoice; *given* the anchor edited in Odoo before recovery, *then* the row ends held.
- **AC-OCI-063 (FR-073; U)** — The reclaim, deadline, clearance and read-cap relationships hold for the Odoo constants (one assertion each).

### Read-back, credit notes, pairing
- **AC-OCI-070 (FR-080, 085; P)** — *Given* two orgs, *then* org A's user cannot write any revenue mirror column, and a service-role page apply with org B's context cannot touch org A's rows.
- **AC-OCI-071 (FR-081; U)** — *Given* invoice states draft, posted with and without residual, cancelled; receipts inbound, outbound, blank and absent direction; *then* the derived PMO statuses and classifications are as FR-081 states, a cancelled document is marked and not deleted, and an unrecognised direction is skipped (the shared `receipt.read` suite, Odoo half).
- **AC-OCI-072 (FR-083; U)** — *Given* an Odoo-native invoice, the same invoice listed twice, and an anchored orphan, *then* each is mirrored once at its newest figures and the orphan is proposed for adoption (the shared `invoice.pair-existing` suite, Odoo half, once it exists).
- **AC-OCI-073 (FR-086; B)** — *Given* a mirrored invoice hard-deleted in Odoo, *when* the census runs, *then* it is tombstoned and not counted in billed-to-date or receivables.
- **AC-OCI-074 (FR-080; U)** — *Given* a page that fails halfway, *then* the cursor did not advance and a replay yields identical rows; a record committed late with an earlier `write_date` is picked up.
- **AC-OCI-075 (FR-084; B)** — *Given* a credit note posted in Odoo against a mirrored invoice, *then* PMO shows it linked to the invoice as a negative document and the invoice's outstanding equals Odoo's residual.

### Tax documents
- **AC-OCI-080 (FR-090; U)** — *Given* capability `tax-document.read` declared `unavailable`, *then* no screen, label or API field mentions an Odoo-generated tax document, and the declaration carries the reason.
- **AC-OCI-081 (FR-091; U)** — *Given* a numbered, VAT-bearing Odoo-tier invoice, *when* Finance records an e-Faktur number and date together, *then* both persist on the PMO invoice; a non-VAT or unnumbered invoice offers none (existing `EfakturModal` rules, unchanged).
  - *Rule:* "non-VAT" means the invoice's project is not subject to VAT (`projects.subject_to_vat` false); the UI hides the control and `set_sales_invoice_efaktur` refuses a number there (clearing stays allowed). A zero-rated invoice on a VAT-subject project (tax amount 0) still offers it; an invoice with no project is treated as subject to VAT.
- **AC-OCI-082 (FR-092; B)** — *Given* the bed and a posted Indonesian customer invoice, *when* V-OCI9 shows stock tax-invoice facts, *then* PMO mirrors them read-only and shows "held by Odoo" beside the hand-recorded number; a disagreement shows both and flags *needs attention*. If V-OCI9 shows nothing is exposed without Enterprise, this AC is replaced by AC-OCI-082b (the capability stays `unavailable`; the manual record remains the route) and the spec records the finding.
- **AC-OCI-083 (FR-093; B)** — *Given* V-OCI10/11 show a stock call yielding the export, *then* Admin and Finance download it through PMO, the key never reaches the client; otherwise the control is absent (U).
- **AC-OCI-084 (FR-094; U)** — *Given* any tax-document flow, *then* no call goes to the tax authority and no Odoo tax-document field is written (the fake records every call).

### Screens and cross-cutting
- **AC-OCI-090 (FR-100, 101, 104; U)** — *Given* each outcome class and an unhealthy connection, *then* the invoice list shows the plain-words state, the age, and the next step; actions that need Odoo fail honestly and queue nothing.
- **AC-OCI-091 (FR-102, 103; U)** — *Given* a withheld receipt, a plain receipt, a credit-noted invoice and an empty journal directory, *then* the three receipt figures show only on the first, the credit note on the third, and the journal picker disables with a reason on the fourth.
- **AC-OCI-092 (FR-105; U)** — *Given* each role and an impersonating Admin, *then* only controls the real role may use render; i18n parity (en/id) and the axe check pass; 320 px renders without horizontal scroll.
- **AC-OCI-093 (NFR-009; U)** — The vocabulary guard fails if Odoo model or field names appear in `pmo-portal/src` outside the adapter directory.
- **AC-OCI-094 (NFR-007; U)** — `contractSuite/parity.test.ts` passes with Odoo declaring `invoice.push` and `receipt.read` **supported** at the suites' current version, and `invoice.pair-existing` and `cutover.revenue` still `pending` on #1602 unless their shared suites exist by build time, in which case they too pass for Odoo.
- **AC-OCI-100 (ticket acceptance; B+E)** — *Given* a stock Odoo Community bed with no custom module and an approved claim, *when* it is invoiced by one user, approved by another, and paid by the client (with and without withheld tax), *then* PMO shows the Odoo invoice number, the project attribution, the payment and the e-Faktur record (and, if V-OCI9–11 proved it, the Odoo-held tax document), and after an interruption and recovery at each of the two steps Odoo holds exactly one invoice and one receipt, with no duplicate posting. Composite of AC-OCI-010, 020, 040, 044, 062; the curated journey is **E** (`e2e/AC-OCI-100-odoo-client-invoice-to-receipt.spec.ts`), asserting DB rows and the rendered figures.

## 11. Data model (indicative; the builder confirms against the shipped DDL at `origin/dev`)

Migration slots **0510–0514 only**; a slot unused at the end of the build is returned to the Director, never reused. (O2 holds 0505–0509.)

- **0510 — enable `revenue` under tier `odoo`.** Extend the guarded employ verb and its binding checks so the domain can be employed for `odoo`; add the `cutover.revenue` stranded-drafts refusal if the shared check does not already cover tier `odoo`; confirm whether `external_command_outbox` and `external_refs` need a tier or kind CHECK widened; audit rows. No new table.
- **0511 — revenue mirror columns.** Additive columns on `sales_invoices` and `incoming_payments` only where the shipped `erp_*` set cannot hold an Odoo fact (Odoo state, cancel tombstone, mismatch flag, credit-note link, needs-attention reason); extend the revenue mirror guard so a user JWT cannot write them. Reversible.
- **0512 — receipt defaults.** The binding-config key for the tax-prepaid account and its actor-checked setter; reuse the O2 payment-journal default (0509) for the receipt journal, adding a separate receipt-journal key only if O2's does not serve inbound.
- **0513 — revenue feed apply.** A service-only function that upserts a page of revenue documents **and** advances that domain's watermark in one transaction, org taken from the verified binding; census/tombstone function; the held-row resolution RPC extended to revenue kinds. Domains `sales-invoice`, `credit-note`, `incoming-payment` under tier `odoo`.
- **0514 — Odoo-held tax-document facts.** Read-only columns (or a small org-scoped table) for the tax-document number/status/export reference, a service-only writer, unwritable by a user JWT. **Built only if V-OCI9 proves the facts exist; otherwise the slot is returned unused.**

Every new function that is `SECURITY DEFINER` is added to the pgTAP 0178 allow-list and the 0136/0137 inventories in the same slice.

## 12. Slice split

See `docs/plans/2026-11-02-odoo-client-invoices.md` §3. Money-committing slices (C2–C5) are Director-dispatched, ship alone, and pass the three-reviewer battery with `security-auditor` mandatory.
