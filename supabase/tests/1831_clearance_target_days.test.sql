-- 1831_clearance_target_days.test.sql — a clearance item carries an optional target in days, stamped when it is set; a person's
-- item is due only from the person's own creation day (#2800). AC-CTD-004, AC-CTD-005, AC-CTD-007 (owning layer, pgTAP;
-- also FR-CTD-003/004/010). Ids: 28310000-… (synthetic).
-- Org a1 Pacific/Kiritimati (+14), org b1 Pacific/Pago_Pago (-11) and foreign. The two zones are 25 hours apart, so the same
-- creation instant is a different day in each — that is how "the organisation's zone" is proved without moving the clock.
--
-- MUTATION NOTES (intended rules for the later VPS mutation job; NOT executed by this author — no mutation evidence is claimed):
--   1831 `p_person_created < p_target_set_at` -> `p_person_created <= p_target_set_at`
--        reddens 'AC-CTD-005 a person created exactly at the target stamp still has a due day'
--   1831 delete the `p_person_created < p_target_set_at` branch
--        reddens 'AC-CTD-005 a person created before the target stamp has no due day'
--   1831 `elsif tg_op = 'INSERT' or old.target_days is distinct from new.target_days` -> `elsif tg_op = 'INSERT'`
--        reddens 'AC-CTD-004 changing the target re-stamps target_set_at'
--   1831 `if new.target_days is null then new.target_set_at := null;` removed
--        reddens 'AC-CTD-004 removing the target clears target_set_at'
--   1831 `then exists (select 1 from public.person_clearances ...)` -> `then false`
--        reddens 'AC-CTD-005 a recorded clearance row removes the item from the due list'
--   1831 notices policy `and (select public.auth_role()) in (...)` widened to remove a role
--        reddens the role-parity assertions ('AC-CTD-007 an Engineer reads no notice, exactly as no clearance row')
begin;
create extension if not exists pgtap;
-- Assertions are counted below with `grep -cE '^select (is|ok|lives_ok|throws_ok)'`; update the plan with the file.
select plan(53);

insert into organizations (id, name, default_currency, default_timezone, clearance_checklist_enabled, built_in_roles_enabled) values
  ('28310000-0000-0000-0000-0000000000a1', 'CTD Clearance A', 'IDR', 'Pacific/Kiritimati', true, true),
  ('28310000-0000-0000-0000-0000000000b1', 'CTD Clearance B', 'IDR', 'Pacific/Pago_Pago',   true, false);
