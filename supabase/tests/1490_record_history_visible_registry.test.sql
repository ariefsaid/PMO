-- 1490_record_history_visible_registry.test.sql — record_history_visible reads its entity → table map from
-- record_history_config instead of re-listing it (#2744, architecture pass C1).
-- AC-HRS-001: a tracked entity type's visibility comes from its registry row, so a new tracked entity is one
--   insert and never a function restatement; an unregistered type still raises; the caller's RLS on the SOURCE
--   table still decides the answer (the predicate stays security invoker); and the registry itself stays
--   unreadable by clients, so the read goes through a one-row lookup that returns a table name only.
-- Mutation notes (each must turn a named assertion red):
--   · point the lookup at a fixed table ('projects') → the second entity's arm goes red (10/11);
--   · delete the null branch → the unregistered-type throw goes red (3/13);
--   · make record_history_visible security definer → the cross-org negatives go red (5/12);
--   · grant select on record_history_config to authenticated → the privilege assertion goes red (14).
-- Migration under test: 1490_record_history_visible_reads_registry.sql.
begin;
create extension if not exists pgtap;
select plan(15);

insert into organizations (id, name) values
  ('14900000-0000-0000-0000-000000000001', 'HRS Org A'),
  ('14900000-0000-0000-0000-000000000002', 'HRS Org B');
insert into auth.users (id, email) values
  ('14900000-0000-0000-0000-0000000000a1', 'hrs-a-admin@example.com'),
  ('14900000-0000-0000-0000-0000000000b1', 'hrs-b-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('14900000-0000-0000-0000-0000000000a1', '14900000-0000-0000-0000-000000000001', 'HRS A Admin', 'hrs-a-admin@example.com', 'Admin', 'active'),
  ('14900000-0000-0000-0000-0000000000b1', '14900000-0000-0000-0000-000000000002', 'HRS B Admin', 'hrs-b-admin@example.com', 'Admin', 'active');
insert into projects (id, org_id, code, name, status) values
  ('14900000-0000-0000-0000-0000000000c1', '14900000-0000-0000-0000-000000000001', 'HRS-1', 'Alpha', 'Ongoing Project'),
  ('14900000-0000-0000-0000-0000000000c2', '14900000-0000-0000-0000-000000000002', 'HRS-2', 'Beta', 'Ongoing Project');
insert into incident_reports (id, org_id, incident_date, type, severity) values
  ('14900000-0000-0000-0000-0000000000e1', '14900000-0000-0000-0000-000000000001', '2026-11-01', 'safety', 'Low'),
  ('14900000-0000-0000-0000-0000000000e2', '14900000-0000-0000-0000-000000000002', '2026-11-01', 'safety', 'Low');

-- ── the registry is the map: a registered entity answers for its own table ────────────────────────
select is(public.record_history_visible('project', '14900000-0000-0000-0000-0000000000c1'), true,
  'AC-HRS-001 a registered entity is visible for a row that exists');
select is(public.record_history_visible('project', gen_random_uuid()), false,
  'AC-HRS-001 and not visible for an id that does not');
select throws_ok($$select public.record_history_visible('zz_not_registered', gen_random_uuid())$$,
  'P0001', 'record_history_visible: no visibility arm for entity type zz_not_registered',
  'AC-HRS-001 an entity type with no registry row still raises, exactly as before');
select is(
  (select count(*)::int from public.record_history_config c
    where public.record_history_table(c.entity_type) is distinct from c.table_name),
  0, 'AC-HRS-001 every registered entity resolves to its own table name (the map has one home)');

-- ── the predicate stays invoker: the SOURCE table's RLS decides ──────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"14900000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(public.record_history_visible('project', '14900000-0000-0000-0000-0000000000c1'), true,
  'AC-HRS-001 an org-A member sees an org-A project');
select is(public.record_history_visible('project', '14900000-0000-0000-0000-0000000000c2'), false,
  'AC-HRS-001 an org-A member does NOT see an org-B project (the source table''s RLS still decides)');
reset role;
set local request.jwt.claims = '';

-- ── the registry read is a one-row lookup, not a readable table ─────────────────────────────────
select ok(has_function_privilege('authenticated', 'public.record_history_table(text)', 'EXECUTE'),
  'AC-HRS-001 authenticated may ask the lookup');
select ok(not has_function_privilege('anon', 'public.record_history_table(text)', 'EXECUTE'),
  'AC-HRS-001 anon may not');
select is(
  (select string_agg(p.proname || ':' || case when p.prosecdef then 'definer' else 'invoker' end, ',' order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('record_history_table', 'record_history_visible')),
  'record_history_table:definer,record_history_visible:invoker',
  'AC-HRS-001 only the one-row lookup is a definer; the predicate still runs as its caller');

set local role authenticated;
set local request.jwt.claims = '{"sub":"14900000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select * from public.record_history_config$$,
  '42501', null, 'AC-HRS-001 the registry itself stays unreadable by a client (AC-CHG-009 unchanged)');
reset role;
set local request.jwt.claims = '';

-- ── a new tracked entity is one insert: no function restatement ──────────────────────────────────
savepoint plant;
insert into public.record_history_config (entity_type, table_name, captured)
  values ('zz_incident_probe', 'incident_reports', '{}'::jsonb);
select is(public.record_history_visible('zz_incident_probe', '14900000-0000-0000-0000-0000000000e1'), true,
  'AC-HRS-001 a newly registered entity is visible for its row with no function change');
select is(public.record_history_visible('zz_incident_probe', gen_random_uuid()), false,
  'AC-HRS-001 and not for an id that does not exist');

set local role authenticated;
set local request.jwt.claims = '{"sub":"14900000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(public.record_history_visible('zz_incident_probe', '14900000-0000-0000-0000-0000000000e2'), false,
  'AC-HRS-001 a registry-only arm obeys the source table''s RLS too (org-B row unseen by an org-A member)');
reset role;
set local request.jwt.claims = '';

rollback to savepoint plant;
select throws_ok($$select public.record_history_visible('zz_incident_probe', gen_random_uuid())$$,
  'P0001', 'record_history_visible: no visibility arm for entity type zz_incident_probe',
  'AC-HRS-001 (control) the arm disappears with the registry row: the row is the arm');

select is((select count(*)::int from public.record_history_config), 21,
  'AC-HRS-001 the 21 registered record types are unchanged by this migration');

select * from finish();
rollback;
