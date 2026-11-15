-- 0899_cli_guard_history_corrections.test.sql — proof for 0899 (#1855, #1858): the command line may import purchase history
-- and correct two loader-written tables, as an active Admin, one row per request, in a fixed set of columns.
--
-- AC ids owned here:
--   AC-CLIG-001  an active Admin token passes the guard for POST rpc/import_purchase_history and PATCH boq_items / budget_line_items.
--   AC-CLIG-002  PM, Finance, Executive, Engineer, a disabled Admin and an anonymous token are refused, per target.
--   AC-CLIG-003  PATCH without `Prefer: handling=strict` AND `max-affected=1`, spelled exactly as PostgREST reads them (missing, no
--                strict, max-affected=10, repeated, lenient first, any other case, inner spaces) is refused; the existing upsert
--                refusal and the DELETE / other-table refusals still hold.
--   AC-CLIG-004  the column trigger lets a token change only the allowed columns and refuses EVERY other column of both tables (the
--                list is read from the catalogue), including a column added later (42501); the whole row is compared.
--   AC-CLIG-008  on the tables a token may only POST to (budget_versions, budget_category_account_map) a token POST cannot update an
--                existing row (a plain insert works; an app session, a PATCH-method request and an /rpc/ request are not limited); only
--                the one reviewed RPC path is exempt from the column and one-row triggers on boq_items and budget_line_items.
--   AC-CLIG-007  a token UPDATE that changes more than one row is refused by the statement trigger whatever the Prefer header says;
--                an app session, a zero-row update and an /rpc/ update are not limited.
--   AC-CLIG-005  an app session (no client_id) is not limited, whatever its headers say; a spoofed marker does not turn the trigger off.
--   AC-CLIG-006  a budget line on a non-Draft version is still refused by the existing Draft guard; a definer RPC's own update is not limited.
--
-- ⚑ pgTAP runs as the migration superuser; the authz assertions run under `set local role` + a JWT claim.
-- MUTATION-CHECKED (evidence file): drop the Admin check in the 0899 guard lines → AC-CLIG-002 red; drop the column trigger → AC-CLIG-004
-- red; accept max-affected=10 (substring match) → AC-CLIG-003 red; add a disallowed column to a trigger's list → AC-CLIG-004 red;
-- drop the statement trigger → AC-CLIG-007 red; drop the insert-only trigger or its method check → AC-CLIG-008 red; widen the RPC
-- exemption back to every /rpc/ path → AC-CLIG-008 red; read Prefer loosely (lower case, inner spaces stripped) → AC-CLIG-003 red.
begin;
select plan(124);

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
  ('08990000-0000-0000-0000-0000000000c2', '08990000-0000-0000-0000-0000000000a0', 'CLI guard active project', 'Ongoing Project'),
  ('08990000-0000-0000-0000-0000000000c3', '08990000-0000-0000-0000-0000000000a0', 'CLI guard empty project', 'Ongoing Project');
insert into budget_category_account_map (id, org_id, category, erp_account) values
  ('08990000-0000-0000-0000-0000000000a1', '08990000-0000-0000-0000-0000000000a0', 'Labor', 'CG-ACC-1');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate, line_no, import_key) values
  ('08990000-0000-0000-0000-0000000000e1', '08990000-0000-0000-0000-0000000000a0', '08990000-0000-0000-0000-0000000000c1', 'CG-1', 'Survey', 'km', 10, 1000, 1, 'k-1'),
  ('08990000-0000-0000-0000-0000000000e2', '08990000-0000-0000-0000-0000000000a0', '08990000-0000-0000-0000-0000000000c1', 'CG-2', 'Build', 'unit', 5, 2000, 2, 'k-2');
insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('08990000-0000-0000-0000-0000000000d1', '08990000-0000-0000-0000-0000000000a0', '08990000-0000-0000-0000-0000000000c1', 1, 'Draft v1', 'Draft'),
  ('08990000-0000-0000-0000-0000000000d2', '08990000-0000-0000-0000-0000000000a0', '08990000-0000-0000-0000-0000000000c2', 1, 'Active v1', 'Draft');
