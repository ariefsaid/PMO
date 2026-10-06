# Plan: `pmo load` — a client's starting data without the Director (#796)

> **Spec:** [`docs/specs/client-starting-data-cli.spec.md`](../specs/client-starting-data-cli.spec.md) ·
> **ADR:** [ADR-0074](../adr/0074-api-client-admin-load-tier.md) · **Date:** 2026-10-06
> **Executor:** Director-dispatched (auth surface + money RPCs — not the ADW tier). Mutation checks in Task 17 are mandatory.

## 0. Preconditions (Director, before dispatch)

1. #770 is merged to `dev` (the load passes `service_line`, `sector`, `location`, `award_type`,
   `bidding_entity` to the `projects` insert; without #770's migration (0234) PostgREST answers `PGRST204`).
2. Worktree off `origin/dev`, feature branch `codex/796-pmo-load`. All commands below run from the
   worktree root unless a `cd` is shown.
3. Migration number: `ls supabase/migrations | tail -3`. This plan uses `0239`. If `0239` is taken, or
   `0238` lands after this branch, renumber with `scripts/renumber-migration.sh <old> <new>` and update the
   two references in Task 2's header comment and the rollback file name.
4. No type regeneration: `0239` replaces a function body only; no table, column or RPC signature changes.

## 1. Design summary

- `scripts/lib/pmo-load.mjs` (new): pure validation, a read-only **resolve** phase that returns
  `{ problems, plan }`, and an **apply** phase that writes the plan in order (or lists it, `dryRun`).
- `scripts/pmo.mjs`: new `load` verb (validate → active-Admin check → resolve → apply), the load-tier
  constants, `external_domain_ownership` as a read-only table, refusals pointing to `pmo load`.
- `supabase/migrations/0239_api_client_seed_surface.sql`: the guard's active-Admin tier (ADR-0074).
- Writes reuse shipped paths only: RLS inserts (`companies`, `projects`, `budget_versions`,
  `budget_line_items`) and the definer RPCs `set_project_contract_value`, `transition_project`.

### Type contract (shared by Tasks 6–15)

```
LoadApi = {
  get(table: string, q: URLSearchParams): Promise<object[]>
  post(table: string, body: object): Promise<object[]>        // return=representation
  patch(table: string, q: URLSearchParams, body: object): Promise<object[]>
  rpc(name: string, body: object): Promise<unknown>
}
resolveLoad(doc, api: LoadApi) -> Promise<{ problems: string[], plan: Plan }>
Plan = { erpOwnsCompanies: boolean, companies: CompanyEntry[], projects: ProjectEntry[] }
CompanyEntry = { name, id: string|null, action: 'create'|'skip'|'set_short_name'|'short_name_differs'|'existing',
                 short_name: string|null, current_short_name?: string|null }
ProjectEntry = { key, input, client: CompanyEntry, endClient: CompanyEntry|null, existing: object|null,
                 id: string|null, pmo_project_number: string|null, path: string[]|null,
                 value: 'none'|'set'|'same'|'differs', budget: BudgetEntry|null }
BudgetEntry = { state: 'new'|'attach'|'skip', versionId: string|null, lines: Line[], reason?: string }
applyLoad(plan, api, { dryRun: boolean, batchId?: string, importedAt?: string }) -> Promise<Action[]>
  // on a refusal it throws the server's error with err.loadReport = { done: Action[], failed: Action }
Action = { kind: 'company.create'|'company.skip'|'company.set_short_name'|'company.short_name_differs'|
           'project.create'|'project.skip'|'project.diverged'|'project.contract_value'|
           'project.contract_value_differs'|'project.transition'|'budget.version'|'budget.lines'|'budget.skip', ... }
```

## 2. Tasks

### Task 1 — failing pgTAP for the guard's Admin tier (AC-CSD-013)

Create `supabase/tests/api_client_seed_surface.test.sql`:

```sql
-- api_client_seed_surface.test.sql — the active-Admin tier of the OAuth API-client guard (#796, ADR-0074).
-- Migration 0239: a token carrying `client_id` may POST set_project_contract_value / transition_project and
-- GET/POST budget_versions / budget_line_items ONLY when its user is an active Admin; any such token may
-- GET external_domain_ownership. Everything else stays as 0222 left it (42501).
-- Mutation check (Task 17): make the Admin conditional `if true` and the four non-Admin rows must go red.
begin;
select plan(16);

insert into auth.users (id, email) values
  ('07960000-0000-0000-0000-0000000000a1', 'load-admin@example.com'),
  ('07960000-0000-0000-0000-0000000000a2', 'load-pm@example.com'),
  ('07960000-0000-0000-0000-0000000000a3', 'load-gone@example.com');
insert into public.profiles (id, org_id, full_name, email, role, status) values
  ('07960000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'Load Admin', 'load-admin@example.com', 'Admin', 'active'),
  ('07960000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000001', 'Load PM', 'load-pm@example.com', 'Project Manager', 'active'),
  ('07960000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000001', 'Load Gone', 'load-gone@example.com', 'Admin', 'disabled');

create or replace function pg_temp.req(p_sub text, p_method text, p_path text)
returns void language sql as $$
  select set_config('request.jwt.claims',
           json_build_object('sub', p_sub, 'role', 'authenticated', 'client_id', 'c1')::text, true),
         set_config('request.method', p_method, true),
         set_config('request.path', p_path, true),
         set_config('request.headers', '{}', true);
$$;

set local role authenticated;

-- active Admin: the load tier is open
select pg_temp.req('07960000-0000-0000-0000-0000000000a1', 'POST', '/rpc/set_project_contract_value');
select lives_ok('select public.api_client_request_guard()', 'AC-CSD-013 active Admin client: POST set_project_contract_value');
select pg_temp.req('07960000-0000-0000-0000-0000000000a1', 'POST', '/rpc/transition_project');
select lives_ok('select public.api_client_request_guard()', 'AC-CSD-013 active Admin client: POST transition_project');
select pg_temp.req('07960000-0000-0000-0000-0000000000a1', 'GET', '/budget_versions');
select lives_ok('select public.api_client_request_guard()', 'AC-CSD-013 active Admin client: GET budget_versions');
select pg_temp.req('07960000-0000-0000-0000-0000000000a1', 'POST', '/budget_versions');
select lives_ok('select public.api_client_request_guard()', 'AC-CSD-013 active Admin client: POST budget_versions');
select pg_temp.req('07960000-0000-0000-0000-0000000000a1', 'POST', '/budget_line_items');
select lives_ok('select public.api_client_request_guard()', 'AC-CSD-013 active Admin client: POST budget_line_items');

-- active Admin: still closed
select pg_temp.req('07960000-0000-0000-0000-0000000000a1', 'PATCH', '/budget_line_items');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-CSD-013 Admin client: PATCH budget_line_items refused');
select pg_temp.req('07960000-0000-0000-0000-0000000000a1', 'DELETE', '/budget_versions');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-CSD-013 Admin client: DELETE budget_versions refused');
select pg_temp.req('07960000-0000-0000-0000-0000000000a1', 'POST', '/rpc/activate_budget_version');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-CSD-013 Admin client: budget activation stays in the app');
select pg_temp.req('07960000-0000-0000-0000-0000000000a1', 'POST', '/rpc/set_work_order_value');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-CSD-013 Admin client: work orders stay in the app');

-- not an active Admin: refused
select pg_temp.req('07960000-0000-0000-0000-0000000000a2', 'POST', '/rpc/transition_project');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-CSD-013 Project Manager client: transition_project refused');
select pg_temp.req('07960000-0000-0000-0000-0000000000a2', 'POST', '/budget_versions');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-CSD-013 Project Manager client: POST budget_versions refused');
select pg_temp.req('07960000-0000-0000-0000-0000000000a3', 'POST', '/rpc/set_project_contract_value');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-CSD-013 disabled Admin client: set_project_contract_value refused');
select pg_temp.req('07960000-0000-0000-0000-0000000000a3', 'GET', '/budget_line_items');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-CSD-013 disabled Admin client: GET budget_line_items refused');

-- any client: read which external system owns which domain, never write it
select pg_temp.req('07960000-0000-0000-0000-0000000000a2', 'GET', '/external_domain_ownership');
select lives_ok('select public.api_client_request_guard()', 'AC-CSD-013 any client: GET external_domain_ownership');
select pg_temp.req('07960000-0000-0000-0000-0000000000a2', 'POST', '/external_domain_ownership');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-CSD-013 any client: POST external_domain_ownership refused');

-- the 0222 surface is unchanged
select pg_temp.req('07960000-0000-0000-0000-0000000000a2', 'POST', '/projects');
select lives_ok('select public.api_client_request_guard()', 'AC-CSD-013 the generic surface still works for a non-Admin client');

reset role;
select * from finish();
rollback;
```

**Verify (expect RED — the Admin lives_ok rows and external_domain_ownership fail):**
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/api_client_seed_surface.test.sql'`

### Task 2 — migration `0239` + rollback (AC-CSD-013 green)

Create `supabase/migrations/0239_api_client_seed_surface.sql`:

