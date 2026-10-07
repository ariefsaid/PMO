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
  project.
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
