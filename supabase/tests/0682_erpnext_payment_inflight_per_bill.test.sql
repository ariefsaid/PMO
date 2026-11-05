begin;
select plan(35);

create function pg_temp.reservation_owner(p_org uuid, p_bill text) returns text language plpgsql as $$
declare
  v_owner text;
begin
  if to_regclass('public.erpnext_payment_inflight_bills') is null then return null; end if;
  execute 'select outbox_id::text from public.erpnext_payment_inflight_bills where org_id = $1 and bill_name = $2'
    into v_owner using p_org, p_bill;
  return v_owner;
end $$;

create function pg_temp.payment_lock_table_privilege(p_role text, p_privilege text) returns boolean language plpgsql as $$
declare
  v_allowed boolean;
begin
  if to_regclass('public.erpnext_payment_inflight_bills') is null then return false; end if;
  execute 'select has_table_privilege($1, ''public.erpnext_payment_inflight_bills'', $2)'
    into v_allowed using p_role, p_privilege;
  return v_allowed;
end $$;

create function pg_temp.payment_lock_rls_enabled() returns boolean language plpgsql as $$
declare
  v_enabled boolean;
begin
  select c.relrowsecurity and c.relforcerowsecurity into v_enabled
    from pg_class c where c.oid = to_regclass('public.erpnext_payment_inflight_bills');
  return coalesce(v_enabled, false);
end $$;

insert into organizations (id, name, default_currency) values
  ('06820000-0000-0000-0000-000000000001', 'ERPNext payment org A', 'IDR'),
  ('06820000-0000-0000-0000-000000000002', 'ERPNext payment org B', 'IDR');

select ok(pg_temp.payment_lock_table_privilege('service_role', 'select')
          and pg_temp.payment_lock_table_privilege('service_role', 'insert')
          and pg_temp.payment_lock_table_privilege('service_role', 'update')
          and pg_temp.payment_lock_table_privilege('service_role', 'delete'),
  'the payment reservation table grants its operations to service_role');
select ok(not pg_temp.payment_lock_table_privilege('anon', 'select')
          and not pg_temp.payment_lock_table_privilege('authenticated', 'select'),
  'the payment reservation table is not client-readable');
select ok(pg_temp.payment_lock_rls_enabled(),
  'the payment reservation table enables and forces row-level security');

-- A payment's bill identity comes from its persisted Payment Entry probe payload.
insert into external_command_outbox (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload) values
  ('06820000-0000-0000-0000-000000000101', '06820000-0000-0000-0000-000000000001', 'procurement', 'payment-a1', 'key-a1', 'erpnext', 'create', 'committing',
   '{"erp_doc_kind":"payment","pi_names":["ERP-PINV-0682-A"]}');

select throws_ok(
  $$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
     values ('06820000-0000-0000-0000-000000000001', 'procurement', 'payment-a2', 'key-a2', 'erpnext', 'create', 'pending',
       '{"erp_doc_kind":"payment","pi_names":["ERP-PINV-0682-A"]}') $$,
  '23505', null,
  'a second ERPNext vendor payment for the same bill is refused by the database');

select lives_ok(
  $$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
     values ('06820000-0000-0000-0000-000000000001', 'procurement', 'payment-b1', 'key-b1', 'erpnext', 'create', 'pending',
       '{"erp_doc_kind":"payment","pi_names":["ERP-PINV-0682-B"]}') $$,
  'a different bill can have its own in-flight ERPNext vendor payment');

select lives_ok(
  $$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
     values ('06820000-0000-0000-0000-000000000002', 'procurement', 'payment-org-b', 'key-org-b', 'erpnext', 'create', 'pending',
       '{"erp_doc_kind":"payment","pi_names":["ERP-PINV-0682-A"]}') $$,
  'another org can pay a bill with the same ERP reference');

select lives_ok(
  $$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
     values ('06820000-0000-0000-0000-000000000001', 'procurement', 'odoo-payment', 'key-odoo', 'odoo', 'create', 'pending',
       '{"erp_doc_kind":"payment","pi_names":["ERP-PINV-0682-A"]}') $$,
  'Odoo payment rows keep their own serialization behavior');

select lives_ok(
  $$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
     values ('06820000-0000-0000-0000-000000000001', 'procurement', 'erpnext-invoice', 'key-invoice', 'erpnext', 'create', 'pending',
       '{"erp_doc_kind":"purchase-invoice","pi_names":["ERP-PINV-0682-A"]}') $$,
  'ERPNext non-payment rows are not reserved by the vendor-payment rule');

