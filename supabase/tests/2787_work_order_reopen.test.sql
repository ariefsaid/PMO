-- 2787_work_order_reopen.test.sql — Admin-only audited reopen of a Closed work order (#3024).
-- Ids 27870000-… (synthetic).
-- MUTATION: remove the `auth_role() is distinct from 'Admin'` gate (`mut:reopen_admin_only`) in
-- reopen_work_order and the non-Admin refusal assertions (PM, Finance, Executive, Engineer) go red.
begin;
create extension if not exists pgtap;
select plan(21);

insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled) values
  ('27870000-0000-0000-0000-0000000000a1', 'WR Org A', 'IDR', 'UTC', true),
  ('27870000-0000-0000-0000-0000000000a2', 'WR Org B', 'IDR', 'UTC', true);

insert into auth.users (id, email) values
  ('27870000-0000-0000-0000-0000000000b1', 'wr-admin@example.com'),
  ('27870000-0000-0000-0000-0000000000b2', 'wr-pm@example.com'),
  ('27870000-0000-0000-0000-0000000000b3', 'wr-fin@example.com'),
  ('27870000-0000-0000-0000-0000000000b4', 'wr-exec@example.com'),
  ('27870000-0000-0000-0000-0000000000b5', 'wr-eng@example.com'),
  ('27870000-0000-0000-0000-0000000000b6', 'wr-inactive@example.com'),
  ('27870000-0000-0000-0000-0000000000b0', 'wr-foreign-admin@example.com');

insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('27870000-0000-0000-0000-0000000000b1', '27870000-0000-0000-0000-0000000000a1', 'WR Admin',         'wr-admin@example.com',         'Admin',           'active',   'administrator'),
  ('27870000-0000-0000-0000-0000000000b2', '27870000-0000-0000-0000-0000000000a1', 'WR PM',            'wr-pm@example.com',            'Project Manager', 'active',   'project_manager'),
  ('27870000-0000-0000-0000-0000000000b3', '27870000-0000-0000-0000-0000000000a1', 'WR Finance',       'wr-fin@example.com',           'Finance',         'active',   'finance_officer'),
  ('27870000-0000-0000-0000-0000000000b4', '27870000-0000-0000-0000-0000000000a1', 'WR Executive',     'wr-exec@example.com',          'Executive',       'active',   'executive'),
  ('27870000-0000-0000-0000-0000000000b5', '27870000-0000-0000-0000-0000000000a1', 'WR Engineer',      'wr-eng@example.com',           'Engineer',        'active',   'engineer'),
  ('27870000-0000-0000-0000-0000000000b6', '27870000-0000-0000-0000-0000000000a1', 'WR Inactive',      'wr-inactive@example.com',      'Admin',           'disabled', 'administrator'),
  ('27870000-0000-0000-0000-0000000000b0', '27870000-0000-0000-0000-0000000000a2', 'WR Foreign Admin', 'wr-foreign-admin@example.com', 'Admin',           'active',   'administrator');

insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount) values
  ('27870000-0000-0000-0000-0000000000c1', '27870000-0000-0000-0000-0000000000a1', 'WR Project', 'Ongoing Project', 'IDR', 500000000, 'exclusive', 0);

-- Four work orders:
-- 31: Closed without final acceptance (reopenable)
-- 32: Cancelled (locked)
-- 33: Draft (not Closed)
-- 34: Closed via confirmed final BAST (locked per ADR-0091)
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount, wo_number, issued_by, issued_at, closed_at, closed_by) values
  ('27870000-0000-0000-0000-000000000031', '27870000-0000-0000-0000-0000000000a1', '27870000-0000-0000-0000-0000000000c1', 'WR Closed Manual', 'Closed', 1000000, 'exclusive', 0, 'WO-2787-001', '27870000-0000-0000-0000-0000000000b1', now() - interval '2 days', now() - interval '1 day', '27870000-0000-0000-0000-0000000000b1'),
  ('27870000-0000-0000-0000-000000000032', '27870000-0000-0000-0000-0000000000a1', '27870000-0000-0000-0000-0000000000c1', 'WR Cancelled',     'Cancelled', 1000000, 'exclusive', 0, 'WO-2787-002', '27870000-0000-0000-0000-0000000000b1', now() - interval '2 days', null, null),
  ('27870000-0000-0000-0000-000000000033', '27870000-0000-0000-0000-0000000000a1', '27870000-0000-0000-0000-0000000000c1', 'WR Draft',         'Draft', 1000000, 'exclusive', 0, null, null, null, null, null),
  ('27870000-0000-0000-0000-000000000034', '27870000-0000-0000-0000-0000000000a1', '27870000-0000-0000-0000-0000000000c1', 'WR BAST Closed',   'Issued', 1000000, 'exclusive', 0, 'WO-2787-004', '27870000-0000-0000-0000-0000000000b1', now() - interval '2 days', null, null);

