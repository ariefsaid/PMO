-- 1560_waiting_decisions.test.sql — fix-waiting item 1: one waiting list for the kinds of decision that had no per-person read.
-- Migration under test: 1560_waiting_decisions.sql. Each case asserts what the SAME gate as the deciding function lets the caller decide.
begin;
create extension if not exists pgtap;
select plan(27);

insert into organizations (id, name, default_currency, default_timezone) values
  ('15600000-0000-0000-0000-00000000000a', 'Wait Org', 'IDR', 'Asia/Jakarta'), ('15600000-0000-0000-0000-00000000000b', 'Wait Other Org', 'IDR', 'Asia/Jakarta');
insert into auth.users (id, email) values
  ('15600000-0000-0000-0000-0000000000a1', 'w-admin@example.com'), ('15600000-0000-0000-0000-0000000000a2', 'w-eng@example.com'),
  ('15600000-0000-0000-0000-0000000000a3', 'w-pm@example.com'), ('15600000-0000-0000-0000-0000000000a4', 'w-eng2@example.com'),
  ('15600000-0000-0000-0000-0000000000a5', 'w-fin@example.com'), ('15600000-0000-0000-0000-0000000000a7', 'w-exec@example.com'),
  ('15600000-0000-0000-0000-0000000000a8', 'w-pm2@example.com'), ('15600000-0000-0000-0000-0000000000b1', 'w-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15600000-0000-0000-0000-0000000000a1', '15600000-0000-0000-0000-00000000000a', 'W Admin', 'w-admin@example.com', 'Admin', 'active'),
  ('15600000-0000-0000-0000-0000000000a2', '15600000-0000-0000-0000-00000000000a', 'W Eng',   'w-eng@example.com',   'Engineer', 'active'),
  ('15600000-0000-0000-0000-0000000000a3', '15600000-0000-0000-0000-00000000000a', 'W PM',    'w-pm@example.com',    'Project Manager', 'active'),
  ('15600000-0000-0000-0000-0000000000a4', '15600000-0000-0000-0000-00000000000a', 'W Eng2',  'w-eng2@example.com',  'Engineer', 'active'),
  ('15600000-0000-0000-0000-0000000000a5', '15600000-0000-0000-0000-00000000000a', 'W Fin',   'w-fin@example.com',   'Finance', 'active'),
  ('15600000-0000-0000-0000-0000000000a7', '15600000-0000-0000-0000-00000000000a', 'W Exec',  'w-exec@example.com',  'Executive', 'active'),
  ('15600000-0000-0000-0000-0000000000a8', '15600000-0000-0000-0000-00000000000a', 'W PM2',   'w-pm2@example.com',   'Project Manager', 'active'),
  ('15600000-0000-0000-0000-0000000000b1', '15600000-0000-0000-0000-00000000000b', 'W XOrg',  'w-xorg@example.com',  'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('15600000-0000-0000-0000-0000000000d1', '15600000-0000-0000-0000-00000000000a', 'Wait Site', 'Ongoing Project', '15600000-0000-0000-0000-0000000000a3');

create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp._kinds(p_uid uuid) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp._as(p_uid);
  select coalesce(string_agg(kind, ',' order by kind), '') into v from public.my_waiting_decisions();
  return v;
end $$;

-- A Draft work order whose value the PM set (the witness is stamped from the acting user).
select pg_temp._as('15600000-0000-0000-0000-0000000000a3');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('15600000-0000-0000-0000-000000000401', '15600000-0000-0000-0000-00000000000a', '15600000-0000-0000-0000-0000000000d1', 'Wait WO', 'Draft', 5000, 'exclusive', 0);
select pg_temp._as('15600000-0000-0000-0000-0000000000a1');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('15600000-0000-0000-0000-000000000402', '15600000-0000-0000-0000-00000000000a', '15600000-0000-0000-0000-0000000000d1', 'Admin set WO', 'Draft', 7000, 'exclusive', 0);
-- A report submitted by an engineer.
insert into daily_site_reports (id, org_id, project_id, work_order_id, work_date, status, author_id, submitted_at) values
  ('15600000-0000-0000-0000-000000000501', '15600000-0000-0000-0000-00000000000a', '15600000-0000-0000-0000-0000000000d1', '15600000-0000-0000-0000-000000000401', current_date - 1, 'submitted', '15600000-0000-0000-0000-0000000000a2', now());
-- A second report, written by the project's manager: the manager must not be offered their own.
insert into daily_site_reports (id, org_id, project_id, work_order_id, work_date, status, author_id, submitted_at) values
  ('15600000-0000-0000-0000-000000000502', '15600000-0000-0000-0000-00000000000a', '15600000-0000-0000-0000-0000000000d1', '15600000-0000-0000-0000-000000000401', current_date - 2, 'submitted', '15600000-0000-0000-0000-0000000000a3', now());
-- An ordered purchase raised by engineer 2.
insert into procurements (id, org_id, title, project_id, status, requested_by_id) values
  ('15600000-0000-0000-0000-000000000601', '15600000-0000-0000-0000-00000000000a', 'Wait delivery', '15600000-0000-0000-0000-0000000000d1', 'Ordered', '15600000-0000-0000-0000-0000000000a4');

-- A transfer the PM sent, addressed to engineer 2.
insert into stock_warehouses (id, org_id, code, name, kind) values
  ('15600000-0000-0000-0000-000000000701', '15600000-0000-0000-0000-00000000000a', 'WC', 'Wait central', 'central'),
  ('15600000-0000-0000-0000-000000000702', '15600000-0000-0000-0000-00000000000a', 'WS', 'Wait site', 'site'),
  ('15600000-0000-0000-0000-000000000703', '15600000-0000-0000-0000-00000000000a', 'WT', 'Wait transit', 'site');
insert into stock_transfers (id, org_id, number, from_warehouse_id, to_warehouse_id, transit_warehouse_id, to_user_id, status, sent_by) values
  ('15600000-0000-0000-0000-000000000801', '15600000-0000-0000-0000-00000000000a', 'TR-W1', '15600000-0000-0000-0000-000000000701', '15600000-0000-0000-0000-000000000702', '15600000-0000-0000-0000-000000000703', '15600000-0000-0000-0000-0000000000a4', 'Sent', '15600000-0000-0000-0000-0000000000a3');

-- More than the former 500-row cap, with tied timestamps across kinds. The delivery and work-order
-- rows are deliberately after the daily-report branch in the UNION so an unordered cap loses them.
insert into daily_site_reports (id, org_id, project_id, work_order_id, work_date, status, author_id, submitted_at)
select ('15600000-0000-0000-0000-' || lpad(to_hex(i), 12, '0'))::uuid,
       '15600000-0000-0000-0000-00000000000a', '15600000-0000-0000-0000-0000000000d1',
       '15600000-0000-0000-0000-000000000401', current_date - i - 2, 'submitted',
       '15600000-0000-0000-0000-0000000000a2', '2000-01-01 00:00:00+00'
  from generate_series(1, 501) as i;
insert into procurements (id, org_id, title, project_id, status, requested_by_id, updated_at) values
  ('15600000-0000-0000-0000-000000000602', '15600000-0000-0000-0000-00000000000a', 'Tied delivery', '15600000-0000-0000-0000-0000000000d1', 'Ordered', '15600000-0000-0000-0000-0000000000a4', '2000-01-01 00:00:00+00');

set local role authenticated;

select pg_temp._as('15600000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from public.my_waiting_decisions()), 506,
  '#1122: the shared waiting list includes every eligible row beyond 500 across decision kinds');
select is((select count(*)::int from public.my_waiting_decisions() where kind = 'daily_report'), 503,
  '#1122: the over-limit fixture has 501 tied daily reports plus the two existing eligible reports');
select ok((select bool_and(
             created_at > prior_created_at
             or (created_at = prior_created_at and kind > prior_kind)
             or (created_at = prior_created_at and kind = prior_kind and record_id > prior_record_id))
             from (
               select created_at, kind, record_id,
                      lag(created_at) over (order by ordinality) as prior_created_at,
                      lag(kind) over (order by ordinality) as prior_kind,
                      lag(record_id) over (order by ordinality) as prior_record_id
                 from public.my_waiting_decisions() with ordinality as waiting(kind, record_id, project_id, title, created_at, ordinality)
             ) ordered
            where prior_created_at is not null),
  '#1122: every row has a strict timestamp, kind and record-id order');
select is((select array_agg(kind || ':' || record_id::text order by ordinality)
             from public.my_waiting_decisions() with ordinality as waiting(kind, record_id, project_id, title, created_at, ordinality)
            where ordinality between 501 and 502),
  array['daily_report:15600000-0000-0000-0000-0000000001f5', 'delivery_record:15600000-0000-0000-0000-000000000602'],
  '#1122: timestamp ties are ordered by kind and then record id, including a later UNION kind');
reset role;
update daily_site_reports set status = 'validated', validated_by = '15600000-0000-0000-0000-0000000000a1', validated_at = now()
 where id between '15600000-0000-0000-0000-000000000001'::uuid and '15600000-0000-0000-0000-0000000001f5'::uuid;
update procurements set status = 'Received' where id = '15600000-0000-0000-0000-000000000602';
set local role authenticated;

select is(pg_temp._kinds('15600000-0000-0000-0000-0000000000a1'), 'daily_report,daily_report,delivery_record,work_order_issue',
  'AC-WAIT-001 the Admin sees the daily report, the delivery record and the order the PM priced, not the one they priced themselves');
select is(pg_temp._kinds('15600000-0000-0000-0000-0000000000a2'), '',
  'AC-WAIT-002 the report''s author sees nothing: never their own report (SoD)');
select is(pg_temp._kinds('15600000-0000-0000-0000-0000000000a3'), 'daily_report,delivery_record,work_order_issue',
  'AC-WAIT-003 the project''s manager validates the report, receives the delivery, and issues the Admin-set order but not their own');
select is(pg_temp._kinds('15600000-0000-0000-0000-0000000000a8'), '',
  'AC-WAIT-004 a Project Manager of another project sees none of these');
select is(pg_temp._kinds('15600000-0000-0000-0000-0000000000a4'), 'delivery_record,transfer_receipt',
  'AC-WAIT-005 the requester of an ordered purchase confirms its delivery, and the person a transfer is addressed to receives it');
select is(pg_temp._kinds('15600000-0000-0000-0000-0000000000a3'), 'daily_report,delivery_record,work_order_issue',
  'AC-WAIT-005b the person who sent the transfer is not asked to receive it');
select is(pg_temp._kinds('15600000-0000-0000-0000-0000000000a5'), 'daily_report,daily_report,work_order_issue,work_order_issue',
  'AC-WAIT-006 Finance validates the report and may issue both orders (won-value authority), but cannot receive another person''s delivery');
select is(pg_temp._kinds('15600000-0000-0000-0000-0000000000a7'), 'work_order_issue,work_order_issue',
  'AC-WAIT-007 the Executive issues both orders and validates no report');
select is(pg_temp._kinds('15600000-0000-0000-0000-0000000000b1'), '', 'AC-WAIT-008 another organisation sees nothing');

-- A disabled author is irrelevant; a withdrawn state leaves the list.
reset role;
update daily_site_reports set status = 'validated', validated_by = '15600000-0000-0000-0000-0000000000a1', validated_at = now() where id in ('15600000-0000-0000-0000-000000000501', '15600000-0000-0000-0000-000000000502');
update procurements set status = 'Received' where id = '15600000-0000-0000-0000-000000000601';
update work_orders set status = 'Issued', wo_number = 'WO-W1', issued_by = '15600000-0000-0000-0000-0000000000a1', issued_at = now() where id = '15600000-0000-0000-0000-000000000402';
set local role authenticated;
select is(pg_temp._kinds('15600000-0000-0000-0000-0000000000a1'), 'work_order_issue',
  'AC-WAIT-009 a validated report, a received delivery and an issued order leave the list');

-- A zero-value draft is not waiting for anyone.
reset role;
update work_orders set order_value = 0 where id = '15600000-0000-0000-0000-000000000401';
set local role authenticated;
select is(pg_temp._kinds('15600000-0000-0000-0000-0000000000a1'), '', 'AC-WAIT-010 a draft with no value has nothing to ratify');

-- Standing: who is offered the Approvals entry.
select pg_temp._as('15600000-0000-0000-0000-0000000000a1');
select is(public.my_decision_standing(), true, 'AC-WAIT-011 a decision role has standing');
select pg_temp._as('15600000-0000-0000-0000-0000000000a2');
select is(public.my_decision_standing(), false, 'AC-WAIT-012 an Engineer with no step, pin, stand-in or reports has none');
reset role;
insert into approval_chain_steps (org_id, position, role, label) values ('15600000-0000-0000-0000-00000000000a', 1, 'Engineer', 'Site lead');
set local role authenticated;
select pg_temp._as('15600000-0000-0000-0000-0000000000a2');
select is(public.my_decision_standing(), true, 'AC-WAIT-013 an Engineer whose role holds a material-request step has standing');
reset role;
delete from approval_chain_steps where org_id = '15600000-0000-0000-0000-00000000000a';
update profiles set manager_id = '15600000-0000-0000-0000-0000000000a4' where id = '15600000-0000-0000-0000-0000000000a2';
set local role authenticated;
select pg_temp._as('15600000-0000-0000-0000-0000000000a4');
select is(public.my_decision_standing(), true, 'AC-WAIT-014 a line manager has standing (timesheets)');

-- A light account decides nothing and is refused (the convention of 1209).
reset role;
select set_config('request.jwt.claims', '', true);
update organizations set built_in_roles_enabled = true where id = '15600000-0000-0000-0000-00000000000a';
update profiles set built_in_role = 'foreman' where id = '15600000-0000-0000-0000-0000000000a4';
set local role authenticated;
select pg_temp._as('15600000-0000-0000-0000-0000000000a4');
select throws_ok($$select * from public.my_waiting_decisions()$$, '42501', 'LIGHT_ACCOUNT: this account has one phone home screen and cannot read this', 'AC-WAIT-019 a light account is refused the waiting list');

-- The check-in supervisor role: the person who holds the role the organisation names has standing; another role, or none, does not.
reset role;
select set_config('request.jwt.claims', '', true);
update organizations set phone_check_in_supervisor_role = 'site_supervisor' where id = '15600000-0000-0000-0000-00000000000a';
update profiles set manager_id = null where id = '15600000-0000-0000-0000-0000000000a2';
update profiles set built_in_role = 'storekeeper' where id = '15600000-0000-0000-0000-0000000000a2';
set local role authenticated;
select pg_temp._as('15600000-0000-0000-0000-0000000000a2');
select is(public.my_decision_standing(), false, 'AC-WAIT-020 a person holding another job role than the named check-in supervisor role has no standing');
reset role;
select set_config('request.jwt.claims', '', true);
update profiles set built_in_role = 'site_supervisor' where id = '15600000-0000-0000-0000-0000000000a2';
set local role authenticated;
select pg_temp._as('15600000-0000-0000-0000-0000000000a2');
select is(public.my_decision_standing(), true, 'AC-WAIT-021 the person holding the named check-in supervisor role has standing');
reset role;
select set_config('request.jwt.claims', '', true);
update organizations set phone_check_in_supervisor_role = null where id = '15600000-0000-0000-0000-00000000000a';
set local role authenticated;
select pg_temp._as('15600000-0000-0000-0000-0000000000a2');
select is(public.my_decision_standing(), false, 'AC-WAIT-022 with no check-in supervisor role named, holding that job role gives no standing');

reset role;
-- Access: no anonymous reach, and the enumeration of kinds is closed.
reset role;
select is(has_function_privilege('anon', 'public.my_waiting_decisions()', 'execute'), false, 'AC-WAIT-015 anon cannot run the list');
select is(has_function_privilege('authenticated', 'public.my_decision_standing()', 'execute'), true, 'AC-WAIT-016 a signed-in person can ask their standing');
select is((select array_agg(k order by k) from unnest(array['certificate','daily_report','delivery_record','equipment_plan','quantity_change','transfer_receipt','work_order_issue']) k
            where position('''' || k || '''::text' in (select prosrc from pg_proc where proname = 'my_waiting_decisions')) > 0),
  array['certificate','daily_report','delivery_record','equipment_plan','quantity_change','transfer_receipt','work_order_issue'],
  'AC-WAIT-017 the function answers for exactly the enumerated kinds; a new kind must be added here and to the inbox registry');
select is((select count(*)::int from regexp_matches((select prosrc from pg_proc where proname = 'my_waiting_decisions'), '''[a-z_]+''::text', 'g')), 7,
  'AC-WAIT-018 and no kind is answered that the enumeration does not name');
select * from finish();
rollback;
