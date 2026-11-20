# Bank book, statement import and reconciliation — implementation plan (#896, accountant's desk piece 4)

> **Revised 2026-11-15 to the owner's product rulings** (below). This revision replaces the earlier design in which
> PMO kept its own match records for every client and pointed Odoo's payment method lines at the bank account.

## Product rulings this plan builds (owner, binding)

1. **PMO is the only user interface.** A client's people never work in the ERP. Every task in this piece has a PMO
   screen, with or without an ERP behind it; the ERP, when connected, is the source of truth.
2. **Bank reconciliation happens in PMO for every client.** Every client gets the bank book. For an ERP-connected client
   its balances and movements come from the mirrored ERP ledger.
3. **Statements are CSV**, with a column layout an Admin sets per bank account; banks that give only PDFs wait. Rupiah
   accounts first. PMO **suggests** matches (same amount, value date within 3 days); a person confirms each one. Only an
   Admin marks bank accounts.
4. **Where the reconciled state lives.** For an ERP-connected client it lives **in the ERP**: a person matches in PMO,
   PMO writes the result to the ERP and reads it back, and PMO keeps **no competing reconciliation record**. For a client
   with no ERP, PMO's own record is the truth. The matching slice for an ERP-connected client is **not done** until that
   write and the read-back work.
5. **Per ERP, the smallest write that makes the ERP's own books show the match** — stated below from each ERP's source.
6. **No instruction to work in the ERP.** Where an ERP-side step by a person seems needed, it is listed under **Gaps**.

## Owner questions (one line each, with the default this plan builds)

1. **OQ-B4** Foreign-currency bank accounts (FR-ACD-056): default **IDR accounts only in this piece**; a follow-up adds `amount_currency` to the mirror.
2. **OQ-B6** Withdrawing a month's sign-off: default **not in this piece**; it arrives with piece 6's reopen (Executive or Admin, not the signer).
3. **OQ-B7** Migration numbers and DB slot: default **migration number needed, assigned by the coordinator at build time**, in a scheduled reset slot.
4. **OQ-B8** A month's sign-off for an ERP-connected client: default **a PMO attestation row** (who signed, the five figures read back from the ERP); it is not a reconciliation record and never decides whether a line is matched. See Gaps G-3.

The former OQ-B1 (does the client reconcile in PMO), OQ-B2 (statement format), OQ-B3 (match window) and OQ-B5 (who marks
accounts) are now answered by rulings 2 and 3.

> **For agentic workers:** money tier (ADR-0019). Director-dispatched per slice through an Orca worker
> (`docs/orca-dispatch.md`); each DB slice ships alone, never in a batch. Do not start until the owner has signed off the
> spec, and piece 1 (manual journals) is merged to `dev`. Strict TDD: every task writes the named failing test first,
> runs it and sees the expected failure, then the minimum code, then reruns it green.

**Spec:** `docs/specs/accountants-desk.spec.md` §4.1–4.4, §5, **§6.4**, §7 (row "Bank import / match"), §8, §10 — at
`7b9dd0914` (`origin/docs/accountants-desk-design-fwzy4j`), which already carries rulings 1–6 (§2.3, FR-ACD-050–059,
GAP-ACD-1..7; Task 0 is done there). **Read that commit, not the `dev` path:** the copy of
`docs/specs/accountants-desk.spec.md` on `dev` today is the piece-1 manual-journals text (§5–§8, `MJE` ids);
the full desk spec with the `FR-ACD`/`AC-ACD` ids lives only on that branch. The plan's ACs are the spec's AC-ACD-035/036/037; AC-ACD-030/031 and FR-ACD-057 are
withdrawn in the spec. Owner sign-off of the spec is still to come. **Format and
dependency reference:** `docs/plans/2026-11-15-manual-journals.md` (`origin/docs/895-manual-journals-plan`).

**Goal:** a bookkeeper imports a bank's statement for a month in PMO, confirms each suggested match (or posts a fee or
interest journal from a statement line), and a different Finance-or-above member signs the month off once the statement
closing balance and the ledger balance differ only by unmatched items, to the unit. For an ERP-connected client every
confirmed match is written to the ERP, read back, and shown from the read-back; for a client with no ERP the match is
PMO's own row.

## Slices