select lives_ok(
  $$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
     values ('06820000-0000-0000-0000-000000000001', 'procurement', 'payment-multi', 'key-multi', 'erpnext', 'create', 'pending',
       '{"erp_doc_kind":"payment","pi_names":["ERP-PINV-0682-C","ERP-PINV-0682-D"]}') $$,
  'one ERPNext payment can reserve each bill in its multi-bill payload');

select throws_ok(
  $$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
     values ('06820000-0000-0000-0000-000000000001', 'procurement', 'payment-overlap', 'key-overlap', 'erpnext', 'create', 'pending',
       '{"erp_doc_kind":"payment","pi_names":["ERP-PINV-0682-D"]}') $$,
  '23505', null,
  'a later payment that overlaps any bill in a multi-bill command is refused');

update external_command_outbox set state = 'confirmed' where id = '06820000-0000-0000-0000-000000000101';
select lives_ok(
  $$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
     values ('06820000-0000-0000-0000-000000000001', 'procurement', 'payment-a-after-confirmed', 'key-a-confirmed', 'erpnext', 'create', 'pending',
       '{"erp_doc_kind":"payment","pi_names":["ERP-PINV-0682-A"]}') $$,
  'a confirmed payment releases its bill for a later payment');

insert into external_command_outbox (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload) values
  ('06820000-0000-0000-0000-000000000105', '06820000-0000-0000-0000-000000000001', 'procurement', 'payment-failed', 'key-failed', 'erpnext', 'create', 'committing',
   '{"erp_doc_kind":"payment","pi_names":["ERP-PINV-0682-E"]}');
update external_command_outbox set state = 'failed' where id = '06820000-0000-0000-0000-000000000105';
select lives_ok(
  $$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
     values ('06820000-0000-0000-0000-000000000001', 'procurement', 'payment-e-after-failed', 'key-e-failed', 'erpnext', 'create', 'pending',
       '{"erp_doc_kind":"payment","pi_names":["ERP-PINV-0682-E"]}') $$,
  'a failed payment releases its bill for a later payment');

insert into external_command_outbox (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload) values
  ('06820000-0000-0000-0000-000000000106', '06820000-0000-0000-0000-000000000001', 'procurement', 'payment-held', 'key-held', 'erpnext', 'create', 'held',
   '{"erp_doc_kind":"payment","pi_names":["ERP-PINV-0682-F"]}');
select throws_ok(
  $$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
     values ('06820000-0000-0000-0000-000000000001', 'procurement', 'payment-held-rival', 'key-held-rival', 'erpnext', 'create', 'pending',
       '{"erp_doc_kind":"payment","pi_names":["ERP-PINV-0682-F"]}') $$,
  '23505', null,
  'a held ERPNext payment keeps its bill reserved');

-- Model two in-flight commands that already existed when this rule was installed. The migration's
-- deterministic backfill seeds one reservation per org/bill; when its owner ends, the trigger moves
-- that reservation to another still-in-flight row before admitting a new intent.
insert into external_command_outbox (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload) values
  ('06820000-0000-0000-0000-000000000107', '06820000-0000-0000-0000-000000000001', 'procurement', 'payment-legacy-a', 'key-legacy-a', 'erpnext', 'create', 'committing',
   '{"erp_doc_kind":"payment","pi_names":["ERP-PINV-0682-G"]}');
do $$
begin
  if exists (select 1 from pg_trigger where tgname = 'external_command_outbox_zz_erpnext_payment_inflight_guard') then
    execute 'alter table public.external_command_outbox disable trigger external_command_outbox_zz_erpnext_payment_inflight_guard';
  end if;
end $$;
insert into external_command_outbox (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload) values
  ('06820000-0000-0000-0000-000000000108', '06820000-0000-0000-0000-000000000001', 'procurement', 'payment-legacy-b', 'key-legacy-b', 'erpnext', 'create', 'committing',
   '{"erp_doc_kind":"payment","pi_names":["ERP-PINV-0682-G"]}');
do $$
begin
  if exists (select 1 from pg_trigger where tgname = 'external_command_outbox_zz_erpnext_payment_inflight_guard') then
    execute 'alter table public.external_command_outbox enable trigger external_command_outbox_zz_erpnext_payment_inflight_guard';
  end if;
end $$;

update external_command_outbox set state = 'confirmed' where id = '06820000-0000-0000-0000-000000000107';
select is(pg_temp.reservation_owner('06820000-0000-0000-0000-000000000001', 'ERP-PINV-0682-G'),
          '06820000-0000-0000-0000-000000000108',
  'when one pre-existing command ends, its reservation moves to another in-flight command for that bill');
