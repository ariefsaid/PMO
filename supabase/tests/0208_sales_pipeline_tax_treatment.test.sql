-- 0208_sales_pipeline_tax_treatment.test.sql — get_sales_pipeline() carries each deal's OWN basis
-- AC-TAX-301..305 / OD-TAX-1 §2 / #578
--
-- ⚑ THE FIXTURE MIXES TREATMENTS ON PURPOSE. A pipeline fixture where every deal shares one
-- treatment cannot tell a projected value from a hardcoded one — that is the exact dead-oracle
-- shape #566's review caught on the drawdown card, where all fixtures said the same thing and
-- hardcoding the label passed 26 tests. So this fixture holds all THREE legal states:
--   INCL-1  1,200,000  'inclusive'
--   EXCL-1    950,000  'exclusive'
--   NULL-1          0   NULL       ← legal only at zero value (0197's check constraint)
-- Any implementation that returns a constant fails at least one of the first three assertions.
--
-- DECOUPLED from seed: isolated org, UUID prefix 02080000-….
begin;
select plan(5);

insert into organizations (id, name) values
  ('02080000-0000-0000-0000-000000000001', 'Pipeline Tax Basis Org (0208)');

insert into auth.users (id, email) values
  ('02080000-0000-0000-0000-0000000000a1', 'exec@pipeline0208.example');

insert into profiles (id, org_id, full_name, email, role) values
  ('02080000-0000-0000-0000-0000000000a1', '02080000-0000-0000-0000-000000000001',
   'Exec 0208', 'exec@pipeline0208.example', 'Executive');

insert into pipeline_stage_config (org_id, status, win_probability) values
  ('02080000-0000-0000-0000-000000000001', 'Tender Submitted', 0.500);

insert into projects (id, org_id, code, name, status, project_manager_id,
                      contract_value, budget, spent, tax_treatment, tax_amount)
values
  ('08200000-0000-0000-0000-000000000001', '02080000-0000-0000-0000-000000000001',
   'INCL1', 'Inclusive Deal', 'Tender Submitted',
   '02080000-0000-0000-0000-0000000000a1', 1200000, 0, 0, 'inclusive', 120000),
  ('08200000-0000-0000-0000-000000000002', '02080000-0000-0000-0000-000000000001',
   'EXCL1', 'Exclusive Deal', 'Tender Submitted',
   '02080000-0000-0000-0000-0000000000a1',  950000, 0, 0, 'exclusive',  95000),
  -- Zero value, no basis: 0197 allows NULL only here, and the FE renders NOTHING for it rather
  -- than inventing a basis the database deliberately does not hold.
  ('08200000-0000-0000-0000-000000000003', '02080000-0000-0000-0000-000000000001',
   'NULL1', 'Unpriced Deal', 'Tender Submitted',
   '02080000-0000-0000-0000-0000000000a1',       0, 0, 0, null, null);

set local role authenticated;
set local request.jwt.claims = '{"sub":"02080000-0000-0000-0000-0000000000a1","role":"authenticated"}';

create temp view pipeline_rows as
  select p->>'name' as name, p->>'tax_treatment' as tax_treatment
  from json_array_elements((public.get_sales_pipeline())->'projects') p;

select is(
  (select tax_treatment from pipeline_rows where name = 'Inclusive Deal'),
  'inclusive',
  'AC-TAX-301 get_sales_pipeline() carries an inclusive deal''s own basis'
);

select is(
  (select tax_treatment from pipeline_rows where name = 'Exclusive Deal'),
  'exclusive',
  'AC-TAX-302 …and an exclusive deal''s, from the SAME payload — a constant cannot satisfy both'
);

select is(
  (select tax_treatment from pipeline_rows where name = 'Unpriced Deal'),
  null,
  'AC-TAX-303 a NULL basis projects as NULL, never coalesced to a default — OD-TAX-1 forbids inferring a stored figure''s basis from anything but its own row'
);

-- ⚑ `::jsonb` IS LOAD-BEARING. json_array_elements() returns `json`, and `?` is a jsonb-only
-- operator — without the cast this raises `operator does not exist: json ? unknown`, which aborts
-- the transaction BEFORE finish() and reports as a plan mismatch, not as a failed assertion. An
-- oracle that cannot run is dead in the strongest sense: it can never go red for the right reason.
--
-- The stage aggregate deliberately gains NOTHING: it sums across deals whose bases differ (this
-- fixture proves they can), so there is no single basis to state. Same reasoning as `currency`.
select is(
  (select count(*)::int from json_array_elements((public.get_sales_pipeline())->'stages') s
    where s::jsonb ? 'tax_treatment'),
  0,
  'AC-TAX-304 no stage aggregate claims a tax treatment — a cross-deal total has no single basis (OD-CR-5 shape)'
);

-- 0201's column must survive this migration's drop/recreate. A recreate that silently loses a
-- sibling projection is the regression this catches.
select is(
  (select count(*)::int from json_array_elements((public.get_sales_pipeline())->'projects') p
    where p::jsonb ? 'currency' and p::jsonb ? 'tax_treatment'),
  3,
  'AC-TAX-305 the recreate keeps 0201''s currency alongside the new basis on every row'
);

select * from finish();
rollback;
