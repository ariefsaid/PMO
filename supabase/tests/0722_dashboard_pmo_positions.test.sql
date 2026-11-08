-- 0722_dashboard_pmo_positions.test.sql — the one-pass project_pmo_positions equals the per-project spent and commitment
-- positions on EVERY project (seed rows and a fixture covering partial payment, tax-inclusive invoice, foreign currency,
-- cancelled order, erp_link origin), for an executive, a project manager, and a second-org user; tenancy never widens.
begin;
create extension if not exists pgtap;
select plan(13);

insert into public.organizations (id, name, default_currency) values
  ('07220000-0000-0000-0000-000000000001', 'Positions org A', 'USD'),
  ('07220000-0000-0000-0000-000000000002', 'Positions org B', 'USD');
insert into auth.users (id, email) values
  ('07220000-0000-0000-0000-0000000000a1', 'pos-fin-a@example.test'),
  ('07220000-0000-0000-0000-0000000000a2', 'pos-eng-a@example.test'),
  ('07220000-0000-0000-0000-0000000000b1', 'pos-fin-b@example.test');
insert into public.profiles (id, org_id, full_name, email, role, status) values
  ('07220000-0000-0000-0000-0000000000a1', '07220000-0000-0000-0000-000000000001', 'Pos Fin A', 'pos-fin-a@example.test', 'Finance', 'active'),
  ('07220000-0000-0000-0000-0000000000a2', '07220000-0000-0000-0000-000000000001', 'Pos Eng A', 'pos-eng-a@example.test', 'Engineer', 'active'),
  ('07220000-0000-0000-0000-0000000000b1', '07220000-0000-0000-0000-000000000002', 'Pos Fin B', 'pos-fin-b@example.test', 'Finance', 'active');
insert into public.projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount,
                             tax_rate, tax_base_numerator, tax_base_denominator, subject_to_vat, project_manager_id) values
  ('07220000-0000-0000-0000-0000000000d1', '07220000-0000-0000-0000-000000000001', 'Half paid', 'Ongoing Project', 'USD', 10000, 'exclusive', 0, 0, 1, 1, false, '07220000-0000-0000-0000-0000000000a1'),
  ('07220000-0000-0000-0000-0000000000d2', '07220000-0000-0000-0000-000000000001', 'Taxed invoice', 'Ongoing Project', 'USD', 10000, 'exclusive', 0, 0, 1, 1, false, null),
  ('07220000-0000-0000-0000-0000000000d3', '07220000-0000-0000-0000-000000000001', 'Foreign payment', 'Ongoing Project', 'USD', 10000, 'exclusive', 0, 0, 1, 1, false, null),
  ('07220000-0000-0000-0000-0000000000d4', '07220000-0000-0000-0000-000000000001', 'Cancelled and erp link', 'Ongoing Project', 'USD', 10000, 'exclusive', 0, 0, 1, 1, false, null),
  ('07220000-0000-0000-0000-0000000000d5', '07220000-0000-0000-0000-000000000001', 'Empty', 'Ongoing Project', 'USD', 10000, 'exclusive', 0, 0, 1, 1, false, null),
  ('07220000-0000-0000-0000-0000000000d6', '07220000-0000-0000-0000-000000000002', 'Org B project', 'Ongoing Project', 'USD', 10000, 'exclusive', 0, 0, 1, 1, false, null);