```sql
-- 0239_api_client_seed_surface.sql — an active-Admin tier in the OAuth API-client guard for `pmo load`
-- (#796, ADR-0074, spec docs/specs/client-starting-data-cli.spec.md). Amends 0222.
--
-- OD-SEED-5 lets the owner load a client's won projects at their real stage, with contract value, and
-- draft budgets, without the Director. Every write that needs already exists and is enforced in the
-- database (RLS inserts; set_project_contract_value / transition_project with their org, role, SoD and
-- audit rules; the 0176 Draft-only trigger; the 0195 import-key index). This only widens WHICH
-- ENDPOINTS a token with `client_id` may reach:
--   • for an ACTIVE ADMIN only: POST /rpc/set_project_contract_value, POST /rpc/transition_project,
--     GET/POST budget_versions and budget_line_items;
--   • for every such token: GET external_domain_ownership (read-only).
-- Still refused to every client, Admin included: PATCH/DELETE on the budget tables,
-- activate_budget_version, work-order and money RPCs. Browser sessions (no client_id) are untouched.
--
-- The Admin test reads the caller's LIVE profile, so a demoted or offboarded owner loses the tier at the
-- next request. It runs only for the tier's own endpoints (nested IF: no lookup on any other request).
--
-- Lists mirrored by scripts/pmo.mjs (ALLOWED_TABLES / READ_ONLY_TABLES / ALLOWED_RPCS / LOAD_TABLES /
-- LOAD_RPCS); scripts/pmo.test.mjs (AC-CLI-015, AC-CSD-014) fails if they drift.
-- Proof: supabase/tests/api_client_seed_surface.test.sql (AC-CSD-013) + api_client_request_guard.test.sql.
-- Rollback (staged, not automatic): supabase/migrations/rollback/0239_api_client_seed_surface_down.sql

create or replace function public.api_client_request_guard()
  returns void
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  -- API CLIENT SURFACE — keep in step with scripts/pmo.mjs.
  write_tables constant text[] := array['projects', 'project_milestones', 'tasks', 'meetings', 'crm_activities', 'companies', 'contacts'];
  read_only_tables constant text[] := array['profiles', 'external_domain_ownership'];
  rpcs constant text[] := array['get_project_milestones'];
  -- ACTIVE-ADMIN TIER (`pmo load`, #796) — keep in step with scripts/pmo.mjs LOAD_TABLES / LOAD_RPCS.
  admin_write_tables constant text[] := array['budget_versions', 'budget_line_items'];
  admin_rpcs constant text[] := array['set_project_contract_value', 'transition_project'];
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  headers jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  method text := current_setting('request.method', true);
  path text := coalesce(current_setting('request.path', true), '');
  target text;
begin
  if claims is null or not (claims ? 'client_id') then
    return; -- not an OAuth API client: nothing to decide here
  end if;

  if coalesce(headers ->> 'accept-profile', 'public') <> 'public'
     or coalesce(headers ->> 'content-profile', 'public') <> 'public' then
    raise exception using errcode = '42501',
      message = 'OAuth API clients may use the public schema only';
  end if;

  if path like '/rpc/%' then
    target := substr(path, 6);
    if method = 'POST' and target = any (rpcs) then
      return;
    end if;
    if method = 'POST' and target = any (admin_rpcs) then
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then
        return;
      end if;
    end if;
  else
    target := substr(path, 2); -- exact table name; anything longer matches no list entry
    if method = 'GET' and (target = any (write_tables) or target = any (read_only_tables)) then
      return;
    end if;
    if method in ('POST', 'PATCH') and target = any (write_tables) then
      return;
    end if;
    if method in ('GET', 'POST') and target = any (admin_write_tables) then
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then
        return;
      end if;
    end if;
  end if;

  raise exception using errcode = '42501',
    message = format('%s %s is not available to OAuth API clients', method, path),
    hint = 'The API client surface is documented in docs/runbooks/pmo-cli.md';
end;
$$;

comment on function public.api_client_request_guard() is
  'PostgREST pre-request: limits tokens carrying a client_id claim (OAuth API clients) to the documented API surface (#728, DD-API-3), plus an active-Admin tier for pmo load (#796, ADR-0074). Other requests pass through.';

-- Grants unchanged from 0222 (create or replace keeps them); restated so this file is self-describing.
revoke all on function public.api_client_request_guard() from public;
grant execute on function public.api_client_request_guard() to anon, authenticated, service_role;

notify pgrst, 'reload config';
```

Create `supabase/migrations/rollback/0239_api_client_seed_surface_down.sql` (restores 0222's body):

```sql
-- Reverses 0239: restores 0222's api_client_request_guard() (no Admin tier, profiles-only read list).
create or replace function public.api_client_request_guard()
  returns void
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  write_tables constant text[] := array['projects', 'project_milestones', 'tasks', 'meetings', 'crm_activities', 'companies', 'contacts'];
  read_only_tables constant text[] := array['profiles'];
  rpcs constant text[] := array['get_project_milestones'];
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  headers jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  method text := current_setting('request.method', true);
  path text := coalesce(current_setting('request.path', true), '');
  target text;
begin
  if claims is null or not (claims ? 'client_id') then
    return;
  end if;
  if coalesce(headers ->> 'accept-profile', 'public') <> 'public'
     or coalesce(headers ->> 'content-profile', 'public') <> 'public' then
    raise exception using errcode = '42501',
      message = 'OAuth API clients may use the public schema only';
  end if;
  if path like '/rpc/%' then
    target := substr(path, 6);
    if method = 'POST' and target = any (rpcs) then
      return;
    end if;
  else
    target := substr(path, 2);
    if method = 'GET' and (target = any (write_tables) or target = any (read_only_tables)) then
      return;
    end if;
    if method in ('POST', 'PATCH') and target = any (write_tables) then
      return;
    end if;
  end if;
  raise exception using errcode = '42501',
    message = format('%s %s is not available to OAuth API clients', method, path),
    hint = 'The API client surface is documented in docs/runbooks/pmo-cli.md';
end;
$$;
comment on function public.api_client_request_guard() is
  'PostgREST pre-request: limits tokens carrying a client_id claim (OAuth API clients) to the documented API surface (#728, DD-API-3). Other requests pass through.';
notify pgrst, 'reload config';
```

**Verify (GREEN, both guard files — the 0222 file needs no change: its client tokens carry no `sub`, so the tier stays closed to them):**
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/api_client_seed_surface.test.sql supabase/tests/api_client_request_guard.test.sql'`

### Task 3 — pgTAP: the load's RPC sequence in the database (AC-CSD-015)

Create `supabase/tests/client_starting_data_sequence.test.sql`:

```sql
-- client_starting_data_sequence.test.sql — the exact calls `pmo load` makes for a won project
-- (scripts/lib/pmo-load.mjs applyLoad), run as an active Admin (#796, AC-CSD-015). Pins that the load
-- lands at the real stage through the shipped RPCs, with every step audited to the Admin.
begin;
select plan(9);

insert into auth.users (id, email) values ('07960000-0000-0000-0000-0000000000b1', 'seq-admin@example.com');
insert into public.profiles (id, org_id, full_name, email, role, status) values
  ('07960000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000001', 'Seq Admin', 'seq-admin@example.com', 'Admin', 'active');
insert into public.companies (id, org_id, name, type) values
  ('07960000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000001', 'Sequence Client Co', 'Client');

set local role authenticated;
set local request.jwt.claims = '{"sub":"07960000-0000-0000-0000-0000000000b1","role":"authenticated"}';

insert into public.projects (id, code, name, status, client_id)
  values ('07960000-0000-0000-0000-0000000000d1', 'SEQ-001', 'Sequence project', 'Leads', '07960000-0000-0000-0000-0000000000c1');
select lives_ok($$ select public.set_project_contract_value('07960000-0000-0000-0000-0000000000d1', 1000000, 'exclusive', 110000) $$,
  'AC-CSD-015 an Admin sets the contract value of a Lead');
select lives_ok($$ select public.transition_project('07960000-0000-0000-0000-0000000000d1', 'PQ Submitted') $$,
  'AC-CSD-015 Leads -> PQ Submitted');
select lives_ok($$ select public.transition_project('07960000-0000-0000-0000-0000000000d1', 'Quotation Submitted') $$,
  'AC-CSD-015 PQ Submitted -> Quotation Submitted');
select lives_ok($$ select public.transition_project('07960000-0000-0000-0000-0000000000d1', 'Won, Pending KoM', 'PO-SEQ-1', '2025-02-01') $$,
  'AC-CSD-015 the Admin wins it (holds won-value authority: no second person needed)');
select lives_ok($$ select public.transition_project('07960000-0000-0000-0000-0000000000d1', 'Ongoing Project') $$,
  'AC-CSD-015 Won, Pending KoM -> Ongoing Project');

reset role;
select results_eq(
  $$ select status::text, contract_value, customer_contract_ref, contract_date, decided_at::date
       from public.projects where id = '07960000-0000-0000-0000-0000000000d1' $$,
  $$ values ('Ongoing Project'::text, 1000000::numeric, 'PO-SEQ-1'::text, '2025-02-01'::date, '2025-02-01'::date) $$,
  'AC-CSD-015 the project stands at its real stage with its value and win artifacts (decided on the contract date)');
select is(
  (select count(*)::int from public.audit_events
    where entity_id = '07960000-0000-0000-0000-0000000000d1' and action = 'project.create'
      and actor_id = '07960000-0000-0000-0000-0000000000b1'),
  1, 'AC-CSD-015 the create is audited to the Admin');
select is(
  (select count(*)::int from public.audit_events
    where entity_id = '07960000-0000-0000-0000-0000000000d1' and action = 'project.contract_value.set'
      and actor_id = '07960000-0000-0000-0000-0000000000b1'),
  1, 'AC-CSD-015 the value is audited to the Admin');
select is(
  (select array_agg((detail ->> 'from') || '->' || (detail ->> 'to') order by 1)
     from public.audit_events
    where entity_id = '07960000-0000-0000-0000-0000000000d1' and action = 'project.transition'
      and actor_id = '07960000-0000-0000-0000-0000000000b1'),
  array['Leads->PQ Submitted', 'PQ Submitted->Quotation Submitted',
        'Quotation Submitted->Won, Pending KoM', 'Won, Pending KoM->Ongoing Project'],
  'AC-CSD-015 every stage step is audited to the Admin');

select * from finish();
rollback;
```

This pins shipped behaviour, so it is green on first run. **Oracle check (must go red, then restore):**
change the claims `sub` to a Project Manager fixture (add one) — the win step must fail on the money SoD
(self-authored value) and the `results_eq` row must go red.

**Verify:** `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/client_starting_data_sequence.test.sql'`

### Task 4 — failing CLI-surface tests (AC-CSD-014 lists, AC-CSD-016, AC-CLI-015 refactor)

In `scripts/pmo.test.mjs`:

1. Add `LOAD_RPCS, LOAD_TABLES,` to the import list from `./pmo.mjs`.
2. Replace the whole `AC-CLI-015` test (the one that reads `write_tables` / `read_only_tables` / `rpcs`)
   with a shared helper plus two tests:

```js
/** One list from the LATEST migration that defines public.api_client_request_guard() (AC-CLI-015, AC-CSD-014). */
function guardList(name) {
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'supabase', 'migrations');
  const latest = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => /function public\.api_client_request_guard\(\)/.test(fs.readFileSync(path.join(dir, f), 'utf8')))
    .pop();
  assert.ok(latest, 'a migration defines public.api_client_request_guard()');
  const sql = fs.readFileSync(path.join(dir, latest), 'utf8');
  const m = sql.match(new RegExp(`(?<![a-z_])${name}\\s+constant\\s+text\\[\\]\\s*:=\\s*array\\[([^\\]]*)\\]`));
  assert.ok(m, `${name} is declared in ${latest}`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
}

test('AC-CLI-015: the CLI allow-lists match the database guard (latest migration defining api_client_request_guard)', () => {
  assert.deepEqual(guardList('write_tables'), [...ALLOWED_TABLES].sort());
  assert.deepEqual(guardList('read_only_tables'), Object.keys(READ_ONLY_TABLES).sort());
  assert.deepEqual(guardList('rpcs'), [...ALLOWED_RPCS].sort());
});

test('AC-CSD-014: the CLI load tier matches the guard admin tier', () => {
  assert.deepEqual(guardList('admin_write_tables'), [...LOAD_TABLES].sort());
  assert.deepEqual(guardList('admin_rpcs'), [...LOAD_RPCS].sort());
  assert.deepEqual(READ_ONLY_TABLES.external_domain_ownership, ['domain', 'external_tier']);
});
```

