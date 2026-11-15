# The accountant's desk — month-end and year-end work in PMO over a hidden ledger — spec

- **Map:** #894 (month-end and year-end close). **Tickets it covers:** #895 manual journals, #896 bank book and
  reconciliation, #899 fixed assets, #900 year-end close, #2282 issued stock in project cost; reads on #1507 (Odoo
  statements), #2163 (no Odoo modules), #2196 (capitalised spending), #1494 (statements without an ERP).
- **Status:** Draft for owner sign-off (design only; no code, no migration in this change).
- **IDs:** `FR-ACD-###`, `NFR-ACD-###`, `AC-ACD-###`; `OBS-ACD-###` observed; `V-ACD#` claims about Odoo or ERPNext
  marked **VERIFIED** (with the file in this repository that already exercises them) or **TO VERIFY ON A TEST BED**.
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
Whether a separate Accountant role is wanted is owner question Q3.

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
| Day 5 | Approve the close; M is locked in PMO and in the ledger | director | **Month-end close** |
| Day 5+ | Read Trial Balance, P&L, Balance Sheet for M with M−1 comparison | everyone with access | **Financial statements** (shipped) |
| Year end, after the last month is closed | FX revaluation, final adjustments, year close, year lock | accountant → director | **Year-end close** |

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

The desk talks to one interface, `LedgerPort`, implemented per tier. It has **six operations**. Everything else the
desk does — bank statements, matches, the asset register, depreciation schedules, tax registers, the checklist — is
PMO state, and reaches the ledger only through operation 1.

| # | Operation | Input | Result |
|---|---|---|---|
| 1 | `postJournal` | idempotency key, date, ledger currency, lines (account, debit, credit, optional partner, analytic/project, optional document currency amount and rate), memo, maker id, approver id | posted ledger reference, or `refused(reason)`, or `unknown` (held) |
| 2 | `reverseJournal` | idempotency key, original ledger reference, reversal date, maker, approver | posted reversal reference, or `refused`, or `unknown` |
| 3 | `readLines` / `readBalances` | company, account set, period (from–to dates) | ledger lines, or per-account opening, debit, credit, closing |
| 4 | `readLock` / `setLock` | company; for set, the new lock date and the lock kind | the ledger's current lock date(s) |
| 5 | `reconcileLines` (optional) | ledger line ids that net to zero | matched, or `unsupported` |
| 6 | `capabilities` | — | which of 1–5 this tier supports, as `odoo/workflowDeclarations.ts` already does (`supported` / `pending` / `unavailable` + reason) |

