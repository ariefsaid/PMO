# The accountant's desk — month-end and year-end work in PMO over a hidden ledger — spec

- **Map:** #894 (month-end and year-end close). **Tickets it covers:** #895 manual journals, #896 bank book and
  reconciliation, #899 fixed assets, #900 year-end close, #2282 issued stock in project cost; reads on #1507 (Odoo
  statements), #2163 (no Odoo modules), #2196 (capitalised spending), #1494 (statements without an ERP).
- **Status:** Draft for owner sign-off (design only; no code, no migration in this change). **Revised 2026-11-15 to the
  owner's 17:40 rulings** (§2.3). The Odoo claims
  V-ACD1, 2, 4, 6, 10 were run on the Odoo 20 Community test bed on 2026-11-15 and are VERIFIED (§11); the ERPNext
  claims are still to verify.
- **IDs:** `FR-ACD-###`, `NFR-ACD-###`, `AC-ACD-###`; `OBS-ACD-###` observed; `V-ACD#` claims about Odoo or ERPNext
  marked **VERIFIED** (with the file in this repository that already exercises them) or **TO VERIFY ON A TEST BED**.
- **Owner questions:** Q1–Q13, listed in §12 (Q1 and Q8 answered).
- **ADR:** `docs/adr/NNNN-ledger-seam-for-the-accountants-desk.md` (number allocated at merge).
- **Test layers (ADR-0010):** **U** Vitest unit · **C** adapter contract suite (`pmo-portal/src/lib/adapterSeam/contractSuite/`,
  run per tier against `fakeOdoo.ts` / `fakeErp.ts`) · **P** pgTAP · **E** one curated Playwright journey · **B** private
  bed probe (`scripts/odoo-probe.mjs`, results in `docs/research/`), required before a slice that depends on a
  TO VERIFY claim is declared `supported`.

## 1. Job stories

- **Bookkeeper.** When money moves that is not an invoice or a bill (a bank fee, interest, a tax deposit, an accrual,
  a correction), I want to write the entry once in PMO and hand it to someone to approve, so the books are complete
  without anyone opening the ledger.
- **Accountant.** When the month ends, I want one place that tells me what is left before the month can be closed —
  unmatched bank lines, unsent or refused postings, depreciation not yet charged, tax not yet tied out — and lets me
  close it, so the month's figures stop moving and I can hand over statements I can defend.
- **Approver.** When an entry or a close is waiting on me, I want to see exactly what will post, in rupiah, to which
  accounts and period, and approve or return it, so no one person can move the books alone.
- **Director.** When the year ends, I want the year closed, locked and its statements fixed, so last year's numbers
  cannot change under the auditor.

## 2. The whole on one page

### 2.1 Who does what

| Person | PMO role (existing enum, `supabase/migrations/0001_*.sql:11`) | Does |
|---|---|---|
| Bookkeeper | Finance | drafts journals, imports bank statements, proposes matches, registers assets |
| Accountant | Finance (a different person from the bookkeeper) | reviews and approves journals, signs off reconciliations, runs depreciation, works the checklist, proposes the close |
| Approver | Finance or above by rank (`role_rank`, `0178_*.sql:638`), never the maker | approves journals and reversals |
| Director | Executive | approves the month close and the year close; the only person (with Admin) who may unlock |

No new role is proposed: "maker is not approver" is a rule about **persons**, enforced through the existing
rank function and an author-set check (`may_approve_work_of`, `0178_*.sql:707`, hardened by `0181_close_self_approval_money_sod.sql`).
Whether a separate Accountant role is wanted is owner question Q3; whether every journal needs a second approver is Q6.

### 2.2 The month-end calendar (month M, working days of M+1)

| When | Step | Who | Screen |
|---|---|---|---|
| Daily, during M | Purchases, bills, payments, invoices, receipts, stock, site cash post through the existing adapters | operations | existing screens |
| During M | Non-invoice entries drafted and approved | bookkeeper → approver | **Journals** |
| Day 1 | Import each bank's statement for M | bookkeeper | **Bank book** |
| Days 1–3 | Match statement lines to ledger lines; post fees and interest as journals from the unmatched lines | bookkeeper | **Reconciliation** → **Journals** |
| Day 3 | Run depreciation for M (one generated journal) | accountant → approver | **Assets** |
| Days 3–4 | Accruals and corrections | bookkeeper → approver | **Journals** |
| Day 4 | Tie out input and output VAT and withholding for M | accountant | **Tax registers** |
| Day 5 | Checklist all green; sign off each bank reconciliation; propose the close | accountant | **Month-end close** |
| Day 5 | Approve the close; M is closed in PMO (the ledger's own lock dates are read and shown, §4.2) | director | **Month-end close** |
| Day 5+ | Read Trial Balance, P&L, Balance Sheet for M with M−1 comparison | everyone with access | **Financial statements** (shipped) |
| Year end, after the last month is closed | FX revaluation, final adjustments, year close, year lock | accountant → director | **Year-end close** |

### 2.3 Product rulings this spec is built on (owner, 2026-11-15 17:40, binding)

1. **PMO is the only interface.** A client's people never work in the ERP ("I'd rather they dont touch ERP at all";
   "PMO exists as interface and bridge to the erp. Erp is used for source of truth. But pmo is the user interface").
   Every task in this spec has a PMO screen, with or without an ERP behind it. Where an ERP-side step by a person would
   seem needed, it is listed as a Gap (§9.1), never as an instruction.
2. **Bank reconciliation happens in PMO for every client** (#896).
3. **Statements are CSV**, with a column layout an Admin sets per bank account; a bank that gives only PDFs waits;
   rupiah accounts first. PMO suggests matches (same amount, value date within 3 days), a person confirms each one, and
   only an Admin marks bank accounts.
4. **Where the reconciled state lives.** For an ERP-connected client it lives **in the ERP**: PMO writes the confirmed
   match to the ERP and reads it back, and keeps **no competing reconciliation record**. For a client with no ERP,
   PMO's own record is the truth.

## 3. What exists today (observed at `origin/dev`, 2026-11-15)

- **OBS-ACD-001** Operational money already posts through the adapter seam and the money outbox
  (`external_command_outbox`, `supabase/migrations/0096_erpnext_seam_tables.sql:47`; `dispatchMoneyWrite`,
  `pmo-portal/src/lib/adapterSeam/dispatch.ts:664`). One PMO record mints at most one ledger document
  (`docs/money-path-primer.md`, "The one-paragraph model").
- **OBS-ACD-002** On Odoo, `account.move` is created and posted with `action_post`
  (`pmo-portal/src/lib/adapterSeam/odoo/revenueAdapter.ts:72`, `odoo/procurementAdapter.ts:363`), and ledger lines are
  matched with `account.move.line/reconcile` (`revenueAdapter.ts:188`, `procurementAdapter.ts:459`). Created records
  are anchored with a stock external identifier (`ir.model.data`, module `pmo`); a probe that finds nothing cannot
  prove absence, so the outbox **holds** rather than reissues (`odoo/assets/adapter.ts:5-8`).
- **OBS-ACD-003** On ERPNext, PMO already posts and cancels `Journal Entry` documents for expense and imprest postings,
  anchored on `user_remark`, immutable after submit, so a conclusive probe miss may reissue
  (`erpnext/doctypeRegistry.ts:174-179`; cancel verb `erpnext/expensePostingCommand.ts:163-166`). The journal poll
  admits only PMO keys; ERPNext-native journals such as depreciation are not listed (`erpnext/feedKinds.ts:198`).
- **OBS-ACD-004** No PMO screen or table records a manual journal, a bank statement, a fixed asset, a period status or
  a tax register. The only "journal" features read ERP journal lines onto a project (`0687_erp_journal_cost_lines.sql:11`)
  and capture historical journal purchases without writing to the ledger (`0858_record_only_journal.sql:1`).
- **OBS-ACD-005** The Odoo ledger is mirrored line by line from `account.move.line` (`odoo/ledger/feed.ts:17-20`), checked
  per sweep against Odoo's own grouped totals (`supabase/functions/_shared/odooLedgerFeed.ts:156-159`,
  `odoo/ledger/ledgerReconcile.ts:23`), and its Trial Balance, P&L, Balance Sheet and project P&L are computed in SQL
  from the mirror (`0746_odoo_statements.sql:1-11`), with health read by `0764_odoo_ledger_health.sql` and the basis
  switch by `0765_odoo_ledger_basis.sql`. The Balance Sheet has **no closing logic**: it adds two derived equity rows
  (current-year and previous-years earnings) (`0746_odoo_statements.sql:5-6`).
