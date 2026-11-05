-- 0650 budget_version_read: ONE bounded invoker read that must return exactly what the four legacy
-- reads return — complete versions, their lines (ordered, no embed object), editor ids (ordered), and
-- the shipped 0400 total — under the caller's own RLS scope, and must refuse to aggregate an oversized
-- page (explicit overflow marker + null payloads) instead of truncating or returning partial children.
begin;
select no_plan();

-- ── function contract ───────────────────────────────────────────────────────────────────────────────
select ok(to_regprocedure('public.budget_version_read(uuid, integer, integer)') is not null, 'budget_version_read(uuid,integer,integer) exists');
select is(
  (select prosecdef from pg_proc where oid = 'public.budget_version_read(uuid, integer, integer)'::regprocedure),
  false, 'security invoker — RLS stays the scope authority');
select is(
  (select provolatile from pg_proc where oid = 'public.budget_version_read(uuid, integer, integer)'::regprocedure),
  's', 'stable');
select ok(
  (select bool_or(setting like 'search_path=%') from pg_proc p, unnest(p.proconfig) setting
   where p.oid = 'public.budget_version_read(uuid, integer, integer)'::regprocedure),
  'search_path is pinned');
select ok(has_function_privilege('authenticated', 'public.budget_version_read(uuid, integer, integer)', 'execute'), 'authenticated can execute');
select ok(not has_function_privilege('anon', 'public.budget_version_read(uuid, integer, integer)', 'execute'), 'anon cannot execute');

-- page arguments are validated, never silently clamped
select throws_ok($$ select * from public.budget_version_read(null, 0, 1000) $$, '22004', null, 'a null project is rejected');
select throws_ok($$ select * from public.budget_version_read('06500000-0000-0000-0000-000000000010', -1, 1000) $$, '22023', null, 'a negative offset is rejected');
select throws_ok($$ select * from public.budget_version_read('06500000-0000-0000-0000-000000000010', 0, 0) $$, '22023', null, 'a zero limit is rejected');
select throws_ok($$ select * from public.budget_version_read('06500000-0000-0000-0000-000000000010', 0, 1001) $$, '22023', null, 'an over-maximum limit is rejected');

-- ── fixture (inserted as superuser, before role switching) ─────────────────────────────────────────
insert into public.organizations(id,name,default_currency) values
 ('06500000-0000-0000-0000-000000000001','Budget aggregate org','USD'),
 ('06500000-0000-0000-0000-000000000002','Budget aggregate other','USD');
insert into auth.users(id,email) values
 ('06500000-0000-0000-0000-0000000000a1','t650admin@example.test'),
 ('06500000-0000-0000-0000-0000000000a2','t650other@example.test'),
 ('06500000-0000-0000-0000-0000000000a3','t650finance@example.test'),
 ('06500000-0000-0000-0000-0000000000a4','t650engineer@example.test'),
 ('06500000-0000-0000-0000-0000000000a5','t650inactive@example.test');
insert into public.profiles(id,org_id,full_name,email,role,status) values
 ('06500000-0000-0000-0000-0000000000a1','06500000-0000-0000-0000-000000000001','Reader','t650admin@example.test','Admin','active'),
 ('06500000-0000-0000-0000-0000000000a2','06500000-0000-0000-0000-000000000002','Other','t650other@example.test','Admin','active'),
 ('06500000-0000-0000-0000-0000000000a3','06500000-0000-0000-0000-000000000001','Finance','t650finance@example.test','Finance','active'),
 ('06500000-0000-0000-0000-0000000000a4','06500000-0000-0000-0000-000000000001','Engineer','t650engineer@example.test','Engineer','active'),
 ('06500000-0000-0000-0000-0000000000a5','06500000-0000-0000-0000-000000000001','Inactive','t650inactive@example.test','Finance','disabled');
insert into public.projects(id,org_id,code,name,status) values
 ('06500000-0000-0000-0000-000000000010','06500000-0000-0000-0000-000000000001','BAGG65','Budget aggregate','Ongoing Project'),
 ('06500000-0000-0000-0000-000000000011','06500000-0000-0000-0000-000000000001','BAGG65-2','Budget aggregate sibling','Ongoing Project'),
 ('06500000-0000-0000-0000-000000000012','06500000-0000-0000-0000-000000000002','BAGG65-OTHER','Budget aggregate foreign','Ongoing Project'),
 ('06500000-0000-0000-0000-000000000013','06500000-0000-0000-0000-000000000001','BAGG65-BIG','Budget aggregate oversized','Ongoing Project'),
 ('06500000-0000-0000-0000-000000000014','06500000-0000-0000-0000-000000000001','BAGG65-WIRE','Budget aggregate wire budget','Ongoing Project');

