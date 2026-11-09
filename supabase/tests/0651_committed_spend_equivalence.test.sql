-- 0651_committed_spend_equivalence.test.sql — the set-based project_committed_spend returns exactly what the 0373
-- row-by-row body returns, for every basis and caller. The old body lives here as a test-only function.
begin;
select plan(27);

create function pg_temp.old_project_committed_spend(p_project_id uuid)
returns table (currency text, amount numeric, is_project_currency boolean)
language sql stable security invoker set search_path = public, pg_catalog as $$
  with proj as (
    select pr.id, pr.currency from public.projects pr where pr.id = p_project_id
  ), positions as (
    select p.currency, sum(public.procurement_open_commitment(p)) as amount
      from public.procurements p join proj on p.project_id = proj.id
     where p.status::text = any (public.committed_procurement_statuses())
     group by p.currency
  )
  select proj.currency, coalesce(pos.amount, 0)::numeric, true
    from proj left join positions pos on pos.currency = proj.currency
  union all
  select pos.currency, pos.amount, false
    from positions pos cross join proj
   where pos.currency is distinct from proj.currency and pos.amount <> 0
  order by 3 desc, 1
$$;
grant execute on function pg_temp.old_project_committed_spend(uuid) to authenticated;

-- Org A (PMO basis), org E (ERP ledger basis), org B (another org).
insert into organizations (id, name, default_currency) values
  ('06510000-0000-0000-0000-0000000000a0','CSE A','IDR'), ('06510000-0000-0000-0000-0000000000e0','CSE E','IDR'),
  ('06510000-0000-0000-0000-0000000000b0','CSE B','IDR');
insert into auth.users (id, email) values
  ('06510000-0000-0000-0000-0000000000a1','cse-a-fin@example.test'), ('06510000-0000-0000-0000-0000000000a2','cse-a-eng@example.test'),
  ('06510000-0000-0000-0000-0000000000e1','cse-e-fin@example.test'), ('06510000-0000-0000-0000-0000000000e2','cse-e-eng@example.test'),
  ('06510000-0000-0000-0000-0000000000b1','cse-b-fin@example.test');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('06510000-0000-0000-0000-0000000000a1','06510000-0000-0000-0000-0000000000a0','A Fin','cse-a-fin@example.test','Finance','active'),
  ('06510000-0000-0000-0000-0000000000a2','06510000-0000-0000-0000-0000000000a0','A Eng','cse-a-eng@example.test','Engineer','active'),
  ('06510000-0000-0000-0000-0000000000e1','06510000-0000-0000-0000-0000000000e0','E Fin','cse-e-fin@example.test','Finance','active'),
  ('06510000-0000-0000-0000-0000000000e2','06510000-0000-0000-0000-0000000000e0','E Eng','cse-e-eng@example.test','Engineer','active'),
  ('06510000-0000-0000-0000-0000000000b1','06510000-0000-0000-0000-0000000000b0','B Fin','cse-b-fin@example.test','Finance','active');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, connected_by, connected_at)
values ('06510000-0000-0000-0000-0000000000e0','erpnext','https://erp.example.test','ref','active','06510000-0000-0000-0000-0000000000e1', now());
insert into projects (id, org_id, name, status, currency) values
  ('06510000-0000-0000-0000-0000000000d1','06510000-0000-0000-0000-0000000000a0','A mixed','Ongoing Project','IDR'),
  ('06510000-0000-0000-0000-0000000000d2','06510000-0000-0000-0000-0000000000a0','A empty','Ongoing Project','IDR'),
  ('06510000-0000-0000-0000-0000000000d3','06510000-0000-0000-0000-0000000000e0','E mixed','Ongoing Project','IDR');

