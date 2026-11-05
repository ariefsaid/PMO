begin;
select plan(16);

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

select * from finish();
rollback;
