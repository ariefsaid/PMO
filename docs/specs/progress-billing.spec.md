# Spec: progress assessment, down payment and billing claims against a contract (issue #766)

> **Status:** Draft — 2026-10-06, revised the same day after the owner's ruling below.
> **Plan:** [`docs/plans/2026-10-06-progress-billing.md`](../plans/2026-10-06-progress-billing.md).
> **ADR:** [ADR-0077](../adr/0077-down-payment-as-advance-item-invoice-lines.md).
> **Builds on:** OD-WO-1/2 (a project IS the contract; a work order is the client's PO), DD-WO-1..10 (work
> orders, `sales_invoices.work_order_id`), ADR-0048/0055/0058 (ERPNext owns money; outbox), OD-SAR-DRAFT-SUBMIT
> + 0113/0132 (draft-then-submit, invoice author set), the revenue-write ruling of 2026-07-20 (Admin + Finance
> raise invoices), OD-TAX-1 + 0197 (net-of-tax normalisation), the document-register rule of 2026-06-12 (an
> issued document's content is frozen; a change needs a new revision), #765 / ADR-0076 / migration
> `0245_management_pack.sql` (`project_progress_entries`, `record_project_progress`, `get_management_pack`,
> DD-MMP-1..6).
> **Migrations of this feature:** `0250_progress_billing.sql` and `0251_management_pack_billed_work.sql`.
> **Executor:** money path — Director-dispatched (CLAUDE.md executor routing).
> **Ids:** rulings are `DD-PBL-n` (`DD-PB-1` is already a budget-push ruling in `docs/decisions.md`).
> **Amended 2026-10-07:** §7 — billing by work order (owner ruling OD-BILL-1, #785 / #786;
> [ADR-0080](../adr/0080-billing-by-work-order.md); plan
> [`docs/plans/2026-10-07-billing-by-work-order.md`](../plans/2026-10-07-billing-by-work-order.md); migration
> `0262_billing_by_work_order.sql`; rulings `DD-BWO-n`).
> **Amended 2026-10-21:** §8 — contract quantities, work-order allocations and BAST; OD-CQ-1..4,
> DD-CQ-1..8, [ADR-0090](../adr/0090-work-order-closing-value-and-bast.md),
> [plan](../plans/2026-10-21-contract-quantities.md), migration `0337_contract_quantities.sql`.
> §8 supersedes the single-work-order-per-line scope in DD-PBL-4 / FR-PB-002 / FR-PB-007 and
> the percent-only assessed-value rule for projects with contract lines; earlier text is retained as history.

## Owner ruling (2026-10-06)

> "Progress claims by the project manager are not tied to invoicing. They mainly capture a subjective
> assessment of project progress, operationally. An invoice needs more administrative evidence that the work is
> done — reports etc."

This spec therefore separates a **progress assessment** (operational, the PM's judgement, never an invoice) from
a **billing claim** (financial, Finance's act, evidence-gated, the only thing that reaches the ERP).

## Director rulings (DD-PBL-n — ruled 2026-10-06, see `docs/decisions.md`)

Renumbered after the ruling. "Was" gives the previous number; **changed** / **new** mark what moved.

- **DD-PBL-1 — ERP posting (ADR-0077).** *(unchanged)* The down payment is a Sales Invoice with one line on an
  org-configured down-payment item whose ERPNext income account is the customer-advance (liability) account.
  Each billing claim is a Sales Invoice with its quantity lines plus one negative-rate line on that same item for
  the recovery. No advance Payment Entry allocation, no Sales Order, no Journal Entry.
- **DD-PBL-2 — two concepts.** *(new)* A **progress assessment** records how much work is done; it is
  operational, editable, and never creates an invoice or touches the ERP. A **billing claim** records what is
  invoiced; it is raised by Finance or Admin, needs evidence, and is the only path to an invoice.
- **DD-PBL-3 — one source of operational progress.** *(new)* There is no second progress table. An assessment
  is #765's `project_progress_entries` row for that project and month, optionally with per-BoQ-line
  **quantities done to date** in a child table. When quantities are recorded, the month's `pct_complete` is
  derived from them, weighted by BoQ value and with each line capped at its BoQ quantity, so the management pack
  (which reads `pct_complete`) needs no change to see it. A project with no BoQ keeps #765's typed percent. A
  month measured by quantities refuses a typed percent through `record_project_progress`. Months stay editable
  by re-recording; period closing remains out of scope, as in #765.
- **DD-PBL-4 — scope.** *(was 2; unchanged)* The BoQ belongs to the project (the contract). A BoQ line may name
  one work order on the same project. A billing claim covers either the project's untagged lines or exactly one
  work order's lines; the work order must be Issued or Closed and supplies the invoice's client PO.
  **Superseded in part (2026-10-21):** the single `boq_items.work_order_id` link and untagged-line scope
  are replaced by allocations and allocation-based claim scope (DD-CQ-2/6, §8).
- **DD-PBL-5 — recovery.** *(was 3; unchanged)* One live down payment per project, with its recovery % on the
  down-payment claim. Each billing claim recovers `round(gross × % / 100, 2)`, capped at the unrecovered balance;
  "recover the rest" takes `min(balance, gross)`. A billing claim is refused while the live down payment's
  invoice is not yet submitted.
- **DD-PBL-6 — tax basis.** *(was 4; unchanged)* BoQ rates and the DP amount exclude tax. ERPNext does NOT expand a tax
  template named over REST, so the dispatch reads the company's default Sales Taxes and Charges template and sends its
  rows explicitly as `On Net Total` (DD-PBL-12b), scaled by the contract's reduced tax base (#798). The recovery line lowers each claim's taxable base by the DP already taxed.
- **DD-PBL-13 — every invoice carries tax rows, gated by the project's VAT flag (#856, OD-TAX-4).** Ordinary invoice creates and
  claim/down-payment invoices send the same explicit `On Net Total` rows, built server-side from the ERP default template
  and the project's reduced-base fraction (#798). The project's "Subject to VAT (PPN)" flag (default on; Finance/Admin
  set it with the contract value; locked once the project has an invoice, cancelled ones included, or one is in flight) decides: off → no rows and no template read.
  A caller-supplied `taxes` array is always dropped. A VAT-on invoice is never sent untaxed: with no enabled default Sales Taxes and Charges template in ERPNext the dispatch is refused (`config-rejected`) with the setup action. Edits and amends send none.
- **DD-PBL-7 — a billing claim is immutable, IS its invoice's record, and needs evidence.** *(was 5; changed)*
  The claim id is the invoice's PMO record id, so one claim mints at most one invoice. The server builds the
  invoice from the claim only and refuses edit/amend. **No invoice can be raised for a claim until at least one
  evidence document is attached** — a document from the project's own register, Issued or Approved (content
  frozen by the register rule) and carrying a file. The database refuses the raise without it. Evidence is
  attach-only; a cited document cannot be deleted. A claim may start from the latest assessment's quantities
  (the quantities assessed but not yet claimed), but it is Finance's own statement and may differ from it.
  A not-yet-raised claim can be withdrawn; a raised one is corrected by cancelling its invoice.
- **DD-PBL-8 — who.** *(was 6; changed)* Record an assessment: the project's own PM, or Finance rank and above
  on any project — #765's `may_record_project_progress`, unchanged. BoQ: Admin, Executive, PM, Finance. Billing
  claims, evidence and withdrawal: Admin and Finance. The claim's creator joins the invoice's author set, so
  neither creator nor raiser may submit it. The org's down-payment item: Admin.
- **DD-PBL-9 — the numbers.** *(was 7; changed)* **Billed to date** = the project's submitted/unpaid/paid
  invoices in its currency, net of tax, with each claim invoice adding back the recovery its negative line
  removed, and down-payment invoices excluded. This rule is defined once, as the view
  `sales_invoice_work_billed`, and both this feature and the management pack read it. **Assessed to date** = the
  latest assessment's percent × net contract, computed with the management pack's own `pctOf` — it is the
  pack's "recognised to date" on progress basis. **Work done, not yet billed** = assessed − billed: the pack's
  "unbilled" for the current month, not a second figure. Down payment held = DP invoiced − recovered. Nothing is
  clamped. The overview's existing "Invoiced to date / Remaining to invoice" (a cash view) is unchanged.
- **DD-PBL-10 — over-measuring and over-claiming are allowed and shown, not blocked.** *(was 8; widened)*
  Remeasurement is normal (DD-WO-2 precedent). An assessment may record more than a BoQ quantity (the percent
  still counts that line at most to 100%); a claim may bill more than the BoQ or more than was assessed. The
  submit SoD and the evidence are the controls. Quantities carry at most 3 decimals (ERPNext's default float
  precision). *(2026-10-07: a claim on a work order is now also capped by what is still to invoice on that work
  order — §7, DD-BWO-4. Over-claiming against the BoQ stays allowed.)*
- **DD-PBL-11 — retention is out of scope.** *(was 9; unchanged)* Indonesian PPN is charged on the full progress
  value, so a negative retention line would wrongly cut the tax base; retention needs its own decision.
- **DD-PBL-12 — the ERP site must be set up for claims (spike 2026-10-06).** (a) Selling Settings "Allow Negative rates for Items"
  must be on, or ERPNext refuses the recovery line at submit: ERP onboarding enables it (reported, never fatal), and a claim
  with a recovery line fails fast with the action to take if the site still has it off. (b) Tax rows are sent explicitly
  (DD-PBL-6), for claim invoices and, since #856, for ordinary invoice creates too (same helper; see DD-PBL-13).

## Owner questions (each has a default the build uses)

1. **Is a down payment per contract or per client PO?** Default: per contract (project), one at a time.
2. **Does the client's accountant want down-payment invoices booked to a customer-advance account automatically,
   with PPN on the down-payment invoice?** Default: yes — it is what their half-year close did by hand.
3. **(new) What evidence must a billing claim carry before its invoice can be raised — any issued document, or
   specifically the client's acceptance (BAST)? And does a down payment need evidence too?** Default: at least
   one Issued or Approved document with a file from the project's register, of any category, chosen by Finance;
   and yes, a down payment needs one too (normally the signed contract or PO).

The earlier question "may a PM prepare a claim for Finance to raise?" is answered by the ruling: PMs assess,
Finance bills.

## 1. Job stories

- When I (PM) look at my project at month end, I want to record how far along each BoQ line is, so the
  organisation sees real progress without that turning into an invoice.
- When I (Finance) have the client's evidence that work is done, I want to bill it — starting from what the PM
  assessed — with the down payment recovered proportionally, so billed-to-date and remaining contract value are
  right and the ERP holds the down payment in a customer-advance account until it is recovered.
- When I (Finance/Executive) review a project, I want to see work done but not yet billed.

## 2. Current state (read 2026-10-06)

- `projects` carries `contract_value` + tax basis + currency + `client_id` + `project_manager_id`. `work_orders`
  (0193) is the client's PO; `sales_invoices.work_order_id` exists but no write path sets it.
- #765 (migration 0245) added `project_progress_entries` (one row per project per month, `pct_complete` 0–100,
  re-recordable, recorder stamped) written by `record_project_progress` under `may_record_project_progress`
  (Finance rank, or the project's PM). `get_management_pack` derives "recognised to date" from it and "unbilled" =
  recognised − invoiced. No quantity-level progress exists.
- Sales invoices are created only through `adapter-dispatch` into ERPNext as drafts and submitted by a different
  Admin/Finance user (`sales_invoice_authors`, 0132). `sales_invoices.amount` mirrors `grand_total`.
- `project_documents` is the controlled document register (Draft → Issued → Approved; issued content is frozen;
  a file in Storage via `file_path`).
- No BoQ, billing claim, down payment or evidence concept exists. A DP invoice counts toward "Invoiced to date"
  and the pack's invoiced figure, and nothing ever nets it.

## 3. Requirements (EARS)

### Functional — progress assessment

- **FR-PB-001** The system shall let Admin, Executive, PM and Finance keep a bill of quantities on a project: lines
  with an ERP item code, description, unit, quantity (> 0, at most 3 decimals) and rate (≥ 0, 2 decimals,
  excluding tax).
- **FR-PB-002** Where a BoQ line names a work order, the system shall require that work order to be on the line's
  project. **Superseded (2026-10-21):** same-project validation now applies to `work_order_lines`,
  not a `boq_items.work_order_id` column (DD-CQ-2/6, §8).
- **FR-PB-021** When the project's PM, or a Finance-rank-or-above user, records an assessment for a project and
  month, the system shall store the quantity done to date for each BoQ line sent (≥ 0, at most 3 decimals),
  replace that month's earlier quantities, and set the month's percent complete to
  `round(Σ min(done, BoQ qty) × rate / Σ BoQ qty × rate × 100, 2)`.
- **FR-PB-022** If an assessment names a line outside the project's BoQ, repeats a line, or the BoQ has no value,
  then the system shall refuse it with a message naming the problem.
- **FR-PB-023** If a percent complete is typed for a month already measured by quantities, then the system shall
  refuse it and say to record quantities instead.
- **FR-PB-024** The system shall never create a billing claim, an invoice or an outbox command from an assessment.

### Functional — billing claims

- **FR-PB-003** When Admin or Finance bills a down payment, the system shall record a down-payment claim with its
  amount (> 0, excluding tax) and recovery percentage (> 0 and ≤ 100, at most 3 decimals), and the org's
  down-payment item at that moment.
- **FR-PB-004** If the org has no down-payment item configured, then the system shall refuse a down-payment claim
  with a message naming the setting.
- **FR-PB-005** While a project has a live down payment (not withdrawn, invoice not cancelled), the system shall
  refuse a second one.
- **FR-PB-006** When Admin or Finance creates a billing claim, the system shall record each claimed line's
  quantity with the BoQ line's item, description, unit and rate copied at that moment, each line amount as
  `round(quantity × rate, 2)` and the claim's gross as their sum.
- **FR-PB-025** Where the user starts a billing claim from the latest assessment, the system shall pre-fill each
  in-scope line with the quantity assessed to date less the quantity already claimed on live claims, omitting
  lines where that is not above zero; the user may change every figure.
- **FR-PB-007** Where a claim names a work order, the system shall accept only that work order's BoQ lines and
  require the work order to be Issued or Closed; where it names none, only lines with no work order.
  **Superseded scope (2026-10-21):** eligibility is an allocation on the selected WO, or no allocation
  anywhere for a claim without a WO (DD-CQ-2/6, §8); the status and client-PO rules stand.
- **FR-PB-008** While the project has a live down payment whose invoice is Submitted, Unpaid or Paid, the system
  shall set a billing claim's recovery to `min(round(gross × % / 100, 2), unrecovered balance)`.
- **FR-PB-009** Where the user chooses to recover the rest, the system shall set the recovery to
  `min(unrecovered balance, gross)`.
- **FR-PB-010** If the project's live down payment has no submitted invoice, then the system shall refuse a
  billing claim with a message naming the remedy.
- **FR-PB-011** The system shall accept claimed quantities beyond a BoQ line's quantity or beyond what was
  assessed, and show the excess.
- **FR-PB-012** The system shall never change a claim's figures or lines after it is created; Admin or Finance may
  withdraw a claim that has no invoice.
- **FR-PB-026** When Admin or Finance attaches evidence to a claim, the system shall accept only a document of the
  claim's project that is Issued or Approved and has a file, record its status and revision at that moment, and
  prevent the document's deletion while it is cited.
- **FR-PB-027** If a claim has no evidence, then the database shall refuse any attempt to raise its invoice, and
  the application shall say to attach evidence first.
- **FR-PB-013** If a claim has an invoice or a non-failed ERP attempt, then the system shall refuse to withdraw it;
  if a claim is withdrawn, then the database shall refuse any later attempt to raise its invoice.
- **FR-PB-014** When Admin or Finance raises a claim's invoice, the system shall create one ERPNext Sales Invoice
  draft whose PMO record id is the claim id, for the project's client, with lines built only from the claim: a
  down payment as one line on its down-payment item; a progress claim as one line per claimed BoQ line plus, when
  the recovery is above zero, one negative-rate line on the down-payment item; the project dimension and client
  PO as for any invoice.
- **FR-PB-015** If a raise names a project or customer other than the claim's, or a command would edit or amend a
  claim's invoice, then the system shall refuse it before any ERP call.
- **FR-PB-016** When a claim's invoice is recorded, the system shall add the claim's creator to the invoice's
  author set.
- **FR-PB-020** When a claim's invoice is created, the system shall record the claim's work order on the invoice
  mirror.

### Functional — figures and settings

- **FR-PB-017** The system shall report per project, net of tax in the project's currency: contract value,
  billed to date, down payment invoiced, recovered and held, contract value not yet billed, raised-but-not-
  submitted value, the latest assessment (month and percent), assessed to date, work done not yet billed, and per
  BoQ line the quantity assessed to date and the quantity claimed on live claims.
- **FR-PB-018** The management pack shall take its invoiced figure from the same billed-to-date definition, so
  down-payment invoices are excluded and claim invoices count at net plus recovery.
- **FR-PB-019** When an Admin sets the org's down-payment item in Administration → Accounting, the system shall
  store it (at most 140 characters) and audit the change.

### Observed (existing behaviour this builds beside)

- **OBS-PB-001** The overview's "Invoiced to date / Remaining to invoice" sums every submitted invoice on the
  contract basis (`calculateProjectInvoiceSummary`). Unchanged.
- **OBS-PB-002** Submitting a sales invoice (Sales Invoices page) is the existing SoD-gated path; claim invoices
  are submitted there.
- **OBS-PB-003** `sales_invoices.work_order_id` has never been written by any path before this feature.
- **OBS-PB-004** `project_progress_entries` accepts direct table writes of `pct_complete` (#765 grants it). A
  direct write on a quantity-measured month would bypass FR-PB-023; the UI uses only the RPCs. Accepted: an
  assessment moves no money.

### Non-functional

- **NFR-PB-001 (performance)** The billing summary is one SECURITY INVOKER RPC returning one jsonb document. A
  claim has at most 500 lines (refused above; the dispatch reads them under a 501-row cap). The claims list reads
  at most 500 claims per project.
- **NFR-PB-002 (money exactness)** SQL `numeric`; recovery rounded half away from zero to 2 decimals; the UI
  derives held/remaining/assessed/gap in integer cents with the management pack's helpers.
- **NFR-PB-003 (security/tenancy)** New tables FORCE RLS with `is_active_member()` on every policy; client-written
  tables stamped by `stamp_org_id`; no client write privilege on claim or evidence tables; definer RPCs re-assert
  membership, role and org; `anon` holds nothing; the three definer client RPCs join the 0178 allow-list; the
  shared view is `security_invoker`.
- **NFR-PB-004 (reversibility)** `supabase/migrations/rollback/0250_progress_billing_down.sql` and
  `…/0251_management_pack_billed_work_down.sql`.
- **NFR-PB-005 (i18n)** Every new string on the project page has English and Indonesian entries.
- **NFR-PB-006 (honest states)** Loading shows skeletons; a failed or malformed read shows an error, never a 0; no
  assessment reads "No assessment yet", never 0%.

## 4. Acceptance criteria (Given/When/Then)

- **AC-PB-001** Given a project, When a PM adds a BoQ line (item, unit, quantity, rate) without stating an org,
  Then it is stored and stamped with the PM's org; And a line may name a work order on the same project but not
  another project's (23514); And quantity 0 or NaN and a negative rate are refused (23514); And a PM may change
  the quantity but not move the line (42501); And an Engineer cannot add lines, an offboarded member and another
  org read none, and anon cannot read the table.
- **AC-PB-002** Given a 200,000 down payment recovered at 20% whose invoice is Unpaid and a BoQ line of 10 km at
  50,000, When Finance claims 4, 6, 12 then 1 km, Then gross is 200,000 / 300,000 / 600,000 / 50,000 and
  recoveries are 40,000 / 60,000 / 100,000 (capped) / 0; And the line copies item, description, unit, quantity
  4.000, rate 50,000 and amount 200,000; And over-claiming is accepted; Given a 100,000 down payment and two
  claims of 50,000 and 100,000 that recover the rest, Then they recover 50,000 and 50,000; Given no down payment,
  Then recovering the rest is refused.
- **AC-PB-003** Given the ERP bench with a down-payment item mapped to a customer-advance account and a project
  with a BoQ line and an issued evidence document, When Finance bills a 200,000 down payment, attaches the
  evidence, raises it and a second user submits it, then claims 4 km at 50,000, attaches evidence, raises and a
  second user submits, Then the down-payment invoice's ledger credits the advance account 200,000; And the claim
  invoice carries the BoQ line and a −40,000 line on the down-payment item with grand total 160,000; And its ledger
  debits the advance account 40,000 and the receivable 160,000 and credits 200,000 to a non-advance account; And
  PMO reports billed to date 200,000, down payment invoiced 200,000 and recovered 40,000.
- **AC-PB-004** Given claims are created through `create_progress_claim`, Then a PM, an Engineer, an offboarded
  Finance user and another org's Admin are refused with their named messages; a line from another project or
  outside the claim's work-order scope, a Draft work order, a quantity with 4 decimals, a duplicate line, an empty
  list, more than 500 lines, a negative down payment, a 0% recovery, a second live down payment, a billing claim
  before the DP invoice is submitted, and a DP with no org item are each refused with their named messages; And
  clients hold no write privilege on claim tables; And a claim's figures and lines cannot be updated even by the
  table owner; And a later BoQ rate change does not change a claim line; And creation is audited; And anon cannot
  execute the RPC.
- **AC-PB-005** Given an unraised claim that recovered the whole down payment, When Finance withdraws it, Then it
  is stamped withdrawn and the next claim recovers again; And withdrawing twice, withdrawing with a pending ERP
  attempt, and withdrawing a raised claim are refused with named messages; And a claim whose only attempt failed
  can be withdrawn; And an outbox insert for a withdrawn claim is refused (55000) while inserts for a live claim
  with evidence and for a non-claim record pass; And a PM and another org's Admin cannot withdraw; And withdrawal
  is audited.
- **AC-PB-006** Given a claim with evidence, When its invoice is dispatched, Then the ERP body's lines come only
  from the claim even when the caller sent others; And a project or customer other than the claim's, an update, a
  withdrawn claim and a claim without evidence are refused before any ERP call; And two resolutions produce the
  identical outbox digest; And the claim's work order supplies the client PO; And a non-claim invoice keeps the
  caller's lines.
- **AC-PB-007** Given a 1,000,000 exclusive contract, a 200,000 DP (invoice Paid, 222,000 incl. 22,000 tax), a 4 km
  claim (invoice Unpaid, 177,600 incl. 17,600 tax), a 2 km claim whose invoice is Cancelled, an unraised 1 km claim,
  a plain project invoice of 55,500 incl. 5,500 tax, and an assessment this month of 6 km done, When Finance reads
  the billing summary, Then billed to date is 250,000, DP invoiced 200,000, recovered 40,000, raised-not-submitted
  40,000, contract 1,000,000 (an inclusive 1,110,000 with 110,000 tax reads 1,000,000), the assessment is this
  month at 60.00%, and the BoQ line shows 5 claimed and 6 assessed; And another org reads null; And anon cannot
  execute it and it is not SECURITY DEFINER.
- **AC-PB-008** Given the project Billing tab, Then the summary shows contract, billed to date, assessed to date,
  work done not yet billed, down payment held, contract not yet billed and raised-not-submitted, each "excl. PPN";
  with no assessment it says "No assessment yet" instead of a figure; loading shows none and a failed read shows
  the error; And the BoQ table shows assessed and claimed quantities and the remainder, flagging over-claimed
  lines; And claims show their invoice or "Not raised", their evidence count, and Raise only once evidence exists;
  And Finance and Admin see the billing buttons, the project's PM sees "Record progress" and BoQ editing but no
  billing buttons, another PM sees no "Record progress", an Engineer has no Billing tab, and billing buttons are
  absent without an ERP connection or a project client.
- **AC-PB-009** Given the claim dialog, When Finance bills a down payment, Then amount and percentage are validated,
  the proportional percentage is shown as help and the exact input is sent; When Finance claims progress, Then only
  the chosen scope's lines are offered, "start from the latest assessment" fills assessed-minus-claimed quantities,
  at least one quantity with at most 3 decimals is required and "recover the rest" is sent when ticked; After a
  claim is created and has evidence, Then the raise confirmation shows the server's claimed, recovered and net
  figures and raising dispatches a sales-invoice create whose record id is the claim id and whose customer is the
  project's client; And a refused raise leaves the claim "Not raised".
- **AC-PB-010** Given invoices — a plain 100,000 in March, a DP invoice of 200,000 in March and a claim invoice of
  net 160,000 recovering 40,000 in April — When Finance requests the management pack, Then March is 100,000 and
  April 200,000; And an undated DP invoice is not in the undated count.
- **AC-PB-011** Given Administration → Accounting, When an Admin sets the down-payment item, Then it is stored,
  audited with before and after, at most 140 characters, and Finance can read but not change it.
- **AC-PB-012** Given a claim created by Finance A, When its invoice mirror row is inserted, Then A is in the
  invoice's author set; And a non-claim invoice gets no author row from this rule.
- **AC-PB-013** Given a claim invoice create naming a work order, When the mirror row is written, Then it carries
  that work order; And one naming none writes no work-order key.
- **AC-PB-014** Every new `projectDetail.billing.*` key and `projectDetail.tabs.billing` exists, non-empty, in the
  English and Indonesian catalogues.
- **AC-PB-015** Given the BoQ line dialog, Then item, description, unit, quantity (> 0, ≤ 3 decimals) and rate
  (≥ 0, ≤ 2 decimals) are validated, the work-order choice lists only this project's work orders plus "none", and
  a valid save sends the exact input.
- **AC-PB-016** Given billing facts, Then DP held and contract not yet billed are exact in cents and never
  clamped; assessed to date is the pack's `pctOf` of the net contract, work not yet billed is assessed − billed,
  and both are null without an assessment; remaining quantity is exact to 3 decimals; the proportional percentage
  is DP ÷ contract × 100 to 3 decimals; the assessment pre-fill is assessed − claimed per line, omitting lines not
  above zero.
- **AC-PB-017** Given a project with BoQ lines of 10 km at 50,000 and 5 units at 100,000, When its PM records 4 km
  and 1 unit done for September, Then September's entry reads 30.00% recorded by the PM with two quantity rows;
  re-recording 6 km and 1 unit makes it 40.00%; re-recording only 6 km removes the unit row (30.00%); 12 km counts
  as 10 (50.00%); And a typed percent for September is refused while a typed percent for August is accepted; And a
  negative or 4-decimal quantity, another project's line, a repeated line, an empty list and a BoQ with no value
  are refused with named messages; And another PM and an Engineer are refused, Finance may record on any project,
  and a direct quantity insert by another PM is refused by RLS; And no claim or outbox row results; And a BoQ line
  with recorded quantities cannot be deleted; And anon cannot execute the RPC and it is not SECURITY DEFINER.
- **AC-PB-018** Given a claim, When Finance attaches an Issued document of the project with a file, Then the
  evidence row records its status, revision and attacher, a repeat attach adds nothing, and it is audited once;
  And a Draft document, a document with no file, another project's document, a PM, another org's Admin and a
  withdrawn claim are refused with named messages; And an outbox insert for a claim without evidence is refused
  (55000) while one with evidence passes; And a cited document cannot be deleted (23503); And clients hold no write
  privilege on the evidence table; And anon cannot execute the RPC.
- **AC-PB-019** Given the assessment dialog, Then every BoQ line is offered pre-filled with the latest assessed
  quantity, a negative or 4-decimal quantity and a malformed month are refused, and a save sends every line (blank
  as 0) with the month as `YYYY-MM-01`.
- **AC-PB-020** Given the evidence dialog, Then only the project's Issued or Approved documents with a file that
  are not already attached are offered, attaching sends the chosen document, and with none available it says so
  and cannot submit.

## 5. AC owning layer (ADR-0010)

| AC | Owning layer | Canonical proof |
|---|---|---|
| AC-PB-001 | pgTAP | `supabase/tests/0250_progress_billing_boq.test.sql` |
| AC-PB-002 | pgTAP | `supabase/tests/0250_progress_billing_claims.test.sql` |
| AC-PB-003 | Playwright (served lane + ERP bench) | `pmo-portal/e2e/serial/AC-PB-003-progress-billing-erp.spec.ts` |
| AC-PB-004 | pgTAP | `supabase/tests/0250_progress_billing_claims.test.sql` |
| AC-PB-005 | pgTAP | `supabase/tests/0250_progress_billing_withdraw.test.sql` |
| AC-PB-006 | Vitest | `pmo-portal/src/lib/adapterSeam/erpnext/progressClaimInvoice.test.ts` (+ `progressClaimItems.test.ts`) |
| AC-PB-007 | pgTAP | `supabase/tests/0250_progress_billing_summary.test.sql` |
| AC-PB-008 | Vitest/RTL | `pmo-portal/pages/project-detail/tabs/__tests__/BillingTab.test.tsx` (+ `src/auth/policy.progressBilling.test.ts`, `ProjectDetail.tabs.test.tsx`, `src/lib/db/progressBilling.test.ts`) |
| AC-PB-009 | Vitest/RTL | `pmo-portal/pages/project-detail/__tests__/ProgressClaimModal.test.tsx` (+ `src/lib/repositories/progressBilling.test.ts`, `BillingTab.test.tsx` for the raise confirmation) |
| AC-PB-010 | pgTAP | `supabase/tests/0251_management_pack_billed_work.test.sql` |
| AC-PB-011 | pgTAP | `supabase/tests/0250_progress_billing_boq.test.sql` (+ `pages/admin/OrgDownPaymentItem.test.tsx`) |
| AC-PB-012 | pgTAP | `supabase/tests/0250_progress_billing_withdraw.test.sql` |
| AC-PB-013 | Deno | `supabase/functions/adapter-dispatch/readModelWriters.money.test.ts` |
| AC-PB-014 | Vitest | `pmo-portal/src/lib/progressBilling.i18n.test.ts` |
| AC-PB-015 | Vitest/RTL | `pmo-portal/pages/project-detail/__tests__/BoqItemFormModal.test.tsx` |
| AC-PB-016 | Vitest | `pmo-portal/src/lib/progressBilling.test.ts` |
| AC-PB-017 | pgTAP | `supabase/tests/0250_progress_billing_assessment.test.sql` |
| AC-PB-018 | pgTAP | `supabase/tests/0250_progress_billing_evidence.test.sql` |
| AC-PB-019 | Vitest/RTL | `pmo-portal/pages/project-detail/__tests__/ProgressAssessmentModal.test.tsx` |
| AC-PB-020 | Vitest/RTL | `pmo-portal/pages/project-detail/__tests__/ClaimEvidenceModal.test.tsx` |

## 6. Out of scope

Retention (DD-PBL-11); claims without an ERP (#784); milestone billing (#785 — superseded by OD-BILL-1: billing is
by work order, §7); a Sales Order push; closing
assessment periods (as #765); history of overwritten assessments (only the latest per month is kept, with who and
when, as #765); detaching evidence; ERP-side quantity tracking; reflecting ERPNext Desk edits of a claim invoice
back into claim quantities; currency conversion; more than one live down payment per project (owner question 1).

## 7. Amendment 2026-10-07 — billing by work order (OD-BILL-1, #785 / #786)

> **Owner ruling OD-BILL-1 (2026-10-07):** clients are billed by their PO/SO — the work order — never by tracker
> milestones. Milestones stay progress-only (no amount, no invoice points at them). Per work order: invoiced / paid /
> remaining; "Invoice this work order" (Draft, pre-filled with the remaining amount; partial allowed; the server
> refuses invoicing beyond the work order's value); the work order shows Paid when its invoices are fully paid. A
> milestone may optionally reference a work order — display only. #786's "still to invoice" reads the same
> per-work-order remaining. This supersedes #785's milestone-amount design (showreel audit N2, AC-BMS-001..004) and
> #786's milestone-based AC-UNB-002.

### 7.1 Director rulings (DD-BWO-n, 2026-10-07; also recorded in `docs/decisions.md` and ADR-0080)

- **DD-BWO-1 — what counts against a work order.** Per invoice linked to the work order and not Cancelled: its billed
  work from `sales_invoice_work_billed` (DD-PBL-9: net of tax, plus the down-payment recovery its claim removed); a
  down-payment invoice counts zero (an advance, recovered through later claims — counting it too would bill the
  recovered part twice). Per live progress claim on the work order not yet raised as an invoice: its gross. A
  withdrawn claim, a cancelled invoice and a claim whose invoice is cancelled count nothing. **Invoiced to date** =
  linked Submitted/Unpaid/Paid; **not yet submitted** = linked Draft invoices + unraised claims; **still to invoice** =
  work-order value excl. tax − both. Credit notes are not linked to work orders and do not reduce them (owner
  question 1); to reduce a work order's invoiced figure, cancel the invoice.
- **DD-BWO-2 — paid.** "Paid" on a work order = the billed work of its linked invoices whose status is Paid (ERPNext
  outstanding 0; tax the client withheld counts as settled, DD-RCPT-1). A part-paid invoice counts as unpaid on the
  work order. A work order shows **Paid** when nothing is still to invoice, nothing is not yet submitted, and every
  submitted invoice on it (down-payment invoices included) is Paid. Derived on every read; never a stored status
  (DD-WO-3 stands).
- **DD-BWO-3 — basis and currency.** Every figure is excl. tax in the work order's own currency (pinned to the
  project's, DD-WO-9). The work order's value excl. tax uses 0197's rule (inclusive → value − tax amount). An invoice
  linked in another currency, or with no amount, makes the work order's figures "can't total": shown as such, and the
  refusal below fails closed.
- **DD-BWO-4 — the refusal, server-side, before any ERP write.** One helper decides; three places call it: a
  `BEFORE INSERT` trigger on `external_command_outbox` for sales-invoice create/edit/amend commands (the outbox insert
  precedes every ERP POST, ADR-0058); a `BEFORE INSERT/UPDATE` trigger on `sales_invoices` for every writer except the
  service-role mirror and a no-JWT server load (the native path, and any definer RPC acting for a user); and
  `create_progress_claim` (a claim reserves its gross when created; claims are immutable). It refuses (SQLSTATE
  `BW001`, HTTP 422 from the dispatch) a work order that is not Issued/Closed, on another project or organisation, an
  amount or currency it cannot check, and any amount that with everything already billed — including ERP commands
  still in flight — would pass the value. Equal is allowed. A reduction is always allowed.
- **DD-BWO-5 — concurrency.** Every billing write takes a transaction-scoped advisory lock keyed on the work order
  before reading, so two Finance users invoicing one work order serialise and the second sees the first (in-flight
  ERP commands count until mirrored). Not a row lock: `create_progress_claim` locks the project row and
  `transition_work_order` locks work order then project; a work-order row lock taken after the project row would
  invert that order. `create_progress_claim` takes the advisory lock before its project row lock.
- **DD-BWO-6 — who.** "Invoice this work order" uses the existing invoice-create authority (Admin, Finance — the
  dispatch's revenue write roles) and only where an invoice can be raised today (revenue on ERPNext; #784 will add the
  native path, which the database already guards). Separation of duties is unchanged: the author cannot submit.
- **DD-BWO-7 — Closed work orders can be invoiced** (a final invoice after the scope closes is normal; the same rule
  as claims, 0250, and the assistant, DD-AIN-4). Draft and Cancelled cannot.
- **DD-BWO-8 — an ordinary invoice create may name its work order.** The dispatch keeps `workOrderId` on create only
  (its org is checked by the existing link pre-flight; project, status and amount by the fence); edits and amends
  never move it (their work order is the mirror row's). The ERP draft's PO reference is the work order's client PO.
  Supersedes the 0250-era rule "an ordinary invoice never takes a caller-supplied work order".
- **DD-BWO-9 — the assistant** (amends DD-AIN-4): a work-order draft links the work order and defaults to what is
  still to invoice on it, before tax; a stated amount above that, nothing left, or an untotallable work order is
  refused before the approval chip.
- **DD-BWO-10 — where it shows.** Per work order and project totals on the project's Work orders tab, to the revenue
  read set (Admin, Executive, PM, Finance — `salesInvoice.view`); org-wide on the Executive and Finance dashboards
  (totals per currency, never converted; the 8 work orders with the most left; days since a Closed one closed, in the
  org's timezone; archived projects excluded). The Overview's contract-basis "Invoicing against contract"
  (AC-UNB-001/003) is unchanged. Not on the PM dashboard in v1.
- **DD-BWO-11 — invoices without a work order stay legal.** An invoice raised from Sales Invoices with no work order,
  or a claim with none, is project-level: it counts in the contract view, not against any PO.
- **DD-BWO-12 — the optional milestone → work order link is a follow-up.** Display only, no money effect; it touches
  the milestone strip and its seven test files, so it ships as its own small issue.

### 7.2 Owner questions (commercial facts only; each has the default the build uses)

1. **Does the client correct an invoice with a credit note, or always cancel and re-issue?** Default: cancel and
   re-issue (ERPNext amend). A credit note raised in ERPNext is not linked to a work order and does not reduce what the
   work order shows invoiced.
2. **Does the client's accounts-payable count a down-payment invoice against the PO's value?** Default: no — a down
   payment is an advance recovered through the progress invoices, and the PO counts the work billed. With the down
   payment fully recovered the two agree at the end.
3. **Is a PO ever invoiced past its value by agreement (an accepted overrun without a revised PO)?** Default: never —
   the client issues a new or replacement PO (Cancel + re-issue, DD-WO-5).

### 7.3 Job stories

- When I (Finance) receive the client's PO and the work is done, I want to invoice that PO in one step for what is
  left on it, so the invoice carries the client's PO number and the PO is never over-billed.
- When I (PM / Finance / Executive) look at a project or the portfolio, I want to see per PO what is invoiced, paid
  and still to invoice, so "is it invoiced yet?" has an answer without asking anyone.

### 7.4 Requirements (EARS)

- **FR-BWO-001** The system shall derive, for each work order, excl. tax in its currency: its value, invoiced to date,
  not yet submitted, paid and still to invoice, as defined by DD-BWO-1 and DD-BWO-2.
- **FR-BWO-002** While an invoice linked to a work order has no amount or is in another currency than the work order,
  the system shall report that work order's figures as not totalled instead of a figure.
- **FR-BWO-003** When an invoice that names a work order is created, or its amount, tax, status or work order changes,
  by any writer other than the ERP mirror writer or a no-JWT server load, the system shall refuse it if the work order
  is not Issued or Closed, belongs to another project or organisation, the amount or currency cannot be checked, or
  its billed work plus everything already billed or in flight against the work order would exceed the work order's
  value excl. tax.
- **FR-BWO-004** When an ERP sales-invoice create, edit or amend command with invoice lines is queued for an invoice
  that names (create) or is mirrored with (edit, amend) a work order, the system shall apply FR-BWO-003 to the
  command's line total before any ERP write, counting other commands still in flight against that work order.
- **FR-BWO-005** When a progress claim names a work order, the system shall apply FR-BWO-003 to the claim's gross when
  the claim is created.
- **FR-BWO-006** The system shall never refuse the ERP mirror writer for exceeding a work order; when an excess arrives
  from the ERP, the system shall show the work order as over-invoiced by the excess.
- **FR-BWO-007** The system shall serialise every write that bills a work order on that work order.
- **FR-BWO-008** When Admin or Finance chooses "Invoice this work order" on an Issued or Closed work order with
  something still to invoice, on a project with a client, in an organisation whose revenue is on ERPNext, the system
  shall create one ERPNext Draft sales invoice for the project's client with one line on a chosen ERP item, amount
  pre-filled with what is still to invoice (editable to any amount above zero, at most 2 decimals, not above what is
  left), linked to the work order, with the work order's client PO as the ERP PO reference.
- **FR-BWO-009** Where the assistant drafts an invoice for a work order, the system shall link the work order, default
  the amount to what is still to invoice, and refuse — before the approval chip — a stated amount above it, a work
  order with nothing left, and a work order whose figures cannot be totalled.
- **FR-BWO-010** While a work order has nothing still to invoice, nothing not yet submitted and every submitted invoice
  on it Paid, the system shall show it as Paid.
- **FR-BWO-011** The project's Work orders tab shall show the revenue read set, per work order, its billing status
  (Not invoiced, Partly invoiced, Fully invoiced, Paid, Over-invoiced, Can't total) with invoiced, paid and still to
  invoice, and for the project the totals over its Issued and Closed work orders, each figure labelled excl. PPN.
- **FR-BWO-012** The Executive and Finance dashboards shall show the revenue read set what is still to invoice across
  the organisation's Issued and Closed work orders on live projects: a total per currency with its count, the 8 work
  orders with the most left (number or title, project, amount, and days since closed for a Closed one, in the
  organisation's timezone), and how many could not be totalled.
- **FR-BWO-013** The system shall have every new string in English and Indonesian.

### 7.5 Observed (behaviour this amends)

- **OBS-BWO-001** Before this amendment the dispatch dropped a caller-named work order on every ordinary invoice
  (`dispatchFactory.ts` `resolveProgressClaimInvoice`); only claim invoices wrote `sales_invoices.work_order_id`
  (AC-PB-013). Superseded by FR-BWO-008 / DD-BWO-8.
- **OBS-BWO-002** The Overview's "Invoicing against contract" — contract value, invoiced to date and remaining to
  invoice, each with its basis, normalised to the contract's basis (`calculateProjectInvoiceSummary`) — is shipped
  (#786 AC-UNB-001 and AC-UNB-003) and unchanged.
- **OBS-BWO-003** The assistant drafted a work-order invoice at the work order's full pre-tax value without linking it
  (DD-AIN-4). Superseded by FR-BWO-009 / DD-BWO-9.

### 7.6 Non-functional

- **NFR-BWO-001 (money exactness)** SQL `numeric`; UI arithmetic in integer cents; equal to the value is allowed,
  one cent over is refused.
- **NFR-BWO-002 (security/tenancy)** Both views are `security_invoker` (RLS stays the boundary); the dashboard reader
  is SECURITY INVOKER with no `anon` EXECUTE; the refusal helper, the lock and line-total helpers and both trigger
  functions have no client EXECUTE; the migration asserts these grants on the database itself (hosted grant
  defaults, 0185/0210). The 0178 allow-list stays at 59; the isolation denominator is unchanged.
- **NFR-BWO-003 (performance)** The project read is one view query (≤ 500 work orders, refused above rather than
  truncated); the dashboard is one RPC returning one jsonb document aggregated server-side, so its totals are not
  bounded by PostgREST `max_rows`; the fence reads only the organisation's in-flight outbox rows.
- **NFR-BWO-004 (reversibility)** `supabase/migrations/rollback/0262_billing_by_work_order_down.sql`.
- **NFR-BWO-005 (honest states)** Loading shows skeletons; a failed or malformed read shows an error, never 0; figures
  that cannot be totalled read "Unavailable" / "Can't total".

### 7.7 Acceptance criteria (Given/When/Then)

- **AC-BWO-001** Given a work order worth 555,000 incl. 55,000 tax with an Unpaid invoice of 222,000 incl. 22,000 tax,
  a Paid invoice of 100,000 excl. tax, a Draft of 50,000, a Cancelled invoice of 80,000, an unraised progress claim of
  40,000, a withdrawn claim of 30,000, an Unpaid claim invoice of net 24,000 whose claim recovered 6,000, and an Unpaid
  down-payment invoice of 100,000, When Finance reads its billing, Then its value is 500,000, invoiced 330,000, not yet
  submitted 90,000, paid 100,000 and still to invoice 80,000, from 6 counted records of which 3 are submitted and
  unpaid; And a work order with no invoices reads nothing billed and its whole value still to invoice; And a work
  order with an invoice that has no amount reads "not totalled"; And another organisation's Finance reads none of it;
  And anon cannot read either view.
- **AC-BWO-002** Given an Issued work order worth 1,000 excl. tax in an organisation whose revenue PMO owns, When
  Finance records invoices of 600 then 401 against it, Then the 401 is refused (BW001) with a message naming 401.00,
  the work order, 1000.00, 600.00 and 400.00; And exactly 400 is accepted and one cent more is refused; And a Draft or
  a Cancelled work order is refused by name while a Closed one is accepted, and an invoice in another currency is
  refused; And an ERP create of 600 in flight makes a second ERP create of 401 and a native invoice of 401 both
  refused while one of 400 is accepted, and a failed command no longer counts; And an ERP command whose lines cannot be
  read, one naming another organisation's work order and one naming another project's work order are refused; And an
  ERP edit whose lines would pass the rest is refused while an edit with no lines passes; And the ERP mirror writer
  recording an invoice past the value is accepted and the work order then reads over-invoiced; And an update that
  raises an invoice past the value under a Finance JWT is refused, a reduction passes, and reviving a cancelled invoice
  past the value is refused; And a progress claim whose gross would pass the work order is refused while one within it
  is accepted, and that claim's own invoice command is left to the claim; And a billing write takes its work order's
  advisory lock; And the helper, lock, line-total and trigger functions are not executable by anon or authenticated.
- **AC-BWO-003** Given the ERP bench, an organisation with revenue on ERPNext and an Issued work order worth 300,000
  excl. tax with client PO P, When Finance invoices 200,000 against it, Then ERPNext holds one Draft with PO
  reference P and PMO shows 200,000 not yet submitted and 100,000 still to invoice; When Finance tries 150,000, Then
  it is refused (HTTP 422, BW001) with a message saying only 100,000.00 is still to invoice, and ERPNext still holds
  exactly one invoice with PO P; When a second user submits the first and Finance invoices exactly 100,000, Then PMO
  shows invoiced 200,000, not yet submitted 100,000 and nothing still to invoice.
- **AC-BWO-004** Given the project's Work orders tab, Then Finance, Admin, Executive and the PM see per work order its
  billing status with invoiced, paid and still to invoice "excl. PPN" (Paid when fully invoiced and paid;
  Over-invoiced with the excess; Can't total when an invoice cannot be added up), and an Engineer sees no billing;
  And Finance and Admin see "Invoice" only on an Issued or Closed work order with something left, on a project with a
  client, with revenue on ERPNext; And the dialog pre-fills what is left and the work order's label, requires an item,
  refuses 0, more than is left and more than 2 decimals, sends one line linked to the work order for the project's
  client, and keeps a server refusal on screen.
- **AC-BWO-005** Given the assistant is asked to invoice a work order worth 1,000,000 before tax with 400,000 already
  billed, Then the draft is 600,000 and names the work order; And a stated 700,000 is refused naming 600,000 left; And
  a work order with nothing left, or with an invoice that cannot be totalled, is refused before the chip; And the
  approved draft dispatches the work order with the create; And a replayed draft with a malformed work-order id is
  refused.
- **AC-BWO-006** Every new `projectDetail.workOrders.billing.*` and `dashboard.stillToInvoice.*` key exists, non-empty,
  in English and Indonesian, and every such key the new screens use is in the catalogue.
- **AC-UNB-001** *(shipped with #786, unchanged; restated for traceability)* Given a won project with invoices, When I
  open it, Then I see contract value, invoiced to date and remaining to invoice, each with its tax basis label.
- **AC-UNB-002** *(replaces the milestone-based AC-UNB-002, OD-BILL-1)* Given a project with Issued and Closed work
  orders, When I open its Work orders tab, Then I see invoiced, paid and still to invoice across them, each "excl.
  PPN", where still to invoice adds each work order's amount left (an over-invoiced one adds nothing, a Draft or
  Cancelled one is not counted); And if any of them cannot be totalled the totals read "Unavailable".
- **AC-UNB-004** Given Issued, Closed, Draft and Cancelled work orders, one on an archived project, one fully
  invoiced, one that cannot be totalled and one Closed three days ago in an organisation on Asia/Jakarta time, When
  Finance reads what is still to invoice, Then the total per currency counts only Issued and Closed work orders on
  live projects with something left, the untotallable one is counted apart, the rows are ordered by amount left and
  capped at the limit, the Closed one reads 3 days since closed; And another organisation reads only its own; And
  anon cannot execute it and it is not SECURITY DEFINER.
- **AC-UNB-005** Given the Executive or Finance dashboard, Then the card shows each currency's total "excl. PPN" with
  its count, the work orders with the most left linking to their project's Work orders tab with days since closed for
  a Closed one, the untotalled count, an empty state, a loading state and an error state with Retry; And a role
  outside the revenue read set sees no card.

### 7.8 AC owning layer (ADR-0010)

| AC | Owning layer | Canonical proof |
|---|---|---|
| AC-BWO-001 | pgTAP | `supabase/tests/0262_work_order_billing_figures.test.sql` |
| AC-BWO-002 | pgTAP | `supabase/tests/0262_work_order_billing_refusal.test.sql` (+ Deno `dispatchErrorStatus.test.ts` for the 422) |
| AC-BWO-003 | Playwright (served lane + ERP bench) | `pmo-portal/e2e/serial/AC-BWO-003-invoice-work-order-erp.spec.ts` (+ Vitest `progressClaimInvoice.test.ts`, `salesInvoiceCommand.test.ts`, `useRevenue.workOrderBilling.test.tsx`) |
| AC-BWO-004 | Vitest/RTL | `pmo-portal/pages/project-detail/__tests__/WorkOrdersTab.billing.test.tsx` (+ `InvoiceWorkOrderModal.test.tsx`, `src/lib/workOrderBilling.test.ts`, `src/lib/db/workOrderBilling.test.ts`, `src/hooks/useWorkOrderBilling.test.tsx`) |
| AC-BWO-005 | Vitest | `pmo-portal/src/lib/agent/draftInvoice.prepare.test.ts` (+ `draftInvoice.run.test.ts`) |
| AC-BWO-006 | Vitest | `pmo-portal/src/lib/workOrderBilling.i18n.test.ts` |
| AC-UNB-001 | Vitest/RTL | `pmo-portal/pages/project-detail/__tests__/OverviewTab.test.tsx` (shipped) |
| AC-UNB-002 | Vitest/RTL | `pmo-portal/pages/project-detail/__tests__/WorkOrdersTab.billing.test.tsx` |
| AC-UNB-004 | pgTAP | `supabase/tests/0262_unbilled_work_orders.test.sql` |
| AC-UNB-005 | Vitest/RTL | `pmo-portal/src/components/dashboard/__tests__/StillToInvoiceCard.test.tsx` |

### 7.9 Out of scope

The milestone → work order display link (DD-BWO-12, follow-up); native invoicing without an ERP (#784 — the database
rule already covers it); credit notes against work orders (owner question 1); currency conversion; per-line work-order
allocation of one invoice across several work orders (one invoice bills one work order); a PM dashboard card;
reflecting an ERPNext Desk edit back as a refusal (it is shown as over-invoiced, never refused).

## 8. Amendment 2026-10-21 — contract quantities, work-order allocation and BAST

Decided owner brief, not a new interview. All amounts below are invented examples, excl. tax in the
project currency. A project remains the contract; down payment remains per project. BAST means the
client's acceptance, not an invoice, receipt or replacement document register.

### 8.1 Owner rulings (OD-CQ-1..4, 2026-10-21)

- **OD-CQ-1 — earning basis per line.** Unit-rate lines (km, stations, units, man-days): earned =
  quantity done × rate. Lump-sum lines: 1 lot; earned = % complete × line amount, assessed by the PM;
  reaches 100% at the client's acceptance (BAST). Basis defaults from the unit (`lot`, `LS`, `lump sum`,
  case-insensitive → lump sum; anything else → unit rate), editable per line. Project WIP (work done,
  not yet billed) = Σ line earned − billed to date (DD-PBL-9, DP excluded). Replaces latest % × net
  contract wherever a project has lines; projects with no lines keep the percent method. A service
  list with no rates: one lump-sum line (default).
- **OD-CQ-2 — work orders order contract quantities; BAST closes them.** A WO carries quantities
  against contract lines, full or partial (the normal case). Show the contract balance not yet
  ordered; over/under ordering is shown, not blocked. First-class BAST on the WO: date, quantity per
  line, link to the signed BAST in the project document register, final flag. PM or Finance prepares;
  Finance/Admin confirms; preparer ≠ confirmer, except exactly the budget-activation sole-operator
  exception (OD-BUDGET-6 amendment, 0298). Several stage/monthly BASTs per WO; confirmed final closes
  it (Issued → Closed).
- **OD-CQ-3 — closing value, never an edited order value.** DD-WO-5 stands: issued order value is the
  frozen client PO. Final confirmation stamps separate closing value = Σ round(final qty × rate, 2),
  excl. tax. Billing caps, still-to-invoice, drawdown and WIP use the closing outcome once set.
  Unused quantity returns to the contract balance (ordered 1,000, final 997 → 903 of 1,900 available).
  DP still unrecovered on closing is flagged and must be recovered (claim “recover the rest”) or
  refunded explicitly, never silently lost.
- **OD-CQ-4 — load path.** Operator loads contract lines with `pmo load` from the budget workbook
  price sheet (description, unit rate, estimated quantity, unit), or SPK when no workbook exists.
  Same guarded surface and `--dry-run` as draft budgets; no in-app import now (#1278).

### 8.2 Director rulings (DD-CQ-1..8, 2026-10-21)

- **DD-CQ-1 — line basis.** Add `boq_items.earning_basis text not null default 'unit_rate'`, checked
  to `unit_rate|lump_sum`; lump sum requires quantity exactly 1 (23514). Its assessment and BAST
  quantities are fractions 0–1. UI enters/displays percent, at most one decimal of percent (stored
  three decimals). Add nullable `line_no integer` and `import_key text`, unique `(project_id, import_key)`.
  FE defaults basis from the unit per OD-CQ-1.
- **DD-CQ-2 — allocations replace the single link.** `work_order_lines(id, org_id, work_order_id,
  boq_item_id, quantity numeric(14,3) > 0, created_at, unique(work_order_id, boq_item_id))` has a
  same-project trigger (23514). Copy every existing non-null BoQ work-order link into an allocation
  at full line quantity; then drop `boq_items.work_order_id` (one source). Down migration re-adds it
  and backfills only lines with exactly one allocation. FORCE RLS, active membership and org stamp;
  direct table writers Admin/Executive/PM/Finance, only Draft/Issued WOs. Closed/Cancelled allocations
  frozen (42501). With confirmed BAST quantities, forbid deletion or reduction below the latest
  confirmed BAST quantity (23514). Total allocation above/below contract quantity is shown, not blocked.
- **DD-CQ-3 — BAST records and RPCs.** Header `work_order_acceptances(id, org_id, project_id,
  work_order_id, acceptance_date date, is_final boolean, document_id uuid null → project_documents,
  status text Draft|Confirmed|Withdrawn, prepared_by, prepared_at, confirmed_by, confirmed_at,
  confirm_basis text null standard|sole_operator, withdrawn_at, note text ≤ 500)`; children
  `work_order_acceptance_lines(acceptance_id, boq_item_id, quantity numeric(14,3) ≥ 0,
  primary key(acceptance_id, boq_item_id))`. Quantities are cumulative accepted-to-date for that WO,
  not incremental. Clients SELECT only through org/member RLS; writes only via these definers:
  - `prepare_work_order_acceptance(p_work_order_id uuid, p_acceptance_date date, p_is_final boolean,
    p_lines jsonb, p_document_id uuid default null, p_note text default null,
    p_acceptance_id uuid default null) returns uuid`. Create or replace a Draft's fields and lines;
    permission = `may_record_project_progress` (project PM or Finance rank+); WO Issued. Every line
    allocated to WO, no repeats, finite quantity ≥0 and ≤3 dp, lump sum ≤1. Final includes every
    allocated line (zero allowed). Optional document must be on same project; status checked at confirm.
    Audit creation/replacement.
  - `withdraw_work_order_acceptance(p_id uuid) returns void`. Draft only, preparer or Admin/Finance;
    audit withdrawal.
  - `confirm_work_order_acceptance(p_id uuid) returns jsonb`. Admin/Finance only; caller ≠ preparer
    unless 0298's sole-active-member predicate, recording `confirm_basis`. Issued WO; same-project
    Issued/Approved document with a file, as claim evidence. At most one Confirmed final per WO.
    Confirmed headers and children immutable by trigger. Final takes `lock_work_order_billing(wo)`
    before WO row lock, computes Σ round(qty × rate, 2), refuses BW001 if above original order net or
    below already billed + pending on WO (DD-BWO-1 lines), with figures in message. Stamp closing value,
    closing acceptance, Closed and closed_at atomically. Return `{closing_value, dp_held}` (project DP
    invoiced − recovered), audit. A confirmed BAST's document remains ordinary attachable claim evidence;
    no new evidence path.
- **DD-CQ-4 — server-only closing money.** Add `work_orders.closing_value numeric(14,2) null` and
  `closing_acceptance_id uuid null`. No client UPDATE grant (nor client INSERT of these stamps).
  Confirm alone sets them using a narrowly scoped transaction flag (0252 pattern); once set, a
  trigger refuses change even by other definer callers. `effective_net = coalesce(closing_value,
  case when tax_treatment='inclusive' then order_value-tax_amount else order_value end)`.
  Use it in `work_order_billing`, `assert_work_order_invoiceable`, `get_project_drawdown` and
  `transition_work_order` issue-gate committed sum. ADR-0090 records this new money field.
- **DD-CQ-5 — earned quantity in SQL.** With A = latest assessed quantity (0 if absent),
  `closed_alloc` = allocations on Closed WOs with confirmed final BAST, `closed_final` = final
  accepted quantities on those WOs, `open_cap = greatest(line.quantity-closed_final,0)`,
  `earned_quantity = closed_final + least(greatest(A-closed_alloc,0),open_cap)`.
  Earned line value = round(earned_quantity × rate, 2); project earned = Σ. Closed WOs count at final
  acceptance; assessment counts only beyond what those WOs ordered. Apply the same formula to
  lump-sum fractions; stage BASTs affect evidence/pre-fill, not earned value. `get_project_billing`
  adds `earned_value`; each BoQ row adds `earning_basis`, `line_no`, `ordered_quantity` (Issued+Closed
  allocations), `accepted_quantity` (latest confirmed BAST per WO), `closed_final`, `earned_quantity`,
  `contract_balance = line.quantity - Issued allocations - closed_final`, and `allocations[]` with
  `{work_order_id, boq_item_id, quantity, claimed_quantity, accepted_quantity, final}`. Claimed is live
  claims on that WO; accepted is latest confirmed BAST on it. FE `summarizeBilling` uses earned value
  for projects with lines, otherwise existing `pctOf`; WIP = earned − `work_billed`. Management-pack
  `pct_complete` stays unchanged; follow-up derives its recognised figure from earned value.
- **DD-CQ-6 — claims by allocation.** With a WO, `create_progress_claim` accepts only allocated lines;
  without WO, only lines with no allocation at all (including Draft/Cancelled allocations).
  Other rules unchanged: evidence, immutability, recovery, SoD and effective-net cap. WO pre-fill =
  latest confirmed BAST qty − live claimed qty on that WO; without BAST, min(assessed − claimed on
  all live claims, allocated − claimed on this WO); omit non-positive values. Without WO retain
  assessed-minus-live-claimed on eligible lines. Pre-fill is editable, not a quantity cap.
- **DD-CQ-7 — CLI contract lines.** Per project `contract_lines: [{key, line_no?, item_code,
  description, unit, quantity, rate, basis?}]`. ERP service `item_code` required. Default basis from
  unit. POST `boq_items`, mapping key → import_key; skip existing `(project, import_key)` (23505),
  never update; corrections in app. Dry run lists all validation/reference problems (including missing
  project, bad quantity/rate, lump-sum quantity ≠1 and duplicate key) and, for valid input, the plan.
  Add `boq_items` to CLI `LOAD_TABLES` and guard `admin_write_tables` together (guard replacement
  inside 0337, not a second migration). Update CLI spec §2 and runbook §4. No allocation/BAST load.
- **DD-CQ-8 — who.** Lines/basis and allocations: Admin, Executive, PM, Finance. BAST prepare:
  project's PM or Finance rank+ (`may_record_project_progress`, so Executive/Admin eligible too).
  Confirm: Admin/Finance with DD-CQ-3 SoD. Claims unchanged.
- **DD-CQ-9 — closing a work order that has contract lines.** *(Director 2026-10-21, plan open point 1)*
  `transition_work_order` refuses Issued → Closed (42501, message: "close it by confirming its final BAST")
  for a work order that has allocations; only a confirmed final BAST closes it. A work order with no
  allocations keeps the manual close. Already-Closed work orders are not migrated: none has
  allocations today, their allocations would be frozen anyway, and with no closing value they read
  at their order net. The UI hides Close on a work order with allocations and points to the BAST.
  Proof extends AC-CQ-006 (pgTAP) and AC-CQ-015 (RTL). The management-pack follow-up is #1279.

### 8.3 Job stories

- When I (operator) onboard a generic contract, I want to load its priced quantities once from its
  workbook/SPK and inspect a dry run, so re-running does not duplicate or overwrite corrected lines.
- When I (PM) receive an order for part of a 1,900 km contract, I want to allocate 1,000 km and see
  what remains unordered, so later orders reuse the same priced line rather than duplicating it.
- When the client accepts 997 km finally, I want to record the signed BAST and have Finance confirm
  it, so the order closes honestly, 903 km becomes available and billing uses the accepted value.
- When I (Finance) bill accepted work, I want in-scope quantities pre-filled and DP still held called
  out, so the final invoice fits the closing ceiling without hiding unrecovered advances.
- When I (Executive/PM/Finance) review mixed unit-rate and lump-sum work, I want earned work less
  billed work, not a percent multiplied by an unrelated contract total.

### 8.4 Functional requirements (EARS)

- **FR-CQ-001** The system shall store each contract line's basis, optional line number and import
  key per DD-CQ-1, require 1 lot for lump sum, and default basis from unit in FE and CLI.
- **FR-CQ-002** When a permitted writer allocates a contract line to a Draft or Issued WO, the system
  shall stamp org, require same project and a positive finite ≤3-dp quantity, and keep one row per
  WO/line; it shall display over/under ordering without a contract-quantity ceiling refusal.
- **FR-CQ-003** While a WO is Closed/Cancelled, the system shall refuse allocation writes (42501);
  while a confirmed acceptance exists, it shall refuse deleting its allocation or reducing below the
  latest confirmed accepted quantity (23514).
- **FR-CQ-004** When a permitted preparer records/replaces a Draft BAST, the system shall validate
  cumulative allocated quantities and final-line completeness per DD-CQ-3, stamp preparer/time and audit.
- **FR-CQ-005** When the preparer or Admin/Finance withdraws a Draft BAST, the system shall stamp it
  Withdrawn and audit, without changing allocations, invoices, earned value or WO status.
- **FR-CQ-006** When Admin/Finance confirms a BAST, the system shall enforce SoD, current sole-operator
  eligibility, document evidence and Issued-WO status, stamp confirmer/time/basis and audit; confirmed
  headers and quantities shall be immutable.
- **FR-CQ-007** When the confirmed BAST is final, the system shall atomically stamp closing money and
  close the WO per DD-CQ-3/4, serialising against billing, and refuse BW001 with figures above order
  net or below already billed plus pending; at most one final shall be confirmed.
- **FR-CQ-008** Where closing value exists, the system shall use effective net in every operational
  order-net reader (billing, refusal, drawdown and issue gate), leaving original PO and tax facts frozen.
- **FR-CQ-009** The system shall return earned value, ordered, accepted, earned and contract-balance
  quantities and per-WO allocation/claim/acceptance facts in `get_project_billing` per DD-CQ-5.
- **FR-CQ-010** Where contract lines exist, the Billing tab shall show assessed-to-date as earned
  value and WIP as earned minus DD-PBL-9 billed work; where no lines exist, it shall retain `pctOf`
  and the no-assessment null state.
- **FR-CQ-011** When Finance creates a progress claim, the database shall apply allocation scope and
  the FE shall offer/pre-fill only eligible lines per DD-CQ-6, retaining editable quantities and all
  existing money/evidence/SoD rules.
- **FR-CQ-012** When final confirmation returns positive `dp_held`, the UI shall persistently state
  the DP is still held and direct Finance to recover the rest on the next claim or explicitly refund;
  it shall never mark recovery/refund done or erase the balance merely because a WO closed.
- **FR-CQ-013** When `pmo load` sees contract_lines, it shall validate all rows before writes, resolve
  project/keys with read-only lookups, POST new rows and skip existing keys per DD-CQ-7; dry run shall
  write nothing. An unresolvable project is a preflight problem, not an invented parent.
- **FR-CQ-014** The system shall expose the CLI addition only through the active-Admin load tier,
  keeping ordinary CLI verbs and all allocation/BAST endpoints outside that tier.
- **FR-CQ-015** The UI shall remove the line-level WO picker, offer allocations and BAST actions on
  each WO, display order and closing values distinctly, show lump-sum progress as percent, and flag
  over-measure/over-order in words, not colour alone.

### 8.5 Observed contracts (read at this branch's base, not claims about deployment)

- **OBS-CQ-001** 0250 defines one nullable `boq_items.work_order_id`; 0262's `create_progress_claim`
  still scopes by it. DD-CQ-2/6 replaces both, never the claim/invoice's own work-order link.
- **OBS-CQ-002** 0252's assessment RPC sets then immediately clears its derived-percent flag; preserve
  that mechanism when adding lump-sum validation. `pct_complete` and management-pack readers stay.
- **OBS-CQ-003** 0197 normalises drawdown and issue committed totals to order net; 0227's
  `set_work_order_value` permits Draft only. Closing is a separate server-only field, not a new setter.
- **OBS-CQ-004** 0262 already has advisory billing locks and pending/in-flight reservation logic;
  preserve the invoice mirror exemption and the existing refusal path. BAST never writes the ERP.
- **OBS-CQ-005** 0298 counts all active org profiles, not only Finance/Admin, for the sole-operator
  exception. The exception does not grant a role that the caller otherwise lacks.
- **OBS-CQ-006** `scripts/lib/pmo-load.mjs` separates validate → resolve → apply and stops at the
  first server refusal; `0239` and CLI load allow-lists are paired. Extend, do not add an importer.

### 8.6 Non-functional requirements

- **NFR-CQ-001 (security/tenancy)** New business tables shall FORCE RLS with own-org active-member
  reads; allocation writes shall have both role/project validation and state triggers. Acceptance
  children shall derive org membership through the header (their decided shape has no org_id).
  BAST tables shall have no client DML grants; RPCs shall reassert active membership, org and role,
  with fixed search_path and no anon EXECUTE. Internal helpers/triggers shall have no client EXECUTE.
  Update `supabase/tests/0178_anon_executable_definers.test.sql` with exactly the three BAST RPCs:
  literal baseline 70 names +3 =73; re-count after rebase, keep hardcoded count and mutation oracle.
- **NFR-CQ-002 (reversibility)** Supply `supabase/migrations/0337_contract_quantities.sql` and
  `supabase/migrations/rollback/0337_contract_quantities_down.sql`. Restore replaced functions,
  views, grants, guard and old column before dropping new objects. Backfill old link only for exactly
  one allocation; multi-allocation lines cannot be represented in the old schema and require an
  operator-reviewed export before rollback. Never infer an arbitrary WO or alter posted invoices.
- **NFR-CQ-003 (exactness)** SQL numeric, finite validation before typmod rounding; quantities ≤3 dp,
  rate/closing money ≤2 dp; round each line then sum (Postgres half-away-from-zero). FE subtracts
  cents and milli-quantities exactly, with decimal-safe percent/fraction conversion. No mixed-currency
  sum; closing value already excludes tax and must not be normalised a second time.
- **NFR-CQ-004 (i18n/a11y)** Every new UI string shall exist in English and Indonesian. DESIGN.md
  primitives, labelled controls, keyboard/focus/inline-error behavior, exact table money and phone
  reflow apply; no new visual language or colour-only warnings.
- **NFR-CQ-005 (honest states)** Pending, empty, absent assessment, unavailable and failed reads shall
  stay distinct. Malformed earned/allocation/acceptance payloads are errors, not zeros. Closing/DP
  success appears only after authoritative response; a refused confirm retains the Draft and inputs.
- **NFR-CQ-006 (performance)** Aggregate allocations, latest confirmed BAST per WO and live claims
  before joining (avoid multiplication/N+1); index WO/line, org/project, acceptance/status and document
  FKs. Keep one summary RPC and bounded/paged lists that refuse saturation rather than truncate silently.

### 8.7 Acceptance criteria (Given/When/Then)

- **AC-CQ-001** Given contract lines, When basis is saved, Then unit-rate is allowed and a lump-sum
  line requires quantity 1; invalid basis, NaN/Infinity and zero contract quantity fail 23514; line_no
  can be null, and duplicate non-null project/import_key fails 23505 while other projects may reuse it.
- **AC-CQ-002** Given a 1,900 km line and Draft/Issued WOs, When PM allocates 1,000 and 950 km,
  Then both save (over-order is permitted), same WO/line duplicates fail, same-project/org is required,
  Engineer writes fail, disabled/other-org reads return none and anon has no access; When the WO
  closes/cancels, Then its allocations are frozen; Given latest confirmed quantity 997, Then deleting
  the allocation or reducing it to 996 fails 23514 and 997 is allowed while Issued.
- **AC-CQ-003** Given a pre-0337 BoQ line linked to one WO, When 0337 applies, Then one allocation
  contains its full quantity and the old column is absent; When down runs, Then the old column and
  same link return, a line with two allocations gets no arbitrary old link, and replaced SQL/ACL
  contracts return without changing any invoice.
- **AC-CQ-004** Given an Issued WO with allocations, When its PM (or Finance rank+) prepares and
  re-records a Draft, Then cumulative lines replace rather than add, actor/time are recorded and
  both actions audited; a repeated/unallocated line, negative/4-dp quantity, lump-sum >1, final
  omitting an allocated line, another project's document or another PM fails; When preparer or
  Admin/Finance withdraws, Then Draft becomes Withdrawn and a second withdrawal/confirmation fails.
- **AC-CQ-005** Given two active org members and a Draft BAST prepared by Finance, When its preparer
  confirms, Then 42501 and no close; When a distinct Admin/Finance confirms with an Issued/Approved
  same-project document carrying a file, Then confirm_basis=standard; Given only that Finance/Admin
  is active, When they prepare and confirm, Then confirm_basis=sole_operator; a second active Engineer
  removes the exception. PM cannot confirm; disabled/other-org/anon cannot invoke; absent, Draft,
  fileless or foreign evidence fails. Confirmed header/line mutation and a second final are refused.
- **AC-CQ-006** Given a generic 1,900 km line at 50,000, a WO allocating 1,000 km with order net
  50,000,000, and a final BAST for 997 km, When a permitted distinct confirmer confirms, Then closing
  value=49,850,000, status=Closed, closed_at and closing_acceptance_id are stamped, order value/tax
  facts unchanged and audit recorded; clients/other definer paths cannot set or change closing stamps.
- **AC-CQ-007** Given that WO, When final quantity 1,001 implies 50,050,000, Then confirm fails BW001
  naming closing and order net 50,000,000; Given 49,900,000 billed+pending, When final 997 is confirmed,
  Then BW001 names 49,850,000 and 49,900,000 and nothing closes; equality is allowed. Billing and
  confirmation share the advisory lock before mutable reads; unreadable billing fails closed.
- **AC-CQ-008** Given closing value 49,850,000 and billed 40,000,000 with pending 5,000,000, When
  billing/drawdown/issue-gate readers run, Then effective net=49,850,000, remaining=4,850,000 and
  committed=49,850,000 (not original 50,000,000); a new invoice exactly 4,850,000 passes, one cent
  more fails BW001 through existing native/outbox/claim fences; an unclosed inclusive order still
  subtracts tax once. The dashboard consuming the billing view sees the same reduced remainder.
- **AC-CQ-009** Given the 1,900/1,000/997 example and latest assessment 1,000, When billing is read
  after final close, Then earned qty=997, value=49,850,000 and contract balance=903; When assessed
  quantity becomes 1,050, Then earned qty=1,047 and value=52,350,000; assessment 2,000 earns only
  1,900 (95,000,000). Ordered remains 1,000; accepted=997. Stage BASTs do not change earned.
- **AC-CQ-010** Given a 1-lot lump-sum line at 50,000 and assessment 0.4, When billing is read,
  Then earned qty=0.4 and earned value=20,000; a stage BAST does not make the whole lot earned,
  and final 1 makes it 50,000. Multiple WOs' latest cumulative acceptances are selected once per WO,
  never summed across monthly BAST history; cancelled WOs do not consume ordered contract balance.
- **AC-CQ-011** Given one line allocated to two WOs and one unallocated line, When Finance claims
  on the first WO, Then only its allocated lines qualify; When claiming with no WO, Then only the
  entirely unallocated line qualifies (a Draft/Cancelled allocation also excludes a line); evidence,
  recovery, copied rates, claim immutability and existing billing cap remain enforced.
- **AC-CQ-012** Given projects with/without lines, When summarizeBilling runs, Then the line project
  uses server earned_value even if percent × contract differs (49,850,000 − 40,000,000 =9,850,000
  WIP), the no-line project uses pctOf and stays null without assessment; malformed earned data
  is unavailable, not zero. DP-held and money differences stay exact in cents and may be negative.
- **AC-CQ-013** Given WO allocation 1,000, global assessment 1,050, claimed 100 on this WO and 50
  on another, When pre-fill runs without BAST, Then min(1,050−150,1,000−100)=900; Given latest BAST
  997 on this WO, Then 897 is pre-filled regardless of other WO claims; non-positive lines omitted.
  No-WO scope offers only unallocated lines; edits are still possible after pre-fill.
- **AC-CQ-014** Given BoQ/assessment/claim dialogs, When unit is `LS`, `lot` or `Lump Sum`, Then new
  basis defaults lump sum (override allowed), quantity is fixed at 1 and hidden; When 40.0% is
  assessed/accepted, Then 0.400 is sent, 40.01% is rejected and 100% sends 1.000. There is no BoQ
  WO picker; allocation editor shows contract balance and allows textual over-order warnings.
- **AC-CQ-015** Given WO allocation/BAST lists and current JWT role, When preparing/confirming/
  withdrawing, Then affordances match DD-CQ-8 and SoD (UI may withhold same-preparer confirm), final
  success shows order/closing values separately and positive dp_held persistently says to recover
  the rest on the next claim or explicitly refund; a refused save stays open with inputs and server
  figures. Billing table shows contract, ordered, balance, accepted, earned and claimed, with percent
  for lump sum, text warnings, loading/empty/error states and no fabricated zero.
- **AC-CQ-016** Given a load file with missing item_code, duplicate key, bad quantity/rate and a
  lump-sum quantity 2, When validation runs, Then every row problem is returned before requests;
  Given missing/unresolvable project, Then preflight fails before writes. A valid dry run plans
  each contract line using resolved project id (or a planned new project's reference), makes GETs
  only and defaults basis case-insensitively from unit; explicit basis wins.
- **AC-CQ-017** Given valid contract lines, When apply runs, Then POSTs omit org_id, map key to
  import_key and basis to earning_basis and include required ERP item; re-run skips existing keys,
  concurrent 23505 skips without PATCH, another failure stops/report partial completion; no allocation
  or BAST is loaded and corrections are directed to the app.
- **AC-CQ-018** Given OAuth-client requests, When active Admin uses GET/POST boq_items, Then guard
  admits them subject to RLS; PATCH/DELETE/upsert, non-Admin/disabled users and allocation/BAST calls
  are refused, while browser behavior is unchanged. CLI LOAD_TABLES equals latest guard list;
  generic get/create/update still refuses the load-only table.
- **AC-CQ-019** Given all new UI keys, When both catalogues are checked, Then English and Indonesian
  values exist and are non-empty, including basis, quantities, BAST states, refusals and DP notice.
- **AC-CQ-020** Given an Issued WO on a generic contract and signed document in its register, When
  PM allocates 1,000, prepares final 997, and a distinct Finance confirms, Then the rendered WO is
  Closed at 49,850,000, the Billing tab shows balance 903 and earned 49,850,000, and still-to-invoice
  uses closing value after navigation/reload. This is the only new curated cross-stack journey.

### 8.8 AC owning layer (ADR-0010)

| AC | Owning layer | Canonical proof |
|---|---|---|
| AC-CQ-001 | pgTAP | `supabase/tests/0337_contract_lines.test.sql` |
| AC-CQ-002 | pgTAP | `supabase/tests/0337_work_order_lines.test.sql` |
| AC-CQ-003 | pgTAP upgrade/reversal harness | `scripts/contract-quantities-rollback.test.sql` |
| AC-CQ-004 | pgTAP | `supabase/tests/0337_work_order_acceptances.test.sql` |
| AC-CQ-005 | pgTAP | `supabase/tests/0337_work_order_acceptances.test.sql` |
| AC-CQ-006 | pgTAP | `supabase/tests/0337_work_order_closing_value.test.sql` |
| AC-CQ-007 | pgTAP | `supabase/tests/0337_work_order_closing_value.test.sql` |
| AC-CQ-008 | pgTAP | `supabase/tests/0337_work_order_effective_net.test.sql` |
| AC-CQ-009 | pgTAP | `supabase/tests/0337_contract_earned_value.test.sql` |
| AC-CQ-010 | pgTAP | `supabase/tests/0337_contract_earned_value.test.sql` |
| AC-CQ-011 | pgTAP | `supabase/tests/0337_progress_claim_allocations.test.sql` |
| AC-CQ-012 | Vitest | `pmo-portal/src/lib/progressBilling.test.ts` |
| AC-CQ-013 | Vitest | `pmo-portal/src/lib/progressBilling.test.ts` |
| AC-CQ-014 | Vitest/RTL | `pmo-portal/pages/project-detail/__tests__/ContractQuantityDialogs.test.tsx` |
| AC-CQ-015 | Vitest/RTL | `pmo-portal/pages/project-detail/__tests__/ContractQuantitiesTabs.test.tsx` |
| AC-CQ-016 | Node | `scripts/pmo-load.test.mjs` |
| AC-CQ-017 | Node | `scripts/pmo-load.test.mjs` |
| AC-CQ-018 | pgTAP | `supabase/tests/0337_contract_lines_api_guard.test.sql` (Node list/verb regressions support it) |
| AC-CQ-019 | Vitest | `pmo-portal/src/lib/progressBilling.i18n.test.ts` |
| AC-CQ-020 | Playwright | `pmo-portal/e2e/AC-CQ-020-contract-quantities.spec.ts` |

### 8.9 Out of scope

In-app import (#1278); loading allocations/BASTs; management-pack recognition change (#765 follow-up);
retention; a new ERP command, automatic invoice or automatic DP refund; editing original issued order
money; automatically marking an acceptance Confirmed or evidence attached; BAST-period accounting;
ERP-side quantity tracking; currency conversion; changing claim submit SoD or per-project DP scope.
See the plan's Open points for shipped-code integration questions, not reopened owner rulings.
