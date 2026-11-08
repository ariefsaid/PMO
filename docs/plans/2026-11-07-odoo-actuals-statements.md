# Plan — Odoo project actuals and financial statements (#1507, O4)

- **Spec:** `docs/specs/odoo-actuals-statements.spec.md` (`FR/NFR/AC-ODA-*`, `DD-ODA-#`, `OQ-ODA-#`, `V-ODA#`). Read it first; this plan only sequences it.
- **Baseline:** `origin/dev` `5a4a5a4d0` (2026-11-07), dev migration head **0742**; `feat/odoo-s8-sends` holds **0743**. **Allowed range for this plan: 0744–0759** (`git ls-remote --heads origin` + `git ls-tree origin/<branch>` showed no branch on 0744–0759; **re-check at each build**).
- **Blocked by #1504** (project ↔ analytic-account links in `external_project_bindings`, account mirror `external_master_records`). S0 and S1 need neither and may start now; S2 onward needs #1504's links on dev.
- **Reuse, do not rebuild** (cited at the baseline): `erp_gl_entry_mirror` (`0101:30`, widened by `0295`), `refreshActuals` (`erpnext/actualsSnapshot.ts:199`), `replace_erp_snapshot` (`0150`), `project_mapped_actuals` (`0290:214`), `get_project_finances`, `erp_journal_cost_lines` (`0687`), the sweep loop (`odoo/sweep.ts`: keyset `write_date`, `PAGE_SIZE 200`, `OVERLAP_SECONDS 600`, census), the feed shape (`_shared/odooRevenueFeed.ts:40` `runRevenuePass`, `odoo/revenue/feed.ts` specs/readers, `apply_odoo_revenue_page` + census RPCs), the sweep wiring (`_shared/odooSweep.ts:158,250`), the shared suite `contractSuite/actuals.suite.ts`, the screens `pages/FinancialStatements.tsx`, `pages/project-detail/ProjectProfitLossSection.tsx`, `pages/ProjectBudget.tsx`, DAL `src/lib/db/financialStatements.ts`.
- **Money path:** every slice that writes or reads the ledger figures is money-path. Read `docs/money-path-primer.md` bucket 5 ("wrong number on screen") first: PostgREST `max_rows` truncation, stable paging, a fabricated `$0`. Nothing here posts to Odoo, so buckets 1–3 (duplicate money, adoption, SoD) do not apply; **bucket 4 (tenancy)** does: the sweep writes with the service role, so every writer RPC scopes by `p_org_id`.
- **Public repo:** invented names, synthetic amounts, no hosts or keys in fixtures, tests, runbook.

## 0. Decisions for the build (spec §5 and §8 defaults; Director overrides)

| # | Decision | Default |
|---|---|---|
| D1 | Mirror table | Reuse `erp_gl_entry_mirror`; Odoo attribution rows keyed `odoo:<line>:<analytic|->` (DD-ODA-1). No new actuals table. |
| D2 | Statements | SQL read RPCs over the mirror, Odoo tier only, same payload shape as `get_financial_statement` so the screens are reused (DD-ODA-3). No publish/snapshot machinery for Odoo. |
| D3 | Basis | `org_reads_erp_ledger()` widened to an Odoo binding **only** when an Admin has switched (`config.ledger_basis_at`), gated on caught-up + matching check (FR-ODA-060). |
| D4 | Reconciliation | Hourly after a caught-up tick, one grouped read per org; result row per check; never auto-corrects. |
| D5 | Budget workflows | Declared `unavailable` (reason in spec DD-ODA-6); nothing built. |
| D6 | Lines per tick | Set from V-ODA7's measured cost; start at `PAGE_SIZE` 200 pages, reserve 2 calls per other kind (`RESERVE_PER_KIND`). |

## 1. Gate vocabulary (CLAUDE.md local final gate; paste output bodies, not exit codes)

