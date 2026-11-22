-- 1820_incident_types.test.sql — issue-closing-measure. Migrations under test: 1820, 1821.
-- AC-ICM-001 existing free text is mapped into each org's own list, history kept, idempotent
-- AC-ICM-002 a person may only name a live type of their own org; case-insensitive; trusted contexts add to the list
-- AC-ICM-003 an archived type never blocks an unrelated edit, but cannot be chosen
-- AC-ICM-004 a rename carries to issues and department groups
-- AC-ICM-005 only an Admin writes the list; org isolation
-- Mutation checks (orchestrator): in 1821 delete the `raise exception 'ICM_TYPE_NOT_IN_LIST...` branch for a person ->
--   AC-ICM-002 "unlisted type refused" goes red; in 1820 change the insert policy role check to `<> 'Admin'` -> AC-ICM-005 red.
begin;
create extension if not exists pgtap;
select plan(23);

insert into organizations (id, name, default_currency) values
  ('18200000-0000-0000-0000-00000000000a', 'ICM Org A', 'USD'),
  ('18200000-0000-0000-0000-00000000000b', 'ICM Org B', 'USD');
insert into auth.users (id, email) values
  ('18200000-0000-0000-0000-0000000000a1', 'icm-admin-a@example.com'),
  ('18200000-0000-0000-0000-0000000000a2', 'icm-eng-a@example.com'),
  ('18200000-0000-0000-0000-0000000000b1', 'icm-admin-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('18200000-0000-0000-0000-0000000000a1', '18200000-0000-0000-0000-00000000000a', 'Admin A', 'icm-admin-a@example.com', 'Admin', 'active'),
  ('18200000-0000-0000-0000-0000000000a2', '18200000-0000-0000-0000-00000000000a', 'Eng A', 'icm-eng-a@example.com', 'Engineer', 'active'),
  ('18200000-0000-0000-0000-0000000000b1', '18200000-0000-0000-0000-00000000000b', 'Admin B', 'icm-admin-b@example.com', 'Admin', 'active');

select is((select string_agg(label, ',') from incident_types where org_id = '18200000-0000-0000-0000-00000000000a'), 'Other',
  'AC-ICM-005 a new organisation gets exactly one generic entry');

-- ── AC-ICM-001: the backfill statements of 1821, run over rows written before the list existed ───────
alter table incident_reports disable trigger incident_reports_zz_type_list;
insert into incident_reports (id, org_id, incident_date, type, severity, reported_by) values
  ('18200000-0000-0000-0000-000000000001', '18200000-0000-0000-0000-00000000000a', current_date, 'electrical ', 'Low', '18200000-0000-0000-0000-0000000000a1'),
  ('18200000-0000-0000-0000-000000000002', '18200000-0000-0000-0000-00000000000a', current_date, 'electrical ', 'Low', '18200000-0000-0000-0000-0000000000a1'),
  ('18200000-0000-0000-0000-000000000003', '18200000-0000-0000-0000-00000000000a', current_date, 'Electrical', 'Low', '18200000-0000-0000-0000-0000000000a1'),
  ('18200000-0000-0000-0000-000000000004', '18200000-0000-0000-0000-00000000000a', current_date, 'Plumbing', 'Low', '18200000-0000-0000-0000-0000000000a1'),
  ('18200000-0000-0000-0000-000000000005', '18200000-0000-0000-0000-00000000000a', current_date, '', 'Low', '18200000-0000-0000-0000-0000000000a1'),
  ('18200000-0000-0000-0000-000000000006', '18200000-0000-0000-0000-00000000000b', current_date, 'Plumbing', 'Low', '18200000-0000-0000-0000-0000000000b1');
create function pg_temp.icm_backfill() returns void language plpgsql as $f$
begin
  insert into public.incident_types (org_id, label)
  select org_id, label from (
    select distinct on (org_id, k) org_id, k, label
      from (
        select i.org_id,
               lower(btrim(left(coalesce(nullif(btrim(i.type), ''), 'Other'), 80))) as k,
               left(coalesce(nullif(btrim(i.type), ''), 'Other'), 80) as label,
               count(*) over (partition by i.org_id, lower(btrim(left(coalesce(nullif(btrim(i.type), ''), 'Other'), 80))), left(coalesce(nullif(btrim(i.type), ''), 'Other'), 80)) as n,
               min(i.created_at) over (partition by i.org_id, lower(btrim(left(coalesce(nullif(btrim(i.type), ''), 'Other'), 80))), left(coalesce(nullif(btrim(i.type), ''), 'Other'), 80)) as first_seen
          from public.incident_reports i
      ) s
     order by org_id, k, n desc, first_seen, label
  ) d
  on conflict do nothing;
  update public.incident_reports i set type_id = t.id
    from public.incident_types t
   where t.org_id = i.org_id and t.archived_at is null
     and lower(btrim(t.label)) = lower(btrim(left(coalesce(nullif(btrim(i.type), ''), 'Other'), 80)))
     and i.type_id is null;
end $f$;
select pg_temp.icm_backfill();
alter table incident_reports enable trigger incident_reports_zz_type_list;

select set_eq($$ select label from incident_types where org_id = '18200000-0000-0000-0000-00000000000a' $$,
  $$ values ('Other'), ('Plumbing'), ('electrical') $$,
  'AC-ICM-001 one list entry per distinct value (case and spaces folded, the most frequent spelling kept)');
select is((select count(*)::int from incident_reports where org_id = '18200000-0000-0000-0000-00000000000a' and type_id is null), 0,
  'AC-ICM-001 every existing issue is linked to a type');
select is((select type from incident_reports where id = '18200000-0000-0000-0000-000000000001'), 'electrical ',
  'AC-ICM-001 the stored text is left exactly as it was written (history kept)');
select is((select t.label from incident_reports i join incident_types t on t.id = i.type_id where i.id = '18200000-0000-0000-0000-000000000005'), 'Other',
  'AC-ICM-001 a blank type maps to Other');
select is((select count(*)::int from incident_types where org_id = '18200000-0000-0000-0000-00000000000b' and label = 'Plumbing'), 1,
  'AC-ICM-001 the other organisation gets its own entry from its own issues');
select pg_temp.icm_backfill();
select is((select count(*)::int from incident_types where org_id = '18200000-0000-0000-0000-00000000000a'), 3,
  'AC-ICM-001 running it again changes nothing (idempotent)');

-- ── fixtures for the rest (written as the table owner, a trusted context) ─────────────────────────────
insert into incident_types (id, org_id, label) values ('18200000-0000-0000-0000-0000000000f1', '18200000-0000-0000-0000-00000000000b', 'Zed');
insert into incident_reports (id, org_id, incident_date, type, severity, reported_by) values
  ('18200000-0000-0000-0000-000000000011', '18200000-0000-0000-0000-00000000000a', current_date, 'Brand new', 'Low', '18200000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from incident_types where org_id = '18200000-0000-0000-0000-00000000000a' and label = 'Brand new'), 1,
  'AC-ICM-002 a trusted context (import, seed) naming a new label adds it to the list');
insert into incident_types (id, org_id, label, archived_at) values ('18200000-0000-0000-0000-0000000000f2', '18200000-0000-0000-0000-00000000000a', 'Retired', now());
insert into issue_department_groups (org_id, name, issue_types) values
  ('18200000-0000-0000-0000-00000000000a', 'Pipes group', array['plumbing ', 'Civil']);
-- an issue carrying a type that is archived afterwards
insert into incident_types (id, org_id, label) values ('18200000-0000-0000-0000-0000000000f3', '18200000-0000-0000-0000-00000000000a', 'Soon retired');
insert into incident_reports (id, org_id, incident_date, type, severity, reported_by) values
  ('18200000-0000-0000-0000-000000000012', '18200000-0000-0000-0000-00000000000a', current_date, 'Soon retired', 'Low', '18200000-0000-0000-0000-0000000000a1');
update incident_types set archived_at = now() where id = '18200000-0000-0000-0000-0000000000f3';

-- ── AC-ICM-002: an Engineer raises issues ─────────────────────────────────────────────────────────────
create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
set local role authenticated;
select pg_temp.act_as('18200000-0000-0000-0000-0000000000a2');

select lives_ok($$ insert into incident_reports (incident_date, type, severity, description) values (current_date, 'PLUMBING', 'Low', 'icm-1') $$,
  'AC-ICM-002 a listed type is accepted whatever its case');
select is((select type from incident_reports where description = 'icm-1'), 'Plumbing',
  'AC-ICM-002 the stored type is the list label and the issue is linked to it');
select throws_ok($$ insert into incident_reports (incident_date, type, severity) values (current_date, 'Welding', 'Low') $$,
  '23514', 'ICM_TYPE_NOT_IN_LIST: pick an issue type from the list, or ask an Admin to add it',
  'AC-ICM-002 an unlisted type is refused for a person');
select throws_ok($$ insert into incident_reports (incident_date, type, type_id, severity) values (current_date, 'Zed', '18200000-0000-0000-0000-0000000000f1', 'Low') $$,
  '23514', 'ICM_TYPE_NOT_IN_LIST: pick an issue type from the list, or ask an Admin to add it',
  'AC-ICM-002 another organisation''s type id is refused');
select throws_ok($$ insert into incident_reports (incident_date, type, severity) values (current_date, 'Retired', 'Low') $$,
  '23514', 'ICM_TYPE_NOT_IN_LIST: pick an issue type from the list, or ask an Admin to add it',
  'AC-ICM-003 an archived type cannot be chosen for a new issue');

-- ── AC-ICM-005 as the Engineer ────────────────────────────────────────────────────────────────────────
select throws_ok($$ insert into incident_types (label) values ('Hack') $$, '42501', null, 'AC-ICM-005 an Engineer cannot add a type');
update incident_types set label = 'hack' where org_id = '18200000-0000-0000-0000-00000000000a';
select is((select count(*)::int from incident_types where label = 'hack'), 0,
  'AC-ICM-005 an Engineer cannot rename a type');

-- ── AC-ICM-003 / 004 as the Admin ─────────────────────────────────────────────────────────────────────
select pg_temp.act_as('18200000-0000-0000-0000-0000000000a1');
select lives_ok($$ update incident_reports set description = 'edited' where id = '18200000-0000-0000-0000-000000000012' $$,
  'AC-ICM-003 an unrelated edit of an issue whose type was archived since is not refused');
select throws_ok($$ update incident_reports set type = 'Retired' where id = '18200000-0000-0000-0000-000000000004' $$,
  '23514', 'ICM_TYPE_NOT_IN_LIST: pick an issue type from the list, or ask an Admin to add it',
  'AC-ICM-003 changing an issue to an archived type is refused');
select lives_ok($$ update incident_types set label = 'Pipework' where org_id = '18200000-0000-0000-0000-00000000000a' and label = 'Plumbing' $$,
  'AC-ICM-004 an Admin renames a type');
select is((select count(*)::int from incident_reports where org_id = '18200000-0000-0000-0000-00000000000a' and type = 'Pipework'), 2,
  'AC-ICM-004 the rename carries to every issue of that type');
select is((select issue_types from issue_department_groups where name = 'Pipes group'), array['Pipework', 'Civil'],
  'AC-ICM-004 the rename carries to the department group that named it');
select lives_ok($$ insert into incident_types (label) values ('Welding') $$, 'AC-ICM-005 an Admin adds a type to their own list');

-- ── AC-ICM-005 isolation ──────────────────────────────────────────────────────────────────────────────
select pg_temp.act_as('18200000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from incident_types where org_id = '18200000-0000-0000-0000-00000000000a'), 0,
  'AC-ICM-005 another organisation reads none of this list');
update incident_types set label = 'hack' where org_id = '18200000-0000-0000-0000-00000000000a';
reset role;
select is((select count(*)::int from incident_types where label = 'hack'), 0,
  'AC-ICM-005 another organisation''s Admin cannot rename it');

select * from finish();
rollback;