-- Org A project d1: f1..f12 (a1 = Finance requester; a2 = Engineer requester on f9..f12).
insert into procurements (id, org_id, title, requested_by_id, project_id, currency, total_value, status, origin) values
  -- no children
  ('06510000-0000-0000-0000-0000000001f1','06510000-0000-0000-0000-0000000000a0','plain ordered','06510000-0000-0000-0000-0000000000a1','06510000-0000-0000-0000-0000000000d1','IDR',1000,'Ordered',null),
  -- paid, inclusive invoice, one payment
  ('06510000-0000-0000-0000-0000000001f2','06510000-0000-0000-0000-0000000000a0','paid inclusive','06510000-0000-0000-0000-0000000000a1','06510000-0000-0000-0000-0000000000d1','IDR',1000,'Paid',null),
  -- paid, exclusive invoice with tax and withholding: pre-tax scaling
  ('06510000-0000-0000-0000-0000000001f3','06510000-0000-0000-0000-0000000000a0','paid exclusive','06510000-0000-0000-0000-0000000000a1','06510000-0000-0000-0000-0000000000d1','IDR',2000,'Paid',null),
  -- paid-pre-tax null: payment in another currency than the purchase
  ('06510000-0000-0000-0000-0000000001f4','06510000-0000-0000-0000-0000000000a0','paid wrong currency','06510000-0000-0000-0000-0000000000a1','06510000-0000-0000-0000-0000000000d1','IDR',700,'Paid',null),
  -- multiple children: 2 payments x 3 invoices must not multiply
  ('06510000-0000-0000-0000-0000000001f5','06510000-0000-0000-0000-0000000000a0','multi children','06510000-0000-0000-0000-0000000000a1','06510000-0000-0000-0000-0000000000d1','IDR',5000,'Paid',null),
  -- linked origin ignores payments
  ('06510000-0000-0000-0000-0000000001f6','06510000-0000-0000-0000-0000000000a0','erp-linked','06510000-0000-0000-0000-0000000000a1','06510000-0000-0000-0000-0000000000d1','IDR',900,'Paid','erp_link'),
  -- USD, with a cancelled payment (erp_docstatus 2 does not count) and an overpayment
  ('06510000-0000-0000-0000-0000000001f7','06510000-0000-0000-0000-0000000000a0','usd paid','06510000-0000-0000-0000-0000000000a1','06510000-0000-0000-0000-0000000000d1','USD',100,'Paid',null),
  ('06510000-0000-0000-0000-0000000001f8','06510000-0000-0000-0000-0000000000a0','usd ordered','06510000-0000-0000-0000-0000000000a1','06510000-0000-0000-0000-0000000000d1','USD',40,'Received',null),
  -- Engineer-requested
  ('06510000-0000-0000-0000-0000000001f9','06510000-0000-0000-0000-0000000000a0','eng ordered','06510000-0000-0000-0000-0000000000a2','06510000-0000-0000-0000-0000000000d1','IDR',300,'Ordered',null),
  ('06510000-0000-0000-0000-0000000001fa','06510000-0000-0000-0000-0000000000a0','eng paid','06510000-0000-0000-0000-0000000000a2','06510000-0000-0000-0000-0000000000d1','IDR',400,'Paid',null),
  -- not committed: cancelled, rejected never count (they keep their status through the filter and are zeroed)
  ('06510000-0000-0000-0000-0000000001fb','06510000-0000-0000-0000-0000000000a0','cancelled','06510000-0000-0000-0000-0000000000a1','06510000-0000-0000-0000-0000000000d1','IDR',777,'Cancelled',null),
  ('06510000-0000-0000-0000-0000000001fc','06510000-0000-0000-0000-0000000000a0','rejected','06510000-0000-0000-0000-0000000000a1','06510000-0000-0000-0000-0000000000d1','EUR',555,'Rejected',null),
  -- one row for EVERY status committed_procurement_statuses() leaves out: dropping the status filter in the body
  -- makes each of these fall through to the "no payments yet" branch and count its whole total, so the equivalence
  -- and pinned-figure tests below go RED. Distinct amounts (and both currencies) make that visible in the diff.
  ('06510000-0000-0000-0000-000000000201','06510000-0000-0000-0000-0000000000a0','draft','06510000-0000-0000-0000-0000000000a1','06510000-0000-0000-0000-0000000000d1','IDR',111.11,'Draft',null),
  ('06510000-0000-0000-0000-000000000202','06510000-0000-0000-0000-0000000000a0','requested','06510000-0000-0000-0000-0000000000a2','06510000-0000-0000-0000-0000000000d1','IDR',222.22,'Requested',null),
  ('06510000-0000-0000-0000-000000000203','06510000-0000-0000-0000-0000000000a0','approved','06510000-0000-0000-0000-0000000000a1','06510000-0000-0000-0000-0000000000d1','USD',33.33,'Approved',null),
  ('06510000-0000-0000-0000-000000000204','06510000-0000-0000-0000-0000000000a0','vendor quoted','06510000-0000-0000-0000-0000000000a1','06510000-0000-0000-0000-0000000000d1','IDR',444.44,'Vendor Quoted',null),
  ('06510000-0000-0000-0000-000000000205','06510000-0000-0000-0000-0000000000a0','quote selected','06510000-0000-0000-0000-0000000000a2','06510000-0000-0000-0000-0000000000d1','USD',55.55,'Quote Selected',null);