insert into auth.users (id, email) values
  ('28310000-0000-0000-0000-000000000b01', 'ctdc-admin@example.com'),
  ('28310000-0000-0000-0000-000000000b02', 'ctdc-pm@example.com'),
  ('28310000-0000-0000-0000-000000000b03', 'ctdc-fin@example.com'),
  ('28310000-0000-0000-0000-000000000b04', 'ctdc-eng@example.com'),
  ('28310000-0000-0000-0000-000000000b05', 'ctdc-exec@example.com'),
  ('28310000-0000-0000-0000-000000000b06', 'ctdc-foreman@example.com'),
  ('28310000-0000-0000-0000-000000000b61', 'ctdc-foreign@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('28310000-0000-0000-0000-000000000b01', '28310000-0000-0000-0000-0000000000a1', 'CTDC Admin',   'ctdc-admin@example.com',   'Admin', 'active', null),
  ('28310000-0000-0000-0000-000000000b02', '28310000-0000-0000-0000-0000000000a1', 'CTDC PM',      'ctdc-pm@example.com',      'Project Manager', 'active', null),
  ('28310000-0000-0000-0000-000000000b03', '28310000-0000-0000-0000-0000000000a1', 'CTDC Finance', 'ctdc-fin@example.com',     'Finance', 'active', null),
  ('28310000-0000-0000-0000-000000000b04', '28310000-0000-0000-0000-0000000000a1', 'CTDC Eng',     'ctdc-eng@example.com',     'Engineer', 'active', null),
  ('28310000-0000-0000-0000-000000000b05', '28310000-0000-0000-0000-0000000000a1', 'CTDC Exec',    'ctdc-exec@example.com',    'Executive', 'active', null),
  ('28310000-0000-0000-0000-000000000b06', '28310000-0000-0000-0000-0000000000a1', 'CTDC Foreman', 'ctdc-foreman@example.com', 'Engineer', 'active', 'foreman'),
  ('28310000-0000-0000-0000-000000000b61', '28310000-0000-0000-0000-0000000000b1', 'CTDC Foreign', 'ctdc-foreign@example.com', 'Admin', 'active', null);
-- The stable anchor is c01; c00 is the stamp probe. Both are stamped at the transaction instant.
insert into clearance_items (id, org_id, name, is_required, sort_order, created_by, target_days) values
  ('28310000-0000-0000-0000-000000000c01', '28310000-0000-0000-0000-0000000000a1', 'Site induction', true, 1, '28310000-0000-0000-0000-000000000b01', 5),
  ('28310000-0000-0000-0000-000000000c00', '28310000-0000-0000-0000-0000000000a1', 'Stamp probe',    true, 2, '28310000-0000-0000-0000-000000000b01', 5);
insert into document_types (id, org_id, name, applies_to) values
  ('28310000-0000-0000-0000-000000000d01', '28310000-0000-0000-0000-0000000000a1', 'Person medical', 'person');
insert into clearance_items (id, org_id, name, is_required, sort_order, created_by, target_days, document_type_id) values
  ('28310000-0000-0000-0000-000000000c02', '28310000-0000-0000-0000-0000000000a1', 'Medical check', true, 3, '28310000-0000-0000-0000-000000000b01', 3, '28310000-0000-0000-0000-000000000d01');
-- A target set twenty days ago: a person created ten days ago is five days past it, the only deterministic way to reach an
-- overdue calendar day inside one transaction (a target set today can never be overdue for a person created today or later).
insert into clearance_items (id, org_id, name, is_required, sort_order, created_by, target_days) values
  ('28310000-0000-0000-0000-000000000c03', '28310000-0000-0000-0000-0000000000a1', 'Aged induction', true, 4, '28310000-0000-0000-0000-000000000b01', 5);
set local session_replication_role = replica;
update clearance_items set target_set_at = now() - interval '20 days' where id = '28310000-0000-0000-0000-000000000c03';
set local session_replication_role = origin;
-- People anchored on the stable stamp: one before it, one exactly on it, one after it, one a second before it, and one old
-- enough to be past the aged target.
insert into people (id, org_id, code, name, created_by, created_at) values
  ('28310000-0000-0000-0000-000000000e01', '28310000-0000-0000-0000-0000000000a1', 'CTDC-1', 'Clearance One',
   '28310000-0000-0000-0000-000000000b03', (select target_set_at from clearance_items where id = '28310000-0000-0000-0000-000000000c01') - interval '6 days'),
  ('28310000-0000-0000-0000-000000000e02', '28310000-0000-0000-0000-0000000000a1', 'CTDC-2', 'Clearance At Boundary',
   '28310000-0000-0000-0000-000000000b03', (select target_set_at from clearance_items where id = '28310000-0000-0000-0000-000000000c01')),
  ('28310000-0000-0000-0000-000000000e03', '28310000-0000-0000-0000-0000000000a1', 'CTDC-3', 'Clearance After',
   '28310000-0000-0000-0000-000000000b03', (select target_set_at from clearance_items where id = '28310000-0000-0000-0000-000000000c01') + interval '1 hour'),
  ('28310000-0000-0000-0000-000000000e04', '28310000-0000-0000-0000-0000000000a1', 'CTDC-4', 'Clearance Preexisting',
   '28310000-0000-0000-0000-000000000b03', (select target_set_at from clearance_items where id = '28310000-0000-0000-0000-000000000c01') - interval '1 second'),
  ('28310000-0000-0000-0000-000000000e05', '28310000-0000-0000-0000-0000000000a1', 'CTDC-5', 'Clearance Documented',
   '28310000-0000-0000-0000-000000000b03', (select target_set_at from clearance_items where id = '28310000-0000-0000-0000-000000000c01')),
  ('28310000-0000-0000-0000-000000000e06', '28310000-0000-0000-0000-0000000000a1', 'CTDC-7', 'Clearance Aged',
   '28310000-0000-0000-0000-000000000b03', (select target_set_at from clearance_items where id = '28310000-0000-0000-0000-000000000c03') + interval '10 days'),
  ('28310000-0000-0000-0000-000000000e61', '28310000-0000-0000-0000-0000000000b1', 'CTDC-6', 'Foreign Person',
   '28310000-0000-0000-0000-000000000b61', (select target_set_at from clearance_items where id = '28310000-0000-0000-0000-000000000c02') - interval '6 days');
insert into expiry_documents (id, org_id, subject_kind, person_id, type_id, issued_on, expires_on) values
  ('28310000-0000-0000-0000-000000000f01', '28310000-0000-0000-0000-0000000000a1', 'person',
   '28310000-0000-0000-0000-000000000e05', '28310000-0000-0000-0000-000000000d01', current_date - 30, current_date + 30);

create function pg_temp.detail(p_sql text) returns text language plpgsql as $$
declare d text;
begin execute p_sql; return 'ok';
exception when others then get stacked diagnostics d = pg_exception_detail; return sqlstate || ' ' || coalesce(d, ''); end $$;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok';
exception when others then return sqlstate || ' ' || sqlerrm; end $$;
create function pg_temp.as_user(p_user text) returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', '{"sub":"28310000-0000-0000-0000-000000000' || p_user || '","role":"authenticated"}', true);
end $$;
create function pg_temp.as_anon() returns void language plpgsql as $$
begin
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '', true);
end $$;
create function pg_temp.stamp(p_item text) returns timestamptz language sql as $$
  select target_set_at from clearance_items where id = p_item::uuid $$;
