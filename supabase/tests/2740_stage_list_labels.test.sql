-- 2740_stage_list_labels.test.sql: #2906 slice 1, the stage list setting (docs/specs/stage-list-setting.spec.md).
-- Mutation checks: (a) drop constraint pipeline_stage_config_label_en_check -> the two label cases go red;
-- (b) add 'Project Manager' to pipeline_stage_config_write -> the PM case goes red;
-- (c) restate seed_org_defaults with only the five pipeline rows -> the new-org count goes red.
begin;
select plan(14);

insert into auth.users (id, email) values
  ('27400000-0000-0000-0000-0000000000a1','stg-admin@example.com'),
  ('27400000-0000-0000-0000-0000000000a2','stg-pm@example.com'),
  ('27400000-0000-0000-0000-0000000000a3','stg-field@example.com'),
  ('27400000-0000-0000-0000-0000000000b1','stg-admin-b@example.com');
insert into organizations (id, name, default_currency, built_in_roles_enabled) values
  ('27400000-0000-0000-0000-000000000001','STG Org A','IDR',true),
  ('27400000-0000-0000-0000-000000000002','STG Org B','IDR',true);
insert into profiles (id, org_id, full_name, email, role) values
  ('27400000-0000-0000-0000-0000000000a1','27400000-0000-0000-0000-000000000001','STG Admin','stg-admin@example.com','Admin'),
  ('27400000-0000-0000-0000-0000000000a2','27400000-0000-0000-0000-000000000001','STG PM','stg-pm@example.com','Project Manager'),
  ('27400000-0000-0000-0000-0000000000a3','27400000-0000-0000-0000-000000000001','STG Field','stg-field@example.com','Engineer'),
  ('27400000-0000-0000-0000-0000000000b1','27400000-0000-0000-0000-000000000002','STG Admin B','stg-admin-b@example.com','Admin');
update profiles set built_in_role = 'field_user' where id = '27400000-0000-0000-0000-0000000000a3';

-- AC-STG-001: the migration gave every existing organisation twelve rows, probabilities on the pipeline five only.
select is((select count(*)::int from pipeline_stage_config where org_id = '00000000-0000-0000-0000-000000000001'), 12,
  'AC-STG-001 the seed organisation has one row per stage key');
select is((select json_agg(win_probability order by array_position(public.pipeline_project_statuses(), status::text))::text
             from pipeline_stage_config where org_id = '00000000-0000-0000-0000-000000000001'
              and status::text = any (public.pipeline_project_statuses())),
  '[0.100, 0.200, 0.400, 0.800, 0.900]', 'AC-STG-001 the five pipeline probabilities are unchanged');
select is((select count(*)::int from pipeline_stage_config where org_id = '00000000-0000-0000-0000-000000000001'
             and win_probability is null), 7, 'AC-STG-001 the seven other stages hold no probability');
select is((select count(*)::int from pipeline_stage_config where label_en is not null or label_id is not null), 0,
  'AC-STG-001 no organisation has a stage name: everyone keeps the shipped wording');

-- AC-STG-004: a new organisation gets the same twelve rows (seed_org_defaults).
select public.seed_org_defaults('27400000-0000-0000-0000-000000000001');
select public.seed_org_defaults('27400000-0000-0000-0000-000000000002');
select is((select count(*)::int from pipeline_stage_config where org_id = '27400000-0000-0000-0000-000000000001'), 12,
  'AC-STG-004 a new organisation has one row per stage key');
select is((select win_probability from pipeline_stage_config
            where org_id = '27400000-0000-0000-0000-000000000001' and status = 'Negotiation'), 0.900::numeric,
  'AC-STG-004 the new organisation keeps the 0591 Negotiation default');

-- AC-STG-002: the database refuses a pipeline row without a probability and a malformed name.
select throws_ok($$ update pipeline_stage_config set win_probability = null
                     where org_id = '27400000-0000-0000-0000-000000000001' and status = 'Leads' $$,
  '23514', null, 'AC-STG-002 a pipeline stage keeps its probability');
select throws_ok($$ update pipeline_stage_config set label_en = '   '
                     where org_id = '27400000-0000-0000-0000-000000000001' and status = 'Leads' $$,
  '23514', null, 'AC-STG-002 a blank name is refused (blank is stored as null)');
select throws_ok($$ update pipeline_stage_config set label_id = repeat('x', 41)
                     where org_id = '27400000-0000-0000-0000-000000000001' and status = 'Leads' $$,
  '23514', null, 'AC-STG-002 a name over 40 characters is refused');

-- AC-STG-005 fixture: a deal at Tender Submitted, and its stage history before the rename.
insert into projects (id, org_id, name, status) values
  ('27400000-0000-0000-0000-000000000010','27400000-0000-0000-0000-000000000001','STG Deal','Tender Submitted');
create temp table stg_before as
  select count(*)::int as entries from project_stage_entries where project_id = '27400000-0000-0000-0000-000000000010';
grant select on stg_before to authenticated;

-- AC-STG-003: only an active Admin of the organisation renames.
set local role authenticated;
set local request.jwt.claims = '{"sub":"27400000-0000-0000-0000-0000000000a1","role":"authenticated"}';
update pipeline_stage_config set label_en = 'Bid sent', label_id = 'Penawaran dikirim' where status = 'Tender Submitted';
set local request.jwt.claims = '{"sub":"27400000-0000-0000-0000-0000000000a2","role":"authenticated"}';
update pipeline_stage_config set label_en = 'PM name' where status = 'Leads';
set local request.jwt.claims = '{"sub":"27400000-0000-0000-0000-0000000000a3","role":"authenticated"}';
update pipeline_stage_config set label_en = 'Field name' where status = 'Negotiation';
set local request.jwt.claims = '{"sub":"27400000-0000-0000-0000-0000000000b1","role":"authenticated"}';
update pipeline_stage_config set label_en = 'Other org name'
  where org_id = '27400000-0000-0000-0000-000000000001' and status = 'On Hold';
reset role;

select is((select label_en || ' / ' || label_id from pipeline_stage_config
            where org_id = '27400000-0000-0000-0000-000000000001' and status = 'Tender Submitted'),
  'Bid sent / Penawaran dikirim', 'AC-STG-003 the Admin''s names are stored');
select is((select count(*)::int from pipeline_stage_config
            where org_id = '27400000-0000-0000-0000-000000000001' and status in ('Leads','Negotiation','On Hold')
              and label_en is not null), 0,
  'AC-STG-003 a Project Manager, a field account and another organisation''s Admin change nothing');
select is((select count(*)::int from pipeline_stage_config
            where org_id = '27400000-0000-0000-0000-000000000002' and label_en is not null), 0,
  'AC-STG-003 the other organisation''s own rows are untouched');

-- AC-STG-005: a rename changes no stored data.
select is((select status::text from projects where id = '27400000-0000-0000-0000-000000000010'), 'Tender Submitted',
  'AC-STG-005 the deal''s stored status is unchanged by the rename');
select is((select count(*)::int from project_stage_entries where project_id = '27400000-0000-0000-0000-000000000010'),
  (select entries from stg_before), 'AC-STG-005 the deal''s stage history is unchanged by the rename');

select * from finish();
rollback;