insert into procurement_invoices (org_id, procurement_id, status, amount, currency, tax_treatment, tax_amount, withheld_amount) values
  ('06510000-0000-0000-0000-0000000000a0','06510000-0000-0000-0000-0000000001f2','Paid',1000,'IDR','inclusive',0,0),
  ('06510000-0000-0000-0000-0000000000a0','06510000-0000-0000-0000-0000000001f3','Paid',1000,'IDR','exclusive',110,20),
  ('06510000-0000-0000-0000-0000000000a0','06510000-0000-0000-0000-0000000001f3','Paid',500,'IDR','inclusive',50,0),
  ('06510000-0000-0000-0000-0000000000a0','06510000-0000-0000-0000-0000000001f5','Paid',1000,'IDR','inclusive',100,0),
  ('06510000-0000-0000-0000-0000000000a0','06510000-0000-0000-0000-0000000001f5','Paid',2000,'IDR','exclusive',200,50),
  ('06510000-0000-0000-0000-0000000000a0','06510000-0000-0000-0000-0000000001f5','Paid',1500,'IDR','inclusive',0,0),
  ('06510000-0000-0000-0000-0000000000a0','06510000-0000-0000-0000-0000000001fa','Paid',400,'IDR','inclusive',0,0);
insert into payments (org_id, procurement_id, status, amount, currency, date, erp_docstatus) values
  ('06510000-0000-0000-0000-0000000000a0','06510000-0000-0000-0000-0000000001f2','Paid',600,'IDR',current_date,null),
  ('06510000-0000-0000-0000-0000000000a0','06510000-0000-0000-0000-0000000001f3','Paid',1100,'IDR',current_date,null),
  ('06510000-0000-0000-0000-0000000000a0','06510000-0000-0000-0000-0000000001f4','Paid',100,'USD',current_date,null),
  ('06510000-0000-0000-0000-0000000000a0','06510000-0000-0000-0000-0000000001f5','Paid',1000,'IDR',current_date,null),
  ('06510000-0000-0000-0000-0000000000a0','06510000-0000-0000-0000-0000000001f5','Paid',2000,'IDR',current_date,null),
  ('06510000-0000-0000-0000-0000000000a0','06510000-0000-0000-0000-0000000001f6','Paid',900,'IDR',current_date,null),
  ('06510000-0000-0000-0000-0000000000a0','06510000-0000-0000-0000-0000000001f7','Paid',30,'USD',current_date,null),
  ('06510000-0000-0000-0000-0000000000a0','06510000-0000-0000-0000-0000000001f7','Paid',60,'USD',current_date,2),
  ('06510000-0000-0000-0000-0000000000a0','06510000-0000-0000-0000-0000000001fa','Paid',400,'IDR',current_date,null);

