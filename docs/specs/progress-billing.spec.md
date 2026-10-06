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
- **DD-PBL-6 — tax basis.** *(was 4; unchanged)* BoQ rates and the DP amount exclude tax; ERPNext applies tax as
  for any invoice. The recovery line lowers each claim's taxable base by the DP already taxed.
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
  precision).
- **DD-PBL-11 — retention is out of scope.** *(was 9; unchanged)* Indonesian PPN is charged on the full progress
  value, so a negative retention line would wrongly cut the tax base; retention needs its own decision.

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

Retention (DD-PBL-11); claims without an ERP (#784); milestone billing (#785); a Sales Order push; closing
assessment periods (as #765); history of overwritten assessments (only the latest per month is kept, with who and
when, as #765); detaching evidence; ERP-side quantity tracking; reflecting ERPNext Desk edits of a claim invoice
back into claim quantities; currency conversion; more than one live down payment per project (owner question 1).
