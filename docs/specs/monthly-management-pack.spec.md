# Spec: monthly management pack (issue #765)

> **Status:** Draft — 2026-10-06. **Plan:** [`docs/plans/2026-10-06-monthly-management-pack.md`](../plans/2026-10-06-monthly-management-pack.md).
> **ADR:** [ADR-0076](../adr/0076-management-pack-recognition-is-an-estimate.md).
> **Builds on:** OD-TAX-1 + migration 0197 (net-of-tax normalisation), DD-CUR-6 (per-currency, never
> converted), OD-WO-1 (a project IS the contract), ADR-0048 (ERP is the ledger), the revenue read rule
> (`policy.ts` `salesInvoice.view` = Admin · Executive · PM · Finance; RLS = any active org member),
> OD-UX-3 + DD-RPT-1 (the `/reports` placeholder and the "Board pack (coming soon)" button wait for this).
> **Decisions:** DD-MMP-1..6 in §3 — accepted by the Director 2026-10-06 (`docs/decisions.md`).

## 1. Job story

When month-end comes, I (Finance / Executive) want one screen and one file that show, per project and
month, what we planned to earn, what we earned, what we billed, what we earned but have not billed, and
what is left on each contract — in the contract's currency, net of tax — so I can run the monthly
management meeting without assembling a spreadsheet by hand.

## 2. Evidence: how the first client recognises revenue today

Read 2026-10-06 (client material lives outside this repo; nothing is copied here but the method):

- **Their books recognise revenue on billing.** At each month-end the accountant posts that month's
  sales invoices to the single sales account at the **tax-exclusive base**, against receivables. One
  down-payment invoice was held in unearned revenue at a half-year close rather than in sales.
- **No unbilled-revenue (contract-asset) account exists** in their chart of accounts. Nothing is ever
  recognised ahead of billing in the ledger.
- **Their monthly workbook** is an invoice register (base, VAT, withholding per invoice, paid date) plus a
  project list (contract value, currency, start/end dates, status).
- **Their financial model** spreads each contract's value across periods and tracks "recognised to date"
  and "remaining" per contract — a backlog view.
- Limitation: the monthly workbooks themselves (`.xlsx`) were not opened in this pass (no spreadsheet
  reader in the planning tool set); the above comes from their financial statements, the accountant's
  ledger extract, the workbook's sheet structure, and the model audit. The Director may re-confirm by
  opening the monthly report's revenue sheet before build; nothing below changes unless it shows a
  monthly percent-complete column, in which case DD-MMP-1's override becomes the expected practice (no
  code change — the same entries drive it).

**Consequence.** Pure billing basis would make "unbilled" always zero, and the issue asks for it. So:
billing basis by default (matches their books exactly), plus an optional month-end **percent complete**
per project that switches that project to progress-based recognition. Unbilled is then non-zero only
where someone has said work is ahead of (or behind) billing.

What PMO already holds (schema read): `projects.contract_value` + `tax_treatment`/`tax_amount` + `currency`
+ `start_date`/`end_date`; `sales_invoices` with `amount`, `tax_treatment`, `tax_amount`, `currency`,
`invoice_date`, `status`; `project_milestones.weight`/`input_pct` and `get_projects_delivery` (a weighted
delivery % — current state only, no history, and milestones carry no money); `work_orders` (drawdown, not
recognition); budget versions (cost side only). No monthly progress history exists anywhere.

## 3. Decisions (DD- proposals, Director-decidable; none is commercial or irreversible)

- **DD-MMP-1 — recognition = billing basis, with an optional month-end percent complete.**
  Recognised to date at month *m* = (latest percent-complete entry dated ≤ *m*) × net contract value; when
  the project has no entry dated ≤ *m*, recognised to date = invoiced to date (net). Entries carry forward
  until the next one. *Why:* matches the client's ledger with zero input, and gives "unbilled" meaning
  exactly where a PM/Finance judges progress differs from billing. Milestone delivery % is shown as a
  *suggestion* when entering, never applied automatically (milestones carry no money and no history).