-- Org E project d3 (ledger basis): ledger-held = ERP purchase invoices on links + ERP-confirmed PMO invoices.
insert into procurements (id, org_id, title, requested_by_id, project_id, currency, total_value, status, origin) values
  ('06510000-0000-0000-0000-0000000002f1','06510000-0000-0000-0000-0000000000e0','e plain','06510000-0000-0000-0000-0000000000e1','06510000-0000-0000-0000-0000000000d3','IDR',1000,'Ordered',null),
  ('06510000-0000-0000-0000-0000000002f2','06510000-0000-0000-0000-0000000000e0','e linked doc','06510000-0000-0000-0000-0000000000e1','06510000-0000-0000-0000-0000000000d3','IDR',1000,'Paid','erp_link'),
  ('06510000-0000-0000-0000-0000000002f3','06510000-0000-0000-0000-0000000000e0','e confirmed invoices','06510000-0000-0000-0000-0000000000e1','06510000-0000-0000-0000-0000000000d3','IDR',3000,'Vendor Invoiced',null),
  ('06510000-0000-0000-0000-0000000002f4','06510000-0000-0000-0000-0000000000e0','e overheld','06510000-0000-0000-0000-0000000000e1','06510000-0000-0000-0000-0000000000d3','USD',50,'Paid',null),
  ('06510000-0000-0000-0000-0000000002f5','06510000-0000-0000-0000-0000000000e0','e eng','06510000-0000-0000-0000-0000000000e2','06510000-0000-0000-0000-0000000000d3','IDR',800,'Ordered',null),
  ('06510000-0000-0000-0000-0000000002f6','06510000-0000-0000-0000-0000000000e0','e eng invoiced','06510000-0000-0000-0000-0000000000e2','06510000-0000-0000-0000-0000000000d3','IDR',900,'Vendor Invoiced',null);
insert into erp_purchase_documents (id, org_id, erp_doctype, erp_name, erp_docstatus, erp_modified, grand_total, net_total) values
  ('06510000-0000-0000-0000-0000000003d1','06510000-0000-0000-0000-0000000000e0','Purchase Invoice','PINV-1',1,'m1',600,550),
  ('06510000-0000-0000-0000-0000000003d2','06510000-0000-0000-0000-0000000000e0','Purchase Invoice','PINV-2',1,'m1',200,null),
  ('06510000-0000-0000-0000-0000000003d3','06510000-0000-0000-0000-0000000000e0','Purchase Invoice','PINV-3',2,'m1',999,999);
insert into procurement_erp_links (org_id, procurement_id, erp_purchase_document_id) values
  ('06510000-0000-0000-0000-0000000000e0','06510000-0000-0000-0000-0000000002f2','06510000-0000-0000-0000-0000000003d1'),
  ('06510000-0000-0000-0000-0000000000e0','06510000-0000-0000-0000-0000000002f3','06510000-0000-0000-0000-0000000003d2'),
  ('06510000-0000-0000-0000-0000000000e0','06510000-0000-0000-0000-0000000002f3','06510000-0000-0000-0000-0000000003d3');
insert into procurement_invoices (org_id, procurement_id, status, amount, currency, tax_treatment, tax_amount, erp_docstatus) values
  ('06510000-0000-0000-0000-0000000000e0','06510000-0000-0000-0000-0000000002f3','Paid',1000,'IDR','inclusive',100,1),
  ('06510000-0000-0000-0000-0000000000e0','06510000-0000-0000-0000-0000000002f3','Paid',500,'IDR','exclusive',50,1),
  ('06510000-0000-0000-0000-0000000000e0','06510000-0000-0000-0000-0000000002f3','Paid',700,'IDR','inclusive',0,0),
  ('06510000-0000-0000-0000-0000000000e0','06510000-0000-0000-0000-0000000002f4','Paid',80,'USD','inclusive',0,1),
  ('06510000-0000-0000-0000-0000000000e0','06510000-0000-0000-0000-0000000002f6','Paid',900,'IDR','inclusive',0,1);
insert into payments (org_id, procurement_id, status, amount, currency, date) values
  ('06510000-0000-0000-0000-0000000000e0','06510000-0000-0000-0000-0000000002f1','Paid',400,'IDR',current_date);

-- 0723: every fixture purchase id, read as the owner (RLS bypassed), so each caller below is handed ids it can and cannot see.
create function pg_temp.all_ids() returns uuid[] language sql security definer as $$
  select array_agg(id order by id) from public.procurements where id::text like '06510000-%'
$$;
grant execute on function pg_temp.all_ids() to authenticated;
create function pg_temp.same_commitments(p_uid uuid) returns text language sql as $$
  select results_eq(
    $q$ select p.id, public.procurement_open_commitment(p) from public.procurements p where p.id = any (pg_temp.all_ids()) order by 1 $q$,
    $q$ select procurement_id, amount from public.procurement_open_commitments(pg_temp.all_ids()) order by 1 $q$,
    '0723 open_commitments: same figure per purchase as the per-row function, as ' || p_uid)
$$;

