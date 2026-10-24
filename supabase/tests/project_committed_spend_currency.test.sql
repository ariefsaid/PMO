-- project_committed_spend_currency.test.sql — 0373. A project's committed spend is reported per currency: the
-- project-currency position (always present), plus a separate position for each other currency with an open
-- commitment. Amounts in different currencies are never added together.
begin;
select plan(6);

insert into organizations (id, name, default_currency) values
  ('03733000-0000-0000-0000-0000000000f0','PCS','IDR'), ('03733000-0000-0000-0000-0000000000fb','PCS B','IDR');
insert into auth.users (id, email) values
  ('03733000-0000-0000-0000-0000000000f1','pcs-fin@example.com'), ('03733000-0000-0000-0000-0000000000b1','pcs-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('03733000-0000-0000-0000-0000000000f1','03733000-0000-0000-0000-0000000000f0','Fin','pcs-fin@example.com','Finance','active'),
  ('03733000-0000-0000-0000-0000000000b1','03733000-0000-0000-0000-0000000000fb','B Fin','pcs-b@example.com','Finance','active');
insert into projects (id, org_id, name, status, currency) values
  ('03733000-0000-0000-0000-0000000000d1','03733000-0000-0000-0000-0000000000f0','PCS mixed','Ongoing Project','IDR'),
  ('03733000-0000-0000-0000-0000000000d2','03733000-0000-0000-0000-0000000000f0','PCS empty','Ongoing Project','IDR'),
  ('03733000-0000-0000-0000-0000000000d3','03733000-0000-0000-0000-0000000000f0','PCS same','Ongoing Project','IDR');
insert into procurements (id, org_id, title, requested_by_id, project_id, currency, total_value, status) values
  ('03733000-0000-0000-0000-0000000000e1','03733000-0000-0000-0000-0000000000f0','IDR 100','03733000-0000-0000-0000-0000000000f1','03733000-0000-0000-0000-0000000000d1','IDR',100,'Ordered'),
  ('03733000-0000-0000-0000-0000000000e2','03733000-0000-0000-0000-0000000000f0','USD 50','03733000-0000-0000-0000-0000000000f1','03733000-0000-0000-0000-0000000000d1','USD',50,'Ordered'),
  ('03733000-0000-0000-0000-0000000000e3','03733000-0000-0000-0000-0000000000f0','USD 20','03733000-0000-0000-0000-0000000000f1','03733000-0000-0000-0000-0000000000d1','USD',20,'Paid'),
  ('03733000-0000-0000-0000-0000000000e4','03733000-0000-0000-0000-0000000000f0','IDR 30','03733000-0000-0000-0000-0000000000f1','03733000-0000-0000-0000-0000000000d3','IDR',30,'Ordered'),
  ('03733000-0000-0000-0000-0000000000e5','03733000-0000-0000-0000-0000000000f0','IDR 70','03733000-0000-0000-0000-0000000000f1','03733000-0000-0000-0000-0000000000d3','IDR',70,'Received'),
  -- Not committed yet: never part of committed spend.
  ('03733000-0000-0000-0000-0000000000e6','03733000-0000-0000-0000-0000000000f0','EUR draft','03733000-0000-0000-0000-0000000000f1','03733000-0000-0000-0000-0000000000d1','EUR',999,'Draft');

set local role authenticated;
set local request.jwt.claims = '{"sub":"03733000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select results_eq($$ select currency, amount, is_project_currency from project_committed_spend('03733000-0000-0000-0000-0000000000d1') $$,
  $$ values ('IDR'::text, 100::numeric, true), ('USD'::text, 70::numeric, false) $$,
  'a project with IDR and USD commitments reports each currency separately, the project currency first');
select is((select sum(amount) filter (where is_project_currency) from project_committed_spend('03733000-0000-0000-0000-0000000000d1')), 100::numeric,
  'the project-currency figure excludes the USD amount (never 170)');
select results_eq($$ select currency, amount, is_project_currency from project_committed_spend('03733000-0000-0000-0000-0000000000d3') $$,
  $$ values ('IDR'::text, 100::numeric, true) $$, 'same-currency commitments still add up');
select results_eq($$ select currency, amount, is_project_currency from project_committed_spend('03733000-0000-0000-0000-0000000000d2') $$,
  $$ values ('IDR'::text, 0::numeric, true) $$, 'a project with no commitments reports 0 in its currency');
set local request.jwt.claims = '{"sub":"03733000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*) from project_committed_spend('03733000-0000-0000-0000-0000000000d1')), 0::bigint,
  'another org reads no positions for this project');
reset role;
reset request.jwt.claims;
select ok(not has_function_privilege('anon','public.project_committed_spend(uuid)','execute')
          and has_function_privilege('authenticated','public.project_committed_spend(uuid)','execute'),
  'project_committed_spend is callable by signed-in users only');

select * from finish();
rollback;