create function pg_temp.due(p_person text, p_item text) returns date language sql as $$
  select due_on from person_clearance_due() d
   where d.person_id = p_person::uuid and d.item_id = p_item::uuid $$;
create function pg_temp.rows_for(p_person text, p_item text) returns int language sql as $$
  select count(*)::int from person_clearance_due() d
   where d.person_id = p_person::uuid and d.item_id = p_item::uuid $$;

-- ── AC-CTD-004: the stamp is written by the database when a target is set, changed or removed ────────────────────────────
select isnt(pg_temp.stamp('28310000-0000-0000-0000-000000000c00'), null,
  'AC-CTD-004 setting a target stamps target_set_at');
-- Fixture seam only: backdate the stamp through the trigger (session_replication_role) so "kept" and "re-stamped" are
-- distinguishable inside one transaction, where now() is constant. The rules are asserted below, unchanged.
set local session_replication_role = replica;
update clearance_items set target_set_at = now() - interval '1 day' where id = '28310000-0000-0000-0000-000000000c00';
set local session_replication_role = origin;
select is(pg_temp.stamp('28310000-0000-0000-0000-000000000c00'), now() - interval '1 day',
  'AC-CTD-004 the probe stamp is backdated before the next rule');
update clearance_items set name = 'Stamp probe renamed' where id = '28310000-0000-0000-0000-000000000c00';
select is(pg_temp.stamp('28310000-0000-0000-0000-000000000c00'), now() - interval '1 day',
  'AC-CTD-004 an unrelated edit keeps the original target stamp');
update clearance_items set target_days = 10 where id = '28310000-0000-0000-0000-000000000c00';
select is(pg_temp.stamp('28310000-0000-0000-0000-000000000c00'), now(),
  'AC-CTD-004 changing the target re-stamps target_set_at');