select throws_ok(
  $$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
     values ('06820000-0000-0000-0000-000000000001', 'procurement', 'payment-legacy-rival', 'key-legacy-rival', 'erpnext', 'create', 'pending',
       '{"erp_doc_kind":"payment","pi_names":["ERP-PINV-0682-G"]}') $$,
  '23505', null,
  'a pre-existing duplicate still reserves its bill after the first row settles');
update external_command_outbox set state = 'failed' where id = '06820000-0000-0000-0000-000000000108';
select lives_ok(
  $$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
     values ('06820000-0000-0000-0000-000000000001', 'procurement', 'payment-legacy-after-terminal', 'key-legacy-terminal', 'erpnext', 'create', 'pending',
       '{"erp_doc_kind":"payment","pi_names":["ERP-PINV-0682-G"]}') $$,
  'a bill is available again after every pre-existing in-flight command reaches a terminal state');

-- ── R1: a bill is never kept reserved by a payment that can no longer reach ERPNext. A `pending` row that was
-- never claimed (claim_generation 0) cannot have written to ERPNext (the write follows the claim), so a NEW
-- payment for its bill releases it lazily once it is older than 15 minutes. committing / quarantined / committed /
-- held rows have an unknown outcome and are never released this way.
insert into external_command_outbox (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload, created_at) values
  ('06820000-0000-0000-0000-000000000201', '06820000-0000-0000-0000-000000000001', 'procurement', 'payment-stale-1', 'key-stale-1', 'erpnext', 'create', 'pending',
   '{"erp_doc_kind":"payment","pi_names":["ERP-PINV-0682-H","ERP-PINV-0682-I"]}', now() - interval '20 minutes');
