-- pipeline_stage_history_read.test.sql — #1638 AC-PSH-008: stage age = latest entry's entered_on.
begin;
select plan(4);
insert into organizations (id, name) values ('16380000-0000-0000-0000-000000000003','PSH Read Org');
insert into auth.users (id, email) values ('16380000-0000-0000-0000-0000000000c2','psh-read@example.test');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('16380000-0000-0000-0000-0000000000c2','16380000-0000-0000-0000-000000000003','PSH Read','psh-read@example.test','Executive','active');
insert into projects (id, org_id, code, name, status, created_at) values
  ('16380000-0000-0000-0000-000000000030','16380000-0000-0000-0000-000000000003','PSH-R','PSH read','Leads', now() - interval '200 days');
update projects set status = 'PQ Submitted' where id = '16380000-0000-0000-0000-000000000030';
update project_stage_entries set entered_on = current_date - 100
 where project_id = '16380000-0000-0000-0000-000000000030' and stage = 'PQ Submitted';
set local role authenticated;
set local request.jwt.claims = '{"sub":"16380000-0000-0000-0000-0000000000c2","role":"authenticated"}';
select is(
  ((get_sales_pipeline())::jsonb -> 'projects' -> 0 ->> 'stage_started_at')::date, current_date - 100,
  'AC-PSH-008: get_sales_pipeline stage_started_at is the latest entry date');
select is(((get_win_rate())::jsonb ->> 'stale_count')::int, 1,
  'AC-PSH-008: get_win_rate counts the backdated bid as stale');
select is(
  ((get_sales_pipeline())::jsonb -> 'projects' -> 0 ->> 'status'), 'PQ Submitted',
  'AC-PSH-008: the latest entry stage is the current status');
reset role;
select is((select count(*)::int from projects p where p.status is distinct from
  (select e.stage from project_stage_entries e where e.project_id = p.id order by e.position desc limit 1)), 0,
  'AC-PSH-001: every project''s latest stage entry is its current status');
select * from finish();
rollback;
