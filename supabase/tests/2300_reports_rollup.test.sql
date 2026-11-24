begin;
create extension if not exists pgtap;
select plan(19);

insert into organizations (id, name, default_currency, default_timezone, discipline_profit_enabled, built_in_roles_enabled) values
  ('23000000-0000-0000-0000-000000000001', 'Report fixture A', 'USD', 'UTC', true, true),
  ('23000000-0000-0000-0000-000000000002', 'Report fixture B', 'USD', 'UTC', true, true);
insert into auth.users (id, email)
select ('23000000-0000-0000-0000-00000000001' || n)::uuid, 'fixture-' || n || '@example.com'
from generate_series(1, 9) n;
insert into profiles (id, org_id, full_name, email, role, status)
select u.id, ('23000000-0000-0000-0000-00000000000' || case when r.n = 7 then '2' else '1' end)::uuid,
       'Report fixture', u.email, r.role::public.user_role, (case when r.n = 8 then 'disabled' else 'active' end)::public.profile_status
from (values (1,'Finance'), (2,'Admin'), (3,'Executive'), (4,'Project Manager'), (5,'Project Manager'),
             (6,'Engineer'), (7,'Finance'), (8,'Finance'), (9,'Engineer')) r(n,role)
join auth.users u on u.id = ('23000000-0000-0000-0000-00000000001' || r.n)::uuid;
update profiles set built_in_role = 'field_user' where id = '23000000-0000-0000-0000-000000000019';

set local session_replication_role = replica;
insert into projects (id, org_id, name, status, currency, project_manager_id)
select md5('report-project-' || n)::uuid, ('23000000-0000-0000-0000-00000000000' || case when n = 31 then '2' else '1' end)::uuid,
       'Fixture ' || n, (case when n % 3 = 0 then 'On Hold' else 'Ongoing Project' end)::public.project_status, 'USD',
       case when n <= 15 then '23000000-0000-0000-0000-000000000014'::uuid end
from generate_series(1,31) n;
insert into work_orders (id, org_id, project_id, title, status, currency, order_value, tax_treatment, tax_amount)
select md5('report-order-' || n)::uuid, p.org_id, p.id, 'Fixture work order',
       (case when n % 3 = 0 then 'Closed' else 'Issued' end)::public.work_order_status, 'USD', 1000, 'exclusive', 0
from generate_series(1,31) n join projects p on p.id = md5('report-project-' || n)::uuid;
insert into sales_invoices (id, org_id, project_id, work_order_id, si_number, invoice_date, currency, amount, tax_treatment, tax_amount, status)
select md5('report-invoice-' || n)::uuid, w.org_id, w.project_id, w.id, 'FIXTURE-' || n,
       '2026-03-01', case when n % 5 = 0 then 'EUR' else 'USD' end, case when n % 7 <> 0 then 100 + n end, 'exclusive', 0,
       case when n % 3 = 0 then 'Cancelled' else 'Unpaid' end
from generate_series(1,31) n join work_orders w on w.id = md5('report-order-' || n)::uuid;

-- Seed the read's input states directly. The accounting writers have separate tests.
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate)
select md5('report-boq-' || n)::uuid, w.org_id, w.project_id, 'F1', 'Fixture line', 'm', 100, 5
from generate_series(1,30) n join work_orders w on w.id = md5('report-order-' || n)::uuid;
insert into work_order_lines (id, org_id, work_order_id, boq_item_id, quantity)
select md5('report-line-' || n)::uuid, w.org_id, w.id, md5('report-boq-' || n)::uuid, 100
from generate_series(1,30) n join work_orders w on w.id = md5('report-order-' || n)::uuid;
insert into daily_site_reports (id, org_id, project_id, work_order_id, work_date, status, author_id, validated_by, validated_at)
select md5('report-progress-' || n)::uuid, w.org_id, w.project_id, w.id, '2026-03-01',
       'validated', '23000000-0000-0000-0000-000000000016', '23000000-0000-0000-0000-000000000011', now()
