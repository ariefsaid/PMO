-- #2698: payment channel on a purchase request (AC-PCH-001..008). Spec docs/specs/purchase-payment-channel.spec.md.
-- Migrations under test: 1355_payment_channel_schema.sql, 1356_payment_channel_rpcs.sql.
-- Orgs: A (the feature gets switched on), B (never switched on). Mutation notes: spec section 7.
begin;
create extension if not exists pgtap;
select plan(53);

insert into organizations (id, name, default_currency) values
  ('26980000-0000-0000-0000-00000000000a', 'PCH Org A', 'IDR'),
  ('26980000-0000-0000-0000-00000000000b', 'PCH Org B', 'IDR');
-- these features are on by default now (with starter rows); this file proves the off state, so setup clears them as an explicit step
delete from org_payment_channels where org_id in ('26980000-0000-0000-0000-00000000000a', '26980000-0000-0000-0000-00000000000b');
delete from org_payment_channel_settings where org_id in ('26980000-0000-0000-0000-00000000000a', '26980000-0000-0000-0000-00000000000b');
insert into auth.users (id, email) values
  ('26980000-0000-0000-0000-0000000000a1', 'pch-admin@example.com'),
  ('26980000-0000-0000-0000-0000000000a2', 'pch-fin@example.com'),
  ('26980000-0000-0000-0000-0000000000a3', 'pch-pm@example.com'),
  ('26980000-0000-0000-0000-0000000000a4', 'pch-eng@example.com'),
  ('26980000-0000-0000-0000-0000000000b1', 'pch-b-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26980000-0000-0000-0000-0000000000a1', '26980000-0000-0000-0000-00000000000a', 'PCH Admin', 'pch-admin@example.com', 'Admin', 'active'),
  ('26980000-0000-0000-0000-0000000000a2', '26980000-0000-0000-0000-00000000000a', 'PCH Fin',   'pch-fin@example.com',   'Finance', 'active'),
  ('26980000-0000-0000-0000-0000000000a3', '26980000-0000-0000-0000-00000000000a', 'PCH PM',    'pch-pm@example.com',    'Project Manager', 'active'),
  ('26980000-0000-0000-0000-0000000000a4', '26980000-0000-0000-0000-00000000000a', 'PCH Eng',   'pch-eng@example.com',   'Engineer', 'active'),
  ('26980000-0000-0000-0000-0000000000b1', '26980000-0000-0000-0000-00000000000b', 'PCH B Admin', 'pch-b-admin@example.com', 'Admin', 'active');
insert into projects (id, org_id, name, status) values
  ('26980000-0000-0000-0000-0000000000d1', '26980000-0000-0000-0000-00000000000a', 'PCH Site',  'Ongoing Project'),
  ('26980000-0000-0000-0000-0000000000d2', '26980000-0000-0000-0000-00000000000b', 'PCH B Site', 'Ongoing Project');
-- f1 Draft and f2 Requested (both raised by the PM), f3 Paid, f4 Cancelled, fb org B's.
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, budget_category, currency) values
  ('26980000-0000-0000-0000-0000000000f1', '26980000-0000-0000-0000-00000000000a', 'PCH draft',     '26980000-0000-0000-0000-0000000000d1', '26980000-0000-0000-0000-0000000000a3', 'Draft',     1000, 'Materials', 'IDR'),
  ('26980000-0000-0000-0000-0000000000f2', '26980000-0000-0000-0000-00000000000a', 'PCH requested', '26980000-0000-0000-0000-0000000000d1', '26980000-0000-0000-0000-0000000000a3', 'Requested', 1000, 'Materials', 'IDR'),
  ('26980000-0000-0000-0000-0000000000f3', '26980000-0000-0000-0000-00000000000a', 'PCH paid',      '26980000-0000-0000-0000-0000000000d1', '26980000-0000-0000-0000-0000000000a3', 'Paid',      1000, 'Materials', 'IDR'),
  ('26980000-0000-0000-0000-0000000000f4', '26980000-0000-0000-0000-00000000000a', 'PCH cancelled', '26980000-0000-0000-0000-0000000000d1', '26980000-0000-0000-0000-0000000000a3', 'Cancelled', 1000, 'Materials', 'IDR'),
  ('26980000-0000-0000-0000-0000000000fb', '26980000-0000-0000-0000-00000000000b', 'PCH B buy',    '26980000-0000-0000-0000-0000000000d2', '26980000-0000-0000-0000-0000000000b1', 'Draft',     1000, 'Materials', 'IDR');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.ch(p_name text) returns uuid language sql as $$
  select id from org_payment_channels where org_id = '26980000-0000-0000-0000-00000000000a' and name = p_name and archived_at is null