3. Append:

```js
test('AC-CSD-016: get/create/rpc refuse the load tier before any request and point to pmo load', async () => {
  const fake = await fakeSupabase();
  const configDir = tmpDir();
  try {
    seedCredentials(configDir, fake.url);
    for (const argv of [
      ['rpc', 'transition_project', '{}'],
      ['rpc', 'set_project_contract_value', '{}'],
      ['create', 'budget_versions', '{}'],
      ['get', 'budget_line_items'],
    ]) {
      const r = await runCli([...argv, '--url', fake.url], { configDir });
      assert.equal(r.code, 2, argv.join(' '));
      assert.match(r.errJson.error.message, /not available/i);
      assert.match(r.errJson.error.message, /pmo load/);
    }
    assert.equal(fake.requests.length, 0);
  } finally {
    await fake.close();
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});
```

**Verify (RED: the import of `LOAD_RPCS`/`LOAD_TABLES` fails):** `node --test scripts/pmo.test.mjs`

### Task 5 — CLI-surface constants and refusals (green for Task 4)

In `scripts/pmo.mjs`:

1. Replace the `READ_ONLY_TABLES` declaration:

```js
export const READ_ONLY_TABLES = Object.freeze({
  profiles: Object.freeze(['id', 'full_name', 'role', 'title', 'status']),
  // #796: `pmo load` reads whether ERPNext owns companies — the rows the app shows on Integrations.
  external_domain_ownership: Object.freeze(['domain', 'external_tier']),
});
```

2. After `export const ALLOWED_RPCS = …;` add:

```js
/**
 * The ACTIVE-ADMIN tier (#796, ADR-0074), used only by `pmo load` — never by get/create/update/rpc.
 * The database guard (migration 0239) allows these only to an active Admin's OAuth token: POST on the
 * RPCs, GET/POST on the tables. The RPCs keep their own org, role, SoD and audit rules.
 */
export const LOAD_RPCS = Object.freeze(['set_project_contract_value', 'transition_project']);
export const LOAD_TABLES = Object.freeze(['budget_versions', 'budget_line_items']);
```

3. Replace `assertTable` and `assertRpc`:

```js
function assertTable(table, mode) {
  if (Object.hasOwn(READ_ONLY_TABLES, table)) {
    if (mode === 'read') return;
    throw usage(`${table} is read-only from the CLI. Change it in the app.`);
  }
  if (LOAD_TABLES.includes(table)) {
    throw usage(`Table '${table}' is not available to get/create/update; only \`pmo load\` writes it (draft budgets). Change budgets in the app.`);
  }
  if (!ALLOWED_TABLES.includes(table)) {
    throw usage(
      `Table '${table}' is not available from the CLI. Available: ${ALLOWED_TABLES.join(', ')}; read-only: ${Object.keys(READ_ONLY_TABLES).join(', ')}`,
    );
  }
}

function assertRpc(name) {
  if (LOAD_RPCS.includes(name)) {
    throw usage(`RPC '${name}' is not available to \`pmo rpc\`; only \`pmo load\` uses it. Move stages and set contract values in the app.`);
  }
  if (!ALLOWED_RPCS.includes(name)) {
    throw usage(`RPC '${name}' is not available from the CLI. Available: ${ALLOWED_RPCS.join(', ')}`);
  }
}
```

**Verify (GREEN; AC-CLI-009/014 unchanged and still green):** `node --test scripts/pmo.test.mjs`

### Task 6 — failing validation + path tests (AC-CSD-002, AC-CSD-009 pure, AC-CSD-014 paths)

Create `scripts/pmo-load.test.mjs`:

```js
/**
 * pmo-load.test.mjs — `pmo load` planner/executor (#796). Run: node --test scripts/pmo-load.test.mjs
 * A fake LoadApi (no HTTP, no DB). The database half is pgTAP: api_client_seed_surface.test.sql
 * (AC-CSD-013) and client_starting_data_sequence.test.sql (AC-CSD-015).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { LOAD_STAGE_PATHS, remainingPath, validateLoadFile } from './lib/pmo-load.mjs';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');

test('AC-CSD-002: validateLoadFile names every problem, row by row', () => {
  assert.deepEqual(validateLoadFile([]), ['The load file must be a JSON object with a "companies" list and/or a "projects" list']);
  const problems = validateLoadFile({
    companies: [{ name: 'A' }, { name: 'A', type: 'Vendor' }],
    projects: [
      { name: 'X', client: 'A', stage: 'Won, Pending KoM', contract_value: 10 },
      { name: 'Y', client: 'A', stage: 'Leads', status: 'Ongoing Project', contract_date: '2025-01-01' },
      { name: 'W', client: 'A', stage: 'Sold' },
      {
        code: 'C-1', name: 'Z', client: 'A', stage: 'Leads',
        budget: [
          { category: 'Food', budgeted_amount: 1.234 },
          { category: 'Labor', budgeted_amount: 5 },
          { category: 'Labor', budgeted_amount: 5 },
        ],
      },
    ],
  });
  assert.deepEqual(problems, [
    'companies[1]: unknown field "type"',
    'companies[1]: "A" appears twice',
    'projects[0] (X | A): "tax_treatment" must be "inclusive" or "exclusive" when a contract value is given',
    'projects[0] (X | A): "tax_amount" must be a non-negative amount with at most 2 decimals when a contract value is given (0 = no tax)',
    'projects[0] (X | A): "customer_contract_ref" (the client\'s contract or PO number) is required to load a won project',
    'projects[0] (X | A): "contract_date" (YYYY-MM-DD) is required to load a won project',
    'projects[1] (Y | A): unknown field "status"',
    'projects[1] (Y | A): "customer_contract_ref" and "contract_date" are recorded only when a project is won',
    `projects[2] (W | A): "stage" must be one of: ${Object.keys(LOAD_STAGE_PATHS).join(', ')}`,
    'projects[3] (C-1): budget[0]: "category" must be one of: Labor, Materials, Subcontractors, Equipment, Permits & Fees, Overheads, Contingency, Special expenses',
    'projects[3] (C-1): budget[0]: "budgeted_amount" must be a non-negative amount with at most 2 decimals',
    'projects[3] (C-1): budget[2]: is identical to an earlier line — give one of them a "reference" to keep both',
  ]);
});

test('AC-CSD-002: a won project needs a value, and a date must be a real calendar date', () => {
  assert.deepEqual(
    validateLoadFile({ projects: [{ name: 'V', client: 'A', stage: 'Close Out', customer_contract_ref: 'PO', contract_date: '2025-02-30' }] }),
    [
      'projects[0] (V | A): "contract_value" is required to load a won project',
      'projects[0] (V | A): "contract_date" (YYYY-MM-DD) is required to load a won project',
    ],
  );
});

test('AC-CSD-009: remainingPath resumes from the current stage and returns null off the path', () => {
  assert.deepEqual(remainingPath('Ongoing Project', 'Leads'), ['PQ Submitted', 'Quotation Submitted', 'Won, Pending KoM', 'Ongoing Project']);
  assert.deepEqual(remainingPath('Ongoing Project', 'Quotation Submitted'), ['Won, Pending KoM', 'Ongoing Project']);
  assert.deepEqual(remainingPath('Ongoing Project', 'Ongoing Project'), []);
  assert.equal(remainingPath('Ongoing Project', 'Loss Tender'), null);
  assert.equal(remainingPath('Quotation Submitted', 'Ongoing Project'), null);
});

test('AC-CSD-014: every step of every load path is legal in the latest transition_project map', () => {
  const dir = path.join(ROOT, 'supabase', 'migrations');
  const latest = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => /create or replace function (public\.)?transition_project\(/.test(fs.readFileSync(path.join(dir, f), 'utf8')))
    .pop();
  const sql = fs.readFileSync(path.join(dir, latest), 'utf8');
  const legal = {};
  for (const m of sql.matchAll(/'([^']+)',\s+jsonb_build_array\(([^)]*)\)/g)) {
    legal[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  }
  assert.ok(Object.keys(legal).length >= 10, `parsed the transition map from ${latest}`);
  for (const [target, steps] of Object.entries(LOAD_STAGE_PATHS)) {
    const walk = ['Leads', ...steps];
    assert.equal(walk.at(-1), target, `${target}: the path ends at the target`);
    for (let i = 1; i < walk.length; i += 1) {
      assert.ok(legal[walk[i - 1]]?.includes(walk[i]), `${target}: ${walk[i - 1]} -> ${walk[i]} is legal`);
    }
  }
});
```

**Verify (RED: module not found):** `node --test scripts/pmo-load.test.mjs`

### Task 7 — failing Vitest parity (AC-CSD-011)

Create `pmo-portal/src/lib/import/__tests__/budgetLoadParity.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/src/lib/repositories', () => ({ repositories: {} }));

import { BUDGET_CATEGORIES, computeBudgetLineImportKey as appKey } from '../budgetDescriptor';
// The Node-side mirror used by `pmo load` (#796). Byte-identical output is the contract: a line loaded by
// the CLI and the same line imported in the app must carry the same import_key (0195's skip + index).
import {
  BUDGET_CATEGORIES as LOAD_CATEGORIES,
  computeBudgetLineImportKey as loadKey,
} from '../../../../../scripts/lib/pmo-load.mjs';

describe('pmo load budget rules === the app budget import', () => {
  const base = { project: 'ORG-001', category: 'Labor', description: 'Crew', fiscalYear: '2025', amount: '400000', reference: '' };
  const cases = [
    { name: 'a reference wins (trimmed)', cells: { ...base, reference: ' R-2 ' } },
    { name: 'fingerprint with every cell', cells: base },
    { name: 'fingerprint with blank optional cells', cells: { ...base, description: '', fiscalYear: '' } },
    { name: 'a whitespace-only reference falls back to the fingerprint', cells: { ...base, reference: '   ' } },
  ];
  for (const { name, cells } of cases) {
    it(`AC-CSD-011 the line key matches for: ${name}`, () => {
      expect(loadKey(cells)).toBe(appKey(cells));
    });
  }
  it('AC-CSD-011 the categories equal the generated budget_category enum', () => {
    expect([...LOAD_CATEGORIES]).toEqual([...BUDGET_CATEGORIES]);
  });
});
```

**Verify (RED: module not found):**
`cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/import/__tests__/budgetLoadParity.test.ts`

### Task 8 — `scripts/lib/pmo-load.mjs` part 1: constants, helpers, key, path (green for Task 7, partial Task 6)

Create `scripts/lib/pmo-load.mjs`:

```js
/**
 * pmo-load — `pmo load`: one client's starting data, through the app's own write paths (#796).
 * Spec: docs/specs/client-starting-data-cli.spec.md · ADR-0074 · runbook docs/runbooks/pmo-cli.md §4.
 *
 * Order: companies → projects (create as Leads → contract value → stage walk) → draft budgets.
 * resolveLoad() only READS and returns problems or a plan; applyLoad() writes the plan in order (or,
 * with dryRun, only lists it) and stops at the first refusal. Every entity is matched before it is
 * written, so re-running the same file resumes and never duplicates.
 *
 * Writes use the owner's own token: RLS-governed inserts for companies, projects and budget rows, and
 * the security-definer RPCs set_project_contract_value / transition_project for money and stage. Never:
 * budget activation, work orders, deletes, or status / activated_at / actual_amount on a budget row.
 *
 * Node 22 standard library only.
 */