create function pg_temp.same(p_uid uuid, p_project uuid) returns text language sql as $$
  select results_eq(
    format('select * from pg_temp.old_project_committed_spend(%L)', p_project),
    format('select * from public.project_committed_spend(%L)', p_project),
    'same rows as 0373 for ' || p_project || ' as ' || p_uid)
$$;

set local role authenticated;

set local request.jwt.claims = '{"sub":"06510000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select pg_temp.same_commitments('06510000-0000-0000-0000-0000000000a1');
select results_eq($$ select procurement_id, amount from public.procurement_open_commitments(array['06510000-0000-0000-0000-0000000001f3','06510000-0000-0000-0000-0000000001f5','06510000-0000-0000-0000-0000000001f4']::uuid[]) order by 1 $$,
  $$ select id, public.procurement_open_commitment(p) from public.procurements p where id in ('06510000-0000-0000-0000-0000000001f3','06510000-0000-0000-0000-0000000001f5','06510000-0000-0000-0000-0000000001f4') order by 1 $$,
  '0723 open_commitments: paid-pre-tax scaling, multi children and a wrong-currency payment match the per-row function');
select pg_temp.same('06510000-0000-0000-0000-0000000000a1','06510000-0000-0000-0000-0000000000d1');
select pg_temp.same('06510000-0000-0000-0000-0000000000a1','06510000-0000-0000-0000-0000000000d2');
select pg_temp.same('06510000-0000-0000-0000-0000000000a1','06510000-0000-0000-0000-0000000000d3');
select results_eq($$ select currency, amount, is_project_currency from project_committed_spend('06510000-0000-0000-0000-0000000000d1') $$,
  $$ values ('IDR'::text, 6458.15::numeric, true), ('USD'::text, 110::numeric, false) $$,
  'PMO basis: pinned figures (paid-pre-tax scaling, null on bad currency, children not multiplied, linked origin whole)');
-- procurement_ledger_held_many is client-callable: it answers one held row per purchase the caller can see, and the
-- answer must be exactly what 0372's per-id helper gives — never more, whatever ids are passed.
select is((select count(*) from public.procurement_ledger_held_many(array[
          '06510000-0000-0000-0000-0000000001f1','06510000-0000-0000-0000-0000000001f2',
          '06510000-0000-0000-0000-0000000001f3','06510000-0000-0000-0000-0000000001f4',
          '06510000-0000-0000-0000-0000000001f5','06510000-0000-0000-0000-0000000001f6']::uuid[])), 6::bigint,
  'held_many: a Finance member gets one held row per purchase they can see');

set local request.jwt.claims = '{"sub":"06510000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select pg_temp.same_commitments('06510000-0000-0000-0000-0000000000a2');
select pg_temp.same('06510000-0000-0000-0000-0000000000a2','06510000-0000-0000-0000-0000000000d1');
select is((select count(*) from public.procurement_ledger_held_many(array[
          '06510000-0000-0000-0000-0000000001f1','06510000-0000-0000-0000-0000000001f2',
          '06510000-0000-0000-0000-0000000001f3','06510000-0000-0000-0000-0000000001f5',
          '06510000-0000-0000-0000-0000000001f6','06510000-0000-0000-0000-0000000001f7']::uuid[])), 0::bigint,
  'held_many: an Engineer gets no held row for purchases they cannot see');
select is((select coalesce(sum(held), 0) from public.procurement_ledger_held_many(array[
          '06510000-0000-0000-0000-0000000001f1','06510000-0000-0000-0000-0000000001f2']::uuid[])),
          (select coalesce(sum(public.procurement_ledger_held(t.id)), 0)
             from unnest(array['06510000-0000-0000-0000-0000000001f1','06510000-0000-0000-0000-0000000001f2']::uuid[]) t(id)),
  'held_many: an Engineer gets exactly 0372''s per-id answer (nothing) for hidden purchases');
select is((select count(*) from public.procurement_ledger_held_many(array[
          '06510000-0000-0000-0000-0000000001f9','06510000-0000-0000-0000-0000000001fa']::uuid[])), 0::bigint,
  'held_many: an Engineer gets no held row even for their own purchases (invoice money is for the money roles)');

