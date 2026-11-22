-- 1833_clearance_due_read_guard.test.sql — #2800, AC-CTD-012 (focused invoker-guard proof, separate from the full 1831 file).
-- The read runs SECURITY INVOKER at the caller's own boundary: an active management reader sees this organisation's due
-- pairs, a light field account is refused with the account-boundary refusal, and the catalog shape keeps the function's
-- invoker identity, pinned search_path and client EXECUTE grant.
begin;
create extension if not exists pgtap;
select plan(14);

insert into organizations (id, name, default_currency, default_timezone, clearance_checklist_enabled, built_in_roles_enabled) values
  ('28330000-0000-0000-0000-0000000000a1', 'CRG Due A', 'IDR', 'UTC', true, true),
  ('28330000-0000-0000-0000-0000000000b1', 'CRG Due B', 'IDR', 'UTC', true, true);
insert into auth.users (id, email) values
  ('28330000-0000-0000-0000-000000000b01', 'crg-admin-a@example.com'),
  ('28330000-0000-0000-0000-000000000b02', 'crg-finance-a@example.com'),
  ('28330000-0000-0000-0000-000000000b03', 'crg-engineer-a@example.com'),
  ('28330000-0000-0000-0000-000000000b04', 'crg-field-a@example.com'),
  ('28330000-0000-0000-0000-000000000b05', 'crg-disabled-field-a@example.com'),
  ('28330000-0000-0000-0000-000000000b61', 'crg-admin-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('28330000-0000-0000-0000-000000000b01', '28330000-0000-0000-0000-0000000000a1', 'CRG Admin A',    'crg-admin-a@example.com',          'Admin',     'active',   null),
  ('28330000-0000-0000-0000-000000000b02', '28330000-0000-0000-0000-0000000000a1', 'CRG Finance A',  'crg-finance-a@example.com',        'Finance',   'active',   null),
  ('28330000-0000-0000-0000-000000000b03', '28330000-0000-0000-0000-0000000000a1', 'CRG Engineer A', 'crg-engineer-a@example.com',       'Engineer',  'active',   null),
  ('28330000-0000-0000-0000-000000000b04', '28330000-0000-0000-0000-0000000000a1', 'CRG Field A',    'crg-field-a@example.com',          'Engineer',  'active',   'field_user'),
  ('28330000-0000-0000-0000-000000000b05', '28330000-0000-0000-0000-0000000000a1', 'CRG Ex-Field A', 'crg-disabled-field-a@example.com', 'Engineer',  'disabled', 'field_user'),
  ('28330000-0000-0000-0000-000000000b61', '28330000-0000-0000-0000-0000000000b1', 'CRG Admin B',    'crg-admin-b@example.com',          'Admin',     'active',   null);
-- Items first, then people: people.created_at and each item's target_set_at are both now() here, so the person is created
-- exactly at the stamp and every pair is due (the rule is "no due day only for a person created BEFORE the stamp").
insert into clearance_items (id, org_id, name, is_required, sort_order, created_by, target_days) values
  ('28330000-0000-0000-0000-0000000000c1', '28330000-0000-0000-0000-0000000000a1', 'Site induction',    true, 1, '28330000-0000-0000-0000-000000000b01', 5),
  ('28330000-0000-0000-0000-0000000000c2', '28330000-0000-0000-0000-0000000000b1', 'Foreign induction', true, 1, '28330000-0000-0000-0000-000000000b61', 5);
insert into people (id, org_id, code, name, created_by) values
  ('28330000-0000-0000-0000-0000000000e1', '28330000-0000-0000-0000-0000000000a1', 'CRG-1', 'Due One',     '28330000-0000-0000-0000-000000000b01'),
  ('28330000-0000-0000-0000-0000000000f1', '28330000-0000-0000-0000-0000000000b1', 'CRG-2', 'Foreign One', '28330000-0000-0000-0000-000000000b61');

create function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.act_as(uuid) to authenticated;

-- The positive read comes first, as an active Admin.
set local role authenticated;
select pg_temp.act_as('28330000-0000-0000-0000-000000000b01');
select is((select count(*)::int from person_clearance_due()), 1,
  'AC-CTD-012 an active Admin reads the organisation''s one due clearance pair');
select is((select d.person_id::text || '/' || d.item_id::text from person_clearance_due() d),
  '28330000-0000-0000-0000-0000000000e1/28330000-0000-0000-0000-0000000000c1',
  'AC-CTD-012 the readable pair is this organisation''s own person and item');
select is((select count(*)::int from person_clearance_due() d where d.person_id = '28330000-0000-0000-0000-0000000000f1'),
  0, 'AC-CTD-012 the foreign person sentinel never appears in this organisation''s due list');

-- A full-account management reader the policy allows (non-medical item, no special medical handling) reads the same row.
select pg_temp.act_as('28330000-0000-0000-0000-000000000b02');
select is((select count(*)::int from person_clearance_due()), 1,
  'AC-CTD-012 an active Finance reader reads the non-medical due row');

-- The field-account boundary: a full Engineer is NOT a light account, so the guard must not throw; RLS simply returns nothing.
select pg_temp.act_as('28330000-0000-0000-0000-000000000b03');
select is((select count(*)::int from person_clearance_due()), 0,
  'AC-CTD-012 a full Engineer account is not refused by the light guard and reads no authorized data');

-- A light (field) account is refused with the unchanged field-account refusal: same code, same message as assert_not_light().
select pg_temp.act_as('28330000-0000-0000-0000-000000000b04');
select throws_ok('select * from person_clearance_due()', '42501',
  'LIGHT_ACCOUNT: this account has one phone home screen and cannot read this',
  'AC-CTD-012 a field account is refused with the unchanged LIGHT_ACCOUNT refusal');

-- A disabled light profile is not a light actor (actor_is_light requires status active) and reads no authorized data either.
select pg_temp.act_as('28330000-0000-0000-0000-000000000b05');
select is((select count(*)::int from person_clearance_due()), 0,
  'AC-CTD-012 a disabled field account reads no authorized data');

-- Another organisation's Admin reads only its own due row; this organisation's row never crosses over.
select pg_temp.act_as('28330000-0000-0000-0000-000000000b61');
select is((select count(*)::int from person_clearance_due()), 1,
  'AC-CTD-012 another organisation''s Admin reads its own one due row');
select is((select count(*)::int from person_clearance_due() d where d.person_id = '28330000-0000-0000-0000-0000000000e1'),
  0, 'AC-CTD-012 another organisation''s Admin reads none of this organisation''s due rows');

-- The approved shape is pinned: invoker, pinned search_path, authenticated EXECUTE, no anon EXECUTE and no helper grant.
reset role;
select ok(not p.prosecdef, 'AC-CTD-012 the due read stays SECURITY INVOKER')
  from pg_proc p where p.oid = 'public.person_clearance_due()'::regprocedure;
select ok(coalesce(p.proconfig, '{}') @> array['search_path=public, pg_temp'],
  'AC-CTD-012 the due read keeps its pinned search_path')
  from pg_proc p where p.oid = 'public.person_clearance_due()'::regprocedure;
select ok(has_function_privilege('authenticated', 'public.person_clearance_due()', 'execute'),
  'AC-CTD-012 authenticated still holds EXECUTE on the due read');
select ok(not has_function_privilege('anon', 'public.person_clearance_due()', 'execute'),
  'AC-CTD-012 anon still holds no EXECUTE on the due read');
select ok(not has_function_privilege('authenticated', 'public.assert_not_light()', 'execute'),
  'AC-CTD-012 the helper stays unreachable to authenticated (the fix added no EXECUTE grant)');

select * from finish();
rollback;
