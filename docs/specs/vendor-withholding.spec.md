# Spec amendment — vendor withholding (PPh 23 / PPh 4(2)) on ERPNext-owned procurement (#876)

> **Amends** `docs/specs/erpnext-adapter.spec.md` §5.10 FR-ENA-115 (Purchase Invoice mirror) and FR-ENA-116 (the PI
> paid-detection it specified), and supersedes DD-VI-3a in part (`docs/plans/2026-10-06-purchase-tax-template.md`
> AC-520-11). Owner frame: OD-ERP-3 (ERPNext is headless for RIS — what an ERPNext screen would show is a PMO gap) and
> OD-ERP-4 (vendor withholding is a go-live item; tax registers #898 follow at the first month-end).
> Architecture: ADR-0082. Plan: `docs/plans/2026-10-07-vendor-withholding.md`. Migration slot: **0266**.
>
> **Slice 2 (§7)** — vendor tax set up in PMO with editable amounts (owner OD-VWH-1; Director DD-VWH-10..14).
> Architecture: ADR-0084. Plan: `docs/plans/2026-10-07-vendor-withholding-slice2.md`. Migration slot: **0269**.
> Slice 2 amends §1 (standalone withholding is now in scope), FR-VWH-008, AC-VWH-009 and AC-VWH-010 in place (marked).

## 0. Job story

When RIS records a vendor bill on which it must withhold PPh (e.g. 2% PPh 23 on services), I want to pick the
template that withholds it and see, on the bill, the VAT, the tax withheld and what I actually owe the vendor, so that
I pay the vendor the net, the bill closes as paid, and the withheld tax is ready for the monthly tax return — without
anyone opening ERPNext.

## 1. Scope

**In:** ERPNext-owned (flipped) procurement only — the vendor-invoice create that dispatches to ERPNext with a chosen
Purchase Taxes and Charges Template (#520), the Purchase Invoice mirror, the inbound feed refresh of a mirrored bill,
the procurement ledger display, and the sales-side symmetry guard.

**Out (explicit):**
- ~~Withholding on PMO-native (standalone) vendor invoices — they record zero; capture is not offered.~~
  **Superseded by slice 2 (§7, DD-VWH-10):** a standalone bill may record tax withheld.
- The bukti potong (e-Bupot) number for vendor withholding — the tax registers (#898) own it.
- The per-type split (PPh 23 vs PPh 4(2)) on the bill — #898 reads it from the GL mirror per tax-payable account.
- Paying a vendor from the PMO ledger on a flipped org (OBS-VWH-002) — not wired today; separate issue.
- A pre-submit preview of the net payable (ERPNext computes it; PMO shows it once mirrored, ADR-0048).

## 2. Decisions (Director, 2026-10-07 — DD lines, revisable by the owner)

- **DD-VWH-1 — shape.** `procurement_invoices.withheld_amount numeric(14,2) not null default 0`. `amount` stays the
  gross bill (net + VAT), `tax_amount` stays VAT only, net payable = `amount − withheld_amount` (derived, never stored).
  Constraint: finite; zero, or the same sign as `amount` and no larger in magnitude. Rejected: a signed tax figure
  (VAT − withheld) and `amount` = net payable (ADR-0082 §Alternatives).
- **DD-VWH-2 — read-back.** From the ERPNext header only: gross = `grand_total` + `taxes_and_charges_deducted`,
  VAT = `total_taxes_and_charges` + `taxes_and_charges_deducted`, withheld = `taxes_and_charges_deducted`,
  outstanding = `outstanding_amount` verbatim; integer-cents addition. Deducted = 0 ⇒ byte-identical to today. A payload
  without `taxes_and_charges_deducted` leaves withholding unknown: today's figures, `withheld_amount` not written.
- **DD-VWH-3 — paid.** A bill is Paid when ERPNext's outstanding is zero, i.e. the net payable has been paid. Withheld
  tax is owed to the tax office, not the vendor; paying the gross is refused by ERPNext (allocation above outstanding).
- **DD-VWH-4 — what is refused.** DD-VI-3a is lifted for well-formed withholding templates. Refused before any ERP write
  (`config-rejected`, naming the template only — never the company or account): any negative rate (a negative Add row
  is disguised withholding ERPNext would not count as deducted); any rate above 100%; a Deduct row whose category is not
  `Total`; a Deduct row included in the item price; a Deduct row whose account is not a Liability; Deduct rates summing
  to 100% or more. A PPh-only template (Deduct rows, no VAT) is well-formed.
- **DD-VWH-5 — feed refresh (FR-ENA-116 built).** A mirrored Purchase Invoice's money and derived status refresh from
  any inbound change that carries the whole money header; a change missing any part of it writes none of it. This is
  what makes a bill reach Paid in PMO after a payment, withholding or not.
- **DD-VWH-6 — display.** A vendor invoice with tax withheld shows, under its amount in the procurement ledger, three
  labelled figures in the bill's currency: VAT, Tax withheld (PPh), Net payable. A bill with nothing withheld renders
  exactly as today.
- **DD-VWH-7 — the column default.** `default 0` is a fact for every writer except the ERP mirror (PMO-native bills
  never withhold); the mirror writer states the value on every create and never relies on the default (unit-tested and
  mutation-checked). Contrast 0196's no-default rule: there an omitted value was ambiguous for every writer.
  *(Slice 2: a PMO-native bill now states its withholding through the create functions; the default still means
  "none stated" — DD-VWH-10.)*
- **DD-VWH-8 — cost stays gross.** No cost, actual, commitment or budget figure is reduced by withholding. Actuals sum
  the GL mirror by mapped expense account (debited at the net total); the withholding credits a liability. Operator
  rule: never map a PPh payable account into a budget category.
- **DD-VWH-9 — sales symmetry.** Client withholding stays on the receipt (#762, DD-RCPT-1). The sales tax-row helper
  gains the same negative-rate refusal, so a misconfigured sales template cannot land an invoice whose mirror the
  database then refuses.

## 3. Requirements (EARS)

- **FR-VWH-001 (ubiquitous)** — The vendor-invoice mirror shall record for each ERPNext-owned Purchase Invoice its gross
  amount, its VAT and its tax withheld per DD-VWH-2, in the bill's currency.
- **FR-VWH-002 (event)** — When a user records a vendor invoice on a flipped org with a chosen purchase tax template
  that has Deduct rows, the system shall send all of the template's rows — Add and Deduct — to ERPNext with every field
  ERPNext computes them from, provided the template is well-formed (DD-VWH-4).
- **FR-VWH-003 (unwanted)** — If the chosen template is malformed withholding (DD-VWH-4), then the system shall refuse
  the create with `config-rejected` before any ERPNext write, naming the template and the reason, never the company or
  an account.
- **FR-VWH-004 (state)** — While a vendor invoice carries tax withheld, the system shall show it Paid exactly when
  ERPNext's outstanding amount for it is zero.
- **FR-VWH-005 (event)** — When ERPNext reports a change to a mirrored Purchase Invoice that carries its whole money
  header, the system shall refresh the bill's gross, VAT, withheld, outstanding and derived status; when the change
  lacks any of them, the system shall leave all of them unchanged.
- **FR-VWH-006 (ubiquitous)** — The system shall not reduce any project cost, actual, commitment or budget figure by
  tax withheld.
- **FR-VWH-007 (state)** — While a vendor invoice carries tax withheld, the procurement ledger shall show its VAT, its
  tax withheld (PPh) and its net payable, each labelled, in the bill's currency.
- **FR-VWH-008 (ubiquitous)** — `withheld_amount` shall not be client-insertable or -updatable, shall be pinned by the
  procurement mirror guard while procurement is externally owned, and ~~shall be zero on PMO-native vendor invoices~~
  **(amended, slice 2 / DD-VWH-10)** shall be written on a PMO-native vendor invoice only through the create functions
  (`create_procurement_invoice`, `capture_vendor_invoice`), zero when none is stated.
- **FR-VWH-009 (unwanted)** — If the default sales tax template has a row with a negative rate, then the system shall
  refuse the sales-invoice dispatch with `config-rejected` before any ERPNext write.
- **NFR-VWH-001** — The sweep reads no ERPNext child tables for this; the outbound create adds one Account read per
  Deduct row, on create only (replays read nothing, AC-520-6 unchanged).
- **NFR-VWH-002** — All money arithmetic is in integer cents (mapper and display).
- **OBS-VWH-001** — Before this change a mirrored bill's status and outstanding were written only by its own dispatch;
  a bill paid in ERPNext never showed Paid in PMO (AC-ENA-053's own note).
- **OBS-VWH-002** — The ledger's vendor-payment capture on a flipped org sends `amount` and `invoiceId`; the Payment
  Entry body reads `paid_amount`, `references` and a supplier, which that path never supplies. Out of scope here.

## 4. Acceptance criteria (Given/When/Then)

- **AC-VWH-001** — Given an enabled template of the binding's company with PPN 11% (Add) and PPh 23 2% (Deduct, on a
  liability account), when a user records a vendor invoice choosing it, then the ERPNext body carries the template name
  and both rows verbatim, the Deduct row as `add_deduct_tax: 'Deduct'`, `category: 'Total'`, `included_in_print_rate: 0`.
- **AC-VWH-002** — Given a PPh-only template (one Deduct row, no VAT row), when chosen, then it is sent, not refused.
- **AC-VWH-003** — Given a template that is malformed withholding (each DD-VWH-4 case), when chosen, then the create is
  refused `config-rejected`, the message names the template and neither the company nor the account, and nothing is
  written to ERPNext.
- **AC-VWH-004** — Given an ERPNext Purchase Invoice header with `taxes_and_charges_deducted`, when it is mapped, then
  gross, VAT and withheld follow DD-VWH-2 (including a PPh-only bill → VAT 0, and a return → all negative); without
  that field, withheld is absent and the header is verbatim; the sweep's field list requests it.
- **AC-VWH-005** — Given the local ERPNext bench (company currency IDR) and a flipped org whose currency is IDR, when a
  vendor invoice of IDR 1,000,000 is recorded with the PPN 11% + PPh 23 2% template, then ERPNext holds grand total
  1,090,000 with 20,000 deducted, its GL debits the item at 1,000,000 (cost gross of withholding) and credits 20,000 to
  the PPh account, and PMO's bill shows amount 1,110,000, VAT 110,000, withheld 20,000, outstanding 1,090,000, Received;
  when a payment of 1,090,000 referencing the bill is submitted and the sweep runs, then ERPNext shows the bill Paid with
  nothing outstanding and PMO's bill is Paid, outstanding 0, with its gross, VAT and withheld unchanged.
- **AC-VWH-006** — Given a created bill canonical, when the dispatch writer mirrors it, then the insert states
  `withheld_amount` (the canonical's, or `0.00` when it carries none) and an update omits it when the canonical has none.
- **AC-VWH-007** — Given a mirrored bill, when a feed change carries the whole money header, then gross, VAT, withheld,
  outstanding, `tax_treatment` and status are refreshed (outstanding 0 ⇒ Paid); when a part is missing, none are
  written; a non-invoice kind never gets these fields.
- **AC-VWH-008** — Given the 0266 schema, then `withheld_amount` is `numeric(14,2)`, not null, default 0; a withholding
  round-trips; NaN, a negative on a positive bill, more than the gross, withholding with no amount, and a positive on a
  negative bill are refused; a return's negative withholding is accepted.
- **AC-VWH-009** — Given the 0266 schema, then neither `authenticated` nor `anon` can insert or update
  `withheld_amount`, it is readable exactly where `amount` is, a PMO-native invoice **that states no withholding**
  records 0 *(amended, slice 2)*, the mirror guard refuses a client change while procurement is externally owned, and a
  service-role write passes.
- **AC-VWH-010** — Given gross, VAT and withheld figures **and the bill's tax basis** *(amended, slice 2)*, when the
  display figures are computed, then net payable = gross − withheld in exact cents, where gross is the amount for a
  tax-inclusive bill and amount + VAT for a tax-exclusive one (AC-VWH-026); nothing is shown when nothing was withheld or
  a figure or the basis is unknown.
- **AC-VWH-011** — Given a vendor invoice row with `tax_amount` and `withheld_amount`, when ledger rows are built, then
  the Invoice row carries both; rows without them are unchanged.
- **AC-VWH-012** — Given a ledger Invoice row with tax withheld, when rendered, then VAT, "Tax withheld (PPh)" and
  "Net payable" are shown, labelled, in the row's currency; a row with nothing withheld shows no breakdown.
- **AC-VWH-013** — Given a default sales tax template with a negative-rate row, when its rows are resolved, then the
  dispatch is refused `config-rejected` before any ERPNext write.

## 5. Traceability (owning layer, ADR-0010)

| AC | Requirement | Layer | Owning test |
|---|---|---|---|
| AC-VWH-001 | FR-VWH-002 | unit (Vitest) | `pmo-portal/src/lib/adapterSeam/erpnext/purchaseInvoiceTaxTemplate.test.ts` |
| AC-VWH-002 | FR-VWH-002 | unit (Vitest) | same |
| AC-VWH-003 | FR-VWH-003 | unit (Vitest) | same |
| AC-VWH-004 | FR-VWH-001 | unit (Vitest) | `pmo-portal/src/lib/adapterSeam/erpnext/bodies/bodies.test.ts` |
| AC-VWH-005 | FR-VWH-001/002/004/005/006 | served e2e (bench) | `pmo-portal/e2e/serial/AC-VWH-005-vendor-withholding.spec.ts` |
| AC-VWH-006 | FR-VWH-001 | unit (Deno) | `supabase/functions/adapter-dispatch/readModelWriters.money.test.ts` |
| AC-VWH-007 | FR-VWH-004/005 | unit (Deno) | `supabase/functions/_shared/erpnextFeedDeps.test.ts` |
| AC-VWH-008 | FR-VWH-001 | pgTAP | `supabase/tests/0269_vendor_withholding.test.sql` |
| AC-VWH-009 | FR-VWH-008 | pgTAP | same |
| AC-VWH-010 | FR-VWH-007, NFR-VWH-002 | unit (Vitest) | `pmo-portal/src/lib/vendorWithholding.test.ts` |
| AC-VWH-011 | FR-VWH-007 | unit (Vitest) | `pmo-portal/src/lib/db/procurementLedger.test.ts` |
| AC-VWH-012 | FR-VWH-007 | unit (RTL) | `pmo-portal/pages/procurement/ProcurementLedger.test.tsx` |
| AC-VWH-013 | FR-VWH-009 | unit (Vitest) | `pmo-portal/src/lib/adapterSeam/erpnext/erpSalesTaxRows.test.ts` |

AC-520-11 (refuse every withholding template) is **retired** by DD-VWH-4; its test is replaced by AC-VWH-001..003.

## 6. Open questions (parked with defaults)

- **OQ-VWH-1 (owner/accountant)** — Does RIS's ERPNext round bill totals (rounded total on)? *Default:* PMO shows
  ERPNext's grand total as the net payable; a rounding difference under one rupiah against the outstanding is accepted.
- **OQ-VWH-2 (owner/accountant)** — The withholding templates RIS needs (PPh 23 2%, the PPh 4(2) rates by service
  type) and the PPh payable accounts. *Default:* the operator creates them in RIS's ERPNext from the accountant's list
  before go-live (OD-ERP-4: ERP setup is operator work). *(Slice 2: templates are now optional — OQ-VWH-5 replaces the
  template half for bills entered with amounts.)*
- **OQ-VWH-3 (owner)** — Capture the bukti potong number per bill now? *Default:* no; #898 (tax registers) owns it.

---

## 7. Slice 2 — vendor tax set up in PMO, with editable amounts (OD-VWH-1, DD-VWH-10..14)

### 7.0 Job story

When Finance records a bill from a vendor, I want the VAT and the PPh to start from that vendor's usual treatment and
to be able to correct either amount to exactly what the vendor's invoice says, so that the bill — in PMO and, when RIS
is connected, in ERPNext — matches the paper to the rupiah without anyone maintaining tax templates.

### 7.1 Scope

**In:** the vendor's default tax treatment on the company (set by Admin/Finance); the organization's vendor-bill tax
accounts (set by Admin); both vendor-bill forms pre-filled from the vendor default with editable amounts and labelled
bases; standalone bills recording tax withheld; ERP-connected bills sending the entered amounts as fixed ERPNext rows
built server-side; the net-payable display for a tax-exclusive standalone bill.

**Out (explicit):**
- Storing the PPh type on a standalone bill (OQ-VWH-6).
- Pre-filling from the vendor default on the historical-import path, the assistant's vendor-invoice action, or any
  edit/amend (the default is for composing a NEW bill only — the OD-TAX-1 rule).
- A pre-submit net-payable preview on the bill form (unchanged from §1).
- The flipped form's existing "Amount (optional)" field, which the dispatch does not send (OBS-VWH-003, OQ-VWH-8).
- Changing the slice-1 template path, read-back, feed refresh or ledger breakdown beyond AC-VWH-010's basis fix.

### 7.2 Decisions

Ruled (Director, 2026-10-07 — `docs/decisions.md` DD-VWH-10..14):

- **DD-VWH-10** — standalone (no-ERP) bills may also carry withholding: the create functions take a withheld amount;
  the slice-1 "standalone records zero" rule is amended with its test.
- **DD-VWH-11** — the vendor default tax treatment is three company columns (VAT rate; PPh type `pph23` / `pph4_2`;
  PPh rate), editable only through a role-checked SECURITY DEFINER function (Admin/Finance), outside the companies ERP
  mirror guard.
- **DD-VWH-12** — org account settings: input-VAT account, PPh 23 payable account, PPh 4(2) payable account —
  organizations columns on the `tax_prepaid_account` precedent (column grant, Admin only, audited), liability check on
  send.
- **DD-VWH-13** — the server builds ERPNext `Actual` tax rows from the bill's entered amounts and the org accounts;
  client-supplied tax rows are never passed through; a bill naming both a template and amounts is refused.
- **DD-VWH-14** — on an ERP-connected org the bill form asks for tax again (reverses #505's connected-org hiding for
  vendor bills): items carry the net, tax rows carry the entered amounts.

Proposed by the planner (Director to ratify; ADR-0084):

- **DD-VWH-15** — the ERP-connected bill form's tax choice is "Enter the tax amounts" (default) or a named ERPNext
  template; "ERPNext default" is no longer offered (on a headless ERP it would apply a template nobody sees). The server
  still accepts a create naming neither (AC-520-2 unchanged) for non-form callers.
- **DD-VWH-16** — the "only through the function" rule on the three company columns is a BEFORE INSERT/UPDATE trigger
  honouring a transaction-local flag set by the function (the 0252 pattern), not a column-grant conversion of
  `companies` (which would freeze every future companies column out of client writes). Exempt: the service role and a
  session with no JWT (migrations, seed).
- **DD-VWH-17** — the pre-fill fills AMOUNTS (VAT and PPh), never the native nominal-rate field; a pre-filled amount
  follows its base until the user edits that field and is never overwritten afterwards ("never over a choice", the
  OD-TAX-1 rule). Suggested amounts round half-up to the cent (OQ-VWH-4). Each pre-filled field shows the rate and the
  base it came from.
- **DD-VWH-18** — the PPh type is asked only where it is consumed: on an ERP-bound bill (it selects the payable
  account). A standalone bill records the withheld amount only (OQ-VWH-6).
- **DD-VWH-19** — no server path reads a vendor default; the amounts on the submitted bill are the authority.
- **DD-VWH-20** — for a standalone bill recorded tax-exclusive, net payable = amount + VAT − withheld (DD-VWH-6's
  "gross = amount" holds for tax-inclusive bills, which every ERP-mirrored bill is).
- **DD-VWH-21** — an ERPNext bill with no template mirrors `tax_template` null, never an empty string.
- **DD-VWH-22** — the dispatch refuses (before any ERP write) tax withheld above the bill's items total before tax;
  otherwise ERPNext would accept it and the mirror's `withheld ≤ amount` bound would refuse every replay.

### 7.3 Requirements (EARS)

- **FR-VWH-010 (ubiquitous)** — Each company shall carry an optional default vendor tax treatment: a VAT rate (0 to 100
  percent, at most three decimals, or not set) and an optional withholding type (PPh 23 or PPh 4(2)) with its rate
  (above 0 and below 100 percent, at most three decimals); a type and its rate are set together or not at all.
- **FR-VWH-011 (event)** — When an active Admin or Finance member saves a company's vendor tax defaults, the system
  shall store them and record an audit event with the previous and new values, whether or not companies are owned by
  an external system.
- **FR-VWH-012 (unwanted)** — If any other role saves vendor tax defaults, a company of another organization or an
  Internal company is named, or any client writes the three columns other than through that save, then the system shall
  refuse and leave them unchanged.
- **FR-VWH-013 (ubiquitous)** — The organization shall carry three optional vendor-bill tax account settings — input
  VAT, PPh 23 payable, PPh 4(2) payable (each 1 to 140 characters) — changeable only by an Admin, each change audited.
- **FR-VWH-014 (event)** — When a user composes a new vendor bill for a procurement whose vendor has defaults, the form
  shall pre-fill the VAT amount and the tax withheld from those rates and the bill's base (the amount and its tax
  treatment on a standalone bill; the items total before tax on an ERP-bound bill), shall show each pre-filled
  amount's rate and base, and shall stop changing a field once the user edits it.
- **FR-VWH-015 (ubiquitous)** — Every pre-filled amount shall be editable, and the bill shall record exactly the
  amounts submitted.
- **FR-VWH-016 (event)** — When a standalone vendor invoice is recorded with tax withheld (either entry point), the
  system shall store it on the bill; a withholding with no bill amount, a negative one, or one above the amount shall be
  refused.
- **FR-VWH-017 (state)** — While procurement is ERP-owned, the vendor-bill form shall ask either the VAT amount plus an
  optional withholding (type and amount), or a named ERPNext purchase tax template — never both — and shall not offer
  "ERPNext default".
- **FR-VWH-018 (event)** — When a vendor invoice with entered amounts is recorded on an ERP-connected org, the system
  shall send ERPNext the case's items (the net) and fixed `Actual` tax rows built on the server — VAT added on the
  input-VAT account, PPh deducted on the type's payable account — with no template, omitting a zero row, and shall send
  no client-supplied tax row.
- **FR-VWH-019 (unwanted)** — If a create names a template and entered amounts together, carries a malformed amount, a
  withholding without its type, or tax withheld above the items total, then the system shall refuse it with
  `commit-rejected` before any ERPNext write; if a needed account setting is missing, or is not a non-group account of
  the binding's company (a PPh account: not a Liability), then the system shall refuse it with `config-rejected`
  naming the setting, never the account or the company.
- **FR-VWH-020 (state)** — While a standalone vendor invoice recorded tax-exclusive carries tax withheld, the ledger
  shall show its net payable as amount + VAT − withheld (DD-VWH-20).
- **NFR-VWH-003** — An ERP-bound create adds one `organizations` read and at most two ERPNext Account reads, on create
  only; a replay reads nothing and re-sends the persisted rows. The bill form adds one company read, cached and shared
  with the company page's cache key.
- **NFR-VWH-004** — Every new label and message on the bill forms, the company card and the Administration setting
  ships in English and Bahasa Indonesia.
- **OBS-VWH-003** — On an ERP-bound bill the form's "Amount (optional)" field is not forwarded by the repository (the
  ERP computes the total from the items); it predates this slice.

### 7.4 Acceptance criteria (Given/When/Then)

- **AC-VWH-020** — Given the 0269 schema, then the three company columns exist (`numeric(6,3)`, `text`,
  `numeric(6,3)`); a VAT rate above 100, NaN or negative, an unknown type, a type without a rate, a rate without a
  type, and a PPh rate of 0 or 100 are refused; 0% VAT with PPh 4(2) at 1.75% is accepted.
- **AC-VWH-021** — Given an active Finance or Admin member, when they save a vendor's defaults, then they are stored and
  one audit event records actor, previous and new values; given a Project Manager, Executive, Engineer or a disabled
  Finance account, then the save is refused 42501; given another organization's vendor, then "company not found"
  (P0002) and nothing changes there; given an Internal company, then refused; given companies owned by ERPNext, then the
  save still succeeds while the ERP mirror guard still pins the vendor's name.
- **AC-VWH-022** — Given an Admin, when they UPDATE a default column directly (even after a save in the same
  transaction) or INSERT a company carrying one, then 42501; other company edits and service-role writes still pass;
  `anon` cannot execute the save function, `authenticated` can, and the guard function is not client-callable.
- **AC-VWH-023** — Given the 0269 schema, then the three organization settings exist, a blank or 141-character value is
  refused, `authenticated` holds exactly their UPDATE column grants and no INSERT, `anon` none; an Admin's change is
  stored and audited (actor, from, to); a Finance user's change reaches no row and is not audited.
- **AC-VWH-024** — Given a PMO-owned procurement, when Finance records a vendor invoice with tax withheld through
  `create_procurement_invoice` or `capture_vendor_invoice`, then the withholding is stored; without one it is 0; a
  withholding with no amount, a negative one, or one above the amount is refused; the create audit records VAT and
  withheld.
- **AC-VWH-025** — Given a vendor default and a base, when amounts are suggested, then VAT on a tax-exclusive amount =
  rate × amount and inside a tax-inclusive amount = amount × rate / (100 + rate), PPh = rate × the net, each half-up to
  the cent; the items total sums quantity × rate per line; entered amounts and the default editor's drafts parse per
  FR-VWH-010/015/016/017.
- **AC-VWH-026** — Given a standalone bill recorded tax-exclusive with VAT and tax withheld, when its ledger figures
  are computed and rendered, then net payable = amount + VAT − withheld in exact cents.
- **AC-VWH-027** — Given the role policy, then managing vendor tax defaults is allowed for Admin and Finance only.
- **AC-VWH-028** — Given the vendor tax defaults card on a Vendor company, when Finance enters 11% VAT and PPh 23 at 2%
  and saves, then exactly those defaults are saved; choosing no withholding hides the PPh rate and saves none; a VAT
  rate above 100% blocks the save with a message; a role without the right sees the defaults read-only; the card renders
  in Bahasa Indonesia.
- **AC-VWH-029** — Given the Administration accounting panel, when an Admin enters the three tax accounts and saves,
  then exactly the trimmed values (blank → none) are saved; a non-Admin sees them read-only; a failed read offers a
  retry; the setting renders in Bahasa Indonesia.
- **AC-VWH-030** — Given a standalone org and a vendor with 11% VAT and PPh 23 at 2%, when the user enters an amount of
  1,000,000 tax-exclusive on either vendor-bill entry point, then the VAT amount is pre-filled 110,000 and the tax
  withheld 20,000, each labelled with its rate and base, and the save carries both; when the user edits the PPh and then
  changes the amount, the VAT follows and the edited PPh does not; without a vendor default nothing is pre-filled and a
  blank PPh records none; a PPh with no bill amount blocks the save.
- **AC-VWH-031** — Given an ERP-connected org, an items total of 1,000,000 and the same vendor default, when the bill
  form opens, then "Enter the tax amounts" is selected, VAT 110,000, PPh 23 and 20,000 are pre-filled with the items
  total shown as their base, and the save carries those amounts and no template; choosing a template hides the amounts
  and carries only the template; choosing no withholding carries none; without a default the save waits for a VAT
  amount; "ERPNext default" is not offered; the labels render in Bahasa Indonesia.
- **AC-VWH-032** — Given a staged or inline vendor bill, when it is confirmed, then a standalone bill's tax withheld
  reaches the create RPC as `p_withheld_amount` (omitted when none) and an ERP-bound bill's amounts reach the dispatch
  as `vatAmount` / `withheldAmount` / `pphType` (never as rows, never the native tax facts); the vendor default editor
  calls `set_vendor_tax_defaults` and the account setting writes only its three columns.
- **AC-VWH-033** — Given the dispatch factory, when an ERP-bound create carries entered amounts, then the ERPNext body
  carries exactly the server-built `Actual` rows on the org's accounts and `taxes_and_charges: ''` (an empty table when
  both are zero); caller rows and the amounts marker are dropped; template + amounts, a malformed amount, a withholding
  without a type and a withholding above the items total are refused `commit-rejected` before any ERPNext read or
  write; a missing setting, an unknown, foreign or group account, or a non-liability PPh account is refused
  `config-rejected` naming the setting and neither the account nor the company; a replay reads nothing and keeps its
  digest.
- **AC-VWH-034** — Given the Purchase Invoice body mapper, then the server marker sends the rows with an empty template,
  rows without the marker or a template are never sent, and a header with an empty template mirrors `tax_template` null.
- **AC-VWH-035** — Given the shipped served `adapter-dispatch` handler, when a create names a template and amounts, then
  422 with no ERPNext call; when a create with amounts carries forged rows and the marker, then the one Purchase Invoice
  POST carries only the two server-built rows.
- **AC-VWH-036** — Given the local bench, a throwaway organization in IDR (`SAR_CURRENCY`) whose input-VAT and PPh 23
  settings name bench accounts, when a bill of one item at 1,000,000 with VAT 110,000 and PPh 23 20,000 entered is
  recorded, then ERPNext holds exactly two `Actual` rows (110,000 added, 20,000 deducted) with no template, net
  1,000,000, grand total and outstanding 1,090,000, the PPh credited to its payable account and the vendor credited
  1,090,000; PMO mirrors amount 1,110,000, VAT 110,000, withheld 20,000, outstanding 1,090,000, Received, IDR, no
  template; the seed organization's currency and tax settings are unchanged.

### 7.5 Traceability (owning layer, ADR-0010)

| AC | Requirement | Layer | Owning test |
|---|---|---|---|
| AC-VWH-020 | FR-VWH-010 | pgTAP | `supabase/tests/0269_vendor_tax_defaults.test.sql` |
| AC-VWH-021 | FR-VWH-011/012 | pgTAP | same |
| AC-VWH-022 | FR-VWH-012 | pgTAP | same |
| AC-VWH-023 | FR-VWH-013 | pgTAP | `supabase/tests/0269_vendor_tax_accounts_native_withholding.test.sql` |
| AC-VWH-024 | FR-VWH-016 | pgTAP | same |
| AC-VWH-025 | FR-VWH-014/015 | unit (Vitest) | `pmo-portal/src/lib/vendorWithholding.test.ts` |
| AC-VWH-026 | FR-VWH-020 | unit (Vitest + RTL) | `pmo-portal/src/lib/vendorWithholding.test.ts` (figures); `pmo-portal/pages/procurement/ProcurementLedger.test.tsx` (render) |
| AC-VWH-027 | FR-VWH-011 (UX mirror) | unit (Vitest) | `pmo-portal/src/auth/policy.vendorTax.test.ts` |
| AC-VWH-028 | FR-VWH-010/011, NFR-VWH-004 | unit (RTL) | `pmo-portal/pages/company/VendorTaxDefaultsCard.test.tsx` |
| AC-VWH-029 | FR-VWH-013, NFR-VWH-004 | unit (RTL) | `pmo-portal/pages/admin/OrgVendorTaxAccounts.test.tsx` |
| AC-VWH-030 | FR-VWH-014/015/016 | unit (RTL) | `pmo-portal/pages/procurement/RecordCaptureForm.vendorTax.test.tsx` (+ inline: `pmo-portal/pages/__tests__/ProcurementDetails.externalRef.test.tsx`; latch: `pmo-portal/src/hooks/useSuggestedMoney.test.ts`) |
| AC-VWH-031 | FR-VWH-014/017, NFR-VWH-004 | unit (RTL) | `pmo-portal/pages/procurement/RecordCaptureForm.vendorTax.test.tsx` |
| AC-VWH-032 | FR-VWH-015/016/018 | unit (Vitest + RTL) | `pmo-portal/src/lib/db/procurementLifecycle.test.ts`, `pmo-portal/src/lib/repositories/procurement.external.test.ts`, `pmo-portal/src/lib/db/companies.taxDefaults.test.ts`, `pmo-portal/src/lib/db/orgs.vendorTax.test.ts`, `pmo-portal/pages/__tests__/ProcurementDetails.externalRef.test.tsx` |
| AC-VWH-033 | FR-VWH-018/019, NFR-VWH-003 | unit (Vitest) | `pmo-portal/src/lib/adapterSeam/erpnext/purchaseInvoiceTaxAmounts.test.ts` |
| AC-VWH-034 | FR-VWH-018, DD-VWH-21 | unit (Vitest) | `pmo-portal/src/lib/adapterSeam/erpnext/bodies/bodies.test.ts` |
| AC-VWH-035 | FR-VWH-018/019 | unit (Deno, shipped handler) | `supabase/functions/adapter-dispatch/vendorTaxAmounts.test.ts` |
| AC-VWH-036 | FR-VWH-018, FR-VWH-001 | served e2e (bench) | `pmo-portal/e2e/serial/AC-VWH-036-vendor-tax-amounts.spec.ts` |

AC-520-9's "leaving ERPNext default stages no template" case is **retired** by DD-VWH-15 (a deliberate UX change); its
goal — no template staged when none is chosen — is kept by AC-VWH-031.

### 7.6 Open questions (parked with defaults)

- **OQ-VWH-4 (owner/accountant)** — How do RIS's vendors round VAT and PPh (half-up, down, to the rupiah)? *Default:*
  suggestions round half-up to the cent; the user corrects any amount to the vendor's invoice.
- **OQ-VWH-5 (owner/operator)** — The exact names of RIS's input-VAT, PPh 23 payable and PPh 4(2) payable accounts in
  ERPNext. *Default:* the operator enters them in Administration → Accounting before go-live from the accountant's
  chart; until then a bill carrying that tax is refused naming the missing setting.
- **OQ-VWH-6 (Director)** — Store the PPh type on a standalone bill? *Default:* no (DD-VWH-18). Risk: a no-ERP org's
  monthly PPh return (#898) has no GL to read the type from; bills recorded before a later additive column would lack
  it. Recommendation: decide before the first no-ERP org withholds.
- **OQ-VWH-7 (owner/accountant)** — PPN at 12% on a reduced base of 11/12 (2025 rule): which VAT rate does a vendor
  default hold? *Default:* the effective rate (11); the bill's VAT amount stays editable.
- **OQ-VWH-8 (Director)** — Hide the ERP-bound form's unused "Amount (optional)" field (OBS-VWH-003, the #505
  asked-and-discarded class) in this slice? *Default:* left as is; recommendation: hide it — a one-line change plus one
  test-step update in AC-520-9.