select lives_ok(
  $$ insert into external_command_outbox (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
     values ('06820000-0000-0000-0000-000000000202', '06820000-0000-0000-0000-000000000001', 'procurement', 'payment-after-stale', 'key-after-stale', 'erpnext', 'create', 'pending',
       '{"erp_doc_kind":"payment","pi_names":["ERP-PINV-0682-H"]}') $$,
  'a new payment takes a bill held by a never-claimed pending payment older than the lease');
select is((select state from external_command_outbox where id = '06820000-0000-0000-0000-000000000201'), 'failed',
  'the stale never-claimed holder is marked failed');
select ok((select last_error from external_command_outbox where id = '06820000-0000-0000-0000-000000000201') like 'payment-intent-expired%',
  'the stale holder records a clear reason');
select is(pg_temp.reservation_owner('06820000-0000-0000-0000-000000000001', 'ERP-PINV-0682-H'),
          '06820000-0000-0000-0000-000000000202', 'the new payment owns the released bill');
select is(pg_temp.reservation_owner('06820000-0000-0000-0000-000000000001', 'ERP-PINV-0682-I'), null,
  'the stale holder''s other bill is released too');

insert into external_command_outbox (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload) values
  ('06820000-0000-0000-0000-000000000203', '06820000-0000-0000-0000-000000000001', 'procurement', 'payment-fresh', 'key-fresh', 'erpnext', 'create', 'pending',
   '{"erp_doc_kind":"payment","pi_names":["ERP-PINV-0682-J"]}');
select throws_ok(
  $$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
     values ('06820000-0000-0000-0000-000000000001', 'procurement', 'payment-fresh-rival', 'key-fresh-rival', 'erpnext', 'create', 'pending',
       '{"erp_doc_kind":"payment","pi_names":["ERP-PINV-0682-J"]}') $$,
  '23505', null, 'a fresh pending payment (inside the lease) still blocks its bill');

-- Outcome-unknown states keep the bill however old they are.
insert into external_command_outbox (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, claim_generation, payload, created_at) values
  ('06820000-0000-0000-0000-000000000204', '06820000-0000-0000-0000-000000000001', 'procurement', 'payment-old-committing', 'key-old-committing', 'erpnext', 'create', 'committing', 1,
   '{"erp_doc_kind":"payment","pi_names":["ERP-PINV-0682-K"]}', now() - interval '1 day'),
  ('06820000-0000-0000-0000-000000000205', '06820000-0000-0000-0000-000000000001', 'procurement', 'payment-old-quarantined', 'key-old-quarantined', 'erpnext', 'create', 'quarantined', 2,
   '{"erp_doc_kind":"payment","pi_names":["ERP-PINV-0682-L"]}', now() - interval '1 day'),
  ('06820000-0000-0000-0000-000000000206', '06820000-0000-0000-0000-000000000001', 'procurement', 'payment-old-committed', 'key-old-committed', 'erpnext', 'create', 'committed', 1,
   '{"erp_doc_kind":"payment","pi_names":["ERP-PINV-0682-M"]}', now() - interval '1 day'),
  ('06820000-0000-0000-0000-000000000207', '06820000-0000-0000-0000-000000000001', 'procurement', 'payment-old-claimed-pending', 'key-old-claimed-pending', 'erpnext', 'create', 'pending', 1,
   '{"erp_doc_kind":"payment","pi_names":["ERP-PINV-0682-N"]}', now() - interval '1 day');
select throws_ok(
  $$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
     values ('06820000-0000-0000-0000-000000000001', 'procurement', 'rival-k', 'key-rival-k', 'erpnext', 'create', 'pending',
       '{"erp_doc_kind":"payment","pi_names":["ERP-PINV-0682-K"]}') $$,
  '23505', null, 'an old committing payment keeps its bill');
select throws_ok(
  $$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
     values ('06820000-0000-0000-0000-000000000001', 'procurement', 'rival-l', 'key-rival-l', 'erpnext', 'create', 'pending',
       '{"erp_doc_kind":"payment","pi_names":["ERP-PINV-0682-L"]}') $$,
  '23505', null, 'an old quarantined payment keeps its bill');
select throws_ok(
  $$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
     values ('06820000-0000-0000-0000-000000000001', 'procurement', 'rival-m', 'key-rival-m', 'erpnext', 'create', 'pending',
       '{"erp_doc_kind":"payment","pi_names":["ERP-PINV-0682-M"]}') $$,
  '23505', null, 'an old committed payment keeps its bill');
select throws_ok(
  $$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
     values ('06820000-0000-0000-0000-000000000001', 'procurement', 'rival-n', 'key-rival-n', 'erpnext', 'create', 'pending',
       '{"erp_doc_kind":"payment","pi_names":["ERP-PINV-0682-N"]}') $$,
  '23505', null, 'an old pending payment that was ever claimed keeps its bill');

-- A claim the purchase rules refuse leaves the row pending and never-claimed; the dispatcher then marks it failed
-- (a state=pending / claim_generation=0 guarded write), which frees the bill at once.
insert into external_command_outbox (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload) values
  ('06820000-0000-0000-0000-000000000208', '06820000-0000-0000-0000-000000000001', 'procurement', 'payment-refused', 'key-refused', 'erpnext', 'create', 'pending',
   '{"erp_doc_kind":"payment","pi_names":["ERP-PINV-0682-O"]}');
update external_command_outbox set state = 'failed', last_error = 'procurement-payment-refused: x'
 where id = '06820000-0000-0000-0000-000000000208' and state = 'pending' and claim_generation = 0;
select lives_ok(
  $$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
     values ('06820000-0000-0000-0000-000000000001', 'procurement', 'after-refused', 'key-after-refused', 'erpnext', 'create', 'pending',
       '{"erp_doc_kind":"payment","pi_names":["ERP-PINV-0682-O"]}') $$,
  'a claim-refused payment marked failed releases its bill');

-- M3: updating a row's bills moves the reservation; a failed retry is refused while a rival holds the bill.
insert into external_command_outbox (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload) values
  ('06820000-0000-0000-0000-000000000209', '06820000-0000-0000-0000-000000000001', 'procurement', 'payment-move', 'key-move', 'erpnext', 'create', 'pending',
   '{"erp_doc_kind":"payment","pi_names":["ERP-PINV-0682-P"]}');
update external_command_outbox set payload = '{"erp_doc_kind":"payment","pi_names":["ERP-PINV-0682-Q"]}' where id = '06820000-0000-0000-0000-000000000209';
select is(pg_temp.reservation_owner('06820000-0000-0000-0000-000000000001', 'ERP-PINV-0682-Q'),
          '06820000-0000-0000-0000-000000000209', 'an update that changes the bills reserves the new bill');
select is(pg_temp.reservation_owner('06820000-0000-0000-0000-000000000001', 'ERP-PINV-0682-P'), null,
  'an update that changes the bills releases the old bill');

insert into external_command_outbox (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, claim_generation, payload) values
  ('06820000-0000-0000-0000-00000000020a', '06820000-0000-0000-0000-000000000001', 'procurement', 'payment-retry', 'key-retry', 'erpnext', 'create', 'failed', 1,
   '{"erp_doc_kind":"payment","pi_names":["ERP-PINV-0682-R"]}');
insert into external_command_outbox (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload) values
  ('06820000-0000-0000-0000-00000000020b', '06820000-0000-0000-0000-000000000001', 'procurement', 'payment-retry-rival', 'key-retry-rival', 'erpnext', 'create', 'committing',
   '{"erp_doc_kind":"payment","pi_names":["ERP-PINV-0682-R"]}');
select throws_ok(
  $$ update external_command_outbox set state = 'committing' where id = '06820000-0000-0000-0000-00000000020a' $$,
  '23505', null, 'a failed payment cannot be retried while a rival holds its bill');

-- M3: the migration's backfill statement picks the earliest in-flight row of an overlapping set.
create temp table backfill_pick on commit drop as
select selected.org_id, selected.bill_name, selected.outbox_id
  from (
    select distinct on (o.org_id, bills.bill_name) o.org_id, bills.bill_name, o.id as outbox_id
      from public.external_command_outbox o
      cross join lateral jsonb_array_elements_text(
        case when jsonb_typeof(o.payload->'pi_names') = 'array' then o.payload->'pi_names' else '[]'::jsonb end
      ) as bills(bill_name)
     where o.external_tier = 'erpnext'
       and o.domain = 'procurement'
       and o.payload->>'erp_doc_kind' = 'payment'
       and o.state in ('pending','committing','committed','quarantined','held')
       and bills.bill_name is not null and bills.bill_name <> ''
     order by o.org_id, bills.bill_name, o.created_at, o.id
  ) as selected;
select is((select outbox_id::text from backfill_pick where bill_name = 'ERP-PINV-0682-R'),
          '06820000-0000-0000-0000-00000000020b',
  'the backfill picks the only in-flight row for a bill (a failed row is not in flight)');
select is((select count(*)::int from backfill_pick b join public.erpnext_payment_inflight_bills r
            on r.org_id = b.org_id and r.bill_name = b.bill_name and r.outbox_id = b.outbox_id),
          (select count(*)::int from public.erpnext_payment_inflight_bills),
  'the backfill selection equals the live reservations when no legacy overlap exists');

-- M2: deleting a reservation owner hands the bill to another in-flight row.
alter table public.external_command_outbox disable trigger external_command_outbox_zz_erpnext_payment_inflight_guard;
insert into external_command_outbox (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload, created_at) values
  ('06820000-0000-0000-0000-00000000020c', '06820000-0000-0000-0000-000000000001', 'procurement', 'payment-del-a', 'key-del-a', 'erpnext', 'create', 'committing',
   '{"erp_doc_kind":"payment","pi_names":["ERP-PINV-0682-S"]}', now() - interval '2 hours'),
  ('06820000-0000-0000-0000-00000000020d', '06820000-0000-0000-0000-000000000001', 'procurement', 'payment-del-b', 'key-del-b', 'erpnext', 'create', 'committing',
   '{"erp_doc_kind":"payment","pi_names":["ERP-PINV-0682-S"]}', now() - interval '1 hour');
insert into erpnext_payment_inflight_bills (org_id, bill_name, outbox_id) values
  ('06820000-0000-0000-0000-000000000001', 'ERP-PINV-0682-S', '06820000-0000-0000-0000-00000000020c');
alter table public.external_command_outbox enable trigger external_command_outbox_zz_erpnext_payment_inflight_guard;
delete from external_command_outbox where id = '06820000-0000-0000-0000-00000000020c';
select is(pg_temp.reservation_owner('06820000-0000-0000-0000-000000000001', 'ERP-PINV-0682-S'),
          '06820000-0000-0000-0000-00000000020d', 'deleting the owner hands the bill to the other in-flight row');

-- M3: the dispatcher writes as service_role.
set local role service_role;
select lives_ok(
  $$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
     values ('06820000-0000-0000-0000-000000000001', 'procurement', 'payment-svc', 'key-svc', 'erpnext', 'create', 'pending',
       '{"erp_doc_kind":"payment","pi_names":["ERP-PINV-0682-T"]}') $$,
  'service_role can enqueue an ERPNext payment');
select throws_ok(
  $$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
     values ('06820000-0000-0000-0000-000000000001', 'procurement', 'payment-svc-rival', 'key-svc-rival', 'erpnext', 'create', 'pending',
       '{"erp_doc_kind":"payment","pi_names":["ERP-PINV-0682-T"]}') $$,
  '23505', null, 'service_role is held to the same one-payment-per-bill rule');
reset role;

select * from finish();
rollback;