-- Project A: 1001 versions. v1 = 3 fractional lines + 2 editors, v2 = zero lines, v3 = 1001 lines.
insert into public.budget_versions(id,org_id,project_id,version,name,status)
 select ('06500000-0000-0000-0001-' || lpad(i::text,12,'0'))::uuid,
 '06500000-0000-0000-0000-000000000001','06500000-0000-0000-0000-000000000010',i,'Read',(case when i <= 3 then 'Draft' else 'Archived' end)::public.budget_status
 from generate_series(1,1001) i;
insert into public.budget_line_items(org_id,budget_version_id,category,description,budgeted_amount)
values
 ('06500000-0000-0000-0000-000000000001','06500000-0000-0000-0001-000000000001','Labor','one',0.01),
 ('06500000-0000-0000-0000-000000000001','06500000-0000-0000-0001-000000000001','Materials','two',0.01),
 ('06500000-0000-0000-0000-000000000001','06500000-0000-0000-0001-000000000001','Equipment','three',9.99);
insert into public.budget_line_items(org_id,budget_version_id,category,budgeted_amount)
 select '06500000-0000-0000-0000-000000000001','06500000-0000-0000-0001-000000000003','Labor',1
 from generate_series(1,1001);
insert into public.budget_version_editors(org_id,budget_version_id,user_id) values
 ('06500000-0000-0000-0000-000000000001','06500000-0000-0000-0001-000000000001','06500000-0000-0000-0000-0000000000a3'),
 ('06500000-0000-0000-0000-000000000001','06500000-0000-0000-0001-000000000001','06500000-0000-0000-0000-0000000000a1');

-- a sibling project and a foreign-org project must never appear in the target's rows
insert into public.budget_versions(id,org_id,project_id,version,name,status) values
 ('06500000-0000-0000-0002-000000000001','06500000-0000-0000-0000-000000000001','06500000-0000-0000-0000-000000000011',1,'Sibling','Draft'),
 ('06500000-0000-0000-0003-000000000001','06500000-0000-0000-0000-000000000002','06500000-0000-0000-0000-000000000012',1,'Foreign','Draft');

-- Project B (oversized): v1 = 4001 lines (row budget), v2 = one 70 KiB description (single-row budget).
insert into public.budget_versions(id,org_id,project_id,version,name,status) values
 ('06500000-0000-0000-0004-000000000001','06500000-0000-0000-0000-000000000001','06500000-0000-0000-0000-000000000013',1,'Big','Draft'),
 ('06500000-0000-0000-0004-000000000002','06500000-0000-0000-0000-000000000001','06500000-0000-0000-0000-000000000013',2,'Huge row','Draft');
insert into public.budget_line_items(org_id,budget_version_id,category,budgeted_amount)
 select '06500000-0000-0000-0000-000000000001','06500000-0000-0000-0004-000000000001','Labor',1
 from generate_series(1,4001);
insert into public.budget_line_items(org_id,budget_version_id,category,description,budgeted_amount)
 values ('06500000-0000-0000-0000-000000000001','06500000-0000-0000-0004-000000000002','Labor',repeat('x',70000),1);

-- Project C (wire-budget witnesses). Each version is its own one-row page, so the witness isolates one
-- budget dimension: a huge but highly COMPRESSIBLE description (small physical tuple, huge JSON body),
-- oversized VERSION METADATA (unbudgeted before this fix), and JSON ESCAPING expansion (quotes double).
insert into public.budget_versions(id,org_id,project_id,version,name,status) values
 ('06500000-0000-0000-0005-000000000001','06500000-0000-0000-0000-000000000001','06500000-0000-0000-0000-000000000014',1,'Compressible','Draft'),
 ('06500000-0000-0000-0005-000000000002','06500000-0000-0000-0000-000000000001','06500000-0000-0000-0000-000000000014',2,repeat('n',70000),'Draft'),
 ('06500000-0000-0000-0005-000000000003','06500000-0000-0000-0000-000000000001','06500000-0000-0000-0000-000000000014',3,'Escaped','Draft');
insert into public.budget_line_items(org_id,budget_version_id,category,description,budgeted_amount) values
 ('06500000-0000-0000-0000-000000000001','06500000-0000-0000-0005-000000000001','Labor',repeat('x',200000),1),
 ('06500000-0000-0000-0000-000000000001','06500000-0000-0000-0005-000000000003','Labor',repeat('"',40000),1),
 ('06500000-0000-0000-0000-000000000001','06500000-0000-0000-0005-000000000002','Labor','small',1);