/** Target stage → the transitions from 'Leads' that reach it (AC-CSD-014 proves each step is legal). */
export const LOAD_STAGE_PATHS = Object.freeze({
  Leads: Object.freeze([]),
  'PQ Submitted': Object.freeze(['PQ Submitted']),
  'Quotation Submitted': Object.freeze(['PQ Submitted', 'Quotation Submitted']),
  'Tender Submitted': Object.freeze(['PQ Submitted', 'Quotation Submitted', 'Tender Submitted']),
  Negotiation: Object.freeze(['PQ Submitted', 'Quotation Submitted', 'Tender Submitted', 'Negotiation']),
  'Won, Pending KoM': Object.freeze(['PQ Submitted', 'Quotation Submitted', 'Won, Pending KoM']),
  'Ongoing Project': Object.freeze(['PQ Submitted', 'Quotation Submitted', 'Won, Pending KoM', 'Ongoing Project']),
  'On Hold': Object.freeze(['PQ Submitted', 'Quotation Submitted', 'Won, Pending KoM', 'On Hold']),
  'Close Out': Object.freeze(['PQ Submitted', 'Quotation Submitted', 'Won, Pending KoM', 'Close Out']),
});

/** Stages reached by winning: loading one needs a contract value and the win artifacts. */
export const WON_STAGES = Object.freeze(['Won, Pending KoM', 'Ongoing Project', 'On Hold', 'Close Out']);

/** public.budget_category — budgetLoadParity.test.ts proves it equals the generated enum (AC-CSD-011). */
export const BUDGET_CATEGORIES = Object.freeze([
  'Labor', 'Materials', 'Subcontractors', 'Equipment', 'Permits & Fees', 'Overheads', 'Contingency', 'Special expenses',
]);

/** The name the app's budget import gives a version it creates (budgetDescriptor.ts). */
export const IMPORT_VERSION_NAME = 'Imported';

const OPTIONAL_PROJECT_FIELDS = Object.freeze([
  'start_date', 'end_date', 'project_manager_id', 'service_line', 'sector', 'location', 'award_type', 'bidding_entity',
]);
const PROJECT_FIELDS = new Set([
  'code', 'name', 'client', 'end_client', 'stage', 'contract_value', 'tax_treatment', 'tax_amount', 'tax_rate',
  'tax_base_numerator', 'tax_base_denominator', 'tax_template', 'customer_contract_ref', 'contract_date', 'budget',
  ...OPTIONAL_PROJECT_FIELDS,
]);
const LINE_FIELDS = new Set(['category', 'description', 'budgeted_amount', 'fiscal_year', 'reference']);
const COMPANY_FIELDS = new Set(['name', 'short_name']);
const PROJECT_SELECT = 'id,code,name,client_id,status,contract_value,pmo_project_number';
/** PostgREST answers at most max_rows (1000) rows: a read that fills it cannot prove a key is absent. */
const READ_CAP = 1000;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.trim() !== '';
const isOptionalText = (v) => v === undefined || v === null || typeof v === 'string';
const isDate = (v) =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
  && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);
/** numeric(14,2): finite, non-negative, below 1e12, at most two decimals. */
const isAmount = (v) =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e12 && Math.abs(Math.round(v * 100) - v * 100) < 1e-6;
const eq = (v) => `eq.${v}`;
const params = (o) => new URLSearchParams(o);

/** A project row's match key: the organisation's own code, else its name and client. */
export function projectKey(p) {
  return isText(p?.code) ? p.code : `${p?.name} | ${p?.client}`;
}

/** The app's budget-import key, verbatim (pmo-portal/src/lib/import/budgetDescriptor.ts; AC-CSD-011). */
export function computeBudgetLineImportKey(cells) {
  if (cells.reference.trim()) return cells.reference.trim();
  const parts = [cells.project.trim(), cells.category.trim(), cells.description.trim(), cells.fiscalYear.trim(), cells.amount.trim()];
  return `fp:${parts.join('|')}`;
}

function lineKey(key, line) {
  return computeBudgetLineImportKey({
    project: key,
    category: String(line.category ?? ''),
    description: String(line.description ?? ''),
    fiscalYear: String(line.fiscal_year ?? ''),
    amount: String(line.budgeted_amount),
    reference: String(line.reference ?? ''),
  });
}

/** The transitions still to make from `current` to `target`; null when `current` is not on the way. */
export function remainingPath(target, current) {
  const walk = ['Leads', ...LOAD_STAGE_PATHS[target]];
  const at = walk.indexOf(current);
  return at === -1 ? null : walk.slice(at + 1);
}
```

**Verify:** Task 7 Vitest command → GREEN. `node --test scripts/pmo-load.test.mjs` → still RED
(`validateLoadFile` not exported).

### Task 9 — `validateLoadFile` (green for Task 6)

Append to `scripts/lib/pmo-load.mjs`:

```js
/** Every problem in the file, row by row; [] when it is loadable. Offline — sends nothing (AC-CSD-002). */
export function validateLoadFile(doc) {
  if (!isObject(doc)) return ['The load file must be a JSON object with a "companies" list and/or a "projects" list'];
  const problems = [];
  for (const k of Object.keys(doc)) if (k !== 'companies' && k !== 'projects') problems.push(`unknown section "${k}"`);
  const companies = doc.companies ?? [];
  const projects = doc.projects ?? [];
  if (!Array.isArray(companies)) problems.push('"companies" must be a list');
  if (!Array.isArray(projects)) problems.push('"projects" must be a list');
  if (problems.length > 0) return problems;

  const names = new Set();
  companies.forEach((c, i) => {
    const add = (m) => problems.push(`companies[${i}]: ${m}`);
    if (!isObject(c)) return add('must be an object');
    for (const k of Object.keys(c)) if (!COMPANY_FIELDS.has(k)) add(`unknown field "${k}"`);
    if (!isText(c.name)) add('"name" (the legal name) is required');
    else if (names.has(c.name)) add(`"${c.name}" appears twice`);
    else names.add(c.name);
    if (c.short_name !== undefined && !isText(c.short_name)) add('"short_name" must be text');
    return undefined;
  });

  const keys = new Set();
  projects.forEach((p, i) => {
    if (!isObject(p)) return problems.push(`projects[${i}]: must be an object`);
    const key = projectKey(p);
    const add = (m) => problems.push(`projects[${i}] (${key}): ${m}`);
    for (const k of Object.keys(p)) if (!PROJECT_FIELDS.has(k)) add(`unknown field "${k}"`);
    if (p.code !== undefined && !isText(p.code)) add('"code" must be text');
    if (!isText(p.name)) add('"name" is required');
    if (!isText(p.client)) add('"client" (the client company\'s legal name) is required');
    if (p.end_client !== undefined && !isText(p.end_client)) add('"end_client" must be a company\'s legal name');
    if (keys.has(key)) add('appears twice');
    else keys.add(key);
    if (!Object.hasOwn(LOAD_STAGE_PATHS, p.stage)) add(`"stage" must be one of: ${Object.keys(LOAD_STAGE_PATHS).join(', ')}`);
    const won = WON_STAGES.includes(p.stage);
    if (p.contract_value !== undefined) {
      if (!isAmount(p.contract_value)) add('"contract_value" must be a non-negative amount with at most 2 decimals');
      if (p.tax_treatment !== 'inclusive' && p.tax_treatment !== 'exclusive') {
        add('"tax_treatment" must be "inclusive" or "exclusive" when a contract value is given');
      }
      if (!isAmount(p.tax_amount)) {
        add('"tax_amount" must be a non-negative amount with at most 2 decimals when a contract value is given (0 = no tax)');
      }
    } else if (won) {
      add('"contract_value" is required to load a won project');
    }
    if (p.tax_rate !== undefined && !(typeof p.tax_rate === 'number' && p.tax_rate >= 0 && p.tax_rate <= 100)) {
      add('"tax_rate" must be a percentage from 0 to 100');
    }
    if ((p.tax_base_numerator === undefined) !== (p.tax_base_denominator === undefined)) {
      add('"tax_base_numerator" and "tax_base_denominator" go together');
    } else if (p.tax_base_numerator !== undefined
      && ![p.tax_base_numerator, p.tax_base_denominator].every((n) => Number.isInteger(n) && n > 0)) {
      add('"tax_base_numerator" and "tax_base_denominator" must be positive whole numbers');
    }
    if (p.tax_template !== undefined && !isText(p.tax_template)) add('"tax_template" must be text');
    if (won) {
      if (!isText(p.customer_contract_ref)) add('"customer_contract_ref" (the client\'s contract or PO number) is required to load a won project');
      if (!isDate(p.contract_date)) add('"contract_date" (YYYY-MM-DD) is required to load a won project');
    } else if (p.customer_contract_ref !== undefined || p.contract_date !== undefined) {
      add('"customer_contract_ref" and "contract_date" are recorded only when a project is won');
    }
    for (const d of ['start_date', 'end_date']) if (p[d] !== undefined && !isDate(p[d])) add(`"${d}" must be a date (YYYY-MM-DD)`);
    if (p.budget === undefined) return undefined;
    if (!Array.isArray(p.budget)) return add('"budget" must be a list of lines');
    const lineKeys = new Set();
    p.budget.forEach((l, j) => {
      const addLine = (m) => add(`budget[${j}]: ${m}`);
      if (!isObject(l)) return addLine('must be an object');
      for (const k of Object.keys(l)) if (!LINE_FIELDS.has(k)) addLine(`unknown field "${k}"`);
      if (!BUDGET_CATEGORIES.includes(l.category)) addLine(`"category" must be one of: ${BUDGET_CATEGORIES.join(', ')}`);
      if (!isAmount(l.budgeted_amount)) addLine('"budgeted_amount" must be a non-negative amount with at most 2 decimals');
      for (const k of ['description', 'fiscal_year', 'reference']) if (!isOptionalText(l[k])) addLine(`"${k}" must be text`);
      const k = lineKey(key, l);
      if (lineKeys.has(k)) addLine('is identical to an earlier line — give one of them a "reference" to keep both');
      else lineKeys.add(k);
      return undefined;
    });
    return undefined;
  });
  return problems;
}
```

**Verify (GREEN):** `node --test scripts/pmo-load.test.mjs`

### Task 10 — failing resolve tests (AC-CSD-005, AC-CSD-010 plan level)

In `scripts/pmo-load.test.mjs`, add a second import below the first:
`import { resolveLoad } from './lib/pmo-load.mjs';` — then append the fake and the tests:

```js
/**
 * A fake LoadApi. GETs filter `tables[t]` by the query's eq./is.null/not.is.null filters; every call is
 * recorded in `calls`. `fail(kind, target, body)` may return an error code to throw, as the CLI's
 * apiError would. The RPCs update the project row the way the database does, so a re-run sees them.
 */