| # | Slice | DB | Money tier | Auth tier | Migration | ERP write in this slice |
|---|---|---|---|---|---|---|
| S1 | Pure logic: parser, proposer, month arithmetic, workflow ids (Tasks 1–6, 37) | no | no (exact-decimal helpers only) | no | none | none |
| S2 | Bank accounts and statement import, every client (Tasks 7–10, 38) | yes | yes (balances, import refusals) | yes (Admin-only marking, Finance+ import, RLS) | migration number needed | none |
| S3 | No-ERP matching and sign-off — PMO record is the truth (Tasks 11–15, 39) | yes | yes (net-zero match, SoD sign-off) | yes (SoD predicate, RLS) | migration number needed | none |
| S4 | ERPNext: write the match, read it back, undo (Tasks 16–22; 40–41 shared with S5) | yes (mirror table, outbox key, request RPCs) | yes (outbox, hold-on-doubt) | yes (dispatch gate re-reads under the caller's JWT) | migration number needed | **Bank Transaction** inserted and submitted with its `payment_entries` rows; ERPNext sets `clearance_date` on each voucher |
| S5 | Odoo Community core: write the match, read it back, undo (Tasks 23–29; 40–41 shared with S4) | yes (same tables as S4, Odoo rows) | yes (outbox, hold-on-doubt, the fee line is an approved ledger posting) | yes (same gate) | migration number needed | **`account.bank.statement.line` create** with `counterpart_account_id`, then **`account.move.line.reconcile`** |
| S6 | Screens for every client (Tasks 30–32) | no | no | yes (`can()` gates, UX only) | none | none (calls S3/S4/S5 RPCs) |
| S7 | Journeys, bed proofs, gates (Tasks 33–36) | reads only | — | — | none | bed only |

Order: S1 → S2 → S3 → S6 (no-ERP clients usable end to end) → S4 and S5 in parallel (each against its own bed lock) →
S7. S4 and S5 are each **not done** until their read-back tests and bed proofs (Tasks 34, 35) pass (ruling 4).

## Dependencies

| Needs | What this piece uses from it | Status |
|---|---|---|
| **Piece 1, manual journals (#895)** — `docs/plans/2026-11-15-manual-journals.md` | `journal_entries` / `journal_entry_lines`, `save_journal_draft`, `record_journal_outcome`, `journal.post` `supported`, and **its Task 25** (`move_id` on Odoo mirror rows) | must be merged to `dev` first |
| Odoo ledger mirror (#1507 S2) | `erp_gl_entry_mirror` rows (`0744_odoo_ledger_feed.sql`), `odoo_ledger_line_id()`, health `get_odoo_ledger_health()` (`0764`) | shipped |
| ERPNext GL mirror | `erp_gl_entry_mirror` ERPNext rows (`erp_name` = GL Entry name, `voucher_type`, `voucher_no`) | shipped |
| Map-once setup (`0708_odoo_map_once.sql`) | `external_master_records` kinds `account`, `journal` (`odoo/kinds.ts:7`) | shipped |
| No-ERP money rows | `incoming_payments` with `pmo_native = true` (`0275_native_revenue.sql`) and the native cash sources `0319_financial_statement_native_reports.sql` reads | shipped |
| CSV reader | `pmo-portal/src/lib/import/readCsvGrid.ts` | shipped |
| **Open question on Odoo Community modules (#2163)** | decides whether any OCA module may be installed; S5 uses **core only** and does not depend on its answer, but Gaps G-4 and G-5 do | **open — dependency, not decided here** |
| Piece 6 (period lock) | **consumes this piece**: its checklist item "every bank account signed off" reads `bank_reconciliations` | later |

## Architecture and contracts

### Where each piece of state lives

| State | No-ERP client | ERP-connected client |
|---|---|---|
| Bank account mark + CSV column map | PMO `bank_accounts` | PMO `bank_accounts` (configuration, not ledger state) |
| Statement file + lines (the input) | PMO `bank_statement_imports` / `bank_statement_lines` | same PMO rows — the import is the document PMO received; it is not a reconciliation record |
| Ledger movements and balances | PMO's own money rows (`bank_ledger_lines` native branch) | mirrored ERP ledger (`erp_gl_entry_mirror`) |
| **Which statement line matches which ledger line** | PMO `bank_matches` / `bank_match_items` (**the truth**) | **the ERP** (ERPNext Bank Transaction; Odoo statement line + reconcile); PMO holds only an in-flight outbox command and a **mirror** of the read-back (`erp_bank_match_mirror`), never edited by a person |
| Month sign-off | PMO `bank_reconciliations` | PMO `bank_reconciliations`, figures computed from the mirror (OQ-B8, Gap G-3) |

The one rule the database enforces: **`bank_matches` rows exist only for an org with no ERP ledger** (a check in
`confirm_bank_match` against the org's ledger owner, plus a pgTAP proof); for an ERP org the confirm RPC queues an ERP
write instead. So there is never a second answer to "is this line matched".

### New pieces, and only these

| Piece | Where | Shape |
|---|---|---|
| Desk state | `supabase/migrations/<migration number needed>_bank_book.sql` (+ `rollback/…_down.sql`) — S2/S3 | `bank_accounts`, `bank_statement_imports`, `bank_statement_lines`, `bank_matches`, `bank_match_items`, `bank_line_journals`, `bank_reconciliations`; definer RPCs; RLS select-only |
| ERP match requests + mirror | `supabase/migrations/<migration number needed>_bank_erp_match.sql` (+ rollback) — S4/S5 | `erp_bank_match_mirror`; RPCs `request_erp_bank_match`, `request_erp_bank_unmatch`, `approved_erp_bank_match_for_push`, `record_erp_bank_match_readback` |
| Statement parser | `pmo-portal/src/lib/import/bankStatementParser.ts` | CSV + column map → exact-decimal lines, pure |
| Match proposer | `pmo-portal/src/lib/bankBook/proposeMatches.ts` | pure: statement lines × ledger lines → proposals |
| Workflow ids | `pmo-portal/src/lib/adapterSeam/connect/workflows.ts` | `ledger.read-period`, `bank.reconcile-match` |
| ERPNext adapter | `pmo-portal/src/lib/adapterSeam/erpnext/bank/*` | write one Bank Transaction with its vouchers, read it back, undo one voucher |
| Odoo adapter | `pmo-portal/src/lib/adapterSeam/odoo/bank/*` | create one statement line, reconcile, read back, undo |
| Dispatch gate | `supabase/functions/adapter-dispatch/bankMatchGuard.ts` | re-reads the approved match request under the caller's JWT |
| Screens | `pmo-portal/pages/finance/BankBook.tsx`, `pages/finance/Reconciliation.tsx` + `src/lib/repositories/bankBook.ts` | book per account × month, import, match, sign-off — same screens for every client |

### Ledger line identity

The bank book matches against *ledger lines*, not mirror rows. An Odoo line is split into one mirror row per analytic
share (`odoo/ledger/ledgerLineRows.ts`), so the bank book groups rows by line:

```sql
-- the stable ref of one ledger line: 'odoo:<account.move.line id>' | 'erpnext:<voucher_type>:<voucher_no>' | 'pmo:<table>:<uuid>'
create or replace function public.bank_ledger_line_ref(p_voucher_type text, p_voucher_no text, p_erp_name text)
  returns text language sql immutable set search_path = pg_catalog, public as $$
  select case when p_voucher_type = 'account.move'
              then 'odoo:' || public.odoo_ledger_line_id(p_erp_name)::text
              else 'erpnext:' || p_voucher_type || ':' || p_voucher_no end
$$;
```

ERPNext matches a **voucher** (Payment Entry, Journal Entry, Purchase Invoice, Sales Invoice — the
`bank_reconciliation_doctypes` hook, `erpnext/hooks.py:609`), not a GL Entry, so the ERPNext ref is the voucher; its
amount is the sum of the voucher's GL rows on the bank account (`get_related_bank_gl_entries`,
`bank_transaction.py:485`, does the same).

```sql
-- every ledger line on one bank account in a date range; amount = debit - credit (money in is positive)
create or replace function public.bank_ledger_lines(p_bank_account_id uuid, p_from date, p_to date)
  returns table (ledger_line_ref text, posting_date date, amount numeric, voucher_no text, party text)
  language sql stable security definer set search_path = pg_catalog, public as $$
  select public.bank_ledger_line_ref(m.voucher_type, m.voucher_no, m.erp_name), min(m.posting_date),
         sum(m.debit - m.credit), min(m.voucher_no), min(m.party)
    from public.bank_accounts b
    join public.erp_gl_entry_mirror m
      on m.org_id = b.org_id and m.account = any(b.ledger_match_accounts) and not m.is_cancelled
   where b.id = p_bank_account_id and b.org_id = public.auth_org_id()
     and m.posting_date between p_from and p_to
   group by 1
  union all
  select * from public.bank_native_ledger_lines(p_bank_account_id, p_from, p_to)   -- no-ERP org only; empty otherwise
$$;
```

`ledger_match_accounts` is the bank GL account for ERPNext and no-ERP clients, and for Odoo the journal's **outstanding
receipt and payment accounts** (Odoo's default: a payment posts its liquidity line to an outstanding account and waits
for a statement line, `account_payment.py:497-524`). The ledger **balance** is always the bank GL account alone:
`sum(debit - credit)` with `posting_date <= d`, read from the mirror, never stored as authoritative (FR-ACD-012); every
balance on screen carries the mirror health `asOf`, `caughtUp` and `check`.

**Exact money (FR-ACD-112).** Statement amounts travel as strings and land in `numeric(18,2)`. The parser uses the
exact-decimal helpers of `pmo-portal/src/lib/adapterSeam/odoo/ledger/cents.ts` (`toNano`, `formatCents`); no `Number`
sums anywhere. The server recomputes every total it checks from stored or mirrored rows; a client-sent total is never
trusted; every amount sent to an ERP is formatted from stored `numeric`.

**Match rule (FR-ACD-052, AC-ACD-011), every client.** A match is a set of statement lines and a set of ledger lines on
**one** bank account; it nets to zero: `Σ statement.amount − Σ ledger.amount = 0` exactly. Confirm is always a person's
act; the proposer never writes. An item sits in at most one live match — enforced by partial unique indexes on PMO rows
(no-ERP) and by the ERP itself plus a PMO refusal while an outbox command for the same item is in flight (ERP).

### The ERP write, per ERP (ruling 5)

#### ERPNext — Bank Transaction with its vouchers

Source: `frappe/erpnext` `develop` at `127a7e1` (2026-11-15).

- **Doctype `Bank Transaction`** (`erpnext/accounts/doctype/bank_transaction/bank_transaction.json`, submittable). Fields
  PMO writes: `date`, `bank_account` (Link **Bank Account** — the ERPNext Bank Account record whose `account` is the GL
  account), `company`, `currency`, `deposit` or `withdrawal`, `description`, `reference_number`, `transaction_id`
  (PMO's `bank_statement_lines.id`, the idempotency anchor), and child table **`payment_entries`** (doctype `Bank
  Transaction Payments`: `payment_document`, `payment_entry`, `allocated_amount`, `clearance_date`,
  `reconciliation_type` — **v16 only**; v15 has no such field and drops it silently, so PMO omits it there).
  **Bed-verified on v15.94 and v16.53 (bed probe 2026-11-16)**, with the differences listed below.
- **The smallest write:** insert the Bank Transaction and submit it (`docstatus = 1`) with one `payment_entries` row per
  matched voucher, `allocated_amount = 0` (ERPNext sets it to the voucher's bank amount), `reconciliation_type =
  'Matched'` on v16 only. One call; a refusal leaves no draft. On submit, `BankTransaction.before_submit`
  (`bank_transaction.py:134`) calls `allocate_payment_entries` (`:177`), which allocates each voucher's bank-GL amount
  and calls `clear_linked_payment_entry` (`:259`), which sets **`clearance_date`** on the voucher
  (`frappe.db.set_value(doctype, docname, "clearance_date", …)`, `:276`; Sales Invoice sets it on `Sales Invoice
  Payment`, `:264`). `set_status` (`:86`) makes `status = 'Reconciled'` when `unallocated_amount` is 0. `clearance_date`
  is what ERPNext's own bank reconciliation statement reads, so ERPNext's books show the match. No GL Entry is created.
- **Adding vouchers to a Bank Transaction that already exists** (a match confirmed in two steps, or a line ERPNext already
  holds): whitelisted `reconcile_vouchers(bank_transaction_name, vouchers, is_new_voucher=False)`
  (`erpnext/accounts/doctype/bank_reconciliation_tool/bank_reconciliation_tool.py:1220`) → `_reconcile_vouchers`
  (`:1244`) → `BankTransaction.add_payment_entries` (`bank_transaction.py:156`) → `allocate_payment_entries`. It checks
  `write` permission on the Bank Transaction and on each voucher.
- **Read-back (spec FR-ACD-055b; never `status` alone):** `Bank Transaction` `status`, `allocated_amount`,
  `unallocated_amount`, `payment_entries[*]` (`payment_document`, `payment_entry`, `allocated_amount`, `clearance_date`),
  and each voucher's `clearance_date`. Confirmed only when the voucher **is in `payment_entries`**, its `allocated_amount`
  **equals the voucher's bank amount**, the voucher's `clearance_date` is set (to the Bank Transaction's `date`), and
  `status = 'Reconciled'`, `unallocated_amount = 0`. An allocated amount below the voucher's is **Partial**, never
  Matched. A second Bank Transaction made for an already-matched voucher reads `Unreconciled` with the voucher dropped, so
  `status` alone cannot tell "mine matched" from "an empty second row".
- **Two bed traps (both versions):** (1) a short amount (300,000 against 400,000) is accepted, allocates 300,000 and
  leaves the voucher uncleared; (2) `transaction_id` is **not unique**: a retry makes a second Bank Transaction, and a
  draft with the same id is accepted too.
- **Undo one voucher, by version.** v16: whitelisted `unreconcile_transaction_entry(bank_transaction_id, voucher_type,
  voucher_id)` (`bank_transaction.py:404`; idempotent). For `reconciliation_type = 'Matched'` it removes the row and
  clears the voucher's `clearance_date`; for `'Voucher Created'` it **cancels the voucher**, so PMO always writes
  `'Matched'` and its undo refuses any row that is not. **v15 has no such method** (417 "has no attribute"): undo is `PUT`
  the submitted Bank Transaction with `payment_entries: []` and its current `modified`. Both read back `Unreconciled`,
  unallocated full, `clearance_date` empty; a re-match is `PUT payment_entries`.
- **Find before write (spec FR-ACD-055a):** look the line up by `transaction_id` before any write, not only after a lost
  answer; the lookup tolerates several rows. A record exists → adopt it if its read-back shows this voucher matched, else
  hold; never a second insert.
- **Amount (spec FR-ACD-055e):** send only when the statement amount equals the voucher's bank amount; a different amount
  is refused before any write unless the person explicitly confirmed a partial (shown Partial).
- **Roles (bed-verified):** Accounts User or Accounts Manager is enough for create, lookup, voucher read and undo; System
  Manager is not needed.

#### Odoo Community — core `account` module only

Source: `odoo/odoo` `18.0` at `33b9aa4` (2026-11-14). Odoo 18 Community core has the **models** for bank statement lines
and reconciliation; it does **not** have the bank reconciliation screen (Enterprise `account_accountant`) — PMO does not
need that screen, because the screen is PMO's (ruling 1).

What exists **without extra modules** (`addons/account/models/`):

- **`account.bank.statement.line`** (`account_bank_statement_line.py`). `create` (`:382`) accepts the non-field key
  **`counterpart_account_id`** (`:407`, "force different account instead of the suspense account"), builds the move with
  a liquidity line on the journal's default (bank) account and the counterpart on that account
  (`_prepare_move_line_default_vals`, `:633`), and **posts it** (`:435`). Fields PMO writes: `journal_id`, `date`,
  `amount`, `payment_ref`, `partner_id` (optional), plus `counterpart_account_id`.
- **`account.move.line.reconcile()`** (`account_move_line.py:3231`) reconciles posted lines on one account; it accepts a
  reconcilable account (outstanding accounts are) and also bank accounts (`:2498`).
- **Reconciled state Odoo computes itself:** `account.bank.statement.line.is_reconciled` / `amount_residual`
  (`_compute_is_reconciled`, `:304`) and `account.payment.is_matched` (`account_payment.py:497-524`). **Bed-verified on
  Odoo 20 (bed probe 2026-11-16): a statement line made with `counterpart_account_id` already reads `is_reconciled` true
  and `amount_residual` 0 at create, before any reconcile, so those fields do not prove the payment match.**
- **Undo:** `account.move.line.remove_move_reconcile()` (`account_move_line.py:3235`) and `account.bank.statement.line`
  `unlink` (`:445`; under the company's audit trail it cancels the move instead), or
  `action_undo_reconciliation` (`:475`), which resets the line to the journal's **suspense** account. **Bed order:**
  `remove_move_reconcile` on the two lines (statement line still reads `is_reconciled` true), then
  `action_undo_reconciliation` (counterpart to Bank Suspense; the payment survives, `is_matched` false), then `unlink` to
  take the bank balance back. With the company audit trail **on**, `unlink` leaves the statement move in state `cancel`:
  the accountant sees one cancelled move per undone match, and the undo screen says so (spec FR-ACD-055d).

**The smallest write (match against a payment or invoice line):** (1) `account.bank.statement.line` `create` with
`counterpart_account_id` = the outstanding account of the matched line(s) — Odoo posts it; (2) `account.move.line`
`reconcile` on [the new move's counterpart line + the matched outstanding line(s)]. Odoo then shows the statement line
reconciled and the payment matched, and the bank GL account carries the movement — which is why, for Odoo, the bank
balance moves only when PMO writes statement lines and the unmatched ledger side is the outstanding accounts.
**Fee or interest line:** one `create` with `counterpart_account_id` = the fee (or interest) account and no reconcile —
this **is** a ledger posting, so it is sent only after piece 1's approval (approver ≠ preparer) of the prefilled journal,
and piece 1 does **not** post that journal separately on Odoo (it would book the fee twice).
**Read-back (spec FR-ACD-055c):** the **counterpart line** `reconciled` true with `amount_residual` 0 and
`full_reconcile_id` set, and the **payment** `is_matched` true with `reconciled_statement_line_ids` holding the statement
line; never the statement line's `is_reconciled`. The statement move's Bank line stays unreconciled with a non-zero
residual by design: "every residual 0" excludes it. A second reconcile is refused (422 "already reconciled").
**Find before write (FR-ACD-055a):** search `account.bank.statement.line` by `payment_ref` carrying PMO's line id and
journal **before any create**; `payment_ref` is not unique (a second create is accepted). Exists → adopt only if the
read-back shows this payment matched, else hold; never a second create.
**Amount (FR-ACD-055e):** Odoo amount mismatch is not probed, so any difference is refused (no partial offered).

What would need an **extra module** (none is used by this plan; #2163 decides whether any may be installed):

- a reconciliation *screen* inside Odoo (Enterprise `account_accountant`, or OCA `account_reconcile_oca`) — not needed;
- a CSV/OFX statement importer inside Odoo (Enterprise `account_bank_statement_import_*`, OCA `account_statement_import_*`)
  — not needed, PMO imports;
- reconciliation models driven from the import (OCA) — not needed, PMO proposes.

Bed facts (bed probe 2026-11-16, Odoo 20): `counterpart_account_id` is accepted through the external API `create`;
create, reconcile, undo and `unlink` work for a user holding **Basic** (`account.group_account_basic`) or **Show Full
Accounting Features** (`account.group_account_user`) and are refused (403) for the shipped bot, Billing, Billing + Access
Rights and Adviser (Gap G-8); `unlink` of a PMO-created line deletes its move with the audit trail off and leaves it
`cancel` with the trail on. Task 35 proves the shipped adapter does the same, end to end.

### Sign-off rule (FR-ACD-054, §7), every client

For account `a` and month `M` (first to last day):

```
statement_closing(M)  = closing_balance of the import whose period_to = last day of M   (none → refused)
ledger_balance(M)     = Σ(debit − credit) on a's bank GL account (or native rows) with posting_date ≤ last day of M
unmatched_statement   = Σ amount of a's statement lines dated in or before M with no live match
unmatched_ledger      = Σ amount of a's ledger lines dated in or before M with no live match
difference            = statement_closing − ledger_balance
signable  ⇔  difference = unmatched_statement − unmatched_ledger   (to the unit)
          ∧  signer is Finance+ ∧ signer ∉ importers of every import overlapping M
          ∧  no ERP match command for a is in flight or held
          ∧  the ledger mirror is caught up and its last check matched (ERP clients)
          ∧  every earlier month of a that has an import is signed off
```

"Live match" is `bank_match_items.live` for a no-ERP client and **the read-back in `erp_bank_match_mirror`** for an ERP
client. The sign-off stores all five figures; a later change to any of them shows **Changed since sign-off** (computed on
read).

**SoD predicate (FR-ACD-100), one function:**

```sql
create or replace function public.may_sign_off_bank_month(p_bank_account_id uuid, p_month date, p_signer uuid)
  returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce((
    select public.role_rank(p.role) >= public.role_rank('Finance'::user_role)
           and p.org_id = b.org_id
           and not exists (select 1 from public.bank_statement_imports i
                            where i.bank_account_id = b.id
                              and daterange(i.period_from, i.period_to, '[]')
                                  && daterange(date_trunc('month', p_month)::date,
                                               (date_trunc('month', p_month) + interval '1 month - 1 day')::date, '[]')
                              and i.imported_by is not distinct from p_signer)
      from public.bank_accounts b join public.profiles p on p.id = p_signer
     where b.id = p_bank_account_id), false)
$$;
```

**Tradeoffs.** Writing every match to the ERP costs one outbox round trip per confirm and makes the screen show "sending"
until the read-back lands; in exchange there is never a PMO answer that disagrees with the ERP. Writing an Odoo statement
line only at match time keeps unmatched lines out of Odoo, so Odoo's bank GL balance lags the statement by the unmatched
lines — the sign-off arithmetic accounts for exactly that. Grouping mirror rows per line costs a `group by` per read;
this piece adds the index `(org_id, account, posting_date)` on `erp_gl_entry_mirror` (NFR-ACD-002).

## Migrations

Two migrations, each **migration number needed** (the coordinator assigns; on collision
`scripts/renumber-migration.sh <old> <new>`), each reversible with a `rollback/` file that drops only what it created.

**S2/S3 — `supabase/migrations/<migration number needed>_bank_book.sql`:**

```sql
create table public.bank_accounts (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null default public.auth_org_id() references public.organizations(id) on delete cascade,
  label            text not null check (length(btrim(label)) between 1 and 120),
  ledger_account   text not null,             -- bank GL account code, as in erp_gl_entry_mirror.account
  ledger_match_accounts text[] not null,      -- see "Ledger line identity"; set by upsert_bank_account
  ledger_journal   text,                      -- Odoo account.journal external id
  erp_bank_account text,                      -- ERPNext Bank Account name (Bank Transaction.bank_account)
  currency         text not null default 'IDR' check (currency = 'IDR'),   -- OQ-B4, ruling 3
  column_map       jsonb not null,            -- ruling 3: {date, description, amount | debit+credit, reference, date_format, decimal}
  created_by       uuid not null references public.profiles(id),
  created_at       timestamptz not null default now(),
  unique (org_id, ledger_account)
);
create table public.bank_statement_imports (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null default public.auth_org_id() references public.organizations(id) on delete cascade,
  bank_account_id  uuid not null references public.bank_accounts(id),
  period_from      date not null,
  period_to        date not null check (period_to >= period_from),
  opening_balance  numeric(18,2) not null,
  closing_balance  numeric(18,2) not null,
  file_sha256      text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  imported_by      uuid not null references public.profiles(id),
  imported_at      timestamptz not null default now(),
  unique (bank_account_id, file_sha256)
);
alter table public.bank_statement_imports add constraint bank_statement_imports_no_overlap
  exclude using gist (bank_account_id with =, daterange(period_from, period_to, '[]') with &&);   -- needs btree_gist
create table public.bank_statement_lines (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null default public.auth_org_id() references public.organizations(id) on delete cascade,
  import_id        uuid not null references public.bank_statement_imports(id) on delete cascade,
  bank_account_id  uuid not null references public.bank_accounts(id),
  line_no          int  not null,
  value_date       date not null,
  description      text not null default '',
  reference        text,
  amount           numeric(18,2) not null check (amount <> 0),   -- money in is positive
  unique (import_id, line_no)
);
-- no-ERP clients only (ruling 4): confirm_bank_match refuses for an org whose ledger an ERP owns
create table public.bank_matches (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null default public.auth_org_id() references public.organizations(id) on delete cascade,
  bank_account_id  uuid not null references public.bank_accounts(id),
  source           text not null check (source in ('person','journal')),
  confirmed_by     uuid references public.profiles(id),
  journal_id       uuid references public.journal_entries(id),
  removed_at       timestamptz,
  created_at       timestamptz not null default now(),
  check ((source = 'person') = (confirmed_by is not null and journal_id is null))
);
create table public.bank_match_items (
  match_id          uuid not null references public.bank_matches(id) on delete cascade,
  org_id            uuid not null default public.auth_org_id() references public.organizations(id) on delete cascade,
  statement_line_id uuid references public.bank_statement_lines(id),
  ledger_line_ref   text,
  amount            numeric(18,2) not null,     -- copied by the server, never from the client
  live              boolean not null default true,
  check ((statement_line_id is null) <> (ledger_line_ref is null))
);
create unique index bank_match_items_one_live_stmt on public.bank_match_items (statement_line_id) where live and statement_line_id is not null;
create unique index bank_match_items_one_live_ledger on public.bank_match_items (org_id, ledger_line_ref) where live and ledger_line_ref is not null;
create table public.bank_line_journals (
  statement_line_id uuid primary key references public.bank_statement_lines(id),
  journal_id        uuid not null unique references public.journal_entries(id),
  org_id            uuid not null default public.auth_org_id() references public.organizations(id) on delete cascade
);
create table public.bank_reconciliations (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null default public.auth_org_id() references public.organizations(id) on delete cascade,
  bank_account_id     uuid not null references public.bank_accounts(id),
  month               date not null check (month = date_trunc('month', month)::date),
  statement_closing   numeric(18,2) not null,
  ledger_balance      numeric(18,2) not null,
  unmatched_statement numeric(18,2) not null,
  unmatched_ledger    numeric(18,2) not null,
  mirror_as_of        timestamptz,                 -- null only for a no-ERP client
  signed_by           uuid not null references public.profiles(id),
  signed_at           timestamptz not null default now(),
  unique (bank_account_id, month)
);
create index erp_gl_entry_mirror_org_account_date_idx on public.erp_gl_entry_mirror (org_id, account, posting_date);
-- RLS: enable + force on all seven; one SELECT policy each:
--   org_id = auth_org_id() and is_active_member() and auth_role()::text in ('Admin','Executive','Finance')
-- Grants: revoke insert, update, delete from anon, authenticated; grant select to authenticated.
```

**S4/S5 — `supabase/migrations/<migration number needed>_bank_erp_match.sql`:**

```sql
create type public.erp_bank_match_state as enum ('sending','confirmed','held','refused','unmatching','unmatched');
-- a MIRROR of what the ERP holds, keyed by the ERP's own record; written only by record_erp_bank_match_readback
-- (service role) from a read-back. It is never the answer to "is this matched" until state = 'confirmed'.
create table public.erp_bank_match_mirror (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null default public.auth_org_id() references public.organizations(id) on delete cascade,
  bank_account_id    uuid not null references public.bank_accounts(id),
  erp                text not null check (erp in ('erpnext','odoo')),
  statement_line_ids uuid[] not null,
  ledger_line_refs   text[] not null,
  erp_record_ref     text,                       -- 'Bank Transaction:<name>' | 'account.bank.statement.line:<id>'
  state              public.erp_bank_match_state not null default 'sending',
  requested_by       uuid not null references public.profiles(id),
  held_reason        text,
  read_back          jsonb,                      -- the ERP's answer, verbatim fields listed in the adapter
  read_back_at       timestamptz
);
create unique index erp_bank_match_one_live_stmt on public.erp_bank_match_mirror
  using gin (statement_line_ids) where state in ('sending','confirmed','held','unmatching');   -- plus an RPC check: GIN is not unique
-- RLS as above; grants select only.
```

Definer RPCs (each `security definer set search_path = pg_catalog, public`, `revoke all … from public, anon`, `grant
execute … to authenticated` unless noted, each starting with the org / active-member / role check and raising `42501`):

| RPC | Slice | Does | Refuses |
|---|---|---|---|
| `upsert_bank_account(p_id, p_label, p_ledger_account, p_ledger_journal, p_erp_bank_account, p_column_map) returns uuid` | S2 | Admin marks a ledger bank account and its column map (ruling 3); sets `ledger_match_accounts` | not Admin (42501); account not a live `asset_cash` account in `external_master_records` (ERP org) or not a bank account in PMO's chart (no-ERP) (P0001 "not a bank account in the ledger"); ERPNext org without `p_erp_bank_account` (P0001, Gap G-1); map missing `date` or an amount column (22023) |
| `import_bank_statement(p_bank_account, p_from, p_to, p_opening text, p_closing text, p_sha256, p_lines jsonb) returns uuid` | S2 | stores the import and its lines (FR-ACD-051) | not Finance+; opening ≠ previous closing (P0001 naming both); Σ lines ≠ closing − opening (P0001 "lines sum to"); a line outside the range (22023); overlap (23P01 → "overlaps the import of"); a signed-off month (P0001); same file (23505 → "already imported") |
| `bank_ledger_lines(p_bank_account, p_from, p_to)` | S2 | the ledger side (above) | not Finance+ |
| `confirm_bank_match(p_bank_account, p_statement_line_ids uuid[], p_ledger_line_refs text[]) returns uuid` | S3 | one `person` match, **no-ERP org only** | ERP org (P0001 "this client's matches are kept in its ERP", detail `erp-owned`); not Finance+; item on another account; already live (23505); net ≠ 0 (P0001 "does not net to zero by"); a signed-off month |
| `remove_bank_match(p_match uuid)` | S3 | sets `removed_at`, items `live = false` | ERP org; signed-off month; not Finance+ |
| `start_journal_from_statement_line(p_line, p_kind, p_counter_account) returns uuid` | S3 | a piece-1 draft (fee: Dr counter / Cr bank; interest: Dr bank / Cr counter) and the `bank_line_journals` link | kind not `fee`/`interest`; line matched or linked (23505); not Finance+ |
| `match_posted_statement_journals(p_bank_account) returns int` | S3 | no-ERP: a `journal` match per posted linked journal; ERP org: queues `request_erp_bank_match` for it instead | not Finance+ |
| `get_bank_book(p_bank_account, p_month) returns jsonb` | S3 | the five figures, matched/unmatched per side (ERP org: from `erp_bank_match_mirror` `confirmed`), in-flight and held commands, `signable` + reasons, mirror health, `changedSinceSignOff` | not Finance+ |
| `sign_off_bank_month(p_bank_account, p_month) returns uuid` | S3 | stores the figures | not `may_sign_off_bank_month` (42501); difference not explained (P0001); no import ending on the last day; stale mirror; a command in flight or held (P0001 "a match is still being sent to the ERP"); earlier month unsigned |
| `request_erp_bank_match(p_bank_account, p_statement_line_ids, p_ledger_line_refs) returns uuid` | S4/S5 | ERP org: checks net zero and freedom exactly like `confirm_bank_match`, inserts a `sending` mirror row and the outbox command (domain `accounting`, key `bank-match:<uuid>`, hold-on-doubt) in one transaction | no-ERP org; not Finance+; net ≠ 0; an item in a live mirror row (23505); signed-off month; *(a workflow that is not `supported` is refused before this RPC, by the repository (Task 40) and the dispatch gate (Tasks 21, 28): the declaration is TypeScript, not a table, so the RPC cannot read it)* |
| `request_erp_bank_unmatch(p_mirror uuid)` | S4/S5 | `confirmed` → `unmatching` + outbox command key `bank-unmatch:<uuid>` | not `confirmed`; signed-off month; not Finance+ |
| `approved_erp_bank_match_for_push(p_mirror uuid) returns jsonb` | S4/S5 | the dispatch gate's re-read: amounts and refs from stored rows and the mirror, never the payload | state not `sending`/`held`/`unmatching`; caller not Finance+ |
| `record_erp_bank_match_readback(p_mirror uuid, p_state, p_erp_record_ref, p_read_back jsonb, p_reason text)` | S4/S5 | service role only | any other caller |

## Commands and test discipline

- From `pmo-portal/`: `npx vitest run <file>`; from repo root: `deno test --allow-env --allow-net --allow-read <file>`.
- pgTAP: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/bank_book.test.sql'` —
  reset and test in ONE lock hold, only in the Director's scheduled DB slot. Read the TAP body for `not ok` and parse
  errors; never trust `$?` through a pipe.
- ERPNext bed: `scripts/with-erpnext-lock.sh …`; Odoo bed: `scripts/with-odoo-lock.sh …`; only when the Director grants
  bed access; a bed test fails, never skips, when its settings are absent. Lock order `erpnext → db → test`.
- **Mutation checks** on every money/SoD/write rule (Tasks 3, 7, 8, 12, 14, 19, 26, 37, 38, 39, 40, 41): break it, the owning test goes red,
  restore it, and paste both runs in the PR.

## Tasks

### Task 0 — spec alignment (docs, before S2)

**Task 0.** On `origin/docs/accountants-desk-design-fwzy4j`, the spec owner rewrites §5, FR-ACD-054, FR-ACD-055 and
FR-ACD-057 of `docs/specs/accountants-desk.spec.md` to rulings 1–6, as EARS: "Where the organization's ledger is owned by
an ERP, when a person confirms a bank match, the system shall write the match to that ERP and show it as matched only
after reading it back." / "Where no ERP owns the ledger, the system shall store the match as the organization's record."
/ "The system shall not store a second reconciliation record for an ERP-owned ledger." Add AC-ACD-035 (ERPNext), AC-ACD-036 (Odoo) and
AC-ACD-037 (no ERP) below (done in the spec at `7b9dd0914`; the ids 032–034 were already tax ACs). Owner signs the spec before S2 starts.

### S1. Pure logic (no DB)

**Task 1 — statement parser, happy path (AC-ACD-010 client half).** Create
`pmo-portal/src/lib/import/__tests__/bankStatementParser.test.ts`: a CSV with header `Tanggal,Keterangan,Debet,Kredit`
and map `{date:'Tanggal', description:'Keterangan', debit:'Debet', credit:'Kredit', date_format:'DD/MM/YYYY',
decimal:','}` parses `01/11/2026,Biaya adm,"6.500,00",` to `{ value_date:'2026-11-01', amount:'-6500.00',
description:'Biaya adm' }`. Run `npx vitest run src/lib/import/__tests__/bankStatementParser.test.ts` (red: module
missing). Create `bankStatementParser.ts` over `readCsvGrid`, exact decimals through `toNano`/`formatCents`. Rerun green.

**Task 2 — parser refusals.** Add: a row with both debit and credit → rejected with its row number; an unparseable date
→ rejected; a single `amount` column map with `-6.500,00` → `-6500.00`; > 5,000 rows or > 5 MB → refused (mirror the
caps of `fxRateParser.ts`); a `.pdf` file → refused "this bank's statement must be a CSV" (ruling 3). Return
`{ lines, rejected }`; an import with any rejected row cannot be sent. Rerun.

**Task 3 — exact totals.** Add: `statementTotals(lines)` sums `0.10` × 3 to `0.30` exactly; `checkBalances(opening,
closing, lines)` returns `{ ok:false, moved:'…', summed:'…' }` when they differ by 0.01. Mutation: compute with
`Number(...)` sums; add `0.1 + 0.2` vs `0.3` if needed to force red; restore. Rerun.

**Task 4 — match proposer (FR-ACD-052, ruling 3).** Create `pmo-portal/src/lib/bankBook/proposeMatches.test.ts`:
statement `-6500.00` on 2026-11-03 and ledger `-6500.00` on 2026-11-01 → one proposal; ledger on 2026-10-30 (4 days) →
none; two equal ledger lines in the window → both returned as candidates, none chosen; already-matched items and items
with a command in flight are never proposed. Create `proposeMatches.ts` (pure, `windowDays = 3`; proposal shape and the spec's own case: Task 37). Run
`npx vitest run src/lib/bankBook/proposeMatches.test.ts`.

**Task 5 — sign-off arithmetic (FR-ACD-054).** Create `pmo-portal/src/lib/bankBook/reconcileMonth.test.ts`: statement
closing 1,000,000.00, ledger 1,006,500.00, unmatched statement −6,500.00, unmatched ledger 0 → `signable`; ledger
1,006,500.01 → not signable with "the difference -6500.00 is not explained by unmatched items (-6500.01)"; one command
`sending` → not signable "a match is still being sent to the ERP". Screen only; the server decides (Task 14). Create
`reconcileMonth.ts`. Rerun.

**Task 6 — workflow ids (AC-ACD-024).** In `pmo-portal/src/lib/adapterSeam/connect/workflows.ts` add
`'ledger.read-period': { version: 1, summary: 'read one account\'s ledger lines and balance for a date range from the mirror' }`
and `'bank.reconcile-match': { version: 1, summary: 'write one confirmed bank match to the ERP\'s own reconciliation and read it back' }`.
Run `npm run typecheck` (red: tier tables miss the keys). Declare `ledger.read-period` `supported` on Odoo and ERPNext
(the shipped mirror); `bank.reconcile-match` `pending`, issue 896, on both (`odoo/workflowDeclarations.ts`,
`erpnext/workflowDeclarations.ts`). Rerun green. Tasks 34 and 35 flip each to `supported` only when their bed proof
passes.

**Task 37 — the proposer on the spec's own case (AC-ACD-038).** Write these two cases in
`pmo-portal/src/lib/bankBook/proposeMatches.test.ts` together with Task 4's, before `proposeMatches.ts` exists (red:
module missing). This task fixes the proposal shape, and Task 4 adopts it: `{ statementLineId: string; candidates:
string[] }`, `candidates` being ledger line refs; amounts are strings; inputs are read-only.

```ts
it('AC-ACD-038 proposes only the 12 Nov ledger line for a 10 Nov statement line, and confirms nothing', () => {
  const statement = Object.freeze([Object.freeze({ id: 's1', valueDate: '2026-11-10', amount: '-6500.00' })]);
  const ledger = Object.freeze([
    Object.freeze({ ref: 'odoo:101', postingDate: '2026-11-12', amount: '-6500.00' }),
    Object.freeze({ ref: 'odoo:102', postingDate: '2026-11-14', amount: '-6500.00' }),
  ]);
  expect(proposeMatches(statement, ledger)).toEqual([{ statementLineId: 's1', candidates: ['odoo:101'] }]);
});

it('a ledger line exactly 3 days after the statement line is proposed; 4 days is not', () => {
  const statement = [{ id: 's1', valueDate: '2026-11-10', amount: '-6500.00' }];
  const ledger = [
    { ref: 'odoo:103', postingDate: '2026-11-13', amount: '-6500.00' },
    { ref: 'odoo:104', postingDate: '2026-11-14', amount: '-6500.00' },
  ];
  expect(proposeMatches(statement, ledger)).toEqual([{ statementLineId: 's1', candidates: ['odoo:103'] }]);
});
```

The first case passes frozen inputs, so a proposer that writes to its input throws, and its strict `toEqual` allows no
`confirmed` field: a proposal is data, never an act. "A person confirms" is proved on the screen by Task 32 ("a proposal
is never confirmed without a click"). Run `npx vitest run src/lib/bankBook/proposeMatches.test.ts` (red), build Task 4's
`proposeMatches.ts` with `windowDays = 3` on `|statement.valueDate − ledger.postingDate|`, rerun green. Mutation:
`windowDays = 5`; the 14 Nov line appears and both cases go red; restore.

### S2. Bank accounts and statement import — DB, money tier, auth tier, migration number needed

**Task 7 — pgTAP first: read-only tables, tenancy (AC-ACD-020).** Create `supabase/tests/bank_book.test.sql`
(`begin; select plan(n); … select * from finish(); rollback;`, fixtures as `supabase/tests/0015_procurement_sod.test.sql:35`):
as a Project Manager and as an Engineer, `select count(*)` on each of the seven tables is 0 and each RPC raises 42501;
as Finance a direct `insert`/`update`/`delete` raises 42501; a Finance member of a second org sees 0 rows and
`bank_ledger_lines` on the first org's account returns 0 rows. Write the migration skeleton. Run the pgTAP command. Red
before the policies, green after. Mutation: drop one table's `force row level security`; its case goes red; restore.

**Task 8 — mark a bank account (ruling 3).** Add: Admin marks a live `asset_cash` account → row; **Finance → 42501**;
**Executive → 42501**; an `expense` account → P0001 "not a bank account in the ledger"; `currency = 'USD'` → check
violation; an ERPNext-org call without `p_erp_bank_account` → P0001; an Odoo-org row's `ledger_match_accounts` holds the
journal's outstanding accounts from `external_master_records`. Implement `upsert_bank_account`. Rerun. Mutation: accept
Finance; the Finance case goes red; restore.

**Task 9 — import refusals (AC-ACD-010).** Add: first import opening 1,000,000.00 closing 993,500.00 with one line
−6,500.00 → stored; next import opening 993,501.00 → P0001 containing both `993,501.00` and `993,500.00`; lines summing to
−6,500.01 against a move of −6,500.00 → "lines sum to"; an overlap → "overlaps the import of"; same `p_sha256` →
"already imported"; zero rows remain after each refusal. Implement `import_bank_statement` (`org_id` never from the
client). Rerun. Mutation: compare opening to the previous *opening*; red; restore.

**Task 10 — ledger side, every client.** Add: an Odoo line split 60/40 across two analytics on an outstanding account
→ one line, summed; a cancelled row excluded; ERPNext GL rows of one Payment Entry on the bank account →
`erpnext:Payment Entry:<name>`, summed; a no-ERP org with one native receipt into the bank → one `pmo:incoming_payments:<id>`
line from `bank_native_ledger_lines`, and an ERP org gets no native lines. Implement `bank_ledger_line_ref`,
`bank_native_ledger_lines` (sources: `incoming_payments` `pmo_native`, and the native cash rows
`0319_financial_statement_native_reports.sql` reads) and `bank_ledger_lines`. Rerun.

**Task 38 — only an Admin marks an account or sets its column layout (AC-ACD-040).** Add to
`supabase/tests/bank_book.test.sql`, written with Task 8 before `upsert_bank_account` exists (red: function missing).
Fixture ids are the ones the file's setup block defines in Task 7 (an Admin, a Finance member, an existing
`bank_accounts` row whose `column_map` date column is `Tanggal`):

```sql
-- Finance: marking, and setting a layout on the existing account, are refused; a direct write is refused
set local role authenticated;
set local request.jwt.claims = '{"sub":"00896000-0000-0000-0000-0000000000f1","role":"authenticated"}';  -- Finance
select throws_ok($$ select upsert_bank_account(null, 'Main', '1-1100', null, null,
  '{"date":"Tanggal","amount":"Jumlah","date_format":"DD/MM/YYYY","decimal":","}'::jsonb) $$,
  '42501', null, 'AC-ACD-040: Finance cannot mark a bank account');
select throws_ok($$ select upsert_bank_account('00896000-0000-0000-0000-0000000000b1', 'Main', '1-1100', null, null,
  '{"date":"Date","amount":"Amount","date_format":"YYYY-MM-DD","decimal":"."}'::jsonb) $$,
  '42501', null, 'AC-ACD-040: Finance cannot set a column layout');
select throws_ok($$ update public.bank_accounts set column_map = '{}'::jsonb $$,
  '42501', null, 'AC-ACD-040: a direct update of the layout is refused');
reset role;
select is((select column_map->>'date' from public.bank_accounts where id = '00896000-0000-0000-0000-0000000000b1'),
  'Tanggal', 'AC-ACD-040: the layout is unchanged after the refusals');

-- Admin: the same two calls are saved
set local role authenticated;
set local request.jwt.claims = '{"sub":"00896000-0000-0000-0000-0000000000a1","role":"authenticated"}';  -- Admin
select lives_ok($$ select upsert_bank_account('00896000-0000-0000-0000-0000000000b1', 'Main', '1-1100', null, null,
  '{"date":"Date","amount":"Amount","date_format":"YYYY-MM-DD","decimal":"."}'::jsonb) $$,
  'AC-ACD-040: an Admin sets the column layout');
reset role;
select is((select column_map->>'date' from public.bank_accounts where id = '00896000-0000-0000-0000-0000000000b1'),
  'Date', 'AC-ACD-040: the Admin''s layout is saved');
```

Add the same Finance-refused pair for an Executive (`42501`), as Task 8 does for marking. Run the pgTAP command for
`bank_book.test.sql` (red before `upsert_bank_account`, green after Task 8). Mutation (different from Task 8's): in
`upsert_bank_account`, let the update branch (`p_id is not null`) skip the Admin check while the insert branch keeps it;
the "Finance cannot set a column layout" case goes red and the "Finance cannot mark" case stays green; restore. Task 8
owns marking, this task owns the layout and the AC id.

### S3. No-ERP matching and sign-off — DB, money tier (SoD), auth tier, same migration as S2

**Task 11 — the ERP-owned refusal (ruling 4).** Add: for an org whose ledger an ERP owns, `confirm_bank_match` →
P0001 detail `erp-owned` and zero `bank_matches` rows; `remove_bank_match` likewise. Implement the guard first in both
RPCs. Rerun.

**Task 12 — confirm a match (AC-ACD-011), no-ERP org.** Add: statement −6,500.00 vs ledger −6,499.00 → "does not net to
zero by -1.00", zero rows; statement −6,500.00 vs two ledger lines −4,000.00 and −2,500.00 → one match, three items; the
same ledger line again → "already matched"; another account's ref → P0001; stored amounts equal the source amounts in
any client order. Implement `confirm_bank_match` and `remove_bank_match`. Rerun. Mutation: net check `true`; red; restore.

**Task 13 — fee journal from a statement line (FR-ACD-053).** Add: from a −6,500.00 line,
`start_journal_from_statement_line(line, 'fee', '<fee account code from the fixture>')` makes a piece-1 `draft` with Dr
fee / Cr bank 6,500.00 and one `bank_line_journals` row; a second start → 23505; `'accrual'` → refused. Post it through
`record_journal_outcome` (no-ERP: PMO's own posting) → `match_posted_statement_journals` returns 1, a second call 0; a
posted amount of −6,400.00 → no match, listed "posted for a different amount". Implement both RPCs. Rerun.

**Task 14 — sign-off (FR-ACD-054, AC-ACD-012 server half).** Add, importer = Finance A: A signs → 42501; Finance B signs
while the difference equals unmatched → row; off by 0.01 → "is not explained"; previous month unsigned → "sign off
<month> first"; ERP-org fixture with a stale mirror → "the ledger copy is not up to date"; ERP-org fixture with a
`sending` mirror row → "a match is still being sent to the ERP"; import into the signed month → "is signed off".
Implement `may_sign_off_bank_month` and `sign_off_bank_month`. Rerun. Mutations: drop the importer `not exists`; compare
with `abs(...) < 1`; both red; restore.

**Task 15 — the book read.** Add: after sign-off a new mirror row in the month → `changedSinceSignOff` `true`; the
payload's `asOf` equals the mirror health's; for an ERP org, matched lists come only from `confirmed` mirror rows and a
`held` row is listed with its reason. Implement `get_bank_book`, returning the keys `matched` and `unmatchedStatement` that Task 39 asserts. Rerun. Then run every file listed by
`git grep -lE "bank_accounts|bank_statement|bank_match|bank_line_journals|bank_reconciliations|bank_ledger_line|sign_off_bank_month|erp_gl_entry_mirror_org_account_date_idx" -- supabase/tests pmo-portal/src pmo-portal/e2e supabase/functions`
and `git grep -l erp_gl_entry_mirror -- supabase/tests` at their layers (pgTAP in one locked reset+test hold).

**Task 39 — a no-ERP client's match is PMO's record and the book counts it (FR-ACD-058).** Add to
`supabase/tests/bank_book.test.sql`, after Task 12 and before `get_bank_book` is filled in (red: the book shows the line
unmatched). Fixture: a no-ERP org, one bank account, one statement line of +6,500.00 on 2026-11-05, one native receipt
of 6,500.00 into that bank on 2026-11-04 (its ref `pmo:incoming_payments:<id>` comes from Task 10). This task fixes two
keys of the `get_bank_book` payload, and Task 15 returns them: `matched` (array of `{ statementLineId, ledgerLineRefs }`)
and `unmatchedStatement` (string).

1. Before any confirm: `matched` is `[]`, `unmatchedStatement` is `'6500.00'`, and `bank_ledger_lines` lists the native
   receipt, so the ledger side comes from PMO's own money rows; `select count(*) from erp_gl_entry_mirror where org_id =
   <the org>` is 0 (no mirror is read for this client).
2. As Finance, `confirm_bank_match` of the line with the receipt: `select count(*) from bank_matches` is 1, its items are
   two live rows, `matched` holds the statement line with the receipt's ref, `unmatchedStatement` is `'0.00'`.
3. `remove_bank_match` of it: the items are `live = false`, `matched` is `[]` again, `unmatchedStatement` is `'6500.00'`.

Run the pgTAP command for `bank_book.test.sql`. Mutation: have `get_bank_book` count items without the `live` filter;
step 3 goes red (a removed match still counts); restore. Task 11 owns the ERP-org refusal and Task 12 the net-zero rule;
this task owns that a no-ERP match is stored once and counted by the book.

### S4. ERPNext write and read-back — DB, money tier, auth tier, migration number needed

**Task 16 — pgTAP: request, refusals, mirror.** Add to `supabase/tests/bank_erp_match.test.sql`: ERP org,
`request_erp_bank_match` with net −1.00 → refused, zero mirror and outbox rows; a valid request → one `sending` mirror row
and one `external_command_outbox` row `accounting` / `bank-match:<uuid>`; a second request with an item already
`sending` → 23505; no-ERP org → refused; `record_erp_bank_match_readback` as `authenticated` → 42501;
`approved_erp_bank_match_for_push` as Engineer → 42501. Write the second migration and implement the four RPCs. Run the
pgTAP command for this file.

**Task 17 — fake ERPNext support.** Extend the ERPNext fake used by `pmo-portal/src/lib/adapterSeam/erpnext/` adapter
tests: doctype `Bank Transaction` with `payment_entries`; submit runs the allocation of
`bank_transaction.py:allocate_payment_entries` (allocated = voucher's bank-GL amount, capped by unallocated) and sets the
voucher's `clearance_date`; `status` per `set_status`; `unreconcile_transaction_entry` removes a `Matched` row and clears
the date. Bed-probe behaviours the fake must carry (each its own test line, comment `// bed probe 2026-11-16`): `transaction_id`
is **not unique** (a second insert is accepted, Unreconciled, and drops a voucher already matched); a short amount is
accepted, allocates the short amount and leaves the voucher's `clearance_date` empty; a version switch `v15 | v16`: v15
has no `reconciliation_type` (dropped silently) and no `unreconcile_transaction_entry` (417), and accepts `PUT
payment_entries: []` as the undo. Cite the source file and commit in a comment. Test first in the fake's own test file.

**Task 18 — write one match (AC-ACD-035).** Create `pmo-portal/src/lib/adapterSeam/erpnext/bank/adapter.test.ts`:
statement line −6,500.00 matched to Payment Entry `PE-0001` → one insert of `Bank Transaction` with `docstatus 1`,
`withdrawal 6500.00`, `transaction_id = <statement line uuid>`, `bank_account = <erp_bank_account>`, one
`payment_entries` row `{payment_document:'Payment Entry', payment_entry:'PE-0001', allocated_amount:0,
reconciliation_type:'Matched'}` (**v16 only; on a v15 target the key is omitted**); a lookup by `transaction_id` runs
first (Task 42); then a read-back; confirmed only when `PE-0001` is in `payment_entries`, its `allocated_amount` equals the
voucher's bank amount (6,500.00), `PE-0001.clearance_date` is set, `status='Reconciled'` and `unallocated_amount=0`;
`status='Reconciled'` with the voucher missing from `payment_entries` is **held**, never confirmed. Create `adapter.ts`. Run `npx vitest run src/lib/adapterSeam/erpnext/bank/adapter.test.ts`.

**Task 19 — hold on doubt.** Add: read-back `status='Unreconciled'` (voucher already cleared elsewhere) →
`AdapterError('command-held', 'ERPNext left <amount> unallocated')`; a lost insert answer → lookup by `transaction_id`
decides, never a second insert (the lookup accepts several rows, Task 42); two statement lines to one voucher → two Bank Transactions, second allocated the
remainder, both read back. Mutation: skip the read-back; the `Unreconciled` case goes red; restore.

**Task 20 — undo.** Add: `request_erp_bank_unmatch` on a v16 target → adapter calls `unreconcile_transaction_entry(bt,
'Payment Entry', 'PE-0001')`; on a v15 target → `PUT` the Bank Transaction with `payment_entries: []` and its current
`modified` (no `unreconcile_transaction_entry` call, the fake refuses it with 417); both read back no row and no
`clearance_date` → `unmatched`; a row with `reconciliation_type='Voucher Created'`
→ refused, never sent (it would cancel the voucher). Rerun.

**Task 21 — dispatch gate and routing.** Create `supabase/functions/adapter-dispatch/bankMatchGuard.test.ts`, importing
the shipped `bankMatchGuard.ts`: an RPC error or empty answer refuses; refs and amounts come only from
`approved_erp_bank_match_for_push`. Create `bankMatchGuard.ts` modelled on `approvalGuard.ts`; add the ERPNext
`bank-match:` / `bank-unmatch:` routing (refuse unless `bank.reconcile-match` is `supported`); add the `accounting`
writer to `readModelWriters.ts` calling `record_erp_bank_match_readback`. Run
`deno test --allow-env --allow-net --allow-read supabase/functions/adapter-dispatch/bankMatchGuard.test.ts`.

**Task 22 — one outbox row per request.** Add `supabase/functions/adapter-dispatch/bankMatchDispatch.served.test.ts`:
dispatching the same request twice leaves one outbox row; a `refused` request leaves none; accept `^bank-(un)?match:<uuid>$`
in the key shapes (with its test). Run
`scripts/with-db-lock.sh deno test --allow-env --allow-net --allow-read supabase/functions/adapter-dispatch/bankMatchDispatch.served.test.ts`.

### S5. Odoo Community core write and read-back — DB, money tier, auth tier, same migration as S4

**Task 23 — fake Odoo support.** Extend `pmo-portal/src/lib/adapterSeam/odoo/fakeOdoo.test.ts` and `fakeOdoo.ts`:
`account.bank.statement.line` `create` accepts `counterpart_account_id`, posts a move with a liquidity line on the
journal's default account and the counterpart on the given account; `account.move.line` `reconcile` on lines of one
account with equal and opposite residuals sets `reconciled`; `is_reconciled` / `amount_residual` computed as
`_compute_is_reconciled`; **a statement line created with `counterpart_account_id` reads `is_reconciled` true and residual 0
at create, before any reconcile** (bed probe 2026-11-16), the Bank line of its move stays unreconciled with a non-zero
residual, and `payment.is_matched` / `reconciled_statement_line_ids` follow the reconcile; `payment_ref` is not unique;
`remove_move_reconcile` then `action_undo_reconciliation` moves the counterpart to Bank Suspense and the payment
survives; `unlink` removes the line and its move, or leaves the move `cancel` when the company audit trail is on; create
and unlink refuse (403) a user without Basic / Show Full Accounting Features. Cite `odoo/odoo` 18.0 `33b9aa4` files in a comment.
Run `npx vitest run src/lib/adapterSeam/odoo/fakeOdoo.test.ts`.

**Task 24 — write one match (AC-ACD-036).** Create `pmo-portal/src/lib/adapterSeam/odoo/bank/adapter.test.ts`: statement
line −400.00 matched to a supplier payment whose liquidity line sits on outstanding payments account 112 → one
`account.bank.statement.line.create({journal_id:7, date, amount:-400.00, payment_ref:'pmo:<uuid> …',
counterpart_account_id:112})`, then `account.move.line.reconcile([<new counterpart line>, <payment line>])`, then a
read-back; confirmed only when the counterpart line is `reconciled` with residual 0 and the payment reads `is_matched` with
the statement line in `reconciled_statement_line_ids`; a fixture where only `is_reconciled` is true (the state right after
create) is **not** confirmed, and the Bank line's non-zero residual is ignored. A `payment_ref` lookup runs before the
create (Task 42). Create `adapter.ts`. Run
`npx vitest run src/lib/adapterSeam/odoo/bank/adapter.test.ts`.

**Task 25 — fee line is an approved posting.** Add: a −6,500.00 fee line whose piece-1 journal is `approved` → one
`create` with `counterpart_account_id = <fee account>`, no reconcile, read back the posted move's counterpart line on the fee account (a fee line has no payment to reconcile);
a journal still `draft` →
refused before any call; piece 1's `journal.post` is **not** sent for a journal linked in `bank_line_journals` on Odoo
(test in piece 1's Odoo routing file). Rerun.

**Task 26 — hold on doubt.** Add: reconcile answer lost → read-back decides, never a second create (search by
`payment_ref` prefix `pmo:<uuid>` and journal first); read-back with the counterpart line's residual ≠ 0 → `command-held` "Odoo left <x>
unreconciled"; a `create` refused for permissions → `refused` with Odoo's message. Mutation: skip the search before
create; the duplicate case goes red; restore.

**Task 27 — undo.** Add: `request_erp_bank_unmatch` → `remove_move_reconcile` on the counterpart and payment lines, then `action_undo_reconciliation` on the statement line,
then `unlink` of the PMO-created statement line; read back: gone (or its move `cancel` when the audit trail is on, and the
screen then tells the accountant one cancelled move stays), the payment's `is_matched` false and its outstanding line's
residual restored → `unmatched`. Rerun.

**Task 28 — routing.** Add the Odoo `bank-match:` / `bank-unmatch:` route in
`supabase/functions/adapter-dispatch/odooAdapters.ts` (same order as `resolveOdooProcurementAdapter`; refuse unless
`bank.reconcile-match` is `supported`), with its case in `bankMatchGuard.test.ts`. Rerun the deno test.

**Task 29 — Odoo bank balance after the write.** Add to `odoo/bank/adapter.test.ts`: after Task 24's write the fake's
bank account carries −400.00 and the outstanding account 0 for that payment; then, against a mirror fixture of that
state, `get_bank_book` (pgTAP, `bank_erp_match.test.sql`) shows the line matched and difference 0. Run both.

### S4/S5 shared — refusals and the sweep (both ERPs; added so every spec id has a task)

**Task 40 — refuse before any write (FR-ACD-059).** Two halves, one rule.

*Half 1, unit, `pmo-portal/src/lib/repositories/bankBook.test.ts` (with Task 30's cases).* An ERP client's `confirm`
reads its tier's `bank.reconcile-match` declaration (the same table the dispatch gate reads) and refuses before calling
the RPC:

```ts
export class BankMatchRefused extends Error {}
export function refuseUnlessSupported(d: Declaration): void {
  if (d.status === 'supported') return;
  throw new BankMatchRefused(d.status === 'unavailable'
    ? `Bank matching is unavailable for this ledger: ${d.reason}`
    : `Bank matching for this ledger is not ready yet (issue ${d.issue})`);
}
```

Cases: an Odoo org with the shipped Task 6 declaration (`pending`, issue 896) → `confirm` rejects with that message and
the mocked `request_erp_bank_match` is called 0 times; an `unavailable` declaration → the message carries its reason, 0
calls; a `supported` declaration injected by the test → exactly 1 call; a no-ERP org → declarations are never read and
`confirm_bank_match` is called. Run `npx vitest run src/lib/repositories/bankBook.test.ts` (red: no refusal), add
`refuseUnlessSupported`, rerun green.

*Half 2, pgTAP, `supabase/tests/bank_erp_match.test.sql` (with Task 16).* The refusal of an item already in a live match
or an in-flight command. Insert, as table owner, one mirror row per state `sending`, `confirmed`, `held`, `unmatching`,
each on its own statement line and ledger ref; then as Finance: `request_erp_bank_match` for each of those statement
lines → 23505; for a different statement line but the same ledger ref → 23505; for rows in state `unmatched` and `refused`
→ accepted (not live). After each refusal `external_command_outbox` and `erp_bank_match_mirror` counts are unchanged.
The migration's GIN index is not unique, so `request_erp_bank_match` must test **both** arrays (`statement_line_ids &&`
and `ledger_line_refs &&`) over the live states. Run the pgTAP command for this file. Mutation: test only the statement
side; the same-ledger-ref case goes red; restore.

**Task 41 — no answer, lost answer, doubtful read-back (AC-ACD-039, both ERPs).** The lost-answer lookups (ERPNext Bank
Transaction by `transaction_id`, Odoo statement line by `payment_ref` and journal) are claims **to verify on the bed**
(V-ACD7, V-ACD11), so this task starts with discovery and `bank.reconcile-match` stays `pending` throughout.

*Step 0 — bed discovery: done 2026-11-16 (bed probe 2026-11-16; the spec's §11 holds the verdicts).* The lost-answer lookups are
VERIFIED with one difference: ERPNext Bank Transaction `transaction_id` and Odoo `payment_ref` both find the record, and
**neither is unique**, which is why Task 42 makes find-before-write a rule and the lookup tolerates several rows. A
Bank Transaction left at `docstatus` 0 by a lost submit was not probed: until it is, the lookup treats a draft with the
anchor like a submitted one (hold, never a second insert). `bank.reconcile-match` stays `pending` throughout; the fakes of
steps 1–3 carry `// bed probe 2026-11-16` where the bed answered and `// UNVERIFIED on the bed` for the draft case.

*Step 1 — the harness seam (red first).* In `pmo-portal/src/lib/adapterSeam/contractSuite/harness.ts` add:

```ts
export interface BankMatchScenario {
  /** What the ERP does with the one write: answers, drops its answer after writing, never answers, or answers but the read-back is doubtful. */
  erp: 'answers' | 'answer-lost-after-write' | 'no-answer' | 'doubtful-read-back';
}
export interface BankMatchOutcome {
  state: 'sending' | 'held' | 'confirmed';
  reason?: string;
  /** Records the ERP holds for the one statement line. */
  erpRecords: number;
  /** Whether PMO's book would count the line matched. */
  countedMatched: boolean;
}
export interface BankMatchHarness {
  /** Confirm one match, then run the sweep's adopt-or-hold pass `passes` times; one outcome after each pass. */
  confirmAndSweep(s: BankMatchScenario, passes: number): Promise<BankMatchOutcome[]>;
}
```

and `bankMatch?: BankMatchHarness` on `ErpHarness`. Implement it in `erpnext/contract.harness.ts` and
`odoo/contract.harness.ts` over the Task 17 / Task 23 fakes (add the fault modes `drop-answer-after-write` and
`no-answer` to those fakes, with their own test lines), driving the shipped `erpnext/bank/adapter.ts` and
`odoo/bank/adapter.ts` and the same recovery pass the other outbox commands use (`docs/money-path-primer.md`; no new
sweep).

*Step 2 — the shared suite, test first.* Create `pmo-portal/src/lib/adapterSeam/contractSuite/bankMatch.suite.ts`
exporting `bankMatchSuite: Suite` with three cases, each titled `AC-ACD-039 …`:

- `no-answer`, 3 passes → states `['sending','sending','sending']`, `countedMatched` false on every pass, `erpRecords` ≤ 1;
- `answer-lost-after-write`, 2 passes → `erpRecords` is 1 after both passes (found by its anchor, never written twice),
  pass 1 is `sending` and not counted, pass 2 is `confirmed` and counted, and only because the read-back matched;
- `doubtful-read-back`, 1 pass → `held` with a non-empty `reason`, `countedMatched` false, `erpRecords` 1.

The shared runner `tiers.contract.test.ts` runs a suite only for a tier that declares the workflow `supported`, which this
workflow is not yet. So add `pmo-portal/src/lib/adapterSeam/contractSuite/bankMatch.pending.test.ts`:
`describe.each(['erpnext','odoo'])` over `TIER_HARNESSES[tier]`, calling `bankMatchSuite`. Run
`npx vitest run src/lib/adapterSeam/contractSuite/bankMatch.pending.test.ts` (red: harness method missing), implement,
rerun green for both tiers. Mutation: let the recovery pass treat "the lookup found a record" as confirmed without the
read-back; the `doubtful-read-back` case goes red for both tiers; restore.

*Step 3 — screen half.* Add one case to Task 32's `Reconciliation.test.tsx`: a `held` ERP match shows **Needs a check**
and the ERP's reason, and is not counted in the matched total. Run that test.

*Step 4 — hand-over to Tasks 34 and 35.* When a bed proof passes and Task 34 or 35 flips `bank.reconcile-match` to
`supported` for that tier, the same change adds `'bank.reconcile-match': bankMatchSuite` to `SUITES`
(`contractSuite/index.ts`) and deletes `bankMatch.pending.test.ts` once both tiers are `supported`, so the shared runner
owns the case and `suiteRunProblems` fails if it ever stops running.

**Task 42 — find before write: never a second record (FR-ACD-055a, AC-ACD-041, both ERPs).** Test first, in
`erpnext/bank/adapter.test.ts` and `odoo/bank/adapter.test.ts`: (a) the fake already holds a record carrying the anchor
(ERPNext Bank Transaction `transaction_id`, Odoo statement line `payment_ref` + journal) and its read-back shows this
voucher matched → the adapter adopts it, `create` called 0 times, state `confirmed`; (b) the record exists but the
voucher is not in it (ERPNext: `Unreconciled`, voucher dropped) → `command-held`, 0 creates, reason names the anchor;
(c) two records carry the anchor → the lookup returns both, the same rules apply (adopt one that shows the match, else
hold), 0 creates; (d) no record → exactly one create. Add `anchor-exists` to Task 41's `BankMatchScenario.erp` and a
case to `bankMatch.suite.ts` titled `AC-ACD-041 …`: `erpRecords` stays at its starting count after a confirm and two
sweep passes. Mutation: write first, look up after (or look up only after a lost answer); case (b) and the contract case
go red; restore. Run `npx vitest run src/lib/adapterSeam/erpnext/bank/adapter.test.ts
src/lib/adapterSeam/odoo/bank/adapter.test.ts src/lib/adapterSeam/contractSuite/bankMatch.pending.test.ts`.

**Task 43 — amount differs: refuse, or an explicit Partial (FR-ACD-055e, AC-ACD-042, AC-ACD-043).** Test first. Adapter
cases in `erpnext/bank/adapter.test.ts`: statement −300,000.00 against a 400,000.00 voucher, no partial flag → refused
before any call (0 inserts); the same with the explicit partial flag → one insert, read-back `allocated_amount` 300,000.00
and `clearance_date` empty → state `partial` with 100,000.00 open, `countedMatched` false; a row read back allocated below
the voucher's without the flag → `command-held`, never confirmed. Odoo (`odoo/bank/adapter.test.ts`): any amount
difference → refused, no partial flag accepted. Repository case in `bankBook.test.ts`: `confirm` carries `partial: true`
only from the dialog the person confirmed, and an Odoo org never offers it. Screen case in `Reconciliation.test.tsx`: a
partial shows **Partial** and the open amount, not in the matched total. Mutation: treat `Reconciled` as confirmed
without the allocated-amount check; the partial case goes red; restore. Run the three test files by name.

### S6. Screens — every client, auth tier (`can()` is UX only), no DB

**Task 30 — repository and permission.** `pmo-portal/src/lib/repositories/bankBook.ts` over the RPCs: `confirm` calls
`confirm_bank_match` for a no-ERP org and `request_erp_bank_match` for an ERP org, chosen from the org's ledger owner, never
from the screen; `can('sign-off', 'bank-month', ctx)` false for an importer and for PM/Engineer;
`can('manage', 'bank-account', ctx)` **Admin only**. Tests `src/lib/repositories/bankBook.test.ts` and the policy cases
in `src/auth/policy.test.ts`. Run `npx vitest run src/lib/repositories/bankBook.test.ts src/auth/policy.test.ts`.

**Task 31 — Bank book page.** `pmo-portal/pages/finance/BankBook.tsx` (Companies slice pattern): per account × month the
statement closing, ledger balance with its as-of and check, unmatched each side, difference; **Signed off** / **Changed
since sign-off**; Import (CSV only → parser preview with rejected rows → `ConfirmDialog` → `import_bank_statement`);
Admin-only **Bank accounts** panel with the column-map editor. RTL `pages/finance/BankBook.test.tsx`: Sign off hidden for
the importer; a refused import shows the server's message; a PDF is refused with the CSV message; the bank-account panel
hidden for Finance. Route in `App.tsx` under Finance; translations rebased before the PR (#1070). Run the test, then
`scripts/ux-proof.sh` on `/finance/bank-book`.

**Task 32 — Reconciliation page.** `pmo-portal/pages/finance/Reconciliation.tsx`: two lists, proposals as suggestions
only, running net, Confirm enabled only at net 0, "Post as fee / interest journal" on an unmatched statement line. For an
ERP org a confirmed match shows **Sending to the ERP** until the read-back, then **Matched**; a held one shows the ERP's
reason with **Undo** and **Retry**; no screen text tells the user to act in the ERP. RTL `Reconciliation.test.tsx`: a
proposal is never confirmed without a click; Confirm disabled at net −1.00; a `sending` row is not counted as matched.
Run the test, then `scripts/ux-proof.sh` on `/finance/reconciliation`.

### S7. Journeys, bed proofs, gates

**Task 33 — the no-ERP journey (AC-ACD-012).** `pmo-portal/e2e/AC-ACD-012-bank-fee-reconciled.spec.ts`, with its
`@e2e-isolation` class: a no-ERP org's bookkeeper imports a November CSV with one fee line, starts a fee journal, the
approver approves, the line shows matched, difference **0**, a second Finance member signs off. Run
`scripts/e2e-local.sh AC-ACD-012`.

**Task 34 — ERPNext bed proof (AC-ACD-035, S4 done).** `supabase/functions/_shared/erpnextBankMatch.bed.test.ts` driving
the shipped `erpnext/bank/adapter.ts`: create a Payment Entry on the bed's bank, write the match, read back
the voucher in `payment_entries`, `allocated_amount` equal to the voucher's amount and `clearance_date` (never `status`
alone), a second write for the same line refused (Task 42), a short amount refused (Task 43), undo (v16 method, v15 `PUT`),
read back cleared, cleanup in `finally`; run it on both a v15 and a v16 bed; record the integration user's needed
permissions (Bank Transaction create/submit/write, voucher write) in `docs/research/`. Run under
`scripts/with-erpnext-lock.sh deno test --allow-env --allow-net --allow-read <file>`. Flip `bank.reconcile-match` to
`supported` on ERPNext only if it passes, and in the same change follow Task 41 step 4.

**Task 35 — Odoo bed proof (AC-ACD-036, S5 done).** Extend `supabase/functions/_shared/odooAccountantsDeskFacts.bed.test.ts`
with one case driving the shipped `odoo/bank/adapter.ts` on core modules only: post a supplier payment (outstanding),
write the match, read back the counterpart line (`reconciled`, residual 0) and the payment (`is_matched`,
`reconciled_statement_line_ids`), a second write refused (Task 42), undo (`remove_move_reconcile`,
`action_undo_reconciliation`, `unlink`, with the audit trail off and on: cancelled move seen), cleanup in `finally`; run it
as an integration user holding Basic or Show Full Accounting Features only, and record that group in `docs/research/`. Run
`scripts/with-odoo-lock.sh deno test --allow-env --allow-net --allow-read --allow-run supabase/functions/_shared/odooAccountantsDeskFacts.bed.test.ts`.
Flip `bank.reconcile-match` to `supported` on Odoo only if it passes, and in the same change follow Task 41 step 4.

**Task 36 — local final gate and reviews, per slice.** From `pmo-portal/`: `npm run check:guards`, `npm run typecheck`,
`npx eslint --max-warnings=0 <touched files>`, every test file the slice touched by name, `node scripts/affected-e2e.mjs`.
Mutation evidence in the PR. Three reviews (spec, quality, security on RLS, SoD, tenancy, the ERP write's outbox hold and
gate). Each DB slice ships alone to `dev`.

## Acceptance criteria added by this revision (Given/When/Then)

- **AC-ACD-035 (ERPNext match lives in ERPNext).** Given an ERPNext-connected client, a statement line of −6,500.00 and a
  submitted Payment Entry of 6,500.00 out of that bank, When a Finance member confirms the match in PMO, Then ERPNext holds
  a submitted Bank Transaction with status Reconciled linking that Payment Entry, the Payment Entry has a clearance date and the row's allocated amount is 6,500.00,
  PMO shows the line Matched only after reading that back, and PMO has no `bank_matches` row for it.
- **AC-ACD-036 (Odoo match lives in Odoo, core only).** Given an Odoo Community client with only core modules, a statement
  line of −400.00 and a posted supplier payment of 400.00 on the journal's outstanding payments account, When a Finance
  member confirms the match in PMO, Then Odoo holds a posted statement line whose counterpart line is reconciled with residual 0, the payment reads `is_matched`
  with that statement line in `reconciled_statement_line_ids`, PMO shows Matched only after reading that back (not from
  the statement line's `is_reconciled`, true at create), and PMO has no `bank_matches` row for it.
- **AC-ACD-037 (no-ERP match lives in PMO).** Given a client with no ERP, When a Finance member confirms a match netting to
  zero, Then PMO stores one match and the bank book counts the line matched.
- **AC-ACD-038, AC-ACD-039, AC-ACD-040** are worded in the spec (§10) and owned by Tasks 37, 41 and 38; the spec's
  FR-ACD-058 and FR-ACD-059 are owned by Tasks 39 and 40.
- **AC-ACD-041, AC-ACD-042, AC-ACD-043** (bed-probe rules: find before write; amount differs; partial) are worded in the
  spec (§10) and owned by Tasks 42 and 43; the spec's FR-ACD-055a–e are owned by Tasks 18, 24, 42, 43 and 20 / 27 (055d).

## Gaps (ERP-side steps that seem needed, and decisions not taken here)

- **G-1 ERPNext Bank Account record.** A Bank Transaction needs an ERPNext `Bank Account` (with `is_company_account`)
  linked to the GL account. Where the client's ERPNext has none, PMO cannot write the match. Gap: no PMO screen yet creates
  that record; a follow-up slice adds it to the Admin bank-account panel (an ERPNext write of `Bank Account` + `Bank`; the 2026-11-16 probe created the `Bank` first, a Bank Account without one was
  not tried). Until then it is an ERP-side step by the integrator, never by the client.
- **G-2 Odoo payments already pointed at the bank account.** If a client's Odoo payment method lines post payments straight
  to the bank account, Odoo marks those payments matched with no statement line (`account_payment.py:516-519`), and core
  has nowhere to record which statement line they match. Gap: such a client's bank book can show balances but cannot hold
  matches in Odoo; options are a PMO Admin write that points those method lines back at the outstanding accounts (the
  earlier plan's setup adapter, reversed) or a module (#2163). Not decided here.
- **G-3 Month sign-off has no core ERP equivalent.** Neither ERPNext nor Odoo core has a per-bank-account monthly sign-off
  record; PMO's `bank_reconciliations` row is an attestation over the ERP's read-back figures (OQ-B8), not match state.
- **G-4 Statement lines PMO does not match stay out of the ERP.** Writing an unmatched line into the ERP (ERPNext
  Unreconciled Bank Transaction; Odoo statement line on the suspense account) would make the ERP's own bank balance follow
  the statement before matching. Not in this plan; for Odoo it interacts with #2163 if a module's import is preferred.
- **G-5 Odoo Community modules (#2163, open).** This plan uses core only. If #2163 allows an OCA module
  (e.g. `account_reconcile_oca`, `account_statement_import_*`), S5's write could move to that module's API; listed as a
  dependency, not decided here.
- **G-6 ERPNext voucher already cleared outside PMO.** A voucher with a `clearance_date` set by another path makes ERPNext
  allocate 0 and drop the row (`allocate_payment_entries`, "should already be cleared"). PMO holds the request with that
  reason (Task 19); resolving it needs a PMO screen to clear the stale date (`clear_clearing_date`,
  `bank_reconciliation_tool.py:488`), which is a follow-up slice.
- **G-8 Odoo integration user rights (spec GAP-ACD-3).** The match write needs the integration user to hold **Basic** or
  **Show Full Accounting Features** (the shipped bot, Billing, Adviser and Access Rights are refused, 403; bed probe
  2026-11-16). Granting it is an Odoo-side step by the integrator, never an instruction to the client; no PMO screen yet.
- **G-7 Foreign-currency accounts** wait (OQ-B4); **PDF-only banks** wait (ruling 3).

## Traceability (bank-book ACs)

| AC | Owning layer | Owning test | Supporting tasks |
|---|---|---|---|
| AC-ACD-010 | P | `supabase/tests/bank_book.test.sql` (import refusals) | 1–3, 9 |
| AC-ACD-011 | P | `supabase/tests/bank_book.test.sql` (confirm match) | 4, 11, 12 |
| AC-ACD-012 | E | `pmo-portal/e2e/AC-ACD-012-bank-fee-reconciled.spec.ts` | 5, 13, 14, 31–33 |
| AC-ACD-020 | P | `supabase/tests/bank_book.test.sql` (bank tables and RPCs only) | 7, 16 |
| AC-ACD-024 | C | `pmo-portal/src/lib/adapterSeam/contractSuite/tiers.contract.test.ts` (new rows declared, pending skips carry the reason) | 6 |
| AC-ACD-035 | C (ERPNext) | `pmo-portal/src/lib/adapterSeam/erpnext/bank/adapter.test.ts`; bed proof `erpnextBankMatch.bed.test.ts` | 16–22, 34 |
| AC-ACD-036 | C (Odoo) | `pmo-portal/src/lib/adapterSeam/odoo/bank/adapter.test.ts`; bed proof `odooAccountantsDeskFacts.bed.test.ts` | 23–29, 35 |
| AC-ACD-037 | P | `supabase/tests/bank_book.test.sql` (no-ERP confirm) | 11, 12 |
| AC-ACD-038 | U | `pmo-portal/src/lib/bankBook/proposeMatches.test.ts` (10 Nov statement line, 12 Nov and 14 Nov ledger lines) | 4, 32, **37** |
| AC-ACD-039 | C (ERPNext, Odoo) | `pmo-portal/src/lib/adapterSeam/contractSuite/bankMatch.suite.ts` (run by `bankMatch.pending.test.ts` until each tier is `supported`, then by `tiers.contract.test.ts`); **bed discovery first** (V-ACD7, V-ACD11), workflow stays `pending` until Tasks 34/35 | 16, 19, 26, 32, **41** |
| AC-ACD-040 | P | `supabase/tests/bank_book.test.sql` (Finance 42501, Admin saved, marking and column layout) | 7, 8, **38** |
| AC-ACD-041 | C (ERPNext, Odoo) | `pmo-portal/src/lib/adapterSeam/contractSuite/bankMatch.suite.ts` (case `AC-ACD-041`) and the two `bank/adapter.test.ts` files; bed proofs 34/35 | 18, 24, **42** |
| AC-ACD-042 | C (ERPNext, Odoo) + U | `erpnext/bank/adapter.test.ts`, `odoo/bank/adapter.test.ts`, `bankBook.test.ts` (refused before any write; Odoo offers no partial) | 18, 24, 30, **43** |
| AC-ACD-043 | C (ERPNext) + U | `erpnext/bank/adapter.test.ts` (Partial with open amount, not counted) and `Reconciliation.test.tsx` | 18, 32, **43** |
| FR-ACD-058 | P | `supabase/tests/bank_book.test.sql` (no-ERP match stored once, counted by the book, ledger side from PMO's money rows) | 10, 11, 12, 15, **39** |
| FR-ACD-059 | U + P | `pmo-portal/src/lib/repositories/bankBook.test.ts` (workflow not `supported`, no RPC call) and `supabase/tests/bank_erp_match.test.sql` (item live or in flight, 23505) | 16, 21, 28, 30, **40** |

AC-ACD-030, AC-ACD-031 and FR-ACD-057 (the Odoo payment-account setup) are **withdrawn (owner ruling 2026-11-15; ERP source
of truth)**, as the spec words it, ids kept and not reused: Odoo's own reconciliation needs payments on the outstanding
accounts, so this plan no longer moves them (Gap G-2; the spec's GAP-ACD-2). Not in this piece: AC-ACD-013's
"unsigned bank" checklist item (piece 6 reads `bank_reconciliations`); AC-ACD-019 for foreign currency (OQ-B4). The
spec's FR-ACD-050–059, as revised by Task 0, are covered by Tasks 8 + 38 (050), 1–3 + 9 (051), 4 + 11–12 + 16 + 37 (052), 13 + 25
(053), 5 + 14 + 15 (054), 18 + 20 + 24 + 27 + 41 + 42 + 43 (055 and 055a–e, the ERP write, its read-back, find-before-write, amounts and undo), OQ-B4 (056), withdrawn (057, Gap G-2), 39 (058), 40 (059).