- **OBS-ACD-006** The fiscal year end is read from `res.company` (`fiscalyear_last_month`, a string, and
  `fiscalyear_last_day`) (`_shared/odooLedgerFeed.ts:89-99`) and persisted on the binding (`0746_odoo_statements.sql:8-10`).
- **OBS-ACD-007** Odoo workflow declarations say what each tier supports (`odoo/workflowDeclarations.ts:23-57`).
  Of note for this desk: `imprest.transfer` (site cash) is still **pending** on Odoo (`:54`), and
  `tax-document.read` is **unavailable** (`:21`, `:48`). "Site cash already posts" is true for ERPNext, not yet for Odoo.
- **OBS-ACD-008** Domain ownership is one function, `domain_externally_owned(org, domain)`
  (`0087_external_domain_ownership.sql:48`); Accounting (GL) is ERP-owned when an ERP is connected and PMO-owned when
  none is (ADR-0055 §5 table row 1, `docs/adr/0055-external-system-adapters-sot-enhancement.md:86`; OD-VISION-ERP,
  `docs/decisions.md:3692`).
- **OBS-ACD-009** Stock: PMO's own stock sub-ledger is append-only with one writer (ADR-0097 §1); the Odoo stock-issue
  slice (#1508, `docs/specs/odoo-stock-posting.spec.md`) is owner-approved and scheduled after 0.40. Material issued
  through Odoo does not yet reach PMO project cost because Odoo records it as an analytic line without a journal item
  and the ledger feed reads journal items only (#2282).
- **OBS-ACD-010** Exchange rates: org-scoped JISDOR history in `fx_rates` (`0291_fx_rates_jisdor.sql`), used for
  labelled display equivalents only, never accounting conversion (DD-FX-1, `docs/decisions.md:2308`).
- **OBS-ACD-011** Owner rulings in force: no third-party Odoo modules (#2163, 2026-11-15); no Odoo customisation, Community
  baseline (ADR-0094); amortised cost of capitalised spending parked (#2196, 2026-11-12); capital spending is its own
  kind, not overhead (#2196 comment, 2026-11-12).

## 4. The ledger seam

### 4.1 The contract

The desk talks to one interface, `LedgerPort`, implemented per tier. It has **six operations**. The desk's own state —
bank statement files, the asset register, depreciation schedules, tax registers, the checklist — is PMO state and
reaches the ledger only through operation 1. The one exception is the **bank match**: on an ERP tier it is ledger
state and travels through operation 5 (§6.4).

| # | Operation | Input | Result |
|---|---|---|---|
| 1 | `postJournal` | idempotency key, date, ledger currency, lines (account, debit, credit, optional partner, analytic/project, optional document currency amount and rate), memo, maker id, approver id | posted ledger reference, or `refused(reason)`, or `unknown` (held) |
| 2 | `reverseJournal` | idempotency key, original ledger reference, reversal date, maker, approver | posted reversal reference, or `refused`, or `unknown` |
| 3 | `readLines` / `readBalances` | company, account set, period (from–to dates) | ledger lines, or per-account opening, debit, credit, closing |
| 4 | `readLock` / `setLock` (`setLock` optional) | company; for set, the new lock date and the lock kind | the ledger's current lock date(s) |
| 5 | `matchBankLine` / `readBankMatch` / `unmatchBankLine` (ERP tiers only; the PMO-native ledger keeps the match as its own record) | bank account, one statement line, the ledger lines it matches (net to zero), idempotency key | matched and read back, or `refused(reason)`, or `unknown` (held); read returns the ERP's own matched state |
| 6 | `capabilities` | — | which of 1–5 this tier supports, as `odoo/workflowDeclarations.ts` already does (`supported` / `pending` / `unavailable` + reason) |

Registering an asset, posting depreciation and closing a year are **not** ledger operations: the register and
schedule are PMO state on every tier where the ledger has none, depreciation is a `postJournal`, and the year close
is a `postJournal` (where the tier's convention needs one) followed by `setLock` where the tier has it.

After every `postJournal` and `reverseJournal` the adapter reads the document back and compares its date, reference
and line sums to what was sent (FR-ACD-027). A difference is never `posted`.

New workflow declarations, added to each tier's table: `journal.post`, `journal.reverse`, `ledger.read-period`,
`period.lock`, `bank.reconcile-match`. On Odoo `period.lock` (write) is `pending`; `bank.reconcile-match` is `pending` on
ERPNext and Odoo until its bed probe records "verified" (V-ACD7, V-ACD11).
A desk action whose workflow is not `supported` for the org's tier is refused before any write with the declared reason.

### 4.2 Per operation, per ledger

| Op | Odoo Community 20 (stock API, JSON-2, no modules) | ERPNext | Future PMO-native ledger |
|---|---|---|---|
| `postJournal` | `account.move` `create` with `move_type = 'entry'` and balanced `line_ids` command tuples (account, debit, credit, optional partner, optional `analytic_distribution` `{"<analytic account id>": 100}`), then `action_post` (`revenueAdapter.ts:72`, `procurementAdapter.ts:363`; V-ODA11, `docs/research/2026-10-31-odoo20-dev-bed-verification.md:227`). **VERIFIED (V-ACD1, `supabase/functions/_shared/odooAccountantsDeskFacts.bed.test.ts`):** any journal type accepts an entry; PMO picks **one general journal per company at setup** and always sends the journal and the date. An unbalanced or one-line entry is refused **at create** (422, nothing created); a line with no account is refused at create; an archived account is refused at post; an entry with no lines is refused at post. Each distributed line makes one analytic line on post. **`ref` is not an anchor** (the same `ref` twice makes two posted moves); the anchor is the `ir.model.data` external id written after the move exists (a second create with the same id is refused), as OBS-ACD-002; hold on doubt. After post, read the move back and compare date, `ref` and line sums to what was sent (FR-ACD-027). | `Journal Entry` create + submit with `accounts` rows; anchor `user_remark`. **VERIFIED** (`erpnext/doctypeRegistry.ts:177`). | Insert into an append-only `ledger_entries` / `ledger_lines` pair through one definer writer, as `stock_write_entry` (ADR-0097 §1). |
| `reverseJournal` | `account.move.reversal` `create` + `refund_moves` on the posted `entry`; the answer's `res_id` is the reversal, which carries `reversed_entry_id`, and the original lists it in `reversal_move_ids`. **VERIFIED** for invoices (`scripts/odoo-probe.mjs:708-712`, V-ODA8 at `…bed-verification.md:224`; `_shared/odooRevenueFeed.bed.test.ts:97-101`) and for `entry` moves (V-ACD2, bed test above): lines mirrored, analytics carried, the reason lands in `ref`; a draft original is refused. **Odoo gives no idempotency:** a second run makes a second posted reversal (a reversal of a reversal is also accepted). So PMO reads the original's `reversal_move_ids` first and adopts or refuses, always sends the date (the default is today), and writes the external id on the returned move (FR-ACD-028). A date after today leaves the reversal `draft` (auto-post at that date): shown **Scheduled**, never Posted. | Cancel of the submitted entry is **VERIFIED** (`expensePostingCommand.ts:163-166`). A dated reverse entry (a new Journal Entry with swapped sides) is **TO VERIFY (V-ACD3)** as a native action; PMO can always post it as a new `postJournal`. | A new entry with swapped sides linked to the original; the original is never edited. |
| `readLines` / `readBalances` | `account.move.line` `search_read` with the 15 fields of `odoo/ledger/feed.ts:17-20` and `formatted_read_group` by account (× month) (`_shared/odooLedgerFeed.ts:159`). **VERIFIED** (V-ODA1, V-ODA5). The desk reads the **mirror**, not Odoo, for screens; Odoo is read for the oracle check. | GL mirror (`erpnext/ledgerMirrorFeed.ts`) and saved standard reports (`erpnext/statementReports.ts`). **VERIFIED.** | Direct SQL over `ledger_lines`. |
| `readLock` / `setLock` | `res.company` fields `fiscalyear_lock_date`, `tax_lock_date`, `sale_lock_date`, `purchase_lock_date`, `hard_lock_date` read `false` when unset; `period_lock_date` does not exist. Read **VERIFIED** (V-ODA4, `…bed-verification.md:220`; `scripts/odoo-probe.mjs:578`). **Default: PMO reads the lock dates and shows them; it does not write them.** **VERIFIED (V-ACD4, bed test above):** writing is possible but needs a stronger user than the ledger reader: `tax_lock_date` needs Access Rights; `fiscalyear_lock_date` needs Access Rights **plus an accounting group**; accounting groups alone cannot write the company. Writing is therefore an optional setup step, and `period.lock` write is declared `pending` on Odoo; PMO's own month status closes the month either way. A lock can be moved back or cleared. **Odoo does not refuse a post dated inside a lock; it posts it on a later date of its own choosing** (entries, invoices, reversals and taxed invoices under a tax lock were all re-dated, by an accounting user as well). It does refuse reset-to-draft, amount changes, cancel and delete of an entry posted inside the lock. PMO's own period lock is therefore the only guard before the write, and the read-back (FR-ACD-027) catches anything else, including a lock someone sets in the ledger. `hard_lock_date` is irreversible by design in Odoo and **PMO never writes it** (read as `false` on the bed; kept as a rule). | `Accounting Period` with closed document types, and `Accounts Settings` frozen-until date. **TO VERIFY (V-ACD5)** — not used anywhere in this repository. | `ledger_periods.status`; the writer refuses a post dated in a locked period. |
| `matchBankLine` / `readBankMatch` / `unmatchBankLine` | **Core `account` module only (#2163).** Write one match: `account.bank.statement.line` `create` with `journal_id`, `date`, `amount`, `payment_ref` (carrying PMO's statement-line id, the lookup after a lost answer) and `counterpart_account_id` = the account of the ledger line being matched (for a payment, its outstanding account); Odoo posts the line; then `account.move.line` `reconcile` on the new counterpart line and the matched line(s). Read back: the statement line's `is_reconciled` and `amount_residual`, and each matched line's `reconciled` and `amount_residual`; matched only when `is_reconciled` is true and every residual is 0. Undo: `remove_move_reconcile` on the matched lines, then the statement line's undo. **A payment lands on the account of its payment method line** — with Odoo's default set-up Outstanding Receipts or Outstanding Payments (**VERIFIED**, V-ACD6a, bed test above). That standard flow **stays**: the match write is what moves the money from the outstanding account to the bank, so PMO changes no payment method line. **VERIFIED (V-ACD6b):** a statement line made by API needs an accounting group the ledger reader lacks, and moves the bank balance when it is created; so the match write needs a stronger integration user (Gap GAP-ACD-3) and is **TO VERIFY (V-ACD11)** end to end (`counterpart_account_id` accepted through the external API, reconcile accepted, undo behaviour with and without the company audit trail). A fee or interest line is one `create` with `counterpart_account_id` = the fee account and no reconcile; it is a ledger posting, so it is sent only after the approved journal of FR-ACD-053, and that journal is not also posted as an entry (it would book the fee twice). | **Bank Transaction** `create` + submit with `payment_entries` rows: `payment_document`, `payment_entry`, `allocated_amount = 0`, `reconciliation_type = 'Matched'`; `transaction_id` = PMO's statement-line id (the anchor: look it up before any retry). On submit ERPNext allocates each voucher's bank amount and sets `clearance_date` on the voucher; no GL Entry is created. Read back: Bank Transaction `status = 'Reconciled'`, `unallocated_amount = 0`, every voucher's `clearance_date` set. Undo one voucher: `unreconcile_transaction_entry`, written only for `'Matched'` rows (a `'Voucher Created'` row would cancel the voucher, so PMO never writes that type). Needs an ERPNext `Bank Account` record linked to the GL account (Gap GAP-ACD-1). **TO VERIFY (V-ACD7).** | A match row in PMO (`bank_matches`) — the truth, there being no ERP. |
| Asset + depreciation | **Nothing.** Community has no depreciation (#2163, #1484). PMO holds the register and schedule and posts each month's charge through `postJournal`. | `Asset` with a native depreciation schedule that posts its own Journal Entries (implied by `feedKinds.ts:198`). **TO VERIFY (V-ACD8).** Default: PMO holds the register on ERPNext too (one design), see FR-ACD-040. | PMO register + `postJournal`. |
| Year close | No company-level year-end creator; a manual closing to an `equity_unaffected` account posts as an ordinary entry (V-ODA11, **VERIFIED**). Odoo's convention is no closing entry: earnings are derived up to the year end, which is what 0746 already does (OBS-ACD-005). | `Period Closing Voucher`. **TO VERIFY (V-ACD9).** | Closing entry into retained earnings, then lock. |

### 4.3 Requirements

- **FR-ACD-001** The system shall reach a ledger from the desk only through `LedgerPort`; no desk screen, RPC or edge
  function shall call an Odoo model or an ERPNext doctype outside `pmo-portal/src/lib/adapterSeam/<tier>/**`.
- **FR-ACD-002** The system shall declare each `LedgerPort` workflow per tier with `supported`, `pending` or
  `unavailable` and a reason, and shall refuse a desk action whose workflow is not `supported` before any write.
- **FR-ACD-003** Where a claim in §4.2 is TO VERIFY, the matching workflow shall stay `pending` until a bed probe
  records the verdict in `docs/research/`.
- **FR-ACD-004** The shared contract suite shall run the same `journal.*`, `ledger.read-period`, `period.lock` and
  `bank.reconcile-match` cases against every tier's adapter and the fake of that tier.
- **FR-ACD-005** The system shall give every desk task a PMO screen, with or without an ERP behind it; no desk task shall
  need a person to open the ERP, and a step that would is recorded as a Gap (§9.1).
- **FR-ACD-006** Where an ERP owns the ledger, the system shall write each desk state the ERP can hold (a posted journal,
  a bank match) to the ERP, show it only after reading it back, and keep no second record of it that a person can
  edit. Where no ERP owns the ledger, PMO's own record is the truth.

### 4.4 Risks on Odoo (verified on the test bed, 2026-11-15)

Each is a property of Odoo Community 20 that the design works around; the bed test is
`supabase/functions/_shared/odooAccountantsDeskFacts.bed.test.ts`.

- **Silent re-dating.** A post dated inside Odoo's lock is accepted and booked on another date. Guard: PMO's own period
  lock before the write (FR-ACD-073) and a read-back after it (FR-ACD-027). The same read-back applies to the shipped
  invoice, bill and payment paths on Odoo; that work is tracked separately (see the issue on the map).
- **No idempotency on reversal, none on `ref`.** A repeated reversal or a repeated create with the same `ref` makes a
  second posted move. Guard: read the original's reversal links first; anchor on the external id, never on `ref`.
- **A posted entry can be deleted through the API** (reset to draft, then delete) when no lock covers its date. PMO
  never deletes or edits a posted ledger entry (FR-ACD-024); the lock date, and PMO's own month close, are the only
  things that stop anyone else.
- **Payments land on outstanding accounts** with Odoo's default set-up, so the ledger's bank balance lags until the
  match is written. That is Odoo's standard flow and stays; PMO's match write (FR-ACD-055) moves the money to the bank,
  and the bank book shows the outstanding accounts as the unmatched ledger side until then (FR-ACD-054).
- **Withholding left on default repartition** posts on the expense account of the base line, which has no tax account to
  tie to. Guard: the connect step's check (FR-ACD-064).

## 5. Where state lives

| Thing | Lives in | Notes |
|---|---|---|
| Journal draft, its lines, maker, editors, approval, return reason | **PMO** (`journal_entries`, `journal_entry_lines`) | the record of the decision; immutable once approved |
| Posted entry | **Ledger** | PMO keeps the ledger reference and a mirror of its lines; never a second copy that it calls posted |
| Bank accounts (which ledger journal and account is which bank) and each account's CSV column map | **PMO** (`bank_accounts`), set by an Admin | configuration over the ledger's account list, not ledger state |
| Bank statement imports and statement lines | **PMO** (`bank_statement_imports`, `bank_statement_lines`) | the document PMO received, not a reconciliation record; Community has no import (#2163) |
| **Which statement line matches which ledger line** | **No ERP: PMO** (`bank_matches`, `bank_match_items`) — the truth. **ERP connected: the ERP** (§4.2). | for an ERP client PMO holds an in-flight outbox command and a read-only mirror of the read-back (`erp_bank_match_mirror`), never edited by a person (FR-ACD-013) |
| Each month's bank sign-off | **PMO** (`bank_reconciliations`) | an attestation: who signed and the figures read from the ledger at that moment; it never decides whether a line is matched (Q12, GAP-ACD-4) |
| Fixed-asset register and depreciation schedule | **PMO** (`fixed_assets`, `asset_depreciation_lines`) | each charged line points at the journal that posted it |
| Period status and month-end checklist | **PMO** (`accounting_periods`, `close_checklist_items`) | the ledger's lock dates are read and shown beside it; written only where the optional setup is done |
| Tax register tie-out and its sign-off | **PMO** (`tax_register_signoffs`); the figures come from the ledger mirror | |
| Account balances, trial balance, statements | **Ledger** (read through the mirror, oracle-checked) | PMO computes Odoo statements from mirrored lines (0746), never from PMO documents |

- **FR-ACD-010 (an entry exists once)** The system shall give every PMO-originated ledger entry exactly one PMO
  record and one outbox key (`journal:<record id>`); the ledger mirror shall recognise PMO-originated moves by their
  anchor, and every desk list shall show such a move once, as the PMO record, not again as a ledger line — the same
  exclusion `0687_erp_journal_cost_lines.sql:21-24,38` applies to PMO-posted expense journals.
- **FR-ACD-011** When the mirror reads a posted entry that PMO did not originate (someone posted in the ledger
  directly), the system shall show it on the Journals screen as "posted outside PMO", read-only, counted in balances,
  and listed on the month-end checklist for the accountant to acknowledge.
- **FR-ACD-012** The system shall not store a ledger balance as authoritative; a balance on any desk screen is read
  from the mirror and states the mirror's freshness and its last oracle check (`0764_odoo_ledger_health.sql`).
- **FR-ACD-013 (no competing record)** Where an ERP owns the ledger, the system shall not store a bank match that a
  person can edit: `bank_matches` rows shall exist only for an organization with no ERP ledger, enforced in the
  database and proved by pgTAP; for an ERP organization the confirm queues an ERP write instead.

## 6. The pieces, in dependency order

Each piece ships alone, behind its own workflow declaration, with the three reviews (money tier, ADR-0019).
Dependency: 1 is the foundation; 3, 4, 6, 7 need 1; 7 needs 6; 2, 5, 8 are read-side and need none.

| # | Piece | Tickets | Needs | After it ships the accountant can… |
|---|---|---|---|---|
| 1 | Manual journals | #895 | — | record and post any non-invoice entry with maker and approver; reverse one |
| 2 | Issued stock in project cost | #2282 | #1508 | see material issued through Odoo in project actuals once, and on the work item |
| 3 | Fixed assets and depreciation | #899 | 1 (#2196 for project amortisation) | keep the register and post each month's depreciation as one approved journal |
| 4 | Bank book, statement import, reconciliation | #896 | 1 | import each bank's CSV statement, confirm matches and sign off a month, with no one opening the ERP |
| 5 | Tax registers | (new) | — | tie input and output VAT and withholding for a month to the ledger |
| 6 | Period lock and month-end checklist | (new, from #894/#900) | 1 | close a month: PMO then refuses anything dated in it, and shows the ledger's own lock dates beside it |
| 7 | Year-end close | #900 | 1, 6 | revalue foreign balances, close and lock the year |
| 8 | Statements on Odoo (finish) | #1507, #1494 | 6, 7 | read statements that know which periods are closed, drill into lines, export the auditor's pack |

### 6.1 Manual journals (#895)

- **FR-ACD-020** A Finance-or-above member shall create a draft journal with a date, a memo, a kind (`fee`, `interest`,
  `tax-deposit`, `accrual`, `reclassification`, `correction`, `funding`, `depreciation`, `revaluation`, `closing`) and
  two or more lines, each with an account from the mirrored chart, a debit or a credit, and optionally a partner and a
  project.
- **FR-ACD-021** The system shall refuse to submit a draft whose lines do not balance in the ledger currency to the
  smallest unit, whose date falls in a month PMO has closed or is closing (FR-ACD-073), or which names an account the
  ledger has archived.
- **FR-ACD-022** When a submitted journal is approved, the system shall send it through the money outbox with the
  key `journal:<id>` and show it as **Sending** until the ledger answers; it shall show **Posted** only after the
  ledger reference is read back and passes the read-back check (FR-ACD-027).
- **FR-ACD-023** When an approver returns a journal, the system shall record the reason and return it to the maker as a
  draft; any edit after return makes the editor part of the author set.
- **FR-ACD-024** The system shall never edit or delete a posted journal in the ledger; a correction shall be a reversal
  (FR-ACD-025) and, if needed, a new journal.
- **FR-ACD-025** A Finance-or-above member shall request the reversal of a posted journal with a date and reason; the
  reversal is itself a journal with its own maker and approver, posted through `reverseJournal` where `supported`,
  else as a swapped-sides `postJournal` linked to the original. The date is always sent (FR-ACD-028).
- **FR-ACD-026** Where a line names a project, the system shall send the project's ledger analytic so the line reaches
  project actuals through the existing feed (`0687`, `0746`), and shall not count it again from the PMO record.
- **FR-ACD-027 (read-back)** When the ledger answers a post or a reversal, the system shall read the document back and
  compare its date, reference and line sums to what was sent. If any differs, the system shall hold the command as
  **Needs a check** with the plain reason "posted in the ledger on <date>, not <date>" (or the differing field), and
  shall never show it as Posted on the requested date. The same rule applies to the shipped invoice, bill and payment
  paths on Odoo (tracked separately; see the issue on the map).
- **FR-ACD-028 (reversal on Odoo)** Before reversing, the system shall read the original's reversal links: if a
  reversal already exists it shall adopt it when the key matches or refuse with the reason, and shall not send a
  second. It shall always send the reversal date, write the external id on the move the ledger returns, and show a
  reversal dated after today as **Scheduled**, not Posted, until the read-back finds it posted.
- **FR-ACD-029 (journal choice and anchor)** At setup, PMO shall record one general journal per company as the journal
  for desk entries. The anchor of a ledger entry is its external id, never its reference; the system shall treat an
  unbalanced entry's refusal at create as `refused` with nothing created.

### 6.2 Issued stock in project cost (#2282)

- **FR-ACD-030** When an Odoo stock issue to a project is posted (#1508), the system shall attribute its value to the
  project and work item once, from a single source chosen by the #2282 ruling, and the whole-ledger check shall show
  that the project total equals the ledger's analytic total for the project.
- **FR-ACD-031** The desk does not post a journal for issued stock; Odoo's native valuation is the only posting
  (Director decision in `docs/specs/odoo-stock-posting.spec.md`, "native path only").

### 6.3 Fixed assets and depreciation (#899)

- **FR-ACD-040** A Finance-or-above member shall register an asset from a posted bill line or a journal line on an
  asset account, with cost, in-service date, useful life in months, residual value and the expense and
  accumulated-depreciation accounts; the register shall be PMO state on every tier (one design; V-ACD8 may later let
  ERPNext keep its own).
- **FR-ACD-041** The system shall compute a straight-line schedule per asset in whole rupiah per month, the last month
  absorbing the remainder so the schedule sums to cost minus residual exactly (method and first month: owner question Q7).
- **FR-ACD-042** When the accountant runs depreciation for an open month, the system shall create **one** draft journal
  of kind `depreciation` with one line pair per expense account (and project, where set), mark the month's schedule
  lines as in that journal, and refuse a second run for the same month while the first is not reversed.
- **FR-ACD-043** Disposal of an asset shall be a journal (cost out, accumulated depreciation out, gain or loss) with
  maker and approver; the schedule stops at the disposal month.
- **FR-ACD-044** While #2196 is open, the system shall not attribute depreciation of an internally built asset to a
  delivery project's budget or margin; a project on a depreciation line is allowed only when the asset names it.

### 6.4 Bank book, statement import, reconciliation (#896)

The bank book is a PMO screen for **every** client (§2.3). What differs is only where a confirmed match is kept: with an
ERP it is written to the ERP and read back (FR-ACD-055); with no ERP it is PMO's own record (FR-ACD-058). Statement
files and lines are PMO's input on every tier; they are not a reconciliation record. PMO writes nothing to an ERP
before a person confirms a match, and no unmatched statement line is written to it (GAP-ACD-5).

- **FR-ACD-050** An Admin shall mark which ledger bank accounts are bank accounts, each with its currency and the CSV
  column layout of its statement (at least the date and an amount); no other role may mark or edit them. Rupiah
  accounts only in the first release (FR-ACD-056). The system shall not change any ledger payment setting.
- **FR-ACD-051** A Finance-or-above member shall import a bank statement as CSV, read with that account's column layout,
  for one bank account and date range; the system shall refuse an import whose opening balance does not equal the
  previous import's closing balance, or that overlaps a signed-off month. A bank that provides only a PDF waits
  (Q8, answered).
- **FR-ACD-052** The system shall propose matches between statement lines and the bank account's ledger lines where the
  amount is the same and the value dates are within 3 days, and shall never confirm one; a person confirms each match;
  one statement line may match several ledger lines and the reverse, and a match must net to zero exactly.
- **FR-ACD-053** From an unmatched statement line, a member shall start a prefilled draft journal (fee: Dr fee account /
  Cr bank; interest: the reverse) that goes through the ordinary maker-and-approver rule (§7). When it is approved:
  on ERPNext and for a client with no ERP it posts as a journal and its bank-account line is matched to the statement
  line; on Odoo the approved journal is sent as the one statement-line create of §4.2 (fee account as counterpart), not
  also as an entry, so the fee is booked once.
- **FR-ACD-054** The bank book shall show, per account and month: statement closing balance, the bank account's ledger
  balance at the same date, matched and unmatched items each side, and the difference, which must be explained by
  unmatched items to the unit before sign-off; for an Odoo client the journal's outstanding accounts are the unmatched
  ledger side until the match is written. A Finance-or-above member other than the importer shall sign the month off;
  for an ERP client the sign-off is an attestation row holding the figures read back from the ledger (§5), and a later
  change to any figure shows **Changed since sign-off**.
- **FR-ACD-055** Where the organization's ledger is owned by an ERP, when a person confirms a bank match, the system
  shall write the match to that ERP through operation 5 and show it as matched only after reading it back; until then it
  shall show **Sending**, and after a lost or doubtful answer **Needs a check**, never matched. The system shall not
  store a second reconciliation record for an ERP-owned ledger (FR-ACD-013). A person may undo a match; the undo is the
  same write and read-back.
- **FR-ACD-056** The first release handles rupiah bank accounts only; a foreign-currency account waits (Q11). When it
  ships, its book shall show its own currency, the rupiah figure beside it shall be the ledger's rupiah balance, and a
  display equivalent (DD-FX-1) shall be labelled with its rate and date.
- **FR-ACD-057** *Withdrawn (owner ruling 2026-11-15; ERP source of truth).* It enabled the Odoo bank book through a
  payment-account change on every payment method line plus a one-off reclassification journal. That step was only
  planned, never shipped (dev's Odoo adapter posts a payment through the journal's existing outbound method line,
  `odoo/procurementAdapter.ts:441`), and under ruling 4 Odoo's standard outstanding-account flow stays. The id is kept so
  it is not reused.
- **FR-ACD-058** Where no ERP owns the ledger, when a person confirms a match that nets to zero, the system shall store
  it as the organization's record and the bank book shall count those lines matched; ledger movements come from PMO's own
  money rows.
- **FR-ACD-059** The system shall refuse, before any write, a match for an ERP client whose workflow
  `bank.reconcile-match` is not `supported` for its tier, with the declared reason, and shall refuse a match whose
  statement line or ledger line is already in a live match or an in-flight command.

### 6.5 Tax registers

- **FR-ACD-060** The system shall list, per month, output VAT, input VAT and each withholding kind from the ledger
  mirror's tax lines, with the source document, partner, base and tax amount, and the total per tax account. The
  tie-out to the account balance shall show **"tax lines"** plus **"other entries on the account"** (for example the
  desk's own `tax-deposit` journals) to reach the account balance; it never claims the two are the same.
- **FR-ACD-061** On Odoo the register reads the tax lines of `account.move.line` where `tax_line_id` is set (V-ACD10,
  verified): the tax is `tax_line_id`, the base is `tax_base_amount` (the line base as booked, in the sign of the base
  line, not the tax-inclusive document figure), the tax amount is `balance`, with `move_id`, `partner_id`, `date` and
  `account_id` on the same line, so no join is needed; totals group by `tax_line_id`. The chart carries no tax tags, so
  no register reads from tags. These fields are not in the mirror today (`odoo/ledger/feed.ts:17-20`); the tax-register
  slice adds them. Where a tier cannot read a base, the register shows the tax amount and "base not available", never
  a computed base.
- **FR-ACD-062** The accountant shall sign off a month's register; sign-off records the totals at that moment and a
  later change to that month's tax lines shows the register as **Changed since sign-off**.
- **FR-ACD-063** Filing (e-Faktur upload, SPT returns, Coretax) stays outside PMO (§9).
- **FR-ACD-064 (withholding on a tax account)** Withholding is a register only when the client's withholding tax posts
  to its own account. The connect step shall check each withholding tax in use: its tax repartition lines must name an
  account. Otherwise it shall say "withholding is not on a tax account" and offer no register for it, because a tax
  line left on the base line's expense account shares that account with every other expense and has nothing to tie to (owner question Q9).
- **FR-ACD-065 (customer-side withholding)** Withholding a customer keeps from a receipt (booked as a write-off on the
  receipt) is a plain line on a prepaid-tax account, not a tax line. The system shall list it separately, by account
  and the line's label, with no base and no tie-out claim.

### 6.6 Period lock and month-end checklist

- **FR-ACD-070** Every month of the fiscal year (fiscal year from the binding, OBS-ACD-006) shall have a status:
  `open`, `closing` (close proposed), `closed`. Status is PMO state and is the lock that counts; the ledger's own lock
  dates are read and shown beside it, and written only where the optional setup is done (Odoo: `period.lock` is `pending`).
- **FR-ACD-071** The checklist for a month shall be computed, not ticked: no draft or submitted journal dated in the
  month; no outbox row for the org dated in the month that is not confirmed; every bank account signed off; depreciation
  run; tax registers signed off; ledger mirror caught up and its last oracle check matching; no unacknowledged
  "posted outside PMO" entry. One manual item, "adjustments reviewed", is a person's tick.
- **FR-ACD-072** When every item is green, the accountant shall propose the close; a different person of rank
  Executive or Admin shall approve it. On approval the system shall set the month `closed` and, where `period.lock`
  is `supported`, call `setLock` with the month's last day as `fiscalyear_lock_date` (Odoo) or the tier equivalent. On
  Odoo by default nothing is written to the ledger and PMO's lock alone closes the month.
- **FR-ACD-073** While a month is `closing` or `closed`, the system shall refuse any PMO write that would post a ledger
  document dated in it — journals, bills, invoices, payments, receipts, stock, site cash — before the outbox, with the
  message "This date is in a closed month (MMMM YYYY). Use a date in an open month or ask for the month to be reopened."
  This is the only guard before the write: Odoo does not refuse a post inside its own lock, it re-dates it (§4.4).
- **FR-ACD-074** An Executive or Admin, not the person asking, shall reopen a closed month with a reason; reopening
  moves the ledger lock back where PMO wrote it (V-ACD4, a lock can be moved back) and is logged. A month in a closed year cannot be reopened.
- **FR-ACD-075** Months close in order; a month cannot close while an earlier month is open (the first month PMO closes: owner question Q10).
- **FR-ACD-076** The system shall show the ledger's lock dates beside each month's status, and when a ledger lock is
  later than PMO's last closed month, shall show "The ledger is locked past the last month closed in PMO: posts dated
  in between will be booked on another date".

### 6.7 Year-end close (#900)

- **FR-ACD-080** After the last month of the fiscal year is `closed` (or `closing` with only year-end items open), the
  accountant shall prepare the year close: FX revaluation proposals for foreign-currency bank and receivable/payable
  balances, final adjustments, and — on tiers whose convention needs it (ERPNext, PMO-native) — a closing journal to
  retained earnings. On Odoo no closing journal is posted by default (§4.2; owner question Q2).
- **FR-ACD-081** A revaluation proposal shall state per balance the currency amount, the rate used and its source and
  date, the new rupiah value, the ledger's rupiah value and the difference posted to the FX gain/loss account; the rate
  source is owner question Q5.
- **FR-ACD-082** A director shall approve the year close; on approval the system shall set the year `closed` (no month
  in it can reopen) and, where `period.lock` is `supported`, set the ledger lock to the year end.

### 6.8 Statements on Odoo (finish #1507; #1494)

- **FR-ACD-090** The shipped statements (`0746`) shall show each period's status (open, closed) beside the figure;
  a figure for an open period is labelled **Provisional**.
- **FR-ACD-091** A Trial Balance row shall open the ledger lines behind it (from `get_odoo_ledger_lines`,
  `0764_odoo_ledger_health.sql`), each linking to its PMO record where PMO originated it.
- **FR-ACD-092** For a closed year the system shall export an auditor's pack: Trial Balance, P&L, Balance Sheet,
  general ledger by account, journal list with makers and approvers, bank reconciliations, asset register and
  schedule, tax register sign-offs — as files, generated from the same reads.
- **FR-ACD-093** Statements for an org with no ERP (#1494) shall use the same statement read over the PMO-native ledger
  once it exists; this desk does not build that ledger.

## 7. Separation of duties and permissions (enforced in the database, ADR-0019)

All writes go through SECURITY DEFINER RPCs; the client has no INSERT/UPDATE/DELETE grant on any desk table; RLS
limits reads to the caller's org. `can()` mirrors these for the UI only (ADR-0016).

| Piece | Create / prepare | Approve | Refused |
|---|---|---|---|
| Journal | Finance, Executive, Admin | rank ≥ Finance and not in the author set (maker + every editor) | approver = maker; approver who edited a line; a PM or Engineer anywhere |
| Reversal | as journal | as journal; also not the original's maker | self-approval |
| Asset register | Finance+ | — (register entry is not money) | edit of cost/life after the first charge (correct by disposal + re-register) |
| Depreciation run | Finance+ | as journal | a second run for the same month |
| Bank account marking and column map | Admin only | — | any other role |
| Bank import / match | Finance+ | month sign-off: any Finance+ other than the importer | sign-off by the importer |
| Tax sign-off | Finance+ | — | — |
| Month close | accountant (Finance+) proposes | Executive or Admin, not the proposer | approval by the proposer |
| Reopen | request: Finance+ | Executive or Admin, not the requester | reopen inside a closed year |
| Year close | Finance+ prepares | Executive, not the preparer | — |
| Ledger lock write (optional setup) | service role only, from the close RPC | — | any client path |

- **FR-ACD-100** The approval predicate shall be one function used by every desk approval, built on `role_rank` and
  `may_approve_work_of` (`0178_*.sql:638,707`) plus an author-set check, null-safe and failing closed.
- **FR-ACD-101** The real JWT role decides; impersonation is view-only (ADR-0016).
- **FR-ACD-102** Project Managers and Engineers shall not read journals, bank, asset, tax or period detail; they see
  project totals as today.

## 8. Money rules

- **FR-ACD-110 Balanced.** A journal balances in the ledger currency after each line is rounded to the ledger
  currency's precision (read from the ledger: `res.currency.rounding`, as `_shared/odooRevenueRefs.ts:95`); the system
  never adds a rounding line on its own.
- **FR-ACD-111 Currency.** The ledger currency is the company currency (IDR). A line may carry a document currency
  amount and the rate the maker used; the posted rupiah amount is what the maker entered and the approver saw. Any
  other rupiah figure on the desk derived from a foreign amount is a **display equivalent**, always shown in rupiah with
  its rate, source and date (DD-FX-1), and never posted.
- **FR-ACD-112 Amounts** are exact decimals end to end (string in transport, `numeric` in SQL), as the ledger feed does
  (`odoo/ledger/cents.ts`).
- **FR-ACD-113 Dates and periods.** A posting date is a calendar date in the org's day (Asia/Jakarta); the period is
  the month of that date within the fiscal year (OBS-ACD-006); the ledger's own date is never re-derived from a
  timestamp.
- **FR-ACD-114 Locked period.** PMO refuses first (FR-ACD-073). Where a ledger refuses a post for its own lock, the
  outbox records `commit-rejected` with the plain message and the journal returns to **Refused**, editable only as a
  new date. Odoo does not refuse: it books the post on another date, so the read-back (FR-ACD-027) finds the
  difference and the command is **held** (Needs a check: posted in the ledger on another date), never Posted.
- **FR-ACD-115 Idempotency.** Every post and reversal has one outbox row keyed by the PMO record; a retry reuses it;
  on Odoo an inconclusive probe **holds** (OBS-ACD-002) and a reversal first reads the original's reversal links
  (FR-ACD-028); on ERPNext an immutable-anchor miss may reissue (OBS-ACD-003).
- **FR-ACD-116 No answer.** When the ledger does not answer, the journal stays **Sending**, the sweep retries the same
  row, the month-end checklist stays red, and nothing is shown as posted. A held row is shown as **Needs a check** with
  who can resolve it.
- **NFR-ACD-001** Every amount on a desk screen comes from the ledger mirror or from a PMO record, never from a
  client-side sum of a capped read (`docs/money-path-primer.md`, bucket 5).
- **NFR-ACD-002** A month-end with 2,000 journal lines, 1,500 statement lines and 300 assets shall render each screen
  within 2 s on the shared stack; depreciation for 300 assets produces one journal.

## 9. Deliberately left out

- **Third-party or OCA Odoo modules** — owner ruling #2163 (2026-11-15).
- **Tax filing** (e-Faktur upload, SPT Masa PPN, Coretax, PPh returns) — ADR-0048 keeps statutory filing in native tools;
  `tax-document.read` is unavailable on Odoo (`odoo/workflowDeclarations.ts:21`).
- **Automatic bank feeds** — no bank API is in scope; files only.
- **Project amortisation of capitalised spending** — parked by #2196.
- **Budgets on Odoo** — Community has no budget object (`odoo/workflowDeclarations.ts:50-52`).
- **Cash-flow statement, consolidation, multi-company** — not asked for the first client; the seam is per company.
- **Recurring journal templates and accrual auto-reversal** — a later convenience; reversal by hand covers it.
- **The PMO-native ledger itself** — the seam is designed for it; building it needs its own ADR (OD-VISION-ERP).
- **Posting into Odoo's `hard_lock_date`** — irreversible; PMO never sets it.
- **Writing Odoo's other lock dates by default** — PMO reads and shows them; writing them is an optional setup that
  needs a stronger integration user (§4.2; owner question Q4).
- **Any work by a client's people inside an ERP** — owner ruling 2026-11-15 17:40 (§2.3). Bank reconciliation included.
- **PDF statements and foreign-currency bank accounts** — wait (FR-ACD-051, -056).
- **Changing a client's payment method lines** — withdrawn with FR-ACD-057; Odoo's outstanding-account flow stays.

### 9.1 Gaps — ERP-side steps that seem needed, and decisions not taken here

Each is a step a person might have to do in an ERP, or a decision outside this spec. None is an instruction to the
client; each needs a PMO answer later.

- **GAP-ACD-1 ERPNext Bank Account record.** A Bank Transaction needs an ERPNext `Bank Account` linked to the GL account.
  Where the client's ERPNext has none, PMO cannot write the match. No PMO screen creates that record yet; a follow-up
  slice adds it to the Admin bank-account panel.
- **GAP-ACD-2 Odoo payments already pointed at the bank account.** A payment method line that posts straight to the bank
  account makes Odoo count that payment matched with no statement line, so core has nowhere to record which statement
  line it matches. Such a client's bank book can show balances but cannot hold those matches in Odoo. Options (a PMO
  Admin write pointing the method lines back at the outstanding accounts, or a module under #2163) are not decided here.
- **GAP-ACD-3 Odoo integration user rights.** Creating a statement line through the API needs an accounting group the
  ledger reader lacks (V-ACD6b). Granting it is an Odoo-side step by whoever sets the integration up; no PMO screen does
  it yet, and V-ACD11 must show the match write works before the workflow is `supported`.
- **GAP-ACD-4 Month sign-off has no ERP equivalent.** Neither ERPNext nor Odoo core has a per-account monthly sign-off
  record; PMO's `bank_reconciliations` row is an attestation over the ERP's read-back figures, not match state (Q12).
- **GAP-ACD-5 Unmatched statement lines stay out of the ERP.** Writing an unmatched line into the ERP would make its
  bank balance follow the statement before matching. Not in this spec.
- **GAP-ACD-6 Odoo Community modules (#2163, open).** This spec uses core only. If #2163 allows a module (a
  reconciliation or statement-import add-on), the Odoo match write could move to it. A dependency, not decided here.
- **GAP-ACD-7 ERPNext voucher already cleared outside PMO.** A voucher whose clearance date was set by another path makes
  ERPNext allocate nothing; PMO holds the request as **Needs a check** with that reason. Clearing the stale date from PMO
  is a follow-up slice.

## 10. Acceptance criteria

| ID | Criterion (Given / When / Then) | Layer |
|---|---|---|
| AC-ACD-001 | **Given** a draft with lines 100.00 Dr and 99.99 Cr **When** submitted **Then** it is refused "does not balance by 0.01" and nothing is queued | U |
| AC-ACD-002 | **Given** a Finance maker's submitted journal **When** the maker approves it **Then** 42501; **When** a second Finance member who edited a line approves **Then** 42501; **When** a second Finance member who did not edit approves **Then** it is approved and one outbox row `journal:<id>` exists | P |
| AC-ACD-003 | **Given** an approved journal **When** the Odoo adapter posts it to the fake **Then** one `entry` move is created, posted and anchored; a lost answer followed by a probe miss **holds**, never posts a second move | C (Odoo) |
| AC-ACD-004 | **Given** the same approved journal on ERPNext **When** posted **Then** one submitted Journal Entry carries the `user_remark` key; a conclusive probe miss reissues once | C (ERPNext) |
| AC-ACD-005 | **Given** a posted journal **When** a reversal is approved **Then** one reversing move links to the original, the original is unchanged, and balances net to zero | C |
| AC-ACD-006 | **Given** a posted PMO journal mirrored back **When** the Journals list and the project journal list load **Then** it appears once, as the PMO record | P |
| AC-ACD-007 | **Given** a move posted directly in the ledger **When** mirrored **Then** it shows "posted outside PMO" and the checklist lists it until acknowledged | P |
| AC-ACD-008 | **Given** an asset cost 10,000,000, residual 0, life 36 months **When** the schedule is computed **Then** 35 months of 277,777 and a last of 277,805 sum to 10,000,000 | U |
| AC-ACD-009 | **Given** depreciation run for November **When** run again **Then** refused while the first journal is not reversed | P |
| AC-ACD-010 | **Given** an import whose opening differs from the previous closing by 1 **When** imported **Then** refused naming both balances | P |
| AC-ACD-011 | **Given** a proposed match whose sides differ by 1 **When** confirmed **Then** refused | P |
| AC-ACD-012 | **Given** a month with one unmatched statement fee line **When** a journal is started from it, approved and posted **Then** the line is matched and the bank book difference is 0 | E |
| AC-ACD-013 | **Given** a month with a draft journal, an unconfirmed outbox row and an unsigned bank **When** the checklist loads **Then** those three items are red and "Propose close" is disabled | U |
| AC-ACD-014 | **Given** November closed **When** a bill, payment, invoice, stock issue or journal dated 2026-11-20 is sent **Then** each is refused before the outbox with the closed-month message | P |
| AC-ACD-015 | **Given** a close proposed by A **When** A approves **Then** 42501; **When** an Executive B approves **Then** the month is closed and `setLock` is called once with the last day | P + C |
| AC-ACD-016 | **Given** October open **When** November's close is proposed **Then** refused "close October first" | P |
| AC-ACD-017 | **Given** a closed year **When** a reopen of any month in it is requested **Then** refused | P |
| AC-ACD-018 | **Given** a USD bank balance of 1,000.00 at ledger 15,500,000 and a stated rate 16,000 **When** revaluation is proposed **Then** the journal posts 500,000 to FX gain with rate, source and date on the line | U |
| AC-ACD-019 | **Given** a foreign-currency figure shown in rupiah anywhere on the desk **Then** its rate, source and date are shown beside it | U |
| AC-ACD-020 | **Given** a PM or Engineer **When** reading any desk table or RPC **Then** zero rows or 42501 | P |
| AC-ACD-021 | **Given** a tier whose `period.lock` is `pending` **When** a month closes **Then** PMO's status closes, PMO refuses back-dated writes, and the screen says the ledger itself is not locked | U + P |
| AC-ACD-022 | **Given** the tax register for a month signed off **When** a tax line in that month changes in the mirror **Then** the register shows "Changed since sign-off" | P |
| AC-ACD-023 | **Given** an Odoo statement for an open month **Then** it is labelled Provisional; for a closed month it is not | U |
| AC-ACD-024 | **Given** the shared `journal.*` and `period.lock` contract cases **When** run per tier **Then** each passes or is skipped only by a `pending`/`unavailable` declaration with its reason | C |
| AC-ACD-025 | **Given** the Odoo bed **When** V-ACD1, 2, 4, 6, 10 are probed **Then** each verdict is recorded (done 2026-11-15, §11) and a matching workflow is flipped to `supported` only on "verified" | B |
| AC-ACD-026 | **Given** a bookkeeper and an approver **When** the bookkeeper drafts a bank-fee journal, the approver approves, the fake ledger posts **Then** the journal shows Posted with its ledger reference and the Trial Balance moves by the fee | E |
| AC-ACD-027 | **Given** an Odoo ledger locked to 2026-01-31 **When** a journal dated 2026-01-20 is posted and the ledger books it on 2026-02-28 **Then** the read-back holds the command as Needs a check ("posted in the ledger on 2026-02-28, not 2026-01-20") and the journal is never shown Posted on 2026-01-20 | C (Odoo) |
| AC-ACD-028 | **Given** a posted journal that already has a reversal in the ledger **When** a second reversal is requested **Then** the existing reversal is adopted or the request refused, and no second reversal move exists | C (Odoo) |
| AC-ACD-029 | **Given** a reversal dated after today **When** the ledger answers with a draft move **Then** the desk shows Scheduled, not Posted, until the read-back finds it posted | C (Odoo) + U |
| AC-ACD-030 | *Withdrawn (owner ruling 2026-11-15; ERP source of truth).* Was: the Odoo bank book unavailable until every payment method line is set to the bank account. That connect step was planned only, never shipped; Odoo's outstanding-account flow stays. Id kept, not reused | — |
| AC-ACD-031 | *Withdrawn (owner ruling 2026-11-15; ERP source of truth).* Was: a supplier payment of 400 posts one credit on the bank account and none on an outstanding account. Same reason. Id kept, not reused | — |
| AC-ACD-032 | **Given** a withholding tax whose tax repartition line names no account **When** the connect step checks it **Then** it says "withholding is not on a tax account" and no register is offered for it | U + C (Odoo) |
| AC-ACD-033 | **Given** input VAT lines of 264,000 and a `tax-deposit` journal of 100,000 on the same account in one month **When** the register loads **Then** it shows tax lines 264,000 plus other entries on the account -100,000 and the account balance 164,000 | P |
| AC-ACD-034 | **Given** a receipt that wrote off 20,000 to a prepaid-tax account **When** the tax registers load **Then** the amount is listed separately by account and label with no base, and not in any tax register total | P |
| AC-ACD-035 | **Given** an ERPNext-connected client, a statement line of -6,500.00 and a submitted Payment Entry of 6,500.00 out of that bank **When** a Finance member confirms the match in PMO **Then** ERPNext holds a submitted Bank Transaction with status Reconciled linking that Payment Entry, the Payment Entry has a clearance date, PMO shows the line Matched only after reading that back, and PMO has no `bank_matches` row for it | C (ERPNext) + B |
| AC-ACD-036 | **Given** an Odoo Community client with only core modules, a statement line of -400.00 and a posted supplier payment of 400.00 on the journal's outstanding payments account **When** a Finance member confirms the match in PMO **Then** Odoo holds a posted statement line with `is_reconciled` true, the payment's outstanding line is reconciled, PMO shows Matched only after reading that back, and PMO has no `bank_matches` row for it | C (Odoo) + B |
| AC-ACD-037 | **Given** a client with no ERP **When** a Finance member confirms a match that nets to zero **Then** PMO stores one `bank_matches` record and the bank book counts the line matched; **When** the organization has an ERP ledger **Then** an insert into `bank_matches` is refused | P |
| AC-ACD-038 | **Given** a statement line of -6,500.00 on 10 Nov and ledger lines of -6,500.00 on 12 Nov and on 14 Nov **When** matches are proposed **Then** only the 12 Nov line is proposed and nothing is confirmed until a person confirms it | U |
| AC-ACD-039 | **Given** an ERP client confirms a match and the ERP does not answer **When** the sweep retries **Then** the line shows Sending, then Needs a check if the read-back is doubtful, and is never counted matched until the read-back shows it matched | C (ERPNext, Odoo) |
| AC-ACD-040 | **Given** a Finance member **When** they mark a bank account or set its column layout **Then** 42501; **When** an Admin does **Then** it is saved | P |

## 11. Claims about the ledgers (summary)

**Odoo Community 20, run on the test bed on 2026-11-15** (`supabase/functions/_shared/odooAccountantsDeskFacts.bed.test.ts`,
branch `spike/accountants-desk-odoo-facts`):

- **V-ACD1 VERIFIED.** `entry` create with `line_ids` and `analytic_distribution` works in any journal type; an
  unbalanced entry is refused at create; `ref` is no anchor, the external id is (FR-ACD-027, -029).
- **V-ACD2 VERIFIED.** The reversal wizard works on an `entry` move; a second reversal is not refused; a future date
  leaves a draft (FR-ACD-028).
- **V-ACD4 VERIFIED.** Lock dates can be written (Access Rights, plus an accounting group for the fiscal date) and moved
  back, but a post dated inside a lock is booked on another date, not refused (FR-ACD-027, §4.4).
- **V-ACD6 VERIFIED.** Payments land on Outstanding Receipts / Payments unless the method line names the bank account
  (Odoo's standard flow, which stays; the set-the-method-line step is withdrawn, FR-ACD-057); a statement line made by API
  needs a group the ledger reader lacks and moves the bank balance itself (FR-ACD-055, GAP-ACD-3).
- **V-ACD10 VERIFIED.** `tax_line_id`, `tax_base_amount` and `balance` on tax lines give a per-document register that
  ties to a tax account; withholding left on default repartition has no tax account (FR-ACD-061, -064, -065).

**Still to verify (ERPNext):** V-ACD3 dated reverse Journal Entry · V-ACD5 Accounting Period / frozen-until · V-ACD7
Bank Transaction written with its vouchers, read back, undone (FR-ACD-055, AC-ACD-035) · V-ACD8 Asset schedule ·
V-ACD9 Period Closing Voucher.

**Still to verify (Odoo):** V-ACD11 the bank match write on core only: statement-line `create` with
`counterpart_account_id` through the external API, `account.move.line` reconcile, the read-back fields, undo with and
without the company audit trail, and the integration user's rights (FR-ACD-055, AC-ACD-036, GAP-ACD-3). The workflow
`bank.reconcile-match` stays `pending` until each verdict is recorded in `docs/research/` (FR-ACD-003).

## 12. Owner questions

Each: the question, the recommendation, and what changes if the answer is the other one.

1. **Q1 — Does the client reconcile its banks in PMO?** **Answered (owner, 2026-11-15 17:40): yes, every client**
   (#896); no one works in the ERP (§2.3). For an ERP client the match is kept in the ERP (FR-ACD-055).
2. **Q2 — Does Odoo get a year-end closing journal?** Recommend no: Odoo derives earnings up to the year end and the
   shipped statements already do (OBS-ACD-005). If yes, FR-ACD-080 posts a closing journal on Odoo as on the other
   tiers and the Balance Sheet's two derived equity rows need a change.
3. **Q3 — Is there a separate Accountant role?** Recommend no: Finance covers it, and "maker is not approver" is a
   rule about persons (§2.1). If yes, a role is added to the enum and to every row of §7, and `can()` splits.
4. **Q4 — Should PMO write the ledger's lock dates?** Recommend no: PMO reads and shows them and its own month lock is
   the guard (§4.2). If yes, the integration user needs Access Rights plus an accounting group, `period.lock` becomes
   `supported` after setup, and closing a month also moves the ledger's lock.
5. **Q5 — Which exchange rate values foreign balances at year end?** Recommend the JISDOR rate for the year-end date
   from `fx_rates` (OBS-ACD-010). If another source (a bank rate, a rate the accountant types), FR-ACD-081 takes the
   typed rate with its source and the revaluation journal says so.
6. **Q6 — Does every journal need a second approver?** Recommend yes, every one (§7). If only above an amount, the
   approval predicate gets a threshold, a small journal posts on the maker's submit, and the maker-is-not-approver
   check no longer covers it.
7. **Q7 — How is depreciation charged?** Recommend straight-line, whole months, starting in the month the asset enters
   service (FR-ACD-041). If declining balance or a start the month after, the schedule function and AC-ACD-008 change;
   nothing else does.
8. **Q8 — Which banks' statement formats must the first import read?** **Answered (owner, 2026-11-15):** CSV, with a
   column layout an Admin sets per bank account (FR-ACD-050, -051); a bank that gives only a PDF waits; rupiah accounts
   first.
9. **Q9 — If the client's withholding tax is not on its own tax account, do we change the client's tax set-up?**
   Recommend no: the register says "withholding is not on a tax account" and is not offered (FR-ACD-064). If yes,
   PMO's connect step would write the tax repartition once, a ledger change PMO does not otherwise make; until then it
   is a Gap.
10. **Q10 — What is the first month PMO closes?** Recommend the first month after the desk ships, with earlier months
    marked closed by an Admin without the checklist (FR-ACD-075 otherwise forces them closed in order). If every earlier
    month must pass the checklist, December cannot close until each earlier month has been worked.
11. **Q11 — Foreign-currency bank accounts (FR-ACD-056).** Recommend rupiah accounts only in the first release; a
    follow-up adds the account's own currency to the mirror. If wanted now, the bank book and the ERP match write both
    carry a currency amount and the first release grows.
12. **Q12 — What is a month's sign-off for an ERP client?** Recommend a PMO attestation row (who signed, the figures read
    back from the ERP) that never decides whether a line is matched (FR-ACD-054, GAP-ACD-4). If the ERP must hold it,
    that is a write the ERPs have no record for.
13. **Q13 — Can a signed-off month's sign-off be withdrawn?** Recommend not in this piece; it arrives with the period
    lock's reopen (Executive or Admin, not the signer). If now, the piece gains a withdraw action and its own approval rule.