function fakeApi({ tables = {}, fail } = {}) {
  const calls = [];
  const rows = (t) => (tables[t] ??= []);
  let seq = 0;
  const matches = (row, q) => {
    for (const [k, v] of q) {
      if (k === 'select' || k === 'order' || k === 'limit') continue;
      if (v === 'is.null' && row[k] != null) return false;
      if (v === 'not.is.null' && row[k] == null) return false;
      if (v.startsWith('eq.') && String(row[k]) !== v.slice(3)) return false;
    }
    return true;
  };
  const maybeFail = (kind, target, body) => {
    const code = fail?.(kind, target, body);
    if (code) throw Object.assign(new Error(`refused: ${kind} ${target}`), { code, status: 403 });
  };
  return {
    calls,
    tables,
    async get(t, q) {
      calls.push({ kind: 'get', target: t, query: q.toString() });
      return rows(t).filter((r) => matches(r, q));
    },
    async post(t, body) {
      calls.push({ kind: 'post', target: t, body });
      maybeFail('post', t, body);
      seq += 1;
      const row = { id: `${t}-${seq}`, ...body };
      if (t === 'projects') row.pmo_project_number = `PRJ-26-${String(seq).padStart(4, '0')}`;
      if (t === 'budget_versions') row.status ??= 'Draft';
      rows(t).push(row);
      return [row];
    },
    async patch(t, q, body) {
      calls.push({ kind: 'patch', target: t, query: q.toString(), body });
      maybeFail('patch', t, body);
      const hit = rows(t).filter((r) => matches(r, q));
      for (const r of hit) Object.assign(r, body);
      return hit;
    },
    async rpc(name, body) {
      calls.push({ kind: 'rpc', target: name, body });
      maybeFail('rpc', name, body);
      const row = rows('projects').find((r) => r.id === body.p_id);
      if (row && name === 'transition_project') row.status = body.p_to;
      if (row && name === 'set_project_contract_value') row.contract_value = body.p_value;
      return null;
    },
  };
}

const writes = (api) => api.calls.filter((c) => c.kind !== 'get');

const DOC = () => ({
  companies: [{ name: 'Client Legal A', short_name: 'A' }, { name: 'Owner Legal B' }],
  projects: [
    {
      code: 'ORG-001', name: 'Plant upgrade', client: 'Client Legal A', end_client: 'Owner Legal B',
      stage: 'Ongoing Project', contract_value: 1000000, tax_treatment: 'exclusive', tax_amount: 110000,
      customer_contract_ref: 'PO-1', contract_date: '2025-02-01', start_date: '2025-02-10', sector: 'Energy',
      budget: [
        { category: 'Labor', description: 'Crew', budgeted_amount: 400000 },
        { category: 'Special expenses', description: 'Permits', budgeted_amount: 50000, reference: 'R-2' },
      ],
    },
    { name: 'Tank farm bid', client: 'Client Legal A', stage: 'Tender Submitted', contract_value: 250000, tax_treatment: 'exclusive', tax_amount: 27500 },
  ],
});

const COMPANIES = () => [
  { id: 'c-a', name: 'Client Legal A', short_name: 'A', archived_at: null },
  { id: 'c-b', name: 'Owner Legal B', short_name: null, archived_at: null },
];
const EXISTING = (over = {}) => ({
  id: 'p-1', code: 'ORG-001', name: 'Plant upgrade', client_id: 'c-a', status: 'Ongoing Project',
  contract_value: 1000000, pmo_project_number: 'PRJ-26-0001', ...over,
});

test('AC-CSD-005: while ERPNext owns companies, each missing company is one problem and nothing is written', async () => {
  const api = fakeApi({ tables: { external_domain_ownership: [{ domain: 'companies', external_tier: 'erpnext' }] } });
  const { problems } = await resolveLoad(DOC(), api);
  assert.equal(problems.length, 2, problems.join('\n'));
  assert.match(problems[0], /"Client Legal A" does not exist, and ERPNext owns companies/);
  assert.match(problems[0], /Companies → New/);
  assert.deepEqual(writes(api), []);
});

test('AC-CSD-010: the budget target is a new Draft, the highest Draft minus loaded keys, or nothing once a budget is active', async () => {
  const doc = { projects: [DOC().projects[0]] };
  const budgetOf = async (extra) =>
    (await resolveLoad(doc, fakeApi({ tables: { companies: COMPANIES(), projects: [EXISTING()], ...extra } }))).plan.projects[0].budget;
  assert.equal((await budgetOf({})).state, 'new');
  const attach = await budgetOf({
    budget_versions: [{ id: 'v-1', project_id: 'p-1', status: 'Draft', version: 1 }],
    budget_line_items: [{ id: 'l-1', budget_version_id: 'v-1', import_key: 'R-2' }],
  });
  assert.equal(attach.state, 'attach');
  assert.equal(attach.versionId, 'v-1');
  assert.deepEqual(attach.lines.map((l) => l.import_key), ['fp:ORG-001|Labor|Crew||400000']);
  for (const status of ['Active', 'Archived']) {
    assert.equal((await budgetOf({ budget_versions: [{ id: 'v-1', project_id: 'p-1', status, version: 1 }] })).state, 'skip', status);
  }
});
```

**Verify (RED: `resolveLoad` not exported):** `node --test scripts/pmo-load.test.mjs`

### Task 11 — `resolveLoad` (green for Task 10)

Append to `scripts/lib/pmo-load.mjs`:

```js
/**
 * Read-only phase: match every company, project and budget, and return { problems, plan }. A non-empty
 * problems list means nothing may be written (FR-CSD-004).
 */
export async function resolveLoad(doc, api) {
  const problems = [];
  const owners = await api.get('external_domain_ownership', params({ select: 'domain,external_tier', domain: eq('companies') }));
  const erpOwnsCompanies = owners.length > 0;

  const found = new Map(); // legal name -> row | null | 'ambiguous'
  async function lookup(name) {
    if (!found.has(name)) {
      const rows = await api.get('companies', params({ select: 'id,name,short_name,archived_at', name: eq(name) }));
      found.set(name, rows.length === 0 ? null : rows.length === 1 ? rows[0] : 'ambiguous');
    }
    return found.get(name);
  }

  const companies = [];
  const refs = new Map(); // legal name -> the entry projects point at (its id is filled in on create)
  const unresolved = new Set(); // section companies already reported, so a project naming one adds no second problem
  for (const c of doc.companies ?? []) {
    const hit = await lookup(c.name);
    let problem = null;
    if (hit === 'ambiguous') problem = `company "${c.name}": more than one company has this legal name — resolve it in the app`;
    else if (hit?.archived_at) problem = `company "${c.name}" is archived — restore it in the app first`;
    else if (!hit && erpOwnsCompanies) {
      problem = `company "${c.name}" does not exist, and ERPNext owns companies for this organisation: create it in the app (Companies → New) or as a Customer in ERPNext, wait for it to appear in PMO, then run the load again`;
    }
    if (problem) {
      problems.push(problem);
      unresolved.add(c.name);
      continue;
    }
    const current = hit?.short_name?.trim() || null;
    const wanted = c.short_name ?? null;
    let action = 'create';
    if (hit) action = !wanted || wanted === current ? 'skip' : current === null ? 'set_short_name' : 'short_name_differs';
    const entry = { name: c.name, id: hit?.id ?? null, action, short_name: wanted, current_short_name: current };
    companies.push(entry);
    refs.set(c.name, entry);
  }

  async function companyRef(name, role, key) {
    if (refs.has(name)) return refs.get(name);
    if (unresolved.has(name)) return null;
    const hit = await lookup(name);
    if (hit && hit !== 'ambiguous' && !hit.archived_at) {
      const entry = { name, id: hit.id, action: 'existing', short_name: hit.short_name ?? null };
      refs.set(name, entry);
      return entry;
    }
    problems.push(
      hit === 'ambiguous' ? `${key}: more than one company is named "${name}" (${role}) — resolve it in the app`
        : hit ? `${key}: ${role} "${name}" is archived — restore it in the app first`
          : `${key}: ${role} "${name}" is not a company in PMO — add it to "companies"`,
    );
    return null;
  }

  const projects = [];
  for (const p of doc.projects ?? []) {
    const key = projectKey(p);
    const client = await companyRef(p.client, 'client', key);
    const endClient = p.end_client ? await companyRef(p.end_client, 'end customer', key) : null;
    if (!client || (p.end_client && !endClient)) continue;
    let rows = [];
    if (p.code) rows = await api.get('projects', params({ select: PROJECT_SELECT, code: eq(p.code) }));
    else if (client.id) rows = await api.get('projects', params({ select: PROJECT_SELECT, name: eq(p.name), client_id: eq(client.id) }));
    if (rows.length > 1) {
      problems.push(`${key}: more than one project matches — resolve it in the app`);
      continue;
    }
    const existing = rows[0] ?? null;
    if (existing && client.id && existing.client_id !== client.id) {
      problems.push(`${key}: a project with this code already exists for a different client — fix the file or the project`);
      continue;
    }
    const current = Number(existing?.contract_value ?? 0);
    const entry = {
      key, input: p, client, endClient, existing,
      id: existing?.id ?? null,
      pmo_project_number: existing?.pmo_project_number ?? null,
      path: existing ? remainingPath(p.stage, existing.status) : [...LOAD_STAGE_PATHS[p.stage]],
      value: !p.contract_value ? 'none' : current === 0 ? 'set' : current === p.contract_value ? 'same' : 'differs',
      budget: null,
    };
    if (entry.path !== null && p.budget?.length) entry.budget = await resolveBudget(api, entry, problems);
    projects.push(entry);
  }
  return { problems, plan: { erpOwnsCompanies, companies, projects } };
}

