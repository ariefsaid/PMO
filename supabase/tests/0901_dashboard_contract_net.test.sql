-- 0901_dashboard_contract_net.test.sql — #2348. Migration under test: 0901_dashboard_contract_net.sql.
-- The home's Contract on hand, contract remaining and on-hand margin are net of tax, equal to the management pack's contract_net.
-- Fixture: one tax-inclusive (111,000 incl. 11,000 tax) and one tax-exclusive (50,000, tax on top) on-hand USD contract; 30,000 paid on the first.
begin;
create extension if not exists pgtap;
select plan(9);

insert into organizations (id, name, default_currency, default_timezone) values
  ('09010000-0000-0000-0000-000000000001', 'Net Contract Org', 'USD', 'UTC');
insert into auth.users (id, email) values ('09010000-0000-0000-0000-0000000000a1', 'net-exec@example.test');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('09010000-0000-0000-0000-0000000000a1', '09010000-0000-0000-0000-000000000001', 'Net Exec', 'net-exec@example.test', 'Executive', 'active');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, currency, start_date, end_date) values
  ('09010000-0000-0000-0000-0000000000c1', '09010000-0000-0000-0000-000000000001', 'Net inclusive', 'Ongoing Project', 111000, 'inclusive', 11000, 'USD', '2026-01-01', '2026-12-31'),
  ('09010000-0000-0000-0000-0000000000c2', '09010000-0000-0000-0000-000000000001', 'Net exclusive', 'Ongoing Project', 50000, 'exclusive', 5000, 'USD', '2026-01-01', '2026-12-31');
insert into procurements (id, org_id, title, status, total_value, project_id, currency, budget_category) values
  ('09010000-0000-0000-0000-0000000000f1', '09010000-0000-0000-0000-000000000001', 'Net spend', 'Ordered', 30000, '09010000-0000-0000-0000-0000000000c1', 'USD', 'Labor');
insert into payments (id, org_id, procurement_id, status, date, amount, currency) values
  ('09010000-0000-0000-0000-0000000000d1', '09010000-0000-0000-0000-000000000001', '09010000-0000-0000-0000-0000000000f1', 'Paid', '2026-10-10', 30000, 'USD');

set local role authenticated;
set local request.jwt.claims = '{"sub":"09010000-0000-0000-0000-0000000000a1","role":"authenticated"}';
do $$ begin
  perform set_config('net.dash', public.get_executive_dashboard()::text, true);
  perform set_config('net.pack', public.get_management_pack('2026-01-01', '2026-12-01')::text, true);
end $$;

select is((select (c->>'contract_value')::numeric from jsonb_array_elements(current_setting('net.dash')::jsonb->'on_hand_value_by_currency') c where c->>'currency'='USD'),
  150000::numeric, 'AC-2348 Contract on hand is net of tax: 100,000 (inclusive) + 50,000 (exclusive)');
select is((select (c->>'contract_remaining')::numeric from jsonb_array_elements(current_setting('net.dash')::jsonb->'on_hand_value_by_currency') c where c->>'currency'='USD'),
  120000::numeric, 'AC-2348 contract remaining after spending is net contract less the 30,000 spent');
select is((current_setting('net.dash')::jsonb->>'on_hand_margin')::numeric, 0.8::numeric,
  'AC-2348 the on-hand margin is remaining / net contract (120,000 / 150,000)');
select is((select sum((x->>'contract_net')::numeric) from jsonb_array_elements(current_setting('net.pack')::jsonb->'projects') x
            where x->>'id' in ('09010000-0000-0000-0000-0000000000c1','09010000-0000-0000-0000-0000000000c2')),
  (select (c->>'contract_value')::numeric from jsonb_array_elements(current_setting('net.dash')::jsonb->'on_hand_value_by_currency') c where c->>'currency'='USD'),
  'AC-2348 the home equals the management pack contract_net total');
select is((select sum((p->>'contract_value')::numeric) from json_array_elements(current_setting('net.dash')::json->'top_projects') p),
  161000::numeric, 'AC-2348 no other figure changes: top projects still list the contract value as entered');

-- Per currency: a second, IDR tax-inclusive on-hand contract (1,110,000 incl. 110,000 tax, nothing spent) gets its own net row.
reset role;
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, currency, start_date, end_date) values
  ('09010000-0000-0000-0000-0000000000c3', '09010000-0000-0000-0000-000000000001', 'Net inclusive IDR', 'Ongoing Project', 1110000, 'inclusive', 110000, 'IDR', '2026-01-01', '2026-12-31');
set local role authenticated;
set local request.jwt.claims = '{"sub":"09010000-0000-0000-0000-0000000000a1","role":"authenticated"}';
do $$ begin
  perform set_config('net.dash2', public.get_executive_dashboard()::text, true);
end $$;

select is((select (c->>'contract_value')::numeric from jsonb_array_elements(current_setting('net.dash2')::jsonb->'on_hand_value_by_currency') c where c->>'currency'='IDR'),
  1000000::numeric, 'AC-2348 per currency: the IDR inclusive contract counts net of tax in its own row (1,110,000 - 110,000)');
select is((select (c->>'contract_remaining')::numeric from jsonb_array_elements(current_setting('net.dash2')::jsonb->'on_hand_value_by_currency') c where c->>'currency'='IDR'),
  1000000::numeric, 'AC-2348 per currency: IDR remaining after spending is its net contract (nothing spent)');
select is((select (c->>'contract_value')::numeric from jsonb_array_elements(current_setting('net.dash2')::jsonb->'on_hand_value_by_currency') c where c->>'currency'='USD'),
  150000::numeric, 'AC-2348 per currency: the USD net row is unchanged by the IDR contract');
select ok((current_setting('net.dash2')::jsonb->'on_hand_margin') = 'null'::jsonb,
  'AC-2348 per currency: with two currencies the on-hand margin is not blended across them');

select * from finish();
rollback;