update clearance_items set target_days = null where id = '28310000-0000-0000-0000-000000000c00';
select is((select coalesce(target_days::text, 'none') || '|' || coalesce(target_set_at::text, 'none')
             from clearance_items where id = '28310000-0000-0000-0000-000000000c00'),
  'none|none', 'AC-CTD-004 removing the target clears both the target and its stamp');
update clearance_items set target_days = 7 where id = '28310000-0000-0000-0000-000000000c00';
select is((select target_days::int || '|' || (target_set_at = now())::text from clearance_items where id = '28310000-0000-0000-0000-000000000c00'),
  '7|true', 'AC-CTD-004 setting a target again stamps it again');
select is((select (target_days is null) = (target_set_at is null) from clearance_items where id = '28310000-0000-0000-0000-000000000c00'),
  true, 'AC-CTD-004 a target and its stamp are always present together');
select pg_temp.as_user('b01');
with u as (update clearance_items set target_days = 9 where id = '28310000-0000-0000-0000-000000000c00' returning 1)
select is((select count(*)::int from u), 1, 'AC-CTD-004 an Admin may set a target through the granted column');
with i as (insert into clearance_items (name, target_days) values ('Admin added', 9) returning target_set_at)
select is((select count(*)::int from i where target_set_at is not null), 1,
  'AC-CTD-004 an item an Admin creates through the API is stamped too');
select is(pg_temp.detail($q$update clearance_items set target_set_at = now() where id = '28310000-0000-0000-0000-000000000c01'$q$),
  '42501 ', 'AC-CTD-004 no client may write target_set_at itself');
select ok(has_column_privilege('authenticated', 'public.clearance_items', 'target_days', 'update'),
  'AC-CTD-004 authenticated clients hold the target_days column grant');
select ok(not has_column_privilege('authenticated', 'public.clearance_items', 'target_set_at', 'update'),
  'AC-CTD-004 authenticated clients hold no target_set_at column grant');
select pg_temp.as_user('b03');
select is(pg_temp.detail($q$insert into clearance_items (name, target_days) values ('Finance item', 5)$q$),
  '42501 ', 'AC-CTD-004 Finance cannot create a clearance item');
select pg_temp.as_user('b02');
select is(pg_temp.detail($q$insert into clearance_items (name, target_days) values ('PM item', 5)$q$),
  '42501 ', 'AC-CTD-004 a Project Manager cannot create a clearance item');
select pg_temp.as_user('b04');
with u as (update clearance_items set target_days = 4 where id = '28310000-0000-0000-0000-000000000c01' returning 1)
select is((select count(*)::int from u), 0, 'AC-CTD-004 an Engineer changes no clearance target');
reset role;

-- ── AC-CTD-005: the due day is the person's creation day + target, only for a person created at/after the stamp ─────────
select is(public.clearance_due_on(now(), null, 5::smallint, 'UTC'), null,
  'AC-CTD-005 no target stamp means no due day');
select is(public.clearance_due_on(now(), now(), null::smallint, 'UTC'), null,
  'AC-CTD-005 no target means no due day');
select is(public.clearance_due_on((select target_set_at from clearance_items where id = '28310000-0000-0000-0000-000000000c01') - interval '1 minute',
                                  (select target_set_at from clearance_items where id = '28310000-0000-0000-0000-000000000c01'),
                                  5::smallint, 'UTC'), null,
  'AC-CTD-005 a person created before the target stamp has no due day');
select is(public.clearance_due_on((select target_set_at from clearance_items where id = '28310000-0000-0000-0000-000000000c01'),
                                  (select target_set_at from clearance_items where id = '28310000-0000-0000-0000-000000000c01'),
                                  5::smallint, 'UTC'),
  ((select target_set_at from clearance_items where id = '28310000-0000-0000-0000-000000000c01') at time zone 'UTC')::date + 5,
  'AC-CTD-005 a person created exactly at the target stamp still has a due day');