insert into budget_line_items (id, org_id, budget_version_id, category, description, budgeted_amount, actual_amount, fiscal_year) values
  ('08990000-0000-0000-0000-0000000000f1', '08990000-0000-0000-0000-0000000000a0', '08990000-0000-0000-0000-0000000000d1', 'Labor', 'Draft line', 500, 0, '2026'),
  ('08990000-0000-0000-0000-0000000000f2', '08990000-0000-0000-0000-0000000000a0', '08990000-0000-0000-0000-0000000000d2', 'Labor', 'Active line', 700, 0, '2026'),
  ('08990000-0000-0000-0000-0000000000f3', '08990000-0000-0000-0000-0000000000a0', '08990000-0000-0000-0000-0000000000d1', 'Materials', 'Second draft line', 300, 0, '2026');
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
  ('lenient', 'handling=lenient,max-affected=1'), ('return only', 'return=representation'),
  ('mixed-case tokens', 'Handling=Strict, Max-Affected=1'), ('upper-case value', 'handling=STRICT,max-affected=1'),
  ('inner spaces', 'handling = strict, max-affected = 1'), ('space before value', 'handling= strict,max-affected=1'),
  ('lenient first', 'handling=lenient,handling=strict,max-affected=1'), ('max-affected with a leading zero', 'handling=strict,max-affected=01');
create temp table cols(tbl text, id uuid, col text, val text) on commit drop;
insert into cols values
  ('boq_items', '08990000-0000-0000-0000-0000000000e1', 'description', '''Survey (fixed)'''),
  ('boq_items', '08990000-0000-0000-0000-0000000000e1', 'unit', '''m'''),
  ('boq_items', '08990000-0000-0000-0000-0000000000e1', 'quantity', '12'),
  ('boq_items', '08990000-0000-0000-0000-0000000000e1', 'rate', '1500'),
  ('boq_items', '08990000-0000-0000-0000-0000000000e1', 'earning_basis', '''unit_rate'''),
  ('budget_line_items', '08990000-0000-0000-0000-0000000000f1', 'budgeted_amount', '650'),
  ('budget_line_items', '08990000-0000-0000-0000-0000000000f1', 'description', '''Draft line (fixed)''');
-- Every column of both tables that is not allowed, read from the catalogue (so a column added later is covered): the statement that
-- changes it, whether `authenticated` holds UPDATE on it (no grant = refused before the trigger), and the refusal expected.
create or replace function pg_temp.bump(p_col text, p_type text, p_udt text) returns text language sql as $$
select case
  when p_type in ('text', 'character varying') then format('coalesce(%I, '''') || ''x''', p_col)
  when p_type in ('numeric', 'integer', 'bigint', 'smallint', 'double precision', 'real') then format('coalesce(%I, 0) + 1', p_col)
  when p_type = 'uuid' then 'gen_random_uuid()'
  when p_type like 'timestamp%' then format('coalesce(%I, now()) + interval ''1 day''', p_col)
  when p_type = 'date' then format('coalesce(%I, current_date) + 1', p_col)
  when p_type = 'boolean' then format('not coalesce(%I, false)', p_col)
  when p_type = 'USER-DEFINED' then format('(select e from unnest(enum_range(null::public.%I)) e where e is distinct from %I limit 1)', p_udt, p_col)
  when p_type in ('jsonb', 'json') then format('coalesce(%I, ''{}''::jsonb) || ''{"zz":1}''', p_col)
end $$;
create temp table refused_cols on commit drop as
select c.table_name::text as tbl, c.column_name::text as col, pg_temp.bump(c.column_name::text, c.data_type::text, c.udt_name::text) as expr,
  has_column_privilege('authenticated', format('public.%I', c.table_name), c.column_name::text, 'update') as granted,
  case c.table_name when 'boq_items' then '08990000-0000-0000-0000-0000000000e1' else '08990000-0000-0000-0000-0000000000f1' end::uuid as id,
  '42501: OAuth API clients may change only ' || case c.table_name when 'boq_items' then 'description, unit, quantity, rate, earning_basis'
    else 'budgeted_amount, description' end || ' on ' || c.table_name as expected