- **DD-MMP-2 — planned revenue = net contract value spread straight-line by calendar day** from
  `start_date` to `end_date`. Rounded on the cumulative figure so the months sum exactly to the contract.
  A project missing either date shows "No schedule". *Why:* the client's model spreads contracts across
  periods; dates are the only schedule PMO holds.
- **DD-MMP-3 — unbilled is a balance, backlog is per month.** Unbilled at month *m* = recognised to date −
  invoiced to date (negative = billed ahead). Backlog at month *m* = net contract − recognised to date; the
  as-at month is the headline. Neither is clamped.
- **DD-MMP-4 — who.** Read: the existing revenue read set (Admin · Executive · PM · Finance), all projects,
  behind the `revenue` module. Record progress: Finance rank and above (`holds_won_value_authority`), or
  the project's own PM. No SoD: an estimate moves no money; every entry is stamped with who and when.
- **DD-MMP-5 — every figure is net of tax, in the contract's own currency.** Invoices and contract value
  are normalised with 0197's formula (`inclusive → value − tax`). Invoices in another currency than the
  contract form their own row; totals are per currency, never converted (DD-CUR-6).
- **DD-MMP-6 — the pack is a management estimate, not a ledger** (ADR-0076). It never writes to ERPNext
  and never claims to equal the GL beyond billing basis.

## 4. Requirements (EARS)

### Functional

- **FR-MMP-001** The system shall provide a monthly management pack at `/reports` for a chosen window of
  1–24 months ending at an as-at month.
- **FR-MMP-002** When the user does not choose an as-at month, the system shall use the current calendar
  month in the organisation's timezone (`organizations.default_timezone`), and the window shall start in
  January of that month's year.
- **FR-MMP-003** The system shall count a sales invoice as invoiced only when its status is Submitted,
  Unpaid or Paid, in the calendar month of its `invoice_date`, at its amount net of tax.
- **FR-MMP-004** The system shall include a project when it is won or on hand (Won, Pending KoM ·
  Ongoing Project · On Hold · Close Out) and not archived, or when it has a counted invoice in the window.
- **FR-MMP-005** The system shall compute, per project and month: planned, recognised, invoiced,
  recognised to date, invoiced to date, unbilled, backlog and the recognition basis, per DD-MMP-1..3.
- **FR-MMP-006** Where a project has a percent-complete entry dated on or before a month, the system shall
  recognise that month on progress basis; otherwise on billing basis.
- **FR-MMP-007** When an authorised user records a percent complete for a project and month, the system
  shall store one entry per project per month (re-recording replaces it), normalise the month to its
  first day, and stamp the recording user and time server-side.
- **FR-MMP-008** If a percent complete is outside 0–100, then the system shall refuse it with a message
  naming the allowed range.
- **FR-MMP-009** If a user who is neither Finance-rank-or-above nor the project's own PM records progress,
  then the system shall refuse it with a message naming who may.
- **FR-MMP-010** The system shall show invoices in a currency other than the contract's as a separate row
  for that project (invoiced only, flagged), and invoices with no project as an "Unassigned" row per
  currency.
- **FR-MMP-011** The system shall total each measure per currency and month, and shall never add figures
  of different currencies.
- **FR-MMP-012** When the user exports, the system shall produce CSV or XLSX with one row per project row
  and month, carrying a Currency column and a Tax basis column on every row, numbers as numbers.
- **FR-MMP-013** While the organisation's `revenue` module is enabled, the system shall show a
  "Management pack" navigation entry to Admin, Executive, PM and Finance, and the dashboard "Board pack"
  control shall open the pack for those roles; while it is disabled, `/reports` redirects to the
  dashboard and the dashboard control stays as today.
- **FR-MMP-014** If the start month is after the as-at month or more than 23 months before it, then the
  system shall refuse the request with a message naming the allowed window.
- **FR-MMP-015** The system shall report how many counted-status invoices have no invoice date and are
  therefore not counted.

