# Financial statements in PMO (#897)

**Status: DRAFT — owner sign-off pending.** · 2026-10-16

**Issue:** [#897](https://github.com/ariefsaid/PMO/issues/897), under #894.

**Authority:** `docs/decisions.md` **OD-SAR-PMO-IS-THE-UI**, sharpened by **OD-ERP-3/4**; owner decisions of 2026-10-16. ADR-0048's ledger-sourced display rule, ADR-0016 (authorization), ADR-0010 (test ownership).

## 1. Job and scope

**Job story.** When preparing month-end, Finance wants to read the company's books and each project's profit in PMO, with the previous period alongside, so the accountant can explain the figures without opening ERPNext.

| Phase | Included |
|---|---|
| **1 — first month-end** | Trial balance; profit and loss, company-wide and per project; balance sheet. One connected ERPNext Company, chosen period, prior-period comparison, IDR company-currency amounts. |
| **2 — later; out of scope** | Cash flow; general-ledger drill to the source document; party ledger; auditor export pack (year-end target). Stub only: a later spec must define their contents, permissions and reconciliation oracles; no placeholder screens or export promise in Phase 1. |

Also excluded: consolidation/multiple companies, account maintenance, account-currency statements, PMO exchange-rate conversion/revaluation, closing entries and period-lock workflows (#900). ERPNext posts **every** entry; PMO displays only sums of its ledger lines, their account hierarchy and the report presentation described below. No independent accounting engine, estimated profit, procurement commitment totals or management-pack revenue recognition substitutes.

## 2. Decisions / data contract

**Grounding inspected:** `src/auth/policy.ts` (under `pmo-portal/`); migrations 0101, 0270, 0274, 0279; `ledgerMirrorFeed.ts`, `ledgerFetch.ts`, `actualsSnapshot.ts`; both existing accounting snapshot components. These establish the reusable seams, not live-site state.

- **Company and periods.** Use the org's activated ERPNext Company (`external_org_bindings.config.company`, OD-INT-6), not the CRM Companies directory. Show its readable name. Proposed picker: month, quarter or fiscal year using ERPNext's fiscal calendar; compare the immediately preceding equivalent period, each with explicit dates (including across fiscal years). Balance sheet columns are **as at each period end**; P&L columns are **activity within each period**. Trial balance shows opening debit/credit, period debit/credit and closing debit/credit for both periods. Custom dates: OQ-001.
- **New table: `erp_account_mirror`.** Machine-written, keyed by `(org_id, company, erp_name)`. Mirror Account `name` (stored as `erp_name`), `company`, `account_name`, `root_type` (Asset/Liability/Equity/Income/Expense), `report_type` (Balance Sheet/Profit and Loss), `parent_account`, `is_group`, `account_number`, `account_currency`; also `lft`, `rgt`, `account_type`, `include_in_gross`, `disabled`, `modified` (as `erp_modified`), plus `org_id`, `as_of` and generation identity. Names/numbers are presentation, never guessed classifications. Disabled accounts with historical activity remain reportable.
- **Refresh and renames.** Full, paginated account scan on activation, then on the existing five-minute ERP sweep, before publishing statements. Publish only a complete chart. A moved account restates both columns under ERPNext's **current** hierarchy, as its reports do; no duplicate parent totals. A rename/merge or disappearance triggers a complete company-ledger rescan and account-reference reconciliation, not name/number guessing or reliance on changed timestamps on linked entries. Keep the previous complete statement while rebuilding; unmatched accounts block publication, never silently drop amounts.
- **Ledger basis.** Reuse `erp_gl_entry_mirror`; retain cancelled lines but exclude `is_cancelled=true` (including cancellation-marked originals/reversals, #901). The Phase-1 feed shall also retain ERPNext `is_opening`, `finance_book` and explicit company scope, with a full historical backfill before first publication. Read Company currency/default finance book, Fiscal Year dates and the reporting-relevant Accounts Settings as source metadata, not PMO defaults. Payment Ledger Entry is not a statement amount source. Its existing mirror remains subject to the role contract below.
- **New table: `erp_financial_statement_snapshot`.** Machine-written result scoped by org, company, statement, optional mapped project, both date ranges and view kind (account breakdown/project totals). Carry `snapshot_id`, `as_of`, source report/version, filters/settings and source generation. Publish both columns atomically from one complete generation. Project-total payloads contain only income, expense and net profit/loss, never account/party/voucher detail. Planner owns physical shape, indexes and reversible migrations.
- **Currency.** Sum ERPNext `debit`/`credit` in company currency **IDR**, including the company-currency amounts already posted for USD bank accounts. Never sum `debit_in_account_currency`/`credit_in_account_currency`, reconvert USD, or apply PMO's exchange-rate table. Decimal-safe arithmetic; match ERP report rounding, never round individual input lines to whole rupiah.
- **Project attribution.** Filter the ledger's `project` through the existing org binding's `project_map`; no allocation of overhead or inference from cost centre. Company P&L includes every project and entries without a project. Finance can see an explicit “Not assigned to a project” remainder; project totals plus that remainder must tie to company P&L. Unmapped ERP project names are included in that remainder, never exposed as raw identifiers to project staff.

### Exact role contract (active member, own org only)

| Real role | Company statements, account breakdowns, account master and ledger lines | Project income / expense / net totals |
|---|---|---|
| **Admin**, **Finance** | Yes | Yes |
| **Executive**, **Project Manager**, **Engineer** | No | Yes, only projects they are authorized to view |
| Inactive, anonymous, other org | No | No |

RLS enforces this contract on both ledger mirrors, account master and statements; aggregate RPCs recheck org, active membership and project visibility. Client inputs cannot broaden scope; ordinary users cannot write read-models. `can()`/`usePermission` on the real role is **UX only**; impersonation grants nothing. This is a target contract, not an assertion about deployed policies.

## 3. ERPNext report parity — including an unclosed year

Match **standard reports, no custom template**, on ERPNext **v16.33.0** (DD-OPS-11). Pinned upstream source inspected:

- [Trial Balance](https://github.com/frappe/erpnext/blob/v16.33.0/erpnext/accounts/report/trial_balance/trial_balance.py): `get_opening_balances`, `get_rootwise_opening_balances`, `calculate_values`, `prepare_opening_closing`. Match opening-entry handling, fiscal-year P&L reset and parent rollups. Profile: closing entries included in opening **and** current period; net opening/closing values; group accounts shown; unclosed prior-year P&L balances off.
- [Profit and Loss Statement](https://github.com/frappe/erpnext/blob/v16.33.0/erpnext/accounts/report/profit_and_loss_statement/profit_and_loss_statement.py): `execute` calls `get_data(... ignore_closing_entries=True)` for Income and Expense; `get_net_profit_loss` supplies net profit. Exclude Period Closing Voucher entries from P&L even after ERPNext closes the period. Company and project use identical rules; project adds only ERPNext's project filter.
- [Balance Sheet](https://github.com/frappe/erpnext/blob/v16.33.0/erpnext/accounts/report/balance_sheet/balance_sheet.py): `execute`, `get_provisional_profit_loss`, `check_opening_balance`; shared [financial_statements.py](https://github.com/frappe/erpnext/blob/v16.33.0/erpnext/accounts/report/financial_statements.py): `get_data`, `set_gl_entries_by_account`, `calculate_values`, `prepare_data`. Accumulated assets are debit-positive; liabilities/equity credit-positive. Retained earnings posted by ERPNext remain in Equity. **Before closing, never invent a retained-earnings entry**: reproduce the report's “Provisional Profit / Loss” display row (assets minus liabilities minus posted equity). When its opening check finds unclosed earlier periods, reproduce its separate “Unclosed Fiscal Years Profit / Loss” row and subtract that opening difference from provisional profit exactly as `execute` does. These are presentation sums, not ledger postings or a second recognition calculation. After closing, ERPNext's posted equity replaces the corresponding provisional amount without double counting.

Run each comparison column's oracle with its own dates/fiscal year. P&L is non-accumulated; balance sheet accumulated. Use company currency, default and blank finance-book entries, no other dimension filters, consolidation or template. Hide rows zero in **both** columns, retaining parents; never double-count parents/children. Record complete filter JSON, settings, precision and version.

ERPNext can accelerate opening balances with **Account Closing Balance** following a submitted Period Closing Voucher. PMO's basis remains the complete historical ledger, not a locally generated closing balance. **Equivalence to that ERP path must be proven**, not assumed; see OQ-002. A missing history segment or mismatch cannot be papered over with a balancing entry.

## 4. Requirements (EARS)

- **FR-001** — When an authorized user selects a supported period, the system shall display the Phase-1 statements and preceding-period columns with the scopes and date semantics in §2.
- **FR-002** — When the ERP sweep completes the account chart and ledger refresh, the system shall publish their coherent statement generation using the account fields, cadence, rename/move and backfill rules in §2.
- **FR-003** — The system shall derive statement amounts solely from uncancelled mirrored company-currency ledger lines, grouped by ERP accounts and rolled up under ERPNext's hierarchy, filters, opening/closing rules and signs in §3.
- **FR-004** — While ERPNext has not closed a reporting period, the system shall show its provisional/unclosed profit presentation without posting or manufacturing retained earnings; when ERPNext closes it, the system shall reflect the posted result without duplication.
- **FR-005** — When a project is selected, the system shall use only its explicit ERP project mapping and shall not allocate company-only entries to it; company P&L shall retain all entries and the explicit unassigned remainder.
- **FR-006** — The system shall enforce the exact role/tenancy/read-only contract in §2 server-side, and shall expose only authorized project totals to project staff.
- **FR-007** — When statements render, the system shall reuse `AccountingSnapshotProvenance` and the `AccountingSnapshotsSection` Card/DataTable/ListState patterns with a small readable “Updated …” provenance line, company/period/currency labels and account names/numbers, not raw ERP document ids. On-screen copy shall not use “mirror”, “GL”, “watermark”, “docstatus” or internal source markers; readable statement names replace technical provenance strings. No new provenance widget or cluttered diagnostic panel.
- **FR-008** — If a refresh is incomplete, fails, or cannot classify every relevant account, then the system shall retain the last complete result with an honest “Update delayed” indication and its original update time; if none exists, it shall show “Statements are not available yet”, not fabricated zeros. A complete result with no activity shall show a distinct “No activity in this period” state, not a connection error.
- **NFR-001** — Every Phase-1 statement shall reconcile to ERPNext's own standard report for the same company, dates, project, filters and source state **to the rupiah**: zero difference at ERPNext's report precision for every account, subtotal and total, including prior-period columns, not merely a balanced grand total.
- **NFR-002** — The system shall preserve decimal precision through aggregation and shall process all source pages before publication; a failed or truncated read shall never publish a partial statement.
- **NFR-003** — The system shall use the typed repository/DAL seam and shared design tokens, accessible tables/controls, English and Indonesian copy, loading/error/retry states, and permission-scoped cache keys; technical errors and reconciliation evidence shall not disclose credentials, personal details or internal coordinates.

## 5. Acceptance / ownership (ADR-0010)

All are **planned**, not yet executed. Each row assigns one canonical owning test/layer; that test's title must include its AC id. Reconciliation fixtures exercise **shipped** aggregation code, not a copied implementation.

| ID / named proof | Given / When / Then | Owning test layer |
|---|---|---|
| **AC-001 — Fixture reconciliation, zero-rupiah difference** | **Given** synthetic fixtures and independently captured ERP results covering opening entries, unclosed earlier/current profit, posted/cancelled closing vouchers, cancelled originals/reversals, USD-bank IDR postings, project/unassigned lines, finance books and fiscal-year boundaries, **when** shipped aggregation produces every statement and comparison, **then** all accounts, subtotals, profit rows and totals equal the oracle at report precision; project plus remainder ties, and a changed amount makes the proof fail. | **Unit — Vitest**, parameterized oracle test |
| **AC-002 — RIS live rehearsal reconciliation** | **Given** the RIS rehearsal site, complete refresh, recorded version/settings/filters and operator-prepared closed/unclosed cases, **when** automation reads ERP reports and matching PMO statements as Finance, **then** every Phase-1 statement, including project P&L and prior columns, ties at every account/subtotal/total with zero-rupiah difference and matching UI totals. Source changes invalidate capture; mismatches fail. The runner never posts/closes. | **Curated E2E — Playwright**, parameterized rehearsal journey |
| **AC-003 — Statement privacy** | **Given** every §2 role, inactive/anonymous callers and another org, **when** they directly read company/account-detail snapshots, accounts or either ledger mirror, **then** only active same-org Admin/Finance receive rows; ordinary users cannot write read-models. | **Integration — pgTAP**, role/tenancy matrix |
| **AC-004 — Project totals only** | **Given** project staff with/without project visibility, **when** totals are requested, including forged scope inputs, **then** only authorized project income/expense/net and dates/currency/provenance return; no account, party, voucher or company-wide payload returns. | **Integration — pgTAP**, aggregate/RLS contract |
| **AC-005 — Master lifecycle** | **Given** multiple pages, disabled historical accounts and renamed/merged/moved accounts, **when** refreshed, **then** both periods restate once under the current hierarchy; failed pages, unresolved accounts or incomplete rescans preserve the old generation/time. | **Unit — Vitest**, mocked feed contract |
| **AC-006 — Atomic publication** | **Given** prior snapshots and concurrent publications, **when** publication succeeds or fails, **then** readers see one complete generation with both columns per scope, never partial, duplicate or cross-scope results. | **Integration — pgTAP**, publication contract |
| **AC-007 — Scope selection** | **Given** the bound Company and ERP fiscal calendar, **when** Finance changes period across a fiscal boundary, **then** requests/labels identify correct current/prior dates, currency and balance-sheet end dates, without old-scope results. | **Unit — Vitest/RTL**, period/scope test |
| **AC-008 — Honest, plain-language UI** | **Given** loading/error/absent/complete-empty/delayed/populated results in both locales, **when** rendered, **then** shared accessible patterns distinguish states, offer error retry, retain true update time and show no banned jargon/raw ids or fabricated zeros. | **Unit — Vitest/RTL**, render/a11y test |
| **AC-009 — UX permissions** | **Given** each real role and Admin view-as, **when** policy/navigation/requests run, **then** affordances follow §2 and cached company/account data never populates a totals-only scope. | **Unit — Vitest/RTL**, policy/cache-scope test |

**Gates:** AC-001 in CI **plus** AC-002 on RIS rehearsal before acceptance. Only synthetic fixtures and sanitized pass/difference counts go public; live report bodies/coordinates stay private. No implementation/rehearsal is claimed here. Planner owns test paths and the schema/publication/aggregate-read ADR; build awaits owner sign-off.

## 6. Open questions (recommendations, not silent assumptions)

- **OQ-001 — Custom periods?** The owner specified a chosen period but not picker granularity. **Recommend** month/quarter/fiscal year for Phase 1. If custom dates are required, use the preceding equal-length range, explicitly labelled, and constrain each trial-balance range to one ERP fiscal year rather than silently accepting ERPNext's date clamping. Confirm at sign-off.
- **OQ-002 — Live settings / opening-balance equivalence?** Code cannot establish the rehearsal company's current reporting settings, calendar, finance books, precision or complete retained history. **Recommend** operator read-only capture and proof that full-ledger replay equals ERPNext's Account Closing Balance path, including unclosed prior years. Never alter ERP settings to force a match. If proof fails, keep statements unavailable and return the source-read design to planner/owner; no balancing plug or acceptance of a difference.