-- independently-visible-child witness: a line owned by org A under a version owned by org B.
-- Org A sees the LINE but not its parent; org B sees the PARENT but not the line. The aggregate must
-- match the legacy reads in BOTH cases (no extra org-equality filter on the line output).
insert into public.budget_line_items(org_id,budget_version_id,category,description,budgeted_amount) values
 ('06500000-0000-0000-0000-000000000001','06500000-0000-0000-0003-000000000001','Labor','cross-org child',77.77);

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"06500000-0000-0000-0000-0000000000a1","role":"authenticated"}',true);

-- ── completeness, order, page bounds ────────────────────────────────────────────────────────────────
select is((select count(*)::int from public.budget_version_read('06500000-0000-0000-0000-000000000010', 0, 1000)),1000,'a 1000-version page returns exactly 1000 rows');
select is(
  (select array_agg(version_no order by version_no) from public.budget_version_read('06500000-0000-0000-0000-000000000010', 1000, 1000)),
  array[1001]::integer[], 'the second page returns the 1001st version');
select is(
  (select array_agg(version_no) from public.budget_version_read('06500000-0000-0000-0000-000000000010', 0, 3)),
  array[1,2,3]::integer[], 'versions are ordered by version,id');
select is((select count(*)::int from public.budget_version_read('06500000-0000-0000-0000-000000000010', 5000, 1000)),0,'an offset past the end returns no rows');
select is((select count(*)::int from public.budget_version_read('06500000-0000-0000-0000-000000000010', 0, 1000) where version_id = '06500000-0000-0000-0002-000000000001'),0,'a sibling project never leaks in');
select is((select count(*)::int from public.budget_version_read('06500000-0000-0000-0000-000000000012', 0, 1000)),0,'a foreign-org project is invisible');

-- ── the four legacy reads, row for row ─────────────────────────────────────────────────────────────
select is(
  (select version_row::jsonb from public.budget_version_read('06500000-0000-0000-0000-000000000010', 0, 1) where version_id = '06500000-0000-0000-0001-000000000001'),
  (select to_jsonb(v) from public.budget_versions v where v.id = '06500000-0000-0000-0001-000000000001'),
  'version_row is the complete legacy version row');
select is(
  (select line_items::jsonb from public.budget_version_read('06500000-0000-0000-0000-000000000010', 0, 1) where version_id = '06500000-0000-0000-0001-000000000001'),
  (select jsonb_agg(to_jsonb(li) order by li.id) from public.budget_line_items li where li.budget_version_id = '06500000-0000-0000-0001-000000000001'),
  'line_items is the complete, id-ordered legacy line read with no embed object');
select is(
  (select editor_ids from public.budget_version_read('06500000-0000-0000-0000-000000000010', 0, 1) where version_id = '06500000-0000-0000-0001-000000000001'),
  (select array_agg(e.user_id order by e.user_id) from public.budget_version_editors e where e.budget_version_id = '06500000-0000-0000-0001-000000000001'),
  'editor_ids is the ordered legacy editor read');
select is(
  (select total from public.budget_version_read('06500000-0000-0000-0000-000000000010', 0, 3) where version_id = '06500000-0000-0000-0001-000000000001'),
  (select total from public.budget_version_read_totals('06500000-0000-0000-0000-000000000010') where version_id = '06500000-0000-0000-0001-000000000001'),
  'total is exactly the shipped 0400 aggregate on the same page');
select is((select json_array_length(line_items) from public.budget_version_read('06500000-0000-0000-0000-000000000010', 0, 1) where version_id = '06500000-0000-0000-0001-000000000001'),3,'fractional lines are all present');
select is((select total from public.budget_version_read('06500000-0000-0000-0000-000000000010', 0, 1) where version_id = '06500000-0000-0000-0001-000000000001'),10.01::numeric,'fractional total is exact, not rounded');
select is((select line_items::jsonb from public.budget_version_read('06500000-0000-0000-0000-000000000010', 0, 2) where version_id = '06500000-0000-0000-0001-000000000002'),'[]'::jsonb,'a zero-line version keeps an empty array');
select is((select editor_ids from public.budget_version_read('06500000-0000-0000-0000-000000000010', 0, 2) where version_id = '06500000-0000-0000-0001-000000000002'),'{}'::uuid[],'a no-editor version keeps an empty array');
select is((select total from public.budget_version_read('06500000-0000-0000-0000-000000000010', 0, 2) where version_id = '06500000-0000-0000-0001-000000000002'),0::numeric,'a zero-line version keeps an explicit numeric zero');
-- one version with >1000 lines is COMPLETE on its page: children are not row-capped
select is((select json_array_length(line_items) from public.budget_version_read('06500000-0000-0000-0000-000000000010', 2, 1) where version_id = '06500000-0000-0000-0001-000000000003'),1001,'all 1001 lines of one version are returned, not truncated');