from generate_series(1,30) n join work_orders w on w.id = md5('report-order-' || n)::uuid where n % 3 <> 0;
insert into dsr_progress_lines (org_id, report_id, position, work_order_line_id, quantity, unit,
                               frozen_rate, frozen_rate_source, frozen_amount, frozen_at)
select w.org_id, md5('report-progress-' || n)::uuid, 1, md5('report-line-' || n)::uuid, n, 'm',
       case when n % 4 <> 0 then 5 end, case when n % 4 <> 0 then 'contract' end,
       case when n % 4 <> 0 then n * 5 end, now()
from generate_series(1,30) n join work_orders w on w.id = md5('report-order-' || n)::uuid where n % 3 <> 0;
insert into expense_claims (id, org_id, claimant_id, project_id, work_order_id, title, kind, amount, currency, status,
                            claim_number, approved_by_id, approved_at)
select md5('report-cost-' || n)::uuid, w.org_id, '23000000-0000-0000-0000-000000000016', w.project_id, w.id,
       'Fixture cost', 'claim', 20 + n, case when n % 4 = 0 then 'EUR' else 'USD' end,
       'Approved', 'FIXTURE-COST-' || n, '23000000-0000-0000-0000-000000000011', now()
from generate_series(1,30) n join work_orders w on w.id = md5('report-order-' || n)::uuid where n % 3 <> 0;
set local session_replication_role = origin;

create function pg_temp.report_rows() returns table(
  project_id uuid, currency text, earned numeric, unrated_lines integer, work_orders integer,
  work_orders_without_progress integer, billed numeric, cost numeric, comparable boolean, restricted boolean
) language sql stable as $$
  select t.project_id, t.currency, t.earned::numeric, t.unrated_lines, t.work_orders,
    t.work_orders_without_progress, t.billed::numeric, t.cost::numeric, t.comparable, t.restricted
  from jsonb_to_recordset(public.management_pack_project_totals()) as t(
    project_id uuid, currency text, earned text, unrated_lines integer, work_orders integer,
    work_orders_without_progress integer, billed text, cost text, comparable boolean, restricted boolean)
  order by t.project_id, t.currency
$$;

create function pg_temp.legacy_rows() returns table(
  project_id uuid, currency text, earned numeric, unrated_lines integer, work_orders integer,
  work_orders_without_progress integer, billed numeric, cost numeric, comparable boolean, restricted boolean
) language sql stable as $$
  select e.project_id, e.currency, e.earned, e.unrated_lines, e.work_orders, e.work_orders_without_progress,
    case when f.payload is not null then case when b.bucket is null then 0::numeric else (b.bucket->>'work_revenue')::numeric end end,
    case when c.unknown = 0 then coalesce(c.amount, 0) end,
    not c.other_currency, false
  from public.management_pack_earned() e
  cross join lateral (select public.get_project_finances(e.project_id) as payload offset 0) f
  left join lateral (select x as bucket from jsonb_array_elements(f.payload->'invoices') x where x->>'currency' = e.currency) b on true
  cross join lateral (
    select count(*) filter (where coalesce(l.currency,'?') = e.currency and l.reason in ('counted','unassigned','split-when-custom') and l.amount is null) as unknown,
      sum(l.amount::numeric) filter (where coalesce(l.currency,'?') = e.currency and l.reason in ('counted','unassigned','split-when-custom')) as amount,
      coalesce(bool_or(w.id is not null and l.currency is distinct from e.currency and l.reason in ('counted','unresolved-direct')), false) as other_currency
    from public.work_order_cost_amounts(e.project_id) l
    left join public.work_orders w on w.id = l.work_order_id and w.currency = e.currency
  ) c order by e.project_id, e.currency
$$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"23000000-0000-0000-0000-000000000011","role":"authenticated"}';

