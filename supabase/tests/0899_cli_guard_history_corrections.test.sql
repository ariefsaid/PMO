-- 0899_cli_guard_history_corrections.test.sql — proof for 0899 (#1855, #1858): the command line may import purchase history
-- and correct two loader-written tables, as an active Admin, one row per request, in a fixed set of columns.
--
-- AC ids owned here:
--   AC-CLIG-001  an active Admin token passes the guard for POST rpc/import_purchase_history and PATCH boq_items / budget_line_items.
--   AC-CLIG-002  PM, Finance, Executive, Engineer, a disabled Admin and an anonymous token are refused, per target.
--   AC-CLIG-003  PATCH without `Prefer: handling=strict` AND `max-affected=1` (missing, no strict, max-affected=10, repeated,
--                lenient) is refused; the existing upsert refusal and the DELETE / other-table refusals still hold.
--   AC-CLIG-004  the column trigger lets a token change only the allowed columns and refuses any other (42501), comparing the whole row.
--   AC-CLIG-005  an app session (no client_id) is not limited, whatever its headers say; a spoofed marker does not turn the trigger off.
--   AC-CLIG-006  a budget line on a non-Draft version is still refused by the existing Draft guard; a definer RPC's own update is not limited.
--
-- ⚑ pgTAP runs as the migration superuser; the authz assertions run under `set local role` + a JWT claim.
-- MUTATION-CHECKED (evidence file): drop the Admin check in the 0899 guard lines → AC-CLIG-002 red; drop the column trigger → AC-CLIG-004
-- red; accept max-affected=10 (substring match) → AC-CLIG-003 red; add a disallowed column to a trigger's list → AC-CLIG-004 red.
begin;
select plan(83);

insert into organizations (id, name, default_currency) values ('08990000-0000-0000-0000-0000000000a0', 'CLI guard org', 'IDR');
insert into auth.users (id, email) values
  ('08990000-0000-0000-0000-0000000000b1', 'cg-admin@example.com'),
  ('08990000-0000-0000-0000-0000000000b2', 'cg-disabled-admin@example.com'),
  ('08990000-0000-0000-0000-0000000000b3', 'cg-pm@example.com'),
  ('08990000-0000-0000-0000-0000000000b4', 'cg-finance@example.com'),
  ('08990000-0000-0000-0000-0000000000b5', 'cg-exec@example.com'),
  ('08990000-0000-0000-0000-0000000000b6', 'cg-engineer@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('08990000-0000-0000-0000-0000000000b1', '08990000-0000-0000-0000-0000000000a0', 'Admin', 'cg-admin@example.com', 'Admin', 'active'),
  ('08990000-0000-0000-0000-0000000000b2', '08990000-0000-0000-0000-0000000000a0', 'Disabled admin', 'cg-disabled-admin@example.com', 'Admin', 'disabled'),
  ('08990000-0000-0000-0000-0000000000b3', '08990000-0000-0000-0000-0000000000a0', 'PM', 'cg-pm@example.com', 'Project Manager', 'active'),
  ('08990000-0000-0000-0000-0000000000b4', '08990000-0000-0000-0000-0000000000a0', 'Finance', 'cg-finance@example.com', 'Finance', 'active'),
  ('08990000-0000-0000-0000-0000000000b5', '08990000-0000-0000-0000-0000000000a0', 'Executive', 'cg-exec@example.com', 'Executive', 'active'),
  ('08990000-0000-0000-0000-0000000000b6', '08990000-0000-0000-0000-0000000000a0', 'Engineer', 'cg-engineer@example.com', 'Engineer', 'active');

-- Two projects: one with a Draft budget, one whose budget is Active (Draft first, then promoted: the guard refuses a direct insert).
insert into projects (id, org_id, name, status) values
  ('08990000-0000-0000-0000-0000000000c1', '08990000-0000-0000-0000-0000000000a0', 'CLI guard draft project', 'Ongoing Project'),
  ('08990000-0000-0000-0000-0000000000c2', '08990000-0000-0000-0000-0000000000a0', 'CLI guard active project', 'Ongoing Project');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate, line_no, import_key) values
  ('08990000-0000-0000-0000-0000000000e1', '08990000-0000-0000-0000-0000000000a0', '08990000-0000-0000-0000-0000000000c1', 'CG-1', 'Survey', 'km', 10, 1000, 1, 'k-1'),
  ('08990000-0000-0000-0000-0000000000e2', '08990000-0000-0000-0000-0000000000a0', '08990000-0000-0000-0000-0000000000c1', 'CG-2', 'Build', 'unit', 5, 2000, 2, 'k-2');
insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('08990000-0000-0000-0000-0000000000d1', '08990000-0000-0000-0000-0000000000a0', '08990000-0000-0000-0000-0000000000c1', 1, 'Draft v1', 'Draft'),
  ('08990000-0000-0000-0000-0000000000d2', '08990000-0000-0000-0000-0000000000a0', '08990000-0000-0000-0000-0000000000c2', 1, 'Active v1', 'Draft');
insert into budget_line_items (id, org_id, budget_version_id, category, description, budgeted_amount, actual_amount, fiscal_year) values
  ('08990000-0000-0000-0000-0000000000f1', '08990000-0000-0000-0000-0000000000a0', '08990000-0000-0000-0000-0000000000d1', 'Labor', 'Draft line', 500, 0, '2026'),
  ('08990000-0000-0000-0000-0000000000f2', '08990000-0000-0000-0000-0000000000a0', '08990000-0000-0000-0000-0000000000d2', 'Labor', 'Active line', 700, 0, '2026');
update budget_versions set status = 'Active' where id = '08990000-0000-0000-0000-0000000000d2';

-- A request as PostgREST would present it: p_client false = an app session (no client_id claim).
create or replace function pg_temp.req(p_sub text, p_method text, p_path text, p_prefer text default null, p_client boolean default true,
  p_extra_headers jsonb default '{}'::jsonb) returns void language sql as $$
select set_config('request.jwt.claims',
  (case when p_sub = '' then jsonb_build_object('role', 'anon') else jsonb_build_object('sub', p_sub, 'role', 'authenticated') end
   || case when p_client then jsonb_build_object('client_id', 'pmo-cli') else '{}'::jsonb end)::text, true),
  set_config('request.method', p_method, true), set_config('request.path', p_path, true),
  set_config('request.headers', (coalesce(p_extra_headers, '{}'::jsonb)
    || case when p_prefer is null then '{}'::jsonb else jsonb_build_object('prefer', p_prefer) end)::text, true);$$;
grant all on function pg_temp.req(text, text, text, text, boolean, jsonb) to public;
create temp table subjects(label text, sub text) on commit drop;
insert into subjects values
  ('Project Manager', '08990000-0000-0000-0000-0000000000b3'), ('Finance', '08990000-0000-0000-0000-0000000000b4'),
  ('Executive', '08990000-0000-0000-0000-0000000000b5'), ('Engineer', '08990000-0000-0000-0000-0000000000b6'),
  ('disabled Admin', '08990000-0000-0000-0000-0000000000b2'), ('anonymous', '');
create temp table targets(method text, path text, prefer text) on commit drop;
insert into targets values
  ('POST', '/rpc/import_purchase_history', null),
  ('PATCH', '/boq_items', 'handling=strict,max-affected=1'),
  ('PATCH', '/budget_line_items', 'handling=strict,max-affected=1');
create temp table bad_prefer(label text, prefer text) on commit drop;
insert into bad_prefer values
  ('no Prefer header', null), ('max-affected only', 'max-affected=1'), ('strict only', 'handling=strict'),
  ('max-affected=10', 'handling=strict,max-affected=10'), ('max-affected=100', 'handling=strict, max-affected=100'),
  ('max-affected repeated', 'handling=strict,max-affected=1,max-affected=10'), ('handling repeated', 'handling=strict,handling=lenient,max-affected=1'),
  ('lenient', 'handling=lenient,max-affected=1'), ('return only', 'return=representation');
create temp table cols(tbl text, id uuid, col text, val text) on commit drop;
insert into cols values
  ('boq_items', '08990000-0000-0000-0000-0000000000e1', 'description', '''Survey (fixed)'''),
  ('boq_items', '08990000-0000-0000-0000-0000000000e1', 'unit', '''m'''),
  ('boq_items', '08990000-0000-0000-0000-0000000000e1', 'quantity', '12'),
  ('boq_items', '08990000-0000-0000-0000-0000000000e1', 'rate', '1500'),
  ('boq_items', '08990000-0000-0000-0000-0000000000e1', 'earning_basis', '''unit_rate'''),
  ('budget_line_items', '08990000-0000-0000-0000-0000000000f1', 'budgeted_amount', '650'),
  ('budget_line_items', '08990000-0000-0000-0000-0000000000f1', 'description', '''Draft line (fixed)''');
create temp table refused_cols(tbl text, id uuid, col text, val text) on commit drop;
insert into refused_cols values
  ('boq_items', '08990000-0000-0000-0000-0000000000e1', 'item_code', '''CG-1X'''),
  ('boq_items', '08990000-0000-0000-0000-0000000000e1', 'line_no', '9'),
  ('budget_line_items', '08990000-0000-0000-0000-0000000000f1', 'actual_amount', '99'),
  ('budget_line_items', '08990000-0000-0000-0000-0000000000f1', 'category', '''Materials'''),
  ('budget_line_items', '08990000-0000-0000-0000-0000000000f1', 'fiscal_year', '''2027'''),
  ('budget_line_items', '08990000-0000-0000-0000-0000000000f1', 'import_key', '''x-1'''),
  ('budget_line_items', '08990000-0000-0000-0000-0000000000f1', 'imported_at', 'now()'),
  ('budget_line_items', '08990000-0000-0000-0000-0000000000f1', 'org_id', '''08990000-0000-0000-0000-0000000000a9''');
grant select on subjects, targets, bad_prefer, cols, refused_cols to public;
set local role authenticated;

-- AC-CLIG-001: active Admin token → passes (3).
select lives_ok(
  format($f$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', %L, %L, %L); select public.api_client_request_guard()$f$, method, path, prefer),
  'AC-CLIG-001 active Admin token passes the guard for ' || method || ' ' || path) from targets order by path;
-- Prefer spelled with spaces, upper case and extra tokens still passes (1).
select lives_ok($$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'PATCH', '/boq_items', 'return=representation, Handling=Strict, Max-Affected=1'); select public.api_client_request_guard()$$,
  'AC-CLIG-001 Prefer tokens are matched by token, case and spacing aside');

-- AC-CLIG-002: every other subject, per target (6 x 3 = 18).
select throws_ok(
  format($f$select pg_temp.req(%L, %L, %L, %L); select public.api_client_request_guard()$f$, s.sub, t.method, t.path, t.prefer),
  '42501', null, 'AC-CLIG-002 ' || s.label || ' token is refused for ' || t.method || ' ' || t.path)
from subjects s cross join targets t order by s.label, t.path;

-- AC-CLIG-003: the Prefer rule, both tables (9 x 2 = 18).
select throws_ok(
  format($f$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'PATCH', %L, %L); select public.api_client_request_guard()$f$, t.path, b.prefer),
  '42501', null, 'AC-CLIG-003 Admin PATCH ' || t.path || ' with ' || b.label || ' is refused')