-- ── oversized pages: explicit overflow marker, no aggregated payload ──────────────────────────────
select is((select count(*)::int from public.budget_version_read('06500000-0000-0000-0000-000000000013', 0, 1)),1,'an oversized row-budget page returns exactly one marker row');
select is((select overflow from public.budget_version_read('06500000-0000-0000-0000-000000000013', 0, 1)),true,'the marker says overflow');
select ok((select version_row is null and line_items is null and editor_ids is null and total is null
           from public.budget_version_read('06500000-0000-0000-0000-000000000013', 0, 1)),
          'an overflow marker carries no partial payload');
select is((select overflow from public.budget_version_read('06500000-0000-0000-0000-000000000013', 1, 1)),true,'a single oversized child row also trips the overflow marker');
select is((select count(*)::int from public.budget_version_read('06500000-0000-0000-0000-000000000013', 1, 1) where overflow),1,'the oversized single row is marked, never truncated');

-- ── guard-budget acceptance: the gate must measure the JSON WIRE text, not the physical tuple ──────
-- Recorded, not asserted: the physical tuple size is an observation only (TOAST/compression reporting is
-- representation-dependent), while the overflow assertions below are the acceptance contract.
select diag('compressible witness: physical=' ||
  coalesce((select pg_column_size(li)::text from public.budget_line_items li
    where li.budget_version_id = '06500000-0000-0000-0005-000000000001'), 'missing') ||
  ' wire_json=' ||
  coalesce((select octet_length(to_json(li)::text)::text from public.budget_line_items li
    where li.budget_version_id = '06500000-0000-0000-0005-000000000001'), 'missing'));
select is((select overflow from public.budget_version_read('06500000-0000-0000-0000-000000000014', 0, 1)),true,
  'a compressible oversized description trips the wire budget');
select is((select overflow from public.budget_version_read('06500000-0000-0000-0000-000000000014', 1, 1)),true,
  'oversized version-row metadata trips the wire budget');
select is((select overflow from public.budget_version_read('06500000-0000-0000-0000-000000000014', 2, 1)),true,
  'JSON escaping expansion (quotes/backslashes/newlines) trips the wire budget');
select is((select count(*)::int from public.budget_version_read('06500000-0000-0000-0000-000000000014', 0, 1)),1,
  'each wire-budget witness returns one marker row, never a truncated row');

-- ── role scope ─────────────────────────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims','{"sub":"06500000-0000-0000-0000-0000000000a3","role":"authenticated"}',true);
select is((select count(*)::int from public.budget_version_read('06500000-0000-0000-0000-000000000010', 0, 1000)),1000,'finance reads the same caller-visible set');
select set_config('request.jwt.claims','{"sub":"06500000-0000-0000-0000-0000000000a4","role":"authenticated"}',true);
select is((select count(*)::int from public.budget_version_read('06500000-0000-0000-0000-000000000010', 0, 1000)),1000,'an ordinary active member reads the same caller-visible set');
select set_config('request.jwt.claims','{"sub":"06500000-0000-0000-0000-0000000000a5","role":"authenticated"}',true);
select is((select count(*)::int from public.budget_version_read('06500000-0000-0000-0000-000000000010', 0, 1000)),0,'a disabled member reads no rows');
select set_config('request.jwt.claims','{"sub":"06500000-0000-0000-0000-0000000000a2","role":"authenticated"}',true);
select is((select count(*)::int from public.budget_version_read('06500000-0000-0000-0000-000000000010', 0, 1000)),0,'another org reads no rows');

-- ── cross-org child visibility matches the legacy reads in BOTH directions ────────────────────────
select set_config('request.jwt.claims','{"sub":"06500000-0000-0000-0000-0000000000a1","role":"authenticated"}',true);
select is(
  (select count(*)::int from public.budget_line_items li
    where li.budget_version_id = '06500000-0000-0000-0003-000000000001'),
  1, 'org A genuinely sees the inconsistent-org line on its own');
select is(
  (select count(*)::int from public.budget_line_items li
    join public.budget_versions v on v.id = li.budget_version_id
    where v.project_id = '06500000-0000-0000-0000-000000000012'),
  0, 'the legacy line read excludes it because its parent is invisible');
select is(
  (select count(*)::int from public.budget_version_read('06500000-0000-0000-0000-000000000012', 0, 1000)),
  0, 'the aggregate excludes it identically (no added org-equality filter)');

select * from finish();
rollback;