set local request.jwt.claims = '{"sub":"06510000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select pg_temp.same_commitments('06510000-0000-0000-0000-0000000000e1');
select results_eq($$ select amount from public.procurement_open_commitments(array['06510000-0000-0000-0000-0000000002f3']::uuid[]) $$, $$ values (1400::numeric) $$, '0723 open_commitments: ERP basis pinned (3000 total less 1600 held in the ledger)');
select pg_temp.same('06510000-0000-0000-0000-0000000000e1','06510000-0000-0000-0000-0000000000d3');
select results_eq($$ select currency, amount, is_project_currency from project_committed_spend('06510000-0000-0000-0000-0000000000d3') $$,
  $$ values ('IDR'::text, 3650::numeric, true) $$,
  'ERP basis: pinned figures (ledger-held subtracted, floored at 0)');
select results_eq(
  $$ select procurement_id, held from public.procurement_ledger_held_many(array[
       '06510000-0000-0000-0000-0000000002f1','06510000-0000-0000-0000-0000000002f2',
       '06510000-0000-0000-0000-0000000002f3','06510000-0000-0000-0000-0000000002f4',
       '06510000-0000-0000-0000-0000000002f5','06510000-0000-0000-0000-0000000002f6']::uuid[]) order by 1 $$,
  $$ select t.id, public.procurement_ledger_held(t.id) from unnest(array[
       '06510000-0000-0000-0000-0000000002f1','06510000-0000-0000-0000-0000000002f2',
       '06510000-0000-0000-0000-0000000002f3','06510000-0000-0000-0000-0000000002f4',
       '06510000-0000-0000-0000-0000000002f5','06510000-0000-0000-0000-0000000002f6']::uuid[]) t(id) order by 1 $$,
  'held_many: a Finance member''s set answer is exactly 0372''s per-id answer, purchase by purchase');

set local request.jwt.claims = '{"sub":"06510000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select pg_temp.same_commitments('06510000-0000-0000-0000-0000000000e2');
select pg_temp.same('06510000-0000-0000-0000-0000000000e2','06510000-0000-0000-0000-0000000000d3');

set local request.jwt.claims = '{"sub":"06510000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select pg_temp.same_commitments('06510000-0000-0000-0000-0000000000b1');
select is((select count(*) from public.procurement_open_commitments(pg_temp.all_ids())), 0::bigint, '0723 open_commitments: another org is handed every id and gets no row');
select pg_temp.same('06510000-0000-0000-0000-0000000000b1','06510000-0000-0000-0000-0000000000d1');
select is((select count(*) from project_committed_spend('06510000-0000-0000-0000-0000000000d1')), 0::bigint,
  'another org reads no positions');
select pg_temp.same('06510000-0000-0000-0000-0000000000b1','06510000-0000-0000-0000-0000000000d3');
select is((select count(*) from public.procurement_ledger_held_many(array[
          '06510000-0000-0000-0000-0000000001f1','06510000-0000-0000-0000-0000000001f2',
          '06510000-0000-0000-0000-0000000001f6','06510000-0000-0000-0000-0000000002f2',
          '06510000-0000-0000-0000-0000000002f3']::uuid[])), 0::bigint,
  'held_many: another org''s Finance member gets no held row (the role passes, the org guard refuses)');
select is((select coalesce(sum(held), 0) from public.procurement_ledger_held_many(array[
          '06510000-0000-0000-0000-0000000001f2','06510000-0000-0000-0000-0000000002f3']::uuid[])),
          (select coalesce(sum(public.procurement_ledger_held(t.id)), 0)
             from unnest(array['06510000-0000-0000-0000-0000000001f2','06510000-0000-0000-0000-0000000002f3']::uuid[]) t(id)),
  'held_many: another org gets exactly 0372''s per-id answer (nothing) for another org''s purchases');

reset role;
select ok(not has_function_privilege('anon','public.project_committed_spend(uuid)','execute')
      and not has_function_privilege('anon','public.procurement_ledger_held_many(uuid[])','execute')
      and has_function_privilege('authenticated','public.project_committed_spend(uuid)','execute')
      and not has_function_privilege('anon','public.procurement_open_commitments(uuid[])','execute')
      and has_function_privilege('authenticated','public.procurement_open_commitments(uuid[])','execute'),
  'grants: signed-in only, anon none');

select * from finish();
rollback;
