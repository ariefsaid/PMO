# Odoo project actuals and financial statements — spec (#1507, route item O4)

- **Issue:** #1507 (Executor: Director-dispatched, money). **Blocked by** #1504 (master data: project ↔ analytic-account links, account mirror).
- **Status:** Draft for owner sign-off. **Plan:** `docs/plans/2026-11-07-odoo-actuals-statements.md`.
- **IDs:** `FR-ODA-###`, `NFR-ODA-###`, `AC-ODA-###`, `DD-ODA-#` (decisions taken), `OQ-ODA-#` (owner questions, each with the default taken), `V-ODA#` (Odoo claims to verify on the bed).
- **Builds on:** ADR-0048 (the ledger is the oracle; PMO sums, never invents), ADR-0094 (Odoo Community baseline, stock JSON-2 only), ADR-0058 (outbox; unused here, this slice only reads), `docs/specs/odoo-connect-master-data.spec.md` (sweep, links, account mirror), `docs/specs/financial-statements.spec.md` (#897 screens), `docs/specs/erp-journal-costs-on-project.spec.md` (#1919), `docs/specs/cost-attribution.spec.md`.

## 1. Job story

When I close a month on an Odoo-connected project, I want PMO's budget-versus-actual and statements to show what Odoo's ledger says, tied to the project and period, with a plain signal when a figure is old, unmapped or does not tie to Odoo, so I can trust the number or know exactly why not.

## 2. What exists today (observed, read at `origin/dev` 2026-11-07)

- **OBS-ODA-001** Project actuals are summed from the ledger mirror: `erp_gl_entry_mirror` → `refreshActuals` → `erp_actuals_snapshot` (per project, cost centre, account, fiscal year; `pmo-portal/src/lib/adapterSeam/erpnext/actualsSnapshot.ts:199`) → `project_mapped_actuals` per budget category through `budget_category_account_map` (`supabase/migrations/0290_project_finances.sql:214`) → `get_project_finances` (budget-versus-actual). Only the ERPNext sweep fills the mirror (`supabase/functions/erpnext-sweep/index.ts:91`, `ledgerMirrorFeed.ts`). The projection is tier-neutral; its feed and its project map (`external_org_bindings.config.project_map`, `projectMap.ts`) are ERPNext's.
- **OBS-ODA-002** The shared `actuals.read` suite (`contractSuite/actuals.suite.ts`, AC-ENA-060 + NEW-1 cases) pins the attribution rules: an ERP project linked to exactly one PMO project attributes; no project, an unlinked project, or an ambiguous link stays visibly unattributed. ERPNext passes it through `refreshActuals` (`erpnext/contract.reads.harness.ts:66`). Odoo's harness rejects it as pending #1507 (`odoo/contract.harness.ts:338-339`), and `odoo/workflowDeclarations.ts:46-49` declares `actuals.read`, `budget.push`, `budget.unowned-occupant`, `budget.resolve-occupant` pending #1507.
- **OBS-ODA-003** "Ledger basis" (actual cost only from the ledger, never from PMO documents; count-once) is chosen by `org_reads_erp_ledger()` which is true only for an **active ERPNext** binding (`0307_erp_ledger_basis.sql:2-15`). 43 migrations name `external_tier = 'erpnext'`; the journal-cost list builds its project map from the ERPNext binding config (`0687_erp_journal_cost_lines.sql:15-19`).
- **OBS-ODA-004** Statements (#897, `docs/specs/financial-statements.spec.md`) display **saved ERPNext standard-report responses** (Trial Balance, P&L, Balance Sheet, project P&L), captured by `statementReportRefresh.ts` and published by `publish_erp_financial_statements` (0319, hard-wired `external_tier='erpnext'`). Independent mirrored-ledger calculation is explicitly **parked** (OD-FS-023; ADR-0088 banner). Screens: `pages/FinancialStatements.tsx`, `pages/project-detail/ProjectProfitLossSection.tsx`, DAL `src/lib/db/financialStatements.ts`.
- **OBS-ODA-005** Odoo already on dev: `account.move.line` is read for post-write checks (`procurementAdapter.ts:368`, `revenueAdapter.ts:78`), `analytic_distribution` is written as `{"<analytic id>": 100}` on bill and invoice lines and read back (`purchase/billReadBack.test.ts`), the sweep loop (`odoo/sweep.ts` keyset on `write_date`, page 200, overlap 600 s, daily census) feeds master data, purchase and revenue (`_shared/odooSweep.ts:158,250`, `odooRevenueFeed.ts:40`), master mirror holds `account` with `account_type` (`odoo/kinds.ts:65`) and analytic accounts (`kinds.ts:71`), and capability discovery already flags `account.move.line` (`discovery.ts:35`).
- **OBS-ODA-006** The bed verification (`docs/research/2026-10-31-odoo20-dev-bed-verification.md` §4–§5, §9–§10) verifies `account.move` (`name, move_type, state, write_date`), `account.account` (`code, name, account_type`), `analytic_distribution` as `{"<string id>": number}`, 1,001-record keyset paging at page 200/1,000. It does **not** verify `account.move.line` accounting fields (`parent_state, date, debit, credit, balance, company_id, account_id, currency_id`), analytic keys spanning several plans, grouped reads, fiscal-year fields, or any report model. All of those are `V-ODA#` below.
- **OBS-ODA-007** The s-curve actual line (`docs/specs/scurve-actual-line.spec.md`) comes from task completion, not the ledger. This spec does not touch it.

## 3. Scope

**In:** read posted Odoo journal lines into the existing ledger mirror with source, period and project attribution kept; a per-sweep reconciliation of PMO's sums to Odoo's own grouped totals; freshness, unmapped and unattributed signals; Odoo-tier project actuals (budget-versus-actual) through the existing projection; Odoo-tier statements (Trial Balance, Profit and Loss, Balance Sheet, project P&L) computed from the mirror; declaring `actuals.read` supported and the three `budget.*` workflows unavailable.

**Out (fenced):**
- **`budget.push`, `budget.unowned-occupant`, `budget.resolve-occupant`** are not built. Odoo Community has no budget object (DD-ODC-5, `docs/plans/2026-11-01-erp-connect-anytime.md` §12). They are declared `unavailable` with that reason here (DD-ODA-6); PMO budgets stay PMO-only on Odoo.
- Any write to Odoo: this issue only reads. No outbox, no new Odoo command.
- Posting, closing, period lock, cash flow, consolidation, GL drill-down to Odoo screens, auditor export (as #897).
- Multi-currency: company-currency amounts only; a line in another currency is mirrored at its company-currency value and flagged (OQ-ODA-5).
- Odoo analytic **plans other than the project plan** as a cost dimension (department and similar) and the analytic ledger `account.analytic.line` as an amount source (DD-ODA-2).
- Bank reconciliation state, aging reports (AR/AP from Odoo's own ledger; O3/O2 own invoice-level outstanding), tax returns, stock valuation postings (O5).
- Moving existing orgs between bases silently; see FR-ODA-060.

## 4. Definitions

- **Ledger line** — one posted `account.move.line` of the activated company: debit, credit, account, date, journal, move name, partner, `analytic_distribution`, company-currency amounts.
- **Attribution row** — one mirror row per (ledger line × analytic account in its distribution) carrying that account's share of the line, plus one **unattributed row** for any share not in a linked project account.
- **Linked project account** — an analytic account that exactly one PMO project links to through `external_project_bindings` (tier `odoo`, container = analytic id).
- **Ledger basis** — the org's actual cost and statements come from the ledger mirror, not PMO documents (`org_reads_erp_ledger()`).
- **Caught up** — the ledger feed cursor has read to the present (no `write_date` page left) and the last daily census finished.
- **Reconciled** — for the latest check, PMO's per-account debit and credit sums over mirrored posted lines equal Odoo's grouped sums for the same company and cut-off.

## 5. Decisions taken (DD-ODA-#)

- **DD-ODA-1 One pipeline.** Odoo ledger lines are written into `erp_gl_entry_mirror` as attribution rows, so `refreshActuals`, `erp_actuals_snapshot`, `project_mapped_actuals`, `get_project_finances`, the count-once rule and #1919's journal list work unchanged. No second actuals table, no second projection. Row key `erp_name = 'odoo:<line id>:<analytic id | ->'`; `voucher_type = 'account.move'`; `voucher_no` = move name; `account` = account code (company-scoped, V-ODA3); `project` = analytic account id as text; `is_cancelled` = line not posted.
- **DD-ODA-2 Source is `account.move.line`, split by PMO.** The brief's JSON-2 path. The share of a line is `balance × percentage`, exact decimal, the last share absorbs the cent remainder so the rows sum to the line. `account.analytic.line` (Odoo's own split) is read only as a cross-check if V-ODA2 shows it equal; it is not the source because it omits unattributed lines and mixes timesheets.
- **DD-ODA-3 Statements are computed on read from the mirror, in SQL, for the Odoo tier only.** Odoo Community has no usable statement report (V-ODA9: `account.report` holds only the tax report, no lines, no callable engine), so the saved-report model of #897 cannot apply. The read RPCs return the existing statement payload shape so the screens are reused; the snapshot/publish machinery (`erp_financial_statement_*`) is not extended to Odoo. Honesty comes from reconciliation (FR-ODA-040) and freshness (FR-ODA-030), not publication.
- **DD-ODA-4 The oracle test is Odoo's grouped totals.** PMO's sum is checked per sweep against a stock grouped read (V-ODA5); a mismatch is shown, never hidden or corrected by PMO.
- **DD-ODA-5 Fiscal year.** From the company's fiscal-year-end month and day if V-ODA4 finds them readable, else the calendar year (OQ-ODA-3).
- **DD-ODA-6 Declarations.** `actuals.read` → `supported` v1; `budget.push`, `budget.unowned-occupant`, `budget.resolve-occupant` → `unavailable` with reason "Odoo Community has no budget object; budgets stay in PMO".
- **DD-ODA-7 Basis switch is an explicit, gated Admin action** (FR-ODA-060), never automatic on connect.

## 6. Functional requirements (EARS)

### Reading the ledger

- **FR-ODA-001** When the Odoo sweep runs for an org with an activated Odoo binding whose capability snapshot reports `account.move.line` readable, the system shall read posted and non-posted ledger lines of the activated company page by page (keyset on `write_date`, overlap window, as `odoo/sweep.ts`) and apply each page and its cursor in one database call.
- **FR-ODA-002** The system shall write one attribution row per (line × analytic account) and one unattributed row for any share not belonging to a linked project account, such that the rows of a line sum to the line's debit and credit exactly.
- **FR-ODA-003** Where a distribution key names several analytic accounts (a combination across plans, stored as comma-joined ids such as `"157,159"`, V-ODA6), the system shall attribute to the account that belongs to the org's project plan and ignore the others for attribution.
- **FR-ODA-004** Where two PMO projects claim one analytic account, or a project account belongs to no PMO project, the system shall leave the amount unattributed (the shared suite rule, OBS-ODA-002).
- **FR-ODA-005** While a line is not posted (draft, cancelled) the system shall keep its rows with `is_cancelled = true` so no sum counts them; when Odoo returns a line to posted it shall count again.
- **FR-ODA-006** When Odoo changes a line's distribution or amount (reset to draft and repost), the system shall replace that line's rows in one transaction; a stale older re-delivery shall not overwrite a newer row.
- **FR-ODA-007** When a line no longer exists in Odoo, the daily census shall remove its rows (as ERPNext's absent-row rule), so deleted data never lingers in sums.
- **FR-ODA-008** The system shall keep per row: source document (move name, journal), posting date, account, partner, the Odoo write time, and the share applied, so every figure traces to an Odoo line.
- **FR-ODA-009** While the feed is catching up after connect (first read of history), the system shall bound each tick by the sweep's call and time budget, resume from the cursor, and report not-caught-up.

### Freshness, unmapped, reconciliation

- **FR-ODA-030** The system shall expose per org: ledger as-of time (last successful page apply or empty poll), caught-up flag, and last census time; and shall classify the ledger **stale** when the as-of time is older than 30 minutes while the connection is healthy, or **unavailable** when the connection is not healthy (last data kept, labelled, as FR-ODC-033).
- **FR-ODA-031** The system shall report, for any scope (org, project, period): posted amount in accounts **not mapped** to a budget category, amount **unattributed** (no project), amount on analytic accounts **no PMO project links**, and counts of each, so unmapped data is identifiable by reason, account and amount.
- **FR-ODA-040** After each caught-up sweep (at most once an hour per org) the system shall read Odoo's grouped debit and credit per account for posted lines of the activated company up to a fixed cut-off (the cursor time minus the overlap), compare each with PMO's sum over the same lines, and record the result: checked-at, cut-off, accounts checked, accounts differing with both figures.
- **FR-ODA-041** If the grouped read fails or is unsupported, the system shall record "not checked" with the reason and keep the previous result with its time; it shall never show "matches" without a successful check.
- **FR-ODA-042** If a difference appears only for lines changed after the cut-off, the system shall re-check at the next sweep rather than report a mismatch.

### Project actuals (budget versus actual)

- **FR-ODA-050** While the org is on ledger basis, the project budget-versus-actual shall show actuals from `project_mapped_actuals` over the Odoo-fed snapshot, per budget category, with the ledger as-of time, a freshness state, a reconciliation state, and the unmapped / unattributed amounts of the project's scope as a separate, clearly labelled line that is not added into any category.
- **FR-ODA-051** When the user opens a category's actual, the system shall list its source lines (date, move name, journal, account, partner, share, amount) from the mirror, bounded and paged (no silent PostgREST truncation).
- **FR-ODA-052** Where a project has no linked analytic account, the system shall say actuals cannot be attributed yet and link to the project's cost-account setting; it shall not show zero.
- **FR-ODA-053** The refresh of the actuals snapshot shall run after the ledger feed in the Odoo sweep, scoped to the Odoo project map (`external_project_bindings`), whole-org and atomic (`replace_erp_snapshot`), exactly as ERPNext's.

### Statements

- **FR-ODA-020** When an authorised user opens statements for an Odoo org on ledger basis, the system shall show Trial Balance (per account: opening, period debit, period credit, closing), Profit and Loss (income and expense accounts by Odoo `account_type`, period, net) and Balance Sheet (asset, liability, equity accounts cumulative to the period end), each for a month, quarter or fiscal year and the preceding equivalent period.
- **FR-ODA-021** The Balance Sheet shall show "current-year earnings" as income minus expense to date within the fiscal year, labelled derived, and shall show total assets equal total liabilities plus equity, or an explicit "does not balance" state with the difference.
- **FR-ODA-022** A project statement shall use only attribution rows of that project's linked account; there shall be no company-minus-project remainder, as #897.
- **FR-ODA-023** Every statement screen shall show the ledger as-of time, freshness, reconciliation state, and the unmapped / unattributed amounts for the same scope; a statement over a not-caught-up ledger shall say it is partial.
- **FR-ODA-024** Statement and account labels shall be Odoo's account code and name, plain; no internal jargon ("mirror", "GL", "analytic distribution") in visible or accessible copy; both locales.
- **FR-ODA-025** Where Odoo books a closing/opening entry or year-end move, the statement shall show the ledger as Odoo has it and add no PMO closing logic.

### Basis switch and roles

- **FR-ODA-060** The system shall move an Odoo org to ledger basis only when an Admin chooses to, and only while the ledger is caught up and the latest check is "matches" (or an Admin confirms an explained difference). Until then, the org keeps today's document basis and the ledger sections say "Odoo ledger not in use yet". The switch needs a current check (not stale, over at least one account when the mirror holds lines) and a caught-up feed; a "not checked", missing or stale check is refused with no override, and a confirmed difference needs a written reason, kept in the audit. Moving back to the document basis is out of scope: a service-side action only, no Admin reverse switch.
- **FR-ODA-061** Reading ledger actuals and statements shall be permitted to the same roles as ERPNext's: Admin, Executive, Finance (company statements, line detail); Project Manager and Engineer see project totals for projects visible under projects RLS. The database is the authority; every read and write is scoped to the caller's org and a foreign-org row behaves as not found.
- **FR-ODA-062** The reconciliation, health and switch controls shall be shown to Admin and Finance only.

### Workflows

- **FR-ODA-070** The shared `actuals.read` suite shall run against an Odoo harness that drives the shipped line-to-row mapper and the shared refresh, and pass unchanged.

## 7. Non-functional

- **NFR-ODA-001 Exactness.** Money is exact decimal end to end (no float): Odoo values are read as decimal strings or numbers converted without rounding loss, and the mirror columns are unscaled numeric.
- **NFR-ODA-002 No silent truncation.** Every read (mirror, snapshot, line list, statement) pages by key or returns everything; no 1000-row cap can drop a figure.
- **NFR-ODA-003 Budgeted sweep.** The ledger pass obeys the tick's call and time budget (`ODOO_SWEEP_TICK_MAX_CALLS`, `ODOO_SWEEP_TICK_TIME_BUDGET_MS`) and reserves calls for the other kinds; a backlog never starves master data, purchase or revenue feeds.
- **NFR-ODA-004 Statement read cost.** A statement is one database call, indexed on (org, company, posting date, account); target under 1 s for 130,000 lines (ADR-0088 sizing). Measured in the plan's perf task.
- **NFR-ODA-005 Least access.** The service user needs only read on `account.move.line` and `account.account`; any extra group needed is recorded for the runbook (V-ODA10, NFR-ODC-003).
- **NFR-ODA-006 Public repo.** Fixtures use invented names and synthetic amounts only.

## 8. Open questions (OQ-ODA-#) — default taken

| # | Question | Default taken |
|---|---|---|
| **OQ-ODA-1** | Is PMO computing Odoo statements (subtotals from summed lines) acceptable, given ADR-0048 and #897 parked recomputation? | **Yes for Odoo only.** Odoo Community offers no report API, so showing a saved report is impossible; sums plus a per-sweep tie to Odoo's own grouped totals keep the ledger the oracle. ERPNext statements stay native-report display. |
| **OQ-ODA-2** | Who moves an Odoo org to ledger basis and when? | **Admin, explicitly**, once caught up and reconciled (FR-ODA-060). No automatic flip, as ADR-0094 forbids automatic ownership flips. |
| **OQ-ODA-3** | Fiscal year for Odoo lines? | **Company fiscal-year end if readable (V-ODA4), else calendar year.** |
| **OQ-ODA-4** | How far back to read? | **All posted history of the activated company**, bounded per tick. A start-date cap (e.g. current and prior fiscal year) is available if V-ODA7 shows history is too large. |
| **OQ-ODA-5** | Foreign-currency lines? | **Mirror company-currency value, flag the line** (`amount_currency` present); no conversion by PMO; multi-currency stays out as O2/O3. |
| **OQ-ODA-6** | Include #1919's Odoo journal-list follow-up (FR-JEC-041)? | **Yes**, one filter and one URL branch, because the rows land with `voucher_type = 'account.move'` and the list must not silently skip them. |
| **OQ-ODA-7** | Stale threshold? | **30 minutes** on a healthy connection (sweep is 5 minutes). |
| **OQ-ODA-8** | Webhook nudge for ledger changes? | **No**; polling only (O1 Q1 default: drop webhooks). |

## 9. Bed verdicts (V-ODA#) — verified on the dev bed 2026-11-07 (S0); detail in `docs/research/2026-10-31-odoo20-dev-bed-verification.md` §11

Each claim was run as a probe case (`node scripts/odoo-probe.mjs --actuals --case V-ODA#`); the stock shapes are in `__fixtures__/json2.ts`. Where the bed differs the FR/DD above is amended.

| # | Verdict | Feeds |
|---|---|---|
| V-ODA1 | **Verified.** All 15 fields return to the bot. `move_name` is `false` for a never-posted draft; `parent_state` is `draft`, `posted`, `cancel`; display types `product`, `payment_term`, `tax`, `line_note`, `line_section` (note and section lines have `account_id = false`, balance 0). Keyset pages at 200 and 1,000. | FR-001/002 |
| V-ODA2 | **Verified.** Odoo's analytic split of 100.01 at 60/40 is −60.01/−40 (odd cent to the larger share), equal to PMO's split; sign is the negative of `balance`. `account_id` reads `false` on `account.analytic.line` (per-plan columns). Cross-check only, as DD-ODA-2 says. | DD-ODA-2 |
| V-ODA3 | **Verified.** `account.account` has `company_ids`; the same code exists in two companies as different record ids; unique within a company. Map by `(company, code)`. | FR-008, account map |
| V-ODA4 | **Verified.** `fiscalyear_last_month` is a string (`"12"`), `fiscalyear_last_day` a number; the lock dates read `false` when unset. `period_lock_date` does not exist. | DD-ODA-5 |
| V-ODA5 | **Verified: `formatted_read_group` works** (`groupby`, `aggregates: ['debit:sum','credit:sum']`, `date:month` allowed, `limit` honoured; 480 groups in one call, no cap seen). `read_group` with `fields` is 422; `_read_group` is 403. | FR-040 |
| V-ODA6 | **Verified.** All forms are stored verbatim and never refused: single, multi-plan `"157,159"`, 50, 150, non-project plan, 33.33/66.67. | FR-002/003 |
| V-ODA7 | **Verified.** 130,000 lines: 200/page p50 169 ms, p95 291 ms; 1,000/page p50 335 ms, p95 847 ms (60 calls: 12,000 and 60,000 lines in 10.7 s and 23.4 s). Whole-company grouped read 0.9 s. Deeper than 60 pages not timed. | FR-009, NFR-003 |
| V-ODA8 | **Verified.** Reverse touches the original's `write_date` and adds a posted reversal move; reset-to-draft and cancel keep line ids and name and bump `write_date` with `parent_state` draft/cancel; draft delete leaves no tombstone (id sweep); posted delete is 422. | FR-005/006/007 |
| V-ODA9 | **Verified, with a correction to the claim.** `account.report` is reachable but holds only the generic tax report (3 records, zero lines); no engine method is callable (404); no balance-sheet or P&L definition exists. Statements cannot be read as saved reports. | DD-ODA-3, OQ-ODA-1 |
| V-ODA10 | **Verified.** `base.group_user` + `account.group_account_readonly` passes all 7 read calls; Billing and Accountant also pass; an internal user with no accounting group is refused (403) on lines and moves. | NFR-005 |
| V-ODA11 | **Verified.** Opening and year-end entries are ordinary posted `entry` lines in a `general` journal; the closing credits an `equity_unaffected` account; the cumulative sum by `account_type` is right with no special case. | FR-020/025 |

## 10. Acceptance criteria (Given / When / Then; layer key ADR-0010: U unit, P pgTAP, E e2e, B live bed, gated on the bed and never on CI)

| ID | Criterion | Owning layer |
|---|---|---|
| AC-ODA-001 | **Given** a posted line of 1,000.01 with distribution `{101: 60, 102: 40}` **When** mapped **Then** two rows 600.01 and 400.00 sum to the line, project accounts attributing; a distribution summing to 80 leaves a 20% unattributed row; no distribution gives one unattributed row | U `ledgerLineRows.test.ts` |
| AC-ODA-002 | **Given** keys `"101"`, `"101,205"` (205 in another plan) and a 101 shared by two PMO projects **When** mapped **Then** the first two attribute to 101's project and the third is unattributed | U |
| AC-ODA-003 | **Given** the shared `actuals.read` suite **When** run on the Odoo harness **Then** it passes unchanged (AC-ENA-060 and the NEW-1 cases) | U contract suite (Odoo tier) |
| AC-ODA-004 | **Given** a page of lines and a cursor **When** applied twice, then with an older re-delivery **Then** rows are identical, the cursor never rewinds and a stale row does not overwrite a newer one; a failing page leaves the cursor | P `odoo_ledger_feed.test.sql` |
| AC-ODA-005 | **Given** a posted line later reset to draft, edited to a different distribution and reposted **When** the pages apply **Then** no row of the old split remains and sums equal the new line; the draft stage counted nothing | P |
| AC-ODA-006 | **Given** a line deleted in Odoo **When** the census finishes **Then** its rows are gone and project actuals drop by its share; a census that did not finish removes nothing | P |
| AC-ODA-007 | **Given** mirrored rows over mapped and unmapped accounts **When** a Finance member reads project actuals **Then** category actuals equal the mapped sums and the unmapped amount appears separately with its accounts and is in no category | P `odoo_project_actuals.test.sql` |
| AC-ODA-008 | **Given** Odoo grouped totals equal to the mirror, then one account differing, then a failing grouped read **When** the check is recorded **Then** states are matches, differs (account, PMO figure, Odoo figure), and not checked (previous result kept with its time) | U `ledgerReconcile.test.ts` + P (record RPC) |
| AC-ODA-009 | **Given** a healthy connection with an as-of 31 minutes old, a not-caught-up feed, and an unhealthy connection **When** health is read **Then** states are stale, catching up, and unavailable with last data kept | U + P `get_odoo_ledger_health` |
| AC-ODA-010 | **Given** lines in an unmapped account, with no analytic account, and on an analytic account no PMO project links **When** health is read for the org and for a project **Then** each reason shows its count and amount, separately | P |
| AC-ODA-011 | **Given** a mirror with lines across two years **When** the Trial Balance is read for a month **Then** each account shows opening, period debit, period credit and closing, and total debits equal total credits | P `odoo_statements.test.sql` |
| AC-ODA-012 | **Given** income and expense lines in a fiscal year **When** P&L is read **Then** income, expense and net equal the sums by account type for the period, and the preceding period is read independently | P |
| AC-ODA-013 | **Given** asset, liability, equity and P&L lines **When** the Balance Sheet is read **Then** cumulative balances and the derived current-year earnings give assets = liabilities + equity; with a seeded imbalance it states "does not balance" with the difference | P |
| AC-ODA-014 | **Given** two linked projects **When** project P&L is read for one **Then** only that project's rows count and nothing is derived as company-minus-project | P |
| AC-ODA-015 | **Given** the signed roles, an inactive member, anonymous and a foreign-org caller **When** line detail, company statements, project totals and health are read **Then** only the signed roles read; a Project Manager reads totals of visible projects only; foreign data behaves as not found | P `odoo_ledger_privacy.test.sql` |
| AC-ODA-016 | **Given** an Odoo org that has not been switched **When** the Admin tries to switch before caught up or with a "differs" check **Then** it is refused with the reason; **when** caught up and matching **Then** it succeeds, is audited, and the org reads ledger basis | P |
| AC-ODA-017 | **Given** ledger-basis project actuals in each state (fresh, stale, partial, differs, not checked, unmapped, no linked account) **When** rendered **Then** each state shows its plain message and an unlinked project shows no zero | U RTL `ProjectBudgetOdooActuals.test.tsx` |
| AC-ODA-018 | **Given** the Odoo statement states (loading, error, not in use yet, partial, populated, does not balance) in both locales **When** rendered **Then** values, as-of time and badges show with no internal jargon | U RTL `OdooStatementsSection.test.tsx` |
| AC-ODA-019 | **Given** the declarations **When** the parity and tier tests run **Then** Odoo declares `actuals.read` supported v1 and the three budget workflows unavailable with the reason | U `parity.test.ts`, `odoo/contract.test.ts` |
| AC-ODA-020 | **Given** an Odoo line in a project's account **When** the journal list reads it **Then** it lists with `account.move`, and a PMO-posted bill's line is not listed as a stray journal | P (extends `erp_journal_cost_lines` pgTAP) |
| AC-ODA-021 | **Given** a stock bed with a posted bill and invoice carrying a project analytic account, a split line and an unattributed line **When** the ledger pass and the check run **Then** the mirror's per-account sums equal Odoo's grouped totals to the cent and project actuals equal the posted amounts | B `odooLedgerFeed.bed.test.ts` |
| AC-ODA-022 | **Given** the bed and an Admin **When** a Finance user opens project budget-versus-actual and then the Trial Balance **Then** both show the ledger as-of time, "matches Odoo", and the same project total | E `e2e/AC-ODA-022-odoo-actuals-statements.spec.ts` (bed-gated like the shipped Odoo specs; skip allowlisted) |
| AC-ODA-023 | **Given** 130,000 synthetic mirror rows **When** a statement and the actuals refresh run **Then** each completes in budget, with no truncation | P/perf script `scripts/odoo-ledger-perf.mjs` (recorded, not a CI gate) |

## 11. Traceability to the issue acceptance

"Given posted journal lines, when a user opens project actuals or a statement, then totals reconcile to the ERP and unmapped or stale data is identifiable":
- reconcile to the ERP → AC-ODA-008, 021, 022; posted lines only → AC-ODA-005;
- unmapped identifiable → AC-ODA-007, 010, 017; stale identifiable → AC-ODA-009, 017, 018;
- project actuals → AC-ODA-003, 007, 017; statement → AC-ODA-011..014, 018.
