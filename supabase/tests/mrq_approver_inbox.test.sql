-- mrq_approver_inbox.test.sql — #2685 material-request approvers are notified; the setting gates it.
-- Spec docs/specs/material-request-approver-inbox.spec.md (AC-MRI-001..011). Migrations under test: 1335..1337.
-- Every denial asserts the errcode AND the message. Mutation points are tagged `-- mut:` in the migrations.
begin;
create extension if not exists pgtap;
select plan(33);

insert into organizations (id, name, default_currency, default_timezone) values
  ('26850000-0000-0000-0000-00000000000a', 'Inbox Org', 'IDR', 'Asia/Jakarta'), ('26850000-0000-0000-0000-00000000000b', 'Inbox Other Org', 'IDR', 'Asia/Jakarta');
insert into auth.users (id, email) values
  ('26850000-0000-0000-0000-0000000000a1', 'ib-admin@example.com'), ('26850000-0000-0000-0000-0000000000a2', 'ib-req@example.com'), ('26850000-0000-0000-0000-0000000000a3', 'ib-pm@example.com'),
  ('26850000-0000-0000-0000-0000000000a4', 'ib-eng@example.com'), ('26850000-0000-0000-0000-0000000000a5', 'ib-fin@example.com'), ('26850000-0000-0000-0000-0000000000a6', 'ib-fin2@example.com'),
  ('26850000-0000-0000-0000-0000000000a7', 'ib-exec@example.com'), ('26850000-0000-0000-0000-0000000000a8', 'ib-gone@example.com'), ('26850000-0000-0000-0000-0000000000b1', 'ib-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26850000-0000-0000-0000-0000000000a1', '26850000-0000-0000-0000-00000000000a', 'Ib Admin', 'ib-admin@example.com', 'Admin', 'active'),
  ('26850000-0000-0000-0000-0000000000a2', '26850000-0000-0000-0000-00000000000a', 'Ib Req',   'ib-req@example.com',   'Engineer', 'active'),
  ('26850000-0000-0000-0000-0000000000a3', '26850000-0000-0000-0000-00000000000a', 'Ib PM',    'ib-pm@example.com',    'Project Manager', 'active'),
  ('26850000-0000-0000-0000-0000000000a4', '26850000-0000-0000-0000-00000000000a', 'Ib Eng',   'ib-eng@example.com',   'Engineer', 'active'),
  ('26850000-0000-0000-0000-0000000000a5', '26850000-0000-0000-0000-00000000000a', 'Ib Fin',   'ib-fin@example.com',   'Finance', 'active'),
  ('26850000-0000-0000-0000-0000000000a6', '26850000-0000-0000-0000-00000000000a', 'Ib Fin2',  'ib-fin2@example.com',  'Finance', 'active'),
  ('26850000-0000-0000-0000-0000000000a7', '26850000-0000-0000-0000-00000000000a', 'Ib Exec',  'ib-exec@example.com',  'Executive', 'active'),
  ('26850000-0000-0000-0000-0000000000a8', '26850000-0000-0000-0000-00000000000a', 'Ib Gone',  'ib-gone@example.com',  'Finance', 'disabled'),
  ('26850000-0000-0000-0000-0000000000b1', '26850000-0000-0000-0000-00000000000b', 'Ib XOrg',  'ib-xorg@example.com',  'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('26850000-0000-0000-0000-0000000000d1', '26850000-0000-0000-0000-00000000000a', 'Ib Site', 'Ongoing Project', '26850000-0000-0000-0000-0000000000a3');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('26850000-0000-0000-0000-000000000401', '26850000-0000-0000-0000-00000000000a', '26850000-0000-0000-0000-0000000000d1', 'Ib WO', 'Issued', 10000, 'exclusive', 0);
insert into stock_units (id, org_id, code, name, whole_only) values ('26850000-0000-0000-0000-000000000301', '26850000-0000-0000-0000-00000000000a', 'BAG', 'Bag', true);
insert into stock_items (id, org_id, code, name, unit_id) values ('26850000-0000-0000-0000-000000000311', '26850000-0000-0000-0000-00000000000a', 'CEM', 'Cement', '26850000-0000-0000-0000-000000000301');
insert into stock_warehouses (id, org_id, code, name, kind, project_id) values
  ('26850000-0000-0000-0000-000000000801', '26850000-0000-0000-0000-00000000000a', 'IB-C', 'Central', 'central', null),
  ('26850000-0000-0000-0000-000000000802', '26850000-0000-0000-0000-00000000000a', 'IB-S', 'Site one', 'site', '26850000-0000-0000-0000-0000000000d1');
insert into stock_warehouse_keepers (org_id, warehouse_id, user_id) values
  ('26850000-0000-0000-0000-00000000000a', '26850000-0000-0000-0000-000000000801', '26850000-0000-0000-0000-0000000000a5'), ('26850000-0000-0000-0000-00000000000a', '26850000-0000-0000-0000-000000000801', '26850000-0000-0000-0000-0000000000a6'), ('26850000-0000-0000-0000-00000000000a', '26850000-0000-0000-0000-000000000801', '26850000-0000-0000-0000-0000000000a7');

create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp._as(uuid) to authenticated;
-- Who holds an unread step notification for the request, as a sorted list of the last two characters of their ids.
create or replace function pg_temp._who(p_req uuid) returns text language sql security definer as $$
  select coalesce(string_agg(right(n.owner_id::text, 2), ',' order by n.owner_id), '')
    from public.notifications n where n.metadata -> 'entity' ->> 'id' = p_req::text and n.metadata ? 'mrq_step_id' and n.read_at is null
$$;
grant execute on function pg_temp._who(uuid) to authenticated;
create or replace function pg_temp._on(p uuid) returns boolean language sql security definer as $$ select public.mrq_approver_inbox_on(p) $$;
grant execute on function pg_temp._on(uuid) to authenticated;
create or replace function pg_temp._cnt(p_req uuid) returns int language sql security definer as $$ select count(*)::int from public.notifications n where n.metadata -> 'entity' ->> 'id' = p_req::text $$;
grant execute on function pg_temp._cnt(uuid) to authenticated;
create or replace function pg_temp._cntall() returns int language sql security definer as $$ select count(*)::int from public.notifications n where n.metadata ? 'mrq_step_id' $$;
grant execute on function pg_temp._cntall() to authenticated;
create or replace function pg_temp._raise() returns uuid language plpgsql as $$
declare v uuid;
begin
  perform pg_temp._as('26850000-0000-0000-0000-0000000000a2');
  v := public.mrq_save_draft(null,
         jsonb_build_object('work_order_id', '26850000-0000-0000-0000-000000000401', 'needed_by', current_date + 5),
         jsonb_build_array(jsonb_build_object('item_id', '26850000-0000-0000-0000-000000000311', 'quantity', 10, 'over_plan_reason', 'pour')));
  perform public.mrq_submit(v);
  return v;
end $$;
grant execute on function pg_temp._raise() to authenticated;
create or replace function pg_temp._dec(p_uid uuid, p_req uuid, p_pos int, p_dec text default 'approve') returns void language plpgsql as $$
begin
  perform pg_temp._as(p_uid);
  perform public.mrq_decide_step(p_req, p_pos, p_dec, case when p_dec = 'approve' then null else 'no' end,
                                 '26850000-0000-0000-0000-000000000801');
end $$;
grant execute on function pg_temp._dec(uuid, uuid, int, text) to authenticated;
-- Parity: the people with a notification for the request are exactly the people whose queue lists it.
create or replace function pg_temp._parity(p_req uuid) returns boolean language plpgsql as $$
declare ok boolean := true; p record; v_n boolean; v_w boolean;
begin
  for p in select id from public.profiles where org_id = '26850000-0000-0000-0000-00000000000a' loop
    perform set_config('request.jwt.claims', json_build_object('sub', p.id, 'role', 'authenticated')::text, true);
    v_n := exists (select 1 from public.notifications n where n.owner_id = p.id and n.metadata -> 'entity' ->> 'id' = p_req::text and n.metadata ? 'mrq_step_id');
    v_w := exists (select 1 from public.mrq_waiting_for_me() w where w.request_id = p_req);
    if v_n is distinct from v_w then ok := false; end if;
  end loop;
  return ok;
end $$;
grant execute on function pg_temp._parity(uuid) to authenticated;
create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated;

set local role authenticated;
select pg_temp._as('26850000-0000-0000-0000-0000000000a1');
select public.mrq_set_chain('[{"role":"Engineer","label":"Plan check"},{"role":"Project Manager","label":"Billable change"},{"role":"Finance","label":"Stock"}]'::jsonb);

select is(pg_temp._on('26850000-0000-0000-0000-00000000000a'), false, 'AC-MRI-001 the setting is off for an organisation that never set it');
select pg_temp._as('26850000-0000-0000-0000-0000000000a2');
select throws_ok($$ select public.mrq_set_approver_inbox(true) $$, '42501',
  'MRQ_ADMIN_ONLY: only an Admin can change the approvals inbox setting', 'AC-MRI-001 a non-Admin cannot change it');
select pg_temp._as('26850000-0000-0000-0000-0000000000b1'); select public.mrq_set_approver_inbox(true);
select is(pg_temp._on('26850000-0000-0000-0000-00000000000a'), false, 'AC-MRI-001 another organisation Admin turning it on does not touch this organisation');
insert into t_ids values ('r1', pg_temp._raise());
select is(pg_temp._who((select v from t_ids where k = 'r1')), '', 'AC-MRI-002 setting off: a submitted request notifies no one');
select pg_temp._as('26850000-0000-0000-0000-0000000000a1'); select public.mrq_set_approver_inbox(true);
select is(pg_temp._who((select v from t_ids where k = 'r1')), 'a4', 'AC-MRI-012 switching on backfills the step open now: the Engineer holder, not the author');
select public.mrq_set_approver_inbox(false);
select is(pg_temp._cntall(), 0, 'AC-MRI-013 switching off deletes the unread step notifications');
select public.mrq_set_approver_inbox(true);
insert into t_ids values ('r2', pg_temp._raise());
select is(pg_temp._who((select v from t_ids where k = 'r2')), 'a4', 'AC-MRI-003 submit notifies the step-1 role holder, not the author, other roles or another organisation');
select pg_temp._dec('26850000-0000-0000-0000-0000000000a4', (select v from t_ids where k = 'r2'), 1);
select is(pg_temp._who((select v from t_ids where k = 'r2')), 'a3', 'AC-MRI-004 step 1 approved: step 2 holder notified');
select is(pg_temp._cnt((select v from t_ids where k = 'r2')), 1, 'AC-MRI-004 step 1 notifications are gone');
select pg_temp._dec('26850000-0000-0000-0000-0000000000a3', (select v from t_ids where k = 'r2'), 2);
select is(pg_temp._who((select v from t_ids where k = 'r2')), 'a5,a6', 'AC-MRI-003 step 3: the active Finance holders only (the deactivated one is not)');
select ok(pg_temp._parity((select v from t_ids where k = 'r2')), 'AC-MRI-009 notified set equals the queue set (role step)');
select pg_temp._as('26850000-0000-0000-0000-0000000000a1');
select pg_temp._as('26850000-0000-0000-0000-0000000000a1'); select public.mrq_set_step_pin('26850000-0000-0000-0000-0000000000d1', 3, '26850000-0000-0000-0000-0000000000a6');
select is(pg_temp._who((select v from t_ids where k = 'r2')), 'a6', 'AC-MRI-010 pinning an open step re-points the notification to the pinned person');
select ok(pg_temp._parity((select v from t_ids where k = 'r2')), 'AC-MRI-009 parity with a live pin');
select pg_temp._as('26850000-0000-0000-0000-0000000000a1');
select public.mrq_set_step_pin('26850000-0000-0000-0000-0000000000d1', 3, null);
select is(pg_temp._who((select v from t_ids where k = 'r2')), 'a5,a6', 'AC-MRI-010 clearing the pin returns the step to the role holders');
select public.mrq_set_stand_in('26850000-0000-0000-0000-0000000000a5', '26850000-0000-0000-0000-0000000000a7', current_date - 1, current_date + 1);
select is(pg_temp._who((select v from t_ids where k = 'r2')), 'a5,a6,a7', 'AC-MRI-006 an in-window stand-in is notified');
select ok(pg_temp._parity((select v from t_ids where k = 'r2')), 'AC-MRI-009 parity with a stand-in');
select pg_temp._as('26850000-0000-0000-0000-0000000000a1');
select public.mrq_revoke_stand_in((select id from approval_stand_ins where stand_in_id = '26850000-0000-0000-0000-0000000000a7'));
select is(pg_temp._who((select v from t_ids where k = 'r2')), 'a5,a6', 'AC-MRI-010 a revoked stand-in loses it');
select public.mrq_set_stand_in('26850000-0000-0000-0000-0000000000a5', '26850000-0000-0000-0000-0000000000a7', current_date + 3, current_date + 5);
select is(pg_temp._who((select v from t_ids where k = 'r2')), 'a5,a6', 'AC-MRI-006 a stand-in outside the window is not notified');
select public.mrq_set_stand_in('26850000-0000-0000-0000-0000000000a5', '26850000-0000-0000-0000-0000000000a2', current_date - 1, current_date + 1);
select is(pg_temp._who((select v from t_ids where k = 'r2')), 'a5,a6', 'AC-MRI-006 a stand-in who is the author is not notified');
select pg_temp._dec('26850000-0000-0000-0000-0000000000a5', (select v from t_ids where k = 'r2'), 3, 'reject');
select is(pg_temp._who((select v from t_ids where k = 'r2')), '', 'AC-MRI-008 a rejected request notifies no one');
insert into t_ids values ('r3', pg_temp._raise());
select pg_temp._dec('26850000-0000-0000-0000-0000000000a4', (select v from t_ids where k = 'r3'), 1, 'return');
select is(pg_temp._who((select v from t_ids where k = 'r3')), '', 'AC-MRI-008 a returned request notifies no one');
select pg_temp._as('26850000-0000-0000-0000-0000000000a2'); select public.mrq_submit((select v from t_ids where k = 'r3'));
select is(pg_temp._who((select v from t_ids where k = 'r3')), 'a4', 'AC-MRI-004 a resubmission restarts at step 1 and notifies again');
select public.mrq_cancel((select v from t_ids where k = 'r3'));
select is(pg_temp._who((select v from t_ids where k = 'r3')), '', 'AC-MRI-008 a cancelled request notifies no one');
insert into t_ids values ('r4', pg_temp._raise());
select pg_temp._dec('26850000-0000-0000-0000-0000000000a4', (select v from t_ids where k = 'r4'), 1); select pg_temp._dec('26850000-0000-0000-0000-0000000000a3', (select v from t_ids where k = 'r4'), 2);
reset role; update profiles set role = 'Finance' where id = '26850000-0000-0000-0000-0000000000a4'; set local role authenticated;
select pg_temp._as('26850000-0000-0000-0000-0000000000a1'); select public.mrq_set_approver_inbox(false); select public.mrq_set_approver_inbox(true);
select is(pg_temp._who((select v from t_ids where k = 'r4')), 'a5,a6', 'AC-MRI-007 someone who decided step 1 and now holds the step 3 role is not notified');
select ok(pg_temp._parity((select v from t_ids where k = 'r4')), 'AC-MRI-009 parity with the earlier-decision rule');
select pg_temp._as('26850000-0000-0000-0000-0000000000a1');
reset role; update profiles set role = 'Engineer' where id = '26850000-0000-0000-0000-0000000000a4'; set local role authenticated;
select pg_temp._as('26850000-0000-0000-0000-0000000000a1'); select public.mrq_set_step_pin('26850000-0000-0000-0000-0000000000d1', 3, '26850000-0000-0000-0000-0000000000a6');
reset role; update profiles set status = 'disabled' where id = '26850000-0000-0000-0000-0000000000a6'; set local role authenticated;
insert into t_ids values ('r5', pg_temp._raise());
select pg_temp._dec('26850000-0000-0000-0000-0000000000a4', (select v from t_ids where k = 'r5'), 1); select pg_temp._dec('26850000-0000-0000-0000-0000000000a3', (select v from t_ids where k = 'r5'), 2);
select is(pg_temp._who((select v from t_ids where k = 'r5')), 'a5', 'AC-MRI-005 a stuck pin (deactivated person) falls back to the active role holders');
select ok(pg_temp._parity((select v from t_ids where k = 'r5')), 'AC-MRI-009 parity with a stuck pin');
select pg_temp._as('26850000-0000-0000-0000-0000000000a1');
reset role; update profiles set status = 'active' where id = '26850000-0000-0000-0000-0000000000a6'; set local role authenticated;
select pg_temp._as('26850000-0000-0000-0000-0000000000a1'); select public.mrq_set_step_pin('26850000-0000-0000-0000-0000000000d1', 3, '26850000-0000-0000-0000-0000000000a6');
select is(pg_temp._who((select v from t_ids where k = 'r5')), 'a6', 'AC-MRI-005 a live pin notifies only the pinned person');
select public.mrq_set_approver_inbox(false);
insert into t_ids values ('r6', pg_temp._raise());
select is(pg_temp._who((select v from t_ids where k = 'r6')), '', 'AC-MRI-002 setting off again: a new request notifies no one');
select is(pg_temp._cntall(), 0, 'AC-MRI-013 and nothing is left from the earlier requests');
select pg_temp._as('26850000-0000-0000-0000-0000000000a2');
select throws_ok($$ insert into notifications (org_id, owner_id, title) values ('26850000-0000-0000-0000-00000000000a', '26850000-0000-0000-0000-0000000000a4', 'x') $$, '42501', null, 'AC-MRI-011 a client cannot write a notification for another person');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('mrq_step_recipients','mrq_sync_step_notifications','mrq_approver_inbox_on','mrq_step_notify_trg','mrq_pin_notify_trg','mrq_stand_in_notify_trg','mrq_request_notify_trg') and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))), 0, 'AC-MRI-011 no recipient helper or trigger function is executable by a client');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'mrq\_%' and has_function_privilege('authenticated', p.oid, 'execute') and pg_get_function_arguments(p.oid) ~* 'recipient|owner_id|notif'), 0, 'AC-MRI-011 no mrq function takes a recipient');
select * from finish();
rollback;
