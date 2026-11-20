# Spec: Subcontractor progress certificate from measured work at agreed rates (#2584)

**Status:** proposed; owner decisions below need sign-off before build. IDs `FR-SPC-###`, `NFR-SPC-###`, `AC-SPC-###`. Plan: `docs/plans/2026-11-20-subcontractor-progress-certificate.md`. Executor: **Director-dispatched, one fresh Orca worker per slice, ships alone** (money, SoD, payable path). Map #2516 (after the go-live; Feb to Mar). Extends `docs/specs/subcontract-acceptance.spec.md` (#1513, shipped) and `docs/specs/daily-site-report.spec.md` (#1522, not yet shipped). It adds no second payables path: an approved certificate is captured as a vendor bill through the shipped subcontract capture function.

## Job story

When a month ends and a subcontractor's crews have worked on our work orders, I want a certificate drawn up from the daily reports our quantity-surveyor already validated, priced at the subcontractor's agreed rates, with the backcharges we owe ourselves taken off, so that the vendor bill we pay is exactly what was measured, never more than the subcontract allows, and its cost lands on the right work order, without anyone retyping quantities into a spreadsheet.

## Context and boundary

Shipped on `dev` and relied on (verified by reading the files named):
- **Subcontract purchase order with BoQ lines** (`supabase/migrations/0449_subcontract_po_lines.sql`): `procurements.is_subcontract`, `purchase_order_lines` (po, revision, `boq_item_id`, `quantity numeric(14,3)`, `rate numeric(14,2)`, unit), `purchase_order_revisions`, `po_effective_revision()`.
- **Signed acceptance and the bill cap** (`0470_subcontract_acceptances.sql`, `0472_subcontract_bill_caps.sql`): `prepare_/confirm_/withdraw_subcontract_acceptance`, `subcontract_verified()`, `subcontract_bill_cap_violation()` (billed + requested <= least(verified, PO quantity), fails closed), `capture_subcontract_vendor_invoice()` (lines, rate no higher than the PO rate, amount equals the lines, advisory lock per PO), `procurement_invoice_lines` (primary key invoice + `boq_item_id`, so one line per item per bill), `subcontract_po_position()`, void in `0885_void_subcontract_bill.sql`.
- **Work order on every cost** (#2517, `0951_work_order_cost_attribution.sql`): `procurement_invoices.work_order_id`, rule trigger `check_cost_attribution`, view `work_order_cost_lines`, plan versus actual (`0999_work_order_cost_amounts.sql`).
- **Contract items** are `boq_items`; a work order's items are `work_order_lines` (`0337_contract_quantities.sql`). Vendors are `companies`.
- **Rate-line versioning pattern** (`0515_contract_rates.sql`: version, `is_current`, effective window, `stamp_org_id`, FORCE RLS) is the model for the rate card; it holds client-side rates only and is not reused.

**Not shipped, dependencies (checked on `dev`: no migration or table exists):**
- **#1522 daily site report** (spec only). A validated report with progress lines (work order, contract item, quantity, date) is the measured-work source. Its progress line names no performing party today; this spec needs an optional `crew_id` on each progress line (OD-SPC-1) and must be reconciled with that ticket before either builds.
- **#2528 crews** (spec only). A crew of kind `vendor` carries its vendor company; a crew serves one work order a day. Crew master and roster must exist before certificates can attribute measured work to a subcontractor.
- **#2520 rate catalogue** is the client-side catalogue; this feature does not need it (the subcontractor rate card is separate cost data, OD-SPC-2).
- **#2517** is shipped.

Boundary:
- A certificate is a **calculation and approval record**. It never posts, pays, or edits a bill by hand. Its only effect on payables is one call to the shipped capture function.
- Measured quantity for payment is still gated by the shipped cap, which needs a confirmed signed acceptance. The certificate prepares that acceptance; it does not replace it (OD-SPC-4).
- Retention, advance recovery and tax changes are not modelled by the shipped subcontract bill (SCA OQ-8 deferred them); see OD-SPC-6.
- Standalone mode (no ERP) is built here. Pushing the deduction to a connected ERP is OD-SPC-5.

## Definitions (used by the acceptance criteria)

- **Certificate**: one subcontract PO, one calendar month (period), one work order (the PO's `work_order_id`; OD-SPC-7).
- **Period**: first to last calendar day inclusive, project-local dates, never browser time. At most one non-cancelled certificate per PO and period.
- **Measured line**: a progress line of a **validated, non-superseded** daily report where the report's work order is the certificate's, the work date is in the period, the line's crew is a `vendor` crew whose vendor is the PO's vendor, the contract item is on the PO's effective revision, and the line is in no other live certificate.
- **Measured quantity** per contract item = sum of measured-line quantities, `numeric(14,3)`.
- **Rate card line**: (vendor company, contract item, unit, rate `numeric(14,2)`, currency, `effective_from`, optional `effective_to`, version, `is_current`). `effective_from` is the first day of a month (OD-SPC-3), windows of one (vendor, item) do not overlap.
- **Rate for the period**: the card line whose window contains the period's first day. Its currency must equal the PO's currency and its rate must not exceed the PO line's rate (shipped FR-SCA-023). Otherwise the item is **unrated** with the reason, excluded from the certificate, and its measured lines stay available for a later certificate.
- **Line amount** = `round(measured quantity x rate, 2)` (Postgres `numeric` rounding, half away from zero), the same rule as `procurement_invoice_lines.amount`. **Gross** = sum of line amounts.
- **Backcharge**: a recorded recovery from the subcontractor (amount > 0, `numeric(14,2)`, reason from a short list plus text, optional proof attachment, optional work order). It is deducted on the certificate in which it is included; a backcharge is included in at most one live certificate.
- **Net** = gross − sum of included backcharges. Net must be >= 0 (OD-SPC-8).
- **Certified to date** per item = this certificate's measured quantity + the quantity on this PO's live captured bill lines. It must stay <= least(verified, PO quantity), the shipped cap.
- Money is exact decimal, never float; currency is the PO's, no conversion.

Hand calculation for the acceptance criteria (PO quantity 100 per item, PO rate 12.00, one vendor, work order W, month M):
| Item | Measured qty (validated, vendor crew) | Card rate | Line amount |
|---|---|---|---|
| A | 40.000 (day 3: 15.000, day 9: 25.000) | 10.00 | 400.00 |
| B | 12.500 | 8.40 | 105.00 |
| C | 3.333 | 9.99 | 33.30 (33.29667 rounds to 33.30) |
Gross 538.30. Backcharge 38.30 ("rework"). Net **500.00**. Excluded and listed: item D, 6.000 measured, no card line (unrated); an own-crew line (not the vendor's); a `submitted` (not validated) report line; a superseded report line.

## State machine

`draft` → `submitted` → `approved` → `billed`; `submitted` → `returned` (reason required) → `submitted`; `draft|returned|submitted|approved` → `cancelled` (while no bill is captured; reason required).
- `draft`: lines and amounts are recomputed from live data each time it is saved or opened.
- `submitted`: lines, rates and backcharges are **frozen** (a snapshot) at submit; later daily-report, rate-card or backcharge changes do not change it. Return unfreezes it.
- `approved`: immutable. Approver is not the preparer (no sole-operator escape; OD-SPC-9).
- `billed`: a vendor bill was captured from it; the certificate stores the invoice id. Voiding that bill (shipped void) returns the certificate to `approved`.
- `cancelled`: releases its measured lines and backcharges.

## Requirements (EARS)

**Rate card**
- FR-SPC-001 The system shall let Admin and Finance keep a subcontractor rate card per vendor company: one line per contract item with unit, rate, currency, `effective_from` (first day of a month) and optional `effective_to`.
- FR-SPC-002 The system shall version rate lines (a change ends the current version and creates the next; earlier periods keep the version current on their dates), refuse overlapping windows for one (vendor, item), and audit every change in record history.
- FR-SPC-003 A Project Manager shall read rate lines of vendors on projects they manage; an Engineer and a field controller shall read none (rate is cost-sensitive).

**Preparing**
- FR-SPC-004 The system shall let a Project Manager, Finance or Admin prepare a certificate for a subcontract PO, a period and its work order, as a draft, in an organisation whose procurement feature is enabled.
- FR-SPC-005 When a draft is opened or saved, the system shall derive the measured lines, quantities, rates, line amounts and gross from the Definitions, on the server, from validated daily reports and the rate card. A client-supplied quantity or amount shall never be stored.
- FR-SPC-006 The system shall list every excluded source with its reason: unrated, wrong crew or vendor, report not validated, report superseded, item not on the PO, already certified, currency or rate above the PO rate.
- FR-SPC-007 The preparer may deselect a measured line with a reason; a deselected line stays uncertified and available.
- FR-SPC-008 The system shall show per item: PO quantity, verified, billed, this certificate, certified to date, and whether the cap would hold; where verified is short it shall say so in words and offer "prepare acceptance".
- FR-SPC-009 The system shall let the preparer record a backcharge with amount, reason and optional proof, include or exclude it, and shall show gross, backcharges and net.

**Acceptance bridge**
- FR-SPC-010 The system shall let the preparer create, from a certificate, a **draft** subcontract acceptance whose cumulative verified quantity per item is the latest confirmed verified quantity plus the certificate's measured quantity, by calling the shipped `prepare_subcontract_acceptance`. Confirming it (signed Berita Acara, preparer ≠ confirmer) stays the shipped process.

**Submit, approve, bill**
- FR-SPC-011 When submitted, the system shall freeze the lines, rates, backcharges and totals as a snapshot with preparer and time.
- FR-SPC-012 When a certificate is approved, the system shall refuse unless the approver is not the preparer, all lines pass the shipped cap check (`subcontract_bill_cap_violation`, fail closed), net >= 0, and no line is unrated. Approval shall be a security-definer RPC.
- FR-SPC-013 An approved certificate shall be immutable (update and delete refused by the database, including by the function owner path).
- FR-SPC-014 When an approved certificate is billed, the system shall call `capture_subcontract_vendor_invoice` with the frozen lines at the frozen rates, set `procurement_invoices.work_order_id` to the certificate's work order, store the invoice id on the certificate and move it to `billed`; it shall not insert into `procurement_invoice_lines` or any payment table itself.
- FR-SPC-015 The bill's amount shall reflect the backcharges so that the payable equals the certificate's net (OD-SPC-5). The cap and the PO-rate check shall use gross quantities and rates as shipped.
- FR-SPC-016 If bill capture is refused (cap, lock, closed purchase), the certificate shall stay `approved` and show the refusal reason; nothing shall be half-written.
- FR-SPC-017 Cancelling a `submitted` or `approved` certificate before billing, or voiding its bill, shall release its measured lines and backcharges to be certified again.

**Visibility and access**
- FR-SPC-018 The system shall list certificates by project, vendor, PO, period and status, with stable order and bounded pagination (archive per ADR-0018), and show on the work order its certified cost by period.
- FR-SPC-019 Actions (manage rate card, prepare, record backcharge, submit, approve, bill, view) shall be registered in the role matrix (#902) and gated by `can()`; RLS and the RPCs enforce. Preparers: Project Manager, Finance, Admin. Approvers: Finance, Admin (and Executive if the existing approval set includes it, OD-SPC-9).
- FR-SPC-020 Every certificate, line, backcharge and rate row shall carry `org_id` stamped by default or trigger, never from the client, with RLS and FORCE RLS on every new table; children inherit tenancy from the parent.
- FR-SPC-021 Every prepare, submit, return, approve, bill, cancel and backcharge change shall write an audit event with actor and time.

## Non-functional requirements
- NFR-SPC-001 One certificate for one month of one PO derives in one indexed query set (daily-report lines by work order and date, crew by vendor), bounded below `max_rows`; a failed or truncated read shows an error, never a fabricated zero.
- NFR-SPC-002 Concurrency: preparing, approving and billing take the shipped per-PO advisory lock (`subcontract_po_lock`) before touching lines, in the order procurement row, PO lock, certificate; two sessions certifying the same measured line yield exactly one live claim.
- NFR-SPC-003 Fail closed: if the cap, the rate or the report read cannot be evaluated, the step refuses.
- NFR-SPC-004 `DESIGN.md` tokens, shared form primitives, English and Bahasa Indonesia complete; certificate screen usable at tablet width, print view for the signed copy.
- NFR-SPC-005 Reversible migrations with rollback files that refuse while rows exist.

## Acceptance criteria and owning layer (ADR-0010)

| ID | Given / When / Then | Layer |
|---|---|---|
| AC-SPC-001 | Given the hand-calculation month, when the draft is derived, then lines are A 400.00, B 105.00, C 33.30, gross 538.30; D, the own-crew line, the unvalidated and superseded lines are listed excluded with their reasons. | Unit (pure derive function) + pgTAP (server derive) |
| AC-SPC-002 | Given the backcharge of 38.30, when totals are read, then net is exactly 500.00 and the same figure is stored at submit. | Unit + pgTAP |
| AC-SPC-003 | Given measured 0.1 + 0.2 style quantities (3.333 x 9.99), when computed, then no float error and the line equals `round(q x r, 2)` as the shipped bill line does. | Unit |
| AC-SPC-004 | Given a rate card change from the next month, when last month's certificate is derived, then the earlier rate is used; given an `effective_from` that is not a month start, or an overlapping window, then refused. | pgTAP |
| AC-SPC-005 | Given a card rate above the PO line rate or in another currency, when derived, then the item is unrated with that reason and contributes 0. | pgTAP |
| AC-SPC-006 | Given a certificate submitted by A, when A approves it, then refused; when another Finance or Admin approves, then `approved`. A sole-member organisation cannot approve. | pgTAP (+ mutation check) |
| AC-SPC-007 | Given an approved certificate, when anyone updates or deletes it, its lines, or its backcharges (including through a definer path), then refused. | pgTAP |
| AC-SPC-008 | Given a submitted snapshot, when a daily report is later corrected or the card rate changes, then the snapshot is unchanged; after return and resubmit it reflects them. | pgTAP |
| AC-SPC-009 | Given measured A = 40 but verified 30 (no confirmed acceptance for 40), when approval is attempted, then refused naming item, verified, PO quantity, billed; after the prepared acceptance is confirmed for 40, approval succeeds. | pgTAP |
| AC-SPC-010 | Given an approved certificate, when billed, then exactly one invoice exists with lines equal to the snapshot at the snapshot rates, `work_order_id` set to the certificate's, and the invoice id stored; a second bill call creates none. | pgTAP |
| AC-SPC-011 | Given the billed certificate, when payable is read, then it is 500.00 (gross 538.30 less the backcharge 38.30) and a payment above it is refused. | pgTAP |
| AC-SPC-012 | Given two concurrent certificates over the same measured lines, then exactly one claims each line; given two concurrent bills at the cap, exactly one succeeds. | pgTAP (concurrency) |
| AC-SPC-013 | Given bill capture refused by the cap, then the certificate stays `approved` with the reason and no invoice or line rows exist. | pgTAP |
| AC-SPC-014 | Given a cancelled certificate or a voided bill, then its measured lines and backcharges can be certified again and the PO position's billed quantity drops. | pgTAP |
| AC-SPC-015 | Given net would be negative (backcharges above gross), then approval is refused (OD-SPC-8). | pgTAP |
| AC-SPC-016 | Given the billed certificate, when the work-order cost read is opened, then the bill shows on that work order with the net-based cost per OD-SPC-5, and project totals use the same figure. | pgTAP |
| AC-SPC-017 | Given a user in another organisation, a role without permission, an Engineer or a field controller, when they read or write rates, certificates or backcharges, then refused or not found; a Project Manager sees rates only of their projects' vendors. | pgTAP |
| AC-SPC-018 | Given the SoD line and the cap pre-check are each removed in turn, then AC-SPC-006 and AC-SPC-009 go red (mutation check, restored afterwards). | pgTAP (mutation) |
| AC-SPC-019 | Given a certificate screen in each state (draft with exclusions, submitted, approved, billed, error, empty), then every figure, exclusion reason and the refusal wording render, in English and Bahasa Indonesia. | Unit/RTL |
| AC-SPC-020 | Given a Finance user and a preparer, when the preparer prepares from validated reports, submits, a different Finance user approves and bills, then the payable bill exists on the work order with no retyping. | E2E (one journey) |

## Errors
| Condition | Result |
|---|---|
| Approver is the preparer | Refused, "needs a different approver", stays `submitted` |
| Over the cap | `SC001` from the shipped function, shown with item, verified, PO quantity, billed |
| Unrated item | Excluded and listed; approval needs none left unrated unless deselected |
| Net below zero | Refused with the figures |
| Another live certificate holds the line | "Already certified in <period>" with link |
| Rate card overlap or non-month-start | Field error |
| Read truncated or failed | Error state, no totals shown |

## Owner decisions (recommended defaults, not rulings)
| ID | Decision and default | If wrong, what breaks |
|---|---|---|
| OD-SPC-1 | A daily-report progress line carries an optional crew (so the work is the subcontractor's through that crew's vendor). Default: add it to #1522 before either builds; only lines with a vendor crew can be measured here. | Without it, nothing separates our own crews' work from a subcontractor's and the certificate would pay for our own work. |
| OD-SPC-2 | The rate card is a cost rate per (vendor, contract item), separate from the client rate catalogue (#2520) and the T&M card (`0515`). | Reusing the client rate would pay the vendor our selling price. |
| OD-SPC-3 | Rate changes take effect on month starts, so one rate applies per item per certificate (the shipped bill allows one line per item). | Mid-month changes would need split bill lines; the shipped primary key forbids it. |
| OD-SPC-4 | The certificate prepares, but does not replace, the signed acceptance; the shipped cap is the gate. | Skipping it pays for quantity nobody signed for, the exact thing #1513 prevents. |
| OD-SPC-5 | Backcharges reduce the payable through one new non-tax deduction on the bill, honoured by the payment ceiling and the work-order cost; cost on the work order is net of backcharges. Tax withholding fields are not reused. ERP-connected organisations: deduction is held back until the ERP route (#1505) carries it; standalone only now. Needs an ADR. | Reusing the tax withholding field corrupts withholding slips; ignoring it overpays the vendor by the backcharge. |
| OD-SPC-6 | Retention is not in the shipped model; none in this slice. Owner to say whether a retention percentage per subcontract is wanted next. | A contract with retention would over-pay each month until built. |
| OD-SPC-7 | One certificate covers one PO and one work order (the PO's). Lines from other work orders are listed excluded. | A PO spanning several work orders needs one certificate each, or a split bill. |
| OD-SPC-8 | Net may not be negative; excess backcharge carries to the next certificate. | A negative bill is a credit note, which the shipped model lacks. |
| OD-SPC-9 | Approver is Finance or Admin, never the preparer, with no sole-operator escape (as daily-report validation). | Self-approval of a payable is the money-path defect class. |
| OQ-SPC-1 | Is the certificate period always a calendar month? Default yes. | Four-week or contract-month periods need a configurable cycle. |
| OQ-SPC-2 | Are backcharge reasons a fixed short list (rework, damaged, safety, materials supplied, other)? Default yes. | Reporting by cause is weak. |

## Delivery checklist
- [ ] Owner signs OD-SPC-1..9, answers OQ-SPC-1..2.
- [ ] #1522 (with crew on progress lines) and #2528 shipped, or their contracts reconciled to the names here.
- [ ] Slices ship separately: rate card; derive and certificate; approval and bill (alone, money).
- [ ] Glossary: subcontractor progress certificate, measured line, rate card (subcontractor), backcharge, net certified amount.
- [ ] ADR candidate: payable deduction on a vendor bill (OD-SPC-5).