from bad_prefer b cross join (select distinct path from targets where method = 'PATCH') t order by t.path, b.label;
-- The other methods, other tables and the upsert refusal stay closed for an Admin token (7).
select throws_ok($$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'DELETE', '/boq_items', 'handling=strict,max-affected=1'); select public.api_client_request_guard()$$, '42501', null, 'AC-CLIG-003 Admin token: DELETE boq_items refused');
select throws_ok($$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'DELETE', '/budget_line_items', 'handling=strict,max-affected=1'); select public.api_client_request_guard()$$, '42501', null, 'AC-CLIG-003 Admin token: DELETE budget_line_items refused');
select throws_ok($$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'PATCH', '/budget_versions', 'handling=strict,max-affected=1'); select public.api_client_request_guard()$$, '42501', null, 'AC-CLIG-003 Admin token: PATCH budget_versions refused');
select throws_ok($$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'PATCH', '/budget_category_account_map', 'handling=strict,max-affected=1'); select public.api_client_request_guard()$$, '42501', null, 'AC-CLIG-003 Admin token: PATCH an unlisted table refused');
select throws_ok($$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'GET', '/rpc/import_purchase_history'); select public.api_client_request_guard()$$, '42501', null, 'AC-CLIG-003 Admin token: GET rpc/import_purchase_history refused');
select throws_ok($$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'PATCH', '/boq_items', 'resolution=merge-duplicates,handling=strict,max-affected=1'); select public.api_client_request_guard()$$, '42501', null, 'AC-CLIG-003 an upsert Prefer is still refused on PATCH');
select throws_ok($$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'PATCH', '/rpc/import_purchase_history', 'handling=strict,max-affected=1'); select public.api_client_request_guard()$$, '42501', null, 'AC-CLIG-003 PATCH on an rpc path refused');
-- An app session is not decided by the guard (3).
select lives_ok(
  format($f$select pg_temp.req('08990000-0000-0000-0000-0000000000b3', %L, %L, null, false); select public.api_client_request_guard()$f$, method, path),
  'AC-CLIG-005 an app session (no client_id) is not decided by the guard for ' || method || ' ' || path) from targets order by path;

