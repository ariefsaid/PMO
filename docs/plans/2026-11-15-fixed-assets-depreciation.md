# Fixed assets and depreciation: implementation plan (#899, accountant's desk piece 3)

## Owner questions (one line each; the default is what this plan builds)

1. **OQ-1 Method (spec Q7).** Default: straight-line, whole rupiah, whole months, first charge in the in-service month.
2. **OQ-2 Catch-up.** Default: a run for month M also charges every earlier uncharged month of an asset, one line per month, dated M.
3. **OQ-3 Disposal kind.** Default: the disposal journal uses kind `correction` and is linked by `fixed_assets.disposal_journal_id` (no new enum value, so the down migration stays clean).
4. **OQ-4 Hand-made depreciation journals.** Default: `save_journal_draft` (piece 1) refuses kind `depreciation`, so only the run makes one.
5. **OQ-5 ERPNext (V-ACD8).** Default: new workflow `asset.depreciate` is `supported` on Odoo and `pending` on ERPNext until the bed probe.
6. **OQ-6 Projects while #2196 is open.** Default: a depreciation line names a project only when the asset names it (FR-ACD-044), never otherwise.
7. **OQ-7 AC-ACD-008 layer.** Default: owned by pgTAP, not Vitest, because the schedule is computed only in SQL (one implementation, server-side money).
8. **OQ-8 Closed months.** Default: the run's closed-month refusal ships with piece 6, the same way piece 1 left it (manual-journals OQ-2).

