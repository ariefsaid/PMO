-- 1566_operational_waiting_route.test.sql — the three operational who-next ASSIGNMENTS (fix-waiting item 3, Waiting 3).
-- Migration under test: 1566_operational_waiting_route.sql.
-- Each route must name exactly the people the waiting list ASSIGNS that record to (1560's population for the kind, read
-- through the caller's RLS): work_order_issue (a Draft carrying priced money, price author excluded), delivery_record
-- (an Ordered purchase's receipt — NOT a BAST) and transfer_receipt (Sent, addressed receiver or full destination
-- keeper, never the sender). The route is an assignment, not a full write-eligibility oracle: a person the broader
-- transition admits but does not assign is asserted UNNAMED here, and the deciding write is called separately on
-- isolated rows with a real JWT so that its own refusal/success is proven, not inferred.
-- Foreign, hidden, disabled, light and anon callers must not learn the record exists; a light keeper who cannot read an
-- unaddressed transfer (1480) is not assigned, while a light addressed receiver is.
begin;
create extension if not exists pgtap;
select plan(77);

insert into organizations (id, name, default_currency, default_timezone) values
  ('16660000-0000-0000-0000-00000000000a', 'Operational Wait Org', 'IDR', 'Asia/Jakarta'),
  ('16660000-0000-0000-0000-00000000000b', 'Operational Other Org', 'IDR', 'Asia/Jakarta');
insert into auth.users (id, email) values
  ('16660000-0000-0000-0000-0000000000a1', 'ow-admin@example.com'),
  ('16660000-0000-0000-0000-0000000000a2', 'ow-eng@example.com'),
  ('16660000-0000-0000-0000-0000000000a3', 'ow-pm@example.com'),
  ('16660000-0000-0000-0000-0000000000a4', 'ow-eng2@example.com'),
  ('16660000-0000-0000-0000-0000000000a5', 'ow-fin@example.com'),
  ('16660000-0000-0000-0000-0000000000a6', 'ow-pm2@example.com'),
  ('16660000-0000-0000-0000-0000000000a7', 'ow-exec@example.com'),
  ('16660000-0000-0000-0000-0000000000a8', 'ow-keeper@example.com'),
  ('16660000-0000-0000-0000-0000000000a9', 'ow-disabled@example.com'),
  ('16660000-0000-0000-0000-0000000000b1', 'ow-xorg@example.com'),
  ('16660000-0000-0000-0000-0000000000c1', 'ow-light-requester@example.com'),
  ('16660000-0000-0000-0000-0000000000c2', 'ow-light-keeper@example.com'),
  ('16660000-0000-0000-0000-0000000000c3', 'ow-light-receiver@example.com'),
  -- Same-rank Project Manager chain (manager_id is the only decisive fact; rank_outranks(PM, PM) is false).
  ('16660000-0000-0000-0000-0000000000e1', 'ow-pm-child@example.com'),
  ('16660000-0000-0000-0000-0000000000e2', 'ow-pm-parent@example.com'),
  ('16660000-0000-0000-0000-0000000000e3', 'ow-pm-managed@example.com'),
  ('16660000-0000-0000-0000-0000000000e4', 'ow-pm-manager@example.com');
-- a10/a11/a12 are the light seat holders (built_in_role set below): a10 raised a purchase, a11 keeps a destination and
-- is not addressed, a12 is addressed by a transfer.
insert into profiles (id, org_id, full_name, email, role, status) values
  ('16660000-0000-0000-0000-0000000000a1', '16660000-0000-0000-0000-00000000000a', 'OW Admin',    'ow-admin@example.com',    'Admin',           'active'),
  ('16660000-0000-0000-0000-0000000000a2', '16660000-0000-0000-0000-00000000000a', 'OW Engineer', 'ow-eng@example.com',      'Engineer',        'active'),
  ('16660000-0000-0000-0000-0000000000a3', '16660000-0000-0000-0000-00000000000a', 'OW PM',       'ow-pm@example.com',       'Project Manager', 'active'),
  ('16660000-0000-0000-0000-0000000000a4', '16660000-0000-0000-0000-00000000000a', 'OW Engineer2','ow-eng2@example.com',     'Engineer',        'active'),
  ('16660000-0000-0000-0000-0000000000a5', '16660000-0000-0000-0000-00000000000a', 'OW Finance',  'ow-fin@example.com',      'Finance',         'active'),
  ('16660000-0000-0000-0000-0000000000a6', '16660000-0000-0000-0000-00000000000a', 'OW PM2',      'ow-pm2@example.com',      'Project Manager', 'active'),
  ('16660000-0000-0000-0000-0000000000a7', '16660000-0000-0000-0000-00000000000a', 'OW Exec',     'ow-exec@example.com',     'Executive',       'active'),
  ('16660000-0000-0000-0000-0000000000a8', '16660000-0000-0000-0000-00000000000a', 'OW Keeper',   'ow-keeper@example.com',   'Engineer',        'active'),
  ('16660000-0000-0000-0000-0000000000a9', '16660000-0000-0000-0000-00000000000a', 'OW Disabled', 'ow-disabled@example.com', 'Admin',           'disabled'),
  ('16660000-0000-0000-0000-0000000000b1', '16660000-0000-0000-0000-00000000000b', 'OW X Org',    'ow-xorg@example.com',     'Admin',           'active'),
  ('16660000-0000-0000-0000-0000000000c1', '16660000-0000-0000-0000-00000000000a', 'OW Light Req','ow-light-requester@example.com','Engineer',   'active'),
  ('16660000-0000-0000-0000-0000000000c2', '16660000-0000-0000-0000-00000000000a', 'OW Light Kep','ow-light-keeper@example.com',  'Engineer',   'active'),
  ('16660000-0000-0000-0000-0000000000c3', '16660000-0000-0000-0000-00000000000a', 'OW Light Rec','ow-light-receiver@example.com','Engineer',   'active'),
  ('16660000-0000-0000-0000-0000000000e1', '16660000-0000-0000-0000-00000000000a', 'OW PM Child', 'ow-pm-child@example.com', 'Project Manager', 'active'),
  ('16660000-0000-0000-0000-0000000000e2', '16660000-0000-0000-0000-00000000000a', 'OW PM Parent','ow-pm-parent@example.com','Project Manager', 'active'),
  ('16660000-0000-0000-0000-0000000000e3', '16660000-0000-0000-0000-00000000000a', 'OW PM Managed','ow-pm-managed@example.com','Project Manager','active'),
  ('16660000-0000-0000-0000-0000000000e4', '16660000-0000-0000-0000-00000000000a', 'OW PM Manager','ow-pm-manager@example.com','Project Manager','active');

-- The same-rank line-management chain, set after the rows exist (the FK target must already be there):
--   e1 (project PM) reports to e2 (the value's author)  — the correct direction admits/names e1.
--   e4 (the value's author) reports to e3 (the project PM) — the reversed direction must name neither and admit neither.
update profiles set manager_id = '16660000-0000-0000-0000-0000000000e2'
 where id = '16660000-0000-0000-0000-0000000000e1';
update profiles set manager_id = '16660000-0000-0000-0000-0000000000e3'
 where id = '16660000-0000-0000-0000-0000000000e4';

-- Give the three dedicated people a light seat (their coarse role stays the base level, Engineer, as the 1202 trigger
-- forces). The switch is org-wide but inert for everyone else.
update organizations set built_in_roles_enabled = true where id = '16660000-0000-0000-0000-00000000000a';
update profiles set built_in_role = 'field_user' where id = '16660000-0000-0000-0000-0000000000c1';
update profiles set built_in_role = 'foreman'    where id = '16660000-0000-0000-0000-0000000000c2';
update profiles set built_in_role = 'foreman'    where id = '16660000-0000-0000-0000-0000000000c3';

insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, project_manager_id) values
  ('16660000-0000-0000-0000-0000000000d1', '16660000-0000-0000-0000-00000000000a', 'OW Site', 'Ongoing Project', 'IDR', 5000000, 'exclusive', 0, '16660000-0000-0000-0000-0000000000a3'),
  ('16660000-0000-0000-0000-0000000000d2', '16660000-0000-0000-0000-00000000000a', 'OW Chain Site', 'Ongoing Project', 'IDR', 5000000, 'exclusive', 0, '16660000-0000-0000-0000-0000000000e1'),
  ('16660000-0000-0000-0000-0000000000d3', '16660000-0000-0000-0000-00000000000a', 'OW Reversed Chain Site', 'Ongoing Project', 'IDR', 5000000, 'exclusive', 0, '16660000-0000-0000-0000-0000000000e3');

create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
                    case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end,
                    true);
$$;
-- The route as the CURRENT caller (used for visibility and caller-scoped reads).
create or replace function pg_temp._route(p_kind text, p_record uuid) returns jsonb language sql as $$
  select public.get_operational_waiting_route(p_kind, p_record);
$$;
create or replace function pg_temp._count(p_kind text, p_record uuid) returns int language sql as $$
  select jsonb_array_length(public.get_operational_waiting_route(p_kind, p_record) -> 'approvers');
$$;
create or replace function pg_temp._has(p_kind text, p_record uuid, p_uid uuid) returns boolean language sql as $$
  select exists (
    select 1 from jsonb_array_elements(public.get_operational_waiting_route(p_kind, p_record) -> 'approvers') a
     where (a ->> 'id')::uuid = p_uid);
$$;
-- The ASSIGNMENT population, read by one fixed full caller so it is not confounded by who happens to be asking.
create or replace function pg_temp._population(p_kind text, p_record uuid) returns jsonb language plpgsql as $$
begin
  perform pg_temp._as('16660000-0000-0000-0000-0000000000a1');
  return public.get_operational_waiting_route(p_kind, p_record) -> 'approvers';
end $$;
create or replace function pg_temp._n(p_kind text, p_record uuid) returns int language sql as $$
  select jsonb_array_length(pg_temp._population(p_kind, p_record));
$$;
create or replace function pg_temp._named(p_kind text, p_record uuid, p_person uuid) returns boolean language sql as $$
  select exists (
    select 1 from jsonb_array_elements(pg_temp._population(p_kind, p_record)) a
     where (a ->> 'id')::uuid = p_person);
$$;
create or replace function pg_temp._names(p_kind text, p_record uuid) returns text[] language sql as $$
  select coalesce(array_agg(a ->> 'name' order by ord), '{}'::text[])
    from jsonb_array_elements(pg_temp._population(p_kind, p_record)) with ordinality as t(a, ord);
$$;
create or replace function pg_temp._waiting_as(p_uid uuid, p_kind text, p_record uuid) returns boolean language plpgsql as $$
begin
  perform pg_temp._as(p_uid);
  return exists (select 1 from public.my_waiting_decisions() w
                  where w.kind = p_kind and w.record_id = p_record);
end $$;
-- Comparator: for every REACHABLE (full, active) person, the assignment names them iff 1560's own per-person list offers
-- the record. It is the canonical assignment narrowed by reachable actors, never an unconditional equality: a light
-- person cannot ask 1560 at all (assert_not_light), so their answer is not an observation — the light rules are
-- asserted explicitly below (addressed positive, keeper-only negative + readability).
create or replace function pg_temp._agrees_all(p_kind text, p_record uuid) returns boolean language plpgsql as $$
declare
  v_pop jsonb := pg_temp._population(p_kind, p_record);
  v_ok boolean := true;
  u uuid;
begin
  foreach u in array array[
    '16660000-0000-0000-0000-0000000000a1'::uuid, '16660000-0000-0000-0000-0000000000a2',
    '16660000-0000-0000-0000-0000000000a3', '16660000-0000-0000-0000-0000000000a4',
    '16660000-0000-0000-0000-0000000000a5', '16660000-0000-0000-0000-0000000000a6',
    '16660000-0000-0000-0000-0000000000a7', '16660000-0000-0000-0000-0000000000a8',
    '16660000-0000-0000-0000-0000000000e1', '16660000-0000-0000-0000-0000000000e2',
    '16660000-0000-0000-0000-0000000000e3', '16660000-0000-0000-0000-0000000000e4']
  loop
    if (exists (select 1 from jsonb_array_elements(v_pop) a where (a ->> 'id')::uuid = u))
       <> pg_temp._waiting_as(u, p_kind, p_record) then
      v_ok := false;
    end if;
  end loop;
  return v_ok;
end $$;

-- ── Work orders ───────────────────────────────────────────────────────────────────────────────────────────────────
-- The witness is stamped from the acting user, as in 1560's fixtures; insert as the author so set_by is real.
select pg_temp._as('16660000-0000-0000-0000-0000000000a3');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('16660000-0000-0000-0000-000000000401', '16660000-0000-0000-0000-00000000000a', '16660000-0000-0000-0000-0000000000d1', 'OW PM priced WO', 'Draft', 5000, 'exclusive', 0);
select pg_temp._as('16660000-0000-0000-0000-0000000000a1');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('16660000-0000-0000-0000-000000000402', '16660000-0000-0000-0000-00000000000a', '16660000-0000-0000-0000-0000000000d1', 'OW Admin priced WO', 'Draft', 7000, 'exclusive', 0),
  -- G1: an Admin-authored price a non-project PM is senior enough to issue (may_approve_work_of(Admin, PM)).
  ('16660000-0000-0000-0000-000000000411', '16660000-0000-0000-0000-00000000000a', '16660000-0000-0000-0000-0000000000d1', 'OW gate PM2', 'Draft', 9000, 'exclusive', 0),
  -- G2: the author themselves is the won-value authority; the write admits them, the assignment must not name them.
  ('16660000-0000-0000-0000-000000000412', '16660000-0000-0000-0000-00000000000a', '16660000-0000-0000-0000-0000000000d1', 'OW gate author', 'Draft', 9000, 'exclusive', 0),
  ('16660000-0000-0000-0000-000000000414', '16660000-0000-0000-0000-00000000000a', '16660000-0000-0000-0000-0000000000d1', 'OW missing witness A', 'Draft', 0, 'exclusive', 0),
  ('16660000-0000-0000-0000-000000000415', '16660000-0000-0000-0000-00000000000a', '16660000-0000-0000-0000-0000000000d1', 'OW missing witness B', 'Draft', 0, 'exclusive', 0);
select pg_temp._as('16660000-0000-0000-0000-0000000000a2');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('16660000-0000-0000-0000-000000000413', '16660000-0000-0000-0000-00000000000a', '16660000-0000-0000-0000-0000000000d1', 'OW zero value', 'Draft', 0, 'exclusive', 0);
-- Same-rank manager chain, witnessed by the OTHER PM (rank_outranks(PM, PM) is false, so only manager_id decides).
-- 421: the project PM (e1) reports to the author (e2) — the correct direction names and admits e1.
select pg_temp._as('16660000-0000-0000-0000-0000000000e2');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('16660000-0000-0000-0000-000000000421', '16660000-0000-0000-0000-00000000000a', '16660000-0000-0000-0000-0000000000d2', 'OW chain witnessed', 'Draft', 5000, 'exclusive', 0);
-- 422: the author (e4) reports to the project PM (e3) — the reversed direction must name/admit neither.
select pg_temp._as('16660000-0000-0000-0000-0000000000e4');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('16660000-0000-0000-0000-000000000422', '16660000-0000-0000-0000-00000000000a', '16660000-0000-0000-0000-0000000000d3', 'OW chain reversed', 'Draft', 6000, 'exclusive', 0);
-- A priced row with NO recorded author is reachable through a machine writer (auth.uid() null): simulate it exactly.
select set_config('request.jwt.claims', '', true);
update work_orders set order_value = 8000 where id in ('16660000-0000-0000-0000-000000000414', '16660000-0000-0000-0000-000000000415');

-- ── Procurements ──────────────────────────────────────────────────────────────────────────────────────────────────
insert into procurements (id, org_id, title, project_id, status, requested_by_id, approved_by_id) values
  ('16660000-0000-0000-0000-000000000601', '16660000-0000-0000-0000-00000000000a', 'OW delivery', '16660000-0000-0000-0000-0000000000d1', 'Ordered', '16660000-0000-0000-0000-0000000000a2', '16660000-0000-0000-0000-0000000000a7'),
  ('16660000-0000-0000-0000-000000000602', '16660000-0000-0000-0000-00000000000a', 'OW request only', '16660000-0000-0000-0000-0000000000d1', 'Requested', '16660000-0000-0000-0000-0000000000a2', null),
  ('16660000-0000-0000-0000-000000000603', '16660000-0000-0000-0000-00000000000a', 'OW light receipt', '16660000-0000-0000-0000-0000000000d1', 'Ordered', '16660000-0000-0000-0000-0000000000c1', '16660000-0000-0000-0000-0000000000a7'),
  ('16660000-0000-0000-0000-000000000604', '16660000-0000-0000-0000-00000000000a', 'OW requester receives', '16660000-0000-0000-0000-0000000000d1', 'Ordered', '16660000-0000-0000-0000-0000000000a2', '16660000-0000-0000-0000-0000000000a7'),
  ('16660000-0000-0000-0000-000000000613', '16660000-0000-0000-0000-00000000000a', 'OW PM2 receives', '16660000-0000-0000-0000-0000000000d1', 'Ordered', '16660000-0000-0000-0000-0000000000a2', '16660000-0000-0000-0000-0000000000a7'),
  ('16660000-0000-0000-0000-000000000614', '16660000-0000-0000-0000-00000000000a', 'OW finance refused', '16660000-0000-0000-0000-0000000000d1', 'Ordered', '16660000-0000-0000-0000-0000000000a2', '16660000-0000-0000-0000-0000000000a7'),
  ('16660000-0000-0000-0000-000000000615', '16660000-0000-0000-0000-00000000000a', 'OW disabled refused', '16660000-0000-0000-0000-0000000000d1', 'Ordered', '16660000-0000-0000-0000-0000000000a2', '16660000-0000-0000-0000-0000000000a7'),
  ('16660000-0000-0000-0000-000000000608', '16660000-0000-0000-0000-00000000000b', 'OW other org purchase', null, 'Ordered', null, null);

-- ── Stock ─────────────────────────────────────────────────────────────────────────────────────────────────────────
insert into stock_warehouses (id, org_id, code, name, kind) values
  ('16660000-0000-0000-0000-000000000701', '16660000-0000-0000-0000-00000000000a', 'OWC', 'OW central', 'central'),
  ('16660000-0000-0000-0000-000000000702', '16660000-0000-0000-0000-00000000000a', 'OWS', 'OW site', 'site'),
  ('16660000-0000-0000-0000-000000000703', '16660000-0000-0000-0000-00000000000a', 'OWT', 'OW transit', 'site'),
  ('16660000-0000-0000-0000-000000000704', '16660000-0000-0000-0000-00000000000a', 'OWK', 'OW keeperless site', 'site'),
  ('16660000-0000-0000-0000-000000000705', '16660000-0000-0000-0000-00000000000a', 'OWL', 'OW light-kept site', 'site'),
  ('16660000-0000-0000-0000-000000000711', '16660000-0000-0000-0000-00000000000b', 'OWX', 'OW other org site', 'site'),
  ('16660000-0000-0000-0000-000000000712', '16660000-0000-0000-0000-00000000000b', 'OWY', 'OW other org destination', 'site'),
  ('16660000-0000-0000-0000-000000000713', '16660000-0000-0000-0000-00000000000b', 'OWZ', 'OW other org transit', 'site');
insert into stock_warehouse_keepers (org_id, warehouse_id, user_id) values
  ('16660000-0000-0000-0000-00000000000a', '16660000-0000-0000-0000-000000000702', '16660000-0000-0000-0000-0000000000a8'),
  ('16660000-0000-0000-0000-00000000000a', '16660000-0000-0000-0000-000000000705', '16660000-0000-0000-0000-0000000000c2');
insert into stock_transfers (id, org_id, number, from_warehouse_id, to_warehouse_id, transit_warehouse_id, to_user_id, status, sent_by, received_at, received_by) values
  -- T1: sent by the PM, addressed to Engineer2; Engineer2 is the named receiver, the Keeper keeps the destination.
  ('16660000-0000-0000-0000-000000000801', '16660000-0000-0000-0000-00000000000a', 'OW-T1', '16660000-0000-0000-0000-000000000701', '16660000-0000-0000-0000-000000000702', '16660000-0000-0000-0000-000000000703', '16660000-0000-0000-0000-0000000000a4', 'Sent', '16660000-0000-0000-0000-0000000000a3', null, null),
  -- T2: sent by Engineer2, unaddressed: only the destination keeper is assigned.
  ('16660000-0000-0000-0000-000000000802', '16660000-0000-0000-0000-00000000000a', 'OW-T2', '16660000-0000-0000-0000-000000000701', '16660000-0000-0000-0000-000000000702', '16660000-0000-0000-0000-000000000703', null, 'Sent', '16660000-0000-0000-0000-0000000000a4', null, null),
  -- T3: unaddressed into a warehouse with no keeper: nobody is assigned.
  ('16660000-0000-0000-0000-000000000803', '16660000-0000-0000-0000-00000000000a', 'OW-T3', '16660000-0000-0000-0000-000000000701', '16660000-0000-0000-0000-000000000704', '16660000-0000-0000-0000-000000000703', null, 'Sent', '16660000-0000-0000-0000-0000000000a4', null, null),
  ('16660000-0000-0000-0000-000000000804', '16660000-0000-0000-0000-00000000000a', 'OW-T4', '16660000-0000-0000-0000-000000000701', '16660000-0000-0000-0000-000000000702', '16660000-0000-0000-0000-000000000703', '16660000-0000-0000-0000-0000000000a4', 'Received', '16660000-0000-0000-0000-0000000000a3', now(), '16660000-0000-0000-0000-0000000000a4'),
  -- T5: the SENDER is also the destination's only keeper — the sender exclusion must not be vacuous.
  ('16660000-0000-0000-0000-000000000805', '16660000-0000-0000-0000-00000000000a', 'OW-T5', '16660000-0000-0000-0000-000000000701', '16660000-0000-0000-0000-000000000702', '16660000-0000-0000-0000-000000000703', null, 'Sent', '16660000-0000-0000-0000-0000000000a8', null, null),
  -- T6: addressed to a LIGHT account (it may read and receive it); the full keeper is assigned beside it.
  ('16660000-0000-0000-0000-000000000806', '16660000-0000-0000-0000-00000000000a', 'OW-T6', '16660000-0000-0000-0000-000000000701', '16660000-0000-0000-0000-000000000702', '16660000-0000-0000-0000-000000000703', '16660000-0000-0000-0000-0000000000c3', 'Sent', '16660000-0000-0000-0000-0000000000a4', null, null),
  -- T7: unaddressed into a destination kept only by a LIGHT account — it cannot read this file (1480), so not assigned.
  ('16660000-0000-0000-0000-000000000807', '16660000-0000-0000-0000-00000000000a', 'OW-T7', '16660000-0000-0000-0000-000000000701', '16660000-0000-0000-0000-000000000705', '16660000-0000-0000-0000-000000000703', null, 'Sent', '16660000-0000-0000-0000-0000000000a4', null, null),
  -- T9: addressed to a DISABLED person; the full keeper is still assigned, the disabled addressee is not.
  ('16660000-0000-0000-0000-000000000809', '16660000-0000-0000-0000-00000000000a', 'OW-T9', '16660000-0000-0000-0000-000000000701', '16660000-0000-0000-0000-000000000702', '16660000-0000-0000-0000-000000000703', '16660000-0000-0000-0000-0000000000a9', 'Sent', '16660000-0000-0000-0000-0000000000a4', null, null),
  ('16660000-0000-0000-0000-000000000808', '16660000-0000-0000-0000-00000000000b', 'OW-T8', '16660000-0000-0000-0000-000000000711', '16660000-0000-0000-0000-000000000712', '16660000-0000-0000-0000-000000000713', null, 'Sent', '16660000-0000-0000-0000-0000000000b1', null, null);

set local role authenticated;

-- ══ A. work_order_issue ═══════════════════════════════════════════════════════════════════════════════════════════
select is(pg_temp._n('work_order_issue', '16660000-0000-0000-0000-000000000401'), 3,
  'WO-01 a PM-priced Draft is assigned to the Admin, Finance and Executive — not the author PM or another PM');
select ok(pg_temp._named('work_order_issue', '16660000-0000-0000-0000-000000000401', '16660000-0000-0000-0000-0000000000a1')
          and pg_temp._named('work_order_issue', '16660000-0000-0000-0000-000000000401', '16660000-0000-0000-0000-0000000000a5')
          and pg_temp._named('work_order_issue', '16660000-0000-0000-0000-000000000401', '16660000-0000-0000-0000-0000000000a7')
          and not pg_temp._named('work_order_issue', '16660000-0000-0000-0000-000000000401', '16660000-0000-0000-0000-0000000000a3')
          and not pg_temp._named('work_order_issue', '16660000-0000-0000-0000-000000000401', '16660000-0000-0000-0000-0000000000a6')
          and not pg_temp._named('work_order_issue', '16660000-0000-0000-0000-000000000401', '16660000-0000-0000-0000-0000000000a2'),
  'WO-02 the price author, the non-project PM and the Engineer are not assigned to WO401');
select is(pg_temp._n('work_order_issue', '16660000-0000-0000-0000-000000000402'), 3,
  'WO-03 an Admin-priced Draft is assigned to this project''s own PM, Finance and Executive, never the author Admin');
select ok(pg_temp._named('work_order_issue', '16660000-0000-0000-0000-000000000402', '16660000-0000-0000-0000-0000000000a3')
          and pg_temp._named('work_order_issue', '16660000-0000-0000-0000-000000000402', '16660000-0000-0000-0000-0000000000a5')
          and pg_temp._named('work_order_issue', '16660000-0000-0000-0000-000000000402', '16660000-0000-0000-0000-0000000000a7')
          and not pg_temp._named('work_order_issue', '16660000-0000-0000-0000-000000000402', '16660000-0000-0000-0000-0000000000a1')
          and not pg_temp._named('work_order_issue', '16660000-0000-0000-0000-000000000402', '16660000-0000-0000-0000-0000000000a6'),
  'WO-04 the assignment is the project''s own PM and the authority roles; the author is never assigned');
reset role;
update work_orders set order_value_set_by = '16660000-0000-0000-0000-0000000000a9',
                        order_value_set_at = now()
 where id = '16660000-0000-0000-0000-000000000402';
set local role authenticated;
select ok(pg_temp._n('work_order_issue', '16660000-0000-0000-0000-000000000402') = 3
          and pg_temp._named('work_order_issue', '16660000-0000-0000-0000-000000000402', '16660000-0000-0000-0000-0000000000a1')
          and pg_temp._named('work_order_issue', '16660000-0000-0000-0000-000000000402', '16660000-0000-0000-0000-0000000000a5')
          and pg_temp._named('work_order_issue', '16660000-0000-0000-0000-000000000402', '16660000-0000-0000-0000-0000000000a7')
          and not pg_temp._named('work_order_issue', '16660000-0000-0000-0000-000000000402', '16660000-0000-0000-0000-0000000000a9')
          and not pg_temp._named('work_order_issue', '16660000-0000-0000-0000-000000000402', '16660000-0000-0000-0000-0000000000a3'),
  'WO-05 a disabled price author is not assigned, and the non-authority PM branch drops with them');
select is(pg_temp._names('work_order_issue', '16660000-0000-0000-0000-000000000401'),
          array['OW Admin', 'OW Exec', 'OW Finance'],
  'WO-06 the assignment is ordered by full name, then id (the sentence reads in that order)');
select is(pg_temp._n('work_order_issue', '16660000-0000-0000-0000-000000000411'), 3,
  'WO-07 an Admin-priced Draft is not assigned to a non-project PM, even though that PM is senior enough to issue it');
select ok(pg_temp._named('work_order_issue', '16660000-0000-0000-0000-000000000411', '16660000-0000-0000-0000-0000000000a3')
          and not pg_temp._named('work_order_issue', '16660000-0000-0000-0000-000000000411', '16660000-0000-0000-0000-0000000000a6'),
  'WO-08 the project PM is assigned to WO411 and the non-project PM is not (the assignment narrows the write gate)');
select ok(pg_temp._n('work_order_issue', '16660000-0000-0000-0000-000000000412') = 3
          and not pg_temp._named('work_order_issue', '16660000-0000-0000-0000-000000000412', '16660000-0000-0000-0000-0000000000a1'),
  'WO-09 a won-value-authority author is never assigned to the record whose value they set');
select is(pg_temp._n('work_order_issue', '16660000-0000-0000-0000-000000000413'), 0,
  'WO-10 an unpriced Draft (value 0) is assigned to nobody, although any issue role may issue it');
select is(pg_temp._n('work_order_issue', '16660000-0000-0000-0000-000000000414'), 0,
  'WO-11 a priced Draft with no recorded author is assigned to nobody');
select is(pg_temp._n('work_order_issue', '16660000-0000-0000-0000-000000000415'), 0,
  'WO-12 the same unpriced-witness shape is also assigned to nobody (isolated for the refused write below)');
select is(pg_temp._n('work_order_issue', '16660000-0000-0000-0000-000000000421'), 4,
  'WO-13 a same-rank project PM whose own manager set the value IS assigned (manager_id, not rank)');
select ok(pg_temp._named('work_order_issue', '16660000-0000-0000-0000-000000000421', '16660000-0000-0000-0000-0000000000e1')
          and not pg_temp._named('work_order_issue', '16660000-0000-0000-0000-000000000421', '16660000-0000-0000-0000-0000000000e2'),
  'WO-14 the witnessed project PM (e1) is named and the value author (e2) is not');
select is(pg_temp._n('work_order_issue', '16660000-0000-0000-0000-000000000422'), 3,
  'WO-15 the reversed chain names the authority roles only: the project PM the author reports to is NOT assigned');
select ok(not pg_temp._named('work_order_issue', '16660000-0000-0000-0000-000000000422', '16660000-0000-0000-0000-0000000000e3')
          and not pg_temp._named('work_order_issue', '16660000-0000-0000-0000-000000000422', '16660000-0000-0000-0000-0000000000e4'),
  'WO-16 the project PM (e3) who merely manages the value author (e4) is absent, and so is the author');

-- ══ B. delivery_record ═══════════════════════════════════════════════════════════════════════════════════════════
select is(pg_temp._n('delivery_record', '16660000-0000-0000-0000-000000000601'), 3,
  'DEL-01 an Ordered purchase is assigned to the Admin, the actual requester and this project''s own PM');
select ok(pg_temp._named('delivery_record', '16660000-0000-0000-0000-000000000601', '16660000-0000-0000-0000-0000000000a1')
          and pg_temp._named('delivery_record', '16660000-0000-0000-0000-000000000601', '16660000-0000-0000-0000-0000000000a2')
          and pg_temp._named('delivery_record', '16660000-0000-0000-0000-000000000601', '16660000-0000-0000-0000-0000000000a3')
          and not pg_temp._named('delivery_record', '16660000-0000-0000-0000-000000000601', '16660000-0000-0000-0000-0000000000a5')
          and not pg_temp._named('delivery_record', '16660000-0000-0000-0000-000000000601', '16660000-0000-0000-0000-0000000000a7')
          and not pg_temp._named('delivery_record', '16660000-0000-0000-0000-000000000601', '16660000-0000-0000-0000-0000000000a6')
          and not pg_temp._named('delivery_record', '16660000-0000-0000-0000-000000000601', '16660000-0000-0000-0000-0000000000a9'),
  'DEL-02 a non-requester Finance/Executive, a non-project PM and a disabled Admin are not assigned to the receipt');
select is(pg_temp._n('delivery_record', '16660000-0000-0000-0000-000000000602'), 0,
  'DEL-03 a Requested purchase is not waiting at the receipt stage');
select ok(pg_temp._n('delivery_record', '16660000-0000-0000-0000-000000000603') = 2
          and not pg_temp._named('delivery_record', '16660000-0000-0000-0000-000000000603', '16660000-0000-0000-0000-0000000000c1')
          and pg_temp._named('delivery_record', '16660000-0000-0000-0000-000000000603', '16660000-0000-0000-0000-0000000000a1')
          and pg_temp._named('delivery_record', '16660000-0000-0000-0000-000000000603', '16660000-0000-0000-0000-0000000000a3'),
  'DEL-04 a light requester is not assigned to the receipt (the gate refuses every light account)');
select ok(pg_temp._n('delivery_record', '16660000-0000-0000-0000-000000000613') = 3
          and not pg_temp._named('delivery_record', '16660000-0000-0000-0000-000000000613', '16660000-0000-0000-0000-0000000000a6'),
  'DEL-05 a non-project PM is not assigned to an Ordered purchase although the gate admits one to receive it');

-- ══ C. transfer_receipt ══════════════════════════════════════════════════════════════════════════════════════════
select ok(pg_temp._named('transfer_receipt', '16660000-0000-0000-0000-000000000801', '16660000-0000-0000-0000-0000000000a4')
          and pg_temp._named('transfer_receipt', '16660000-0000-0000-0000-000000000801', '16660000-0000-0000-0000-0000000000a8')
          and not pg_temp._named('transfer_receipt', '16660000-0000-0000-0000-000000000801', '16660000-0000-0000-0000-0000000000a3')
          and not pg_temp._named('transfer_receipt', '16660000-0000-0000-0000-000000000801', '16660000-0000-0000-0000-0000000000a1'),
  'TRF-01 an addressed transfer is assigned to its receiver and the destination keeper, never its sender or an Admin');
select is(pg_temp._n('transfer_receipt', '16660000-0000-0000-0000-000000000801'), 2,
  'TRF-02 the addressed transfer is assigned to exactly those two people');
select ok(pg_temp._named('transfer_receipt', '16660000-0000-0000-0000-000000000802', '16660000-0000-0000-0000-0000000000a8')
          and not pg_temp._named('transfer_receipt', '16660000-0000-0000-0000-000000000802', '16660000-0000-0000-0000-0000000000a4'),
  'TRF-03 an unaddressed transfer is assigned to its destination keeper only; its sender is excluded');
select is(pg_temp._n('transfer_receipt', '16660000-0000-0000-0000-000000000803'), 0,
  'TRF-04 no addressed receiver and no keeper means nobody is assigned');
select is(pg_temp._n('transfer_receipt', '16660000-0000-0000-0000-000000000804'), 0,
  'TRF-05 an already-received transfer is not waiting');
select is(pg_temp._n('transfer_receipt', '16660000-0000-0000-0000-000000000805'), 0,
  'TRF-06 a sender who is the destination''s only keeper is still excluded (the sender rule is not vacuous)');
select ok(pg_temp._n('transfer_receipt', '16660000-0000-0000-0000-000000000806') = 2
          and pg_temp._named('transfer_receipt', '16660000-0000-0000-0000-000000000806', '16660000-0000-0000-0000-0000000000c3')
          and pg_temp._named('transfer_receipt', '16660000-0000-0000-0000-000000000806', '16660000-0000-0000-0000-0000000000a8'),
  'TRF-07 a LIGHT addressed receiver is assigned (light recipients are not blanket-filtered), beside the full keeper');
select is(pg_temp._n('transfer_receipt', '16660000-0000-0000-0000-000000000807'), 0,
  'TRF-08 a light keeper-only destination is not assigned: that account cannot open an unaddressed transfer');
select ok(pg_temp._named('transfer_receipt', '16660000-0000-0000-0000-000000000809', '16660000-0000-0000-0000-0000000000a8')
          and not pg_temp._named('transfer_receipt', '16660000-0000-0000-0000-000000000809', '16660000-0000-0000-0000-0000000000a9'),
  'TRF-09 a disabled addressed receiver is not assigned; the full keeper still is');
select pg_temp._as('16660000-0000-0000-0000-0000000000c2');
select is((select count(*)::int from public.stock_transfers where id = '16660000-0000-0000-0000-000000000807'), 0,
  'TRF-10 the light keeper cannot read the unaddressed transfer at all (1480 restrictive SELECT)');
select pg_temp._as('16660000-0000-0000-0000-0000000000c3');
select is((select count(*)::int from public.stock_transfers where id = '16660000-0000-0000-0000-000000000806'), 1,
  'TRF-11 the addressed light receiver can read its own transfer');
select pg_temp._as('16660000-0000-0000-0000-0000000000a4');
select ok(pg_temp._has('transfer_receipt', '16660000-0000-0000-0000-000000000806', '16660000-0000-0000-0000-0000000000a8')
          and pg_temp._has('transfer_receipt', '16660000-0000-0000-0000-000000000806', '16660000-0000-0000-0000-0000000000c3'),
  'TRF-12 the full sender sees the reachable assigned actors (the full keeper and the addressed light receiver)');

-- ══ D. Visibility: hidden, foreign, disabled, light ══════════════════════════════════════════════════════════════
select pg_temp._as('16660000-0000-0000-0000-0000000000b1');
select is(pg_temp._count('work_order_issue', '16660000-0000-0000-0000-000000000401'), 0,
  'VIS-01 another organisation''s record is unreadable, so its assignment is empty (no existence leak)');
select is(pg_temp._count('delivery_record', '16660000-0000-0000-0000-000000000601'), 0,
  'VIS-02 another organisation''s purchase is unreadable, so its assignment is empty');
select is(pg_temp._count('transfer_receipt', '16660000-0000-0000-0000-000000000801'), 0,
  'VIS-03 another organisation''s transfer is unreadable, so its assignment is empty');
select pg_temp._as('16660000-0000-0000-0000-0000000000a9');
select is(pg_temp._count('work_order_issue', '16660000-0000-0000-0000-000000000401'), 0,
  'VIS-04 a disabled caller reads no record and gets the same empty assignment');
select pg_temp._as('16660000-0000-0000-0000-0000000000a1');
select is(pg_temp._count('transfer_receipt', '16660000-0000-0000-0000-000000000808'), 0,
  'VIS-05 a transfer in another organisation is unreadable (hidden), so its assignment is empty');
select is(pg_temp._count('delivery_record', '16660000-0000-0000-0000-000000000608'), 0,
  'VIS-06 a purchase in another organisation is unreadable (hidden), so its assignment is empty');
select pg_temp._as('16660000-0000-0000-0000-0000000000c2');
select is(pg_temp._count('work_order_issue', '16660000-0000-0000-0000-000000000401'), 0,
  'VIS-07 a light caller gets no work-order assignment');
select is(pg_temp._count('delivery_record', '16660000-0000-0000-0000-000000000601'), 0,
  'VIS-08 a light caller gets no receipt assignment');
select is(pg_temp._count('transfer_receipt', '16660000-0000-0000-0000-000000000802'), 0,
  'VIS-09 a light caller gets no transfer assignment (the existing caller closure is unchanged)');

-- ══ E. Comparator: the assignment equals 1560's own list for every full, active person ═══════════════════════════
select ok(pg_temp._agrees_all('work_order_issue', '16660000-0000-0000-0000-000000000401'),
  'CMP-01 the WO401 assignment equals 1560''s per-person list for every full, active person');
select ok(pg_temp._agrees_all('work_order_issue', '16660000-0000-0000-0000-000000000402'),
  'CMP-02 the WO402 assignment equals 1560 after the disabled author replaces the non-authority branch');
select ok(pg_temp._agrees_all('work_order_issue', '16660000-0000-0000-0000-000000000411'),
  'CMP-03 the WO411 assignment equals 1560 (the non-project PM is absent on both sides)');
select ok(pg_temp._agrees_all('delivery_record', '16660000-0000-0000-0000-000000000601'),
  'CMP-04 the Ordered purchase assignment equals 1560 for every full, active person');
select ok(pg_temp._agrees_all('delivery_record', '16660000-0000-0000-0000-000000000603'),
  'CMP-05 the light-requester purchase equals 1560 for every full person (the light person is checked separately)');
select ok(pg_temp._agrees_all('transfer_receipt', '16660000-0000-0000-0000-000000000801'),
  'CMP-06 the addressed transfer assignment equals 1560 for every full, active person');
select ok(pg_temp._agrees_all('transfer_receipt', '16660000-0000-0000-0000-000000000802'),
  'CMP-07 the unaddressed transfer assignment equals 1560 for every full, active person');
select ok(pg_temp._agrees_all('transfer_receipt', '16660000-0000-0000-0000-000000000805'),
  'CMP-08 the sender-keeper transfer assignment equals 1560 (empty on both sides)');
select ok(pg_temp._agrees_all('work_order_issue', '16660000-0000-0000-0000-000000000421'),
  'CMP-09 the witnessed same-rank chain equals 1560 for every reachable person (e1 listed by both)');
select ok(pg_temp._agrees_all('work_order_issue', '16660000-0000-0000-0000-000000000422'),
  'CMP-10 the reversed chain equals 1560 for every reachable person (e3 absent on both sides)');

-- ══ F. The deciding writes, on isolated rows with a real JWT ═════════════════════════════════════════════════════
-- Each call below is the real transition the screen's waiting state belongs to. These rows are not read above.
select pg_temp._as('16660000-0000-0000-0000-0000000000a6');
select lives_ok(
  $$ select public.transition_work_order('16660000-0000-0000-0000-000000000411', 'Issued') $$,
  'GATE-WO-01 a non-project PM may issue WO411, although the assignment never named them (issue gate is broader)');
select is((select status::text from public.work_orders where id = '16660000-0000-0000-0000-000000000411'), 'Issued',
  'GATE-WO-02 WO411 is Issued after that real write');
select pg_temp._as('16660000-0000-0000-0000-0000000000a1');
select lives_ok(
  $$ select public.transition_work_order('16660000-0000-0000-0000-000000000412', 'Issued') $$,
  'GATE-WO-03 the won-value-authority author may issue WO412, although the assignment excluded them');
select pg_temp._as('16660000-0000-0000-0000-0000000000a5');
select lives_ok(
  $$ select public.transition_work_order('16660000-0000-0000-0000-000000000413', 'Issued') $$,
  'GATE-WO-04 Finance may issue the unpriced Draft WO413, which the assignment names nobody for');
select pg_temp._as('16660000-0000-0000-0000-0000000000a1');
select lives_ok(
  $$ select public.transition_work_order('16660000-0000-0000-0000-000000000414', 'Issued') $$,
  'GATE-WO-05 an authority issuer may issue the authorless-witness WO414, which the assignment names nobody for');
select pg_temp._as('16660000-0000-0000-0000-0000000000a3');
select throws_ok(
  $$ select public.transition_work_order('16660000-0000-0000-0000-000000000415', 'Issued') $$,
  '42501', null,
  'GATE-WO-06 a Project Manager is refused on the authorless-witness WO415 (the SoD fails closed)');
-- The same-rank chain, both directions, against the real write.
select pg_temp._as('16660000-0000-0000-0000-0000000000e1');
select lives_ok(
  $$ select public.transition_work_order('16660000-0000-0000-0000-000000000421', 'Issued') $$,
  'GATE-WO-07 the project PM whose own manager set the value issues WO421 (the real JWT is admitted)');
select is((select status::text from public.work_orders where id = '16660000-0000-0000-0000-000000000421'), 'Issued',
  'GATE-WO-08 WO421 is Issued after that real write');
select pg_temp._as('16660000-0000-0000-0000-0000000000e3');
select throws_ok(
  $$ select public.transition_work_order('16660000-0000-0000-0000-000000000422', 'Issued') $$,
  '42501',
  'this work order''s value was not set by anyone senior to you, so you cannot issue it: it must be confirmed by your supervisor or by someone who outranks you, through set_work_order_value (which records who set it) — or ask them to issue it',
  'GATE-WO-09 the project PM whom the value author merely reports to is refused WO422 with the exact SoD message');
select pg_temp._as('16660000-0000-0000-0000-0000000000a2');
select lives_ok(
  $$ select public.transition_procurement('16660000-0000-0000-0000-000000000604', 'Received') $$,
  'GATE-DEL-01 the actual requester may record the receipt on Ordered purchase 604');
select is((select status::text from public.procurements where id = '16660000-0000-0000-0000-000000000604'), 'Received',
  'GATE-DEL-02 purchase 604 is Received after that real write');
select pg_temp._as('16660000-0000-0000-0000-0000000000a6');
select lives_ok(
  $$ select public.transition_procurement('16660000-0000-0000-0000-000000000613', 'Received') $$,
  'GATE-DEL-03 a non-project PM may record the receipt on purchase 613, although the assignment never named them');
select pg_temp._as('16660000-0000-0000-0000-0000000000a5');
select throws_ok(
  $$ select public.transition_procurement('16660000-0000-0000-0000-000000000614', 'Received') $$,
  '42501', null,
  'GATE-DEL-04 a non-requester Finance is refused the receipt (the assignment''s absence is the gate''s own answer)');
select pg_temp._as('16660000-0000-0000-0000-0000000000c1');
select throws_ok(
  $$ select public.transition_procurement('16660000-0000-0000-0000-000000000603', 'Received') $$,
  '42501', null,
  'GATE-DEL-05 a light requester''s real receipt write is refused with LIGHT_ACCOUNT (42501)');
select pg_temp._as('16660000-0000-0000-0000-0000000000a9');
select throws_ok(
  $$ select public.transition_procurement('16660000-0000-0000-0000-000000000615', 'Received') $$,
  '42501', null,
  'GATE-DEL-06 a disabled account''s real receipt write is refused (42501)');
select pg_temp._as('16660000-0000-0000-0000-0000000000a1');

-- ══ G. The read's own security contract and access shape ═════════════════════════════════════════════════════════
select is(has_function_privilege('anon', 'public.get_operational_waiting_route(text,uuid)', 'execute'), false,
  'ACC-01 anon cannot execute the route');
select is(has_function_privilege('authenticated', 'public.get_operational_waiting_route(text,uuid)', 'execute'), true,
  'ACC-02 an authenticated caller can execute the route');
select ok((select proacl is not null from pg_proc where oid = 'public.get_operational_waiting_route(text,uuid)'::regprocedure)
          and not exists (select 1
                            from aclexplode((select proacl from pg_proc where oid = 'public.get_operational_waiting_route(text,uuid)'::regprocedure)) a
                           where a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  'ACC-03 PUBLIC holds no execute privilege on the route');
select is((select prosecdef from pg_proc where oid = 'public.get_operational_waiting_route(text,uuid)'::regprocedure), false,
  'ACC-04 the route is SECURITY INVOKER (prosecdef = false), never a definer read');
select is((select provolatile from pg_proc where oid = 'public.get_operational_waiting_route(text,uuid)'::regprocedure), 's',
  'ACC-05 the route is STABLE (it cannot write)');
select ok((select 'search_path=pg_catalog, public' = any(p.proconfig)
             from pg_proc p
            where p.oid = 'public.get_operational_waiting_route(text,uuid)'::regprocedure),
  'ACC-06 the function pins search_path = pg_catalog, public');
select ok(strpos((select prosrc from pg_proc where oid = 'public.get_operational_waiting_route(text,uuid)'::regprocedure), 'work_order_issue') > 0
          and strpos((select prosrc from pg_proc where oid = 'public.get_operational_waiting_route(text,uuid)'::regprocedure), 'delivery_record') > 0
          and strpos((select prosrc from pg_proc where oid = 'public.get_operational_waiting_route(text,uuid)'::regprocedure), 'transfer_receipt') > 0
          and strpos(lower((select prosrc from pg_proc where oid = 'public.get_operational_waiting_route(text,uuid)'::regprocedure)), 'execute ') = 0
          and strpos(lower((select prosrc from pg_proc where oid = 'public.get_operational_waiting_route(text,uuid)'::regprocedure)), 'format(') = 0,
  'ACC-07 the allowlist names the three kinds and the body builds no dynamic SQL');
select is(has_function_privilege('authenticated', 'public.may_approve_work_of(uuid,uuid)', 'execute'), false,
  'ACC-08 may_approve_work_of is not executable by authenticated (0218), which is why its two limbs are inlined');
select is(pg_temp._route('not_a_kind', '16660000-0000-0000-0000-000000000401'),
          jsonb_build_object('approvers', '[]'::jsonb, 'route_kind', null),
  'ACC-09 an unknown kind has no route');
select is(pg_temp._route('work_order_issue', '16660000-0000-0000-0000-000000000608'),
          jsonb_build_object('approvers', '[]'::jsonb, 'route_kind', 'work_order_issue'),
  'ACC-10 a known kind over an unreadable id returns its kind with nobody named (no null signal / no existence oracle)');

select * from finish();
rollback;