select is(jsonb_array_length(public.management_pack_project_totals()), 30, 'AC-RR-001 all 30 local report projects');
select results_eq('select * from pg_temp.report_rows()', 'select * from pg_temp.legacy_rows()',
  'AC-RR-001 Finance equality for every project/currency across all financial inputs');

select ok(exists (select 1 from jsonb_array_elements(public.management_pack_project_totals()) r
  where (r->>'earned')::numeric > 0 and (r->>'billed')::numeric > 0 and (r->>'cost')::numeric > 0),
  'AC-RR-001 comparison includes known earned, billed and cost figures');
select ok(exists (select 1 from jsonb_array_elements(public.management_pack_project_totals()) r
  where not (r->>'comparable')::boolean), 'AC-RR-001 comparison includes costs in another currency');
select ok(exists (select 1 from pg_temp.report_rows() r where r.billed is null),
  'AC-RR-001 a missing billed amount remains unavailable');


set local request.jwt.claims = '{"sub":"23000000-0000-0000-0000-000000000012","role":"authenticated"}';
select is(jsonb_array_length(public.management_pack_project_totals()), 30, 'AC-RR-002 Admin');
select results_eq('select * from pg_temp.report_rows()', 'select * from pg_temp.legacy_rows()',
  'AC-RR-002 Admin sees the same projects and financial inputs');
set local request.jwt.claims = '{"sub":"23000000-0000-0000-0000-000000000013","role":"authenticated"}';
select is(jsonb_array_length(public.management_pack_project_totals()), 30, 'AC-RR-002 Executive');
select results_eq('select * from pg_temp.report_rows()', 'select * from pg_temp.legacy_rows()',
  'AC-RR-002 Executive sees the same projects and financial inputs');
set local request.jwt.claims = '{"sub":"23000000-0000-0000-0000-000000000014","role":"authenticated"}';
select is(jsonb_array_length(public.management_pack_project_totals()), 15, 'AC-RR-002 assigned Project Manager');
select results_eq('select * from pg_temp.report_rows()', 'select * from pg_temp.legacy_rows()',
  'AC-RR-002 assigned Project Manager sees the same projects and financial inputs');
set local request.jwt.claims = '{"sub":"23000000-0000-0000-0000-000000000015","role":"authenticated"}';
select is(jsonb_array_length(public.management_pack_project_totals()), 0, 'AC-RR-002 unassigned Project Manager');
set local request.jwt.claims = '{"sub":"23000000-0000-0000-0000-000000000016","role":"authenticated"}';
select is(jsonb_array_length(public.management_pack_project_totals()), 0, 'AC-RR-002 Engineer');
set local request.jwt.claims = '{"sub":"23000000-0000-0000-0000-000000000017","role":"authenticated"}';
select is(jsonb_array_length(public.management_pack_project_totals()), 1, 'AC-RR-002 Finance in the other organisation');
select results_eq('select * from pg_temp.report_rows()', 'select * from pg_temp.legacy_rows()',
  'AC-RR-002 Finance in the other organisation sees the same projects and financial inputs');
set local request.jwt.claims = '{"sub":"23000000-0000-0000-0000-000000000018","role":"authenticated"}';
select throws_ok($$select public.management_pack_project_totals()$$, '42501', null, 'AC-RR-002 inactive member');
set local request.jwt.claims = '{"sub":"23000000-0000-0000-0000-000000000019","role":"authenticated"}';
select throws_ok($$select public.management_pack_project_totals()$$, '42501', null, 'AC-RR-002 field account');
set local role anon;
select throws_ok($$select public.management_pack_project_totals()$$, '42501', null, 'AC-RR-002 anonymous call forbidden');
reset role;
update organizations set discipline_profit_enabled = false where id = '23000000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"23000000-0000-0000-0000-000000000011","role":"authenticated"}';
select is(jsonb_array_length(public.management_pack_project_totals()), 0, 'AC-RR-002 setting disabled');

select * from finish();
rollback;