-- AC-CLIG-004: the column trigger, an Admin token PATCHing as PostgREST would (path /<table>).
-- Allowed columns change (7).
select lives_ok(
  format($f$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'PATCH', %L, 'handling=strict,max-affected=1'); update public.%I set %I = %s where id = %L$f$,
    '/' || tbl, tbl, col, val, id),
  'AC-CLIG-004 an Admin token may change ' || tbl || '.' || col) from cols order by tbl, col;
select is((select rate from boq_items where id = '08990000-0000-0000-0000-0000000000e1'), 1500::numeric, 'AC-CLIG-004 the allowed change was written (boq_items.rate)');
select is((select budgeted_amount from budget_line_items where id = '08990000-0000-0000-0000-0000000000f1'), 650::numeric, 'AC-CLIG-004 the allowed change was written (budget_line_items.budgeted_amount)');
-- Any other column is refused with the trigger's own message, whichever column it is: the whole row is compared (8).
select throws_ok(
  format($f$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'PATCH', %L, 'handling=strict,max-affected=1'); update public.%I set %I = %s where id = %L$f$,
    '/' || tbl, tbl, col, val, id),
  '42501', 'OAuth API clients may change only ' || case tbl when 'boq_items' then 'description, unit, quantity, rate, earning_basis' else 'budgeted_amount, description' end || ' on ' || tbl,
  'AC-CLIG-004 an Admin token may not change ' || tbl || '.' || col) from refused_cols order by tbl, col;