from information_schema.columns c
where c.table_schema = 'public' and c.table_name in ('boq_items', 'budget_line_items')
  and c.column_name::text <> all (case c.table_name when 'boq_items' then array['description', 'unit', 'quantity', 'rate', 'earning_basis']
    else array['budgeted_amount', 'description'] end);
-- Runs one change as the caller inside a sub-transaction and reports the outcome ('updated' or sqlstate: message).
create or replace function pg_temp.try_col(p_tbl text, p_col text, p_expr text, p_id uuid) returns text language plpgsql as $$
begin
  execute format('update public.%I set %I = %s where id = %L', p_tbl, p_col, p_expr, p_id);
  return 'updated';
exception when others then return sqlstate || ': ' || sqlerrm;
end $$;
grant all on function pg_temp.try_col(text, text, text, uuid) to public;
grant select on subjects, targets, bad_prefer, cols, refused_cols to public;
set local role authenticated;

-- AC-CLIG-001: active Admin token → passes (3).
select lives_ok(
  format($f$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', %L, %L, %L); select public.api_client_request_guard()$f$, method, path, prefer),
  'AC-CLIG-001 active Admin token passes the guard for ' || method || ' ' || path) from targets order by path;
-- Spaces around a token are trimmed, as PostgREST trims them, and extra tokens are fine (1).
select lives_ok($$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'PATCH', '/boq_items', E'return=representation,  handling=strict ,\tmax-affected=1 '); select public.api_client_request_guard()$$,
  'AC-CLIG-001 Prefer tokens trimmed at their ends and extra tokens still pass');
-- The exact header #1858's command sends, and the same with ', ' separators, on both tables (4).
select lives_ok(
  format($f$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'PATCH', %L, %L); select public.api_client_request_guard()$f$, t.path, h.prefer),
  'AC-CLIG-001 Prefer ' || h.label || ' passes for PATCH ' || t.path)
from (values ('/boq_items'), ('/budget_line_items')) t(path)
cross join (values ('as the correction command sends it (no spaces after commas)', 'return=representation,handling=strict,max-affected=1'),
  ('with spaces after commas', 'return=representation, handling=strict, max-affected=1')) h(label, prefer) order by t.path, h.prefer;

-- AC-CLIG-002: every other subject, per target (6 x 3 = 18).
select throws_ok(
  format($f$select pg_temp.req(%L, %L, %L, %L); select public.api_client_request_guard()$f$, s.sub, t.method, t.path, t.prefer),
  '42501', null, 'AC-CLIG-002 ' || s.label || ' token is refused for ' || t.method || ' ' || t.path)
from subjects s cross join targets t order by s.label, t.path;

-- AC-CLIG-003: the Prefer rule, both tables (15 x 2 = 30).
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
-- Every other column, read from the catalogue, is refused with the trigger's own message (a column without an UPDATE grant is
-- refused by permission, before the trigger) (4). Each outcome that differs is listed in the failure output.
select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'PATCH', '/boq_items', 'handling=strict,max-affected=1');
select cmp_ok((select count(*)::int from refused_cols where granted), '>=', 8, 'AC-CLIG-004 the catalogue lists the refused columns (granted)');
select is((select count(*)::int from refused_cols where expr is null), 0, 'AC-CLIG-004 every refused column has a type this test can change');
select is((select string_agg(tbl || '.' || col || ' -> ' || o, '; ' order by tbl, col) from
  (select tbl, col, expected, pg_temp.try_col(tbl, col, expr, id) as o from refused_cols where granted) r where o is distinct from expected),
  null, 'AC-CLIG-004 an Admin token may not change any column outside the allowed list (whole row compared)');
select is((select string_agg(tbl || '.' || col || ' -> ' || o, '; ' order by tbl, col) from
  (select tbl, col, pg_temp.try_col(tbl, col, expr, id) as o from refused_cols where not granted) r where o not like '42501: permission denied%'),
  null, 'AC-CLIG-004 a column without an UPDATE grant is refused before the trigger');
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