-- Close 34 via a confirmed final acceptance (real confirm_work_order_acceptance path).
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate, earning_basis, line_no) values
  ('27870000-0000-0000-0000-0000000000d1', '27870000-0000-0000-0000-0000000000a1', '27870000-0000-0000-0000-0000000000c1', 'WR-1', 'Scope line', 'lot', 1, 1000000, 'lump_sum', 1);
insert into work_order_lines (id, org_id, work_order_id, boq_item_id, quantity) values
  ('27870000-0000-0000-0000-0000000000e1', '27870000-0000-0000-0000-0000000000a1', '27870000-0000-0000-0000-000000000034', '27870000-0000-0000-0000-0000000000d1', 1);
insert into project_documents (id, org_id, project_id, title, status, file_path) values
  ('27870000-0000-0000-0000-0000000000f1', '27870000-0000-0000-0000-0000000000a1', '27870000-0000-0000-0000-0000000000c1', 'Final BAST', 'Approved', '27870000-0000-0000-0000-0000000000a1/27870000-0000-0000-0000-0000000000c1/27870000-0000-0000-0000-0000000000f1/wr-bast.pdf');
insert into work_order_acceptances (id, org_id, project_id, work_order_id, acceptance_date, is_final, status, prepared_by, document_id) values
  ('27870000-0000-0000-0000-0000000000f2', '27870000-0000-0000-0000-0000000000a1', '27870000-0000-0000-0000-0000000000c1', '27870000-0000-0000-0000-000000000034', current_date, true, 'Draft', '27870000-0000-0000-0000-0000000000b2', '27870000-0000-0000-0000-0000000000f1');
insert into work_order_acceptance_lines (acceptance_id, boq_item_id, quantity) values
  ('27870000-0000-0000-0000-0000000000f2', '27870000-0000-0000-0000-0000000000d1', 1);