-- An allowed and a refused column in one request: refused, and the allowed one is not written (2).
select throws_ok($$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'PATCH', '/boq_items', 'handling=strict,max-affected=1'); update public.boq_items set rate = 7777, line_no = 8 where id = '08990000-0000-0000-0000-0000000000e1'$$,
  '42501', null, 'AC-CLIG-004 a PATCH mixing an allowed and a refused column is refused');
select is((select rate from boq_items where id = '08990000-0000-0000-0000-0000000000e1'), 1500::numeric, 'AC-CLIG-004 the refused PATCH wrote nothing');
-- A write of the same value to a refused column is not a change, so it passes (1).
select lives_ok($$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'PATCH', '/boq_items', 'handling=strict,max-affected=1'); update public.boq_items set line_no = line_no, rate = 1500 where id = '08990000-0000-0000-0000-0000000000e1'$$,
  'AC-CLIG-004 writing a refused column its own value is no change');

-- AC-CLIG-005: an app session edits the same columns freely (where row security allows it) (6).
select lives_ok($$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'PATCH', '/boq_items', null, false); update public.boq_items set item_code = 'CG-1A', line_no = 11 where id = '08990000-0000-0000-0000-0000000000e1'$$,
  'AC-CLIG-005 an app session may change item_code and line_no');
