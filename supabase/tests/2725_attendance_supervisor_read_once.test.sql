-- 2725 (#2922): the supervisor's attendance read, decided once per query. Old per-row policy vs the new one, same rows for every role.
-- Mutation: drop `t.ok` from supervisor_task_issue_work_orders (E1 sees rows); drop the date window (S4 sees rows);
--           drop the membership test from the policy (S3 sees all rows); drop assert_not_light (the field account is no longer refused by the body).
begin;
create extension if not exists pgtap;
select plan(42);

insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled) values
  ('27250000-0000-0000-0000-00000000000a', 'Once Org A', 'IDR', 'UTC', true),
  ('27250000-0000-0000-0000-00000000000b', 'Once Org B', 'IDR', 'UTC', true);
insert into auth.users (id, email)
select ('27250000-0000-0000-0000-0000000000' || k)::uuid, 'once-' || k || '@example.com'
  from unnest(array['a1','a2','a3','a4','a5','a6','a7','a8','a9','b1']) k;
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('27250000-0000-0000-0000-0000000000a1', '27250000-0000-0000-0000-00000000000a', 'Admin',  'once-a1@example.com', 'Admin', 'active', null),
  ('27250000-0000-0000-0000-0000000000a2', '27250000-0000-0000-0000-00000000000a', 'S1 owns', 'once-a2@example.com', 'Engineer', 'active', 'site_supervisor'),
  ('27250000-0000-0000-0000-0000000000a3', '27250000-0000-0000-0000-00000000000a', 'S2 crew', 'once-a3@example.com', 'Engineer', 'active', 'site_supervisor'),
  ('27250000-0000-0000-0000-0000000000a4', '27250000-0000-0000-0000-00000000000a', 'S3 none', 'once-a4@example.com', 'Engineer', 'active', 'site_supervisor'),
  ('27250000-0000-0000-0000-0000000000a5', '27250000-0000-0000-0000-00000000000a', 'S4 past', 'once-a5@example.com', 'Engineer', 'active', 'site_supervisor'),
  ('27250000-0000-0000-0000-0000000000a6', '27250000-0000-0000-0000-00000000000a', 'PM',      'once-a6@example.com', 'Project Manager', 'active', null),
  ('27250000-0000-0000-0000-0000000000a7', '27250000-0000-0000-0000-00000000000a', 'E1 no key', 'once-a7@example.com', 'Engineer', 'active', null),
  ('27250000-0000-0000-0000-0000000000a8', '27250000-0000-0000-0000-00000000000a', 'Field',   'once-a8@example.com', 'Engineer', 'active', 'field_user'),
  ('27250000-0000-0000-0000-0000000000a9', '27250000-0000-0000-0000-00000000000a', 'S5 disabled', 'once-a9@example.com', 'Engineer', 'active', 'site_supervisor'),
  ('27250000-0000-0000-0000-0000000000b1', '27250000-0000-0000-0000-00000000000b', 'Other org supervisor', 'once-b1@example.com', 'Engineer', 'active', 'site_supervisor');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, project_manager_id) values
  ('27250000-0000-0000-0000-0000000000c1', '27250000-0000-0000-0000-00000000000a', 'Once project', 'Ongoing Project', 'IDR', 1000000, 'exclusive', 0, '27250000-0000-0000-0000-0000000000a6');
insert into people (id, org_id, code, name) values
  ('27250000-0000-0000-0000-000000000051', '27250000-0000-0000-0000-00000000000a', 'W1', 'Worker one');

