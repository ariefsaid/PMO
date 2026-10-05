# Plan — Budget account map: several ERP accounts per budget category (#768)

- **Spec:** `docs/specs/budget-account-map-multi.spec.md` (FR-BAM-001…013, NFR-BAM-001…003, AC-BAM-001…011;
  proposed DD-BAM-1…6 at its top).
- **ADR:** none. This relaxes one constraint in the shipped map and adds one flag, inside the existing seam.
- **Tier:** money path (decides which ERP account a pushed budget lands on) → **Director-dispatched**, not the
  ADW. The builder brief must carry `docs/money-path-primer.md`. The Director runs the mutation battery
  (Task 21) before merge.
- **Migration:** `supabase/migrations/0246_budget_account_map_multi.sql`. On a number collision run
  `scripts/renumber-migration.sh 0246 <next>`; never hand-rename.
- **Size:** medium. 1 migration, 1 new pgTAP file, 6 source files, 7 test files, seed, 1 e2e helper, 2 locale
  catalogues, 1 docs note. 22 tasks.

## 0. Conventions for every task

- `WT=/Users/ariefsaid/Coding/PMO/.claude/worktrees/768-budget-account-map`. The Director creates this worktree
  off `origin/dev` on branch `codex/768-budget-account-map`, copies `pmo-portal/.env.local` in, and symlinks
  `pmo-portal/node_modules`. Builders run no git.
- DB work runs reset + test in **one** lock hold:
  `cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db <files>'`.
- Vitest runs under the test lock from `pmo-portal/`:
  `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run <files>`.
- TDD: each RED task writes the test and runs it. It must fail **for the stated reason**. A syntax error or a
  missing fixture is not RED.
- AC id is the leading token of every pgTAP description and every `it(...)` title.

## 1. Design (brainstorm outcome, one decision at a time)

1. **Data shape.** One boolean on the existing table, `is_push_target not null default true`.
   `unique (org_id, category)` becomes a partial unique index `(org_id, category) where is_push_target`, and
   `unique (org_id, erp_account)` stays. *Rejected:* a child table `budget_category_accounts`, because it would
   mean two tables, two RLS policies and a join on every push read for one bit of information. *Rejected:* a
   deferred "exactly one push per category" constraint trigger. "Zero" already fails closed and loud
   (decision 3), so the trigger buys nothing.
2. **Push path.** The single shared reader `readCategoryAccountMap` (used by `dispatchFactory`, the
   `adapter-dispatch` gate and the sweep) adds `.eq('is_push_target', true)`. That changes one line in one place,
   and the gate and the push cannot disagree. `resolveBudgetAccounts` gains a defence: two rows for one category
   means refuse, never last-wins. A regressed filter then fails closed instead of pushing to an arbitrary
   account.
3. **No push account.** It reads as unmapped for the push, so FR-BUD-113's shipped path refuses it, names the
   category, and records the mirror failure. Nothing new is needed on the server.
4. **Actuals.** No change to `get_budget_projection`. Its `actuals` CTE already joins on account and groups by
   category. A pgTAP proves this.
5. **Moving the push flag.** A `SECURITY INVOKER` function `set_budget_push_account(p_map_id)`: lock the
   category's rows, clear the old push row, set the new one, all in one transaction. Invoker means the table's
   Admin-only RLS is the gate, and no new definer surface is added. If zero rows are updated it raises 42501
   (the #541 silent-no-op class). *Rejected:* two client PATCHes, which leave no push account between the two
   calls and stay that way if the second one fails.
6. **Readiness count.** `external-set-company/setup.ts` counts each category with a push account once.
7. **UI.** Same table and columns. The account cell becomes a list: each account, a "Budget push" pill on one,
   and per-account Edit / Use for push / Remove. The actions column holds "Map X" (no accounts) or "Add account
   to X". The push account with siblings shows a hint instead of Remove. Every write is confirmed (owner rule:
   nothing writes on a single click).
8. **Fixtures that used the dropped constraint.** `seed.sql` → `on conflict do nothing`.
   `_budHelpers.ts` → delete-then-insert, restoring prior rows verbatim, plus a read-only Labor sibling. Every
   budget e2e then exercises a multi-account map, and `AC-BUD-030`'s exact `accounts[]` equality proves the
   sibling never reaches ERPNext.

**Error handling.** DB uniqueness → 23505 → `classifyMutationError` (existing). Function refusals: 42501 for
not-authorized, P0002 for not found. Push refusals reuse `budget-category-unmapped` and, for the defensive
duplicate case, `commit-rejected`.

**Scaling / risks surfaced.**
(a) `listBudgetCategoryAccountMap` is a single unpaged read. It is capped by PostgREST `max_rows` (1000), and an
org would need more than 1000 mapped expense accounts to hit it. It is an admin-display read, not a money read.
Named, not fixed.
(b) The push reader returns at most 8 rows (one per category), so it is bounded by the enum.
(c) DD-PB-1 class: a push-account change after a push is not re-pushed. This existed already for account edits,
and the UI now says it.
(d) ERP enforces overspend on the push account only (spec DD-BAM-6).

**Duplicate logic avoided.** One push reader, one resolver, one projection join, all reused. The UI uses
`EntityFormModal`, `ConfirmDialog`, `StatusPill` and `classifyMutationError`.

## 2. File map

| File | Change |
|---|---|
| `supabase/migrations/0246_budget_account_map_multi.sql` | new |
| `supabase/tests/budget_account_map_multi.test.sql` | new: AC-BAM-001/002/004 |
| `supabase/tests/budget_category_account_map_rls.test.sql` | one assertion replaced, one reworded (superseded FR-BUD-111 half) |
| `supabase/seed.sql` | flag column, a read-only Labor sibling, `on conflict do nothing` |
| `pmo-portal/src/lib/supabase/database.types.ts` | regenerated, never hand-edited |
| `pmo-portal/src/lib/budget/categoryAccountMap.ts` (+ `.test.ts`) | duplicate-category refusal: AC-BAM-006 |
| `pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.ts` (+ `dispatchFactory.budget.test.ts`) | push-row filter: AC-BAM-003/005 |
| `supabase/functions/external-set-company/setup.ts` (+ `setup.test.ts`) | distinct push categories: AC-BAM-007 |
| `pmo-portal/src/lib/repositories/budgetProjection.ts` (+ `.test.ts`) | id-keyed CRUD + `setBudgetPushAccount` |
| `pmo-portal/pages/admin/BudgetAccountMap.tsx` (+ `.test.tsx`, `.bahasa.test.tsx`) | multi-account UI: AC-BAM-008…011 |
| `pmo-portal/pages/__tests__/Administration.a11y.test.tsx` | add `setBudgetPushAccount` to the module mock |
| `pmo-portal/public/locales/en/common.json`, `.../id/common.json` | new `admin.budgetMap.*` keys |
| `pmo-portal/e2e/serial/_budHelpers.ts` | delete-then-insert seeding + read-only sibling |
| `docs/specs/erpnext-adapter-p3c-budget.spec.md` | one-line supersession note on FR-BUD-111 |

## 3. Tasks

### Task 0 — Worktree (Director, 2 min)
Create `$WT` as in §0. Verify: `cd "$WT" && ls supabase/migrations | tail -3` lists no `0246_*`.

### Task 1 — RED: pgTAP for the multi-account map (AC-BAM-001/002/004) (5 min)
Create `supabase/tests/budget_account_map_multi.test.sql`:

```sql
-- budget_account_map_multi.test.sql (#768) — OWNS AC-BAM-001, AC-BAM-002, AC-BAM-004.
-- A budget category maps to one or more ERP accounts; an account still backs at most one category; at most
-- one account per category is the PUSH account; the forward view sums every account of a category.
-- Namespaced 0768 UUIDs (valid hex, not seed-colliding). begin/rollback + finish().
begin;
select plan(19);

insert into organizations (id, name) values
  ('07680000-0000-0000-0000-000000000001','BAM Org A'),
  ('07680000-0000-0000-0000-000000000002','BAM Org B');
insert into auth.users (id, email) values
  ('07680000-0000-0000-0000-0000000000a1','bam-admin-a@example.com'),
  ('07680000-0000-0000-0000-0000000000a2','bam-finance-a@example.com'),
  ('07680000-0000-0000-0000-0000000000b1','bam-admin-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('07680000-0000-0000-0000-0000000000a1','07680000-0000-0000-0000-000000000001','BAM Admin A','bam-admin-a@example.com','Admin','active'),
  ('07680000-0000-0000-0000-0000000000a2','07680000-0000-0000-0000-000000000001','BAM Finance A','bam-finance-a@example.com','Finance','active'),
  ('07680000-0000-0000-0000-0000000000b1','07680000-0000-0000-0000-000000000002','BAM Admin B','bam-admin-b@example.com','Admin','active');

-- ── Structure ───────────────────────────────────────────────────────────────────────────────────
select has_column('public','budget_category_account_map','is_push_target',
  'AC-BAM-001 the push flag exists');
select col_not_null('public','budget_category_account_map','is_push_target',
  'AC-BAM-001 the push flag is never NULL');
select col_default_is('public','budget_category_account_map','is_push_target','true',
  'AC-BAM-001 existing and single-account rows are push accounts by default');
select ok(exists(select 1 from pg_indexes
                  where schemaname='public' and tablename='budget_category_account_map'
                    and indexname='budget_category_account_map_one_push_per_category'
                    and indexdef like '%UNIQUE%(org_id, category) WHERE is_push_target'),
  'AC-BAM-001 at most one push account per (org, category), DB-enforced');
select col_is_unique('public','budget_category_account_map', array['org_id','erp_account'],
  'AC-BAM-001 an ERP account still backs at most one category per org');

-- ── AC-BAM-001: one category, several accounts; one push; account → one category ───────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"07680000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$insert into public.budget_category_account_map (id, category, erp_account)
      values ('07681111-0000-0000-0000-000000000001','Labor','Salary - BAM')$$,
  'AC-BAM-001 the first Labor account is written as its push account');
select lives_ok(
  $$insert into public.budget_category_account_map (id, category, erp_account, is_push_target) values
      ('07681111-0000-0000-0000-000000000002','Labor','Allowances - BAM', false),
      ('07681111-0000-0000-0000-000000000003','Labor','Social Security - BAM', false)$$,
  'AC-BAM-001 Labor takes two more, read-only accounts');
select is((select count(*)::int from public.budget_category_account_map where category = 'Labor'), 3,
  'AC-BAM-001 Labor maps to three accounts');
select throws_ok(
  $$insert into public.budget_category_account_map (category, erp_account) values ('Labor','Payroll Bonus - BAM')$$,
  '23505', 'duplicate key value violates unique constraint "budget_category_account_map_one_push_per_category"',
  'AC-BAM-001 a second PUSH account for Labor is refused');
select throws_ok(
  $$insert into public.budget_category_account_map (category, erp_account, is_push_target)
      values ('Overheads','Allowances - BAM', false)$$,
  '23505', 'duplicate key value violates unique constraint "budget_category_account_map_org_id_erp_account_key"',
  'AC-BAM-001 an account already under Labor cannot also back Overheads');

-- ── AC-BAM-004: moving the push flag ───────────────────────────────────────────────────────────────
select lives_ok(
  $$select public.set_budget_push_account('07681111-0000-0000-0000-000000000002')$$,
  'AC-BAM-004 Admin makes Allowances the Labor push account');
select results_eq(
  $$select erp_account from public.budget_category_account_map where category = 'Labor' and is_push_target$$,
  $$values ('Allowances - BAM'::text)$$,
  'AC-BAM-004 Labor has exactly one push account, the new one');

set local request.jwt.claims = '{"sub":"07680000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$select public.set_budget_push_account('07681111-0000-0000-0000-000000000001')$$,
  '42501', 'not authorized to set the budget push account',
  'AC-BAM-004 Finance cannot change the push account (Admin-only)');

set local request.jwt.claims = '{"sub":"07680000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select results_eq(
  $$select erp_account from public.budget_category_account_map where category = 'Labor' and is_push_target$$,
  $$values ('Allowances - BAM'::text)$$,
  'AC-BAM-004 the refused call changed nothing');

set local request.jwt.claims = '{"sub":"07680000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok(
  $$select public.set_budget_push_account('07681111-0000-0000-0000-000000000001')$$,
  'P0002', 'budget account mapping not found',
  'AC-BAM-004 another org''s Admin cannot reach org A''s row');

set local role postgres;
select ok(not has_function_privilege('anon', 'public.set_budget_push_account(uuid)', 'execute'),
  'AC-BAM-004 anon cannot execute set_budget_push_account');
select is((select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'set_budget_push_account'), false,
  'AC-BAM-004 SECURITY INVOKER — the table''s Admin-only RLS is the gate');

-- ── AC-BAM-002: actuals sum every account of a category ────────────────────────────────────────────
-- Materials has ONLY a read-only account: still "mapped" for actuals (C-1), never pushed.
insert into budget_category_account_map (org_id, category, erp_account, is_push_target) values
  ('07680000-0000-0000-0000-000000000001','Materials','Materials Stock - BAM', false);
insert into projects (id, org_id, name, status) values
  ('07682222-0000-0000-0000-000000000001','07680000-0000-0000-0000-000000000001','BAM Project','Ongoing Project');
insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('07683333-0000-0000-0000-000000000001','07680000-0000-0000-0000-000000000001','07682222-0000-0000-0000-000000000001',1,'BAM Active','Draft');
insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, actual_amount) values
  ('07680000-0000-0000-0000-000000000001','07683333-0000-0000-0000-000000000001','Labor','Crew',1000.00,0);
update budget_versions set status = 'Active' where id = '07683333-0000-0000-0000-000000000001';
insert into budget_version_erp_mirror (org_id, budget_version_id, fiscal_year, push_state) values
  ('07680000-0000-0000-0000-000000000001','07683333-0000-0000-0000-000000000001','2026','pushed');
insert into erp_actuals_snapshot (org_id, project_id, account, fiscal_year, debit, credit, net, as_of, snapshot_id) values
  ('07680000-0000-0000-0000-000000000001','07682222-0000-0000-0000-000000000001','Salary - BAM','2026',100.00,0,100.00,now(),'07684444-0000-0000-0000-000000000001'),
  ('07680000-0000-0000-0000-000000000001','07682222-0000-0000-0000-000000000001','Allowances - BAM','2026',20.00,0,20.00,now(),'07684444-0000-0000-0000-000000000001'),
  ('07680000-0000-0000-0000-000000000001','07682222-0000-0000-0000-000000000001','Social Security - BAM','2026',30.00,0,30.00,now(),'07684444-0000-0000-0000-000000000001'),
  ('07680000-0000-0000-0000-000000000001','07682222-0000-0000-0000-000000000001','Materials Stock - BAM','2026',40.00,0,40.00,now(),'07684444-0000-0000-0000-000000000001'),
  ('07680000-0000-0000-0000-000000000001','07682222-0000-0000-0000-000000000001','Unmapped Office - BAM','2026',999.00,0,999.00,now(),'07684444-0000-0000-0000-000000000001');

set local role authenticated;
set local request.jwt.claims = '{"sub":"07680000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(
  (select actuals_to_date from public.get_budget_projection('07682222-0000-0000-0000-000000000001','2026')
    where category = 'Labor'),
  150.00::numeric,
  'AC-BAM-002 Labor actuals sum every Labor account, push and read-only, and nothing unmapped');
select is(
  (select actuals_to_date from public.get_budget_projection('07682222-0000-0000-0000-000000000001','2026')
    where category = 'Materials'),
  40.00::numeric,
  'AC-BAM-002 a category whose only account is read-only still reads its actuals (C-1)');

select finish();
rollback;
```

Verify RED: `cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/budget_account_map_multi.test.sql'`
→ fails at `has_column … is_push_target`, and the second Labor insert fails 23505 on `…_org_id_category_key`.

### Task 2 — GREEN: migration 0246 (4 min)
Create `supabase/migrations/0246_budget_account_map_multi.sql`:

```sql
-- 0246_budget_account_map_multi.sql — #768: a budget category may map to SEVERAL ERP accounts.
-- Spec: docs/specs/budget-account-map-multi.spec.md (FR-BAM-001..004, NFR-BAM-001/002).
--
-- Supersedes the FIRST half of FR-BUD-111 (0137 §2): `unique (org_id, category)` made the map one account per
-- category. A client whose chart of accounts splits one cost class (salary / allowance / social security)
-- could then compare budget against only one of them. Now:
--   • a category may list many accounts — its ACTUALS sum across all of them (0153 get_budget_projection's
--     join already groups by category; unchanged here);
--   • at most ONE of them is the PUSH account (partial unique index) — the only account the ERP Budget gets;
--   • `unique (org_id, erp_account)` STAYS: an account still backs one category, which is what lets account-
--     grained actuals be attributed without inventing a split (ADR-0048).
-- `default true`: every existing row becomes its category's push account — single-account orgs are byte-for-
-- byte unchanged, and a writer that does not know the flag can still map a category's FIRST account but gets
-- 23505 for a second, so old app code cannot create a multi-account category during a back-to-front deploy.
-- RLS, grants, the org_id default and the stamp trigger are untouched (0137 §4).
--
-- Rollback (ADR-0006) — app first, then, in ONE transaction:
--   lock table public.budget_category_account_map in access exclusive mode;
--   do $$ begin
--     if exists (select 1 from public.budget_category_account_map group by org_id, category having count(*) > 1) then
--       raise exception 'categories with several accounts exist — remove the extra accounts in the app first';
--     end if;
--   end $$;
--   drop function if exists public.set_budget_push_account(uuid);
--   drop index if exists public.budget_category_account_map_one_push_per_category;
--   alter table public.budget_category_account_map
--     add constraint budget_category_account_map_org_id_category_key unique (org_id, category);
--   alter table public.budget_category_account_map drop column is_push_target;
-- Never delete an Admin's mapping row to make the guard pass. A single row with is_push_target = false
-- becomes a push account again after rollback — say so to the Admin before rolling back.

alter table public.budget_category_account_map
  add column is_push_target boolean not null default true;

comment on column public.budget_category_account_map.is_push_target is
  'True for the ONE account per category that receives the pushed ERP Budget amount (#768). Other accounts of the category count toward its actuals only.';

alter table public.budget_category_account_map
  drop constraint budget_category_account_map_org_id_category_key;

create unique index budget_category_account_map_one_push_per_category
  on public.budget_category_account_map (org_id, category)
  where is_push_target;

-- Move a category's push flag to one of its accounts, atomically. SECURITY INVOKER: the table's own RLS
-- (select = active member; write = active Admin of the org, 0137 §4) is the authorization — no definer surface.
create or replace function public.set_budget_push_account(p_map_id uuid)
  returns void
  language plpgsql
  security invoker
  set search_path = public, pg_temp
as $$
declare
  v_org      uuid;
  v_category public.budget_category;
begin
  select m.org_id, m.category into v_org, v_category
    from public.budget_category_account_map m
   where m.id = p_map_id;
  if v_org is null then
    raise exception 'budget account mapping not found' using errcode = 'P0002';
  end if;

  -- Serialize concurrent designations for this category. FOR UPDATE applies the write policy, so a
  -- non-Admin locks (and later updates) nothing.
  perform 1 from public.budget_category_account_map m
    where m.org_id = v_org and m.category = v_category
    for update;

  update public.budget_category_account_map
     set is_push_target = false, updated_by = auth.uid(), updated_at = now()
   where org_id = v_org and category = v_category and is_push_target and id <> p_map_id;

  update public.budget_category_account_map
     set is_push_target = true, updated_by = auth.uid(), updated_at = now()
   where id = p_map_id;

  -- #541 class: an RLS-denied UPDATE is a silent 0-row no-op. Say so.
  if not found then
    raise exception 'not authorized to set the budget push account' using errcode = '42501';
  end if;
end;
$$;

revoke all     on function public.set_budget_push_account(uuid) from public;
revoke execute on function public.set_budget_push_account(uuid) from anon;
grant  execute on function public.set_budget_push_account(uuid) to authenticated;
```

Verify GREEN: the Task 1 command → `ok 1..19`, all pass.

### Task 3 — Update the superseded AC-BUD-010 assertion + regression run (3 min)
In `supabase/tests/budget_category_account_map_rls.test.sql` replace lines 26–27:

```sql
select col_is_unique('public','budget_category_account_map', array['org_id','category'],
                     'AC-BUD-010 unique(org,category) — one account per category (the push)');
```
with:
```sql
-- #768 superseded FR-BUD-111's first half: a category may hold several accounts, ONE of them the push account.
select ok(exists(select 1 from pg_indexes where schemaname='public' and tablename='budget_category_account_map'
                   and indexname='budget_category_account_map_one_push_per_category'),
          'AC-BUD-010 one PUSH account per category (the push) — #768 replaced unique(org,category)');
```
and change only the description on line 51 from
`'AC-BUD-010 a second account for a mapped CATEGORY is rejected (the push)'` to
`'AC-BUD-010 a second PUSH account for a mapped CATEGORY is rejected (no flag ⇒ default push)'`.
Plan count stays `plan(9)`.

Verify: `cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/budget_category_account_map_rls.test.sql supabase/tests/budget_account_map_multi.test.sql supabase/tests/0229_special_expenses.test.sql supabase/tests/budget_projection_rpc.test.sql supabase/tests/bfy_unmapped_category_null.test.sql supabase/tests/bfy_map_edit_reinterprets_history.test.sql'` → all pass.

### Task 4 — Seed: flag column, read-only Labor sibling, constraint-free conflict clause (3 min)
In `supabase/seed.sql` replace lines 460–476 (the comment block through `on conflict (org_id, category) do nothing;`) with:

```sql
-- FR-BUD-110/111 + #768: PMO category → the client's own ERP account(s). An UNMAPPED category's actuals are
-- deliberately NULL ("no account to look at"), never 0 — 'Contingency' is left unmapped on purpose so the
-- seeded screen shows BOTH states side by side.
-- ⚑ An ERP account still belongs to ONE category (`unique (org_id, erp_account)`), and a category has at most
-- ONE push account (partial unique index, 0246). So these accounts MUST NOT collide with the ones the budget
-- e2e lane binds per run (`e2e/serial/_budHelpers.ts`: LABOR_ACCOUNT = 'Administrative Expenses - PSC',
-- LABOR_SIBLING_ACCOUNT = 'Travel Expenses - PSC', MATERIALS_ACCOUNT = 'Commission on Sales - PSC').
-- `on conflict do nothing` has no target on purpose: 0246 replaced the (org_id, category) constraint with a
-- partial index, which a bare conflict target cannot name.
insert into budget_category_account_map (org_id, category, erp_account, is_push_target) values
  ('00000000-0000-0000-0000-000000000001','Materials','Cost of Goods Sold - PSC', true),
  ('00000000-0000-0000-0000-000000000001','Labor','Salary - PSC', true),
  ('00000000-0000-0000-0000-000000000001','Equipment','Expenses Included In Asset Valuation - PSC', true),
  -- Mapped but with NO GL rows below -> a REAL, computed zero, which is a DIFFERENT fact from
  -- 'Contingency'/'Subcontractors' (unmapped -> unobtainable/NULL). The seeded screen shows all three.
  ('00000000-0000-0000-0000-000000000001','Permits & Fees','Entertainment Expenses - PSC', true),
  -- #768: Labor's second, READ-ONLY account — its actuals count toward Labor, its budget is never pushed.
  -- No GL rows below, so no seeded figure changes; the account map shows a multi-account category.
  ('00000000-0000-0000-0000-000000000001','Labor','Payroll Allowances - PSC', false)
on conflict do nothing;
```

Verify: `cd "$WT" && scripts/with-db-lock.sh bash -c "supabase db reset && psql \"\$(supabase status -o env | sed -n 's/^DB_URL=\"\\(.*\\)\"$/\\1/p')\" -Atc \"select category, erp_account, is_push_target from budget_category_account_map where org_id='00000000-0000-0000-0000-000000000001' order by 1,2\""`
→ 5 rows; `Labor|Payroll Allowances - PSC|f` and `Labor|Salary - PSC|t` present.

### Task 5 — Regenerate DB types (2 min)
`cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts'`
Verify: `cd "$WT" && grep -n "is_push_target" pmo-portal/src/lib/supabase/database.types.ts | head -3` shows Row/Insert/Update
entries, and `grep -n set_budget_push_account pmo-portal/src/lib/supabase/database.types.ts` shows the function.
Then `cd "$WT/pmo-portal" && npm run typecheck` → 0 errors (the column is optional on Insert, so existing
writers still compile).

### Task 6 — RED: the resolver refuses two push rows for one category (AC-BAM-006) (2 min)
Append inside the `describe` in `pmo-portal/src/lib/budget/categoryAccountMap.test.ts`:

```ts
  it('AC-BAM-006 refuses a map with two accounts for one category — never pushes to an arbitrary one', () => {
    const run = () => resolveBudgetAccounts(
      [{ category: 'Labor', budgeted_amount: '100.00' }],
      [
        { category: 'Labor', erp_account: 'Salary - PSC' },
        { category: 'Labor', erp_account: 'Allowances - PSC' },
        { category: 'Materials', erp_account: 'Cost of Goods Sold - PSC' },
      ],
    );
    expect(run).toThrow('budget categories have more than one push account: Labor');
    try { run(); } catch (e) { expect((e as { code?: string }).code).toBe('commit-rejected'); }
  });
```
Verify RED: `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/lib/budget/categoryAccountMap.test.ts`
→ AC-BAM-006 fails: "expected function to throw" (today the last row silently wins).

### Task 7 — GREEN: duplicate-category refusal in `resolveBudgetAccounts` (3 min)
In `pmo-portal/src/lib/budget/categoryAccountMap.ts`:
- Change the `CategoryAccountMapRow` doc comment (line 41) to:
  `/** One PUSH row of \`budget_category_account_map\` (0137, #768): the account a category's budget is pushed to. The reader (\`dispatchFactory.readCategoryAccountMap\`) passes only push rows — at most one per category. */`
- Replace line 107
  `const accountFor = new Map(map.map((row) => [row.category, row.erp_account]));`
  with:
```ts
  // ⚑ #768 FR-BAM-007: the DB allows at most one PUSH account per category and the reader passes only those.
  // If two rows for one category ever arrive here (a regressed reader), REFUSE — a `new Map` would let the
  // last row win and push the budget to an arbitrary account.
  const accountFor = new Map<string, string>();
  const ambiguous: string[] = [];
  for (const row of map) {
    if (accountFor.has(row.category)) {
      if (!ambiguous.includes(row.category)) ambiguous.push(row.category);
      continue;
    }
    accountFor.set(row.category, row.erp_account);
  }
  if (ambiguous.length > 0) {
    throw new AdapterError('commit-rejected', `budget categories have more than one push account: ${ambiguous.join(', ')}`);
  }
```
Verify GREEN: Task 6 command → all tests in the file pass.

### Task 8 — RED: the push reads only push rows (AC-BAM-003, AC-BAM-005) (4 min)
In `pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.budget.test.ts`:
- change line 11 to
  `import { resolveErpDispatchAdapter, readBudgetLineItems, readCategoryAccountMap, type DispatchServiceClient } from './dispatchFactory';`
- add after line 13: `import { resolveBudgetAccounts, BudgetCategoryUnmappedError } from '../../budget/categoryAccountMap';`
- append at end of file:

```ts
/**
 * #768 — a category may map to several ERP accounts, but the budget is pushed to ONE of them. The SHIPPED
 * reader (shared by the dispatch, the adapter-dispatch gate and the sweep) is driven through the
 * PostgREST-faithful fake, so the filter is really applied, not assumed.
 */
describe('#768 readCategoryAccountMap — only the push account reaches the ERP body', () => {
  const MULTI = [
    { org_id: 'org-1', category: 'Labor', erp_account: 'Salary - PSC', is_push_target: true },
    { org_id: 'org-1', category: 'Labor', erp_account: 'Allowances - PSC', is_push_target: false },
    { org_id: 'org-1', category: 'Labor', erp_account: 'Social Security - PSC', is_push_target: false },
    { org_id: 'org-2', category: 'Labor', erp_account: 'Other Tenant Salary', is_push_target: true },
  ];

  it('AC-BAM-003 a multi-account category pushes its whole total to the push account only', async () => {
    const fake = new FakePostgrest({ budget_category_account_map: MULTI });
    const map = await readCategoryAccountMap(fake as unknown as DispatchServiceClient, 'org-1');
    expect(map).toEqual([{ category: 'Labor', erp_account: 'Salary - PSC' }]);
    expect(resolveBudgetAccounts(
      [{ category: 'Labor', budgeted_amount: '30000.00' }, { category: 'Labor', budgeted_amount: '20000.00' }],
      map,
    )).toEqual([{ account: 'Salary - PSC', budget_amount: '50000.00' }]);
  });

  it('AC-BAM-005 a category whose accounts are all read-only fails closed as unmapped, naming it', async () => {
    const fake = new FakePostgrest({
      budget_category_account_map: MULTI.map((r) => (r.org_id === 'org-1' ? { ...r, is_push_target: false } : r)),
    });
    const map = await readCategoryAccountMap(fake as unknown as DispatchServiceClient, 'org-1');
    let err: unknown;
    try { resolveBudgetAccounts([{ category: 'Labor', budgeted_amount: '1.00' }], map); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(BudgetCategoryUnmappedError);
    expect((err as BudgetCategoryUnmappedError).unmappedCategories).toEqual(['Labor']);
  });
});
```
Verify RED: `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/lib/adapterSeam/erpnext/dispatchFactory.budget.test.ts`
→ AC-BAM-003 fails (`map` has 3 org-1 rows carrying `org_id`/`is_push_target`). AC-BAM-005 fails (the
resolver throws `commit-rejected` "more than one push account", not unmapped).

### Task 9 — GREEN: filter + project in `readCategoryAccountMap` (3 min)
In `pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.ts`:
- line 35: `eq(column: string, value: string): DispatchFilterBuilder;` → `eq(column: string, value: string | boolean): DispatchFilterBuilder;`
- replace lines 626–652 (doc comment + function) with:

```ts
/**
 * Read the org's PUSH accounts from `budget_category_account_map` (0137, #768) — the Admin-administered map
 * that turns PMO's `budget_category` into the client's own ERP account. A category may list several accounts
 * (its actuals sum across all of them, 0153); exactly the ONE flagged `is_push_target` (at most one per
 * category, 0246's partial unique index) receives the pushed budget. Read-only accounts never reach the body.
 * It is a TABLE, not binding config, so it is resolved SERVER-SIDE here and injected into `ctx.config`; the
 * command payload never carries it (a client-supplied map would let the caller pick which GL accounts their
 * budget constrains).
 *
 * Fails CLOSED on a read error rather than proceeding with an empty map: "we could not read the map" and
 * "the org has no push account for X" must both refuse the push (the second is refused downstream by
 * `resolveBudgetAccounts`, naming the categories).
 *
 * Exported so `adapter-dispatch/index.ts`'s budget gate and `erpnext-sweep` read the SAME map this factory
 * injects into `ctx.config` — one definition, so a gate PASS can never be followed by a push-time surprise.
 */
export async function readCategoryAccountMap(
  serviceClient: DispatchServiceClient,
  orgId: string,
): Promise<Array<{ category: string; erp_account: string }>> {
  const { data, error } = await serviceClient
    .from('budget_category_account_map')
    .select('category, erp_account')
    .eq('org_id', orgId)
    .eq('is_push_target', true);
  if (error) {
    throw new AppError(`budget push: the category→account map could not be read: ${error.message}`, 'commit-rejected');
  }
  return Array.isArray(data)
    ? (data as Array<{ category: string; erp_account: string }>).map((r) => ({ category: r.category, erp_account: r.erp_account }))
    : [];
}
```
Verify GREEN:
`cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/lib/adapterSeam/erpnext/ src/lib/budget/ src/lib/adapterSeam/dispatch.test.ts`
→ all pass (existing budget suites stay green: their hand-rolled map mocks ignore filters and hold one row
per category).

### Task 10 — RED: readiness counts push categories once (AC-BAM-007) (3 min)
Append to `supabase/functions/external-set-company/setup.test.ts`:

```ts
Deno.test("AC-BAM-007 readiness counts each category with a push account exactly once", async () => {
  await withFetchMock([
    ...base(),
    supabaseSelect("external_domain_ownership", () => jsonResponse([])),
    supabaseSelect("projects", () => jsonResponse([])),
    supabaseSelect("budget_category_account_map", () =>
      jsonResponse([
        { id: "m1", category: "Labor", erp_account: "Salary - EX", is_push_target: true },
        { id: "m2", category: "Labor", erp_account: "Allowances - EX", is_push_target: false },
        { id: "m3", category: "Materials", erp_account: "Materials - EX", is_push_target: false },
        { id: "m4", category: "Equipment", erp_account: "Equipment - EX", is_push_target: true },
      ])),
    supabaseSelect("erp_employees", () => jsonResponse([])),
  ], async () => {
    const response = await handleSetCompanyRequest(
      await request({ tier: "erpnext", setupAction: "readiness" }),
    );
    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.budgetMappedCategories, ["Labor", "Equipment"]);
  });
});
```
Verify RED: `cd "$WT/supabase/functions/external-set-company" && deno test --allow-all setup.test.ts`
→ AC-BAM-007 fails: actual `["Labor","Labor","Materials","Equipment"]`.

### Task 11 — GREEN: `setup.ts` readiness (2 min)
In `supabase/functions/external-set-company/setup.ts`:
- line 184: `read("budget_category_account_map", "id,category,erp_account"),` →
  `read("budget_category_account_map", "id,category,erp_account,is_push_target"),`