### Observed (existing behaviour this builds beside, unchanged)

- **OBS-MMP-001** `/reports` renders a "Reporting arrives in a later release" placeholder and has no nav
  entry (DD-RPT-1).
- **OBS-MMP-002** "Revenue by Project" sums invoice `amount` gross of any tax and across currencies under
  the org currency label (`src/lib/db/revenue.ts` `getRevenueByProject`). Out of scope here; reported to
  the Director as a separate finding. The pack does not reuse that sum.

### Non-functional

- **NFR-MMP-001 (performance)** One RPC round trip per pack; the response is sparse facts
  (O(projects + invoice-months + progress entries)), never one row per invoice. Target p95 < 1 s for 500
  projects, 20,000 invoices, 24 months. Index `(org_id, invoice_date)` on `sales_invoices`.
- **NFR-MMP-002 (money exactness)** SQL sums in `numeric`; TypeScript works in integer cents, with
  proportional splits done in BigInt and rounded half-up; planned months sum exactly to the contract.
- **NFR-MMP-003 (tenancy/security)** Read RPC is SECURITY INVOKER (RLS is the boundary); no definer
  functions; new table has FORCE RLS, `is_active_member()` on every policy, the 0074 org stamp trigger,
  column-level grants, no anon access.
- **NFR-MMP-004 (reversibility)** Migration `0243` ships with
  `supabase/migrations/rollback/0243_management_pack_down.sql`.
- **NFR-MMP-005 (i18n)** Every new string has English and Indonesian catalogue entries; `/reports` joins
  the launch-scope route list (DD-I18N-9).
- **NFR-MMP-006 (honest states)** Loading shows skeletons; a failed load shows an error, never a 0.

## 5. Acceptance criteria (Given/When/Then)

Owning layer per ADR-0010 in brackets.

- **AC-MMP-001** [pgTAP] Given invoices for a project: one inclusive (amount 555,000, tax 55,000) and one
  exclusive (100,000, tax 11,000) dated in March, one Draft and one Cancelled in April, one Submitted in
  the prior December, one with no project in February, one in USD in June and one with no date, When
  Finance requests the pack for January–December, Then March invoiced is 600,000 for the project, April has
  nothing, the before-window total is 200,000, the Unassigned February row is 30,000, the USD June row is
  10,000 on its own currency key, and the undated count is 1.
- **AC-MMP-002** [pgTAP] Given an ongoing project with contract 1,110,000 inclusive of 110,000 tax, a Leads
  project, an archived Close Out project invoiced in the window and an archived ongoing project with no
  invoices, When Finance requests the pack, Then the ongoing project's net contract is 1,000,000, the
  archived invoiced project is present, and the other two are absent.
- **AC-MMP-003** [pgTAP] Given 2026-09-30 17:30 UTC, When the current month is computed for
  Asia/Jakarta and for UTC, Then it is 2026-10-01 and 2026-09-01; Given no window, Then the pack reports
  the org's timezone, an as-at month equal to the org's current month and a January start; Given a start
  after the as-at month or 25 months long, Then it is refused (22023) with the window message; Given 24
  months, Then it succeeds.
- **AC-MMP-004** [pgTAP] Given a member of another organisation, When they request the pack, Then they see
  none of this organisation's projects or invoices; Given a disabled member, Then the request is refused
  (42501); And anon cannot execute either RPC, and neither RPC is SECURITY DEFINER.
- **AC-MMP-005** [pgTAP] Given Finance records 40% for a project on 2026-03-17 and then 45% for March,
  Then exactly one March row holds 45.00 dated 2026-03-01, stamped with Finance's id; Given the project's
  own PM records April, Then it succeeds; Given another PM, an Engineer, a disabled Finance user or another
  organisation's Admin, Then each is refused (42501) with the "who may" message; Given 100.01%, Then it is
  refused (23514); Given a direct table insert by another PM, Then RLS refuses it; And clients hold no
  INSERT/UPDATE privilege on `entered_by` or UPDATE on `project_id`; And the pack returns the March entry
  with the recorder's name, plus the latest entry before the window but not older ones.