-- 30 work orders: 1-8 S1 responsible; 9-16 S2 leads the rostered crew; 17-20 nobody; 21-24 S4 responsible but the window has closed;
-- 25-28 E1 (no supervisor key) responsible; 29-30 S1 responsible but the window has not opened; 31-32 S5 (disabled) responsible.
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount, responsible_person_id, start_date, end_date)
select ('27250000-0000-0000-0000-0000000010' || lpad(n::text, 2, '0'))::uuid, '27250000-0000-0000-0000-00000000000a',
       '27250000-0000-0000-0000-0000000000c1', 'WO ' || n, 'Draft', 10000, 'exclusive', 0,
       case when n <= 8 or n in (29, 30) then '27250000-0000-0000-0000-0000000000a2'::uuid
            when n between 21 and 24 then '27250000-0000-0000-0000-0000000000a5'::uuid
            when n between 25 and 28 then '27250000-0000-0000-0000-0000000000a7'::uuid
            when n between 31 and 32 then '27250000-0000-0000-0000-0000000000a9'::uuid end,
       case when n in (29, 30) then current_date + 3 when n between 21 and 24 then current_date - 20 else current_date - 5 end,
       case when n in (29, 30) then current_date + 9 when n between 21 and 24 then current_date - 2 else current_date + 5 end
  from generate_series(1, 32) n;
insert into crews (id, org_id, code, name, field_controller_id)
select ('27250000-0000-0000-0000-0000000020' || lpad(n::text, 2, '0'))::uuid, '27250000-0000-0000-0000-00000000000a', 'C' || n, 'Crew ' || n,
       case when n between 9 and 16 then '27250000-0000-0000-0000-0000000000a3'::uuid end
  from generate_series(1, 32) n;
insert into work_order_crews (org_id, work_order_id, crew_id, valid_from)
select '27250000-0000-0000-0000-00000000000a', ('27250000-0000-0000-0000-0000000010' || lpad(n::text, 2, '0'))::uuid,
       ('27250000-0000-0000-0000-0000000020' || lpad(n::text, 2, '0'))::uuid, current_date - 10
  from generate_series(1, 32) n;
insert into attendance_days (org_id, worker_id, crew_id, work_order_id, work_date, status, hours, source, project_id, recorded_by, approved_by, approved_at)
select '27250000-0000-0000-0000-00000000000a', '27250000-0000-0000-0000-000000000051',
       ('27250000-0000-0000-0000-0000000020' || lpad(n::text, 2, '0'))::uuid, ('27250000-0000-0000-0000-0000000010' || lpad(n::text, 2, '0'))::uuid,
       current_date, 'present', 0.5, 'roster_tick', '27250000-0000-0000-0000-0000000000c1', '27250000-0000-0000-0000-0000000000a1',
       '27250000-0000-0000-0000-0000000000a1', now()
  from generate_series(1, 32) n;