/** The app import's rule (DD-BIMP-7): the highest Draft, else a new one; skip once a budget was activated. */
async function resolveBudget(api, entry, problems) {
  const lines = entry.input.budget.map((l) => ({ ...l, import_key: lineKey(entry.key, l) }));
  if (!entry.existing) return { state: 'new', versionId: null, lines };
  const versions = await api.get('budget_versions', params({ select: 'id,status,version', project_id: eq(entry.id), order: 'version.desc' }));
  if (versions.some((v) => v.status !== 'Draft')) {
    return { state: 'skip', versionId: null, lines: [], reason: 'the project already has an active or archived budget — add lines with the budget import in the app' };
  }
  if (versions.length === 0) return { state: 'new', versionId: null, lines };
  const have = await api.get('budget_line_items', params({ select: 'import_key', budget_version_id: eq(versions[0].id), import_key: 'not.is.null' }));
  if (have.length >= READ_CAP) {
    problems.push(`${entry.key}: the draft budget has too many lines to check — finish it in the app`);
    return { state: 'skip', versionId: null, lines: [], reason: 'too many lines to check' };
  }
  const loaded = new Set(have.map((r) => r.import_key));
  return { state: 'attach', versionId: versions[0].id, lines: lines.filter((l) => !loaded.has(l.import_key)) };
}
```

**Verify (GREEN):** `node --test scripts/pmo-load.test.mjs`

### Task 12 — failing apply tests (AC-CSD-003 planner, 004, 006, 007, 008, 009, 010, 012)

Add `import { applyLoad } from './lib/pmo-load.mjs';` below the other imports, then append:

```js
const load = async (api, doc = DOC(), dryRun = false) => {
  const { problems, plan } = await resolveLoad(doc, api);
  assert.deepEqual(problems, []);
  return applyLoad(plan, api, { dryRun, batchId: 'batch-1', importedAt: '2026-10-06T00:00:00.000Z' });
};

test('AC-CSD-006/007: a fresh load creates companies, projects as Leads, sets the value, then walks each stage in order', async () => {
  const api = fakeApi();
  await load(api);
  const w = writes(api);
  assert.deepEqual(w.map((c) => `${c.kind} ${c.target}`), [
    'post companies', 'post companies',
    'post projects', 'rpc set_project_contract_value',
    'rpc transition_project', 'rpc transition_project', 'rpc transition_project', 'rpc transition_project',
    'post budget_versions', 'post budget_line_items', 'post budget_line_items',
    'post projects', 'rpc set_project_contract_value',
    'rpc transition_project', 'rpc transition_project', 'rpc transition_project',
  ]);
  assert.deepEqual(w[0].body, { name: 'Client Legal A', type: 'Client', short_name: 'A' });
  assert.deepEqual(w[1].body, { name: 'Owner Legal B', type: 'Client' });
  assert.deepEqual(w[2].body, {
    name: 'Plant upgrade', status: 'Leads', client_id: 'companies-1', code: 'ORG-001',
    end_client_id: 'companies-2', start_date: '2025-02-10', sector: 'Energy',
  });
  assert.deepEqual(w[3].body, { p_id: 'projects-3', p_value: 1000000, p_tax_treatment: 'exclusive', p_tax_amount: 110000 });
  assert.deepEqual(w.slice(4, 8).map((c) => c.body), [
    { p_id: 'projects-3', p_to: 'PQ Submitted' },
    { p_id: 'projects-3', p_to: 'Quotation Submitted' },
    { p_id: 'projects-3', p_to: 'Won, Pending KoM', p_customer_contract_ref: 'PO-1', p_contract_date: '2025-02-01' },
    { p_id: 'projects-3', p_to: 'Ongoing Project' },
  ]);
  assert.deepEqual(w.slice(13).map((c) => c.body.p_to), ['PQ Submitted', 'Quotation Submitted', 'Tender Submitted']);
  assert.ok(w.slice(13).every((c) => !('p_customer_contract_ref' in c.body)), 'a bid carries no win artifacts');
});

test('AC-CSD-010: a budget becomes one Draft "Imported" version; lines carry the app key and never a status, activation or actual', async () => {
  const api = fakeApi();
  await load(api);
  const [version] = writes(api).filter((c) => c.target === 'budget_versions');
  assert.deepEqual(version.body, {
    project_id: 'projects-3', version: 1, name: 'Imported', import_batch_id: 'batch-1', imported_at: '2026-10-06T00:00:00.000Z',
  });
  assert.deepEqual(writes(api).filter((c) => c.target === 'budget_line_items').map((c) => c.body), [
    { budget_version_id: 'budget_versions-4', category: 'Labor', description: 'Crew', budgeted_amount: 400000, fiscal_year: null,
      import_batch_id: 'batch-1', imported_at: '2026-10-06T00:00:00.000Z', import_key: 'fp:ORG-001|Labor|Crew||400000' },
    { budget_version_id: 'budget_versions-4', category: 'Special expenses', description: 'Permits', budgeted_amount: 50000, fiscal_year: null,
      import_batch_id: 'batch-1', imported_at: '2026-10-06T00:00:00.000Z', import_key: 'R-2' },
  ]);
});

test('AC-CSD-010: an existing Draft is reused with its loaded keys skipped; an Active version skips the budget; 23505 is a skip', async () => {
  const doc = { projects: [DOC().projects[0]] };
  const draft = fakeApi({ tables: {
    companies: COMPANIES(), projects: [EXISTING()],
    budget_versions: [{ id: 'v-1', project_id: 'p-1', status: 'Draft', version: 1 }],
    budget_line_items: [{ id: 'l-1', budget_version_id: 'v-1', import_key: 'R-2' }],
  } });
  await load(draft, doc);
  assert.deepEqual(writes(draft).map((c) => [c.target, c.body.budget_version_id, c.body.import_key]), [
    ['budget_line_items', 'v-1', 'fp:ORG-001|Labor|Crew||400000'],
  ]);

  const active = fakeApi({ tables: { companies: COMPANIES(), projects: [EXISTING()], budget_versions: [{ id: 'v-1', project_id: 'p-1', status: 'Active', version: 1 }] } });
  const actions = await load(active, doc);
  assert.deepEqual(writes(active), []);
  assert.equal(actions.find((a) => a.kind === 'budget.skip').key, 'ORG-001');

  const raced = fakeApi({ fail: (kind, target, body) => target === 'budget_line_items' && body.import_key === 'R-2' && '23505' });
  const lines = (await load(raced)).find((a) => a.kind === 'budget.lines');
  assert.equal(lines.created, 1);
  assert.equal(lines.skipped, 1);
});

test('AC-CSD-004: an existing company is matched by legal name; an empty short name is filled, a different one reported', async () => {
  const api = fakeApi({ tables: { companies: [
    { id: 'c-a', name: 'Client Legal A', short_name: null, archived_at: null },
    { id: 'c-b', name: 'Owner Legal B', short_name: 'OB', archived_at: null },
  ] } });
  const actions = await load(api, { companies: [{ name: 'Client Legal A', short_name: 'A' }, { name: 'Owner Legal B', short_name: 'B' }] });
  assert.deepEqual(writes(api).map((c) => [c.kind, c.target, c.query, c.body]), [['patch', 'companies', 'id=eq.c-a', { short_name: 'A' }]]);
  assert.deepEqual(actions.map((a) => a.kind), ['company.set_short_name', 'company.short_name_differs']);
});

test('AC-CSD-008: re-running a completed load writes nothing', async () => {
  const api = fakeApi();
  await load(api);
  const before = writes(api).length;
  const rerun = await load(api);
  assert.equal(writes(api).length, before);
  assert.deepEqual(new Set(rerun.map((a) => a.kind)), new Set(['company.skip', 'project.skip', 'budget.skip']));
});

test('AC-CSD-009: a project part-way resumes; one off its path is left alone; a different value is reported', async () => {
  const doc = { projects: [DOC().projects[0]] };
  const active = [{ id: 'v-1', project_id: 'p-1', status: 'Active', version: 1 }];
  const partway = fakeApi({ tables: { companies: COMPANIES(), projects: [EXISTING({ status: 'Quotation Submitted' })], budget_versions: active } });
  await load(partway, doc);
  assert.deepEqual(writes(partway).map((c) => c.body.p_to), ['Won, Pending KoM', 'Ongoing Project']);

  const lost = fakeApi({ tables: { companies: COMPANIES(), projects: [EXISTING({ status: 'Loss Tender' })] } });
  const lostActions = await load(lost, doc);
  assert.deepEqual(writes(lost), []);
  assert.deepEqual(lostActions.map((a) => a.kind), ['project.diverged']);

  const repriced = fakeApi({ tables: { companies: COMPANIES(), projects: [EXISTING({ contract_value: 900000 })], budget_versions: active } });
  const priced = await load(repriced, doc);
  assert.deepEqual(writes(repriced), []);
  assert.deepEqual(priced.find((a) => a.kind === 'project.contract_value_differs'),
    { kind: 'project.contract_value_differs', key: 'ORG-001', id: 'p-1', current: 900000, file: 1000000 });
});

test('AC-CSD-003: a dry run plans the same actions and writes nothing', async () => {
  const api = fakeApi();
  const actions = await load(api, DOC(), true);
  assert.deepEqual(writes(api), []);
  assert.deepEqual(actions.map((a) => a.kind), [
    'company.create', 'company.create',
    'project.create', 'project.contract_value',
    'project.transition', 'project.transition', 'project.transition', 'project.transition',
    'budget.version', 'budget.lines',
    'project.create', 'project.contract_value',
    'project.transition', 'project.transition', 'project.transition',
  ]);
});

test('AC-CSD-012: the first refusal stops the load and reports what was done and what failed', async () => {
  const api = fakeApi({ fail: (kind, target, body) => target === 'transition_project' && body.p_to === 'Won, Pending KoM' && '42501' });
  const { plan } = await resolveLoad(DOC(), api);
  await assert.rejects(applyLoad(plan, api, { dryRun: false, batchId: 'b', importedAt: 't' }), (e) => {
    assert.equal(e.code, '42501');
    assert.deepEqual(e.loadReport.failed, { kind: 'project.transition', key: 'ORG-001', to: 'Won, Pending KoM' });
    assert.deepEqual(e.loadReport.done.map((a) => a.kind), [
      'company.create', 'company.create', 'project.create', 'project.contract_value', 'project.transition', 'project.transition',
    ]);
    return true;
  });
  assert.equal(writes(api).at(-1).body.p_to, 'Won, Pending KoM', 'no write after the refusal');
});
```

**Verify (RED: `applyLoad` not exported):** `node --test scripts/pmo-load.test.mjs`

### Task 13 — `applyLoad` + `countActions` (green for Task 12)

Append to `scripts/lib/pmo-load.mjs`:

```js
function projectPayload(e) {
  const p = e.input;
  const body = { name: p.name, status: 'Leads', client_id: e.client.id };
  if (p.code !== undefined) body.code = p.code;
  if (e.endClient) body.end_client_id = e.endClient.id;
  for (const k of OPTIONAL_PROJECT_FIELDS) if (p[k] !== undefined) body[k] = p[k];
  return body;
}

