-- rate_catalogue.test.sql — #2520 unit-rate catalogue. AC-RC-1..6, see docs/specs/unit-rate-catalogue.spec.md.
begin;
create extension if not exists pgtap;
select plan(33);

insert into organizations (id, name, default_currency, default_timezone) values
  ('25200000-0000-0000-0000-0000000000a1', 'RC Org A', 'USD', 'UTC'),
  ('25200000-0000-0000-0000-0000000000a2', 'RC Org B', 'USD', 'UTC');
insert into auth.users (id, email) values
  ('25200000-0000-0000-0000-0000000000b1', 'rc-fin@example.com'),
  ('25200000-0000-0000-0000-0000000000b2', 'rc-eng@example.com'),
  ('25200000-0000-0000-0000-0000000000b3', 'rc-foreign@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('25200000-0000-0000-0000-0000000000b1', '25200000-0000-0000-0000-0000000000a1', 'RC Finance', 'rc-fin@example.com', 'Finance', 'active'),
  ('25200000-0000-0000-0000-0000000000b2', '25200000-0000-0000-0000-0000000000a1', 'RC Engineer', 'rc-eng@example.com', 'Engineer', 'active'),
  ('25200000-0000-0000-0000-0000000000b3', '25200000-0000-0000-0000-0000000000a2', 'RC Foreign', 'rc-foreign@example.com', 'Finance', 'active');
insert into projects (id, org_id, name, status, currency) values
  ('25200000-0000-0000-0000-0000000000c1', '25200000-0000-0000-0000-0000000000a1', 'RC Contract', 'Ongoing Project', 'USD'),
  ('25200000-0000-0000-0000-0000000000c2', '25200000-0000-0000-0000-0000000000a1', 'RC Other', 'Ongoing Project', 'USD');
insert into rate_catalogue_variants (id, org_id, project_id, name) values
  ('25200000-0000-0000-0000-0000000000d1', '25200000-0000-0000-0000-0000000000a1', '25200000-0000-0000-0000-0000000000c2', 'Other');
insert into boq_items (org_id, project_id, item_code, description, unit, quantity, rate) values
  ('25200000-0000-0000-0000-0000000000a1', '25200000-0000-0000-0000-0000000000c1', 'L1', 'Line one', 'm', 10, 0);

set local role authenticated;
set local request.jwt.claims = '{"sub":"25200000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is(public.rate_catalogue_add_variants('25200000-0000-0000-0000-0000000000c1', array['Remote','Non-remote']), 2, 'AC-RC-1 Finance names two location variants');
select is(public.rate_catalogue_add_variants('25200000-0000-0000-0000-0000000000c1', array['remote']), 0, 'AC-RC-1 a variant name already there is not added twice (case-insensitive)');
select lives_ok($$select public.rate_catalogue_set_default_variant('25200000-0000-0000-0000-0000000000c1', (select id from public.rate_catalogue_variants where name='Remote'))$$, 'Finance can set a project default location');
select is((select name from public.rate_catalogue_variants where project_id='25200000-0000-0000-0000-0000000000c1' and is_default), 'Remote', 'the selected variant is the default');
select throws_ok($$select public.rate_catalogue_set_default_variant('25200000-0000-0000-0000-0000000000c1', '25200000-0000-0000-0000-0000000000d1')$$, '23514', null, 'another project variant cannot be the default');


select is((public.rate_catalogue_upsert_item('25200000-0000-0000-0000-0000000000c1',
  '{"item_code":"W-1","description":"Weld","unit":"m","category":"Pipe","class":"A","effective_from":"2026-01-01","rates":{"Remote":120,"Non-remote":100},"stages":[{"stage":"Fab","weight_pct":10},{"stage":"Weld","weight_pct":80},{"stage":"Test","weight_pct":10}]}'::jsonb)->>'rates_added')::int, 2,
  'AC-RC-2 an item is created with a rate per variant and stage weights');
select is((select count(*)::int from public.rate_catalogue_stage_weights), 3, 'AC-RC-5 three stage weights stored');
select throws_ok($$select public.rate_catalogue_upsert_item('25200000-0000-0000-0000-0000000000c1','{"item_code":"W-2","description":"d","unit":"m","effective_from":"2026-01-01","stages":[{"stage":"a","weight_pct":50}]}'::jsonb)$$,
  '22023', null, 'AC-RC-5 stage weights that do not add to 100 are refused');
select throws_ok($$select public.rate_catalogue_upsert_item('25200000-0000-0000-0000-0000000000c1','{"item_code":"W-3","description":"d","unit":"m","effective_from":"2026-01-01","stages":[{"stage":"a","weight_pct":33.333},{"stage":"b","weight_pct":33.333},{"stage":"c","weight_pct":33.334}]}'::jsonb)$$,
  '22023', null, 'AC-RC-5 weights with more than two decimals are refused before rounding');
select lives_ok($$select public.rate_catalogue_upsert_item('25200000-0000-0000-0000-0000000000c1','{"item_code":"W-1","effective_from":"2026-01-01","rates":{"Remote":120,"Non-remote":100},"stages":[{"stage":"Fab","weight_pct":10},{"stage":"Weld","weight_pct":80},{"stage":"Test","weight_pct":10}]}'::jsonb)$$,
  'AC-RC-5 repeating an identical import is idempotent');
select throws_ok($$select public.rate_catalogue_upsert_item('25200000-0000-0000-0000-0000000000c1','{"item_code":"W-2","description":"d","unit":"m","effective_from":"2026-01-01","rates":{"Mars":1}}'::jsonb)$$,
  '23503', null, 'AC-RC-2 an unknown variant is refused');

select throws_ok($$update public.boq_items set catalogue_item_id=(select id from public.rate_catalogue_items where item_code='W-1'), catalogue_variant_id='25200000-0000-0000-0000-0000000000d1', catalogue_priced_as_of='2026-02-01' where item_code='L1'$$, '23514', null, 'AC-RC-6 direct provenance changes cannot combine different projects');

select is(public.price_boq_line_from_catalogue((select id from boq_items where item_code='L1'),
  (select id from rate_catalogue_items where item_code='W-1'), (select id from rate_catalogue_variants where name='Remote'), '2026-02-01'), 120.00::numeric,
  'AC-RC-3 a BOQ line priced from the catalogue takes the location variant rate');
select is((select rate from boq_items where item_code='L1'), 120.00::numeric, 'AC-RC-3 the line carries that rate');
select lives_ok($$select public.save_boq_line_from_catalogue(null, '25200000-0000-0000-0000-0000000000c1', '{"item_code":"L2","description":"Line two","unit":"m","quantity":1,"earning_basis":"unit_rate"}'::jsonb, (select id from public.rate_catalogue_items where item_code='W-1'), (select id from public.rate_catalogue_variants where name='Remote'), '2026-02-01')$$, 'saving a priced line succeeds atomically');
select is((select rate from public.boq_items where item_code='L2'), 120::numeric, 'saved line carries catalogue rate');
select throws_ok($$select public.save_boq_line_from_catalogue(null, '25200000-0000-0000-0000-0000000000c1', '{"item_code":"L3","description":"Line three","unit":"m","quantity":1,"earning_basis":"unit_rate"}'::jsonb, (select id from public.rate_catalogue_items where item_code='W-1'), (select id from public.rate_catalogue_variants where name='Remote'), '2025-01-01')$$, 'P0002', null, 'saving without a matching rate fails atomically');


select is((public.rate_catalogue_upsert_item('25200000-0000-0000-0000-0000000000c1',
  '{"item_code":"W-1","effective_from":"2026-06-01","rates":{"Remote":150}}'::jsonb)->>'rates_added')::int, 1, 'AC-RC-4 an amendment adds a new effective-dated rate');
select is((select rate from boq_items where item_code='L1'), 120.00::numeric, 'AC-RC-4 the line priced before the amendment is unchanged');
select is(public.rate_catalogue_rate_at((select id from rate_catalogue_items where item_code='W-1'), (select id from rate_catalogue_variants where name='Remote'), '2026-05-31'), 120.00::numeric, 'AC-RC-4 history before the amendment still reads the old rate');
select throws_ok($$select public.rate_catalogue_upsert_item('25200000-0000-0000-0000-0000000000c1','{"item_code":"W-1","effective_from":"2026-03-01","rates":{"Remote":5}}'::jsonb)$$,
  '23505', null, 'AC-RC-4 an amendment dated before an existing rate is refused');
select throws_ok($$insert into public.rate_catalogue_rates (item_id, variant_id, rate, effective_from) select id, (select id from rate_catalogue_variants limit 1), 1, '2030-01-01' from rate_catalogue_items limit 1$$,
  '42501', null, 'AC-RC-4 rates cannot be written outside the RPC');

select throws_ok($$update public.rate_catalogue_items set description='Changed' where item_code='W-1'$$, '42501', null, 'AC-RC-6 direct item update denied');
select throws_ok($$delete from public.rate_catalogue_variants where name='Remote'$$, '42501', null, 'AC-RC-6 direct variant delete denied');
select throws_ok($$delete from public.rate_catalogue_stage_weights$$, '42501', null, 'AC-RC-6 direct stage delete denied');
set local request.jwt.claims = '{"sub":"25200000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select is((select count(*)::int from public.rate_catalogue_items), 0, 'AC-RC-6 an engineer cannot read catalogue items');
select throws_ok($$select public.rate_catalogue_upsert_item('25200000-0000-0000-0000-0000000000c1', '{"item_code":"W-1"}'::jsonb)$$, '42501', null, 'AC-RC-6 a non-Finance role cannot write items');
select throws_ok($$select public.price_boq_line_from_catalogue((select id from public.boq_items where item_code='L1'), '25200000-0000-0000-0000-0000000000d1', '25200000-0000-0000-0000-0000000000d1', '2026-02-01')$$, '23514', null, 'AC-RC-6 a non-Finance role cannot price with an inaccessible catalogue');
select throws_ok($$select public.rate_catalogue_add_variants('25200000-0000-0000-0000-0000000000c1', array['X'])$$, '42501', null, 'AC-RC-6 a non-Finance role cannot change the catalogue');
select throws_ok($$select public.rate_catalogue_set_default_variant('25200000-0000-0000-0000-0000000000c1', null)$$, '42501', null, 'non-Finance cannot change the default');
set local request.jwt.claims = '{"sub":"25200000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select throws_ok($$select public.rate_catalogue_add_variants('25200000-0000-0000-0000-0000000000c1', array['X'])$$, 'P0002', null, 'AC-RC-6 another organization cannot reach the contract');

select is((select count(*)::int from public.rate_catalogue_items), 0, 'AC-RC-6 a foreign organization cannot read catalogue items');
select throws_ok($$select public.rate_catalogue_upsert_item('25200000-0000-0000-0000-0000000000c1', '{"item_code":"W-1"}'::jsonb)$$, 'P0002', null, 'AC-RC-6 a foreign organization cannot write items');

select * from finish();
rollback;