select is((select item_code || line_no::text from boq_items where id = '08990000-0000-0000-0000-0000000000e1'), 'CG-1A11', 'AC-CLIG-005 the app session change was written');
select lives_ok($$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'PATCH', '/budget_line_items', null, false); update public.budget_line_items set category = 'Materials', actual_amount = 5 where id = '08990000-0000-0000-0000-0000000000f1'$$,
  'AC-CLIG-005 an app session may change category and actual_amount');
select is((select category::text || actual_amount::int::text from budget_line_items where id = '08990000-0000-0000-0000-0000000000f1'), 'Materials5', 'AC-CLIG-005 the app session change was written (budget line)');
-- A marker the caller can put in a header or a setting does not make an app session a token, and does not switch the trigger off for a token.
select lives_ok($$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'PATCH', '/boq_items', null, false, '{"client_id":"pmo-cli","x-client-id":"pmo-cli"}'); select set_config('request.jwt.claim.client_id', 'pmo-cli', true); update public.boq_items set line_no = 12 where id = '08990000-0000-0000-0000-0000000000e1'$$,
  'AC-CLIG-005 a client_id header or setting does not turn an app session into a token');
select throws_ok($$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'PATCH', '/boq_items', 'handling=strict,max-affected=1', true, '{"x-client-id":"","client_id":"","x-pmo-app-session":"1","prefer":"x"}'); select set_config('request.jwt.claim.client_id', '', true); update public.boq_items set line_no = 13 where id = '08990000-0000-0000-0000-0000000000e1'$$,
  '42501', null, 'AC-CLIG-005 a header or setting the caller sets does not turn the trigger off for a token');

-- AC-CLIG-006: the existing Draft guard still decides a budget line on a non-Draft version (2); a definer RPC's own update is not limited (2).
select throws_ok($$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'PATCH', '/budget_line_items', 'handling=strict,max-affected=1'); update public.budget_line_items set budgeted_amount = 999 where id = '08990000-0000-0000-0000-0000000000f2'$$,
  'P0001', null, 'AC-CLIG-006 an allowed column on a non-Draft version is still refused by the Draft guard');
select is((select budgeted_amount from budget_line_items where id = '08990000-0000-0000-0000-0000000000f2'), 700::numeric, 'AC-CLIG-006 the non-Draft line is unchanged');
select lives_ok($$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'POST', '/rpc/recategorise_budget_lines', null); update public.budget_line_items set category = 'Labor', actual_amount = 3 where id = '08990000-0000-0000-0000-0000000000f1'$$,
  'AC-CLIG-006 an update made inside an rpc call (path /rpc/…) is not limited by the column trigger');
select is((select category::text from budget_line_items where id = '08990000-0000-0000-0000-0000000000f1'), 'Labor', 'AC-CLIG-006 the rpc-path update was written');

-- The trigger sorts first among the BEFORE UPDATE triggers of both tables (2).
select is((select tgname from pg_trigger where tgrelid = 'public.boq_items'::regclass and not tgisinternal and tgtype & 2 = 2 and tgtype & 16 = 16 order by tgname limit 1),
  'boq_items_00_api_client_columns', 'AC-CLIG-004 the boq_items column trigger runs first');
select is((select tgname from pg_trigger where tgrelid = 'public.budget_line_items'::regclass and not tgisinternal and tgtype & 2 = 2 and tgtype & 16 = 16 order by tgname limit 1),
  'budget_line_items_00_api_client_columns', 'AC-CLIG-004 the budget_line_items column trigger runs first');
select is((select prosrc like '%history_import_rpcs%' and prosrc like '%correction_patch_tables%' from pg_proc where oid = 'public.api_client_request_guard()'::regprocedure), true, 'AC-CLIG-001 the latest guard lists the new tier');

select * from finish();
rollback;