Registering an asset, posting depreciation and closing a year are **not** ledger operations: the register and
schedule are PMO state on every tier where the ledger has none, depreciation is a `postJournal`, and the year close
is a `postJournal` (where the tier's convention needs one) followed by `setLock`.

New workflow declarations, added to each tier's table: `journal.post`, `journal.reverse`, `ledger.read-period`,
`period.lock`, `ledger.reconcile`. A desk action whose workflow is not `supported` for the org's tier is refused
before any write with the declared reason.

### 4.2 Per operation, per ledger

| Op | Odoo Community 20 (stock API, JSON-2, no modules) | ERPNext | Future PMO-native ledger |
|---|---|---|---|
| `postJournal` | `account.move` `create` with `move_type = 'entry'` in a `general` journal, lines in `line_ids`, then `action_post`. **VERIFIED in part:** create + `action_post` on `account.move` (`revenueAdapter.ts:72`, `procurementAdapter.ts:363`); a hand-made `entry` move in a general journal posts as ordinary lines (V-ODA11, `docs/research/2026-10-31-odoo20-dev-bed-verification.md:227`). **TO VERIFY (V-ACD1):** `entry` create with `line_ids` command tuples through JSON-2, `analytic_distribution` on `entry` lines, refusal shape on an unbalanced move. Anchor: `ir.model.data` external id, as OBS-ACD-002; hold on doubt. | `Journal Entry` create + submit with `accounts` rows; anchor `user_remark`. **VERIFIED** (`erpnext/doctypeRegistry.ts:177`). | Insert into an append-only `ledger_entries` / `ledger_lines` pair through one definer writer, as `stock_write_entry` (ADR-0097 §1). |
| `reverseJournal` | `account.move.reversal` `create` + `refund_moves`; the new move carries `reversed_entry_id`. **VERIFIED** for invoices (`scripts/odoo-probe.mjs:708-712`, V-ODA8 at `…bed-verification.md:224`; `_shared/odooRevenueFeed.bed.test.ts:97-101`). **TO VERIFY (V-ACD2):** the same wizard on an `entry` move, and its choice of date. | Cancel of the submitted entry is **VERIFIED** (`expensePostingCommand.ts:163-166`). A dated reverse entry (a new Journal Entry with swapped sides) is **TO VERIFY (V-ACD3)** as a native action; PMO can always post it as a new `postJournal`. | A new entry with swapped sides linked to the original; the original is never edited. |
| `readLines` / `readBalances` | `account.move.line` `search_read` with the 15 fields of `odoo/ledger/feed.ts:17-20` and `formatted_read_group` by account (× month) (`_shared/odooLedgerFeed.ts:159`). **VERIFIED** (V-ODA1, V-ODA5). The desk reads the **mirror**, not Odoo, for screens; Odoo is read for the oracle check. | GL mirror (`erpnext/ledgerMirrorFeed.ts`) and saved standard reports (`erpnext/statementReports.ts`). **VERIFIED.** | Direct SQL over `ledger_lines`. |
| `readLock` / `setLock` | `res.company` fields `fiscalyear_lock_date`, `tax_lock_date`, `sale_lock_date`, `purchase_lock_date`, `hard_lock_date` read `false` when unset; `period_lock_date` does not exist. **VERIFIED for read** (V-ODA4, `…bed-verification.md:220`; `scripts/odoo-probe.mjs:578`). **TO VERIFY (V-ACD4):** writing `fiscalyear_lock_date` and `tax_lock_date` through JSON-2, the access group it needs, whether a later date can be moved back, and that a post dated inside the lock is refused. `hard_lock_date` is irreversible by design in Odoo and **PMO never writes it** (unconfirmed on the bed; treated as a rule, not a fact). | `Accounting Period` with closed document types, and `Accounts Settings` frozen-until date. **TO VERIFY (V-ACD5)** — not used anywhere in this repository. | `ledger_periods.status`; the writer refuses a post dated in a locked period. |
| `reconcileLines` | `account.move.line/reconcile` on lines that net to zero. **VERIFIED** generically (`revenueAdapter.ts:188`, `procurementAdapter.ts:459`; V-OPP7). Community has **no bank-statement import and no reconciliation screen** (#2163, citing #1484); whether `account.bank.statement.line` can be created by API, and whether a supplier payment lands on the bank account or an outstanding account, is **TO VERIFY (V-ACD6)**. | `Bank Transaction` and the reconciliation tool. **TO VERIFY (V-ACD7)** — not used in this repository. | A match row in PMO; no ledger state needed. |
| Asset + depreciation | **Nothing.** Community has no depreciation (#2163, #1484). PMO holds the register and schedule and posts each month's charge through `postJournal`. | `Asset` with a native depreciation schedule that posts its own Journal Entries (implied by `feedKinds.ts:198`). **TO VERIFY (V-ACD8).** Default: PMO holds the register on ERPNext too (one design), see FR-ACD-040. | PMO register + `postJournal`. |
| Year close | No company-level year-end creator; a manual closing to an `equity_unaffected` account posts as an ordinary entry (V-ODA11, **VERIFIED**). Odoo's convention is no closing entry: earnings are derived up to the year end, which is what 0746 already does (OBS-ACD-005). | `Period Closing Voucher`. **TO VERIFY (V-ACD9).** | Closing entry into retained earnings, then lock. |

### 4.3 Requirements

- **FR-ACD-001** The system shall reach a ledger from the desk only through `LedgerPort`; no desk screen, RPC or edge
  function shall call an Odoo model or an ERPNext doctype outside `pmo-portal/src/lib/adapterSeam/<tier>/**`.
- **FR-ACD-002** The system shall declare each `LedgerPort` workflow per tier with `supported`, `pending` or
  `unavailable` and a reason, and shall refuse a desk action whose workflow is not `supported` before any write.
- **FR-ACD-003** Where a claim in §4.2 is TO VERIFY, the matching workflow shall stay `pending` until a bed probe
  records the verdict in `docs/research/`.
- **FR-ACD-004** The shared contract suite shall run the same `journal.*`, `ledger.read-period` and `period.lock` cases
  against every tier's adapter and the fake of that tier.

## 5. Where state lives

| Thing | Lives in | Notes |
|---|---|---|
| Journal draft, its lines, maker, editors, approval, return reason | **PMO** (`journal_entries`, `journal_entry_lines`) | the record of the decision; immutable once approved |
| Posted entry | **Ledger** | PMO keeps the ledger reference and a mirror of its lines; never a second copy that it calls posted |
| Bank accounts (which ledger account is which bank) | PMO setting over the ledger's account list | |
| Bank statement imports and statement lines | **PMO** (`bank_statement_imports`, `bank_statement_lines`) | Community has no import (#2163) |
| Matches between statement lines and ledger lines, and each month's reconciliation sign-off | **PMO** (`bank_matches`, `bank_reconciliations`) | ledger `reconcileLines` is optional on top |
| Fixed-asset register and depreciation schedule | **PMO** (`fixed_assets`, `asset_depreciation_lines`) | each charged line points at the journal that posted it |
| Period status and month-end checklist | **PMO** (`accounting_periods`, `close_checklist_items`) | mirrored into the ledger's lock date where supported |
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

## 6. The pieces, in dependency order

Each piece ships alone, behind its own workflow declaration, with the three reviews (money tier, ADR-0019).
Dependency: 1 is the foundation; 3, 4, 6, 7 need 1; 7 needs 6; 2, 5, 8 are read-side and need none.

| # | Piece | Tickets | Needs | After it ships the accountant can… |
|---|---|---|---|---|
| 1 | Manual journals | #895 | — | record and post any non-invoice entry with maker and approver; reverse one |
| 2 | Issued stock in project cost | #2282 | #1508 | see material issued through Odoo in project actuals once, and on the work item |
| 3 | Fixed assets and depreciation | #899 | 1 (#2196 for project amortisation) | keep the register and post each month's depreciation as one approved journal |
| 4 | Bank book, statement import, reconciliation | #896 | 1 | see each bank's ledger balance against its statement and sign off a month |
| 5 | Tax registers | (new) | — | tie input and output VAT and withholding for a month to the ledger |
| 6 | Period lock and month-end checklist | (new, from #894/#900) | 1 | close a month: nothing back-dated can then post into it from PMO or the ledger |
| 7 | Year-end close | #900 | 1, 6 | revalue foreign balances, close and lock the year |
| 8 | Statements on Odoo (finish) | #1507, #1494 | 6, 7 | read statements that know which periods are closed, drill into lines, export the auditor's pack |

### 6.1 Manual journals (#895)

- **FR-ACD-020** A Finance-or-above member shall create a draft journal with a date, a memo, a kind (`fee`, `interest`,
  `tax-deposit`, `accrual`, `reclassification`, `correction`, `funding`, `depreciation`, `revaluation`, `closing`) and
  two or more lines, each with an account from the mirrored chart, a debit or a credit, and optionally a partner and a
  project.
- **FR-ACD-021** The system shall refuse to submit a draft whose lines do not balance in the ledger currency to the
  smallest unit, whose date falls in a locked period, or which names an account the ledger has archived.
- **FR-ACD-022** When a submitted journal is approved, the system shall send it through the money outbox with the
  key `journal:<id>` and show it as **Sending** until the ledger answers; it shall show **Posted** only after the
  ledger reference is read back.
- **FR-ACD-023** When an approver returns a journal, the system shall record the reason and return it to the maker as a
  draft; any edit after return makes the editor part of the author set.
- **FR-ACD-024** A posted journal shall never be edited or deleted; a correction shall be a reversal (FR-ACD-025) and,
  if needed, a new journal.
- **FR-ACD-025** A Finance-or-above member shall request the reversal of a posted journal with a date and reason; the
  reversal is itself a journal with its own maker and approver, posted through `reverseJournal` where `supported`,
  else as a swapped-sides `postJournal` linked to the original.
- **FR-ACD-026** Where a line names a project, the system shall send the project's ledger analytic so the line reaches
  project actuals through the existing feed (`0687`, `0746`), and shall not count it again from the PMO record.

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
  absorbing the remainder so the schedule sums to cost minus residual exactly.
- **FR-ACD-042** When the accountant runs depreciation for an open month, the system shall create **one** draft journal
  of kind `depreciation` with one line pair per expense account (and project, where set), mark the month's schedule
  lines as in that journal, and refuse a second run for the same month while the first is not reversed.
- **FR-ACD-043** Disposal of an asset shall be a journal (cost out, accumulated depreciation out, gain or loss) with
  maker and approver; the schedule stops at the disposal month.
- **FR-ACD-044** While #2196 is open, the system shall not attribute depreciation of an internally built asset to a
  delivery project's budget or margin; a project on a depreciation line is allowed only when the asset names it.

### 6.4 Bank book, statement import, reconciliation (#896)

- **FR-ACD-050** An Admin shall mark which ledger accounts are bank accounts, each with its currency.
- **FR-ACD-051** A Finance-or-above member shall import a bank statement file (CSV with a declared column map; the
  formats of the client's banks are owner question Q8) for one bank account and date range; the system shall refuse an
  import whose opening balance does not equal the previous import's closing balance, or that overlaps a signed-off month.
- **FR-ACD-052** The system shall propose matches between statement lines and the bank account's ledger lines by
  amount and date window, never auto-confirm; a person confirms each match; one statement line may match several
  ledger lines and the reverse, and a match must net to zero.
- **FR-ACD-053** From an unmatched statement line, a member shall start a prefilled draft journal (fee, interest); its
  ledger line, once posted, is matched to the statement line.
- **FR-ACD-054** The bank book shall show, per account and month: statement closing balance, ledger balance at the
  same date, matched and unmatched items each side, and the difference, which must be explained by unmatched items to
  the unit before sign-off.
- **FR-ACD-055** Where the tier supports `ledger.reconcile`, confirming a match may also reconcile the ledger lines;
  where it does not, the match is PMO state only, and the ledger is unchanged.
- **FR-ACD-056** A foreign-currency bank account's book shall show its own currency; the rupiah figure beside it is
  the ledger's rupiah balance; a display equivalent (DD-FX-1) is labelled with its rate and date.

### 6.5 Tax registers

- **FR-ACD-060** The system shall list, per month, output VAT, input VAT and each withholding kind from the ledger
  mirror's tax lines, with the source document, partner, base and tax amount, and the total per tax account, tied to
  the account balance.
- **FR-ACD-061** Where a tax line's base cannot be read from the ledger, the register shall show the tax amount and
  "base not available", never a computed base. (Odoo tax line fields are not in the mirror today, `odoo/ledger/feed.ts:17-20`;
  `tax_line_id` / `tax_ids` / `tax_base_amount` on `account.move.line` are **TO VERIFY (V-ACD10)**.)
- **FR-ACD-062** The accountant shall sign off a month's register; sign-off records the totals at that moment and a
  later change to that month's tax lines shows the register as **Changed since sign-off**.
- **FR-ACD-063** Filing (e-Faktur upload, SPT returns, Coretax) stays outside PMO (§9).

### 6.6 Period lock and month-end checklist

- **FR-ACD-070** Every month of the fiscal year (fiscal year from the binding, OBS-ACD-006) shall have a status:
  `open`, `closing` (close proposed), `closed`. Status is PMO state; the ledger's lock date follows it where supported.
- **FR-ACD-071** The checklist for a month shall be computed, not ticked: no draft or submitted journal dated in the
  month; no outbox row for the org dated in the month that is not confirmed; every bank account signed off; depreciation
  run; tax registers signed off; ledger mirror caught up and its last oracle check matching; no unacknowledged
  "posted outside PMO" entry. One manual item, "adjustments reviewed", is a person's tick.
- **FR-ACD-072** When every item is green, the accountant shall propose the close; a different person of rank
  Executive or Admin shall approve it. On approval the system shall set the month `closed` and, where `period.lock`
  is `supported`, call `setLock` with the month's last day as `fiscalyear_lock_date` (Odoo) or the tier equivalent.
- **FR-ACD-073** While a month is `closing` or `closed`, the system shall refuse any PMO write that would post a ledger
  document dated in it — journals, bills, invoices, payments, receipts, stock, site cash — before the outbox, with the
  message "This date is in a closed month (MMMM YYYY). Use a date in an open month or ask for the month to be reopened."
- **FR-ACD-074** An Executive or Admin, not the person asking, shall reopen a closed month with a reason; reopening
  moves the ledger lock back where the tier allows (V-ACD4) and is logged. A month in a closed year cannot be reopened.
- **FR-ACD-075** Months close in order; a month cannot close while an earlier month is open.

### 6.7 Year-end close (#900)

- **FR-ACD-080** After the last month of the fiscal year is `closed` (or `closing` with only year-end items open), the
  accountant shall prepare the year close: FX revaluation proposals for foreign-currency bank and receivable/payable
  balances, final adjustments, and — on tiers whose convention needs it (ERPNext, PMO-native) — a closing journal to
  retained earnings. On Odoo no closing journal is posted by default (§4.2; owner question Q2).
- **FR-ACD-081** A revaluation proposal shall state per balance the currency amount, the rate used and its source and
  date, the new rupiah value, the ledger's rupiah value and the difference posted to the FX gain/loss account; the rate
  source is owner question Q5.
- **FR-ACD-082** A director shall approve the year close; on approval the system shall set the year `closed` (no month
  in it can reopen) and set the ledger lock to the year end.

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
| Bank import / match | Finance+ | month sign-off: any Finance+ other than the importer | sign-off by the importer |
| Tax sign-off | Finance+ | — | — |
| Month close | accountant (Finance+) proposes | Executive or Admin, not the proposer | approval by the proposer |
| Reopen | request: Finance+ | Executive or Admin, not the requester | reopen inside a closed year |
| Year close | Finance+ prepares | Executive, not the preparer | — |
| Ledger lock write | service role only, from the close RPC | — | any client path |

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
- **FR-ACD-114 Locked period.** PMO refuses first (FR-ACD-073); if the ledger refuses for its own lock, the outbox
  records `commit-rejected` with the plain message and the journal returns to **Refused**, editable only as a new date.
- **FR-ACD-115 Idempotency.** Every post and reversal has one outbox row keyed by the PMO record; a retry reuses it;
  on Odoo an inconclusive probe **holds** (OBS-ACD-002); on ERPNext an immutable-anchor miss may reissue (OBS-ACD-003).
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
| AC-ACD-025 | **Given** the Odoo bed **When** V-ACD1, 2, 4, 6, 10 are probed **Then** each verdict is recorded and the matching workflow is flipped to `supported` only on "verified" | B |
| AC-ACD-026 | **Given** a bookkeeper and an approver **When** the bookkeeper drafts a bank-fee journal, the approver approves, the fake ledger posts **Then** the journal shows Posted with its ledger reference and the Trial Balance moves by the fee | E |

## 11. Claims to verify on the test bed (summary)

V-ACD1 `entry` create with `line_ids` and analytics through JSON-2, and the unbalanced-move refusal · V-ACD2 reversal
wizard on an `entry` move · V-ACD3 ERPNext dated reverse Journal Entry · V-ACD4 writing `fiscalyear_lock_date` /
`tax_lock_date`, required group, moving it back, refusal inside it · V-ACD5 ERPNext Accounting Period / frozen-until ·
V-ACD6 `account.bank.statement.line` by API, and whether payments post to the bank account or an outstanding account ·
V-ACD7 ERPNext Bank Transaction · V-ACD8 ERPNext Asset schedule · V-ACD9 ERPNext Period Closing Voucher · V-ACD10 Odoo
tax fields on `account.move.line`.