- **G-FE** (run in `pmo-portal/`): `npm run check:guards`; `~/.local/bin/pmo-slot tsc 2 bash -c 'cd pmo-portal && NODE_OPTIONS=--max-old-space-size=6144 npm run typecheck'`; `npx eslint --max-warnings=0 <touched files>`; `~/.local/bin/pmo-slot vitest 3 bash -c 'cd pmo-portal && npx vitest run --maxWorkers=2 <touched + mocking test files>'`. Never the full suite, never `--changed`.
- **G-DENO**: `cd supabase/functions/<fn> && deno test --allow-all <touched *.test.ts>` (inventory rules in `scripts/deno-test-edge-fns.sh`); `node scripts/check-edge-fn-test-binding.mjs`. Tests import the shipped handler and mock `globalThis.fetch`.
- **G-DB** (only when the branch adds a migration): `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db <touched pgTAP files>'` in **one** hold; grep the output for `Parse errors`; then `scripts/with-db-lock.sh node scripts/check-isolation-denominator.mjs` and `node scripts/check-isolation-denominator.mjs --self-test`. Known traps: pgTAP 0137 (service_role grants on new tables/functions), 0136 (side-mirror inventory), 0178 (anon-executable SECURITY DEFINER allow-list). Scope pgTAP by grepping `supabase/tests` for **every** function, table and column the migration touches.
- **G-SCRIPTS** (only if `scripts/` touched): `scripts/with-db-lock.sh node --test --test-timeout=120000 $(find scripts -maxdepth 1 -name '*.test.mjs' ! -name 'financial-statements-publication-race.test.mjs' ! -name 'financial-statements-rollback.test.mjs' ! -name 'check-isolation-denominator.test.mjs' ! -name 'verified-post-merge-cleanup.test.mjs' | sort)`.
- **G-UI**: `scripts/ux-proof.sh <route>`; `node scripts/affected-e2e.mjs`; touched journeys via `scripts/e2e-local.sh <fragment>`.
- **Mutation check** (money): name the rule, break it, see red, restore, inside one lock hold for DB mutations.
- Every migration: `supabase/migrations/rollback/<NNNN>_<slug>_down.sql`, RLS + `org_id` default/stamp trigger on every new table, i18n keys in **both** `public/locales/en` and `public/locales/id`, new feature keys in the FE registry (`features.dbRegistry.test.ts`).

## 2. Slice map

| Slice | What | Executor | Ships alone? | ACs |
|---|---|---|---|---|
| **S0** | Bed claims V-ODA1..11 | Orca worker (bed; claude or glm) | with S1 (docs + fixtures only) | closes the spec's V#s |
| **S1** | Contract-first pure parts: line fan-out, fiscal year, reconcile compare, Odoo `actuals.read` harness, declarations | Director-dispatched (money), Orca worker | no (inert until S3) | 001–003, 008 (U half), 019 |
| **S2** | Ledger feed writer: migration `0744`, apply + census RPCs | Director-dispatched (money), Orca worker | **yes** (new writer into a shared money table) | 004–006 |
| **S3** | Sweep wiring + actuals refresh for Odoo | Director-dispatched (money) | **yes** (first live ledger rows) | 003 (wired), 021 |
| **S4** | Reconciliation + health + line list reads: migration `0745` | Director-dispatched (money) | no | 007–010, 015 (part) |
| **S5** | Statements reads: migration `0746` | Director-dispatched (money) | no | 011–014, 015 |
| **S6** | Basis switch + tier-aware journal list: migration `0747` | Director-dispatched (money, auth) | **yes** (changes every money screen for a switched org) | 016, 020 |
| **S7** | Screens (project actuals, statements, health, switch) | Orca worker (ui-implementer contract); Director rendered review | no (UI lane: ux-proof + one review + one fix) | 017, 018 |
| **S8** | Acceptance: bed test, e2e, perf, runbook, roadmap | Orca worker (qa-acceptance) | no | 021–023 |

Order: S0 → S1 → (S2 → S3) → S4 → S5 → S6 → S7 → S8; S4 and S5 are independent after S2 and may run in parallel (max 2 heavy loads on the Mac). Branch per slice from `dev`; workers push branches only; Director batches 3–5 non-money branches per PR and ships the "yes" slices alone. Dev is the ceiling.

## S0 — Bed claims first (docs + fixtures; no product code)

Executor: Orca worker. Bed: `scripts/with-odoo-lock.sh scripts/odoo-dev-bed.sh up` (see `docs/environments.md` §Odoo bed). Probe style: `scripts/odoo-probe.mjs`; fixtures: `pmo-portal/src/lib/adapterSeam/odoo/__fixtures__/json2.ts` (shapes only, synthetic).

