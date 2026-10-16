# Financial statements — Phase 1 implementation plan (#897)

**Date:** 2026-10-16 · **Contract:** `docs/specs/financial-statements.spec.md`, signed 2026-10-16; unchanged. **Design:** [ADR-0088](../adr/0088-financial-statements.md). **Status:** revised implementation instructions, not implementation or reconciliation evidence.

## Execution and exit

**35 tasks, five sequential PR batches:** B1 source (7) → B2 aggregation (7) → B3 publication/read seam (7) → B4 UI (7) → B5 rehearsal/acceptance (7). Director-dispatched money/read-model/RLS work, not factory ADWs (`docs/factory-workflow.md`, Executor routing). Use current `docs/pi-delegation.md` builder/reviewer routing: one independent reviewer per PR covering spec, quality/performance and security; Director retains money-path mutation and rendered judgment. Create linked batch work items before code dispatch; #897 is the acceptance umbrella. Each code PR targets dev from its own clean worktree. No push, merge, production deployment or ERP posting is authorized by this plan.

Each task is a bounded TDD editing checkpoint: write its named failing assertion, run the specified command RED, implement only that behavior, rerun GREEN, refactor. The 2–5 minute target applies to individual assertion/edit cycles, not external capture, full command runtime or an entire report port; repeat those cycles within the named checkpoint. Never commit RED or weaken an oracle. Tests import shipped code. AC-001 **and executed AC-002** must pass before acceptance; OQ-002 remains a blocker, not an assumed result.

## Grounding and size

Inspected artifacts on this branch, not assertions about deployed database state:

- `supabase/functions/erpnext-sweep/index.ts`: `runErpSweepCycle`, `feedOrgLedgersLive`, HTTP entry wiring; `supabase/migrations/0102_erpnext_sweep_cron.sql`: five-minute async HTTP scheduling. In those deciding paths there is no per-org single-flight acquisition spanning the cycle. Watermark monotonicity is not mutual exclusion. **Add and test single-flight in B1.**
- Writer search scoped to production `supabase/functions/`, `pmo-portal/src/` and SQL migrations: the GL/PLE mirror mutation implementation is `ledgerMirrorFeed.ts`, called by the sweep's `feedOrgLedgersLive`; dispatch/webhook document mirrors are not GL feed writers. Recheck this bounded inventory at build time; route any additional ledger/account writer through the same sweep, not a second publication path.
- `ledgerFetch.ts`: 500-row pages, default 20-page limit, `modified asc, name asc`, inclusive existing modified watermark. `ledgerMirrorFeed.ts`: natural key `(org_id,erp_name)`, cancellation flags, existing paged guard. `0101_erp_accounting_snapshots.sql`: GL debit/credit are **numeric(14,2)**; the inspected migration history through 0293 contains no subsequent type alteration for them.
- [ERPNext v16.33.0 GL Entry metadata](https://github.com/frappe/erpnext/blob/v16.33.0/erpnext/accounts/doctype/gl_entry/gl_entry.json) declares debit/credit as Currency without a two-decimal override. Frappe's v16 [Postgres](https://github.com/frappe/frappe/blob/version-16/frappe/database/postgres/database.py) and [MariaDB](https://github.com/frappe/frappe/blob/version-16/frappe/database/mariadb/database.py) Currency mappings support decimal(21,9). **Two decimals can lose supported ERP precision** (e.g. 0.123456789 becomes 0.12), so widen GL debit/credit to unscaled numeric and backfill; do not widen PLE or unrelated snapshots. This is a supported-domain finding, not a claim that live rows have fractional loss. Rehearsal records the actual Frappe revision/settings and precision.
- Read the signed spec in full, plus existing accounting provenance/dashboard, repository/DAL and project-finances seams; `scripts/{check-isolation-denominator.mjs,isolation-probe-denominator.json,check-edge-fn-test-binding.mjs,check-e2e-skips.mjs,e2e-local.sh}`. `scripts/prior-art.sh financial-statements` found #897/#894 and the preceding ADR; that scoped search proves no broader absence. Repository visibility check returned **PUBLIC**.

Design target: **one company, ~1,300 ledger lines/two years today; 130,000 lines at 100×**, five-minute sweep. One in-memory source and one output array are appropriate. Use paged fetches, bulk writes and indexed aggregation, not per-account SQL. Measure 130,000 synthetic lines across the complete supported period catalogue in the deployed Deno runtime before release; the whole refresh must fit its actual CPU/memory/request limits and one tick. A timeout, page budget or oversized request is failure/delay, never permission to truncate. Do not claim the scale target from a Node-only microbenchmark.

## Minimum design contract

### 1. One writer, stable local source

The sweep is the **only writer** of both ledger mirrors and the new account master. At each org's cycle start, reserve a dedicated PostgreSQL session and execute:

```sql
select pg_try_advisory_lock(hashtextextended('erpnext-sweep:' || $1::text, 0)) as acquired;
```

`$1` is the server-enumerated org UUID, never caller-selected browser scope. If held, skip this org's tick without touching its source/status; other orgs continue. Hold through feed, aggregation and publication; unlock/close in `finally`. On connection/process death the session releases the lock. **A transaction-lock RPC that returns before HTTP/TS work does not protect that work.** Do not use a session lock over transaction pooling or a PostgREST acquire/release pair.

New `supabase/functions/erpnext-sweep/sweepSession.ts` uses pinned `npm:postgres@3.4.7` in that function's `deno.json`/`deno.lock`, one reserved connection, no transparent reconnect/retry. Director prepares session-capable runtime connectivity privately; no coordinates or credential names in public docs. Missing connectivity defers work, never falls back to unlocked writes. Run ledger/account/watermark/status mutations and the publication RPC on **that same session**, under `service_role`; session loss therefore also prevents a stale worker's later mutation. Adapt the existing feed's narrow structural service seam with fixed parameterized SQL for the known tables, not a general SQL API, new ERP client or new RPC family. Keep the existing modified guard/natural keys and PLE behavior. Other sweep passes keep their existing HTTP service client and ordering. No database transaction is held across ERP HTTP or TypeScript aggregation.

After feed writes finish, this sole writer makes the local mirror stable for paginated reads while aggregation runs. No frozen source copy is needed. ERP may still change independently: single-flight guarantees **local mirror coherence**, not an ERP database snapshot. A successful paged feed must explicitly report completion; malformed/failed pages are not EOF. Read chart/settings/calendar again before publication and defer on change; AC-002 additionally validates the full ERP source before/after its capture. Do not build durable source verification inventories into the scheduler.

**Ceiling:** “ponytail: single-flight sweep; if refresh outgrows one tick, move to generations”. Do not implement that future design now.

### 2. Full chart and simple replay flag

Sequence under the lock:

`read replay flag → full chart/metadata scan → upsert chart → ledger feed (full if flag was set) → validate references → aggregate all periods → one publication RPC`.

- Full paginated Account scan every sweep, including disabled historical accounts; activation probes read permission and schedules the first scan, not a long activation HTTP request. Read Company currency/default book, applicable Fiscal Years, Accounts/System Settings and Currency precision/cutoff through existing ERP transport. Require IDR and the signed report profile; no PMO defaults for missing metadata.
- Assemble and validate the complete chart before writing; upsert/remove obsolete chart identities in one short session transaction. Store every spec §2 account field. Reject orphan/cycle/duplicate nested-set identity and ambiguous project-map inversion. A moved parent simply restates both columns under the current hierarchy.
- Add **four simple columns on existing `external_org_bindings`**: `statement_full_ledger_replay_needed boolean not null default true`, `statement_update_delayed boolean not null default true`, `statement_last_attempt_at timestamptz`, `statement_calendar jsonb` (safe supported date pairs only, no ERP names/settings). No candidate/source-state table. After a complete chart/metadata scan, save the validated safe calendar on the locked session, keeping delayed true; SQL publication validates against that calendar even on first publication. A newly offered period without a snapshot is unavailable, not zero. Existing binding writers preserve these columns; binding/company activation changes set replay needed/delayed. Ordinary users cannot mutate them. No new credentials/settings/history fingerprints go into this row.
- If any account name referenced by **uncancelled** company ledger rows is absent from the complete chart, set the org replay flag and delay publication. No guessing from account labels/numbers. **The next sweep** starts a full historical replay, omitting `since`, even if linked entries' modified timestamps did not change. An unresolved reference after replay leaves the flag set and publication delayed.
- Migration initially sets replay needed for every existing binding. Legacy null company/opening/book fields are unknown, never fabricated. Replay populates explicit `company`, `is_opening` and `finance_book`; blank finance book is valid. Only a fully fetched/validated replay reconciles obsolete GL names. Fetch into memory, then bulk upsert and delete absent old names in one short transaction. A failed/incomplete fetch performs no replay reconciliation and does not advance its watermark. Do not purge cancelled rows still present upstream.
- Replay restarts from the beginning on failure; no saved compound cursor, seen-row staging or partial-replay promotion. Retain existing incremental watermark for normal feeds. For this profile use 500-row GL pages with a **300-page ceiling** (150,000 rows, requiring a short/empty final page); this covers the 130,000-line target, including equal-modified timestamps, without a new durable cursor. Budget exhaustion is incomplete, not success; full replay remains requested. Measure the real one-tick budget rather than assuming 300 HTTP calls always fit.
- Only successful publication clears replay/delayed flags. First success requires historical backfill; later failures leave old snapshots and `as_of` byte-identical. Start an attempt by setting delayed/attempt time; a crash therefore stays honest. Missed five-minute cadence also reads delayed. Refresh status is never result time.

### 3. Schema, publication and access

Recheck next free migration slot before dispatch; planned slots are 0294–0296. Use `scripts/renumber-migration.sh` on collision. Each has `supabase/migrations/rollback/<same-stem>_down.sql`. No explicit BEGIN/COMMIT in migration/down files: runner/test connection owns transactions.

| Migration | Physical changes / hot indexes |
|---|---|
| `0294_statement_account_source.sql` | `erp_account_mirror`: UUID id, org FK/default `auth_org_id()`/stamp trigger; company, erp_name, all spec §2 chart columns, erp_modified, as_of, `refresh_id uuid` (run identity only). Unique `(org_id,company,erp_name)`; index `(org_id,company,lft)`. Add four binding columns above. |
| `0295_statement_ledger_source.sql` | Existing GL mirror: nullable `company text`, `is_opening text` checked Yes/No when known, `finance_book text`; widen only debit/credit to numeric. Index `(org_id,company,id)` and `(org_id,company,posting_date,account)`. Preserve natural key, cancelled-state and existing amount consumers. |
| `0296_financial_statement_publication.sql` | `erp_financial_statement_snapshot`: UUID id, org FK/default/stamp, company, snapshot_id UUID, `source_generation uuid` (successful sweep's refresh_id, **not a relation/FK**), statement, scope_kind company/project/unassigned, nullable project_id, view_kind account_breakdown/project_totals, period_kind month/quarter/fiscal_year, four date bounds, IDR currency, as_of, detail-only source_report/report_version/filters/settings, payload JSONB, has_activity. Unique NULLS NOT DISTINCT on org/company/statement/scope/project/view/period/four dates; index `(org_id,company,period_kind,current_start,statement,view_kind,project_id)`. Check project iff project scope, project_totals only for project P&L. |

New tables ENABLE/FORCE RLS, explicit SELECT/write grants. Add **both new tables and every new function/view surface** to the appropriate isolation denominator/coverage checks in its introducing PR; do not add entries for removed relations. Machine publication is the **only new service RPC**:

```sql
-- SECURITY DEFINER; fixed search_path = public, pg_temp; service_role EXECUTE only
publish_erp_financial_statements(p_org_id uuid, p_company text,
  p_refresh_id uuid, p_as_of timestamptz, p_rows jsonb) returns void
-- authenticated EXECUTE; SECURITY INVOKER; fixed search_path
get_financial_statement_catalogue(p_project_id uuid default null) returns jsonb
get_financial_statement(p_period_kind text, p_period_start date,
  p_statement text, p_project_id uuid default null,
  p_view_kind text default 'account_breakdown', p_unassigned boolean default false) returns jsonb
```

Publication executes on the sweep's locked session and re-enters the same advisory lock transactionally to serialize supporting concurrent service calls. Reject older/equal replacement `as_of` after locking, so a late older call cannot replace a newer result. Validate activated binding/company, server-stamped org, allowed period pairs, scope/project membership/mapping, both columns, decimal strings, one refresh/time, payload shape and duplicate keys **before** delete. The pure aggregator returns the complete row set; its unit test asserts all catalogue periods × three company reports × mapped-project detail/totals P&L plus unassigned P&L. SQL checks this same finite catalogue/map directly (set equality/counts), not a stored expected-scope manifest. Missing one row or either column rejects the call. Then delete that org+company's rows, insert the supplied complete array and clear replay/delayed/update safe calendar in **one transaction**. No staging RPC/chunks. A failure rolls everything back; best-effort delayed status after failure never edits the old snapshot. Batch insert transport/payload size is benchmarked; refusal preserves the prior result rather than publishing a prefix. A complete-empty scope is still an explicit success row.

Role contract is unchanged: active same-org Admin/Finance/Executive read accounts, both ledger mirrors and detail snapshots; Project Manager/Engineer read **only** totals for projects visible under existing projects RLS. Target policies are explicit/restrictive alongside tenancy and independent stronger predicates; test actual grants and policies at migrated head. No ordinary user writes to these read-models or executes publication. Project visibility uses invoker `exists(select 1 from public.projects p where p.id = project_id and p.org_id = public.auth_org_id())`, not PM assignment guesses or service-role enumeration.

Store project-total rows as a whitelist: current/prior income/expense/net, dates, currency, snapshot/source run UUID, as_of and has_activity only. Detail-only provenance columns must be null there; no chart, settings, filters, party/voucher/company figures or raw ERP project identifiers, even on direct SELECT. Invoker reads construct a whitelist DTO and accept no org/company/source override. A fixed security-barrier owner-rights view `erp_financial_statement_availability` explicitly filters org/active/five real roles, exposing only safe calendar, last-success time, snapshot id and delayed boolean; readable company label is null for project staff. It never projects the binding body. Recheck requested project in the invoker RPC even for absent results.

Read each statement as one envelope in one SQL statement. Catalogue carries snapshot identity; if publication races catalogue/detail reads, DAL retries once on identity mismatch, then reports retryable error. This is result consistency, not a resumable source generation.

### 4. Pure aggregation and oracle

Production directory: `pmo-portal/src/lib/adapterSeam/erpnext/financialStatements/`; relative `.ts` imports, Deno+Vitest importable, no browser/React/DB client. Core contracts in `types.ts`:

```ts
export type Amount = string;
export type PeriodKind = 'month' | 'quarter' | 'fiscal_year';
export type StatementKind = 'trial_balance' | 'profit_and_loss' | 'balance_sheet';
export interface Period { start: string; end: string; fiscalYear: string; yearStart: string }
export interface PeriodPair { kind: PeriodKind; current: Period; prior: Period }
export interface ProfitTotals { income: Amount; expense: Amount; net: Amount }
export interface TrialValues {
  openingDebit: Amount; openingCredit: Amount; debit: Amount; credit: Amount;
  closingDebit: Amount; closingCredit: Amount;
}
export interface StatementRow {
  key: string; parentKey: string | null; depth: number;
  accountName: string; accountNumber: string | null;
  kind: 'account' | 'subtotal' | 'total' | 'provisional_profit' | 'unclosed_profit';
  current: Amount | TrialValues; prior: Amount | TrialValues;
}
export interface StatementAccount {
  erpName: string; parentAccount: string | null; accountName: string;
  accountNumber: string | null; rootType: 'Asset'|'Liability'|'Equity'|'Income'|'Expense';
  reportType: 'Balance Sheet'|'Profit and Loss'; isGroup: boolean; lft: number; rgt: number;
  accountType: string | null; includeInGross: boolean; disabled: boolean; accountCurrency: string;
}
export interface StatementLedgerLine {
  name: string; company: string; account: string; postingDate: string;
  fiscalYear: string; project: string | null; voucherType: string | null;
  debit: Amount; credit: Amount; isCancelled: boolean;
  isOpening: 'Yes'|'No'; financeBook: string | null;
}
export interface FiscalYear { name: string; start: string; end: string }
export interface StatementSource {
  refreshId: string; company: string; asOf: string;
  accounts: readonly StatementAccount[]; ledger: readonly StatementLedgerLine[];
  projectMap: Readonly<Record<string,string>>;
  metadata: { version: '16.33.0'; currency: 'IDR'; defaultFinanceBook: string | null;
    calendar: readonly FiscalYear[]; precision: number; floatPrecision: number;
    roundingMethod: "Banker's Rounding"|"Banker's Rounding (legacy)"|'Commercial Rounding';
    zeroCutoff: Amount; ignoreOpeningCheck: boolean; ignoreAccountClosingBalance: boolean };
}
export interface StatementSnapshotWrite {
  statement: StatementKind; scopeKind: 'company'|'project'|'unassigned'; projectId: string | null;
  viewKind: 'account_breakdown'|'project_totals'; periods: PeriodPair; hasActivity: boolean;
  payload: { rows: StatementRow[] } | { current: ProfitTotals; prior: ProfitTotals };
  filters: { current: Record<string,unknown>; prior: Record<string,unknown> } | null;
}
export function aggregateFinancialStatements(source: StatementSource): StatementSnapshotWrite[];
export function statementPeriods(calendar: readonly FiscalYear[]): PeriodPair[];
```

`decimal.ts` uses exact base-10 coefficient/scale BigInt, aligned add/subtract and upstream-compatible quantize; no package/lock regeneration. Preserve ERP numeric tokens before Number conversion using the existing `client.ts` transport's opt-in `responseNumbers: 'ledger_decimal_text'` and `decimalJson.ts` source-context reviver for debit/credit. Feature-test actual Node/Deno support; missing support fails closed, never falls back to floats. Read Postgres numeric as text on the pinned session. Missing/nonfinite required amounts fail. Quantize at upstream report boundaries (including prepare_data's three decimals and opening-check precision), not per input line. Capture precision, rounding method and zero cutoff (`0.5 / (fraction_units || 1)`) from ERP. Format decimal strings without Number conversion.

Port behavior against independent standard-report fixtures, not copied GPL Python:

- Company currency IDR, uncancelled leaf GL only, default plus blank/null finance book; no cost-centre/dimension/template/consolidation filters. Disabled historical accounts remain; current chart restates both columns. Union nonzero current/prior rows with ancestors; roll children up once, root totals never sum displayed parents+children again.
- TB includes closing entries for opening/current, six separate values in both columns, net opening/closing, groups shown, prior-year P&L opening off. Opening predicate includes pre-start **or is_opening=Yes**; P&L opening uses that column's fiscal year; ordinary activity excludes opening entries. Honor the captured ignore-opening setting's alternate predicates and upstream group netting order.
- P&L nonaccumulated, Income credit-positive/Expense debit-positive, exclude Period Closing Voucher. Mapped project adds only exact project filter. Company includes all rows; mapped totals plus null/unmapped remainder tie before rounding and at report precision. Reject ambiguous map inversion.
- BS accumulates Asset debit-positive, Liability/Equity credit-positive independently to each end; posted retained earnings remain Equity. Provisional = assets − liabilities − posted equity. Reproduce opening check/unclosed-earlier-years row and subtraction exactly as standard execute returns them; never manufacture a balancing entry. Closing/cancelled closing cannot double-count profit.
- Construct every month/quarter/fiscal-year pair from applicable ERP fiscal boundaries, preceding equivalent included, each column's own fiscal-year context/filter JSON. Missing/ambiguous preceding calendar is unavailable, not clamped or guessed. No arbitrary retention horizon. Index ledger by account/project/period once and roll hierarchy once per report; reuse BS prefix sums, no account×ledger scan.

Synthetic source and independent report output live in `financialStatements/fixtures/{source,opening,unclosed,closed,cancelled,books-projects,boundary,decimal}.json`. Record pinned report version/source hashes, complete current/prior filters/settings/precision and capture provenance. `scripts/financial-statements-oracle.py --config-fd 3` reads only an operator-prepared synthetic company and normalizes standard ERP report output. Never calculate expected values with the production aggregator; absent independent capture blocks B2, not permission to invent fixtures.

### 5. UI/repository brief (kept)

**Operate/Read, incumbent DESIGN.md**, not a dashboard redesign. Finance's job: read the bound company's books for a period and explain the preceding period. Heading → readable company/IDR → period picker with explicit dates → statement selector → small Updated provenance → comparison table. No KPI tile wall, exports, diagnostics or accounting writes.

- `/financial-statements` → `pmo-portal/pages/FinancialStatements.tsx`, Finance rail for Admin/Finance/Executive independent of `revenue` entitlement. Finance selects company/mapped project detailed P&L or explicit finance-only unassigned remainder. Project Overview mounts `pages/project-detail/ProjectProfitLossSection.tsx` for authorized project viewers, independent of invoice-finances permission: three totals only, same period picker.
- Shared `src/components/financial-statements/{FinancialStatementsSection,StatementTable,StatementPeriodPicker}.tsx` composes Card/CardHead, DataTable, ListState, SelectField/Button and existing `AccountingSnapshotProvenance`. Add backwards-compatible localized `updatedLabel` support, preserving old callers. Translate readable report names, not technical source/version identifiers.
- `src/lib/db/financialStatements.ts` RPC-only DAL → `src/lib/repositories/financialStatements.ts` registered in `{types,index}.ts` → `src/hooks/useFinancialStatements.ts`. No client org/company/ERP filter argument. DTO/strict validators and decimal formatter in `src/lib/financialStatements.ts`. `unavailable` vs complete with `delayed`, `hasActivity`, immutable asOf/snapshotId/sourceGeneration, precision, periods and **either** detail rows **or** totals; errors stay error/retry. Same-scope background failure retains old data/time plus delayed; absent is not zero. `hasActivity` reflects report activity/opening/closing basis, not array length.
- Query keys: family, org, user id, **real role**, view kind, company/project/unassigned scope, period kind/start, statement. Disable denied requests, clear family on identity/org/real-role change, no previous-data placeholder across scope/role/period. Validate response scope before render. Admin view-as changes no JWT authority.
- Right-aligned Inter tabular money, account hierarchy/names/numbers, current/prior date headers; BS as-at, P&L activity, TB six grouped fields per range. At phone width DataTable's single responsive branch groups comparisons per account; no hidden duplicate DOM, page overflow or clipped values. `min-w-0`, wrapping long names, named tables, keyboard focus, DESIGN.md tokens.
- Complete English/Indonesian keys under `financialStatements` in `public/locales/{en,id}/common.json`: Financial statements/Laporan keuangan; Trial balance/Neraca saldo; Profit and loss/Laba rugi; Balance sheet/Neraca; Updated/Diperbarui; Update delayed/Pembaruan tertunda; Statements are not available yet/Laporan keuangan belum tersedia; No activity in this period/Tidak ada aktivitas pada periode ini; Not assigned to a project/Belum dialokasikan ke proyek; Previous period/Periode sebelumnya; As at/Per tanggal. Translate controls/loading/retry/six TB fields/profit rows too. FR-007 banned tokens/raw identifiers stay out of text, errors, tooltips and accessible labels.

## Canonical traceability (one owner per AC)

| AC | Owning test path / layer | Batch | Proof |
|---|---|---|---|
| AC-001 | `pmo-portal/src/lib/adapterSeam/erpnext/financialStatements/aggregate.oracle.test.ts` — Vitest | B2 | Every account/subtotal/total/profit/current/prior field equals independent ERP output; amount mutation reddens. |
| AC-002 | `pmo-portal/e2e/serial/AC-002-financial-statements-rehearsal.spec.ts` — Playwright | B5 | Private read-only all-row ERP↔PMO reconciliation plus real Finance UI totals; source change invalidates. |
| AC-003 | `supabase/tests/0296_financial_statement_privacy.test.sql` — pgTAP | B3 | Roles × active × org; direct accounts/both ledgers/detail and writes/EXECUTE. |
| AC-004 | `supabase/tests/0296_financial_statement_project_totals.test.sql` — pgTAP | B3 | Invoker project visibility, stored/returned whitelist, forged scope denied. |
| AC-005 | `pmo-portal/src/lib/adapterSeam/erpnext/accountMirrorFeed.test.ts` — Vitest | B1, finalized B3 | Complete chart/move/rename/merge/disabled/replay/failure preserve last result/time. |
| AC-006 | `supabase/tests/0296_financial_statement_publication.test.sql` — pgTAP | B3 | One complete replacement, both columns, duplicate/foreign/incomplete rejection, rollback and serialization. |
| AC-007 | `pmo-portal/pages/__tests__/FinancialStatements.scope.test.tsx` — RTL | B4 | Bound company/ERP calendar, fiscal boundaries and scope/date labels without stale results. |
| AC-008 | `pmo-portal/src/components/financial-statements/FinancialStatementsSection.test.tsx` — RTL | B4 | Both locales, all honest states, provenance/precision/a11y/plain copy. |
| AC-009 | `pmo-portal/src/hooks/useFinancialStatements.permissions.test.tsx` — RTL | B4 | Real-role policy/nav/route/view-as/request/cache isolation. |

Every owning title starts with its AC id. Supporting two-connection tests prove actual overlap; sequential pgTAP alone does not.

## Exact gate vocabulary (repository root)

```bash
U() { scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run "$@"' bash "$@"; }
TC() { scripts/with-test-lock.sh bash -c 'cd pmo-portal && npm run typecheck'; }
DB() { scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db "$@" && node scripts/check-isolation-denominator.mjs' bash "$@"; }
PG() { scripts/with-db-lock.sh supabase test db "$@"; }
EDGE() { scripts/with-db-lock.sh bash -c 'cd supabase/functions/erpnext-sweep && deno test --allow-all "$@"' bash "$@"; }
ONBOARD() { (cd supabase/functions/erpnext-onboard && deno test --allow-all "$@"); }
DENO() { (cd supabase/functions/erpnext-sweep && deno lint "$@" && deno check "$@"); }
FINAL() {
  TC || return
  scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run --changed origin/dev' || return
  while IFS= read -r file; do
    case "$file" in
      pmo-portal/*.ts|pmo-portal/*.tsx)
        (cd pmo-portal && npx eslint --max-warnings=0 "${file#pmo-portal/}") || return 1 ;;
      scripts/*.mjs) node --check "$file" || return 1 ;;
    esac
  done < <(git diff --name-only --diff-filter=ACM origin/dev -- pmo-portal scripts)
}
```

Before migration gates: `ls supabase/migrations | tail`; confirm slots. In B1/B3 only, reset+tests under **one** DB lock; no resets in code/UI/rehearsal batches. Generate types after schema batches:

```bash
scripts/with-db-lock.sh bash -c 'supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts'
node scripts/check-edge-fn-test-binding.mjs
```

Each batch runs FINAL plus its targeted gates below; ≥80% changed-line coverage, no red/skipped proof claimed as acceptance. Deno changed files also pass function-local `deno lint`/`deno check`; pre-commit retains changed function suites and binding guard. CI PR→dev verify+pgtap / PR→main verify+integration is the full merge gate; no local full-suite chain. Touched e2e uses `scripts/e2e-local.sh`, never bare Playwright for final lane coverage. Reviewers consume builder evidence and rerun only a doubted check. Public evidence is synthetic or counts/pass/fail only.

## B1 — Single-flight source, chart and replay (tasks 1–7)

**Boundary:** 0294/0295 forward/down migrations, feed and sweep serialization; no statement publication/page. ERP-originating outbox behavior stays unchanged.

1. **Single-flight (AC-005/006 support).** First add `supabase/functions/erpnext-sweep/statementSingleFlight.test.ts` importing real `./index.ts`: two same-org ticks, one skip; different org continues; throw/disconnect releases; lock acquired before feed and retained through refresh. Add supporting `scripts/financial-statements-publication-race.test.mjs` using existing `scripts/node_modules/pg` and two real local sessions to assert acquire/skip/release/disconnect. Implement `sweepSession.ts` and per-org `try/finally` wiring described above; reserve session, disable reconnect, export existing HTTP callback as `handleSweepRequest` with unchanged auth and import-safe serve guard. Add pinned Deno driver import/lock, no app package-lock rewrite. HTTP mocks use globalThis.fetch; do not add production handler DI. **Verify:** `EDGE statementSingleFlight.test.ts ledgerRefresh.test.ts; scripts/with-db-lock.sh node --test scripts/financial-statements-publication-race.test.mjs`.
2. **Complete chart/metadata (AC-005/007 support).** First add `accountFetch.test.ts` and `statementMetadata.test.ts` beside `ledgerFetch.ts`: paginated disabled/group fields, company scope, page-two error, IDR/default book/applicable non-January FY/settings/precision/rounding/cutoff, malformed fields fail. Implement `accountFetch.ts` and `statementMetadata.ts` with existing `erpnextRequest`; account scan has no modified filter. **Verify:** `U src/lib/adapterSeam/erpnext/accountFetch.test.ts src/lib/adapterSeam/erpnext/statementMetadata.test.ts`.
3. **Account schema/replay status (AC-003/005 support).** First add `supabase/tests/0294_statement_account_source.test.sql` asserting the chart shape/keys/stamp/role grants, four binding columns, replay initially true, no ordinary status writes. Add `0294_statement_account_source.sql`/`rollback/0294_statement_account_source_down.sql`, denominator account entry and exact inverse. First add `accountMirrorFeed.test.ts` complete-chart assertions; implement `accountMirrorFeed.ts` full validated chart transaction on locked session. **Verify:** `DB supabase/tests/0294_statement_account_source.test.sql; U src/lib/adapterSeam/erpnext/accountMirrorFeed.test.ts -t 'AC-005.*complete chart'`.
4. **Ledger fields/precision (AC-001/005 support).** First extend existing `ledgerFetch.test.ts`, `client.test.ts`, `ledgerMirrorFeed.test.ts` for company/is_opening/book, cancellations and raw numeric 0.123456789/large/scientific tokens; add `supabase/tests/0295_statement_ledger_source.test.sql` precision round-trip/nullable legacy/index checks. Implement 0295/down, exact decimal transport opt-in in `client.ts`/new `decimalJson.ts`, `GlEntryRow`/GL_FIELDS/glRowToMirror extensions. Down refuses narrowing non-cent/out-of-range values. No legacy defaults; no PLE amount change. **Verify:** `U src/lib/adapterSeam/erpnext/ledgerFetch.test.ts src/lib/adapterSeam/erpnext/client.test.ts src/lib/adapterSeam/erpnext/ledgerMirrorFeed.test.ts; DB supabase/tests/0295_statement_ledger_source.test.sql supabase/tests/0274_ledger_mirror_cancelled_state.test.sql`.
5. **Replay lifecycle (AC-005).** First extend canonical `accountMirrorFeed.test.ts`: parent move restates once; missing uncancelled reference sets flag without publishing; next tick replays unchanged-modified renamed/merged rows; disabled history retained; failed page/malformed body/budget/unresolved reference preserves flag/old time. Implement `feedAccountMirror` and `ledgerMirrorFeed.ts` full-replay option, 300-page GL profile, in-memory fetch then transactional bulk reconcile, watermark advance only after success. Route GL/PLE/watermark writes through the locked session adapter. Include >20 pages with tied modified values and >1000 mirrored rows. **Verify:** `U src/lib/adapterSeam/erpnext/accountMirrorFeed.test.ts src/lib/adapterSeam/erpnext/ledgerMirrorFeed.test.ts src/lib/adapterSeam/erpnext/ledgerFetch.test.ts`.
6. **Activation/sweep binding (AC-005/006 support).** First extend `binding.test.ts`; add `supabase/functions/erpnext-onboard/statementReadiness.test.ts` and sweep `statementSource.test.ts`, each importing shipped index handler, mocking global fetch. Assert activation probes Account/Company/Fiscal Year/Accounts Settings/System Settings/Currency, schedules source next tick, and company changes request replay. Assert real sweep orders chart→ledger, requires explicit completion/no error, updates safe delayed state on failure and keeps accounting/recovery siblings. Implement wiring; extend binding guard REQUIRED entries. Deno test raw token survival in actual transport. **Verify:** `U src/lib/adapterSeam/erpnext/binding.test.ts; ONBOARD statementReadiness.test.ts; EDGE statementSource.test.ts statementSingleFlight.test.ts ledgerRefresh.test.ts; node scripts/check-edge-fn-test-binding.mjs`.
7. **Reversible source schema (AC-003/005 support).** First add `scripts/financial-statements-schema.test.mjs` (forward/down pairs, no embedded transaction control, denominator/index checks) and `scripts/financial-statements-rollback.test.mjs` (existing pg, local-only target, checked head, down/reapply in one self-restoring transaction). Assert narrowing refuses unsafe decimals using savepoint before continuing. Complete down files; regenerate client types; check session adapter cannot issue writes after disconnect. **Verify:** `node --test scripts/financial-statements-schema.test.mjs; scripts/with-db-lock.sh node --test scripts/financial-statements-rollback.test.mjs; DB supabase/tests/0294_statement_account_source.test.sql supabase/tests/0295_statement_ledger_source.test.sql`.

**B1 final gates:** `FINAL`; task 5 unit command; task 6 edge/onboard/binding commands; task 7 schema/rollback/DB commands; `DENO index.ts sweepSession.ts statementSingleFlight.test.ts statementSource.test.ts`; `(cd supabase/functions/erpnext-onboard && deno lint index.ts statementReadiness.test.ts && deno check index.ts statementReadiness.test.ts)`; `scripts/e2e-local.sh erpnext-feed-served-smoke`. Served dependency absent is not served-path proof; CI integration executes that lane. Record real overlap and lock-loss results, not just a lock function's existence.

## B2 — Pure reports and independent oracle (tasks 8–14)

**Boundary:** pure library + synthetic capture; no scheduler publication/read route. All files below under `pmo-portal/src/lib/adapterSeam/erpnext/financialStatements/` unless explicitly prefixed.

8. **Independent fixture contract (AC-001).** First `aggregate.oracle.test.ts` requires seven independent cases, complete per-column filters, pinned version/hashes/settings/precision. Implement `scripts/financial-statements-oracle.py --config-fd 3` and capture synthetic fixtures listed above from prepared ERP standard reports, never local expected-value arithmetic. Stop if capture unavailable. **Verify:** `U src/lib/adapterSeam/erpnext/financialStatements/aggregate.oracle.test.ts -t 'AC-001.*fixture provenance'; python3 -c 'import ast,pathlib; ast.parse(pathlib.Path("scripts/financial-statements-oracle.py").read_text())'`.
9. **Decimals/types (AC-001).** First `decimal.test.ts`: 0.1+0.2, nine decimals, huge/signed/scientific inputs, invalid/null, all ERP rounding ties and cutoff. Implement `decimal.ts` and `types.ts` contract above; no Number sum. **Verify:** `U src/lib/adapterSeam/erpnext/financialStatements/decimal.test.ts`.
10. **Period/tree/filter primitives (AC-001/005/007 support).** First `periods.test.ts` and oracle hierarchy/books case: non-January FY/leap/prior equivalence, missing/overlapping calendars, current hierarchy moves, disabled history, union-zero ancestry/default/blank books/unknown accounts. Implement `periods.ts`, `hierarchy.ts`, `filters.ts` with indexed reverse rollup and exact map inversion. **Verify:** `U src/lib/adapterSeam/erpnext/financialStatements/periods.test.ts; U src/lib/adapterSeam/erpnext/financialStatements/aggregate.oracle.test.ts -t 'AC-001.*hierarchy and books'`.
11. **Trial balance (AC-001).** First oracle trial cases exercise opening Yes inside/after range, same-FY P&L opening/reset, ignore-opening setting, posted/cancelled closing and all six current/prior fields/root totals. Implement `trialBalance.ts` in independent small red/green predicate/netting/rollup cycles; preserve upstream ordering. **Verify:** `U src/lib/adapterSeam/erpnext/financialStatements/aggregate.oracle.test.ts -t 'AC-001.*trial'`.
12. **Profit/loss attribution (AC-001).** First oracle P&L cases cover company/project/unmapped remainder, closing-voucher exclusion, cancelled originals/reversals and precision tie. Implement `profitAndLoss.ts`, assert project+remainder equality without allocation or duplicate map. **Verify:** `U src/lib/adapterSeam/erpnext/financialStatements/aggregate.oracle.test.ts -t 'AC-001.*profit and loss'`.
13. **Balance sheet/profit rows (AC-001).** First oracle BS cases cover IDR postings for USD bank, separate accumulated ends, posted equity, earlier/current unclosed profit, closed/cancelled close, row presence and opening-check precision. Implement `balanceSheet.ts`; separately test conditional presentation helper. Never correct upstream or force an unobserved unclosed row; escalate the pinned-source presentation question below. **Verify:** `U src/lib/adapterSeam/erpnext/financialStatements/aggregate.oracle.test.ts -t 'AC-001.*balance sheet'`.
14. **All-scope assembly/sensitivity/scale (AC-001/006 support).** First full oracle asserts exact key sets/every amount and complete finite period/scope/view set; changing one leaf must fail. Implement `aggregate.ts`, explicit empty rows and safe project totals, metadata-driven precision/hasActivity, indexed buckets/BS prefixes. Add `aggregate.performance.test.ts` with deterministic 130,000 synthetic lines and period/project coverage; export its measurement harness for Deno runtime rehearsal, no flaky wall-clock assertion on shared CI. **Verify:** `U src/lib/adapterSeam/erpnext/financialStatements --coverage`. Record real Deno limits/timing/RSS with B3 sweep; fit is a release gate, not an invented benchmark result.

**B2 final gates:** `FINAL`; task 14 coverage; task 8 Python parse/capture integrity; all oracle cells zero difference; mutation red then restored green. No live report bodies enter fixtures.

## B3 — Atomic publication, access and sweep/read seam (tasks 15–21)

**Boundary:** 0296/down plus single publish call and typed repository; no page. Reuse B1 session, not a second scheduler/writer.

15. **Privacy schema (AC-003).** First canonical `0296_financial_statement_privacy.test.sql`: exact roles/inactive/anonymous/other org; direct accounts/both ledgers/detail, ordinary row/status writes and machine EXECUTE. Implement 0296 snapshot/grants/RLS and signed role contract on existing ledgers, with explicit stricter-contract updates to `supabase/tests/{erp_accounting_snapshots_rls,0270_expense_ledger_read_scope,0279_employee_ledger_read_scope}.test.sql`; retain employee/tenancy/cancellation assertions. Add snapshot/function/view denominator coverage. Inspect role_table_grants/pg_policies at migrated head, not names alone. **Verify:** `DB supabase/tests/0296_financial_statement_privacy.test.sql supabase/tests/erp_accounting_snapshots_rls.test.sql supabase/tests/0270_expense_ledger_read_scope.test.sql supabase/tests/0279_employee_ledger_read_scope.test.sql`.
16. **Totals-only invoker read (AC-004).** First canonical `0296_financial_statement_project_totals.test.sql`: visible/nonvisible/foreign/nonexistent project, malicious company/detail/unassigned/override inputs, poison stored totals fields, availability view columns/rows and denied absence lookup. Implement invoker catalogue/statement RPCs, snapshot checks and safe availability view above. Existing projects RLS decides visibility. **Verify:** `PG supabase/tests/0296_financial_statement_project_totals.test.sql`.
17. **One atomic publish (AC-006).** First canonical `0296_financial_statement_publication.test.sql`: both-column complete replacement, missing period/scope/column, duplicate/foreign row, older timestamp, insert exception, complete-empty, old byte-identical values/as_of after failure. Implement ONE `publish_erp_financial_statements` transaction from contract: lock, validate, replace, clear replay/status/calendar together. Extend B1 two-session race test with publication interleavings and concurrent readers, commit/rollback and older-late rejection. **Verify:** `PG supabase/tests/0296_financial_statement_publication.test.sql; scripts/with-db-lock.sh node --test scripts/financial-statements-publication-race.test.mjs`.
18. **Sweep aggregate→publish (AC-005/006/008 support).** First `financialStatements/refresh.test.ts` and `supabase/functions/erpnext-sweep/statementPublication.test.ts` (real handler import/global fetch mocks): only complete error-free chart+ledger tick publishes once; replay waits next tick; every failure/budget/unclassified source retains old time and delayed; other orgs/actuals/aging/recovery still run. Implement `refresh.ts` reading stable session mirror via keyset pages with numeric text, calling shipped aggregator then one RPC, no staging. Finalize canonical accountMirrorFeed lifecycle tests through actual refresh seam. Before publish compare reread chart/settings/calendar; defer if changed. Run 130,000-line harness in actual Deno sweep and record CPU/memory/input/output size/elapsed counts privately as needed; if one tick cannot fit, return to Director, don't add resumability inside this brief. **Verify:** `U src/lib/adapterSeam/erpnext/accountMirrorFeed.test.ts src/lib/adapterSeam/erpnext/financialStatements/refresh.test.ts; EDGE statementSingleFlight.test.ts statementSource.test.ts statementPublication.test.ts ledgerRefresh.test.ts`.
19. **Strict DAL/repository (AC-007/008/009 support).** First new `src/lib/db/financialStatements.test.ts` and `src/lib/repositories/financialStatements.test.ts`: wrong scope/date/currency/precision, malformed money, detail fields on totals, catalogue/snapshot race retry once, errors never zero. Implement DTO/validators in `src/lib/financialStatements.ts`, RPC DAL, repository module/registration/types with `catalogue/get({periodKind,periodStart,statement,projectId,viewKind,unassigned})`. No org/company/ERP filter override. **Verify:** `U src/lib/db/financialStatements.test.ts src/lib/repositories/financialStatements.test.ts src/lib/repositories/index.test.ts`.
20. **Status and mutation proof (AC-003/004/006 support).** First SQL status cases for missed cadence/failed newer attempt/absent/empty/delayed original time. Finish safe status projection. Temporarily break role/project predicate and separately suppress transaction rollback/older-call guard; owning tests/race must fail, then restore and rerun green. Mutate single-flight away and require overlap test red. No copied authorization validators or public unfixed-control details. **Verify:** `PG supabase/tests/0296_financial_statement_privacy.test.sql supabase/tests/0296_financial_statement_project_totals.test.sql supabase/tests/0296_financial_statement_publication.test.sql; scripts/with-db-lock.sh node --test scripts/financial-statements-publication-race.test.mjs; EDGE statementSingleFlight.test.ts`.
21. **Rollback/index/seam proof (AC-003/004/006 support).** First extend schema/rollback tests for 0296 inverse, invoker/grant assertions and lookup indexes. Complete down SQL restoring preceding ledger grants/policies verbatim, dependency-ordered drops; generate types and EXPLAIN scoped snapshot/project lookup on many synthetic scopes. Test imports/binding guards and unchanged actuals/aging consumers. **Verify:** `node --test scripts/financial-statements-schema.test.mjs; scripts/with-db-lock.sh node --test scripts/financial-statements-rollback.test.mjs; U src/lib/adapterSeam/erpnext/actualsSnapshot.test.ts src/lib/adapterSeam/erpnext/accountingFanout.test.ts; node scripts/check-edge-fn-test-binding.mjs`.

**B3 final gates:** `FINAL`; `DB supabase/tests/0296_financial_statement_privacy.test.sql supabase/tests/0296_financial_statement_project_totals.test.sql supabase/tests/0296_financial_statement_publication.test.sql supabase/tests/erp_accounting_snapshots_rls.test.sql supabase/tests/0270_expense_ledger_read_scope.test.sql supabase/tests/0279_employee_ledger_read_scope.test.sql`; tasks 18/19/21 targeted commands; two-session race; `DENO index.ts sweepSession.ts statementSingleFlight.test.ts statementSource.test.ts statementPublication.test.ts`; `scripts/e2e-local.sh erpnext-feed-served-smoke`. Run rollback test after schema reset head is established. Do not restore broader raw access to fix an old consumer; use an explicitly authorized aggregate if needed.

## B4 — Permission-scoped UI, English/Indonesian (tasks 22–28)

**Boundary:** retained UI batch; AC-007/008/009 canonical proofs. Obtain directional owner/Director sketch-glance if not recorded; preserve incumbent UI, no new mockup battery. Paths below relative to `pmo-portal/` unless prefixed.

22. **Real-role permissions/cache (AC-009).** First canonical `src/hooks/useFinancialStatements.permissions.test.tsx`: every role, inactive, Admin view-as, denied deep link/request, identity/org/role/period/project changes with primed detail cache and late responses. Implement policy entities `financialStatements/projectProfitLoss`, `src/hooks/useFinancialStatements.ts` with scoped keys/disable/eviction and response scope checks from brief. **Verify:** `U src/hooks/useFinancialStatements.permissions.test.tsx src/auth/policy.test.ts src/auth/usePermission.test.tsx`.
23. **Company/period scope (AC-007).** First canonical `pages/__tests__/FinancialStatements.scope.test.tsx`: activated company vs CRM, non-January fiscal boundary, month/quarter/FY preceding dates, BS ends, rapid selection/stale response rejection. Implement `pages/FinancialStatements.tsx` and shared `StatementPeriodPicker.tsx` catalogue controls. Finance mapped/unassigned P&L picker never enables other statement scopes. **Verify:** `U pages/__tests__/FinancialStatements.scope.test.tsx`.
24. **Accessible comparison/table (AC-008).** First canonical `src/components/financial-statements/FinancialStatementsSection.test.tsx` populated cases: hierarchy/name/number, large/fractional decimal formatting, six TB values under each date range, BS/P&L semantics and axe. Implement shared `FinancialStatementsSection.tsx`/`StatementTable.tsx` with single responsive DataTable branch, Card/CardHead, tokens/tabular numbers; formatter accepts decimal strings/captured precision, no React money arithmetic. **Verify:** `U src/components/financial-statements/FinancialStatementsSection.test.tsx -t 'AC-008.*populated'`.
25. **Honest states/shared provenance (AC-008).** First canonical section cases loading/error+retry/absent/complete-empty/delayed/populated/background failure with original time; extend `AccountingSnapshotProvenance.test.tsx` to assert old callers unchanged and localized Updated mode. Implement ListState/state union and optional `updatedLabel`; readable report names only. **Verify:** `U src/components/financial-statements/FinancialStatementsSection.test.tsx src/components/AccountingSnapshotProvenance.test.tsx`.
26. **Project doorway/route/nav (AC-007/009).** First canonical permission/scope cases mount actual project Overview section for PM/Engineer/Finance, only three totals, no account/remainder/company controls; assert route/rail/deep-link visibility independent of invoice/revenue entitlements. Implement `pages/project-detail/ProjectProfitLossSection.tsx`, mount in `ProjectDetail.tsx`, lazy route in `App.tsx`, Rail link/`routeMatch.ts` label and `src/lib/i18n/launch-scope-routes.txt` entry. **Verify:** `U src/hooks/useFinancialStatements.permissions.test.tsx pages/__tests__/FinancialStatements.scope.test.tsx`.
27. **Both locales/rendered regression (AC-008).** First canonical section tests parameterize en/id state/table/a11y/keyboard and scan full accessible DOM for FR-007 banned tokens/raw synthetic ids. Add complete locale pairs from brief; supporting `e2e/financial-statements-presentation.spec.ts` uses synthetic page.route data, `@e2e-isolation: read-only`, 390/1440 × en/id × light/dark, no clipped values/page overflow. Fix composition without dropping assertions. **Verify:** `U src/components/financial-statements/FinancialStatementsSection.test.tsx; node scripts/check-i18n-completeness.mjs; scripts/e2e-local.sh financial-statements-presentation; bash scripts/check-e2e-isolation.sh`.
28. **Discover→graduate→cover (AC-007/008/009 support).** Render running page and project Overview on rich synthetic data, long Indonesian labels/large IDR/delayed/empty, keyboard and phone. Every finding first gets RED regression, then fix/re-render until clean; add route×oracle cells in `docs/qa-portfolio.md` and a genuinely learned retention rule in DESIGN.md or docs/decisions.md. Record clean evidence if no finding. **Verify:** `U pages/__tests__/FinancialStatements.scope.test.tsx src/components/financial-statements/FinancialStatementsSection.test.tsx src/hooks/useFinancialStatements.permissions.test.tsx; scripts/e2e-local.sh financial-statements-presentation`.

**B4 final gates:** `FINAL`; task 28 canonical tests plus task 27 i18n/isolation/e2e; `U src/components/AccountingSnapshotProvenance.test.tsx src/components/dashboard/AccountingSnapshotsSection.test.tsx`; `PG supabase/tests/0296_financial_statement_privacy.test.sql supabase/tests/0296_financial_statement_project_totals.test.sql` (no reset). ≥80% changed-line coverage and sanitized rendered evidence; mocked presentation is not AC-002.

## B5 — Private read-only rehearsal and acceptance (tasks 29–35)

**Boundary:** canonical AC-002 runner/journey, safety tests/runbook, acceptance counts; no posting/closing or production deployment. Operator prepares closed/unclosed/cancellation cases separately. OQ-002 may block acceptance without blocking unrelated batches. Before enabling automatic statement publication for the nominated rehearsal connection, Director runs source-only equivalence proof; this is a release checkpoint, **not** a new database witness/candidate subsystem.

29. **Read-only private runner (AC-002).** First `scripts/financial-statements-rehearsal.test.mjs` rejects credential argv, redirects/foreign origin, missing case/version/period and any ERP mutation route. Implement `scripts/financial-statements-rehearsal.mjs --config-fd 3` using builtins/existing scripts dependencies, descriptor-only private inputs, static safe errors/deadlines. Allow GET reads and exactly read-only POST to standard `frappe.desk.query_report.run`, not arbitrary POST/PUT/close. No production destination implicitly accepted. **Verify:** `node --test scripts/financial-statements-rehearsal.test.mjs`.
30. **Source-only opening equivalence (AC-002/OQ-002).** First source-proof runner tests require full historical source/settings/precision/calendar/book/version and closed/unclosed earlier-year cases; compare standard ERP Account Closing Balance path to **shipped** full-ledger aggregation. Implement `--source-only` importing `aggregate.ts` (Node TS stripping/compiled adapter, not copied logic). Preserve ERP settings; mismatches block publication enablement/acceptance and return to Director. No persisted public fingerprint/witness registration. **Verify:** `node --test --test-name-pattern='source proof' scripts/financial-statements-rehearsal.test.mjs`.
31. **All-row comparator/invalidation (AC-002).** First runner tests remove a subtotal/account, change prior/profit row/UI total or source after capture; all must fail. Implement full key/decimal-field comparison for TB/P&L/BS, mapped project P&L, remainder tie and each comparison with own FY/filter JSON. Before/after full ordered source/chart/settings/map inventory must match; private capture binds successful PMO refresh UUID/source state to that inventory. Live changes require new normal sweep and capture. **Verify:** `node --test --test-name-pattern='comparator|invalidation' scripts/financial-statements-rehearsal.test.mjs`.
32. **Actual Finance UI journey (AC-002).** First canonical `pmo-portal/e2e/serial/AC-002-financial-statements-rehearsal.spec.ts`: existing private Finance session, navigate real page, select every nominated supported period/company/project report, compare rendered labels/totals and matching refresh identity to independent ERP oracle. `@e2e-isolation: serial`: dedicated live ERP lane and org-wide capture/refresh coordination. Implement private runner IPC/capture input, no page.route/service-role-as-Finance oracle; runner invokes repository serial project with one worker. **Verify:** `scripts/e2e-local.sh AC-002-financial-statements-rehearsal` for absent-dependency path; live commands below prove execution.
33. **Dependency/skip/privacy guard (AC-002).** First runner tests: absent private dependency ⇒ justified skip; provided but malformed/unreachable/wrong-version ⇒ fail, never skip; stdout/stderr/attachments contain no live names/amounts/URLs/filters/errors. Implement 0700 private run directory/0600 files outside git; disable trace/video/screenshots/live attachments, safe count reporter, no credential environment names in public runbook. Add exact serial filename/reason/restore/date skip entry and stale-entry test; no process.env.CI gate. Live requires executed cases and zero skips. **Verify:** `node --test scripts/financial-statements-rehearsal.test.mjs; node scripts/check-e2e-skips.mjs --self-test; bash scripts/check-e2e-isolation.sh`.
34. **Preflight/runbook (AC-002).** First runner `--check` assertions reject incomplete prepared matrix without mutation. Implement `docs/runbooks/financial-statements-rehearsal.md`: Director-provided descriptor/session, source-only proof → enable normal sweep publication → complete refresh → Finance journey, invalidation/stop-on-difference, dependency restoration. No credential coordinates or live bodies. **Verify:** `node --test --test-name-pattern='preflight' scripts/financial-statements-rehearsal.test.mjs`.
35. **Execute/accept (AC-001/002).** Rerun synthetic oracle then private source-only and real Finance journey for operator-prepared closed/unclosed/cancelled-close/prior-opening matrix. Any cell/key/UI-total difference/source mutation is failure; fix shipped behavior and rerun, never change settings/post a plug/weaken expected output. Public `docs/reviews/2026-10-16-financial-statements-acceptance.md` contains only AC ids, code revision, verified software version, prepared/pass/difference counts and pass/fail. Pending blockers get neutral status; detail stays private. **Verify:** B5 exact commands below. External preparation/execution is a checkpoint, not a five-minute claim.

**B5 final gates:**

```bash
FINAL
node --test scripts/financial-statements-rehearsal.test.mjs
node scripts/check-e2e-skips.mjs --self-test
bash scripts/check-e2e-isolation.sh
U src/lib/adapterSeam/erpnext/financialStatements/aggregate.oracle.test.ts
scripts/e2e-local.sh AC-002-financial-statements-rehearsal
# Director supplies private JSON on inherited fd 3; no secret/path in argv/history.
scripts/with-erpnext-lock.sh scripts/with-db-lock.sh \
  node scripts/financial-statements-rehearsal.mjs --config-fd 3 --source-only
# After equivalence proof, publication enablement and complete normal sweep:
scripts/with-erpnext-lock.sh scripts/with-db-lock.sh \
  node scripts/financial-statements-rehearsal.mjs --config-fd 3
```

Runner owns private Playwright process/reporter. Never run ordinary local reset/e2e wrapper against a customer DB. Local PMO ↔ nominated rehearsal ERP is a Director-prepared dependency. Missing fd makes CLI fail; ordinary CI's allowed dependency skip is **not** acceptance. Lock order ERPNext→DB→test. Acceptance requires actually executed AC-002, zero differences/skips, matching UI totals and stable source.

## Rollback/handoff and explicit questions

Stop statement scheduling before rollback; retain existing accounting/recovery passes. Reverse 0296→0295→0294, tests only on local disposable DB under DB lock; down/reapply transaction always restores itself in finally. Restore prior policies/grants verbatim, types and denominator with their PR. Numeric narrowing refuses unsafe decimals/range; retain widened columns and escalate rather than rounding away data. No cloud reset/seed/raw migration. Session connectivity/setup is Director-owned; no operator secret coordinates in tracked evidence. Release record per batch: changed paths, RED/GREEN, coverage, mutations, schema/down evidence, reviewer conclusion, rendered judgment where applicable.

- **OQ-002 remains open:** actual source/settings/history and closing-balance equivalence require private capture. Do not enable the nominated source's publication until source-only proof passes; use the existing activation/scheduling controls, without adding a feature-specific durable readiness flag or witness. B3 proves publication on synthetic local data; enabling it on the nominated source is a separate Director checkpoint.
- **Spec's generation identity survives as a UUID, not a lifecycle system.** Account `refresh_id` and snapshot `source_generation` identify the same successful complete sweep. This meets §2 provenance/AC-005/006 without a generation table or copies. If an account scan succeeds but ledger/publication fails, the changed account master is not a newly published statement; old snapshot payload/time is retained.
- **Pinned BS presentation question retained:** standard execute decides presence/absence of unclosed-profit rows. The earlier plan noted separator/last-element behavior in upstream helpers; independently capture it. If signed expectations cannot be exercised on v16.33.0, stop that case for Director/owner rather than invent a row or modify the spec.
- **Period edge cases:** no custom dates or arbitrary retention cutoff; missing preceding FY is unavailable. Irregular calendar that standard reports clamp needs Director clarification, not silent date invention.
- **Local vs ERP coherence:** the lock freezes local writers only. NFR-002 is guarded by complete feed/backfill and source classification; rehearsal's before/after source validation proves parity to a stable ERP state. Continuous ERP changes mean delay/retry, not an ERP-wide lock or distributed capture protocol.

## Removed machinery / AC impact

**No removed mechanism is still required by an AC.** Necessary behaviors remain as follows; do not silently restore the implementation being removed.

| Removed item | Replacement / AC coverage |
|---|---|
| `erp_financial_statement_generation`; leases/epochs/takeover/renewal | One session single-flight sweep; per-run UUID provenance. AC-005 lifecycle and AC-006 atomic/concurrent publication remain. |
| Durable compound replay cursors/resume protocol | Existing normal modified watermark; full replay restarts from start under a simple org flag, one-tick 100× budget. AC-005 and NFR-002 still require complete reads. |
| `erp_financial_statement_source_line`; frozen per-refresh copies/capture/GC | Stable sole-writer mirror read in the locked sweep; no retained per-refresh source storage. AC-001 imports the pure aggregator; AC-002 retains only private rehearsal evidence. |
| Staging/output chunks/digests | One in-memory complete output array and one service-only replacement RPC. AC-006 transaction rollback preserves old values/time. |
| Stored expected-scope manifest | Direct SQL validation against finite supported calendar/map and pure all-scope completeness test; no persisted manifest artifact. AC-006 missing-scope rejection stays. |
| Claim/resume/chart/page/capture/stage/collect RPC family | Existing feed seam plus locked session fixed SQL; **only one new service publication RPC**, plus the retained invoker read RPCs. |
| Source candidate fingerprints/inventory persistence and database readiness witness | Same-tick source checks; Director's private source-only release checkpoint and AC-002 before/after capture invalidation. No new durable verification subsystem. |
| Seven-batch/64-task decomposition | Five batches/35 tasks; retained oracle, privacy, UI, denominator, rollback and rehearsal gates. |

**Batch list:** B1 single-flight/source (7); B2 pure aggregation/oracle (7); B3 atomic publication/access/read seam (7); B4 UI (7); B5 private rehearsal/acceptance (7). **Task count: 35.**