create function pg_temp.as_user(p_user text) returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', '{"sub":"27870000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
end $$;

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare m text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics m = message_text;
  return sqlstate || ' ' || split_part(m, ':', 1);
end $$;

-- Confirm the final BAST on 34 as Admin (prepared by PM).
select pg_temp.as_user('b1');
select lives_ok($$select confirm_work_order_acceptance('27870000-0000-0000-0000-0000000000f2')$$, 'AC-WOR-001 fixture: final BAST confirms and closes WO 34');

-- 1. Non-Admin roles are refused (Admin-only gate).
select pg_temp.as_user('b2');
select is(pg_temp.err($$select reopen_work_order('27870000-0000-0000-0000-000000000031', 'Closed by mistake')$$),
  '42501 only an administrator can reopen a closed work order', 'AC-WOR-001 Project Manager cannot reopen a closed work order');

select pg_temp.as_user('b3');
select is(pg_temp.err($$select reopen_work_order('27870000-0000-0000-0000-000000000031', 'Closed by mistake')$$),
  '42501 only an administrator can reopen a closed work order', 'AC-WOR-001 Finance cannot reopen a closed work order');

select pg_temp.as_user('b4');
select is(pg_temp.err($$select reopen_work_order('27870000-0000-0000-0000-000000000031', 'Closed by mistake')$$),
  '42501 only an administrator can reopen a closed work order', 'AC-WOR-001 Executive cannot reopen a closed work order');

select pg_temp.as_user('b5');
select is(pg_temp.err($$select reopen_work_order('27870000-0000-0000-0000-000000000031', 'Closed by mistake')$$),
  '42501 only an administrator can reopen a closed work order', 'AC-WOR-001 Engineer cannot reopen a closed work order');

-- 2. Inactive Admin and cross-org Admin are refused.
select pg_temp.as_user('b6');
select throws_ok($$select reopen_work_order('27870000-0000-0000-0000-000000000031', 'Closed by mistake')$$,
  '42501', null, 'AC-WOR-001 inactive Admin cannot reopen');

select pg_temp.as_user('b0');
select is(pg_temp.err($$select reopen_work_order('27870000-0000-0000-0000-000000000031', 'Closed by mistake')$$),
  '42501 not authorized', 'AC-WOR-001 foreign-org Admin cannot reopen');

-- 3. Missing, blank, too-short, or too-long reason is refused.
select pg_temp.as_user('b1');
select is(pg_temp.err($$select reopen_work_order('27870000-0000-0000-0000-000000000031', null)$$),
  '23514 WOR_REASON', 'AC-WOR-001 null reason is refused');

select is(pg_temp.err($$select reopen_work_order('27870000-0000-0000-0000-000000000031', '   ')$$),
  '23514 WOR_REASON', 'AC-WOR-001 blank reason is refused');

select is(pg_temp.err($$select reopen_work_order('27870000-0000-0000-0000-000000000031', 'ab')$$),
  '23514 WOR_REASON', 'AC-WOR-001 two-character reason is refused');

select is(pg_temp.err($$select reopen_work_order('27870000-0000-0000-0000-000000000031', repeat('a', 501))$$),
  '23514 WOR_REASON', 'AC-WOR-001 reason over 500 characters is refused');

-- 4. Cancelled, Draft, and BAST-closed work orders are refused.
select is(pg_temp.err($$select reopen_work_order('27870000-0000-0000-0000-000000000032', 'Want it back')$$),
  'P0001 a cancelled work order cannot be reopened', 'AC-WOR-001 Cancelled work order stays locked');

select is(pg_temp.err($$select reopen_work_order('27870000-0000-0000-0000-000000000033', 'Still a draft')$$),
  'P0001 only a closed work order can be reopened', 'AC-WOR-001 Draft work order cannot be reopened');

select is(pg_temp.err($$select reopen_work_order('27870000-0000-0000-0000-000000000034', 'Need late change')$$),
  'P0001 this work order was closed by a confirmed final acceptance and cannot be reopened',
  'AC-WOR-001 Closed work order with confirmed final acceptance stays locked (ADR-0091)');

-- 5. Admin reopens a Closed work order without final acceptance: moves to Issued, clears closed_at/closed_by, writes audit entry.
select is(pg_temp.err($$select reopen_work_order('27870000-0000-0000-0000-000000000031', '  Closed prematurely before late material  ')$$),
  'ok', 'AC-WOR-001 Admin reopens a Closed work order with a valid reason');

select is(
  (select status::text || ':' || coalesce(closed_at::text, 'null') || ':' || coalesce(closed_by::text, 'null') || ':' || wo_number
     from work_orders where id = '27870000-0000-0000-0000-000000000031'),
  'Issued:null:null:WO-2787-001',
  'AC-WOR-001 reopened work order returns to Issued, clears closed_at and closed_by, and preserves wo_number'
);

-- Reopening an already-Issued work order is refused.
select is(pg_temp.err($$select reopen_work_order('27870000-0000-0000-0000-000000000031', 'Reopen again')$$),
  'P0001 only a closed work order can be reopened', 'AC-WOR-001 Issued work order cannot be reopened');

-- The reopened work order can be closed again via transition_work_order.
select is(pg_temp.err($$select transition_work_order('27870000-0000-0000-0000-000000000031', 'Closed')$$),
  'ok', 'AC-WOR-001 reopened work order can be closed again');

reset role;

-- Audit trail entry exists with trimmed reason and from/to detail (audit_events is the sole trail; log_audit writes it).
select is(
  (select (detail->>'from') || '->' || (detail->>'to') || ':' || (detail->>'reason')
     from audit_events
    where org_id = '27870000-0000-0000-0000-0000000000a1'
      and action = 'work_order.reopen'
      and entity_id = '27870000-0000-0000-0000-000000000031'
      and actor_id = '27870000-0000-0000-0000-0000000000b1'
    order by created_at desc limit 1),
  'Closed->Issued:Closed prematurely before late material',
  'AC-WOR-001 reopen writes work_order.reopen audit entry with trimmed reason'
);

-- Privilege & search_path hygiene.
select is(has_function_privilege('anon', 'public.reopen_work_order(uuid,text)', 'execute'), false,
  'AC-WOR-001 anon cannot execute reopen_work_order');

select is(
  (select (proconfig[array_upper(proconfig, 1)] ~ '^search_path=.*pg_temp$')::text
     from pg_proc where pronamespace = 'public'::regnamespace and proname = 'reopen_work_order'),
  'true',
  'AC-WOR-001 reopen_work_order sets search_path with pg_temp last'
);

select * from finish();
rollback;
