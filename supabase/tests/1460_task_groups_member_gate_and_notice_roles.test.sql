-- 1460_task_groups_member_gate_and_notice_roles.test.sql — #1215 field-lane policy alignment.
-- AC-TGM-008: task groups, like every business table, gate reads and writes on an active member
-- (FR-INV-003) — a member whose profile is not active reads 0 groups and changes 0 rows.
-- AC-CBS-012: the overdue-step notice goes only to roles that may read billing stages
-- (Admin, Executive, Project Manager, Finance); an Engineer-owned step notifies the Admins.
-- Fixture namespaces 46100000-… (task groups) and 46200000-… (billing steps).
begin;
select plan(17);

-- ════════════════════════════════════════════════════════════════════════════
-- AC-TGM-008: task groups require an active member.
-- ════════════════════════════════════════════════════════════════════════════
\set TG '46100000-0000-0000-0000-000000000001'
\set PM '46100000-0000-0000-0000-0000000000a1'
\set G1 '46100000-0000-0000-0000-000000000041'

insert into organizations (id, name) values (:'TG','TGM Gate Org');
insert into auth.users (id, email) values
  (:'PM','tgmg-pm@example.com'),('46100000-0000-0000-0000-0000000000a2','tgmg-eng@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  (:'PM',:'TG','TGM Gate PM','tgmg-pm@example.com','Project Manager','active'),
  ('46100000-0000-0000-0000-0000000000a2',:'TG','TGM Gate Eng','tgmg-eng@example.com','Engineer','active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('46100000-0000-0000-0000-000000000021',:'TG','TGM Gate One','Ongoing Project',:'PM');
-- The group is seeded AS TABLE OWNER so a zero-row result is a real deny, not an empty table.
insert into task_groups (id, org_id, project_id, name) values (:'G1',:'TG','46100000-0000-0000-0000-000000000021','Gate group');

-- The member loses access while holding a token: their profile is no longer active.
update profiles set status = 'disabled' where id = :'PM';

set local role authenticated;
set local request.jwt.claims = '{"sub":"46100000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is((select count(*)::int from task_groups), 0,
  'AC-TGM-008 an inactive Project Manager reads 0 task groups');
with upd as (
  update task_groups set name = 'renamed' where id = '46100000-0000-0000-0000-000000000041' returning id)
select is((select count(*)::int from upd), 0,
  'AC-TGM-008 an inactive Project Manager''s update changes 0 rows');
select throws_ok(
  $$ insert into task_groups (project_id, name) values ('46100000-0000-0000-0000-000000000021','nope') $$,
  '42501', null,
  'AC-TGM-008 an inactive Project Manager cannot insert a task group');

-- Control: the SAME member, active again, reads and writes (the deny is status-scoped, not org-scoped).
reset role;
update profiles set status = 'active' where id = '46100000-0000-0000-0000-0000000000a1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"46100000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from task_groups), 1,
  'AC-TGM-008 an active Project Manager reads the group (control — deny is status-scoped)');
with upd as (
  update task_groups set name = 'renamed by active pm' where id = '46100000-0000-0000-0000-000000000041' returning id)
select is((select count(*)::int from upd), 1,
  'AC-TGM-008 an active Project Manager renames the group (control)');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AC-CBS-012: the overdue notice reaches only roles that may read billing stages.
-- ════════════════════════════════════════════════════════════════════════════
\set ORG '46200000-0000-0000-0000-0000000000a1'
\set FIN '46200000-0000-0000-0000-0000000000b1'
\set ADM '46200000-0000-0000-0000-0000000000b3'
\set ENG '46200000-0000-0000-0000-0000000000b6'
\set CC  '46200000-0000-0000-0000-0000000000cc'
\set P1  '46200000-0000-0000-0000-0000000000c1'
\set BOQ '46200000-0000-0000-0000-000000000e01'

insert into organizations (id, name, default_currency, default_timezone) values
  (:'ORG','Notice Org','IDR','UTC');