function valueArgs(id, p) {
  const args = { p_id: id, p_value: p.contract_value, p_tax_treatment: p.tax_treatment, p_tax_amount: p.tax_amount };
  if (p.tax_rate !== undefined) args.p_tax_rate = p.tax_rate;
  if (p.tax_template !== undefined) args.p_tax_template = p.tax_template;
  if (p.tax_base_numerator !== undefined) args.p_tax_base_numerator = p.tax_base_numerator;
  if (p.tax_base_denominator !== undefined) args.p_tax_base_denominator = p.tax_base_denominator;
  return args;
}

function transitionArgs(e, to) {
  const args = { p_id: e.id, p_to: to };
  if (to === 'Won, Pending KoM') {
    args.p_customer_contract_ref = e.input.customer_contract_ref;
    args.p_contract_date = e.input.contract_date;
  }
  return args;
}

/**
 * Write phase. Runs the plan in order; with dryRun it only lists the actions. On the first refusal it
 * rethrows the server's error with err.loadReport = { done, failed } (FR-CSD-011).
 */
export async function applyLoad(plan, api, { dryRun, batchId = crypto.randomUUID(), importedAt = new Date().toISOString() }) {
  const done = [];
  const note = (action) => done.push(action);
  async function write(action, run) {
    if (dryRun) {
      done.push(action);
      return;
    }
    try {
      done.push({ ...action, ...((await run()) ?? {}) });
    } catch (err) {
      err.loadReport = { done: [...done], failed: action };
      throw err;
    }
  }

  for (const c of plan.companies) {
    if (c.action === 'create') {
      await write({ kind: 'company.create', name: c.name }, async () => {
        const [row] = await api.post('companies', { name: c.name, type: 'Client', ...(c.short_name ? { short_name: c.short_name } : {}) });
        c.id = row.id;
        return { id: row.id };
      });
    } else if (c.action === 'set_short_name') {
      await write({ kind: 'company.set_short_name', name: c.name, id: c.id, short_name: c.short_name }, async () => {
        const rows = await api.patch('companies', params({ id: eq(c.id) }), { short_name: c.short_name });
        // #541: an RLS-hidden row is a 0-row PATCH with no error — say so instead of reporting success.
        if (!rows?.length) throw Object.assign(new Error(`The short name of "${c.name}" was not changed — the database did not allow it`), { code: 'no_rows' });
      });
    } else if (c.action === 'short_name_differs') {
      note({ kind: 'company.short_name_differs', name: c.name, id: c.id, current: c.current_short_name, file: c.short_name });
    } else {
      note({ kind: 'company.skip', name: c.name, id: c.id });
    }
  }

  for (const e of plan.projects) {
    if (e.path === null) {
      note({ kind: 'project.diverged', key: e.key, id: e.id, status: e.existing.status, stage: e.input.stage });
      continue;
    }
    if (e.existing) {
      note({ kind: 'project.skip', key: e.key, id: e.id, pmo_project_number: e.pmo_project_number });
    } else {
      await write({ kind: 'project.create', key: e.key }, async () => {
        const [row] = await api.post('projects', projectPayload(e));
        e.id = row.id;
        e.pmo_project_number = row.pmo_project_number ?? null;
        return { id: e.id, pmo_project_number: e.pmo_project_number };
      });
    }
    if (e.value === 'set') {
      await write({ kind: 'project.contract_value', key: e.key, value: e.input.contract_value }, async () => {
        await api.rpc('set_project_contract_value', valueArgs(e.id, e.input));
      });
    } else if (e.value === 'differs') {
      note({ kind: 'project.contract_value_differs', key: e.key, id: e.id, current: Number(e.existing.contract_value), file: e.input.contract_value });
    }
    for (const to of e.path) {
      await write({ kind: 'project.transition', key: e.key, to }, async () => {
        await api.rpc('transition_project', transitionArgs(e, to));
      });
    }
    if (e.budget) await applyBudget(e, api, write, note, { batchId, importedAt });
  }
  return done;
}

async function applyBudget(e, api, write, note, { batchId, importedAt }) {
  if (e.budget.state === 'skip') return note({ kind: 'budget.skip', key: e.key, id: e.id, reason: e.budget.reason });
  if (e.budget.lines.length === 0) return note({ kind: 'budget.skip', key: e.key, id: e.id, reason: 'every line is already in the draft' });
  let versionId = e.budget.versionId;
  if (!versionId) {
    // `status` is omitted on purpose: the column default is Draft and the 0176 trigger refuses anything else.
    await write({ kind: 'budget.version', key: e.key, name: IMPORT_VERSION_NAME }, async () => {
      const [v] = await api.post('budget_versions', {
        project_id: e.id, version: 1, name: IMPORT_VERSION_NAME, import_batch_id: batchId, imported_at: importedAt,
      });
      versionId = v.id;
      return { version_id: v.id };
    });
  }
  return write({ kind: 'budget.lines', key: e.key, count: e.budget.lines.length }, async () => {
    let created = 0;
    let skipped = 0;
    for (const l of e.budget.lines) {
      try {
        // `actual_amount` is never sent: actuals are read from the ERP read-model (FR-BIMP-005).
        await api.post('budget_line_items', {
          budget_version_id: versionId, category: l.category, description: l.description ?? null,
          budgeted_amount: l.budgeted_amount, fiscal_year: l.fiscal_year ?? null,
          import_batch_id: batchId, imported_at: importedAt, import_key: l.import_key,
        });
        created += 1;
      } catch (err) {
        if (err.code !== '23505') throw err; // 0195's index: already loaded — a skip, as in the app import
        skipped += 1;
      }
    }
    return { version_id: versionId, created, skipped };
  });
}

/** { kind: count } for the report. */
export function countActions(actions) {
  const counts = {};
  for (const a of actions) counts[a.kind] = (counts[a.kind] ?? 0) + 1;
  return counts;
}
```

**Verify (GREEN):** `node --test scripts/pmo-load.test.mjs`

### Task 14 — failing CLI `load` tests (AC-CSD-001, AC-CSD-002 no-request, AC-CSD-003, AC-CSD-012 exit)

Append to `scripts/pmo.test.mjs`:

```js
// ── #796 pmo load ────────────────────────────────────────────────────────────────────────────────

const LOAD_FILE = {
  companies: [{ name: 'Client Legal A', short_name: 'A' }],
  projects: [{ code: 'ORG-001', name: 'Plant upgrade', client: 'Client Legal A', stage: 'Quotation Submitted', contract_value: 1000, tax_treatment: 'exclusive', tax_amount: 110 }],
};

function writeLoadFile(dir, doc = LOAD_FILE) {
  const file = path.join(dir, 'load.json');
  fs.writeFileSync(file, JSON.stringify(doc));
  return file;
}

/** PostgREST GETs answer no rows; the caller's profile has `role` / `status`. */
const emptyDbAs = (role, status = 'active') => ({ url, req, send }) => {
  if (url.pathname === '/rest/v1/profiles') {
    send(200, [{ full_name: 'Owner', role, status }]);
    return true;
  }
  if (url.pathname.startsWith('/rest/v1/') && req.method === 'GET') {
    send(200, []);
    return true;
  }
  return false;
};

test('AC-CSD-001: pmo load refuses anyone but an active Admin, before any write', async () => {
  for (const [role, status] of [['Project Manager', 'active'], ['Admin', 'disabled']]) {
    const fake = await fakeSupabase({ handler: emptyDbAs(role, status) });
    const configDir = tmpDir();
    try {
      seedCredentials(configDir, fake.url);
      const r = await runCli(['load', writeLoadFile(configDir), '--url', fake.url], { configDir });
      assert.equal(r.code, 2, r.err);
      assert.match(r.errJson.error.message, /active Admin/);
      assert.deepEqual(fake.requests.filter((q) => q.method !== 'GET').map((q) => q.path), []);
    } finally {
      await fake.close();
      fs.rmSync(configDir, { recursive: true, force: true });
    }
  }
});