insert into public.procurements (id, org_id, title, status, total_value, project_id, currency, budget_category, origin) values
  ('07220000-0000-0000-0000-0000000000f1', '07220000-0000-0000-0000-000000000001', 'Half paid', 'Ordered', 1000, '07220000-0000-0000-0000-0000000000d1', 'USD', 'Labor', null),
  ('07220000-0000-0000-0000-0000000000f2', '07220000-0000-0000-0000-000000000001', 'Taxed', 'Ordered', 1200, '07220000-0000-0000-0000-0000000000d2', 'USD', 'Labor', null),
  ('07220000-0000-0000-0000-0000000000f3', '07220000-0000-0000-0000-000000000001', 'Foreign paid', 'Ordered', 800, '07220000-0000-0000-0000-0000000000d3', 'USD', 'Labor', null),
  ('07220000-0000-0000-0000-0000000000f4', '07220000-0000-0000-0000-000000000001', 'Cancelled paid', 'Cancelled', 300, '07220000-0000-0000-0000-0000000000d4', 'USD', 'Labor', null),
  ('07220000-0000-0000-0000-0000000000f5', '07220000-0000-0000-0000-000000000001', 'Erp link', 'Ordered', 450, '07220000-0000-0000-0000-0000000000d4', 'USD', 'Labor', 'erp_link'),
  ('07220000-0000-0000-0000-0000000000f6', '07220000-0000-0000-0000-000000000001', 'Other currency order', 'Ordered', 90, '07220000-0000-0000-0000-0000000000d5', 'EUR', 'Labor', null),
  ('07220000-0000-0000-0000-0000000000f7', '07220000-0000-0000-0000-000000000002', 'Org B order', 'Ordered', 700, '07220000-0000-0000-0000-0000000000d6', 'USD', 'Labor', null);
insert into public.payments (id, org_id, procurement_id, status, date, amount, currency) values
  ('07220000-0000-0000-0000-0000000000c1', '07220000-0000-0000-0000-000000000001', '07220000-0000-0000-0000-0000000000f1', 'Paid', '2026-10-10', 500, 'USD'),
  ('07220000-0000-0000-0000-0000000000c2', '07220000-0000-0000-0000-000000000001', '07220000-0000-0000-0000-0000000000f2', 'Paid', '2026-10-10', 600, 'USD'),
  ('07220000-0000-0000-0000-0000000000c3', '07220000-0000-0000-0000-000000000001', '07220000-0000-0000-0000-0000000000f3', 'Paid', '2026-10-10', 100, 'EUR'),
  ('07220000-0000-0000-0000-0000000000c4', '07220000-0000-0000-0000-000000000001', '07220000-0000-0000-0000-0000000000f4', 'Paid', '2026-10-10', 300, 'USD'),
  ('07220000-0000-0000-0000-0000000000c5', '07220000-0000-0000-0000-000000000002', '07220000-0000-0000-0000-0000000000f7', 'Paid', '2026-10-10', 70, 'USD');
insert into public.procurement_invoices (id, org_id, procurement_id, status, amount, currency, tax_treatment, tax_amount)
values ('07220000-0000-0000-0000-0000000000b1', '07220000-0000-0000-0000-000000000001', '07220000-0000-0000-0000-0000000000f2', 'Paid', 1200, 'USD', 'inclusive', 200);

-- ── per-project equality (the check is run as each role; a mismatching row in either direction counts) ──────────────
create temp table diffs(who text, n bigint);
grant all on diffs to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"07220000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into diffs select 'fixture finance', count(*) from (
  select pp.project_id, pp.spent, pp.spent_complete, pp.committed, pp.committed_complete from public.project_pmo_positions() pp
  except
  select p.id, s.amount, s.complete, c.amount, c.complete from public.projects p
    left join lateral public.project_pmo_spent_position(p.id) s on true
    left join lateral public.project_pmo_commitment_position(p.id) c on true) a;
insert into diffs select 'fixture finance reverse', count(*) from (
  select p.id, s.amount, s.complete, c.amount, c.complete from public.projects p
    left join lateral public.project_pmo_spent_position(p.id) s on true
    left join lateral public.project_pmo_commitment_position(p.id) c on true
  except
  select pp.project_id, pp.spent, pp.spent_complete, pp.committed, pp.committed_complete from public.project_pmo_positions() pp) a;
