-- #2634: AC-TWM-021 — mutation check of the settings writer, the held count and the edit states of the line writers.
-- Each refusal proven in three_way_match_settings.test.sql comes from ONE place in the shipped code. This file rewrites that
-- place in the SHIPPED function body (pg_get_functiondef + replace, so the mutant is the real function with one rule
-- broken, never a hand copy) and shows the refused action then goes through, i.e. the assertions that expect a refusal
-- would go red. Each mutation first asserts its site still exists. Everything it redefines is undone by a rollback to a
-- savepoint (and proven restored by repeating the refusals) and the whole file ends in a rollback: no state is left for
-- another test file.
begin;
create extension if not exists pgtap;
select plan(15);

insert into organizations (id, name, default_currency) values ('26341000-0000-0000-0000-00000000000a', 'TWSM Org', 'IDR');
insert into auth.users (id, email) values
  ('26341000-0000-0000-0000-0000000000a1', 'twsm-admin@example.com'),
  ('26341000-0000-0000-0000-0000000000a2', 'twsm-fin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26341000-0000-0000-0000-0000000000a1', '26341000-0000-0000-0000-00000000000a', 'TWSM Admin', 'twsm-admin@example.com', 'Admin', 'active'),
  ('26341000-0000-0000-0000-0000000000a2', '26341000-0000-0000-0000-00000000000a', 'TWSM Fin',   'twsm-fin@example.com',   'Finance', 'active');
insert into projects (id, org_id, name, status) values
  ('26341000-0000-0000-0000-0000000000d1', '26341000-0000-0000-0000-00000000000a', 'TWSM Site', 'Ongoing Project');
-- f1: an open purchase with a Paid bill. f2: a Paid purchase with a receipt.
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, approved_total_value,
                          approved_by_id, budget_category, currency, is_subcontract) values
  ('26341000-0000-0000-0000-0000000000f1', '26341000-0000-0000-0000-00000000000a', 'TWSM open', '26341000-0000-0000-0000-0000000000d1',
   '26341000-0000-0000-0000-0000000000a1', 'Vendor Invoiced', 100000, 100000, '26341000-0000-0000-0000-0000000000a1', 'Materials', 'IDR', false),
  ('26341000-0000-0000-0000-0000000000f2', '26341000-0000-0000-0000-00000000000a', 'TWSM paid', '26341000-0000-0000-0000-0000000000d1',
   '26341000-0000-0000-0000-0000000000a1', 'Vendor Invoiced', 100000, 100000, '26341000-0000-0000-0000-0000000000a1', 'Materials', 'IDR', false);
insert into procurement_items (id, org_id, procurement_id, name, quantity, rate) values
  ('26341000-0000-0000-0000-000000000011', '26341000-0000-0000-0000-00000000000a', '26341000-0000-0000-0000-0000000000f1', 'Cement', 100, 1000),
  ('26341000-0000-0000-0000-000000000012', '26341000-0000-0000-0000-00000000000a', '26341000-0000-0000-0000-0000000000f2', 'Cement', 100, 1000);
insert into procurement_receipts (id, org_id, procurement_id, gr_number, status) values
  ('26341000-0000-0000-0000-000000000022', '26341000-0000-0000-0000-00000000000a', '26341000-0000-0000-0000-0000000000f2', 'GR-TWSM-2', 'Partial');
update procurements set status = 'Paid' where id = '26341000-0000-0000-0000-0000000000f2';
insert into procurement_invoices (id, org_id, procurement_id, status, amount, tax_treatment, tax_amount, created_at) values
  ('26341000-0000-0000-0000-000000000031', '26341000-0000-0000-0000-00000000000a', '26341000-0000-0000-0000-0000000000f1', 'Paid', 1000, 'exclusive', 0, now() - interval '1 day');

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
-- The four refusals, as one Finance user would meet them; returns how many are still refused (4 = all in place).
create or replace function pg_temp.refusals() returns int language plpgsql as $$
declare n int := 0;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', '26341000-0000-0000-0000-0000000000a2', 'role', 'authenticated')::text, true);
  begin perform set_three_way_match_settings(true, 0, 0);
  exception when sqlstate '42501' then n := n + 1; end;
  begin perform three_way_match_held_count();
  exception when sqlstate '42501' then n := n + 1; end;
  begin perform record_bill_match_lines('26341000-0000-0000-0000-000000000031',
    '[{"item_id":"26341000-0000-0000-0000-000000000011","quantity":1,"rate":1000}]'::jsonb);
  exception when sqlstate '23514' then n := n + 1; end;
  begin perform record_receipt_match_lines('26341000-0000-0000-0000-000000000022',
    '[{"item_id":"26341000-0000-0000-0000-000000000012","quantity":1}]'::jsonb);
  exception when sqlstate '23514' then n := n + 1; end;
  return n;
