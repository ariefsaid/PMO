-- cus_standards.test.sql — #2577 consumable usage standards: the standards table (migration 1075).
-- Spec docs/specs/consumable-usage-standards.spec.md. AC-CUS-003 duplicate standard refused · AC-CUS-011 who may write ·
-- AC-CUS-012 other organisation · AC-CUS-014 archived or foreign item · FR-CUS-001 archive, never delete, history kept.
begin;
create extension if not exists pgtap;
select plan(27);

insert into organizations (id, name) values
  ('25770000-0000-0000-0000-00000000010a', 'CUS Org A'),
  ('25770000-0000-0000-0000-00000000010b', 'CUS Org B');
insert into auth.users (id, email) values
  ('25770000-0000-0000-0000-0000000001a1', 'cus-admin@example.com'),
  ('25770000-0000-0000-0000-0000000001a2', 'cus-eng@example.com'),
  ('25770000-0000-0000-0000-0000000001a3', 'cus-pm@example.com'),
  ('25770000-0000-0000-0000-0000000001a4', 'cus-fin@example.com'),
  ('25770000-0000-0000-0000-0000000001a5', 'cus-exec@example.com'),
  ('25770000-0000-0000-0000-0000000001b1', 'cus-badmin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('25770000-0000-0000-0000-0000000001a1', '25770000-0000-0000-0000-00000000010a', 'CUS Admin', 'cus-admin@example.com', 'Admin', 'active'),
  ('25770000-0000-0000-0000-0000000001a2', '25770000-0000-0000-0000-00000000010a', 'CUS Eng',   'cus-eng@example.com',   'Engineer', 'active'),
  ('25770000-0000-0000-0000-0000000001a3', '25770000-0000-0000-0000-00000000010a', 'CUS PM',    'cus-pm@example.com',    'Project Manager', 'active'),
  ('25770000-0000-0000-0000-0000000001a4', '25770000-0000-0000-0000-00000000010a', 'CUS Fin',   'cus-fin@example.com',   'Finance', 'active'),
  ('25770000-0000-0000-0000-0000000001a5', '25770000-0000-0000-0000-00000000010a', 'CUS Exec',  'cus-exec@example.com',  'Executive', 'active'),
  ('25770000-0000-0000-0000-0000000001b1', '25770000-0000-0000-0000-00000000010b', 'CUS BAdmin', 'cus-badmin@example.com', 'Admin', 'active');
insert into stock_units (id, org_id, code, name) values
  ('25770000-0000-0000-0000-000000001301', '25770000-0000-0000-0000-00000000010a', 'KG', 'Kilogram'),
  ('25770000-0000-0000-0000-000000001302', '25770000-0000-0000-0000-00000000010b', 'KG', 'Kilogram');
insert into stock_items (id, org_id, code, name, unit_id, archived_at) values
  ('25770000-0000-0000-0000-000000001311', '25770000-0000-0000-0000-00000000010a', 'ROD',  'Welding rod',   '25770000-0000-0000-0000-000000001301', null),
  ('25770000-0000-0000-0000-000000001312', '25770000-0000-0000-0000-00000000010a', 'OLD',  'Retired item',  '25770000-0000-0000-0000-000000001301', now()),
  ('25770000-0000-0000-0000-000000001313', '25770000-0000-0000-0000-00000000010b', 'BROD', 'Org B rod',     '25770000-0000-0000-0000-000000001302', null);

create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp._as(uuid) to authenticated;
create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated;

set local role authenticated;

-- ── AC-CUS-011: who writes standards (stock master rank >= 20) ─────────────────────────────────────────────────
select pg_temp._as('25770000-0000-0000-0000-0000000001a2');
select throws_ok($$ insert into consumable_usage_standards (item_id, work_unit, qty_per_unit)
    values ('25770000-0000-0000-0000-000000001311', 'dia-inch', 0.05) $$, '42501', null,
  'AC-CUS-011 an Engineer cannot create a standard');
select is((select count(*)::int from consumable_usage_standards), 0, 'AC-CUS-011 nothing was written');

select pg_temp._as('25770000-0000-0000-0000-0000000001a3');
select lives_ok($$ insert into consumable_usage_standards (item_id, work_unit, boq_code_prefix, qty_per_unit, margin_pct)
    values ('25770000-0000-0000-0000-000000001311', 'dia-inch', 'WLD', 0.05, 10) $$,
  'AC-CUS-011 a Project Manager can create a standard');
select pg_temp._as('25770000-0000-0000-0000-0000000001a4');
select lives_ok($$ insert into consumable_usage_standards (item_id, work_unit, qty_per_unit)
    values ('25770000-0000-0000-0000-000000001311', 'dia-inch', 0.04) $$, 'AC-CUS-011 Finance can create a standard');
select pg_temp._as('25770000-0000-0000-0000-0000000001a5');
select lives_ok($$ insert into consumable_usage_standards (item_id, work_unit, boq_code_prefix, qty_per_unit)
    values ('25770000-0000-0000-0000-000000001311', 'm2', 'PNT', 0.3) $$, 'AC-CUS-011 an Executive can create a standard');
select pg_temp._as('25770000-0000-0000-0000-0000000001a1');
select lives_ok($$ insert into consumable_usage_standards (item_id, work_unit, qty_per_unit)
    values ('25770000-0000-0000-0000-000000001311', 'ton', 2) $$, 'AC-CUS-011 an Admin can create a standard');

select is((select org_id from consumable_usage_standards where work_unit = 'ton'), '25770000-0000-0000-0000-00000000010a'::uuid,
  'FR-CUS-016 org_id is stamped by the server, never taken from the client');
select throws_ok($$ insert into consumable_usage_standards (org_id, item_id, work_unit, qty_per_unit)
    values ('25770000-0000-0000-0000-00000000010b', '25770000-0000-0000-0000-000000001311', 'foo', 1) $$, '42501', null,
  'FR-CUS-016 a client-supplied org_id is not accepted');

-- ── AC-CUS-003: duplicate (same item, unit, prefix) refused; the unit and prefix are compared trimmed, case-blind ──
select throws_ok($$ insert into consumable_usage_standards (item_id, work_unit, boq_code_prefix, qty_per_unit)
    values ('25770000-0000-0000-0000-000000001311', ' DIA-Inch ', 'wld', 0.07) $$, '23505', null,
  'AC-CUS-003 a duplicate standard (same item, unit, prefix up to case and spaces) is refused');
select throws_ok($$ insert into consumable_usage_standards (item_id, work_unit, boq_code_prefix, qty_per_unit)
    values ('25770000-0000-0000-0000-000000001311', 'dia-inch', null, 0.07) $$, '23505', null,
  'AC-CUS-003 a second standard with no prefix is a duplicate (two empties are the same prefix)');
select lives_ok($$ insert into consumable_usage_standards (item_id, work_unit, boq_code_prefix, qty_per_unit)
    values ('25770000-0000-0000-0000-000000001311', 'dia-inch', 'WLD-01', 0.06) $$,
  'AC-CUS-003 the same item and unit with a different (longer) prefix is allowed');

-- ── field rules ────────────────────────────────────────────────────────────────────────────────────────────────
select throws_ok($$ insert into consumable_usage_standards (item_id, work_unit, qty_per_unit)
    values ('25770000-0000-0000-0000-000000001311', 'zero', 0) $$, '23514', null, 'FR-CUS-001 quantity per unit must be above zero');
select throws_ok($$ insert into consumable_usage_standards (item_id, work_unit, qty_per_unit, margin_pct)
    values ('25770000-0000-0000-0000-000000001311', 'm', 1, 101) $$, '23514', null, 'FR-CUS-001 margin is 0 to 100');
select throws_ok($$ insert into consumable_usage_standards (item_id, work_unit, qty_per_unit)
    values ('25770000-0000-0000-0000-000000001311', '  ', 1) $$, '23514', null, 'FR-CUS-001 a blank work unit is refused');

-- ── AC-CUS-014: archived or other-organisation item ────────────────────────────────────────────────────────────
select throws_ok($$ insert into consumable_usage_standards (item_id, work_unit, qty_per_unit)
    values ('25770000-0000-0000-0000-000000001312', 'm', 1) $$, '42501', null, 'AC-CUS-014 an archived item cannot take a standard');
select throws_ok($$ insert into consumable_usage_standards (item_id, work_unit, qty_per_unit)
    values ('25770000-0000-0000-0000-000000001313', 'm', 1) $$, '42501', null, 'AC-CUS-014 another organisation''s item cannot take a standard');

-- ── edit and archive; no delete (FR-CUS-001, ADR-0018) ─────────────────────────────────────────────────────────
insert into t_ids select 'ton', id from consumable_usage_standards where work_unit = 'ton';
select lives_ok($$ update consumable_usage_standards set qty_per_unit = 2.5, margin_pct = 5 where id = (select v from t_ids where k = 'ton') $$,
  'FR-CUS-001 a writer edits a standard');
select throws_ok($$ update consumable_usage_standards set item_id = '25770000-0000-0000-0000-000000001312' where id = (select v from t_ids where k = 'ton') $$,
  '42501', null, 'FR-CUS-001 the item of a standard cannot be changed');
select lives_ok($$ update consumable_usage_standards set archived_at = now() where id = (select v from t_ids where k = 'ton') $$, 'FR-CUS-001 a writer archives a standard');
select lives_ok($$ insert into consumable_usage_standards (item_id, work_unit, qty_per_unit)
    values ('25770000-0000-0000-0000-000000001311', 'ton', 3) $$, 'FR-CUS-003 an archived standard no longer blocks a new one with the same key');
select throws_ok($$ delete from consumable_usage_standards where id = (select v from t_ids where k = 'ton') $$, '42501', null,
  'FR-CUS-001 a standard is archived, never deleted');
select pg_temp._as('25770000-0000-0000-0000-0000000001a2');
update consumable_usage_standards set qty_per_unit = 9 where work_unit = 'm2';
select is((select count(*)::int from consumable_usage_standards where qty_per_unit = 9), 0,
  'AC-CUS-011 an Engineer cannot edit a standard (the update matches no row)');
select ok((select count(*) from consumable_usage_standards) >= 5, 'AC-CUS-011 a same-organisation active member can read the standards');

-- ── AC-CUS-012: another organisation ───────────────────────────────────────────────────────────────────────────
select pg_temp._as('25770000-0000-0000-0000-0000000001b1');
select is((select count(*)::int from consumable_usage_standards), 0, 'AC-CUS-012 another organisation reads none of them');
select throws_ok($$ insert into consumable_usage_standards (item_id, work_unit, qty_per_unit)
    values ('25770000-0000-0000-0000-000000001311', 'dia-inch', 1) $$, '42501', null, 'AC-CUS-012 another organisation cannot write against our item');
select lives_ok($$ insert into consumable_usage_standards (item_id, work_unit, qty_per_unit)
    values ('25770000-0000-0000-0000-000000001313', 'dia-inch', 1) $$, 'AC-CUS-012 it can keep its own standards, same key included');

-- ── record history (FR-CUS-001): the actor and time of a change are kept ──────────────────────────────────────────
reset role;
select ok(exists (select 1 from record_changes where entity_type = 'usage_standard' and op = 'update'
                    and entity_id = (select v from t_ids where k = 'ton') and actor_id = '25770000-0000-0000-0000-0000000001a1'),
  'FR-CUS-001 an edit to a standard is kept in record history with its actor');

select * from finish();
rollback;