insert into auth.users (id, email) values
  (:'FIN','notice-fin@example.com'),(:'ADM','notice-adm@example.com'),(:'ENG','notice-eng@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  (:'FIN',:'ORG','Notice Finance','notice-fin@example.com','Finance','active'),
  (:'ADM',:'ORG','Notice Admin','notice-adm@example.com','Admin','active'),
  (:'ENG',:'ORG','Notice Engineer','notice-eng@example.com','Engineer','active');
insert into companies (id, org_id, name, type) values
  (:'CC',:'ORG','Notice Client','Client');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, tax_rate,
                      tax_base_numerator, tax_base_denominator, subject_to_vat, client_id, project_manager_id) values
  (:'P1',:'ORG','Notice project','Ongoing Project','IDR',90000000,'exclusive',0,null,1,1,false,:'CC',null);
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  (:'BOQ',:'ORG',:'P1','TRENCH','Trench','m',1000,10000);

create temp table _nstate (k text primary key, v text not null) on commit drop;
grant all on _nstate to authenticated;
create function pg_temp.nst(p_k text) returns text language sql as $$ select v from _nstate where k = p_k $$;
create function pg_temp.as_user(p_user text) returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', '{"sub":"' || p_user || '","role":"authenticated"}', true);
end $$;
create function pg_temp.as_job() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;
create function pg_temp.noticed(p_user uuid, p_step text) returns int language sql as $$
  select count(*)::int from notifications n where n.owner_id = p_user
    and n.title = 'Billing step is overdue' and n.body like '%' || p_step || '%' $$;
create function pg_temp.new_claim(p_key text) returns text language plpgsql as $$
declare v uuid;
begin
  v := create_progress_claim('46200000-0000-0000-0000-0000000000c1'::uuid, 'progress',
        p_lines => jsonb_build_array(jsonb_build_object('boq_item_id', '46200000-0000-0000-0000-000000000e01', 'quantity', 1)));
  insert into _nstate values (p_key, v::text);
  return v::text;
end $$;
create function pg_temp.backdate(p_key text, p_days int) returns void language sql as $$
  update claim_billing_stages set started_on = current_date - p_days
   where claim_id = pg_temp.nst(p_key)::uuid $$;

-- Claim E: one Engineer-owned step, five-day target. Claim F: one Finance-owned step (control —
-- an allowed owner role still reaches its own holders).
select pg_temp.as_user('46200000-0000-0000-0000-0000000000b1');
select lives_ok($q$select pg_temp.new_claim('E')$q$, 'AC-CBS-012 claim E is created');
select lives_ok($q$select add_claim_billing_step(pg_temp.nst('E')::uuid, 0,
  '{"name":"Site handover","owner_role":"Engineer","target_days":5}'::jsonb)$q$,
  'AC-CBS-012 Finance sets an Engineer as a step''s owner role');
select lives_ok($q$select pg_temp.new_claim('F')$q$, 'AC-CBS-012 claim F is created');
select lives_ok($q$select add_claim_billing_step(pg_temp.nst('F')::uuid, 0,
  '{"name":"Docs review","owner_role":"Finance","target_days":5}'::jsonb)$q$,
  'AC-CBS-012 Finance sets a Finance step (control)');

select pg_temp.as_job();
select pg_temp.backdate('E', 30);
select is(notify_overdue_billing_stages(), 1,
  'AC-CBS-012 the job finds the Engineer-owned overdue step');
select is(pg_temp.noticed('46200000-0000-0000-0000-0000000000b6'::uuid, 'Site handover'), 0,
  'AC-CBS-012 an Engineer-owned step notifies no Engineer');
select is(pg_temp.noticed('46200000-0000-0000-0000-0000000000b3'::uuid, 'Site handover'), 1,
  'AC-CBS-012 an Engineer-owned step falls back to the organisation''s Admins');
select is(pg_temp.noticed('46200000-0000-0000-0000-0000000000b1'::uuid, 'Site handover'), 0,
  'AC-CBS-012 an Engineer-owned step does not reach Finance');
select pg_temp.backdate('F', 30);
select is(notify_overdue_billing_stages(), 1,
  'AC-CBS-012 the job then finds the Finance-owned overdue step');
select is(pg_temp.noticed('46200000-0000-0000-0000-0000000000b1'::uuid, 'Docs review'), 1,
  'AC-CBS-012 a Finance-owned step still reaches Finance (control — the allowed roles keep their notices)');
select is(pg_temp.noticed('46200000-0000-0000-0000-0000000000b6'::uuid, 'Docs review'), 0,
  'AC-CBS-012 a Finance-owned step does not reach Engineers');
select is(pg_temp.noticed('46200000-0000-0000-0000-0000000000b3'::uuid, 'Docs review'), 0,
  'AC-CBS-012 a Finance-owned step does not reach Admins (holders exist, no fallback)');

select * from finish();
rollback;