select is((select n from diffs where who = 'fixture finance'), 0::bigint, 'AC-PERF-722-01 one-pass positions equal the per-project functions (no extra or different row)');
select is((select n from diffs where who = 'fixture finance reverse'), 0::bigint, 'AC-PERF-722-01 and the per-project functions return no row the one-pass misses');
select is((select spent from public.project_pmo_positions() where project_id = '07220000-0000-0000-0000-0000000000d1'), 500::numeric, 'AC-PERF-722-02 half-paid purchase: 500 spent');
select is((select committed from public.project_pmo_positions() where project_id = '07220000-0000-0000-0000-0000000000d1'), 500::numeric, 'AC-PERF-722-02 half-paid purchase: 500 committed');
select is((select spent from public.project_pmo_positions() where project_id = '07220000-0000-0000-0000-0000000000d2'), 500::numeric, 'AC-PERF-722-02 tax-inclusive invoice: payment scaled to pre-tax (600 * 1000/1200)');
select is((select spent from public.project_pmo_positions() where project_id = '07220000-0000-0000-0000-0000000000d3'), null::numeric, 'AC-PERF-722-02 a payment in another currency leaves spent unknown');
select is((select committed_complete from public.project_pmo_positions() where project_id = '07220000-0000-0000-0000-0000000000d5'), false, 'AC-PERF-722-02 a committed order in another currency leaves commitment incomplete');
select is((select count(*) from public.project_pmo_positions(array['07220000-0000-0000-0000-0000000000d1'::uuid])), 1::bigint, 'AC-PERF-722-03 the id filter returns just the asked project');
select is((select count(*) from public.project_pmo_positions() where project_id = '07220000-0000-0000-0000-0000000000d6'), 0::bigint, 'AC-PERF-722-04 another org''s project is never returned');

-- seed executive, same equality over the seed's whole project list. The seed org reads the ERP ledger (the positions are a
-- PMO-basis figure), so disconnect it for this transaction.
reset role;
update public.external_org_bindings set status = 'disconnected' where status = 'active';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into diffs select 'seed exec', count(*) from (
  (select pp.project_id, pp.spent, pp.spent_complete, pp.committed, pp.committed_complete from public.project_pmo_positions() pp
   except
   select p.id, s.amount, s.complete, c.amount, c.complete from public.projects p
     left join lateral public.project_pmo_spent_position(p.id) s on true
     left join lateral public.project_pmo_commitment_position(p.id) c on true)
  union all
  (select p.id, s.amount, s.complete, c.amount, c.complete from public.projects p
     left join lateral public.project_pmo_spent_position(p.id) s on true
     left join lateral public.project_pmo_commitment_position(p.id) c on true
   except
   select pp.project_id, pp.spent, pp.spent_complete, pp.committed, pp.committed_complete from public.project_pmo_positions() pp)) a;
select is((select n from diffs where who = 'seed exec'), 0::bigint, 'AC-PERF-722-05 seed executive: positions equal the per-project functions on every project');
select cmp_ok((select count(*) from public.project_pmo_positions()), '>', 10::bigint, 'AC-PERF-722-05 the seed comparison is over a real project list');

-- seed project manager: restricted to their projects the way the PM dashboard asks
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
insert into diffs select 'seed pm', count(*) from (
  (select pp.project_id, pp.spent, pp.spent_complete, pp.committed, pp.committed_complete
     from public.project_pmo_positions((select array_agg(x.id) from public.projects x where x.project_manager_id = auth.uid())) pp
   except
   select p.id, s.amount, s.complete, c.amount, c.complete from public.projects p
     left join lateral public.project_pmo_spent_position(p.id) s on true
     left join lateral public.project_pmo_commitment_position(p.id) c on true
    where p.project_manager_id = auth.uid())
  union all
  (select p.id, s.amount, s.complete, c.amount, c.complete from public.projects p
     left join lateral public.project_pmo_spent_position(p.id) s on true
     left join lateral public.project_pmo_commitment_position(p.id) c on true
    where p.project_manager_id = auth.uid()
   except
   select pp.project_id, pp.spent, pp.spent_complete, pp.committed, pp.committed_complete
     from public.project_pmo_positions((select array_agg(x.id) from public.projects x where x.project_manager_id = auth.uid())) pp)) a;
select is((select n from diffs where who = 'seed pm'), 0::bigint, 'AC-PERF-722-06 seed project manager: positions equal the per-project functions on their projects');

-- a role without access reads nothing
set local request.jwt.claims = '{"sub":"07220000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*) from public.project_pmo_positions()), 0::bigint, 'AC-PERF-722-07 an Engineer reads no position, as the per-project functions');

select * from finish();
rollback;