| Task | Do | Verify |
|---|---|---|
| S0-T1 | Add probe cases V-ODA1, V-ODA6, V-ODA10: seed one bill and one invoice with analytic splits `{a:60,b:40}`, `{a:100}`, a multi-plan key, none; `search_read` `account.move.line` with the V-ODA1 field list, domain by `write_date` keyset at limit 200 and 1,000; record `parent_state`, display types, field names, group set needed | `scripts/with-odoo-lock.sh node scripts/odoo-probe.mjs --case V-ODA1` prints each field with its type and value shape |
| S0-T2 | V-ODA2, V-ODA3, V-ODA4: compare `account.analytic.line` amounts to the 60/40 split with an odd cent; read `account.account.code` for two companies; read `res.company` fiscal-year and lock-date fields | same command, `--case V-ODA2` etc.; output copied into the doc |
| S0-T3 | V-ODA5, V-ODA9: try `formatted_read_group` and `read_group` on `account.move.line` grouped by `account_id` with `debit:sum`, `credit:sum`; try the accounting-report model | the call that works, its return shape and group cap; the report model's refusal body |
| S0-T4 | V-ODA7: load 130,000 synthetic lines (script in `scripts/odoo-bed/`, invented partner/amounts); time pages at 200/1,000 | table of page ms and lines/call recorded |
| S0-T5 | V-ODA8, V-ODA11: reverse, reset-to-draft+repost, cancel, delete a draft; opening-balance and year-end move shape; what `write_date` and the keyset show for each | cases print before/after `write_date`, `parent_state`, line ids |
| S0-T6 | Record every response in `docs/research/2026-10-31-odoo20-dev-bed-verification.md` as a new "§11 O4 findings" (verified / wrong / differs), add synthetic shapes to `json2.ts`, then edit the spec: replace each `V-ODA#` row with its verdict and amend any FR/DD the bed contradicts (notably DD-ODA-2, DD-ODA-3, OQ-ODA-1 if V-ODA5 or V-ODA9 differ) | `git diff --stat` shows only docs, `json2.ts`, `odoo-probe.mjs`, `scripts/odoo-bed/*`; `node --test scripts/odoo-probe*.test.mjs` if such a test exists; G-SCRIPTS if scripts touched |

**Exit:** no V-ODA left "unverified". If V-ODA5 fails (no grouped read), AC-ODA-008 changes to a paged-sum comparison over `search_read` and the spec is updated before S1. If V-ODA9 finds a usable report model, stop and ask the Director before S5 (OQ-ODA-1).

## S1 — Contract-first pure parts

Executor: Director-dispatched Orca worker, **money**. TDD red-green per task; each task is one failing test then the minimum code.

| Task | Test first → code | Verify |
|---|---|---|
| S1-T1 | `pmo-portal/src/lib/adapterSeam/odoo/ledger/ledgerLineRows.test.ts` AC-ODA-001: 1,000.01 split 60/40 gives 600.01 + 400.00; 80% leaves an unattributed row; no distribution → one unattributed row; negative (credit) lines; rows sum to the line. Code `ledgerLineRows.ts`: `fanOutLine(line, projectAccounts): Row[]` using `bigint` nano arithmetic as `actualsSnapshot.ts` `toNano` (no float) | `npx vitest run src/lib/adapterSeam/odoo/ledger/ledgerLineRows.test.ts` |
| S1-T2 | Same file, AC-ODA-002: keys `"101"`, `"101,205"`, ambiguous 101; non-posted → `is_cancelled`; foreign-currency flag (OQ-ODA-5). Code `parseDistributionKey` | same |
| S1-T3 | `ledger/fiscalYear.test.ts`: calendar default; FY end 31 March; 29 Feb. Code `fiscalYearOf(date, {month,day}|null)` | vitest file |
| S1-T4 | `ledger/ledgerFeed.test.ts`: the `KindSpec`-style reader for `account.move.line` (fields from V-ODA1, company filter, keyset by `write_date`/`id`, `parent_state` kept) over `fakeOdoo.ts` (add `account.move.line` accounting fields to its allow-list at `fakeOdoo.ts:31` in the same task); parse skips malformed rows and counts them. Code `ledger/feed.ts` (`LEDGER_FEED_SPEC`, `ledgerFeedReaders`) mirroring `odoo/revenue/feed.ts` | vitest file + `odoo/fakeOdoo.test.ts` |
| S1-T5 | `ledger/ledgerReconcile.test.ts` AC-ODA-008: equal → matches; one account differs → differs with both figures; grouped read throws or unsupported → not checked, reason; lines changed after cut-off excluded (FR-ODA-042). Code `ledgerReconcile.ts` (`compareTotals`, pure) | vitest file |
| S1-T6 | Odoo harness for the shared suite: `odoo/contract.ledger.harness.ts` exporting `readActuals` that runs S1-T1/T2/T3 mapping then the shipped `refreshActuals` on `FakePostgrest` like `erpnext/contract.reads.harness.ts:66`; replace the pending stub at `odoo/contract.harness.ts:339`. AC-ODA-003: the unchanged `actualsReadSuite` passes on tier `odoo` | `npx vitest run src/lib/adapterSeam/odoo/contract.test.ts src/lib/adapterSeam/contractSuite/` |
| S1-T7 | Declarations AC-ODA-019: `odoo/workflowDeclarations.ts:46-49` → `actuals.read` `supported` v1; the three `budget.*` → `unavailable` with the DD-ODA-6 reason; the budget-push stubs at `contract.harness.ts:272,338` keep rejecting as unavailable. Run `contractSuite/parity.test.ts`, `tierBranch.test.ts`, `odoo/contract.test.ts`; update `docs/plans/2026-11-01-erp-connect-anytime.md` row at line 1813 only if it names #1507 as pending | vitest files listed |
| S1-T8 | Mutation check: in `fanOutLine` drop the remainder cent; in `compareTotals` ignore credits; S1-T1/T5 must go red. Restore | paste red then green |
| S1-T9 | G-FE over touched files; commit | gate bodies pasted |