- **AC-MMP-006** [unit] Given a net contract of 1,200,000.00 from 2026-01-01 to 2026-04-30, Then planned is
  310,000 / 280,000 / 310,000 / 300,000 for January–April; Given 100.00 over 2026-01-30..2026-02-01, Then
  January 66.67 and February 33.33 (sum exact); Given no end date, Then planned is null ("No schedule").
- **AC-MMP-007** [unit] Given invoiced 100,000 before the window, 200,000 in January and 300,000 in March,
  and progress entries of 40% in February and 55% in April on a 1,200,000 contract, Then recognised to
  date is 300,000 (invoiced basis) / 480,000 / 480,000 / 660,000 and recognised per month is 200,000 /
  180,000 / 0 / 180,000; Given only an entry before the window (10%), Then January is progress basis at
  120,000 with 0 recognised in month; Given a drop from 40% to 30%, Then that month's recognised is
  negative.
- **AC-MMP-008** [unit] Given the AC-MMP-007 project, Then unbilled is 0 / 180,000 / −120,000 / 60,000.
- **AC-MMP-009** [unit] Given the AC-MMP-007 project, Then backlog is 900,000 / 720,000 / 720,000 /
  540,000; Given recognised to date above the contract, Then backlog is negative, not clamped.
- **AC-MMP-010** [unit] Given a project invoiced in IDR and USD and an Unassigned IDR invoice, Then there
  are three rows (contract, other-currency, unassigned), the other-currency and unassigned rows recognise
  on billing basis with no planned and no backlog, and totals are one IDR series and one USD series.
- **AC-MMP-011** [unit] Given a built pack, When exported, Then the table has one row per pack row per
  month plus a per-currency total row per month, with Currency and Tax basis ("excl. PPN") on every row and
  numeric money cells; the CSV quotes commas/quotes/newlines, starts with a BOM, uses CRLF, prefixes text
  cells beginning with `=`, `+`, `-`, `@` with `'`; and the file name carries the as-at month.
- **AC-MMP-012** [unit] Given each role, Then Admin, Executive, PM and Finance see the pack and Engineer
  sees the no-access message; "Record progress" shows for Finance, Executive and Admin on every project,
  for a PM only on projects they manage, and never for an Engineer.
- **AC-MMP-013** [unit] Given the pack is loading, Then no figures show; failed, Then the error message
  shows and no figure reads 0; refused for its window, Then the allowed-range message shows; no projects,
  Then the empty message shows.
- **AC-MMP-014** [unit] Given the Record progress dialog, Then it pre-fills the as-at month, shows the
  milestone delivery % as helper text when known, refuses −1, 101 and 33.333 with the range message, and
  on a valid save calls the writer with the month as `YYYY-MM-01` and closes.
- **AC-MMP-015** [unit] Given the `revenue` module on, Then Finance sees a "Management pack" rail link to
  `/reports`, Engineer does not, `/reports` resolves to the pack behind the `revenue` gate, and the
  dashboard "Board pack" button opens `/reports` for permitted roles; Given it off (or a role that cannot
  see the pack), Then the dashboard control is the existing disabled one.
- **AC-MMP-016** [e2e] Given a uniquely named ongoing project with a 1,000,000 net contract and a 250,000
  invoice this month, When Finance opens Management pack from the rail, picks this month, records 50%
  progress and exports CSV, Then the project row shows invoiced to date 250,000, recognised to date
  500,000 and unbilled 250,000, and the CSV row carries the org currency and 500000.
- **AC-MMP-017** [unit] Every new `managementPack.*` and `shell.nav.managementPack` key exists in the
  English and Indonesian catalogues, non-empty.

## 6. Out of scope

Editing invoices; cost, margin or cash in the pack; currency conversion; locking closed months; history
of overwritten progress entries (only the latest per month is kept, with who/when); fixing OBS-MMP-002;
PDF output; scheduled e-mailing of the pack.