> **For agentic workers:** money tier (ADR-0019). Director-dispatched per issue through an Orca worker
> (`docs/orca-dispatch.md`). It ships alone and is never batched. Do not start until the owner has signed off the spec,
> answered the questions above, and **piece 1 (manual journals, #895) is merged to `dev`**. Use strict TDD: every task
> writes its named failing test first, runs it and sees the expected failure, then writes the minimum code, then reruns
> the test green.

**Spec:** `docs/specs/accountants-desk.spec.md` §5, §6.3, §7, §8, §10 (AC-ACD-008, -009, -020) at `bed21ab76`
(`origin/docs/accountants-desk-design-fwzy4j`). **Read that commit, not the `dev` path:** the copy of
`docs/specs/accountants-desk.spec.md` on `dev` today is the piece-1 manual-journals text (§5–§8, `MJE` ids);
the full desk spec with the `FR-ACD`/`AC-ACD` ids lives only on that branch. **Format and dependency reference:** `docs/plans/2026-11-15-manual-journals.md`
(`origin/docs/895-manual-journals-plan`). **Money map:** `docs/money-path-primer.md`.

**Goal:** a Finance member registers a fixed asset from a posted ledger line on an asset account. PMO keeps its
straight-line schedule. Once a month the accountant runs depreciation, which makes **one** draft journal of kind
`depreciation` for every asset due. The journal then goes through piece 1 unchanged: a different person approves it,
the outbox posts it once, and the ledger's copy is read back. Running the same month again is refused until that
journal is refused or reversed. Disposing of an asset is an approved journal, and the schedule stops at the disposal month.

## Dependencies

| On | What this piece uses | Without it |
|---|---|---|
| **Piece 1, manual journals (#895), required** | `journal_entries`, `journal_entry_lines`, `journal_entry_authors`, `journal_status`, `journal_kind` (it already has `depreciation`); `may_approve_journal`; `approve_journal`/`return_journal`; `record_journal_outcome` (its status change drives this piece's trigger); `journalGuard.ts`; the `journal.post` workflow; the Journals screen, which is where a run's journal is approved | nothing posts. This piece adds **no** ledger operation, outbox kind, adapter or sweep |
| Piece 2, issued stock (#2282) | nothing | — |
| Piece 6, period lock and checklist | not required. Piece 6 later **reads** `depreciation_month_status` (Task 14) for the checklist item "depreciation run" (FR-ACD-071) and adds the closed-month refusal to `run_depreciation` (OQ-8) | the run can be dated in a month PMO later closes; the read-back still catches re-dating (FR-ACD-027) |
| #2196 (capitalised spending) | project amortisation stays parked | FR-ACD-044 rule only (Task 12) |

## Architecture and contracts

**Reuse, do not rebuild.** Depreciation is a `postJournal` (spec §4.1: "registering an asset, posting depreciation …
are not ledger operations"). The register and schedule are PMO state on every tier (FR-ACD-040). The only place this
piece touches the ledger path is one extra refusal in piece 1's `journalGuard.ts`: a `depreciation` journal is refused
unless `asset.depreciate` is `supported` for the org's tier (FR-ACD-002, -003, OQ-5).

| Piece | Where | Shape |
|---|---|---|
| Desk state | `supabase/migrations/NNNN_fixed_assets.sql` (+ `rollback/NNNN_fixed_assets_down.sql`) | `fixed_assets`, `asset_depreciation_lines`, `asset_depreciation_runs`; definer RPCs; RLS select-only |
| Schedule | SQL `public.asset_schedule(...)`, the only implementation | whole-rupiah straight line, last month absorbs the remainder |
| Journal link | trigger `journal_entries_asset_sync` on `journal_entries` status | releases a run, or completes or undoes a disposal |
| Workflow id | `connect/workflows.ts` `asset.depreciate` | Odoo `supported` (Community has no depreciation, so there is nothing to collide with); ERPNext `pending` (V-ACD8) |
| Gate | `supabase/functions/adapter-dispatch/journalGuard.ts` (piece 1's file) | refuses `kind = depreciation` when `asset.depreciate` is not `supported` |
| Screen | `pmo-portal/pages/Assets.tsx` + `src/lib/repositories/assets.ts` | register, schedule, run, dispose; the run's journal opens on `/journals` |

**Rules held in the database (ADR-0019):**

- **One schedule, one place.** `asset_schedule` computes the lines once, at registration, into `asset_depreciation_lines`.
  The client never computes or sends an amount for a charge. The run sums stored lines in SQL (NFR-ACD-001; money
  primer bucket 5: no client sums of a capped read).
- **One run per month.** A partial unique index on `asset_depreciation_runs (org_id, period_month) where released_at
  is null` enforces it. A run is released only by the trigger: when its journal becomes `refused`, when a journal that
  reverses it becomes `posted`, or when its draft is discarded.
- **Cost and life are immutable after the first charge.** A line is charged when its run's journal is `posted`.
  `update_fixed_asset` refuses any change to cost, residual, life, in-service date or accounts once any line has a
  `run_id`, posted or not. The correction is disposal plus a new registration (§7).
- **Registration never exceeds its source.** The total cost of the assets registered from one mirrored ledger line is
  at most that line's debit. The check runs under `select … for update` on the mirror row, so two concurrent
  registrations cannot both pass.
- **Separation of duties** is piece 1's: the person who runs depreciation is the journal's maker (author row), and
  `may_approve_journal` refuses them.

**The schedule (FR-ACD-041, AC-ACD-008).**

```sql
create or replace function public.asset_schedule(
  p_cost numeric, p_residual numeric, p_life_months int, p_in_service date)
returns table (seq int, period_month date, amount numeric)
language sql immutable strict set search_path = pg_catalog, public as $$
  with base as (
    select (p_cost - p_residual) as depreciable,
           floor((p_cost - p_residual) / p_life_months) as monthly,
           date_trunc('month', p_in_service)::date as first_month)
  select s.seq,
         (b.first_month + make_interval(months => s.seq - 1))::date,
         case when s.seq < p_life_months then b.monthly
              else b.depreciable - b.monthly * (p_life_months - 1) end
    from base b, generate_series(1, p_life_months) as s(seq)
$$;
-- 10,000,000 / 0 / 36: seq 1..35 = 277,777; seq 36 = 10,000,000 - 277,777*35 = 277,805; sum = 10,000,000.
```

**The run (FR-ACD-042).** `run_depreciation(p_month date)` does all of the following in one transaction:

1. It checks the caller is Finance+ in the org (or raises 42501).
2. It inserts the run row, so a concurrent second run raises 23505, which is turned into P0001 "depreciation for
   <Month YYYY> is already in journal <id>".
3. It picks every line with `period_month <= p_month` (OQ-2), `run_id is null`, and asset status `in_service`.
4. It inserts one `journal_entries` row: kind `depreciation`, `entry_date` = the last day of `p_month`, memo
   "Depreciation <Month YYYY>", `maker_id = auth.uid()`, plus the author row.
5. It inserts one line pair per `(expense_account, accumulated_account, project_id)`: Dr expense, Cr accumulated, each
   summed in `numeric`.
6. It stamps `run_id` on the picked lines.

It refuses an empty selection with P0001 "nothing to depreciate in <Month YYYY>". For 300 assets this still makes one
journal (NFR-ACD-002).

**Tradeoffs.**

- Computing the schedule only in SQL moves AC-ACD-008 from U to P (OQ-7), but no second implementation can drift.
- Releasing a run only through the trigger means a returned depreciation journal stays bound to its run until it is
  discarded. That is correct, because its lines are still claimed.
- Holding the register on ERPNext too keeps one design. Charging there waits on V-ACD8, so that ERPNext's own Asset
  schedule cannot double the charge.

## Migration

`supabase/migrations/NNNN_fixed_assets.sql`, number assigned by the coordinator (above piece 1's), and
`supabase/migrations/rollback/NNNN_fixed_assets_down.sql`. The down migration drops the trigger, its function, the RPCs,
`asset_schedule`, the three tables and the `fixed_asset_status` type, in that order, and nothing else. It does not
touch piece 1's tables or enums.

```sql
create type public.fixed_asset_status as enum ('in_service','disposing','disposed');
create table public.fixed_assets (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null default public.auth_org_id() references public.organizations(id) on delete cascade,
  name                  text not null check (length(btrim(name)) between 1 and 200),
  source_gl_entry_id    uuid not null references public.erp_gl_entry_mirror(id),
  cost_account          text not null,          -- the source line's account
  expense_account       text not null,
  accumulated_account   text not null,
  cost                  numeric(18,2) not null check (cost > 0),
  residual              numeric(18,2) not null default 0 check (residual >= 0 and residual < cost),
  life_months           int  not null check (life_months between 1 and 600),
  in_service_date       date not null,
  project_id            uuid references public.projects(id),
  status                public.fixed_asset_status not null default 'in_service',
  disposal_date         date,
  disposal_journal_id   uuid references public.journal_entries(id),
  registered_by         uuid not null references public.profiles(id),
  created_at            timestamptz not null default now(),
  check ((status = 'in_service') = (disposal_journal_id is null))
);
create index fixed_assets_org_status on public.fixed_assets (org_id, status);
create index fixed_assets_source on public.fixed_assets (source_gl_entry_id);
create table public.asset_depreciation_runs (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null default public.auth_org_id() references public.organizations(id) on delete cascade,
  period_month  date not null check (period_month = date_trunc('month', period_month)::date),
  journal_id    uuid references public.journal_entries(id) on delete set null,  -- set in the same transaction
  run_by        uuid not null references public.profiles(id),
  released_at   timestamptz,
  released_why  text check (released_why in ('refused','reversed','discarded')),
  created_at    timestamptz not null default now(),
  check ((released_at is null) = (released_why is null))
);
create unique index asset_depreciation_runs_one_live on public.asset_depreciation_runs (org_id, period_month)
  where released_at is null;
create table public.asset_depreciation_lines (
  asset_id      uuid not null references public.fixed_assets(id) on delete cascade,
  org_id        uuid not null default public.auth_org_id() references public.organizations(id) on delete cascade,
  seq           int  not null,
  period_month  date not null,
  amount        numeric(18,2) not null check (amount >= 0),
  run_id        uuid references public.asset_depreciation_runs(id),
  cancelled_at  timestamptz,                      -- set when a disposal posts (FR-ACD-043)
  primary key (asset_id, seq)
);
create index asset_depreciation_lines_due on public.asset_depreciation_lines (org_id, period_month)
  where run_id is null and cancelled_at is null;
-- RLS: enable + force on all three; one SELECT policy each:
--   org_id = auth_org_id() and is_active_member() and auth_role()::text in ('Admin','Executive','Finance')
-- Grants: revoke insert, update, delete from anon, authenticated; grant select to authenticated.
```

Definer RPCs. Each is `security definer set search_path = pg_catalog, public`, with `revoke all … from public, anon`
and `grant execute … to authenticated`. Each starts with the org, active-member and Finance+ check, raising `42501`:

| RPC | Does | Refuses |
|---|---|---|
| `register_fixed_asset(p_source_gl_entry_id uuid, p_name text, p_cost numeric, p_residual numeric, p_life_months int, p_in_service date, p_expense_account text, p_accumulated_account text, p_project_id uuid) returns uuid` | locks the mirror row; inserts the asset and its `asset_schedule` lines | a source in another org (42501); a source that is not a debit, or is cancelled (P0001); a source account whose `external_master_records` row (kind `account`) is not a fixed-asset type, which is `attrs->>'account_type' = 'asset_fixed'` on Odoo or `'Fixed Asset'` on ERPNext (P0001 "<code> is not a fixed-asset account"); Σcost from that source > its debit (P0001 "only <rest> of this line is left to register"); an expense or accumulated account that is inactive or tombstoned (P0001) |
| `update_fixed_asset(p_id uuid, p_name text, p_cost numeric, p_residual numeric, p_life_months int, p_in_service date, p_expense_account text, p_accumulated_account text, p_project_id uuid)` | name is always editable; the other fields are editable, with the lines regenerated, only while no line has a `run_id` | any money field changed after a run (P0001 "<name> has been depreciated: dispose of it and register it again"); status not `in_service` (P0001) |
| `run_depreciation(p_month date) returns uuid` | the run above; returns the journal id | see above |
| `discard_depreciation_run(p_run_id uuid)` | deletes the run's journal while it is `draft` (lines and authors cascade); the trigger releases the run with `discarded` | journal not `draft` (P0001 "only a draft run can be discarded") |
| `request_asset_disposal(p_id uuid, p_date date, p_proceeds numeric, p_proceeds_account text, p_gain_loss_account text) returns uuid` | creates a draft kind `correction` journal (OQ-3): Cr `cost_account` cost; Dr `accumulated_account` Σ charged lines; Dr `p_proceeds_account` proceeds when > 0; one gain (Cr) or loss (Dr) line on `p_gain_loss_account` balances it; asset → `disposing`, `disposal_journal_id`, `disposal_date` | a line with `run_id` whose journal is not `posted` (P0001 "wait for <Month YYYY> depreciation to post"); status not `in_service` (P0001); proceeds < 0 (22023) |
| `list_fixed_assets(p_status fixed_asset_status, p_limit int, p_after uuid) returns setof jsonb` | page ≤ 200 with cost, charged-to-date and net book value, all summed in SQL | `p_limit > 200` (22023) |
| `depreciation_month_status(p_month date) returns jsonb` | `{due: n, run_id, journal_status}` for piece 6's checklist | — |

The trigger `journal_entries_asset_sync` (after update of `status` on `journal_entries`, definer):

- a run's journal becomes `refused`: set `released_at` and `released_why = 'refused'`, and clear `run_id` on its lines;
- a journal whose `reverses_journal_id` is a run's journal becomes `posted`: release with `reversed`, and clear `run_id`;
- a disposal journal becomes `posted`: asset → `disposed`, and every line with `period_month > disposal month` and
  `run_id is null` gets `cancelled_at`;
- a disposal journal becomes `refused`: asset → `in_service`, and `disposal_journal_id` and `disposal_date` are cleared.

On delete of a run's draft journal (the discard path), a `before delete` trigger releases the run with `discarded`.

## Commands and test discipline

- From `pmo-portal/`: `npx vitest run <file>`. From the repo root: `deno test --allow-env --allow-net --allow-read <file>`.
- pgTAP: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/fixed_assets.test.sql'`.
  Reset and test run in ONE lock hold, only in the Director's scheduled DB slot (this routine starts no database).
  Read the TAP body for `not ok` and parse errors; never trust `$?` through a pipe.
- Mutation checks on every money rule: break it, watch the owning test go red, then restore it. Record each in the PR.

## Tasks

### A. Schedule and tables

**Task 1: the tables are read-only to clients (AC-ACD-020, asset tables).**
- Create `supabase/tests/fixed_assets.test.sql` with `begin; select plan(n); … select * from finish(); rollback;`.
  Build the fixtures as `supabase/tests/0015_procurement_sod.test.sql:35` does, with `set local role authenticated` and
  `set local request.jwt.claims`, plus one Finance member A, one Finance member B, a PM and an Engineer in org 1, a
  Finance member in org 2, and one `erp_gl_entry_mirror` debit of 30,000,000 on an `account` master record with
  `attrs = '{"account_type":"asset_fixed"}'`.
- Cases: as the PM and as the Engineer, `count(*)` on each of the three tables is 0 and each RPC raises 42501. As
  Finance, a direct `insert`, `update` or `delete` on each table raises 42501. The org-2 member sees 0 rows.
- Write the migration skeleton (type, tables, RLS, grants), then run the pgTAP command. It is red before the policies
  and green after.

**Task 2: the schedule (AC-ACD-008, FR-ACD-041).**
- Add the cases to the same file: `select sum(amount), count(*) from asset_schedule(10000000, 0, 36, '2026-11-10')` is
  `10000000`, `36`. Seq 1–35 are each 277,777. Seq 36 is 277,805. Seq 1 is in `2026-11-01` (OQ-1). Cost 1,000,
  residual 100, life 1 gives one line of 900. Cost 100.50, residual 0, life 2 gives 50 and 50.50, and the sum equals
  cost exactly.
- Implement `asset_schedule` as above and rerun.
- Mutation: change the last-month branch to `b.monthly`. The sum case must go red. Restore it.

**Task 3: register (FR-ACD-040).**
- Add the cases: A registers 10,000,000 from the source line, which makes 36 lines; a second registration of
  20,000,000 succeeds; a third of 1 raises P0001 `only 0.00 of this line is left to register`; a source on an
  `expense` account raises `is not a fixed-asset account`; a source in org 2 raises 42501; `residual >= cost` raises
  23514.
- Implement `register_fixed_asset` (the `for update` on the mirror row is the first statement after the role check;
  `org_id` is never taken from the client) and rerun.
- Mutation: remove the Σcost check. The third case must go red. Restore it.

**Task 4: edit after the first charge (§7 immutability).**
- Add the cases: before any run, `update_fixed_asset` changing life from 36 to 24 regenerates 24 lines. After Task 6's
  run claims the asset's November line, changing cost raises P0001 `has been depreciated`, and changing only the name
  succeeds.
- Implement `update_fixed_asset` and rerun.
- Mutation: compare against posted lines only, not `run_id is not null`. The case with the claimed but unposted line
  must go red. Restore it.

### B. The run and its journal

**Task 5: hand-made depreciation journals refused (OQ-4).**
- Add a case to piece 1's `supabase/tests/manual_journals.test.sql`: `save_journal_draft` with kind `depreciation`
  raises P0001 `depreciation journals are made by the depreciation run`.
- Add that refusal as the first check in `save_journal_draft`, in this migration, via `create or replace` of piece 1's
  function body plus the new `if`. The down migration restores piece 1's body verbatim.
- Run both pgTAP files in one hold:
  `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/manual_journals.test.sql supabase/tests/fixed_assets.test.sql'`.

**Task 6: one journal per run (FR-ACD-042, NFR-ACD-002).**
- Add the cases: with two assets on the same expense, accumulated and project triple and a third asset on another
  expense account, A runs `2026-11-01`. That gives one `journal_entries` row of kind `depreciation`, status `draft`,
  `entry_date = '2026-11-30'`, `maker_id = A`, and an author row for A. It has 4 lines, and each Dr equals the sum of its
  group's November lines. Σdebit = Σcredit. Every November line carries the run id. Running a month with nothing due
  raises `nothing to depreciate`.
- Add a 300-asset fixture `do $$ … $$` that yields one journal.
- Implement `run_depreciation` and rerun.

**Task 7: a second run is refused (AC-ACD-009).**
- Add the cases: a second `run_depreciation('2026-11-01')` raises P0001 matching `already in journal`. After piece 1's
  `record_journal_outcome(journal, 'refused', …)` as `service_role`, the run has `released_why = 'refused'` and its
  lines are free, and a new run succeeds. A posted run's journal reversed (piece 1's `request_journal_reversal` →
  approve → `record_journal_outcome(reversal, 'posted', …)`) releases it with `reversed`.
- Implement `journal_entries_asset_sync` (run branches) and rerun.
- Mutation: drop the partial unique index and the pre-check. The second-run case must go red. Restore it.

**Task 8: discard a draft run.**
- Add the cases: `discard_depreciation_run` on a draft run deletes its journal and releases the run with `discarded`.
  Once the journal is `submitted` it raises `only a draft run can be discarded`.
- Implement it and the `before delete` trigger branch, then rerun.

**Task 9: catch-up (OQ-2).**
- Add the case: an asset in service on `2026-09-15`, registered in November, has its September, October and November
  lines in the November run. Each is its own Dr line labelled with its month, so it is not merged into the group pair.
  Note this in the run's line-grouping rule: the group key is `(expense, accumulated, project, period_month)`.
- Adjust Task 6's grouping to match, rerun both cases, and update the Task 6 counts in the same commit.

**Task 10: separation of duties carries over (§7, depreciation row).**
- Add the cases: A (the runner) calling `approve_journal` on the run's journal raises 42501. B approves it, and it
  becomes `approved`. A PM raises 42501.
- No new code: this proves piece 1's `may_approve_journal` covers the run through the author row. If it goes red, fix
  `run_depreciation`'s author insert, not the predicate.

### C. Disposal

**Task 11: dispose (FR-ACD-043).**
- Add the cases: with an asset of cost 10,000,000 that has three posted runs (833,331 charged), disposal on
  `2027-02-10` with proceeds 9,000,000 makes a draft `correction` journal with these lines: Cr cost 10,000,000; Dr
  accumulated 833,331; Dr proceeds 9,000,000; Dr loss 166,669 on the gain or loss account. It balances, and the asset
  becomes `disposing`. While a run with an unposted journal claims a line, the disposal raises `wait for`. When the
  disposal journal is posted, the asset becomes `disposed` and the lines after February get `cancelled_at`. When it is
  refused, the asset goes back to `in_service`. The runner of the disposal cannot approve it (42501).
- Implement `request_asset_disposal` and the disposal trigger branches, then rerun.
- Mutation: remove the `wait for` check. The `wait for` case must go red. Restore it.

**Task 12: projects while #2196 is open (FR-ACD-044, OQ-6).**
- Add the cases: an asset with `project_id` puts the project on its run line. An asset without one gives a line with
  `project_id is null`.
- `run_depreciation` takes the project only from `fixed_assets.project_id`, never from the source line's project (the
  mirror's `project`). Assert this with a source line that carries a project and an asset without one: the run line
  has none.
- Rerun.

### D. Reads, gate and workflow

**Task 13: the list without client sums (NFR-ACD-001).**
- Add the cases: `list_fixed_assets('in_service', 200, null)` returns cost, `charged` (Σ of the lines whose run's
  journal is `posted`) and `net_book_value = cost - charged`. A limit of 201 raises 22023. Paging by `p_after` is
  stable (ordered by `created_at, id`).
- Implement it and rerun.

**Task 14: month status for piece 6.**
- Add the cases: `depreciation_month_status('2026-12-01')` with lines due and no run gives `{"due":n,"run_id":null}`.
  After a run it carries the run id and `journal_status`.
- Implement it and rerun.

**Task 15: every test that names a touched function or message.**
- Run `git grep -lE "save_journal_draft|asset_schedule|register_fixed_asset|update_fixed_asset|run_depreciation|discard_depreciation_run|request_asset_disposal|list_fixed_assets|depreciation_month_status|journal_entries_asset_sync|already in journal|nothing to depreciate|left to register|is not a fixed-asset account|has been depreciated" -- supabase/tests pmo-portal/src pmo-portal/e2e supabase/functions`.
- Run every file it lists at its layer: pgTAP in one locked reset+test hold, vitest and deno by file.

**Task 16: workflow id (FR-ACD-002, -003, OQ-5).**
- In `pmo-portal/src/lib/adapterSeam/connect/workflows.ts` add
  `'asset.depreciate': { version: 1, summary: 'post the month's depreciation run as one approved journal' }`.
- Run `npm run typecheck` from `pmo-portal/`. It is red because both tier tables now miss the key.
- Declare it `supported` with `issue: 899` in `odoo/workflowDeclarations.ts` (reason: Community has no native
  depreciation, #2163). Declare it `pending` in `erpnext/workflowDeclarations.ts` (reason: V-ACD8, a native Asset
  schedule may post its own journals).
- Rerun typecheck green. Then run
  `npx vitest run src/lib/adapterSeam/contractSuite/parity.test.ts src/lib/adapterSeam/connect/workflows.test.ts`.

**Task 17: the dispatch gate refuses an unsupported depreciation (FR-ACD-002).**
- Add cases to piece 1's `supabase/functions/adapter-dispatch/journalGuard.test.ts`, which imports the shipped
  `journalGuard.ts`: a `depreciation` journal for an ERPNext org is refused with the declared reason and no adapter
  call; the same journal on Odoo passes to the adapter; a `fee` journal on ERPNext still passes.
- Add the check to `journalGuard.ts`, reading the declaration from the tier's table (never a payload field).
- Run `deno test --allow-env --allow-net --allow-read supabase/functions/adapter-dispatch/journalGuard.test.ts`.
- Mutation: return `supported` unconditionally. The ERPNext case must go red. Restore it.

### E. Screen

**Task 18: repository and permission.**
- Add `pmo-portal/src/lib/repositories/assets.ts` over the RPCs above, with no client arithmetic on amounts (the
  screen shows the returned strings).
- In `src/auth/policy.ts` add `can('register' | 'run' | 'dispose', 'asset', ctx)`, true for Admin, Executive and
  Finance, and false for PM and Engineer.
- Write the tests `src/lib/repositories/assets.test.ts` (each method calls the right RPC with the right argument names;
  an RPC error is classified through `classifyMutationError`) and the policy cases in `src/auth/policy.test.ts`.
- From `pmo-portal/`, run `npx vitest run src/lib/repositories/assets.test.ts src/auth/policy.test.ts`.

**Task 19: Assets page.**
- Build `pmo-portal/pages/Assets.tsx` on the Companies slice pattern. It has a register list (cost, charged, net book
  value, status), a register form (`EntityFormModal`; the source picker lists mirrored debits on fixed-asset accounts),
  a schedule drawer, a "Run depreciation for <month>" button with `ConfirmDialog` that links to the journal on
  `/journals` afterwards, and a dispose form. Add the route in `App.tsx`, and add the strings in
  `pmo-portal/public/locales/en/` (a new `assets.json`; rebase translation files just before the PR, #1070).
- Write the RTL test `pages/Assets.test.tsx`:
  - the Run button is absent for a PM;
  - after a run, the page shows "In journal <id>: Draft" and a second Run is disabled with "already run";
  - the edit form disables money fields once the asset has a run;
  - a `disposing` asset shows "Disposal waiting for approval".
- Run the test, then `scripts/ux-proof.sh` on `/assets`.

### F. Gates

**Task 20: local final gate and reviews.**
- From `pmo-portal/`, run `npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched files>`,
  every test file touched in Tasks 1–19 by name, and `node scripts/affected-e2e.mjs`.
- Rerun Task 15's grep and its files.
- Put the mutation evidence for Tasks 2, 3, 4, 7, 11 and 17 in the PR.
- Run three reviews: spec, quality, and security (RLS, the definer RPCs, the trigger's service-role path, org scoping
  on the mirror lock, and SoD through the author row).
- Ship alone to `dev`.

## Traceability

| AC / rule | Owning layer | Owning test | Tasks |
|---|---|---|---|
| AC-ACD-008 schedule sums to cost | P (OQ-7; spec says U) | `supabase/tests/fixed_assets.test.sql` (`asset_schedule`) | 2 |
| AC-ACD-009 second run refused | P | `supabase/tests/fixed_assets.test.sql` | 6, 7, 8 |
| AC-ACD-020 (asset tables and RPCs) | P | `supabase/tests/fixed_assets.test.sql` | 1 |
| FR-ACD-040 register from a ledger line | P | `fixed_assets.test.sql` | 3 |
| §7 no money edit after first charge | P | `fixed_assets.test.sql` | 4 |
| FR-ACD-042 one journal per run, SoD | P | `fixed_assets.test.sql` | 5, 6, 9, 10 |
| FR-ACD-043 disposal | P | `fixed_assets.test.sql` | 11 |
| FR-ACD-044 project only from the asset | P | `fixed_assets.test.sql` | 12 |
| FR-ACD-002 / -003 `asset.depreciate` gate | U (deno) | `supabase/functions/adapter-dispatch/journalGuard.test.ts` | 16, 17 |
| NFR-ACD-001 no client sums | P + U | `fixed_assets.test.sql` (`list_fixed_assets`); `pages/Assets.test.tsx` | 13, 18, 19 |

3 of 3 asset ACs (AC-ACD-008, -009, and the asset part of -020) are mapped. There is no e2e journey: the spec gives
this piece no E-layer AC, and posting is piece 1's AC-ACD-026 journey. **Not in this piece:** the checklist item and
the closed-month refusal (piece 6, which reads Task 14), and project amortisation (#2196).
