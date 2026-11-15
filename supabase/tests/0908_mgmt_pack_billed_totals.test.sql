-- 0908_mgmt_pack_billed_totals.test.sql — all-history and opening billed work count every project (a closed,
-- archived project's earlier billing stays in), and a dated work invoice with no amount is reported as unpriced, never
-- as a known zero. Migration under test: 0908_mgmt_pack_billed_totals.sql.
begin;
create extension if not exists pgtap;
select plan(9);

insert into organizations (id, name) values ('22010000-0000-0000-0000-000000000001', 'Pack History Org');
insert into auth.users (id, email) values ('22010000-0000-0000-0000-0000000000a1', 'ph-fin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('22010000-0000-0000-0000-0000000000a1', '22010000-0000-0000-0000-000000000001', 'PH Fin', 'ph-fin@example.com', 'Finance', 'active');
insert into companies (id, org_id, name, type) values
  ('22010000-0000-0000-0000-0000000000f1', '22010000-0000-0000-0000-000000000001', 'PH Client', 'Client');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id, currency) values
  ('22010000-0000-0000-0000-0000000000c1', '22010000-0000-0000-0000-000000000001', 'PH Live', 'Ongoing Project', 1000000, 'exclusive', 0, '22010000-0000-0000-0000-0000000000f1', 'USD'),
  ('22010000-0000-0000-0000-0000000000c2', '22010000-0000-0000-0000-000000000001', 'PH Closed', 'Close Out', 500000, 'exclusive', 0, '22010000-0000-0000-0000-0000000000f1', 'USD');
insert into sales_invoices (id, org_id, project_id, customer_id, invoice_date, amount, tax_treatment, tax_amount, currency, status) values
  -- the live project's priced April invoice
  ('22010000-0000-0000-0000-00000000cc01', '22010000-0000-0000-0000-000000000001', '22010000-0000-0000-0000-0000000000c1', '22010000-0000-0000-0000-0000000000f1', '2026-04-10', 100000, 'exclusive', 0, 'USD', 'Unpaid'),
  -- the closed project's January invoice (before the March–April window)
  ('22010000-0000-0000-0000-00000000cc02', '22010000-0000-0000-0000-000000000001', '22010000-0000-0000-0000-0000000000c2', '22010000-0000-0000-0000-0000000000f1', '2026-01-15', 50000, 'exclusive', 0, 'USD', 'Paid'),
  -- an April work invoice with no amount yet, and a later one past the as-at month
  ('22010000-0000-0000-0000-00000000cc03', '22010000-0000-0000-0000-000000000001', '22010000-0000-0000-0000-0000000000c1', '22010000-0000-0000-0000-0000000000f1', '2026-04-20', null, 'exclusive', 0, 'USD', 'Unpaid'),
  ('22010000-0000-0000-0000-00000000cc04', '22010000-0000-0000-0000-000000000001', '22010000-0000-0000-0000-0000000000c1', '22010000-0000-0000-0000-0000000000f1', '2026-05-02', null, 'exclusive', 0, 'USD', 'Unpaid');
update projects set archived_at = now() where id = '22010000-0000-0000-0000-0000000000c2';

set local role authenticated;
set local request.jwt.claims = '{"sub":"22010000-0000-0000-0000-0000000000a1","role":"authenticated"}';
do $$ begin
  perform set_config('ph.narrow', public.get_management_pack('2026-03-01', '2026-04-01')::text, true);
  perform set_config('ph.wide',   public.get_management_pack('2026-01-01', '2026-04-01')::text, true);
end $$;
reset role;

create temp table packs as
  select 'narrow' as k, current_setting('ph.narrow')::jsonb as j union all
  select 'wide', current_setting('ph.wide')::jsonb;
create function pg_temp.cumulative(p jsonb) returns numeric language sql as $$
  select coalesce((select sum((x ->> 'net')::numeric) from jsonb_array_elements(p -> 'invoiced') x), 0)
       + coalesce((select sum((x ->> 'net')::numeric) from jsonb_array_elements(p -> 'invoiced_before') x), 0)
       + coalesce((select sum((x ->> 'net')::numeric) from jsonb_array_elements(p -> 'invoiced_history') x), 0) $$;

select is((select j -> 'invoiced_history' from packs where k = 'narrow'),
  '[{"currency":"USD","net":50000,"invoice_count":1}]'::jsonb,
  'AC-2201-01 the archived, closed project''s January billing is reported as billed work before the window');
select is((select pg_temp.cumulative(j) from packs where k = 'narrow'), 150000::numeric,
  'AC-2201-01 all-history billed work through April counts every project: 100,000 + 50,000');
select is((select pg_temp.cumulative(j) from packs where k = 'wide'), (select pg_temp.cumulative(j) from packs where k = 'narrow'),
  'AC-2201-01 widening the window does not change all-history billed work');
select is((select j -> 'invoiced_history' from packs where k = 'wide'), '[]'::jsonb,
  'AC-2201-01 a project billed inside the window is counted once, through the listed rows, not again as history');
select is((select j -> 'unpriced' from packs where k = 'narrow'),
  '[{"currency":"USD","month":"2026-04-01","invoice_count":1}]'::jsonb,
  'AC-2201-02 the April invoice without an amount is reported as unpriced; the May one is past the as-at month');
select is((select sum((x ->> 'net')::numeric) from packs, jsonb_array_elements(j -> 'invoiced') x where k = 'narrow' and x ->> 'month' = '2026-04-01'),
  100000::numeric,
  'AC-2201-03 April''s priced billed work is unchanged: the unpriced invoice adds no amount');
select is((select j -> 'invoiced_before' from packs where k = 'narrow'), '[]'::jsonb,
  'AC-2201-03 invoiced_before still lists only the pack''s own rows');
select is((select jsonb_agg(x ->> 'id') from packs, jsonb_array_elements(j -> 'projects') x where k = 'narrow'),
  '["22010000-0000-0000-0000-0000000000c1"]'::jsonb,
  'AC-2201-03 the pack''s project rows are unchanged: the archived project is not listed for the narrow window');
select is((select (j ->> 'undated_invoice_count')::int from packs where k = 'narrow'), 0,
  'AC-2201-03 dated unpriced invoices are not counted as undated');

select * from finish();
rollback;