-- AC-CLIG-007: one row per request in the database, whatever the Prefer header says: each request below carries a valid header (7).
select throws_ok($$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'PATCH', '/boq_items', 'handling=strict,max-affected=1'); update public.boq_items set rate = rate + 1 where project_id = '08990000-0000-0000-0000-0000000000c1'$$,
  '42501', 'OAuth API clients may change one boq_items row per request', 'AC-CLIG-007 a token UPDATE of two contract lines is refused even with a valid Prefer');
select throws_ok($$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'PATCH', '/budget_line_items', 'handling=strict,max-affected=1'); update public.budget_line_items set budgeted_amount = budgeted_amount + 1 where budget_version_id = '08990000-0000-0000-0000-0000000000d1'$$,
  '42501', 'OAuth API clients may change one budget_line_items row per request', 'AC-CLIG-007 a token UPDATE of two budget lines is refused even with a valid Prefer');
select is((select string_agg(rate::text, ',' order by id) from boq_items where project_id = '08990000-0000-0000-0000-0000000000c1'), '1500.00,2000.00', 'AC-CLIG-007 the refused two-row UPDATE wrote nothing');
select lives_ok($$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'PATCH', '/boq_items', 'handling=strict,max-affected=1'); update public.boq_items set rate = rate + 1 where project_id = '08990000-0000-0000-0000-0000000000c1' and false$$,
  'AC-CLIG-007 a token UPDATE that matches no row is not limited');
select lives_ok($$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'PATCH', '/boq_items', null, false); update public.boq_items set line_no = coalesce(line_no, 0) + 100 where project_id = '08990000-0000-0000-0000-0000000000c1'$$,
  'AC-CLIG-007 an app session may update several rows in one statement');
select lives_ok($$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'POST', '/rpc/recategorise_budget_lines', null); update public.budget_line_items set description = description where budget_version_id = '08990000-0000-0000-0000-0000000000d1'$$,
  'AC-CLIG-007 an update of several rows inside an rpc call (path /rpc/…) is not limited');
select is((select count(*)::int from pg_trigger where tgname in ('boq_items_01_api_client_one_row', 'budget_line_items_01_api_client_one_row')
  and tgtype & 1 = 0 and tgtype & 2 = 0 and tgtype & 16 = 16), 2, 'AC-CLIG-007 the one-row triggers are AFTER UPDATE statement triggers on both tables');

-- AC-CLIG-008: a token POST cannot update an existing row of a table it may only POST to. budget_category_account_map first, as the
-- authenticated role (6 + 2 inserts + 1 check).
select throws_ok($$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'POST', '/budget_category_account_map', 'return=representation'); update public.budget_category_account_map set erp_account = erp_account || 'x' where id = '08990000-0000-0000-0000-0000000000a1'$$,
  '42501', 'OAuth API clients may only insert into budget_category_account_map', 'AC-CLIG-008 a token POST that updates a budget_category_account_map row is refused');
select throws_ok($$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'POST', '/budget_category_account_map', 'return=representation'); insert into public.budget_category_account_map (id, category, erp_account) values ('08990000-0000-0000-0000-0000000000a1', 'Labor', 'CG-ACC-2') on conflict (id) do update set erp_account = excluded.erp_account$$,
  '42501', 'OAuth API clients may only insert into budget_category_account_map', 'AC-CLIG-008 a token POST with an insert-or-update on budget_category_account_map is refused');
select lives_ok($$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'POST', '/budget_category_account_map', 'return=representation'); insert into public.budget_category_account_map (category, erp_account) values ('Materials', 'CG-ACC-3')$$,
  'AC-CLIG-008 a plain token insert into budget_category_account_map still works');
select lives_ok($$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'POST', '/budget_versions', 'return=representation'); insert into public.budget_versions (project_id, version, name, status) values ('08990000-0000-0000-0000-0000000000c3', 1, 'Token draft', 'Draft')$$,
  'AC-CLIG-008 a plain token insert into budget_versions still works');