select is(public.clearance_due_on((select target_set_at from clearance_items where id = '28310000-0000-0000-0000-000000000c01') + interval '1 hour',
                                  (select target_set_at from clearance_items where id = '28310000-0000-0000-0000-000000000c01'),
                                  5::smallint, 'UTC'),
  ((((select target_set_at from clearance_items where id = '28310000-0000-0000-0000-000000000c01') + interval '1 hour') at time zone 'UTC')::date) + 5,
  'AC-CTD-005 a person created after the target stamp is due from their own creation day');
select ok(public.clearance_due_on(now(), now(), 5::smallint, 'Pacific/Kiritimati')
        > public.clearance_due_on(now(), now(), 5::smallint, 'Pacific/Pago_Pago'),
  'AC-CTD-005 the same instant is a later day at +14 than at -11');
select pg_temp.as_user('b01');
select is(pg_temp.due('28310000-0000-0000-0000-000000000e02', '28310000-0000-0000-0000-000000000c01'),
  ((select created_at from people where id = '28310000-0000-0000-0000-000000000e02') at time zone 'Pacific/Kiritimati')::date + 5,
  'AC-CTD-005 the boundary person is due on their creation day in the organisation zone + 5');
select is(pg_temp.due('28310000-0000-0000-0000-000000000e03', '28310000-0000-0000-0000-000000000c01'),
  ((select created_at from people where id = '28310000-0000-0000-0000-000000000e03') at time zone 'Pacific/Kiritimati')::date + 5,
  'AC-CTD-005 the new person is due on their own creation day + 5');
select is(pg_temp.rows_for('28310000-0000-0000-0000-000000000e01', '28310000-0000-0000-0000-000000000c01'), 0,
  'AC-CTD-005 a person created before the target stamp is not in the due list');
select is(pg_temp.rows_for('28310000-0000-0000-0000-000000000e04', '28310000-0000-0000-0000-000000000c01'), 0,
  'AC-CTD-005 an existing person is unchanged by a target set a second later');
select is(pg_temp.rows_for('28310000-0000-0000-0000-000000000e05', '28310000-0000-0000-0000-000000000c01'), 1,
  'AC-CTD-005 a person with no recorded clearance row is in the due list');
select is(pg_temp.rows_for('28310000-0000-0000-0000-000000000e05', '28310000-0000-0000-0000-000000000c02'), 0,
  'AC-CTD-005 a live document of the item''s type counts as done');
select is(pg_temp.rows_for('28310000-0000-0000-0000-000000000e02', '28310000-0000-0000-0000-000000000c02'), 1,
  'AC-CTD-005 a person with no document of that type is still due');
reset role;
insert into person_clearances (id, person_id, item_id, done_on) values
  ('28310000-0000-0000-0000-000000000ff1', '28310000-0000-0000-0000-000000000e02', '28310000-0000-0000-0000-000000000c01', current_date);
select pg_temp.as_user('b01');
select is(pg_temp.rows_for('28310000-0000-0000-0000-000000000e02', '28310000-0000-0000-0000-000000000c01'), 0,
  'AC-CTD-005 a recorded clearance row removes the item from the due list');
select is(pg_temp.rows_for('28310000-0000-0000-0000-000000000e02', '28310000-0000-0000-0000-000000000c02'), 1,
  'AC-CTD-005 the row for one item does not mark another done');
select is((select overdue from person_clearance_due() d
            where d.person_id = '28310000-0000-0000-0000-000000000e06' and d.item_id = '28310000-0000-0000-0000-000000000c03'),
  true, 'AC-CTD-005 a due day that has passed is overdue');
update expiry_documents set archived_at = now() where id = '28310000-0000-0000-0000-000000000f01';
select is(pg_temp.rows_for('28310000-0000-0000-0000-000000000e05', '28310000-0000-0000-0000-000000000c02'), 1,
  'AC-CTD-005 an archived document no longer counts as done');
select pg_temp.as_user('b61');
select is((select count(*)::int from person_clearance_due()), 0,
  'AC-CTD-005 another organisation''s Admin sees no due clearance item here');
select is((select count(*)::int from clearance_items), 0,
  'AC-CTD-005 another organisation''s Admin reads none of this organisation''s items');