## S2 — Ledger feed writer (migration 0744) — **ships alone**

Executor: Director-dispatched Orca worker, money (writes a shared money table with the service role).

| Task | Do | Verify |
|---|---|---|
| S2-T1 | **Inventory** (read-only, no code): `rg "external_tier *= *'erpnext'" supabase/migrations/*.sql -l` (43 files) and, for each that is *current* at head (`pg_policies` / `pg_proc` at head, not the migration text), list whether an Odoo org passes through it. Record in the PR body: which of `org_reads_erp_ledger`, `erp_journal_cost_lines`, `get_financial_statement*`, `request_financial_statement_refresh` need Odoo handling (S5, S6) and which are ERPNext-only by design | table in the PR body; no code |
| S2-T2 | pgTAP red: `supabase/tests/odoo_ledger_feed.test.sql` AC-ODA-004: apply a page twice (idempotent), older `write_date` does not overwrite, cursor never rewinds, a failing row aborts page **and** cursor, foreign `p_org_id` rows never touch another org, `authenticated` cannot execute (0137). Namespaced UUIDs, `begin/rollback`, `finish()` | file runs red (function missing), no `Parse errors` |
| S2-T3 | `0744_odoo_ledger_feed.sql`: `apply_odoo_ledger_page(p_org_id uuid, p_rows jsonb, p_cursor text)` (service_role only, `security definer`, `set search_path = public, pg_catalog`): upsert attribution rows into `erp_gl_entry_mirror` by `(org_id, erp_name)` guarded by `erp_modified`, set `external_sync_watermarks` (`domain 'ledger:odoo'`, tier `odoo`) in the same transaction, never rewind. Reuse the apply shape of `apply_odoo_revenue_page` (read its current body at head before writing) | pgTAP green |
| S2-T4 | Same file, AC-ODA-005: reset-to-draft then repost with a new distribution deletes the line's old sibling rows (`erp_name like 'odoo:<line>:%'` not in the new set) in the same call; draft stage counts nothing. Code in `apply_odoo_ledger_page` | pgTAP green |
| S2-T5 | `supabase/tests/odoo_ledger_census.test.sql` AC-ODA-006: `mark_odoo_ledger_census_seen`, `finish_odoo_ledger_census` delete rows of unseen lines only on a finished census; an unfinished census deletes nothing; scoped by org. Code in 0744 | pgTAP green |
| S2-T6 | Index: `erp_gl_entry_mirror (org_id, voucher_type, posting_date, account)` for S5; indexes only, no column changes (columns widened by 0295; `remarks`/`company` per head, check before assuming) | `\d` via pgTAP `has_index` |
| S2-T7 | `rollback/0744_odoo_ledger_feed_down.sql`; denominator manifest entries for the new functions; **mutation check**: make the cursor update unconditional (rewind) and make census delete on unfinished runs; both pgTAP files red; restore | G-DB in one hold with mutation steps inside it |
| S2-T8 | Grants: service_role execute only; no new table so 0137 is a function-grant check; confirm 0178 allow-list unchanged (functions are service-only) | `supabase test db` of `0178*` and `0137*` files in the same hold |