select is((select erp_account from budget_category_account_map where id = '08990000-0000-0000-0000-0000000000a1'), 'CG-ACC-1', 'AC-CLIG-008 the refused requests wrote nothing');
select lives_ok($$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'POST', '/budget_category_account_map', null, false); update public.budget_category_account_map set erp_account = 'CG-ACC-1A' where id = '08990000-0000-0000-0000-0000000000a1'$$,
  'AC-CLIG-008 an app session may update a budget_category_account_map row');
select lives_ok($$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'PATCH', '/budget_category_account_map', 'handling=strict,max-affected=1'); update public.budget_category_account_map set erp_account = 'CG-ACC-1B' where id = '08990000-0000-0000-0000-0000000000a1'$$,
  'AC-CLIG-008 only a POST is limited: a PATCH-method request on budget_category_account_map is not decided by the insert-only trigger');
select lives_ok($$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'POST', '/rpc/any_rpc', null); update public.budget_category_account_map set erp_account = 'CG-ACC-1C' where id = '08990000-0000-0000-0000-0000000000a1'$$,
  'AC-CLIG-008 an update inside an rpc call on budget_category_account_map is not decided by the insert-only trigger');
-- budget_versions: the authenticated role holds no UPDATE on it today, so a token update is stopped by the grant before any trigger
-- runs. The same requests are run as the table owner (claims, method and path set as the trigger reads them), so the trigger decides
-- on its own and keeps deciding if an UPDATE grant is added later (5).
reset role;
select throws_ok($$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'POST', '/budget_versions', 'return=representation'); update public.budget_versions set status = status where id = '08990000-0000-0000-0000-0000000000d1'$$,
  '42501', 'OAuth API clients may only insert into budget_versions', 'AC-CLIG-008 a token POST that updates a budget_versions row is refused');
select throws_ok($$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'POST', '/budget_versions', 'return=representation'); insert into public.budget_versions (id, project_id, version, name, status) values ('08990000-0000-0000-0000-0000000000d1', '08990000-0000-0000-0000-0000000000c1', 1, 'Upserted', 'Draft') on conflict (id) do update set status = excluded.status$$,
  '42501', 'OAuth API clients may only insert into budget_versions', 'AC-CLIG-008 a token POST with an insert-or-update on budget_versions is refused');
select lives_ok($$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'POST', '/budget_versions', null, false); update public.budget_versions set status = status where id = '08990000-0000-0000-0000-0000000000d1'$$,
  'AC-CLIG-008 an app session may update a budget_versions row');
select lives_ok($$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'PATCH', '/budget_versions', 'handling=strict,max-affected=1'); update public.budget_versions set status = status where id = '08990000-0000-0000-0000-0000000000d1'$$,
  'AC-CLIG-008 only a POST is limited: a PATCH-method request on budget_versions is not decided by the insert-only trigger');
select lives_ok($$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'POST', '/rpc/any_rpc', null); update public.budget_versions set status = status where id = '08990000-0000-0000-0000-0000000000d1'$$,
  'AC-CLIG-008 an update inside an rpc call on budget_versions is not decided by the insert-only trigger');
set local role authenticated;
select is((select count(*)::int from pg_trigger where tgname in ('budget_versions_00_api_client_insert_only', 'budget_category_account_map_00_api_client_insert_only')
  and tgtype & 1 = 1 and tgtype & 2 = 2 and tgtype & 16 = 16), 2, 'AC-CLIG-008 the insert-only triggers are BEFORE UPDATE row triggers on both tables');
-- Every table the guard lets a token POST to but not PATCH (its GET+POST lists, minus the two correction tables) has the insert-only
-- trigger, so a table added to those lists later fails here until it gets one; and the set may not be empty, so a changed list
-- format that finds no table cannot pass vacuously (2).
create temp table post_only_tables on commit drop as
select distinct btrim(x, ' ''') as t
from pg_proc p, lateral regexp_matches(p.prosrc, '(?:admin_write_tables|account_map_tables) constant text\[\] := array\[([^\]]*)\]', 'g') m,
  lateral unnest(string_to_array(m[1], ',')) x