reset role;

-- ── AC-CTD-007: the notice table reads like person_clearances, denies light accounts and takes no client write ───────────
insert into person_clearance_overdue_notices (id, org_id, person_id, item_id) values
  ('28310000-0000-0000-0000-000000000aa1', '28310000-0000-0000-0000-0000000000a1',
   '28310000-0000-0000-0000-000000000e01', '28310000-0000-0000-0000-000000000c01');
select pg_temp.as_user('b01');
select is((select count(*)::int from person_clearance_overdue_notices), 1, 'AC-CTD-007 an Admin reads the organisation''s notice');
select pg_temp.as_user('b02');
select is((select count(*)::int from person_clearance_overdue_notices), 1, 'AC-CTD-007 a Project Manager reads it');
select pg_temp.as_user('b03');
select is((select count(*)::int from person_clearance_overdue_notices), 1, 'AC-CTD-007 Finance reads it');
select is((select count(*)::int from person_clearances), 1, 'AC-CTD-007 Finance reads the clearance row it is modelled on');
select is((select count(*)::int from person_clearance_overdue_notices),
          (select count(*)::int from person_clearances),
  'AC-CTD-007 the notice read matches person_clearances row for row for Finance');
select pg_temp.as_user('b05');
select is((select count(*)::int from person_clearance_overdue_notices), 1, 'AC-CTD-007 an Executive reads it');
select pg_temp.as_user('b04');
select is((select count(*)::int from person_clearance_overdue_notices), 0, 'AC-CTD-007 an Engineer reads no notice');
select is((select count(*)::int from person_clearance_overdue_notices),
          (select count(*)::int from person_clearances),
  'AC-CTD-007 an Engineer reads no notice, exactly as no clearance row');
select pg_temp.as_user('b06');
select is((select count(*)::int from person_clearance_overdue_notices), 0, 'AC-CTD-007 a light account reads no notice');
select is((select count(*)::int from clearance_items), 0, 'AC-CTD-007 a light account reads no clearance item');
select is(pg_temp.err($q$select * from person_clearance_due()$q$),
  '42501 LIGHT_ACCOUNT: this account has one phone home screen and cannot read this',
  'AC-CTD-007 the due-day read refuses a light account with the field-account refusal');
select pg_temp.as_user('b61');
select is((select count(*)::int from person_clearance_overdue_notices), 0,
  'AC-CTD-007 another organisation''s Admin reads no notice');
reset role;
select pg_temp.as_user('b01');
select is(pg_temp.detail($q$insert into person_clearance_overdue_notices (org_id, person_id, item_id)
  values ('28310000-0000-0000-0000-0000000000a1', '28310000-0000-0000-0000-000000000e01', '28310000-0000-0000-0000-000000000c01')$q$),
  '42501 ', 'AC-CTD-007 no client may insert a notice');
select is(pg_temp.detail($q$update person_clearance_overdue_notices set notified_at = now()$q$),
  '42501 ', 'AC-CTD-007 no client may update a notice');
select is(pg_temp.detail($q$delete from person_clearance_overdue_notices$q$),
  '42501 ', 'AC-CTD-007 no client may delete a notice');
reset role;
select ok(has_table_privilege('authenticated', 'public.person_clearance_overdue_notices', 'select'),
  'AC-CTD-007 authenticated clients hold SELECT on the notice table');
select ok(not has_table_privilege('anon', 'public.person_clearance_overdue_notices', 'select'),
  'AC-CTD-007 anon holds no SELECT on the notice table');
select pg_temp.as_anon();
select is(pg_temp.detail($q$select * from person_clearance_due()$q$), '42501 ',
  'AC-CTD-007 anon cannot read the due list');
select is(pg_temp.detail($q$select public.clearance_due_on(now(), now(), 5::smallint, 'UTC')$q$), '42501 ',
  'AC-CTD-007 anon cannot call the due-day seam');
reset role;

select * from finish();
rollback;