## S3 — Sweep wiring and actuals refresh — **ships alone**

Executor: Director-dispatched. Pattern: `_shared/odooSweep.ts:158` (domains readable + employed) and `:250` (pass call).

| Task | Do | Verify |
|---|---|---|
| S3-T1 | `_shared/odooLedgerFeed.ts`: `ledgerFeedEmployed(sc, orgId)` (activated Odoo binding, capability snapshot `account.move.line` readable, `actuals.read` supported), `runLedgerPass(sc, orgId, call, companyId, budget, opts)` modelled on `runRevenuePass`; rows pass through S1 `fanOutLine`; project accounts from `external_project_bindings` (tier `odoo`) read once per pass; fiscal year from the company's FY setting via S1-T3 | `_shared/odooLedgerFeed.test.ts` (Deno) red→green, fake PostgREST + `fakeOdoo` |
| S3-T2 | Deno test for budget: a 5,000-line backlog stops at the tick's call/time budget, leaves the cursor consistent, and other kinds still run (NFR-ODA-003). Wire into `odooSweep.ts` after the revenue passes, behind `ledgerFeedEmployed` | `_shared/odooSweep.test.ts` additions (existing file) |
| S3-T3 | Tier-neutral actuals refresh: call the shipped `refreshActuals` after the ledger pass with `projectMap` = `{pmoProjectId: analyticId}` from `external_project_bindings`; no copy of the summing code. Test: two linked projects, one ambiguous, one unlinked → shared-suite outcomes (FR-ODA-053) | Deno test in `_shared/odooLedgerFeed.test.ts` |
| S3-T4 | `odooSweep.ts` result type gains `ledger?: { rows, caughtUp, skipped }`; no ledger data in logs (counts only) | typecheck + existing `odooSweep.test.ts` |
| S3-T5 | Edge-fn binding: `odoo-sweep` test imports the shipped handler from `./index.ts` and mocks `globalThis.fetch` (`supabase/functions/odoo-sweep/sweep.test.ts` style); add a case that a tick with the ledger feed on writes rows and publishes one snapshot | `deno test` in `supabase/functions/odoo-sweep`; `node scripts/check-edge-fn-test-binding.mjs` |
| S3-T6 | Mutation: remove the `project_id` mapping (everything unattributed) → project actuals test red; restore. G-DENO, G-FE | output bodies |

## S4 — Reconciliation, health, line list (migration 0745)

Executor: Director-dispatched, money read. Independent of S5.