test('AC-CSD-002: pmo load lists every problem in an invalid file and sends nothing', async () => {
  const fake = await fakeSupabase();
  const configDir = tmpDir();
  try {
    seedCredentials(configDir, fake.url);
    const bad = { projects: [{ name: 'X', client: 'A', stage: 'Won, Pending KoM' }, { name: 'Y', stage: 'Sold' }] };
    const r = await runCli(['load', writeLoadFile(configDir, bad), '--url', fake.url], { configDir });
    assert.equal(r.code, 2);
    assert.equal(r.errJson.error.code, 'invalid_load_file');
    assert.equal(r.errJson.error.details.length, 5);
    assert.equal(fake.requests.length, 0);
  } finally {
    await fake.close();
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

test('AC-CSD-003: pmo load --dry-run sends only reads and prints the planned actions', async () => {
  const fake = await fakeSupabase({ handler: emptyDbAs('Admin') });
  const configDir = tmpDir();
  try {
    seedCredentials(configDir, fake.url);
    const r = await runCli(['load', writeLoadFile(configDir), '--dry-run', '--url', fake.url], { configDir });
    assert.equal(r.code, 0, r.err);
    assert.equal(r.json.dry_run, true);
    assert.deepEqual(r.json.actions.map((a) => a.kind), ['company.create', 'project.create', 'project.contract_value', 'project.transition', 'project.transition']);
    assert.equal(r.json.counts['project.transition'], 2);
    assert.deepEqual(fake.requests.filter((q) => q.method !== 'GET').map((q) => `${q.method} ${q.path}`), []);
  } finally {
    await fake.close();
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

test('AC-CSD-012: a refused write ends pmo load with exit 1 and the done / failed report', async () => {
  const handler = (ctx) => {
    if (ctx.url.pathname === '/rest/v1/rpc/transition_project') {
      ctx.send(403, { code: '42501', message: 'not authorized' });
      return true;
    }
    return emptyDbAs('Admin')(ctx);
  };
  const fake = await fakeSupabase({ handler });
  const configDir = tmpDir();
  try {
    seedCredentials(configDir, fake.url);
    const r = await runCli(['load', writeLoadFile(configDir), '--url', fake.url], { configDir });
    assert.equal(r.code, 1, r.err);
    assert.equal(r.errJson.error.code, '42501');
    assert.equal(r.errJson.error.details.failed.kind, 'project.transition');
    assert.deepEqual(r.errJson.error.details.done.map((a) => a.kind), ['company.create', 'project.create', 'project.contract_value']);
  } finally {
    await fake.close();
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});
```

**Verify (RED: `load` is an unknown command):** `node --test scripts/pmo.test.mjs`

### Task 15 — the `load` verb (green for Task 14)

In `scripts/pmo.mjs`:

1. After the `node:url` import add:
   `import { applyLoad, countActions, resolveLoad, validateLoadFile } from './lib/pmo-load.mjs';`
2. Header comment: add the line ` *   pmo load <file.json | -> [--dry-run]   (active Admin only — #796)` under `pmo rpc`.
3. `COMMANDS`: `Object.freeze(['login', 'logout', 'whoami', 'get', 'create', 'update', 'rpc', 'load'])`.
4. `BOOL_FLAGS`: `new Set(['no-browser', 'help', 'dry-run'])`.
5. In `USAGE`, after the `pmo rpc` line add `  pmo load <file.json | -> [--dry-run]   (active Admin: companies, projects, draft budgets)`.
6. Before `async function dispatch`, add:

```js
/** The signed-in user and their profile (role, status) — read live, as RLS does. */
async function readMe(ctx) {
  const user = await authed(ctx, 'GET', '/auth/v1/user');
  const q = new URLSearchParams({ id: `eq.${user.id}`, select: 'full_name,role,status' });
  const rows = await authed(ctx, 'GET', `/rest/v1/profiles?${q}`);
  return { user, profile: Array.isArray(rows) && rows[0] ? rows[0] : {} };
}

/** The LoadApi `pmo load` writes through — the user's own token, nothing else (scripts/lib/pmo-load.mjs). */
function loadApi(ctx) {
  const representation = { prefer: 'return=representation' };
  return {
    get: (table, q) => authed(ctx, 'GET', `/rest/v1/${table}?${q}`),
    post: (table, body) => authed(ctx, 'POST', `/rest/v1/${table}`, { body, headers: representation }),
    patch: (table, q, body) => authed(ctx, 'PATCH', `/rest/v1/${table}?${q}`, { body, headers: representation }),
    rpc: (name, body) => authed(ctx, 'POST', `/rest/v1/rpc/${name}`, { body }),
  };
}
```

7. Replace the `whoami` case body:

```js
    case 'whoami': {
      const { user, profile } = await readMe(ctx);
      return {
        url: ctx.supabaseUrl,
        id: user.id,
        email: user.email,
        full_name: profile.full_name ?? null,
        role: profile.role ?? null,
        status: profile.status ?? null,
      };
    }
```

8. Add before `default:` in `dispatch`:

```js
    case 'load': {
      const [file] = positionals;
      if (!file) throw usage('load needs a JSON file: pmo load <file.json | -> [--dry-run]');
      const doc = await readPayload(ctx, file === '-' ? '-' : `@${file.replace(/^@/, '')}`);
      const problems = validateLoadFile(doc);
      if (problems.length > 0) {
        throw new CliError(`The load file has ${problems.length} problem(s); nothing was sent.`, { exit: 2, code: 'invalid_load_file', details: problems });
      }
      const { profile } = await readMe(ctx);
      if (profile.role !== 'Admin' || profile.status !== 'active') {
        throw usage("pmo load is for an active Admin (the owner). Sign in as the organisation's Admin.");
      }
      const api = loadApi(ctx);
      const resolved = await resolveLoad(doc, api);
      if (resolved.problems.length > 0) {
        throw new CliError(`${resolved.problems.length} problem(s) must be fixed before loading; nothing was written.`, { exit: 2, code: 'load_preflight', details: resolved.problems });
      }
      const dryRun = Boolean(flags['dry-run']);
      try {
        const actions = await applyLoad(resolved.plan, api, { dryRun });
        return { dry_run: dryRun, counts: countActions(actions), actions };
      } catch (e) {
        const err = e instanceof CliError ? e : new CliError(e?.message ?? String(e), { code: e?.code });
        err.details = { cause: err.details ?? null, ...(e?.loadReport ?? {}) };
        throw err;
      }
    }
```

**Verify (GREEN, incl. the unchanged whoami / AC-CLI-* tests):** `node --test scripts/pmo.test.mjs scripts/pmo-load.test.mjs`

### Task 16 — CI step, runbook, spec cross-link (docs + CI)

1. `.github/workflows/ci.yml`, step "PMO CLI tests": `run: node --test scripts/pmo.test.mjs scripts/pmo-load.test.mjs scripts/register-oauth-client.test.mjs`
2. `docs/runbooks/pmo-cli.md`:
   - §3 "What the CLI offers": add `external_domain_ownership` (`domain, external_tier`) to the read-only
     bullet, and the bullet: "**`pmo load`** (active Admin only, ADR-0074): companies, projects at their
     real stage with contract value, and draft budgets from one JSON file. It alone uses
     `set_project_contract_value`, `transition_project`, `budget_versions`, `budget_line_items`; `rpc` /
     `create` refuse them."
   - Replace §4 with:

     > ## 4. Seeding a client's starting data — `pmo load`
     >
     > 1. In the app (Admin): configure classification options (service lines, sectors). If ERPNext owns
     >    companies, create every missing company first — in the app (Companies → New, pushed to ERPNext)
     >    or as a Customer in ERPNext — and wait for it to appear in PMO.
     > 2. Claude writes the load file (spec §2) **outside the repository** from the client's spreadsheets.
     > 3. `node scripts/pmo.mjs load <file.json> --dry-run` — fix every problem it lists; read the plan.
     > 4. `node scripts/pmo.mjs load <file.json>` — companies → projects (Leads → value → stage) → draft
     >    budgets. On exit 1, read `details.failed`, fix the cause, run it again: it resumes.
     > 5. In the app: review and activate each draft budget; link each project to its ERP project (#772);
     >    work orders are created by the client's users.
     >
     > Re-runs never overwrite: a different stored value, stage or short name is reported, not changed.
     > Milestones, tasks, meetings and CRM activities still use `create` (§3).
3. `docs/specs/pmo-cli.spec.md` status block: append "Extended by `client-starting-data-cli.spec.md`
   (#796, `pmo load`)."

**Verify:** `node --test scripts/pmo.test.mjs scripts/pmo-load.test.mjs scripts/register-oauth-client.test.mjs`

### Task 17 — local gate + mutation checks

```bash
node --check scripts/pmo.mjs && node --check scripts/lib/pmo-load.mjs
node --test scripts/pmo.test.mjs scripts/pmo-load.test.mjs scripts/register-oauth-client.test.mjs
cd pmo-portal && ../scripts/with-test-lock.sh npm run typecheck
cd pmo-portal && npx eslint --max-warnings=0 src/lib/import/__tests__/budgetLoadParity.test.ts
cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run --changed origin/dev
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/api_client_seed_surface.test.sql supabase/tests/api_client_request_guard.test.sql supabase/tests/client_starting_data_sequence.test.sql'
```

Mutations — each must turn the named test RED, then restore and re-run green (record both outputs):

| # | Break | Must go red |
|---|---|---|
| M1 | `0239`: both Admin conditionals → `if true then return; end if;` | AC-CSD-013 (four non-Admin rows) |
| M2 | `pmo.mjs` load: `if (false && (profile.role !== 'Admin' …))` | AC-CSD-001 |
| M3 | `applyLoad`: delete the `if (dryRun) {…}` branch in `write` | AC-CSD-003 (both layers) |
| M4 | `validateLoadFile`: delete the `if (won) {…}` artifact block | AC-CSD-002 |
| M5 | `resolveBudget`: delete the Active/Archived `some(...)` skip | AC-CSD-010 |
| M6 | `LOAD_STAGE_PATHS['Ongoing Project']`: drop `'Won, Pending KoM'` | AC-CSD-014 (paths) |

## 3. Traceability

| AC | Tasks (test → implementation) | Owning test |
|---|---|---|
| AC-CSD-001 | 14 → 15 | `scripts/pmo.test.mjs` |
| AC-CSD-002 | 6 → 9; 14 → 15 | `scripts/pmo-load.test.mjs` |
| AC-CSD-003 | 14 → 15; 12 → 13 | `scripts/pmo.test.mjs` |
| AC-CSD-004 | 12 → 11, 13 | `scripts/pmo-load.test.mjs` |
| AC-CSD-005 | 10 → 11 | `scripts/pmo-load.test.mjs` |
| AC-CSD-006 | 12 → 13 | `scripts/pmo-load.test.mjs` |
| AC-CSD-007 | 12 → 13 | `scripts/pmo-load.test.mjs` |
| AC-CSD-008 | 12 → 11, 13 | `scripts/pmo-load.test.mjs` |
| AC-CSD-009 | 6 → 8; 12 → 11, 13 | `scripts/pmo-load.test.mjs` |
| AC-CSD-010 | 10 → 11; 12 → 13 | `scripts/pmo-load.test.mjs` |
| AC-CSD-011 | 7 → 8 | `pmo-portal/src/lib/import/__tests__/budgetLoadParity.test.ts` |
| AC-CSD-012 | 12 → 13; 14 → 15 | `scripts/pmo-load.test.mjs` |
| AC-CSD-013 | 1 → 2 | `supabase/tests/api_client_seed_surface.test.sql` |
| AC-CSD-014 | 4 → 5; 6 → 8 | `scripts/pmo.test.mjs`, `scripts/pmo-load.test.mjs` |
| AC-CSD-015 | 3 (characterization + oracle check) | `supabase/tests/client_starting_data_sequence.test.sql` |
| AC-CSD-016 | 4 → 5 | `scripts/pmo.test.mjs` |

## 4. Risks noted for review

- **Scaling:** one filtered read per company/project and one POST per budget line — ~51 projects and a
  few hundred lines is minutes, which is fine for a one-off owner load; no batching added (ponytail).
- **Name-only project match** (bids without a code) has no database uniqueness backstop; a concurrent
  second load could duplicate a bid. Accepted: one owner runs one load; the code match has `unique (org_id, code)`.
- **Classification option lists and a `{CLIENT}` number pattern** are not visible to the preflight (no
  `organizations` read); a mismatch refuses the project insert (`23514` / `P0001`), the load stops, and a
  re-run resumes after the fix in the app.
- **Hosted:** needs `0239` pushed with the owner's per-instance production yes (spec §8).