-- the responsible person must be active when assigned; the account is disabled afterwards
update profiles set status = 'disabled' where id = '27250000-0000-0000-0000-0000000000a9';
create temp table snap (ver text, u text, src text, ids uuid[]);
create function pg_temp.take(p_ver text, p_user text) returns void language plpgsql as $$
declare a uuid[]; c uuid[];
begin
  perform set_config('request.jwt.claims', json_build_object('sub', ('27250000-0000-0000-0000-0000000000' || p_user)::uuid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select coalesce(array_agg(id order by id), '{}') into a from public.attendance_days;
  select coalesce(array_agg(record_id order by record_id), '{}') into c from public.work_order_cost_lines where source = 'attendance_day';
  execute 'reset role';
  insert into snap values (p_ver, p_user, 'attendance', a), (p_ver, p_user, 'cost', c);
end $$;
create function pg_temp.take_all(p_ver text) returns void language plpgsql as $$
declare u text;
begin foreach u in array array['a1','a2','a3','a4','a5','a6','a7','a8','a9','b1'] loop perform pg_temp.take(p_ver, u); end loop; end $$;

select pg_temp.take_all('new');
-- the per-row policy of 2384, restored for the comparison
alter policy supervisor_attendance_read on public.attendance_days
  using ((select public.is_active_member()) and org_id = (select public.auth_org_id()) and public.actor_holds_job_role('site_supervisor') and public.actor_may_task_issue(work_order_id));
select pg_temp.take_all('old');
alter policy supervisor_attendance_read on public.attendance_days
  using ((select public.is_active_member()) and org_id = (select public.auth_org_id())
         and (select public.actor_holds_job_role('site_supervisor'))
         and work_order_id in (select public.supervisor_task_issue_work_orders()));

-- same rows, old vs new, every role, both reads (the attendance table and the work order cost lines)
select is((select ids from snap where ver = 'new' and u = k and src = 'attendance'), (select ids from snap where ver = 'old' and u = k and src = 'attendance'),
          'AC-PERF-001 ' || k || ' reads the same attendance rows before and after')
  from unnest(array['a1','a2','a3','a4','a5','a6','a7','a8','a9','b1']) k;
select is((select ids from snap where ver = 'new' and u = k and src = 'cost'), (select ids from snap where ver = 'old' and u = k and src = 'cost'),
          'AC-PERF-001 ' || k || ' reads the same cost lines before and after')
  from unnest(array['a1','a2','a3','a4','a5','a6','a7','a8','a9','b1']) k;
-- and the rows are the right ones (the comparison alone would pass with two empty sets)
select is(cardinality(s.ids), v.n, 'AC-PERF-001 ' || v.u || ' sees ' || v.n || ' attendance rows')
  from (values ('a1', 32), ('a2', 8), ('a3', 8), ('a4', 0), ('a5', 0), ('a6', 32), ('a7', 0), ('a8', 0), ('a9', 0), ('b1', 0)) v(u, n)
  join snap s on s.ver = 'new' and s.u = v.u and s.src = 'attendance';
-- the set function holds exactly the rule actor_may_task_issue holds, work order by work order
create function pg_temp.set_as(p_user text) returns uuid[] language plpgsql as $$
declare a uuid[];
begin
  perform set_config('request.jwt.claims', json_build_object('sub', ('27250000-0000-0000-0000-0000000000' || p_user)::uuid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select coalesce(array_agg(w order by w), '{}') into a from public.supervisor_task_issue_work_orders() w;
  execute 'reset role';
  return a;
end $$;
create function pg_temp.rule_as(p_user text) returns uuid[] language plpgsql as $$
declare a uuid[];
begin
  perform set_config('request.jwt.claims', json_build_object('sub', ('27250000-0000-0000-0000-0000000000' || p_user)::uuid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select coalesce(array_agg(w.id order by w.id), '{}') into a from public.work_orders w where public.actor_may_task_issue(w.id);
  execute 'reset role';
  return a;
end $$;
select is(pg_temp.set_as(k), pg_temp.rule_as(k), 'AC-PERF-001 ' || k || ': the set function equals actor_may_task_issue on every work order')
  from unnest(array['a2','a3','a4','a5','a7']) k;
select is(cardinality(pg_temp.set_as('a2')), 8, 'AC-PERF-001 S1 holds 8 work orders (not the 2 not yet open)');
select throws_ok($$select pg_temp.set_as('a8')$$, '42501', null, 'AC-PERF-001 a field account is refused by the set function body');
select is(pg_temp.set_as('a9'), '{}'::uuid[], 'AC-PERF-001 a disabled supervisor holds none');
select is(pg_temp.set_as('b1'), '{}'::uuid[], 'AC-PERF-001 another organisation''s supervisor holds none');
select ok(not has_function_privilege('anon', 'public.supervisor_task_issue_work_orders()', 'execute'), 'AC-PERF-001 anon cannot run the set function');
select ok(has_function_privilege('authenticated', 'public.supervisor_task_issue_work_orders()', 'execute'), 'AC-PERF-001 a signed-in user can');
select ok((select pg_get_expr(polqual, polrelid) from pg_policy where polname = 'supervisor_attendance_read') like '%supervisor_task_issue_work_orders%',
          'AC-PERF-001 the policy decides by the set, not per row');
select * from finish();
rollback;