| Task | Do | Verify |
|---|---|---|
| S4-T1 | pgTAP red `supabase/tests/odoo_project_actuals.test.sql` AC-ODA-007 (mapped sums per category, unmapped amount separate and in no category, through `project_mapped_actuals` and `get_project_finances` on Odoo-fed rows) and `supabase/tests/odoo_ledger_health.test.sql` AC-ODA-008/009/010: record-check RPC stores matches/differs/not-checked and keeps the last good result when a later check is "not checked"; `get_odoo_ledger_health(p_project_id uuid default null)` returns as-of, caught-up, state (fresh/stale/catching-up/unavailable at 30 min), last census, check result, and unmapped / unattributed / unlinked counts and amounts for the org or the project | red |
| S4-T2 | `0764_odoo_ledger_health.sql`: table `odoo_ledger_checks` (org_id default + `stamp_org_id` trigger, RLS Admin/Finance/Executive select, service-role insert), `record_odoo_ledger_check(p_org_id, p_cutoff, p_accounts jsonb, p_status text, p_reason text)` service-only, `get_odoo_ledger_health` invoker, active member + role check inside, `can`-matching roles (FR-ODA-061/062) | green |
| S4-T3 | Line list for a category (FR-ODA-051): `get_odoo_ledger_lines(p_project_id, p_category, p_after text, p_limit int)` keyset on `id`, `p_limit` clamped to 200 (below `max_rows`), Project Manager/Engineer refused detail, totals-only for them via health; pgTAP AC-ODA-015 slice (roles, inactive, anon, foreign org → not found) in `supabase/tests/odoo_ledger_privacy.test.sql` | green |
| S4-T4 | Sweep: after a caught-up tick and ≥1 h since the last check, run the grouped read (S0's verified form) at cut-off = cursor − overlap, `compareTotals`, call `record_odoo_ledger_check`. A failure records "not checked" and never fails the tick. Deno test in `_shared/odooLedgerFeed.test.ts` | green |
| S4-T5 | `rollback/0745_…_down.sql`; denominator entries (table + 3 functions); 0137 grants on the new table for service_role; 0136 inventory if the table mirrors an external object (it does not: it is PMO-written check output, record that in the migration header). **Mutation:** report "matches" when the check errored → AC-ODA-008 red | G-DB, G-DENO |

## S5 — Statements reads (migration 0746)

Executor: Director-dispatched, money read. Same payload shape as `get_financial_statement` (read its current return shape at head: `0319:1130` and later replacements) so `FinancialStatements.tsx` and `ProjectProfitLossSection.tsx` change minimally.

| Task | Do | Verify |
|---|---|---|
| S5-T1 | pgTAP red `supabase/tests/odoo_statements.test.sql` AC-ODA-011: two-year mirror, month Trial Balance: opening, period debit/credit, closing per account; totals debit = credit; excludes `is_cancelled` | red |
| S5-T2 | `0746_odoo_statements.sql`: `get_odoo_statement(p_kind text, p_period jsonb, p_project_id uuid default null)` SQL, `stable`, invoker, one statement over the S2-T6 index; accounts classified by Odoo `account_type` from `external_master_records` kind `account` (join on code); TB first | green for T1 |
| S5-T3 | AC-ODA-012/013/014: P&L (income/expense by `account_type`, net), Balance Sheet (cumulative to period end, derived current-year earnings within the fiscal year, `balanced` boolean and `difference`), project P&L (only rows of the project's linked account; no remainder). Each returns provenance: ledger as-of, caught-up, last check status, unmapped/unattributed amounts for the scope | green |
| S5-T4 | AC-ODA-015 statements half: Admin/Finance/Executive read company and detail; PM/Engineer project totals for visible projects only; inactive/anon/foreign refused; no client org/company/scope override. Extend `odoo_ledger_privacy.test.sql` | green |
| S5-T5 | Catalogue: `get_odoo_statement_catalogue(p_project_id)` returns month/quarter/FY choices from the earliest and latest posting dates and the company FY end (no custom dates, OQ001 of #897) | green |
| S5-T6 | Perf (NFR-ODA-004, AC-ODA-023): `scripts/odoo-ledger-perf.mjs` seeds 130,000 mirror rows into the local DB under the lock, times TB/P&L/BS and `refreshActuals`; record numbers in the PR body. If TB > 1 s, add a covering index (still in 0746) and re-measure | numbers pasted |
| S5-T7 | `rollback/0746_…_down.sql`; denominator; **mutation:** sum debit only in TB closing → T1 red | G-DB, G-SCRIPTS |

## S6 — Basis switch and tier-aware journal list (migration 0747) — **ships alone**

Executor: Director-dispatched, money + auth. This changes every money screen of the switched org (count-once: actuals from the ledger only). Read `docs/specs/erp-journal-costs-on-project.spec.md` §4 and `0307_erp_ledger_basis.sql` at head first.

| Task | Do | Verify |
|---|---|---|
| S6-T1 | pgTAP red `supabase/tests/odoo_ledger_basis.test.sql` AC-ODA-016: `switch_odoo_ledger_basis(p_confirm_difference boolean default false)` refuses non-Admin, refuses when not caught up, refuses on a "differs"/"not checked" latest check unless `p_confirm_difference` (Admin only, audited), succeeds when matching; writes `config.ledger_basis_at` and an audit event; second call is a no-op; a foreign org is not found | red |
| S6-T2 | `0765_odoo_ledger_basis.sql`: the RPC (`security definer`, role check from the real JWT role inside) and `create or replace org_reads_erp_ledger()` = active ERPNext binding **or** active Odoo binding with `config.ledger_basis_at` set. Body re-read at head before replacing; all other callers unchanged | green |
| S6-T3 | Count-once regression: with the switch on, an Odoo org's project `actuals` come only from the snapshot and `committed` uses `procurement_ledger_held` as for ERPNext (AC-JEC-004 semantics); with it off, nothing changes. Extend an existing count-once pgTAP file (grep `procurement_ledger_held` in `supabase/tests`) with an Odoo-bound org | green |
| S6-T4 | AC-ODA-020: `erp_journal_cost_lines` project map from `external_project_bindings` for tier `odoo` (instead of the ERPNext config map) and `voucher_type in ('Journal Entry','account.move')`; `erp_url` branch for Odoo (`<site>/odoo/action-account.action_move_journal_line/<id>` shape verified in S0; plain text when unknown); PMO-posted bills/invoices excluded via their mirror link, not listed as strays. Extend `supabase/tests/erp_journal_cost_lines*.test.sql` | green |
| S6-T5 | Inventory follow-through (S2-T1 table): every `'erpnext'`-hard-wired function that an Odoo org reaches and that S5 does not replace is either widened here or recorded as ERPNext-only with a test that an Odoo org gets "not in use", never a wrong number | list in PR body; pgTAP |
| S6-T6 | `rollback/0747_…_down.sql` restores the prior `org_reads_erp_ledger()` body; denominator; **mutation:** let `org_reads_erp_ledger` return true for any Odoo binding → AC-ODA-016 red | G-DB |

## S7 — Screens (UI lane)

Executor: Orca worker with the `ui-implementer` contract; skills `impeccable`, `taste`, `ui-ux-pro-max`; strictly `DESIGN.md` tokens; shared primitives (`Card`, `DataTable`, `ListState`, `StatusPill`). UI lane gates: machine gates + `scripts/ux-proof.sh` on touched routes + one rendered Director review + one fix round; steps 6–7 of the QA loop do not apply. 30-second owner sketch-glance of the layout first (project actuals strip + statements).

| Task | Do | Verify |
|---|---|---|
| S7-T1 | DAL `src/lib/db/odooLedger.ts` (+ test): `getOdooLedgerHealth`, `getOdooLedgerLines`, `getOdooStatement*`, `switchOdooLedgerBasis` through the repository seam (`src/lib/repositories/`), never `org_id` from the client, errors via `classifyMutationError`; permission-scoped cache keys (AC-009 of #897) | `npx vitest run src/lib/db/odooLedger.test.ts` |
| S7-T2 | `LedgerProvenance` component (+ test): as-of time, freshness pill, reconciliation pill, unmapped/unattributed line. States: fresh, stale, catching up, unavailable, matches, differs (names accounts), not checked | RTL file |
| S7-T3 | `pages/project-detail/budget/BudgetOdooActuals.tsx` (+ `ProjectBudgetOdooActuals.test.tsx`, AC-ODA-017): wired into `pages/ProjectBudget.tsx` when the org is on ledger basis and the tier is Odoo; category actual drill-down list (FR-ODA-051, "Showing x of y", All view); no linked account → message + link, never zero (FR-ODA-052) | RTL file + `ProjectBudget` sibling tests |
| S7-T4 | `src/components/financial-statements/OdooStatementsSection.tsx` (+ test, AC-ODA-018): TB / P&L / BS / project P&L reusing the existing period picker and renderer; "does not balance" and "partial" states; account labels `code name`; `FinancialStatements.tsx` and `ProjectProfitLossSection.tsx` choose the section by tier; ERPNext path untouched | RTL files incl. `FinancialStatements.scope.test.tsx` |
| S7-T5 | Admin/Finance health card + switch (confirm dialog via `ConfirmDialog`; the "explained difference" option Admin-only) in the Odoo integration settings area next to the cost-account setup (find the O1 S7 screen at build); copy in plain words, **both locales** (`public/locales/en` and `id`) | RTL + i18n key parity test |
| S7-T6 | `can()` affordances match RLS (`src/auth/policy.ts`); real JWT role, impersonation view-only | `src/auth/usePermission.test.tsx` additions |
| S7-T7 | G-FE; G-UI: `scripts/ux-proof.sh /projects/<seed id>/budget` and `/finance/statements`; rich seed includes an Odoo-bound org with lines (add to the rich-seed generator, not `seed.sql` raw); screenshots to the Director | ux-proof clean |

## S8 — Acceptance

Executor: Orca worker, qa-acceptance role. Bed-gated tests gate on the dependency (bed context file), **never `process.env.CI`** (`check-e2e-isolation.sh`); skips allowlisted with a `restore` path in `scripts/check-e2e-skips.mjs`.

| Task | Do | Verify |
|---|---|---|
| S8-T1 | `supabase/functions/_shared/odooLedgerFeed.bed.test.ts` AC-ODA-021 (pattern: `odooRevenueFeed.bed.test.ts`): post a bill and an invoice with project analytics on the bed, one split, one unattributed; run the ledger pass and the check; assert per-account sums equal Odoo's grouped totals to the cent and project actuals equal | `scripts/with-odoo-lock.sh` + `scripts/with-db-lock.sh deno test --allow-all <file> -- <private bed-context.json>` |
| S8-T2 | `pmo-portal/e2e/AC-ODA-022-odoo-actuals-statements.spec.ts` (header `@e2e-isolation` per `docs/e2e-parallel-conventions.md`, read it first): Admin switches basis, Finance opens project budget-versus-actual then the Trial Balance; same project total, "matches Odoo", as-of shown; user journey, goal-oracle intact | `scripts/e2e-local.sh AC-ODA-022` |
| S8-T3 | Runbook `docs/runbooks/odoo-client-ledger.md`: service-user group set (V-ODA10), first-read duration for the client's history, how to read "differs", the switch, what stale means; invented names only | doc review |
| S8-T4 | Update traceability below to the real test names; backlog/roadmap: update issue **#1571** roadmap in the same session (Director), close #1507 acceptance with the AC list; file follow-ups for anything deferred (multi-currency, non-project plans, `budget.*` if Odoo gains a budget object) | `gh issue` actions by Director |
| S8-T5 | Final gates: `npm run check:guards`, typecheck, eslint on touched files, touched vitest, `deno test` touched fns, touched pgTAP in one lock hold, denominator live + `--self-test` | bodies pasted in the report |

## Migration ledger (0744–0759)

| No. | File | Slice |
|---|---|---|
| 0744 | `0744_odoo_ledger_feed.sql` + rollback | S2 |
| 0745 | `0764_odoo_ledger_health.sql` + rollback | S4 |
| 0746 | `0746_odoo_statements.sql` + rollback | S5 |
| 0747 | `0765_odoo_ledger_basis.sql` + rollback | S6 |
| 0748–0749 | reserved for a gap found by S2-T1/S6-T5 (`create or replace` only; denominator + rollback each) | any |

If S4 and S5 run in parallel, they hold 0745 and 0746 fixed as above; a collision uses `scripts/renumber-migration.sh <old> <new>`.

## Traceability — AC → one owning test

| AC | Owning test | Layer |
|---|---|---|
| AC-ODA-001, 002 | `odoo/ledger/ledgerLineRows.test.ts` | U |
| AC-ODA-003 | `contractSuite/actuals.suite.ts` run by `odoo/contract.test.ts` | U |
| AC-ODA-004 | `supabase/tests/odoo_ledger_feed.test.sql` | P |
| AC-ODA-005 | `odoo_ledger_feed.test.sql` (reset-and-repost case) | P |
| AC-ODA-006 | `supabase/tests/odoo_ledger_census.test.sql` | P |
| AC-ODA-007 | `supabase/tests/odoo_project_actuals.test.sql`  | P |
| AC-ODA-008 | `odoo/ledger/ledgerReconcile.test.ts` (compare) ; recording in `odoo_ledger_health.test.sql` | U + P |
| AC-ODA-009, 010 | `supabase/tests/odoo_ledger_health.test.sql` | P |
| AC-ODA-011..014 | `supabase/tests/odoo_statements.test.sql` | P |
| AC-ODA-015 | `supabase/tests/odoo_ledger_privacy.test.sql` | P |
| AC-ODA-016 | `supabase/tests/odoo_ledger_basis.test.sql` | P |
| AC-ODA-017 | `pages/project-detail/__tests__/ProjectBudgetOdooActuals.test.tsx` | U |
| AC-ODA-018 | `src/components/financial-statements/OdooStatementsSection.test.tsx` | U |
| AC-ODA-019 | `contractSuite/parity.test.ts` + `odoo/contract.test.ts` | U |
| AC-ODA-020 | `supabase/tests/erp_journal_cost_lines*.test.sql` (Odoo case added) | P |
| AC-ODA-021 | `_shared/odooLedgerFeed.bed.test.ts` | B |
| AC-ODA-022 | `e2e/AC-ODA-022-odoo-actuals-statements.spec.ts` | E |
| AC-ODA-023 | `scripts/odoo-ledger-perf.mjs` (recorded in PR; not a CI gate) | script |

## Risks and stops

- **A usable statement-report model on Community (V-ODA9)** or **no grouped read (V-ODA5):** stop and re-plan S4/S5 with the Director before building.
- **First read of a large history** exceeding the tick budget for days: the spec shows "partial"; OQ-ODA-4's start-date cap is the lever.
- **Basis flip** is the dangerous step (S6); it ships alone, behind the Admin switch, with the S6-T3 count-once regression and a mutation check.
- **Never** push to `main`/`production`; dev is the ceiling; no PR from workers; the Director merges.