end $$;
-- The match is on for the organisation (an Admin switched it on, as the owner would).
insert into org_three_way_match_settings (org_id, enabled, quantity_tolerance_pct, amount_tolerance_pct, enabled_at, updated_by)
  values ('26341000-0000-0000-0000-00000000000a', true, 0, 0, now(), '26341000-0000-0000-0000-0000000000a1');
-- Finance acts as an Executive-or-lower would: a Finance user is not an Admin. Finance may record lines.
set local role authenticated;
select is(pg_temp.refusals(), 4, 'AC-TWM-021 baseline: a non-Admin is refused the setting and the count; a Paid bill and a Paid purchase''s receipt keep their lines');
reset role;

savepoint before_mutation;

-- Mutation 1 — the Admin check of the settings writer.
select ok(pg_temp.mutate('public.set_three_way_match_settings(boolean,numeric,numeric)'::regprocedure,
  'if public.auth_role() is distinct from ''Admin'' then', 'if false then'),
  'AC-TWM-021 the Admin site exists in the shipped set_three_way_match_settings');
set local role authenticated;
select pg_temp.act_as('26341000-0000-0000-0000-0000000000a2');
select lives_ok($$ select set_three_way_match_settings(false, 0, 0) $$,
  'AC-TWM-021 with the Admin check removed a Finance user sets the match — AC-TWM-017 would go red');
reset role;

-- Mutation 2 — the Admin check of the held count.
select ok(pg_temp.mutate('public.three_way_match_held_count()'::regprocedure,
  'if public.auth_role() is distinct from ''Admin'' then', 'if false then'),
  'AC-TWM-021 the Admin site exists in the shipped three_way_match_held_count');
set local role authenticated;
select pg_temp.act_as('26341000-0000-0000-0000-0000000000a2');
select lives_ok($$ select three_way_match_held_count() $$,
  'AC-TWM-021 with the Admin check removed a Finance user reads the held count — AC-TWM-017 would go red');
reset role;

-- Mutation 3 — the Paid-bill refusal of the bill-lines writer.
select ok(pg_temp.mutate('public.record_bill_match_lines(uuid,jsonb)'::regprocedure,
  'if v_inv.status::text = ''Paid'' then', 'if false then'),
  'AC-TWM-021 the Paid-bill site exists in the shipped record_bill_match_lines');
set local role authenticated;
select pg_temp.act_as('26341000-0000-0000-0000-0000000000a2');
select lives_ok($$ select record_bill_match_lines('26341000-0000-0000-0000-000000000031',
  '[{"item_id":"26341000-0000-0000-0000-000000000011","quantity":1,"rate":1000}]'::jsonb) $$,
  'AC-TWM-021 with the Paid-bill refusal removed a Paid bill''s lines change — AC-TWM-018 would go red');
reset role;

-- Mutation 4 — the Paid-or-Cancelled refusal of the receipt-lines writer.
select ok(pg_temp.mutate('public.record_receipt_match_lines(uuid,jsonb)'::regprocedure,
  'if v_proc.status::text in (''Paid'', ''Cancelled'') then', 'if false then'),
  'AC-TWM-021 the closed-purchase site exists in the shipped record_receipt_match_lines');
set local role authenticated;
select pg_temp.act_as('26341000-0000-0000-0000-0000000000a2');
select lives_ok($$ select record_receipt_match_lines('26341000-0000-0000-0000-000000000022',
  '[{"item_id":"26341000-0000-0000-0000-000000000012","quantity":1}]'::jsonb) $$,
  'AC-TWM-021 with the closed-purchase refusal removed a Paid purchase''s receipt lines change — AC-TWM-018 would go red');
reset role;

-- Everything redefined above is undone, and the shipped functions refuse again.
rollback to savepoint before_mutation;
set local role authenticated;
select is(pg_temp.refusals(), 4, 'AC-TWM-021 after the rollback to the savepoint all four shipped refusals are back');
reset role;
select is((select count(*)::int from procurement_bill_match_lines where invoice_id = '26341000-0000-0000-0000-000000000031'), 0,
  'AC-TWM-021 the mutated write left no bill line behind');
select is((select count(*)::int from procurement_receipt_lines where receipt_id = '26341000-0000-0000-0000-000000000022'), 0,
  'AC-TWM-021 the mutated write left no receipt line behind');
select is((select enabled from org_three_way_match_settings where org_id = '26341000-0000-0000-0000-00000000000a'), true,
  'AC-TWM-021 the mutated settings write is undone');
select is(pg_get_functiondef('public.record_bill_match_lines(uuid,jsonb)'::regprocedure) like '%if v_inv.status::text = ''Paid'' then%', true,
  'AC-TWM-021 the shipped bill-lines writer is back as migrated');
select is(pg_get_functiondef('public.record_receipt_match_lines(uuid,jsonb)'::regprocedure) like '%if false then%', false,
  'AC-TWM-021 the shipped receipt-lines writer is back as migrated');

select * from finish();
rollback;