- replace lines 214–216 with:
```ts
    // #768 FR-BAM-009: a category may list several accounts; it is push-ready only when one is its push
    // account, and it counts ONCE however many accounts it lists ("N of 8 configured").
    budgetMappedCategories: [
      ...new Set(
        accounts.filter((row) =>
          row.is_push_target === true &&
          typeof row.erp_account === "string" && row.erp_account.trim()
        ).map((row) => row.category),
      ),
    ],
```
Verify GREEN: Task 10 command → all tests pass (including `AC-SETUP-002`'s empty list).

### Task 12 — RED: repository is id-keyed and can move the push flag (5 min)
In `pmo-portal/src/lib/repositories/budgetProjection.test.ts`:
- import list (lines 44–47): add `setBudgetPushAccount,` after `deleteBudgetCategoryAccountMapRow,`.
- replace the two `describe` blocks at lines 560–605 with:

```ts
describe('listBudgetCategoryAccountMap (AC-BUD-011/012 admin surface, #768)', () => {
  it('lists every account row with its id and push flag, ordered by category then account', async () => {
    makeFromBuilder({
      data: [{ id: 'm1', category: 'Labor', erp_account: '5100 - Direct Costs', is_push_target: true }],
      error: null,
    });
    const rows = await listBudgetCategoryAccountMap();
    expect(mockFrom).toHaveBeenCalledWith('budget_category_account_map');
    expect(mockSelect).toHaveBeenCalledWith('id, category, erp_account, is_push_target');
    expect(mockOrder).toHaveBeenCalledWith('category');
    expect(mockOrder).toHaveBeenCalledWith('erp_account');
    expect(rows).toEqual([{ id: 'm1', category: 'Labor', erpAccount: '5100 - Direct Costs', isPushTarget: true }]);
  });
});

describe('account map writes (#768: id-keyed, explicit push flag)', () => {
  it('creates an account row with its push flag stated explicitly', async () => {
    makeFromBuilder({ data: { id: 'm2', category: 'Labor', erp_account: '5110 - Allowances', is_push_target: false }, error: null });
    const row = await createBudgetCategoryAccountMapRow('Labor', '5110 - Allowances', false);
    expect(mockInsert).toHaveBeenCalledWith({ category: 'Labor', erp_account: '5110 - Allowances', is_push_target: false });
    expect(row).toEqual({ id: 'm2', category: 'Labor', erpAccount: '5110 - Allowances', isPushTarget: false });
  });

  it('an account already under another category (23505) surfaces as an AppError with the code preserved', async () => {
    makeFromBuilder({
      data: null,
      error: { message: 'duplicate key value violates unique constraint "budget_category_account_map_org_id_erp_account_key"', code: '23505' },
    });
    await expect(createBudgetCategoryAccountMapRow('Overheads', '5100 - Direct Costs', true)).rejects.toMatchObject({ code: '23505' });
    await expect(createBudgetCategoryAccountMapRow('Overheads', '5100 - Direct Costs', true)).rejects.toBeInstanceOf(AppError);
  });

  it('renames one account row by id', async () => {
    makeFromBuilder({ data: { id: 'm1', category: 'Labor', erp_account: '5100 - New Account', is_push_target: true }, error: null });
    const row = await updateBudgetCategoryAccountMapRow('m1', '5100 - New Account');
    expect(mockUpdate).toHaveBeenCalledWith({ erp_account: '5100 - New Account' });
    expect(mockEq).toHaveBeenCalledWith('id', 'm1');
    expect(row).toEqual({ id: 'm1', category: 'Labor', erpAccount: '5100 - New Account', isPushTarget: true });
  });

  it('removes one account row by id', async () => {
    makeFromBuilder({ data: [{ id: 'm9' }], error: null });
    await deleteBudgetCategoryAccountMapRow('m9');
    expect(mockDelete).toHaveBeenCalled();
    expect(mockEq).toHaveBeenCalledWith('id', 'm9');
  });

  it('moves the push flag through set_budget_push_account', async () => {
    makeRpcBuilder({ data: null, error: null });
    await setBudgetPushAccount('m2');
    expect(mockRpc).toHaveBeenCalledWith('set_budget_push_account', { p_map_id: 'm2' });
  });

  it('a refused push-flag move (42501) rejects, never resolves silently', async () => {
    makeRpcBuilder({ data: null, error: { message: 'not authorized to set the budget push account', code: '42501' } });
    await expect(setBudgetPushAccount('m2')).rejects.toMatchObject({ code: '42501' });
  });
});
```
- in the `#541` block (lines 713–726) change `{ category: 'Labor' }` → `{ id: 'm1' }` and both
  `deleteBudgetCategoryAccountMapRow('Labor')` → `deleteBudgetCategoryAccountMapRow('m1')`.

Verify RED: `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/lib/repositories/budgetProjection.test.ts`
→ fails: `setBudgetPushAccount` is not exported; create/list assert the new select/insert shapes.

### Task 13 — GREEN: repository (4 min)
In `pmo-portal/src/lib/repositories/budgetProjection.ts` replace lines 117–121 (`CategoryAccountMapRow`) with:

```ts
/** One `budget_category_account_map` row, camelCase. A category may hold several (#768); at most one of them
 *  is its push account — the only one the ERP Budget receives. The others count toward its actuals only. */
export interface CategoryAccountMapRow {
  id: string;
  category: BudgetCategory;
  erpAccount: string;
  isPushTarget: boolean;
}

const MAP_COLUMNS = 'id, category, erp_account, is_push_target';
interface MapDbRow { id: string; category: BudgetCategory; erp_account: string; is_push_target: boolean }
const toMapRow = (r: MapDbRow): CategoryAccountMapRow => ({
  id: r.id, category: r.category, erpAccount: r.erp_account, isPushTarget: r.is_push_target,
});
```
and replace lines 359–414 (list/create/update/delete) with:

```ts
/** Lists every account row of the caller org's map, by category then account (RLS scopes the org). */
export async function listBudgetCategoryAccountMap(): Promise<CategoryAccountMapRow[]> {
  const { data, error } = await supabase
    .from('budget_category_account_map')
    .select(MAP_COLUMNS)
    .order('category')
    .order('erp_account');
  if (error) throw toAppError(error);
  return ((data ?? []) as MapDbRow[]).map(toMapRow);
}

/** Adds an account to a category (Admin-only — RLS `budget_category_account_map_write`, FR-BUD-112). The push
 *  flag is ALWAYS stated: the caller passes `true` only when the category has no push account (FR-BAM-003).
 *  An account already under another category, or a second push account, surfaces as 23505. */
export async function createBudgetCategoryAccountMapRow(
  category: BudgetCategory,
  erpAccount: string,
  isPushTarget: boolean,
): Promise<CategoryAccountMapRow> {
  const { data, error } = await supabase
    .from('budget_category_account_map')
    .insert({ category, erp_account: erpAccount, is_push_target: isPushTarget })
    .select(MAP_COLUMNS)
    .single();
  if (error) throw toAppError(error);
  return toMapRow(data as MapDbRow);
}

/** Renames one account row (by id). Same Admin-only / account-uniqueness constraints as create. */
export async function updateBudgetCategoryAccountMapRow(id: string, erpAccount: string): Promise<CategoryAccountMapRow> {
  const { data, error } = await supabase
    .from('budget_category_account_map')
    .update({ erp_account: erpAccount })
    .eq('id', id)
    .select(MAP_COLUMNS)
    .single();
  if (error) throw toAppError(error);
  return toMapRow(data as MapDbRow);
}

/** Removes one account row (Admin-only). Removing a category's LAST account unmaps it, and a non-zero push in
 *  that category then FAILS CLOSED (FR-BUD-113) — a deliberate Admin act. */
export async function deleteBudgetCategoryAccountMapRow(id: string): Promise<void> {
  const { data, error } = await supabase
    .from('budget_category_account_map')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) throw toAppError(error);
  // #541: a `using`-denied DELETE (non-Admin, wrong org) removes 0 rows and reports no error. Here
  // that inverts the fail-closed contract above: the Admin believes the account is gone while the
  // mapping is still live.
  assertWriteLanded(data, 'Category mapping not found or you do not have permission to remove it.');
}

/** Makes one account its category's push account, clearing the previous one in the same transaction
 *  (`set_budget_push_account`, 0246 — SECURITY INVOKER, Admin-only by RLS; 42501 when nothing was updated). */
export async function setBudgetPushAccount(id: string): Promise<void> {
  const { error } = await supabase.rpc('set_budget_push_account', { p_map_id: id });
  if (error) throw toAppError(error);
}
```
Verify GREEN: Task 12 command → all pass; then `cd "$WT/pmo-portal" && npm run typecheck` reports errors **only**
in `pages/admin/BudgetAccountMap.tsx` (fixed in Task 16).

### Task 14 — RED: the multi-account map page (AC-BAM-008…011) (5 min)
In `pmo-portal/pages/admin/BudgetAccountMap.test.tsx`:
- lines 16–28: add `setPushMock: vi.fn(),` to the hoisted object, destructure `setPushMock`, and add
  `setBudgetPushAccount: setPushMock,` to the `vi.mock` factory.
- `beforeEach` (lines 73–83): add `setPushMock.mockReset();` and `setPushMock.mockResolvedValue(undefined);`, and
  change line 78 to
  `listMock.mockResolvedValue([{ id: 'm-labor', category: 'Labor', erpAccount: '5100 - Direct Costs', isPushTarget: true }]);`
- Deliberate UX change: the actions are now per account. Edit the existing tests:
  - line 111: `{ name: /edit.*labor/i }` → `{ name: 'Edit 5100 - Direct Costs' }`; line 113: `{ name: /unmap labor/i }` →
    `{ name: 'Remove 5100 - Direct Costs' }`; add after line 113:
    `expect(screen.getByRole('button', { name: 'Add account to Labor' })).toBeInTheDocument();`
  - lines 119/121: the same two renames in the Engineer test.
  - line 132: `toHaveBeenCalledWith('Special expenses', 'Travel expenses')` → `toHaveBeenCalledWith('Special expenses', 'Travel expenses', true)`.
  - line 142: `toHaveBeenCalledWith('Materials', '5200 - Materials')` → `toHaveBeenCalledWith('Materials', '5200 - Materials', true)`.
  - line 148: `{ name: /edit.*labor/i }` → `{ name: 'Edit 5100 - Direct Costs' }`; line 154:
    `toHaveBeenCalledWith('Labor', '5100 - New Account')` → `toHaveBeenCalledWith('m-labor', '5100 - New Account')`.
  - line 171: `{ name: /unmap labor/i }` → `{ name: 'Remove 5100 - Direct Costs' }`; line 174:
    `toHaveBeenCalledWith('Labor')` → `toHaveBeenCalledWith('m-labor')`.
- Append:

```tsx
const MULTI = [
  { id: 'm-sal', category: 'Labor', erpAccount: 'Salary - PSC', isPushTarget: true },
  { id: 'm-all', category: 'Labor', erpAccount: 'Allowances - PSC', isPushTarget: false },
  { id: 'm-mat', category: 'Materials', erpAccount: 'COGS - PSC', isPushTarget: false },
];

describe('BudgetAccountMap — several accounts per category (#768)', () => {
  it('AC-BAM-008 lists every account of a category and marks the one budget push account', async () => {
    listMock.mockResolvedValue(MULTI);
    renderPage('Engineer');
    const labor = (await screen.findByText('Labor')).closest('tr')!;
    const salary = within(labor).getByText('Salary - PSC').closest('li')!;
    const allowances = within(labor).getByText('Allowances - PSC').closest('li')!;
    expect(within(salary).getByText('Budget push')).toBeInTheDocument();
    expect(within(allowances).queryByText('Budget push')).not.toBeInTheDocument();
    expect(within(labor).queryByText(/blocks every push/i)).not.toBeInTheDocument();
    expect(within(labor).queryByRole('button')).not.toBeInTheDocument();
  });

  it('AC-BAM-008 a category with accounts but no push account is marked as blocking every push', async () => {
    listMock.mockResolvedValue(MULTI);
    renderPage('Admin');
    const materials = (await screen.findByText('Materials')).closest('tr')!;
    expect(within(materials).getByText('No push account — blocks every push')).toBeInTheDocument();
  });

  it('AC-BAM-009 an account added to a category that has a push account is added read-only', async () => {
    listMock.mockResolvedValue(MULTI);
    const user = userEvent.setup();
    renderPage('Admin');
    await user.click(await screen.findByRole('button', { name: 'Add account to Labor' }));
    const modal = await screen.findByRole('dialog', { name: 'Add account to Labor' });
    await user.type(within(modal).getByLabelText(/erp account/i), 'Social Security - PSC');
    await user.click(within(modal).getByRole('button', { name: /save/i }));
    await waitFor(() => expect(createMock).toHaveBeenCalledWith('Labor', 'Social Security - PSC', false));
  });

  it('AC-BAM-009 an account added to a category with no push account becomes its push account', async () => {
    listMock.mockResolvedValue(MULTI);
    const user = userEvent.setup();
    renderPage('Admin');
    await user.click(await screen.findByRole('button', { name: 'Add account to Materials' }));
    const modal = await screen.findByRole('dialog', { name: 'Add account to Materials' });
    await user.type(within(modal).getByLabelText(/erp account/i), 'Raw Materials - PSC');
    await user.click(within(modal).getByRole('button', { name: /save/i }));
    await waitFor(() => expect(createMock).toHaveBeenCalledWith('Materials', 'Raw Materials - PSC', true));
  });

  it('AC-BAM-009 an account already under another category is refused before submit, naming it', async () => {
    listMock.mockResolvedValue(MULTI);
    const user = userEvent.setup();
    renderPage('Admin');
    await user.click(await screen.findByRole('button', { name: 'Add account to Materials' }));
    const modal = await screen.findByRole('dialog', { name: 'Add account to Materials' });
    await user.type(within(modal).getByLabelText(/erp account/i), 'Allowances - PSC');
    await user.click(within(modal).getByRole('button', { name: /save/i }));
    expect((await within(modal).findAllByText('Allowances - PSC is already mapped to Labor.')).length).toBeGreaterThan(0);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('AC-BAM-010 choosing a new push account confirms first, says it applies from the next push, then moves it', async () => {
    listMock.mockResolvedValue(MULTI);
    const user = userEvent.setup();
    renderPage('Admin');
    await user.click(await screen.findByRole('button', { name: 'Use Allowances - PSC for budget push' }));
    const confirm = await screen.findByRole('dialog', { name: 'Push Labor to Allowances - PSC?' });
    expect(within(confirm).getByText(/keeps its current account until it is pushed again/i)).toBeInTheDocument();
    expect(setPushMock).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole('button', { name: 'Use for push' }));
    await waitFor(() => expect(setPushMock).toHaveBeenCalledWith('m-all'));
  });

  it('AC-BAM-011 the push account cannot be removed while its category has other accounts', async () => {
    listMock.mockResolvedValue(MULTI);
    renderPage('Admin');
    const labor = (await screen.findByText('Labor')).closest('tr')!;
    expect(within(labor).queryByRole('button', { name: 'Remove Salary - PSC' })).not.toBeInTheDocument();
    expect(within(labor).getByText('Make another account the push account to remove this one.')).toBeInTheDocument();
  });

  it('AC-BAM-011 removing a read-only account confirms, says its actuals stop counting, and deletes that row only', async () => {
    listMock.mockResolvedValue(MULTI);
    const user = userEvent.setup();
    renderPage('Admin');
    await user.click(await screen.findByRole('button', { name: 'Remove Allowances - PSC' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Remove Allowances - PSC?' });
    expect(within(confirm).getByText(/stop counting toward this category/i)).toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('m-all'));
  });
});
```
Verify RED: `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run pages/admin/BudgetAccountMap.test.tsx`
→ the edited and the new tests fail (no "Edit 5100 - Direct Costs", no "Add account to Labor", one account per row).

### Task 15 — Locale keys (en + id) (3 min)
In `pmo-portal/public/locales/en/common.json`, inside `"budgetMap": { … }` (line 176), add after `"unmap": "Unmap {{category}}",`:
```json
      "multiNote": "A category may list several accounts. Its actuals add up across all of them; its budget is pushed only to the account marked Budget push.",
      "noPush": "No push account — blocks every push",
      "pushBadge": "Budget push",
      "addAccount": "Add account to {{category}}",
      "editAccount": "Edit {{account}}",
      "usePush": "Use {{account}} for budget push",
      "removeAccount": "Remove {{account}}",
      "removePushHint": "Make another account the push account to remove this one.",
      "confirmPush": {
        "title": "Push {{category}} to {{account}}?",
        "fallbackTitle": "Change push account?",
        "description": "Future budget pushes send this category's whole total to this account. A budget already in the ERP keeps its current account until it is pushed again.",
        "confirm": "Use for push"
      },
      "confirmRemove": {
        "title": "Remove {{account}}?",
        "description": "Actuals posted to this account will stop counting toward this category. The budget push is unchanged.",
        "confirm": "Remove"
      },
```
add to `"toast"`: `"removed": "Account removed", "pushSet": "Push account changed"`; add to `"form"`:
`"readOnlySubtitle": "Its actuals count toward this category; its budget is not pushed here"`.

In `pmo-portal/public/locales/id/common.json`, same positions:
```json
      "multiNote": "Satu kategori boleh memiliki beberapa akun. Realisasinya dijumlahkan dari semua akun tersebut; anggarannya hanya dikirim ke akun bertanda Pengiriman anggaran.",
      "noPush": "Tanpa akun pengiriman — memblokir setiap pengiriman",
      "pushBadge": "Pengiriman anggaran",
      "addAccount": "Tambah akun ke {{category}}",
      "editAccount": "Edit {{account}}",
      "usePush": "Gunakan {{account}} untuk pengiriman anggaran",
      "removeAccount": "Hapus {{account}}",
      "removePushHint": "Jadikan akun lain sebagai akun pengiriman untuk menghapus akun ini.",
      "confirmPush": {
        "title": "Kirim {{category}} ke {{account}}?",
        "fallbackTitle": "Ubah akun pengiriman?",
        "description": "Pengiriman anggaran berikutnya mengirim seluruh total kategori ini ke akun ini. Anggaran yang sudah ada di ERP tetap memakai akun lamanya sampai dikirim ulang.",
        "confirm": "Gunakan untuk pengiriman"
      },
      "confirmRemove": {
        "title": "Hapus {{account}}?",
        "description": "Realisasi pada akun ini tidak lagi dihitung untuk kategori ini. Pengiriman anggaran tidak berubah.",
        "confirm": "Hapus"
      },
```
`"toast"`: `"removed": "Akun dihapus", "pushSet": "Akun pengiriman diubah"`; `"form"`:
`"readOnlySubtitle": "Realisasinya dihitung untuk kategori ini; anggarannya tidak dikirim ke sini"`.

Verify: `cd "$WT/pmo-portal" && node -e "for (const l of ['en','id']) { const j=require('./public/locales/'+l+'/common.json'); const m=j.admin.budgetMap; if(!m.confirmPush||!m.confirmRemove||!m.toast.pushSet||!m.form.readOnlySubtitle) throw new Error(l) } console.log('ok')"` → `ok`.

### Task 16 — GREEN: `BudgetAccountMap.tsx` (5 min)
Replace the whole of `pmo-portal/pages/admin/BudgetAccountMap.tsx` with:

```tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ListState,
  ConfirmDialog,
  EntityFormModal,
  type SubmitError,
  TextField,
  FormGrid,
  FormSection,
  StatusPill,
  Button,
  useToast,
  useEntityForm,
} from '@/src/components/ui';
import { Constants } from '@/src/lib/supabase/database.types';
import { usePermission } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import {
  listBudgetCategoryAccountMap,
  createBudgetCategoryAccountMapRow,
  updateBudgetCategoryAccountMapRow,
  deleteBudgetCategoryAccountMapRow,
  setBudgetPushAccount,
  type CategoryAccountMapRow,
  type BudgetCategory,
} from '@/src/lib/repositories/budgetProjection';

/**
 * Administration › Budget account map (P3c FR-BUD-110..113; #768 FR-BAM-010..013) — the Admin CRUD surface for
 * `budget_category_account_map`. Every PMO `budget_category` is ALWAYS shown, mapped or not: an unmapped
 * category, or one with accounts but no push account, FAILS CLOSED at the next push, so it must stay visible.
 *
 * #768: a category may list several ERP accounts. Its actuals add up across all of them; its budget is pushed
 * only to the ONE marked "Budget push" (0246: at most one per category, DB-enforced). An account still belongs
 * to one category (`unique (org_id, erp_account)`), pre-checked here and re-asserted by the DB.
 *
 * ⚑ Admin-only (FR-BUD-112): gated on `can('manage', 'integration', ctx)`. RLS
 * (`budget_category_account_map_write`) and the SECURITY INVOKER `set_budget_push_account` enforce the same
 * predicate server-side. This is UX only; RLS is the authority (ADR-0016).
 */

const BUDGET_CATEGORIES = Constants.public.Enums.budget_category;

interface FormValues {
  erpAccount: string;
}

/** What the account form does: add an account to a category, or rename one account row. */
type FormTarget =
  | { mode: 'create'; category: BudgetCategory; isPushTarget: boolean }
  | { mode: 'edit'; row: CategoryAccountMapRow };

const BudgetAccountMap: React.FC = () => {
  const { t } = useTranslation();
  const categoryLabel = (value: string) => value === 'Special expenses'
    ? t('budget.category.specialExpenses', 'Special expenses') : value;
  const may = usePermission();
  const canManage = may('manage', 'integration');
  const { toast } = useToast();
  const qc = useQueryClient();
  const sectionRef = useRef<HTMLElement>(null);

  const { data, isPending, isError, refetch } = useQuery<CategoryAccountMapRow[]>({
    queryKey: ['budget-category-account-map'],
    queryFn: listBudgetCategoryAccountMap,
  });

  const rows = useMemo(() => data ?? [], [data]);
  const accountsByCategory = useMemo(() => {
    const byCategory = new Map<string, CategoryAccountMapRow[]>();
    for (const row of rows) byCategory.set(row.category, [...(byCategory.get(row.category) ?? []), row]);
    return byCategory;
  }, [rows]);

  const [formTarget, setFormTarget] = useState<FormTarget | null>(null);
  const [removeTarget, setRemoveTarget] = useState<CategoryAccountMapRow | null>(null);
  const [pushTarget, setPushTarget] = useState<CategoryAccountMapRow | null>(null);
  // #559 / AC-ERR-001: the form fires and forgets — this component owns the mutation and its rejection.
  const [saveError, setSaveError] = useState<SubmitError | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['budget-category-account-map'] });

  // AC-ADMIA-004 (fragment deep-link) — unchanged: the ROUTER hash is the source of truth; scroll/focus the
  // map once it has rendered. Declared before the early returns (Rules of Hooks).
  const { hash } = useLocation();
  const mapLoaded = !isPending && !isError;
  useEffect(() => {
    if (!mapLoaded || !sectionRef.current) return;
    if (hash !== '#budget-account-map') return;
    sectionRef.current.scrollIntoView({ block: 'start' });
    sectionRef.current.focus({ preventScroll: true });
  }, [mapLoaded, hash]);

  const createMutation = useMutation({
    mutationFn: (v: { category: BudgetCategory; erpAccount: string; isPushTarget: boolean }) =>
      createBudgetCategoryAccountMapRow(v.category, v.erpAccount, v.isPushTarget),
    onSuccess: invalidate,
  });
  const updateMutation = useMutation({
    mutationFn: (v: { id: string; erpAccount: string }) => updateBudgetCategoryAccountMapRow(v.id, v.erpAccount),
    onSuccess: invalidate,
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteBudgetCategoryAccountMapRow(id),
    onSuccess: invalidate,
  });
  const pushMutation = useMutation({
    mutationFn: (id: string) => setBudgetPushAccount(id),
    onSuccess: invalidate,
  });

  // Removing a category's LAST account unmaps it (the shipped unmap copy); removing a read-only sibling only
  // stops its actuals counting.
  const removeIsLast = removeTarget ? (accountsByCategory.get(removeTarget.category)?.length ?? 0) <= 1 : false;

  const onRemoveConfirm = async () => {
    if (!removeTarget) return;
    const target = removeTarget;
    const wasLast = removeIsLast;
    try {
      await deleteMutation.mutateAsync(target.id);
      toast(
        wasLast ? t('admin.budgetMap.toast.unmapped', 'Category unmapped') : t('admin.budgetMap.toast.removed', 'Account removed'),
        wasLast ? categoryLabel(target.category) : `${categoryLabel(target.category)} · ${target.erpAccount}`,
        'success',
      );
      setRemoveTarget(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  const onPushConfirm = async () => {
    if (!pushTarget) return;
    const target = pushTarget;
    try {
      await pushMutation.mutateAsync(target.id);
      toast(
        t('admin.budgetMap.toast.pushSet', 'Push account changed'),
        `${categoryLabel(target.category)} → ${target.erpAccount}`,
        'success',
      );
      setPushTarget(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  if (isPending) {
    return (
      <div className="rounded-lg border border-border bg-card">
        <ListState variant="loading" rows={BUDGET_CATEGORIES.length} testId="budget-account-map-loading" />
      </div>
    );
  }

  if (isError) {
    return (
      <ListState
        variant="error"
        title={t('admin.budgetMap.error.title', "Couldn't load the account map")}
        sub={t('admin.loadErrorSub', 'The request failed. Check your connection and try again.')}
        retryLabel={t('admin.retry', 'Retry')}
        onRetry={() => refetch()}
      />
    );
  }

  return (
    // ⚑ I-8 — the budget projection's banner LINKS here (`/administration/accounting#budget-account-map`).
    <section
      id="budget-account-map"
      aria-label={t('admin.budgetMap.sectionLabel', 'Budget category to ERP account map')}
      ref={sectionRef}
      tabIndex={-1}
    >
      <h2 className="text-[15px] font-semibold tracking-[-0.01em]">
        {t('admin.budgetMap.title', 'Budget account map')}
      </h2>
      <p className="mt-1 text-[13px] text-muted-foreground">
        {t(
          'admin.budgetMap.description',
          'Every budget category must map to an ERP account before its amount can be pushed. An unmapped category blocks the push for the WHOLE budget, not just that line.',
        )}
      </p>
      <p className="mt-1 text-[13px] text-muted-foreground">
        {t(
          'admin.budgetMap.multiNote',
          'A category may list several accounts. Its actuals add up across all of them; its budget is pushed only to the account marked Budget push.',
        )}
      </p>
      {/* ⚑ AC-MOBILE-OVERFLOW-001 — below `sm` each row is a stacked card; from `sm` up an ordinary table. The
          account list wraps (`flex-wrap`, `break-words`), so long account names never push past 390px. */}
      <table className="mt-3.5 w-full border-collapse">
        <thead className="hidden sm:table-header-group">
          <tr>
            <th className="h-[38px] border-b border-border bg-card px-3 text-left text-[11.5px] font-semibold uppercase tracking-[0.03em] text-muted-foreground">
              {t('admin.budgetMap.columns.category', 'Category')}
            </th>
            <th className="h-[38px] border-b border-border bg-card px-3 text-left text-[11.5px] font-semibold uppercase tracking-[0.03em] text-muted-foreground">
              {t('admin.budgetMap.columns.erpAccount', 'ERP account')}
            </th>
            {canManage && (
              <th className="h-[38px] border-b border-border bg-card px-3 text-right text-[11.5px] font-semibold uppercase tracking-[0.03em] text-muted-foreground">
                {t('admin.budgetMap.columns.actions', 'Actions')}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {BUDGET_CATEGORIES.map((category) => {
            const accounts = accountsByCategory.get(category) ?? [];
            const hasPush = accounts.some((a) => a.isPushTarget);
            return (
              <tr key={category} className="block border-b border-border py-2 sm:table-row sm:py-0">
                <td className="block px-3 py-1 text-[13.5px] font-medium sm:table-cell sm:border-b sm:border-border sm:py-2 sm:align-top">
                  {categoryLabel(category)}
                </td>
                <td className="block px-3 py-1 text-[13.5px] sm:table-cell sm:border-b sm:border-border sm:py-2">
                  {accounts.length === 0 ? (
                    <StatusPill variant="warn">{t('admin.budgetMap.unmapped', 'Not mapped — blocks every push')}</StatusPill>
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {!hasPush && (
                        <li>
                          <StatusPill variant="warn">{t('admin.budgetMap.noPush', 'No push account — blocks every push')}</StatusPill>
                        </li>
                      )}
                      {accounts.map((account) => {
                        const removeBlocked = account.isPushTarget && accounts.length > 1;
                        return (
                          <li key={account.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="break-words">{account.erpAccount}</span>
                            {account.isPushTarget && (
                              <StatusPill variant="open">{t('admin.budgetMap.pushBadge', 'Budget push')}</StatusPill>
                            )}
                            {canManage && (
                              <span className="flex flex-wrap items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => { setSaveError(null); setFormTarget({ mode: 'edit', row: account }); }}
                                >
                                  {t('admin.budgetMap.editAccount', { defaultValue: 'Edit {{account}}', account: account.erpAccount })}
                                </Button>
                                {!account.isPushTarget && (
                                  <Button variant="ghost" size="sm" onClick={() => setPushTarget(account)}>
                                    {t('admin.budgetMap.usePush', { defaultValue: 'Use {{account}} for budget push', account: account.erpAccount })}
                                  </Button>
                                )}
                                {removeBlocked ? (
                                  <span className="text-[12px] text-muted-foreground">
                                    {t('admin.budgetMap.removePushHint', 'Make another account the push account to remove this one.')}
                                  </span>
                                ) : (
                                  <Button variant="ghost" size="sm" onClick={() => setRemoveTarget(account)}>
                                    {t('admin.budgetMap.removeAccount', { defaultValue: 'Remove {{account}}', account: account.erpAccount })}
                                  </Button>
                                )}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </td>
                {canManage && (
                  <td className="block px-3 py-1 text-right sm:table-cell sm:border-b sm:border-border sm:py-2 sm:align-top">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setSaveError(null); setFormTarget({ mode: 'create', category, isPushTarget: !hasPush }); }}
                    >
                      {accounts.length === 0
                        ? t('admin.budgetMap.map', { defaultValue: 'Map {{category}}', category: categoryLabel(category) })
                        : t('admin.budgetMap.addAccount', { defaultValue: 'Add account to {{category}}', category: categoryLabel(category) })}
                    </Button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      {formTarget && (
        <MapFormModal
          submitError={saveError}
          target={formTarget}
          hasAccounts={(accountsByCategory.get(formTarget.mode === 'edit' ? formTarget.row.category : formTarget.category)?.length ?? 0) > 0}
          allRows={rows}
          onClose={() => setFormTarget(null)}
          onSubmit={async (erpAccount) => {
            const target = formTarget;
            const category = target.mode === 'edit' ? target.row.category : target.category;
            try {
              if (target.mode === 'edit') {
                await updateMutation.mutateAsync({ id: target.row.id, erpAccount });
              } else {
                await createMutation.mutateAsync({ category: target.category, erpAccount, isPushTarget: target.isPushTarget });
              }
              toast(t('admin.budgetMap.toast.saved', 'Account map saved'), `${categoryLabel(category)} → ${erpAccount}`, 'success');
              setFormTarget(null);
            } catch (err) {
              const { headline, detail } = classifyMutationError(err);
              setSaveError({ headline, detail });
              toast(headline, detail, 'warning');
            }
          }}
        />
      )}

      <ConfirmDialog
        open={!!removeTarget}
        tone="destructive"
        title={
          !removeTarget
            ? t('admin.budgetMap.confirm.fallbackTitle', 'Unmap category?')
            : removeIsLast
              ? t('admin.budgetMap.confirm.title', { defaultValue: 'Unmap {{category}}?', category: categoryLabel(removeTarget.category) })
              : t('admin.budgetMap.confirmRemove.title', { defaultValue: 'Remove {{account}}?', account: removeTarget.erpAccount })
        }
        description={
          removeIsLast
            ? t('admin.budgetMap.confirm.description', 'The category will have no ERP account. Pushing a budget with a non-zero amount in this category will fail closed until it is mapped again.')
            : t('admin.budgetMap.confirmRemove.description', 'Actuals posted to this account will stop counting toward this category. The budget push is unchanged.')
        }
        confirmLabel={removeIsLast ? t('admin.budgetMap.confirm.confirm', 'Unmap') : t('admin.budgetMap.confirmRemove.confirm', 'Remove')}
        loading={deleteMutation.isPending}
        onConfirm={onRemoveConfirm}
        onCancel={() => setRemoveTarget(null)}
      />

      <ConfirmDialog
        open={!!pushTarget}
        title={
          pushTarget
            ? t('admin.budgetMap.confirmPush.title', {
              defaultValue: 'Push {{category}} to {{account}}?',
              category: categoryLabel(pushTarget.category),
              account: pushTarget.erpAccount,
            })
            : t('admin.budgetMap.confirmPush.fallbackTitle', 'Change push account?')
        }
        description={t(
          'admin.budgetMap.confirmPush.description',
          "Future budget pushes send this category's whole total to this account. A budget already in the ERP keeps its current account until it is pushed again.",
        )}
        confirmLabel={t('admin.budgetMap.confirmPush.confirm', 'Use for push')}
        loading={pushMutation.isPending}
        onConfirm={onPushConfirm}
        onCancel={() => setPushTarget(null)}
      />
    </section>
  );
};

// ── Add / rename account form ───────────────────────────────────────────────

interface MapFormModalProps {
  /** #559: owned by the parent (which owns the mutation), rendered here. */
  submitError: SubmitError | null;
  target: FormTarget;
  /** Does the category already list at least one account? (title: "Map X" vs "Add account to X") */
  hasAccounts: boolean;
  /** Every account row (for the client-side one-category-per-account pre-check). */
  allRows: CategoryAccountMapRow[];
  onClose: () => void;
  onSubmit: (erpAccount: string) => Promise<void>;
}

const MapFormModal: React.FC<MapFormModalProps> = ({ target, hasAccounts, allRows, submitError, onClose, onSubmit }) => {
  const { t } = useTranslation();
  const categoryLabel = (value: string) => value === 'Special expenses'
    ? t('budget.category.specialExpenses', 'Special expenses') : value;
  const isEdit = target.mode === 'edit';
  const category = target.mode === 'edit' ? target.row.category : target.category;
  const editingId = target.mode === 'edit' ? target.row.id : null;
  const isPushTarget = target.mode === 'edit' ? target.row.isPushTarget : target.isPushTarget;

  const validate = (v: FormValues): Partial<Record<keyof FormValues, string>> => {
    const errors: Partial<Record<keyof FormValues, string>> = {};
    const trimmed = v.erpAccount.trim();
    if (!trimmed) {
      errors.erpAccount = t('admin.budgetMap.form.required', 'An ERP account is required.');
      return errors;
    }
    // ⚑ FR-BAM-001 client-side pre-check: an account already listed (under ANY category, this row excepted) is
    // named here — the DB's unique(org, erp_account) re-asserts it regardless.
    const conflict = allRows.find((r) => r.erpAccount === trimmed && r.id !== editingId);
    if (conflict) {
      errors.erpAccount = t('admin.budgetMap.form.conflict', {
        defaultValue: '{{account}} is already mapped to {{category}}.',
        account: trimmed,
        category: categoryLabel(conflict.category),
      });
    }
    return errors;
  };

  const form = useEntityForm<FormValues>({
    initialValues: { erpAccount: target.mode === 'edit' ? target.row.erpAccount : '' },
    validate,
    idPrefix: 'budget-account-map-form',
    requiredFields: ['erpAccount'],
    module: 'budget-account-map',
  });

  const field = form.fieldProps('erpAccount');

  const errorSummary = form.errors.erpAccount
    ? [{ fieldId: field.id, message: form.errors.erpAccount }]
    : undefined;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (values) => {
      await onSubmit(values.erpAccount.trim());
    });
  };

  const title = isEdit
    ? t('admin.budgetMap.form.editTitle', { defaultValue: 'Edit {{category}} mapping', category: categoryLabel(category) })
    : hasAccounts
      ? t('admin.budgetMap.addAccount', { defaultValue: 'Add account to {{category}}', category: categoryLabel(category) })
      : t('admin.budgetMap.map', { defaultValue: 'Map {{category}}', category: categoryLabel(category) });

  const subtitle = !isPushTarget
    ? t('admin.budgetMap.form.readOnlySubtitle', 'Its actuals count toward this category; its budget is not pushed here')
    : isEdit
      ? t('admin.budgetMap.form.editSubtitle', 'Change the ERP account this category pushes to')
      : t('admin.budgetMap.form.createSubtitle', 'Choose the ERP account this category pushes to');

  return (
    <EntityFormModal
      open
      title={title}
      subtitle={subtitle}
      submitLabel={t('admin.budgetMap.form.save', 'Save mapping')}
      onSubmit={handleSubmit}
      submitError={submitError}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete}
      errorSummary={errorSummary}
    >
      <FormSection legend={t('admin.budgetMap.form.legend', 'Account')}>
        <FormGrid>
          <TextField
            id={field.id}
            label={t('admin.budgetMap.columns.erpAccount', 'ERP account')}
            required
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            error={field.error}
            placeholder={t('admin.budgetMap.form.placeholder', 'e.g. 5100 - Direct Costs')}
            fullWidth
          />
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};

export default BudgetAccountMap;
```

Verify GREEN: Task 14 command → all pass; `cd "$WT/pmo-portal" && npm run typecheck` → 0 errors.

### Task 17 — Bahasa + Administration a11y suites follow the per-account actions (3 min)
`pmo-portal/pages/admin/BudgetAccountMap.bahasa.test.tsx`:
- line 22: add `setBudgetPushAccount: vi.fn(),` to the mock factory.
- lines 52, 61, 87, 100: `[{ category: 'Labor', erpAccount: '5100 - Direct Costs' }]` →
  `[{ id: 'm-labor', category: 'Labor', erpAccount: '5100 - Direct Costs', isPushTarget: true }]`.
- line 74: `'Edit Labor'` → `'Edit 5100 - Direct Costs'`.
- lines 76 and 102: `'Hapus pemetaan Labor'` (the button) → `'Hapus 5100 - Direct Costs'`. The confirm title on
  line 103 stays `'Hapus pemetaan Labor?'`, because removing the last account unmaps the category.

`pmo-portal/pages/__tests__/Administration.a11y.test.tsx` line 88: add `setBudgetPushAccount: vi.fn(),` after
`deleteBudgetCategoryAccountMapRow: vi.fn(),`.

Verify: `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run pages/admin/ pages/__tests__/Administration.a11y.test.tsx pages/BudgetProjection.test.tsx src/components/integrations/`
→ all pass.

### Task 18 — e2e helper: delete-then-insert seeding with a read-only Labor sibling (4 min)
In `pmo-portal/e2e/serial/_budHelpers.ts`:
- after line 35 add:
```ts
/** #768: a second, READ-ONLY Labor account. It must never appear in a pushed ERP Budget — AC-BUD-030's exact
 *  `accounts[]` equality proves that against the real bench on every run. Not used by `seed.sql`. */
export const LABOR_SIBLING_ACCOUNT = 'Travel Expenses - PSC';
```
- line 13 comment: `The Admin-administered \`budget_category_account_map\` bijection (FR-BUD-111)` →
  `The Admin-administered \`budget_category_account_map\` (FR-BUD-111, #768: several accounts, one push)`.
- line 140: `categoryMap: Array<{ org_id: string; category: string; erp_account: string }>;` →
  `categoryMap: Array<{ org_id: string; category: string; erp_account: string; is_push_target: boolean }>;`
- replace lines 250–261 with:
```ts
  // THE CRUX (FR-BUD-110..113, #768). 0246 replaced unique(org_id, category) with a partial push index, which a
  // PostgREST upsert cannot target — so: snapshot every Labor/Materials row as found, clear them, insert ours.
  const { data: priorMapRows, error: priorMapErr } = await admin
    .from('budget_category_account_map').select('org_id, category, erp_account, is_push_target')
    .eq('org_id', ORG_ID).in('category', ['Labor', 'Materials']);
  if (priorMapErr) throw new Error(`read budget_category_account_map failed: ${priorMapErr.message}`);
  const { error: clearErr } = await admin
    .from('budget_category_account_map').delete().eq('org_id', ORG_ID).in('category', ['Labor', 'Materials']);
  if (clearErr) throw new Error(`clear budget_category_account_map failed: ${clearErr.message}`);
  const { error: mapErr } = await admin.from('budget_category_account_map').insert([
    { org_id: ORG_ID, category: 'Labor', erp_account: LABOR_ACCOUNT, is_push_target: true },
    { org_id: ORG_ID, category: 'Labor', erp_account: LABOR_SIBLING_ACCOUNT, is_push_target: false },
    { org_id: ORG_ID, category: 'Materials', erp_account: MATERIALS_ACCOUNT, is_push_target: true },
  ]);
  if (mapErr) throw new Error(`seed budget_category_account_map failed: ${mapErr.message}`);
```
- line 270: the cast type → `Array<{ org_id: string; category: string; erp_account: string; is_push_target: boolean }>`.
- replace lines 391–400 with:
```ts
  // Put back exactly what was found: clear every Labor/Materials row this run wrote, re-insert the prior rows.
  const priorMap = seed.prior?.categoryMap ?? [];
  await admin.from('budget_category_account_map').delete().eq('org_id', ORG_ID).in('category', ['Labor', 'Materials']);
  if (priorMap.length > 0) {
    await admin.from('budget_category_account_map').insert(priorMap);
  }
```
Verify: `cd "$WT/pmo-portal" && npm run typecheck && npx eslint --max-warnings=0 e2e/serial/_budHelpers.ts` → clean.

### Task 19 — e2e: the live push leaves the read-only account out; the accounting page still passes (5 min)
Requires the local ERPNext bench (budget lane), and the reset is needed (migration + seed changed). Lock order is
`erpnext → db`:
`cd "$WT" && scripts/with-erpnext-lock.sh scripts/e2e-local.sh --reset AC-BUD-030 AC-BFY-011 AC-ADMIA-001 AC-ADMIA-005 AC-RAM-004`
→ all pass. AC-BUD-030's `expect(pairs).toEqual([[LABOR_ACCOUNT, 50000], [MATERIALS_ACCOUNT, 25000]].sort())`
is the cross-stack proof of AC-BAM-003, because `LABOR_SIBLING_ACCOUNT` is now in the map. If the bench is
unavailable, record that and let CI's `integration` job (PR→`main`) decide. Never skip the spec.

### Task 20 — Docs: point FR-BUD-111 at its successor (2 min)
In `docs/specs/erpnext-adapter-p3c-budget.spec.md`, after line 491 (the end of the FR-BUD-111 bullet list), add:
```markdown
  - **Superseded in part by #768 (2026-10-06, `docs/specs/budget-account-map-multi.spec.md`, mig `0246`):** a
    category may now map to several accounts. Exactly one is the **push** account (partial unique index), and
    actuals sum across all of them. `unique (org_id, erp_account)` and its rationale above are unchanged.
```
Verify: `grep -n "Superseded in part by #768" /Users/ariefsaid/Coding/PMO/.claude/worktrees/768-budget-account-map/docs/specs/erpnext-adapter-p3c-budget.spec.md` → one hit.

### Task 21 — Mutation battery (Director, 5 min)
Apply each mutation alone, run the named test, and confirm it goes **red**. Then revert.

| # | Mutation | Must go red |
|---|---|---|
| M1 | `dispatchFactory.ts`: delete `.eq('is_push_target', true)` | `dispatchFactory.budget.test.ts` AC-BAM-003 |
| M2 | `categoryAccountMap.ts`: delete the `if (ambiguous.length > 0) throw …` | `categoryAccountMap.test.ts` AC-BAM-006 |
| M3 | `0246`: drop `where is_push_target` from the index | `budget_account_map_multi.test.sql` AC-BAM-001 (index assert + Labor read-only insert) |
| M4 | `0246`: delete the first `update … set is_push_target = false` in the function | `budget_account_map_multi.test.sql` AC-BAM-004 (23505 on the second update) |
| M5 | `0246`: delete the `if not found then raise` block | `budget_account_map_multi.test.sql` AC-BAM-004 Finance 42501 |
| M6 | `setup.ts`: drop `row.is_push_target === true &&` | `setup.test.ts` AC-BAM-007 |
| M7 | `setup.ts`: drop the `new Set(...)` wrapper | `setup.test.ts` AC-BAM-007 |
| M8 | `BudgetAccountMap.tsx`: `isPushTarget: !hasPush` → `isPushTarget: true` | `BudgetAccountMap.test.tsx` AC-BAM-009 (read-only add) |
| M9 | `BudgetAccountMap.tsx`: `removeBlocked ? …` → always render Remove | `BudgetAccountMap.test.tsx` AC-BAM-011 |

The DB mutations (M3–M5) need `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/budget_account_map_multi.test.sql'`
after each edit. Record each red in the PR body.

### Task 22 — Local final gate (5 min)
```
cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh bash -c 'npm run typecheck && npx vitest run --changed origin/dev'
cd "$WT/pmo-portal" && npx eslint --max-warnings=0 pages/admin/BudgetAccountMap.tsx pages/admin/BudgetAccountMap.test.tsx pages/admin/BudgetAccountMap.bahasa.test.tsx pages/__tests__/Administration.a11y.test.tsx src/lib/repositories/budgetProjection.ts src/lib/repositories/budgetProjection.test.ts src/lib/budget/categoryAccountMap.ts src/lib/budget/categoryAccountMap.test.ts src/lib/adapterSeam/erpnext/dispatchFactory.ts src/lib/adapterSeam/erpnext/dispatchFactory.budget.test.ts e2e/serial/_budHelpers.ts
cd "$WT/supabase/functions/external-set-company" && deno test --allow-all
cd "$WT/supabase/functions/adapter-dispatch" && deno test --allow-all
cd "$WT/supabase/functions/erpnext-sweep" && deno test --allow-all
cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/budget_account_map_multi.test.sql supabase/tests/budget_category_account_map_rls.test.sql supabase/tests/0229_special_expenses.test.sql supabase/tests/budget_projection_rpc.test.sql supabase/tests/bfy_unmapped_category_null.test.sql supabase/tests/bfy_map_edit_reinterprets_history.test.sql supabase/tests/0178_anon_executable_definers.test.sql'
```
All green. Then the rendered Discover pass (design-reviewer) on the seeded Accounting page, where Labor shows
two accounts. Then the 3 reviewers. PR to `dev`.

**Release note for the ship step (back to front, each prod step owner-gated):** DB `0246` → edge fns
`adapter-dispatch`, `erpnext-sweep`, `external-set-company` → FE.

## 4. Traceability

| AC | Owning test | Task |
|---|---|---|
| AC-BAM-001 | `supabase/tests/budget_account_map_multi.test.sql` | 1–3 |
| AC-BAM-002 | `supabase/tests/budget_account_map_multi.test.sql` | 1–2 |
| AC-BAM-003 | `pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.budget.test.ts` (e2e reference: `AC-BUD-030` via `_budHelpers.ts`) | 8–9, 18–19 |
| AC-BAM-004 | `supabase/tests/budget_account_map_multi.test.sql` (+ repository wiring in `budgetProjection.test.ts`) | 1–2, 12–13 |
| AC-BAM-005 | `pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.budget.test.ts` | 8–9 |
| AC-BAM-006 | `pmo-portal/src/lib/budget/categoryAccountMap.test.ts` | 6–7 |
| AC-BAM-007 | `supabase/functions/external-set-company/setup.test.ts` | 10–11 |
| AC-BAM-008 | `pmo-portal/pages/admin/BudgetAccountMap.test.tsx` | 14–16 |
| AC-BAM-009 | `pmo-portal/pages/admin/BudgetAccountMap.test.tsx` | 14–16 |
| AC-BAM-010 | `pmo-portal/pages/admin/BudgetAccountMap.test.tsx` | 14–16 |
| AC-BAM-011 | `pmo-portal/pages/admin/BudgetAccountMap.test.tsx` | 14–16 |
| (AC-BUD-010, superseded half) | `supabase/tests/budget_category_account_map_rls.test.sql` | 3 |