where p.oid = 'public.api_client_request_guard()'::regprocedure and btrim(x, ' ''') not in ('boq_items', 'budget_line_items');
select cmp_ok((select count(*)::int from post_only_tables), '>=', 2, 'AC-CLIG-008 the guard lists at least the two POST-only tables (budget_versions, budget_category_account_map)');
select is((select string_agg(t, ', ' order by t) from post_only_tables l
  where not exists (select 1 from pg_trigger g where g.tgrelid = ('public.' || l.t)::regclass and g.tgname = l.t || '_00_api_client_insert_only')),
  null, 'AC-CLIG-008 every table a token may only POST to has the insert-only trigger');
-- Only the one reviewed RPC path is exempt from the column and one-row triggers (2).
select throws_ok($$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'POST', '/rpc/any_other_rpc', null); update public.budget_line_items set category = 'Materials' where id = '08990000-0000-0000-0000-0000000000f1'$$,
  '42501', 'OAuth API clients may change only budgeted_amount, description on budget_line_items', 'AC-CLIG-008 an update inside any other rpc call is still limited to the allowed columns');
select throws_ok($$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'POST', '/rpc/any_other_rpc', null); update public.budget_line_items set description = description where budget_version_id = '08990000-0000-0000-0000-0000000000d1'$$,
  '42501', 'OAuth API clients may change one budget_line_items row per request', 'AC-CLIG-008 an update of several rows inside any other rpc call is still refused');

-- AC-CLIG-004 (added column): a column added later is refused to a token by default; an app session can still change it (4).
-- DDL is rolled back with the test; the column is granted to authenticated as a migration that adds a column would grant it.
reset role;
alter table public.boq_items add column zz_probe int;
alter table public.budget_line_items add column zz_probe int;
grant update (zz_probe) on public.boq_items, public.budget_line_items to authenticated;
set local role authenticated;
select throws_ok($$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'PATCH', '/boq_items', 'handling=strict,max-affected=1'); update public.boq_items set zz_probe = 1 where id = '08990000-0000-0000-0000-0000000000e1'$$,
  '42501', 'OAuth API clients may change only description, unit, quantity, rate, earning_basis on boq_items', 'AC-CLIG-004 a column added to boq_items later is refused to a token');
select throws_ok($$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'PATCH', '/budget_line_items', 'handling=strict,max-affected=1'); update public.budget_line_items set zz_probe = 1 where id = '08990000-0000-0000-0000-0000000000f1'$$,
  '42501', 'OAuth API clients may change only budgeted_amount, description on budget_line_items', 'AC-CLIG-004 a column added to budget_line_items later is refused to a token');
select lives_ok($$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'PATCH', '/boq_items', null, false); update public.boq_items set zz_probe = 1 where id = '08990000-0000-0000-0000-0000000000e1'$$,
  'AC-CLIG-004 an app session may change the added column of boq_items');
select lives_ok($$select pg_temp.req('08990000-0000-0000-0000-0000000000b1', 'PATCH', '/budget_line_items', null, false); update public.budget_line_items set zz_probe = 1 where id = '08990000-0000-0000-0000-0000000000f1'$$,
  'AC-CLIG-004 an app session may change the added column of budget_line_items');

-- The trigger sorts first among the BEFORE UPDATE triggers of both tables (2).
select is((select tgname from pg_trigger where tgrelid = 'public.boq_items'::regclass and not tgisinternal and tgtype & 2 = 2 and tgtype & 16 = 16 order by tgname limit 1),
  'boq_items_00_api_client_columns', 'AC-CLIG-004 the boq_items column trigger runs first');
select is((select tgname from pg_trigger where tgrelid = 'public.budget_line_items'::regclass and not tgisinternal and tgtype & 2 = 2 and tgtype & 16 = 16 order by tgname limit 1),
  'budget_line_items_00_api_client_columns', 'AC-CLIG-004 the budget_line_items column trigger runs first');
select is((select prosrc like '%history_import_rpcs%' and prosrc like '%correction_patch_tables%' from pg_proc where oid = 'public.api_client_request_guard()'::regprocedure), true, 'AC-CLIG-001 the latest guard lists the new tier');

select * from finish();
rollback;