$$;

-- ── Grants (AC-PCH-012 spirit) ──────────────────────────────────────────────────────────────────────────
select is(has_function_privilege('anon', 'public.set_procurement_payment_channel(uuid,uuid)', 'EXECUTE')
       or has_function_privilege('anon', 'public.set_payment_channel_settings(boolean)', 'EXECUTE')
       or has_function_privilege('anon', 'public.save_payment_channel(uuid,text)', 'EXECUTE')
       or has_function_privilege('anon', 'public.archive_payment_channel(uuid,boolean)', 'EXECUTE'), false,
  'AC-PCH-008 anon cannot execute the payment channel RPCs');
select is(has_function_privilege('authenticated', 'public.payment_channel_on(uuid)', 'EXECUTE'), false,
  'AC-PCH-008 the internal feature check is not client-executable');

set local role authenticated;

-- ── AC-PCH-001: off by default, nothing readable ───────────────────────────────────────────────────────────
select pg_temp.act_as('26980000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from org_payment_channel_settings), 0, 'AC-PCH-001 an org with no settings row reads as off');
select is((select count(*)::int from org_payment_channels), 0, 'AC-PCH-001 and has no channels');
-- off: nobody can set a channel, not even Finance on a Draft
select throws_ok($$ select set_procurement_payment_channel('26980000-0000-0000-0000-0000000000f1', null) $$, '42501',
  'Payment channel edit is not permitted', 'AC-PCH-007 the set RPC refuses while the feature is off');

-- ── AC-PCH-003: Admin only ────────────────────────────────────────────────────────────────────────────────
select throws_ok($$ select set_payment_channel_settings(true) $$, '42501', 'only an Admin sets the payment channel feature',
  'AC-PCH-003 Finance cannot switch the feature on');
select pg_temp.act_as('26980000-0000-0000-0000-0000000000a3');
select throws_ok($$ select set_payment_channel_settings(true) $$, '42501', null, 'AC-PCH-003 a Project Manager cannot switch it on');
select pg_temp.act_as('26980000-0000-0000-0000-0000000000a1');
select throws_ok($$ select save_payment_channel(null, 'Wire') $$, '42501', null, 'AC-PCH-003 channels cannot be managed while the feature is off');

-- ── AC-PCH-002: seed once ─────────────────────────────────────────────────────────────────────────────────
select lives_ok($$ select set_payment_channel_settings(true) $$, 'AC-PCH-002 an Admin switches the feature on');
select is((select count(*)::int from org_payment_channels), 4, 'AC-PCH-002 four starter channels are seeded');
select lives_ok($$ select set_payment_channel_settings(false) $$, 'AC-PCH-002 off');
select lives_ok($$ select set_payment_channel_settings(true) $$, 'AC-PCH-002 on again');
select is((select count(*)::int from org_payment_channels), 4, 'AC-PCH-002 switching on again does not seed again');

-- ── AC-PCH-003 / 004: management ──────────────────────────────────────────────────────────────────────────
select pg_temp.act_as('26980000-0000-0000-0000-0000000000a2');
select throws_ok($$ select save_payment_channel(null, 'Wire') $$, '42501', null, 'AC-PCH-003 Finance cannot add a channel');
select throws_ok($$ select archive_payment_channel(pg_temp.ch('Cash'), true) $$, '42501', null, 'AC-PCH-003 Finance cannot archive a channel');
select pg_temp.act_as('26980000-0000-0000-0000-0000000000a1');
select throws_ok($$ select save_payment_channel(null, '  bank TRANSFER ') $$, '23505', null, 'AC-PCH-004 a duplicate name (any case, trimmed) is refused');
select throws_ok($$ select save_payment_channel(null, '   ') $$, '22023', null, 'AC-PCH-004 an empty name is refused');
select throws_ok($$ select save_payment_channel(null, repeat('x', 61)) $$, '22023', null, 'AC-PCH-004 a 61-character name is refused');
select lives_ok($$ select save_payment_channel(null, 'Wire') $$, 'AC-PCH-004 an Admin adds a channel');
select lives_ok($$ select save_payment_channel(pg_temp.ch('Wire'), 'Mobile payment') $$, 'AC-PCH-004 and renames it');
select is((select count(*)::int from org_payment_channels where name = 'Mobile payment'), 1, 'AC-PCH-004 the new name is stored');
select lives_ok($$ select archive_payment_channel(pg_temp.ch('Cheque'), true) $$, 'AC-PCH-004 an Admin archives a channel');
select is((select archived_at is not null from org_payment_channels where name = 'Cheque'), true, 'AC-PCH-004 it is archived, not deleted');
select lives_ok($$ select archive_payment_channel((select id from org_payment_channels where name = 'Cheque'), false) $$, 'AC-PCH-004 and restored');
select lives_ok($$ select archive_payment_channel(pg_temp.ch('Card'), true) $$, 'AC-PCH-004 Card archived for the next checks');

-- ── AC-PCH-001 / 005: tenancy ─────────────────────────────────────────────────────────────────────────────
select is((select count(*)::int from org_payment_channels where org_id <> '26980000-0000-0000-0000-00000000000a'), 0,
  'AC-PCH-005 an org A member sees no other org''s channels');
select pg_temp.act_as('26980000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from org_payment_channels) + (select count(*)::int from org_payment_channel_settings), 0,
  'AC-PCH-001 an org B member sees none of org A''s channels or settings');
select throws_ok($$ select set_procurement_payment_channel('26980000-0000-0000-0000-0000000000f1', null) $$, '42501', null,
  'AC-PCH-007 a caller from another org cannot set a channel on org A''s request');

-- ── AC-PCH-006 / 007: who may set the channel ────────────────────────────────────────────────────────────
-- Branch (a): the requester, while Draft or Rejected.
select pg_temp.act_as('26980000-0000-0000-0000-0000000000a3');
select lives_ok($$ select set_procurement_payment_channel('26980000-0000-0000-0000-0000000000f1', pg_temp.ch('Cash')) $$,
  'AC-PCH-006 the requester sets the channel on their Draft request');
select is((select payment_channel_id from procurements where id = '26980000-0000-0000-0000-0000000000f1'), pg_temp.ch('Cash'),
  'AC-PCH-006 it is stored');
select lives_ok($$ select set_procurement_payment_channel('26980000-0000-0000-0000-0000000000f1', null) $$, 'AC-PCH-006 and cleared with null');
select is((select payment_channel_id from procurements where id = '26980000-0000-0000-0000-0000000000f1'), null, 'AC-PCH-006 cleared');
select throws_ok($$ select set_procurement_payment_channel('26980000-0000-0000-0000-0000000000f2', pg_temp.ch('Cash')) $$, '42501', null,
  'AC-PCH-007 the requester cannot set it once the request is past Draft and Rejected');
select pg_temp.act_as('26980000-0000-0000-0000-0000000000a4');
select throws_ok($$ select set_procurement_payment_channel('26980000-0000-0000-0000-0000000000f1', pg_temp.ch('Cash')) $$, '42501', null,
  'AC-PCH-007 another non-Admin, non-Finance member cannot set it on someone else''s Draft');
-- Branch (a), Admin.
select pg_temp.act_as('26980000-0000-0000-0000-0000000000a1');
select lives_ok($$ select set_procurement_payment_channel('26980000-0000-0000-0000-0000000000f1', pg_temp.ch('Cash')) $$,
  'AC-PCH-006 an Admin sets it on a Draft request');
-- Branch (b): Finance or Admin at any status until Paid or Cancelled.
select pg_temp.act_as('26980000-0000-0000-0000-0000000000a2');
select lives_ok($$ select set_procurement_payment_channel('26980000-0000-0000-0000-0000000000f1', pg_temp.ch('Bank transfer')) $$,
  'AC-PCH-006 Finance changes it on a Draft request raised by someone else');
select lives_ok($$ select set_procurement_payment_channel('26980000-0000-0000-0000-0000000000f2', pg_temp.ch('Bank transfer')) $$,
  'AC-PCH-006 Finance sets it on a Requested request');
select is((select payment_channel_id from procurements where id = '26980000-0000-0000-0000-0000000000f2'), pg_temp.ch('Bank transfer'),
  'AC-PCH-006 it is stored on the Requested request');
select pg_temp.act_as('26980000-0000-0000-0000-0000000000a1');
select lives_ok($$ select set_procurement_payment_channel('26980000-0000-0000-0000-0000000000f2', pg_temp.ch('Cash')) $$,
  'AC-PCH-006 an Admin changes it on a Requested request');
-- Refusals after Paid / Cancelled, for both branch (b) roles.
select throws_ok($$ select set_procurement_payment_channel('26980000-0000-0000-0000-0000000000f3', pg_temp.ch('Cash')) $$, '42501', null,
  'AC-PCH-007 an Admin cannot set it on a Paid request');
select throws_ok($$ select set_procurement_payment_channel('26980000-0000-0000-0000-0000000000f4', pg_temp.ch('Cash')) $$, '42501', null,
  'AC-PCH-007 an Admin cannot set it on a Cancelled request');
select pg_temp.act_as('26980000-0000-0000-0000-0000000000a2');
select throws_ok($$ select set_procurement_payment_channel('26980000-0000-0000-0000-0000000000f3', pg_temp.ch('Cash')) $$, '42501', null,
  'AC-PCH-007 Finance cannot set it on a Paid request');
select throws_ok($$ select set_procurement_payment_channel('26980000-0000-0000-0000-0000000000f4', null) $$, '42501', null,
  'AC-PCH-007 Finance cannot clear it on a Cancelled request');
-- Channel checks.
select throws_ok($$ select set_procurement_payment_channel('26980000-0000-0000-0000-0000000000f2', (select id from org_payment_channels where name = 'Card')) $$, '42501', null,
  'AC-PCH-007 an archived channel cannot be chosen');
select throws_ok($$ select set_procurement_payment_channel('26980000-0000-0000-0000-0000000000f2', '26980000-0000-0000-0000-0000000000ee') $$, '42501', null,
  'AC-PCH-007 a channel that does not exist in the org cannot be chosen');
-- Another org's real, live channel (tenancy): org B has one; an org A caller cannot put it on an org A request.
reset role;
insert into org_payment_channels (id, org_id, name, sort_order) values
  ('26980000-0000-0000-0000-0000000000ec', '26980000-0000-0000-0000-00000000000b', 'PCH B live channel', 1);
set local role authenticated;
select pg_temp.act_as('26980000-0000-0000-0000-0000000000a2');
select throws_ok($$ select set_procurement_payment_channel('26980000-0000-0000-0000-0000000000f2', '26980000-0000-0000-0000-0000000000ec') $$, '42501', null,
  'AC-PCH-007 another organisation''s live channel cannot be put on a request');
select is((select payment_channel_id from procurements where id = '26980000-0000-0000-0000-0000000000f2'), pg_temp.ch('Cash'),
  'AC-PCH-007 and the request''s channel is unchanged');
-- Feature off again: refused for everyone.
select pg_temp.act_as('26980000-0000-0000-0000-0000000000a1');
select lives_ok($$ select set_payment_channel_settings(false) $$, 'AC-PCH-007 an Admin switches the feature off');
select throws_ok($$ select set_procurement_payment_channel('26980000-0000-0000-0000-0000000000f2', pg_temp.ch('Cash')) $$, '42501', null,
  'AC-PCH-007 an Admin cannot set it while the feature is off');

-- ── AC-PCH-008: the column is RPC-only ───────────────────────────────────────────────────────────────────
select pg_temp.act_as('26980000-0000-0000-0000-0000000000a3');
select throws_ok($$ update procurements set payment_channel_id = null where id = '26980000-0000-0000-0000-0000000000f1' $$, '42501', null,
  'AC-PCH-008 a direct update of the channel column is refused');

-- ── Audit: every change is recorded ───────────────────────────────────────────────────────────────────────
reset role;
select is((select count(*)::int from audit_events where action = 'procurement.payment_channel'
            and entity_id = '26980000-0000-0000-0000-0000000000f1'), 4,
  'AC-PCH-006 each change on the Draft request is audited (set, clear, Admin set, Finance change)');
select is((select count(*)::int from audit_events where action = 'procurement.payment_channel'
            and entity_id = '26980000-0000-0000-0000-0000000000f2'), 2,
  'AC-PCH-006 each change on the Requested request is audited');
select is((select count(*)::int from audit_events where action = 'payment_channel.settings'), 4,
  'AC-PCH-002 each switch change is audited');

select * from finish();
rollback;
