-- AC-1793 / AC-1796: the shipped stage order, independent Go/Get values, and weighted forecast.
begin;
create extension if not exists pgtap;
select plan(20);

insert into organizations (id, name) values
  ('59100000-0000-0000-0000-000000000001', 'Pipeline order and probabilities');
insert into auth.users (id, email) values
  ('59100000-0000-0000-0000-0000000000a1', 'pipeline591@example.test');
insert into profiles (id, org_id, full_name, email, role) values
  ('59100000-0000-0000-0000-0000000000a1', '59100000-0000-0000-0000-000000000001',
   'Pipeline QA', 'pipeline591@example.test', 'Project Manager');
select seed_org_defaults('59100000-0000-0000-0000-000000000001');

insert into projects (id, org_id, code, name, status, project_manager_id, contract_value, tax_treatment, tax_amount) values
  ('59100000-0000-0000-0000-000000000010', '59100000-0000-0000-0000-000000000001', 'P10', 'Lead to Quotation', 'Leads', '59100000-0000-0000-0000-0000000000a1', 1000, 'exclusive', 0),
  ('59100000-0000-0000-0000-000000000011', '59100000-0000-0000-0000-000000000001', 'P11', 'Quotation to Pre-Qual', 'Quotation Submitted', '59100000-0000-0000-0000-0000000000a1', 2000, 'exclusive', 0),
  ('59100000-0000-0000-0000-000000000012', '59100000-0000-0000-0000-000000000001', 'P12', 'Pre-Qual to Tender', 'PQ Submitted', '59100000-0000-0000-0000-0000000000a1', 3000, 'exclusive', 0),
  ('59100000-0000-0000-0000-000000000013', '59100000-0000-0000-0000-000000000001', 'P13', 'Lost to reopen', 'Loss Tender', '59100000-0000-0000-0000-0000000000a1', 0, null, 0),
  ('59100000-0000-0000-0000-000000000014', '59100000-0000-0000-0000-000000000001', 'P14', 'Leads old order refused', 'Leads', '59100000-0000-0000-0000-0000000000a1', 0, null, 0),
  ('59100000-0000-0000-0000-000000000015', '59100000-0000-0000-0000-000000000001', 'P15', 'Won probability', 'Won, Pending KoM', '59100000-0000-0000-0000-0000000000a1', 0, null, 0),
  ('59100000-0000-0000-0000-000000000016', '59100000-0000-0000-0000-000000000001', 'P16', 'Lost probability', 'Declined', '59100000-0000-0000-0000-0000000000a1', 0, null, 0),
  ('59100000-0000-0000-0000-000000000017', '59100000-0000-0000-0000-000000000001', 'P17', 'Quotation cannot move back to Leads', 'Quotation Submitted', '59100000-0000-0000-0000-0000000000a1', 0, null, 0);

set local role authenticated;
set local request.jwt.claims = '{"sub":"59100000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is(
  (select json_agg(status order by ordinal)::text from unnest(public.pipeline_project_statuses()) with ordinality as s(status, ordinal)),
  '["Leads", "Quotation Submitted", "PQ Submitted", "Tender Submitted", "Negotiation"]',
  'AC-1793: pipeline status list follows Leads → Quotation → Pre-Qual → Tender → Negotiation'
);
select is(
  (select json_agg(win_probability order by case status
      when 'Leads' then 1 when 'Quotation Submitted' then 2 when 'PQ Submitted' then 3
      when 'Tender Submitted' then 4 when 'Negotiation' then 5 end)::text from public.pipeline_stage_config
   where org_id='59100000-0000-0000-0000-000000000001'),
  '[0.100, 0.200, 0.400, 0.800, 0.900]',
  'AC-1793: stage Go defaults are Leads 10, Quotation 20, Pre-Qual 40, Tender 80, Negotiation 90 percent'
);
select is((select get_probability from public.projects where id='59100000-0000-0000-0000-000000000010'), 0.250::numeric,
  'AC-1796: new open opportunities default to 25 percent Get');
select is((select get_probability from public.projects where id='59100000-0000-0000-0000-000000000015'), 1.000::numeric,
  'AC-1796: Won is always 100 percent Get');
select is((select go_probability from public.projects where id='59100000-0000-0000-0000-000000000015'), 1.000::numeric,
  'AC-1796: Won is always 100 percent Go');
select is((select get_probability from public.projects where id='59100000-0000-0000-0000-000000000016'), 0.000::numeric,
  'AC-1796: Lost is always 0 percent Get');
select ok((select bool_and(go_probability=1.000) from public.projects
           where id in ('59100000-0000-0000-0000-000000000015','59100000-0000-0000-0000-000000000016')),
  'AC-1796: Won and Lost both carry 100 percent Go');

select lives_ok($$ select public.transition_project('59100000-0000-0000-0000-000000000010','Quotation Submitted') $$,
  'AC-1793: Leads advances to Quotation');
select lives_ok($$ select public.transition_project('59100000-0000-0000-0000-000000000011','PQ Submitted') $$,
  'AC-1793: Quotation advances to Pre-Qual');
select lives_ok($$ select public.transition_project('59100000-0000-0000-0000-000000000012','Tender Submitted') $$,
  'AC-1793: Pre-Qual advances to Tender');
select is((select go_probability from public.projects where id='59100000-0000-0000-0000-000000000010'), 0.200::numeric,
  'AC-1796: advancing into Quotation applies that stage’s Go default');
select throws_ok($$ select public.transition_project('59100000-0000-0000-0000-000000000014','PQ Submitted') $$,
  'P0001', null, 'AC-1793: Leads cannot skip Quotation');
select throws_ok($$ select public.transition_project('59100000-0000-0000-0000-000000000017','Leads') $$,
  'P0001', null, 'AC-1793: Quotation cannot move backward to Leads');

update public.projects set go_probability=0.500, get_probability=0.500 where id='59100000-0000-0000-0000-000000000011';
select is(((select value->>'get_probability' from jsonb_array_elements(public.get_sales_pipeline()::jsonb->'projects') value
           where value->>'id'='59100000-0000-0000-0000-000000000011'))::numeric, 0.500::numeric,
  'AC-1796: pipeline project projection carries Get probability');
select is(((select value->>'go_probability' from jsonb_array_elements(public.get_sales_pipeline()::jsonb->'stages') value
           where value->>'status'='Quotation Submitted'))::numeric, 0.200::numeric,
  'AC-1796: project Go override does not change the configured stage default');
select is(((select value->>'go_probability' from jsonb_array_elements(public.get_sales_pipeline()::jsonb->'projects') value
           where value->>'id'='59100000-0000-0000-0000-000000000011'))::numeric, 0.500::numeric,
  'AC-1796: pipeline project projection carries its editable Go override');
select is(((select value->>'weighted_value' from jsonb_array_elements(public.get_sales_pipeline()::jsonb->'stages') value
           where value->>'status'='PQ Submitted'))::numeric, 500.000::numeric,
  'AC-1796: stage forecast weights value by project Go 50 percent and Get 50 percent');
select is((public.get_executive_dashboard()->>'pipeline_weighted_value')::numeric, 1150.000::numeric,
  'AC-1796: dashboard weighted pipeline uses the same per-project Go × Get denominator');

select lives_ok($$ select public.transition_project('59100000-0000-0000-0000-000000000013','Negotiation') $$,
  'AC-1796: reopening a lost opportunity restores the 25 percent Get default');
select is((select get_probability from public.projects where id='59100000-0000-0000-0000-000000000013'), 0.250::numeric,
  'AC-1796: reopened opportunity is at 25 percent Get');

reset role;
select * from finish();
rollback;
