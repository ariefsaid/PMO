-- #2525: AC-TWM-013 — mutation check. Each refusal proven in three_way_match.test.sql comes from ONE place in the shipped
-- code. This file rewrites that place in the SHIPPED function body (pg_get_functiondef + replace, so the mutant is the
-- real function with one rule broken, never a hand copy) and shows the refused action then goes through — i.e. the
-- assertions in three_way_match.test.sql that expect a refusal would go red. Each mutation first asserts its site still
-- exists, so a refactor that moves the rule fails here instead of silently testing nothing. Rolled back at the end.
begin;
create extension if not exists pgtap;
select plan(6);

insert into organizations (id, name, default_currency) values
  ('25251000-0000-0000-0000-00000000000a', 'TWM Mutation Org', 'IDR');
insert into auth.users (id, email) values
  ('25251000-0000-0000-0000-0000000000a1', 'twmm-admin@example.com'),
  ('25251000-0000-0000-0000-0000000000a2', 'twmm-fin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('25251000-0000-0000-0000-0000000000a1', '25251000-0000-0000-0000-00000000000a', 'TWMM Admin', 'twmm-admin@example.com', 'Admin', 'active'),
  ('25251000-0000-0000-0000-0000000000a2', '25251000-0000-0000-0000-00000000000a', 'TWMM Fin',   'twmm-fin@example.com',   'Finance', 'active');
insert into projects (id, org_id, name, status) values
  ('25251000-0000-0000-0000-0000000000d1', '25251000-0000-0000-0000-00000000000a', 'TWMM Site', 'Ongoing Project');
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, approved_total_value,
                          approved_by_id, budget_category, currency, is_subcontract) values
  ('25251000-0000-0000-0000-0000000000f1', '25251000-0000-0000-0000-00000000000a', 'TWMM cement', '25251000-0000-0000-0000-0000000000d1',
   '25251000-0000-0000-0000-0000000000a1', 'Vendor Invoiced', 100000, 100000, '25251000-0000-0000-0000-0000000000a1', 'Materials', 'IDR', false);
insert into procurement_items (id, org_id, procurement_id, name, quantity, rate) values
  ('25251000-0000-0000-0000-000000000011', '25251000-0000-0000-0000-00000000000a', '25251000-0000-0000-0000-0000000000f1', 'Cement', 100, 1000);
insert into procurement_receipts (id, org_id, procurement_id, gr_number, status) values
  ('25251000-0000-0000-0000-000000000021', '25251000-0000-0000-0000-00000000000a', '25251000-0000-0000-0000-0000000000f1', 'GR-TWMM-1', 'Partial');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
-- Rewrite one site of a shipped function; refuse if the site is gone (the mutation would test nothing).
create or replace function pg_temp.mutate(p_fn regprocedure, p_site text, p_mutant text) returns boolean
  language plpgsql as $$
declare d text := pg_get_functiondef(p_fn);
begin
  if position(p_site in d) = 0 then return false; end if;
  execute replace(d, p_site, p_mutant);
  return true;
end $$;

-- The Admin switches the match on; the Finance user receives 60 and bills 80 (over the received quantity).
set local role authenticated;
select pg_temp.act_as('25251000-0000-0000-0000-0000000000a1');
select set_three_way_match_settings(true, 0, 0);
select pg_temp.act_as('25251000-0000-0000-0000-0000000000a2');
select record_receipt_match_lines('25251000-0000-0000-0000-000000000021',
  '[{"item_id":"25251000-0000-0000-0000-000000000011","quantity":60}]'::jsonb);
select set_config('twmm.bill', (create_procurement_invoice(
  p_procurement_id => '25251000-0000-0000-0000-0000000000f1', p_status => 'Received', p_invoice_date => current_date,
  p_amount => 80000, p_tax_treatment => 'exclusive', p_tax_amount => 0)).id::text, true);
select record_bill_match_lines(current_setting('twmm.bill')::uuid,
  '[{"item_id":"25251000-0000-0000-0000-000000000011","quantity":80,"rate":1000}]'::jsonb);
select throws_ok($$ select create_payment('25251000-0000-0000-0000-0000000000f1', null, null, null, current_date, 1000) $$,
  'MH001', null, 'AC-TWM-013 baseline: the over-received bill is held');

-- Mutation 1 — the SoD rule (approve_bill_match_exception): the author may now approve their own exception.
reset role;
select ok(pg_temp.mutate('public.approve_bill_match_exception(uuid,text)'::regprocedure,
  'if v_uid = v_capturer or v_uid = v_recorder then', 'if false then'),
  'AC-TWM-013 the SoD site exists in the shipped approve_bill_match_exception');
set local role authenticated;
select pg_temp.act_as('25251000-0000-0000-0000-0000000000a2');
select lives_ok($$ select approve_bill_match_exception(current_setting('twmm.bill')::uuid, 'own approval') $$,
  'AC-TWM-013 with the SoD line removed the author approves their own exception — AC-TWM-009 would go red');

-- Mutation 2 — the over-received rule (bill_match_evaluate) on a fresh bill: with it disabled the bill is not held.
select set_config('twmm.bill2', (create_procurement_invoice(
  p_procurement_id => '25251000-0000-0000-0000-0000000000f1', p_status => 'Received', p_invoice_date => current_date,
  p_amount => 10000, p_tax_treatment => 'exclusive', p_tax_amount => 0)).id::text, true);
select record_bill_match_lines(current_setting('twmm.bill2')::uuid,
  '[{"item_id":"25251000-0000-0000-0000-000000000011","quantity":10,"rate":1000}]'::jsonb);
select throws_ok($$ select create_payment('25251000-0000-0000-0000-0000000000f1', null, null, null, current_date, 1000) $$,
  'MH001', null, 'AC-TWM-013 baseline: bill2 (90 billed against 60 received) is held');
reset role;
select ok(pg_temp.mutate('public.bill_match_evaluate(uuid)'::regprocedure,
  'coalesce(b.q, 0) > coalesce(rc.q, 0) * (1 + v_q) then ''over_received''', 'false then ''over_received'''),
  'AC-TWM-013 the over-received site exists in the shipped bill_match_evaluate');
set local role authenticated;
select pg_temp.act_as('25251000-0000-0000-0000-0000000000a2');
select lives_ok($$ select create_payment('25251000-0000-0000-0000-0000000000f1', null, null, null, current_date, 1000) $$,
  'AC-TWM-013 with the over-received rule disabled the over-billed purchase is paid — AC-TWM-002 would go red');

select * from finish();
rollback;
