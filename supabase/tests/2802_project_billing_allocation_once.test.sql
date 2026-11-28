-- 2802_project_billing_allocation_once.test.sql — the billing read and the line-earned read return exactly what their
-- previous bodies returned, for every calling role and for a second organisation; their grants, security mode and
-- search path are unchanged. The previous bodies are created under temporary names inside this transaction.
begin;
select plan(70);
-- previous bodies (verbatim from the head before 2802), under temporary names
CREATE OR REPLACE FUNCTION public.zz_old_project_line_earned(p_project_id uuid, p_as_at date DEFAULT NULL::date)
 RETURNS TABLE(boq_item_id uuid, earned_quantity numeric, rate numeric, earned_value numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with tz as (
 select coalesce((select o.default_timezone from public.organizations o where o.id=public.auth_org_id()),'UTC') name
), lim as (
 select case when p_as_at is null then null::timestamptz
   else ((date_trunc('month',p_as_at)+interval '1 month')::date)::timestamp at time zone tz.name end ts,
  coalesce(date_trunc('month',p_as_at)::date,public.org_current_month(tz.name,now())) month_at
 from tz
), latest as (
 select e.id from public.project_progress_entries e,lim where e.project_id=p_project_id and e.month<=lim.month_at order by e.month desc limit 1
), assessed as (select q.boq_item_id,q.quantity_to_date from public.progress_assessment_quantities q join latest l on l.id=q.entry_id),
latest_bast as (
 select distinct on (a.work_order_id) a.work_order_id,a.id,a.is_final
 from public.work_order_acceptances a,lim where a.project_id=p_project_id and a.status='Confirmed' and (lim.ts is null or a.confirmed_at<lim.ts)
 order by a.work_order_id,a.confirmed_at desc,a.id desc
), allocation as (
 select wl.boq_item_id,wl.work_order_id,wl.quantity,wo.status,wo.closing_acceptance_id,
   al.quantity accepted,coalesce(lb.is_final,false) final
 from public.work_order_lines wl join public.work_orders wo on wo.id=wl.work_order_id
 left join latest_bast lb on lb.work_order_id=wl.work_order_id
 left join public.work_order_acceptance_lines al on al.acceptance_id=lb.id and al.boq_item_id=wl.boq_item_id
 where wl.org_id=public.auth_org_id() and wo.project_id=p_project_id and wo.status<>'Cancelled'
), agg as (
 select b.id,b.rate,b.quantity contract_quantity,a.quantity_to_date assessed_quantity,
  coalesce((select sum(x.accepted) from allocation x where x.boq_item_id=b.id and x.final and x.status='Closed'),0) closed_final,
  coalesce((select sum(x.quantity) from allocation x,lim where x.boq_item_id=b.id and x.status='Closed' and x.closing_acceptance_id is not null and (lim.ts is null or x.final)),0) closed_ordered
 from public.boq_items b left join assessed a on a.boq_item_id=b.id where b.project_id=p_project_id
)
select g.id,g.earned_quantity,g.rate,round(g.earned_quantity*g.rate,2) from (
 select agg.*,agg.closed_final+least(greatest(coalesce(agg.assessed_quantity,0)-agg.closed_ordered,0),greatest(agg.contract_quantity-agg.closed_final,0)) earned_quantity from agg) g
$function$;
CREATE OR REPLACE FUNCTION public.zz_old_get_project_billing(p_project_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
with p as (
 select pr.id,pr.org_id,pr.currency,case when pr.tax_treatment='inclusive' then pr.contract_value-coalesce(pr.tax_amount,0) else pr.contract_value end contract_net
 from public.projects pr where pr.id=p_project_id
   and (public.money_read_is_internal() or public.project_money_in_scope(pr.id))   -- mut:pm_scope_billing
), counted as (
 select w.is_down_payment,w.net,w.recovery from public.sales_invoice_work_billed w join p on p.id=w.project_id
 where w.status in ('Submitted','Unpaid','Paid') and w.net is not null and w.currency=p.currency
 union all
 select false,ob.claimed_amount,0 from public.opening_balances ob join public.work_orders wo on wo.id=ob.work_order_id join p on p.id=wo.project_id
 where ob.kind='work_order' and ob.reversed_at is null and ob.currency=p.currency
), claims as (
 select pc.id,pc.kind,pc.gross_amount,pc.dp_recovery_amount,pc.work_order_id,si.status
 from public.progress_claims pc left join public.sales_invoices si on si.id=pc.id and si.org_id=pc.org_id
 where pc.project_id=p_project_id and pc.withdrawn_at is null and si.status is distinct from 'Cancelled'
), opening_claimed as (
 select ob.work_order_id,x.boq_item_id,x.claimed_quantity claimed from public.opening_balance_lines x join public.opening_balances ob on ob.id=x.opening_id
 join public.work_orders wo on wo.id=ob.work_order_id where wo.project_id=p_project_id and ob.reversed_at is null and x.claimed_quantity>0
), claimed_line as (
 select boq_item_id,sum(claimed) claimed from (
  select l.boq_item_id,l.quantity claimed from public.progress_claim_lines l join claims c on c.id=l.claim_id
  union all select boq_item_id,claimed from opening_claimed) u group by boq_item_id
), claimed_alloc as (
 select boq_item_id,work_order_id,sum(claimed) claimed from (
  select l.boq_item_id,c.work_order_id,l.quantity claimed from public.progress_claim_lines l join claims c on c.id=l.claim_id where c.work_order_id is not null
  union all select boq_item_id,work_order_id,claimed from opening_claimed) u group by boq_item_id,work_order_id
), latest as (
 select e.id,e.month,e.pct_complete from public.project_progress_entries e where e.project_id=p_project_id
 and e.month<=public.org_current_month((select o.default_timezone from public.organizations o where o.id=public.auth_org_id()),now()) order by e.month desc limit 1
), assessed as (select q.boq_item_id,q.quantity_to_date from public.progress_assessment_quantities q join latest l on l.id=q.entry_id),
latest_bast as (
 select distinct on (a.work_order_id) a.work_order_id,a.id,a.is_final
 from public.work_order_acceptances a where a.project_id=p_project_id and a.status='Confirmed'
 order by a.work_order_id,a.confirmed_at desc,a.id desc
), allocation as (
 select wl.boq_item_id,wl.work_order_id,wl.quantity,wo.status,
   coalesce(ca.claimed,0) claimed,al.quantity accepted,coalesce(lb.is_final,false) final
 from public.work_order_lines wl join public.work_orders wo on wo.id=wl.work_order_id
 left join claimed_alloc ca on ca.boq_item_id=wl.boq_item_id and ca.work_order_id=wl.work_order_id
 left join latest_bast lb on lb.work_order_id=wl.work_order_id
 left join public.work_order_acceptance_lines al on al.acceptance_id=lb.id and al.boq_item_id=wl.boq_item_id
 where wl.org_id=public.auth_org_id() and wo.project_id=p_project_id and wo.status<>'Cancelled'
), agg as (
 select b.id,b.earning_basis,b.line_no,b.created_at,b.quantity contract_quantity,b.rate,
  coalesce((select sum(a.quantity) from allocation a where a.boq_item_id=b.id and a.status in ('Issued','Closed')),0) ordered_quantity,
  coalesce((select sum(a.quantity) from allocation a where a.boq_item_id=b.id and a.status='Issued'),0) issued_ordered,
  coalesce((select sum(a.accepted) from allocation a where a.boq_item_id=b.id and a.final and a.status='Closed'),0) closed_final,
  coalesce((select sum(a.accepted) from allocation a where a.boq_item_id=b.id and a.accepted is not null),0) accepted_quantity,
  coalesce(cl.claimed,0) claimed_quantity,a.quantity_to_date assessed_quantity,
  coalesce((select jsonb_agg(jsonb_build_object('work_order_id',x.work_order_id,'boq_item_id',x.boq_item_id,'quantity',x.quantity,'claimed_quantity',x.claimed,'accepted_quantity',x.accepted,'final',x.final) order by x.work_order_id)
    from allocation x where x.boq_item_id=b.id),'[]'::jsonb) allocations
 from public.boq_items b left join claimed_line cl on cl.boq_item_id=b.id left join assessed a on a.boq_item_id=b.id where b.project_id=p_project_id
), earned as (select * from public.zz_old_project_line_earned(p_project_id)), lines as (
 select a.*,coalesce(e.earned_quantity,0) earned_quantity,
  a.contract_quantity-a.issued_ordered-a.closed_final contract_balance
 from agg a left join earned e on e.boq_item_id=a.id
)
select jsonb_build_object(
 'currency',p.currency,'contract_net',p.contract_net,
 'work_billed',coalesce((select sum(net+recovery) from counted where not is_down_payment),0),
 'dp_billed',coalesce((select sum(net) from counted where is_down_payment),0),
 'dp_recovered',coalesce((select sum(recovery) from counted where not is_down_payment),0),
 'not_submitted',coalesce((select sum(gross_amount-dp_recovery_amount) from claims where status is null or status='Draft'),0),
 'assessment',(select jsonb_build_object('month',l.month,'pct_complete',l.pct_complete) from latest l),
 'earned_value',coalesce((select sum(earned_value) from earned),0),
 'boq',coalesce((select jsonb_agg(jsonb_build_object('boq_item_id',id,'claimed_quantity',claimed_quantity,'assessed_quantity',assessed_quantity,
   'earning_basis',earning_basis,'line_no',line_no,'ordered_quantity',ordered_quantity,'accepted_quantity',accepted_quantity,'closed_final',closed_final,
   'earned_quantity',earned_quantity,'contract_balance',contract_balance,'allocations',allocations) order by line_no nulls last,created_at,id)
   from lines),'[]'::jsonb)) from p
$function$;
grant execute on function public.zz_old_project_line_earned(uuid, date) to authenticated;
grant execute on function public.zz_old_get_project_billing(uuid) to authenticated;

insert into organizations (id, name, default_currency, default_timezone) values
  ('28020000-0000-0000-0000-0000000000a0','B2802 A','IDR','Asia/Jakarta'), ('28020000-0000-0000-0000-0000000000b0','B2802 B','IDR','UTC');
insert into auth.users (id, email) values
  ('28020000-0000-0000-0000-0000000000a1','b2802-admin@example.test'),('28020000-0000-0000-0000-0000000000a2','b2802-exec@example.test'),('28020000-0000-0000-0000-0000000000a3','b2802-fin@example.test'),
  ('28020000-0000-0000-0000-0000000000a4','b2802-pm@example.test'),('28020000-0000-0000-0000-0000000000a5','b2802-eng@example.test'),('28020000-0000-0000-0000-0000000000b1','b2802-b@example.test');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('28020000-0000-0000-0000-0000000000a1','28020000-0000-0000-0000-0000000000a0','Admin','b2802-admin@example.test','Admin','active'),
  ('28020000-0000-0000-0000-0000000000a2','28020000-0000-0000-0000-0000000000a0','Exec','b2802-exec@example.test','Executive','active'),
  ('28020000-0000-0000-0000-0000000000a3','28020000-0000-0000-0000-0000000000a0','Fin','b2802-fin@example.test','Finance','active'),
  ('28020000-0000-0000-0000-0000000000a4','28020000-0000-0000-0000-0000000000a0','PM','b2802-pm@example.test','Project Manager','active'),
  ('28020000-0000-0000-0000-0000000000a5','28020000-0000-0000-0000-0000000000a0','Eng','b2802-eng@example.test','Engineer','active'),
  ('28020000-0000-0000-0000-0000000000b1','28020000-0000-0000-0000-0000000000b0','Other','b2802-b@example.test','Admin','active');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, project_manager_id) values
  ('28020000-0000-0000-0000-0000000000d1','28020000-0000-0000-0000-0000000000a0','B2802 rich','Ongoing Project','IDR',90000,'exclusive',0,'28020000-0000-0000-0000-0000000000a4'),
  ('28020000-0000-0000-0000-0000000000d2','28020000-0000-0000-0000-0000000000a0','B2802 no orders','Ongoing Project','IDR',1000,'exclusive',0,'28020000-0000-0000-0000-0000000000a4'),
  ('28020000-0000-0000-0000-0000000000d3','28020000-0000-0000-0000-0000000000b0','B2802 other org','Ongoing Project','IDR',1000,'exclusive',0,null);
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate, line_no) values
  ('28020000-0000-0000-0000-0000000000c1','28020000-0000-0000-0000-0000000000a0','28020000-0000-0000-0000-0000000000d1','L1','one','m',100,1000,1),('28020000-0000-0000-0000-0000000000c2','28020000-0000-0000-0000-0000000000a0','28020000-0000-0000-0000-0000000000d1','L2','two','m',50,2000,2),
  ('28020000-0000-0000-0000-0000000000c3','28020000-0000-0000-0000-0000000000a0','28020000-0000-0000-0000-0000000000d1','L3','three','m',20,3000,3),('28020000-0000-0000-0000-0000000000c4','28020000-0000-0000-0000-0000000000a0','28020000-0000-0000-0000-0000000000d1','L4','four','m',10,4000,4),
  ('28020000-0000-0000-0000-0000000000c5','28020000-0000-0000-0000-0000000000a0','28020000-0000-0000-0000-0000000000d1','L5','no orders','m',10,5000,5),
  ('28020000-0000-0000-0000-0000000000c6','28020000-0000-0000-0000-0000000000a0','28020000-0000-0000-0000-0000000000d2','M1','bare','m',10,100,1),
  ('28020000-0000-0000-0000-0000000000c7','28020000-0000-0000-0000-0000000000b0','28020000-0000-0000-0000-0000000000d3','X1','other','m',10,100,1);
-- the rows below are written directly (the guards that route them through the confirm steps are not under test here)
alter table work_orders disable trigger user;
alter table work_order_lines disable trigger user;
alter table work_order_acceptances disable trigger user;
alter table work_order_acceptance_lines disable trigger user;
insert into work_orders (id, org_id, project_id, title, status, tax_treatment, tax_amount, currency) values
  ('28020000-0000-0000-0000-0000000000e1','28020000-0000-0000-0000-0000000000a0','28020000-0000-0000-0000-0000000000d1','WO issued','Issued','exclusive',0,'IDR'),
  ('28020000-0000-0000-0000-0000000000e2','28020000-0000-0000-0000-0000000000a0','28020000-0000-0000-0000-0000000000d1','WO closed final','Closed','exclusive',0,'IDR'),
  ('28020000-0000-0000-0000-0000000000e3','28020000-0000-0000-0000-0000000000a0','28020000-0000-0000-0000-0000000000d1','WO cancelled','Cancelled','exclusive',0,'IDR'),
  ('28020000-0000-0000-0000-0000000000e4','28020000-0000-0000-0000-0000000000a0','28020000-0000-0000-0000-0000000000d1','WO issued staged','Issued','exclusive',0,'IDR'),
  ('28020000-0000-0000-0000-0000000000e5','28020000-0000-0000-0000-0000000000a0','28020000-0000-0000-0000-0000000000d1','WO closed manual','Closed','exclusive',0,'IDR'),
  ('28020000-0000-0000-0000-0000000000e6','28020000-0000-0000-0000-0000000000b0','28020000-0000-0000-0000-0000000000d3','WO other org','Issued','exclusive',0,'IDR');
insert into work_order_lines (org_id, work_order_id, boq_item_id, quantity) values
  ('28020000-0000-0000-0000-0000000000a0','28020000-0000-0000-0000-0000000000e1','28020000-0000-0000-0000-0000000000c1',10),('28020000-0000-0000-0000-0000000000a0','28020000-0000-0000-0000-0000000000e1','28020000-0000-0000-0000-0000000000c2',5),
  ('28020000-0000-0000-0000-0000000000a0','28020000-0000-0000-0000-0000000000e2','28020000-0000-0000-0000-0000000000c1',20),('28020000-0000-0000-0000-0000000000a0','28020000-0000-0000-0000-0000000000e2','28020000-0000-0000-0000-0000000000c3',8),
  ('28020000-0000-0000-0000-0000000000a0','28020000-0000-0000-0000-0000000000e3','28020000-0000-0000-0000-0000000000c1',99),
  ('28020000-0000-0000-0000-0000000000a0','28020000-0000-0000-0000-0000000000e4','28020000-0000-0000-0000-0000000000c2',7),
  ('28020000-0000-0000-0000-0000000000a0','28020000-0000-0000-0000-0000000000e5','28020000-0000-0000-0000-0000000000c4',4),
  ('28020000-0000-0000-0000-0000000000b0','28020000-0000-0000-0000-0000000000e6','28020000-0000-0000-0000-0000000000c7',3);
insert into work_order_acceptances (id, org_id, work_order_id, project_id, acceptance_date, prepared_by, status, is_final, confirmed_at, confirmed_by, confirm_basis) values
  ('28020000-0000-0000-0000-0000000000f1','28020000-0000-0000-0000-0000000000a0','28020000-0000-0000-0000-0000000000e2','28020000-0000-0000-0000-0000000000d1',date '2020-02-10','28020000-0000-0000-0000-0000000000a4','Confirmed',true,timestamptz '2020-02-10 10:00+00','28020000-0000-0000-0000-0000000000a3','standard'),
  ('28020000-0000-0000-0000-0000000000f2','28020000-0000-0000-0000-0000000000a0','28020000-0000-0000-0000-0000000000e4','28020000-0000-0000-0000-0000000000d1',date '2020-01-10','28020000-0000-0000-0000-0000000000a4','Confirmed',false,timestamptz '2020-01-10 10:00+00','28020000-0000-0000-0000-0000000000a3','standard'),
  ('28020000-0000-0000-0000-0000000000f3','28020000-0000-0000-0000-0000000000a0','28020000-0000-0000-0000-0000000000e4','28020000-0000-0000-0000-0000000000d1',date '2020-04-10','28020000-0000-0000-0000-0000000000a4','Confirmed',false,timestamptz '2020-04-10 10:00+00','28020000-0000-0000-0000-0000000000a3','standard');
insert into work_order_acceptance_lines (acceptance_id, boq_item_id, quantity) values
  ('28020000-0000-0000-0000-0000000000f1','28020000-0000-0000-0000-0000000000c1',18),('28020000-0000-0000-0000-0000000000f1','28020000-0000-0000-0000-0000000000c3',8),
  ('28020000-0000-0000-0000-0000000000f2','28020000-0000-0000-0000-0000000000c2',2),('28020000-0000-0000-0000-0000000000f3','28020000-0000-0000-0000-0000000000c2',3);
update work_orders set closing_acceptance_id = '28020000-0000-0000-0000-0000000000f1', closing_value = 1000 where id = '28020000-0000-0000-0000-0000000000e2';
alter table work_orders enable trigger user;
alter table work_order_lines enable trigger user;
alter table work_order_acceptances enable trigger user;
alter table work_order_acceptance_lines enable trigger user;
insert into project_progress_entries (id, org_id, project_id, month, pct_complete) values
  ('28020000-0000-0000-0000-000000000090','28020000-0000-0000-0000-0000000000a0','28020000-0000-0000-0000-0000000000d1',date '2020-01-01',10),('28020000-0000-0000-0000-000000000091','28020000-0000-0000-0000-0000000000a0','28020000-0000-0000-0000-0000000000d1',date '2020-06-01',40);
insert into progress_assessment_quantities (org_id, entry_id, boq_item_id, quantity_to_date) values
  ('28020000-0000-0000-0000-0000000000a0','28020000-0000-0000-0000-000000000090','28020000-0000-0000-0000-0000000000c1',5),('28020000-0000-0000-0000-0000000000a0','28020000-0000-0000-0000-000000000091','28020000-0000-0000-0000-0000000000c1',12),('28020000-0000-0000-0000-0000000000a0','28020000-0000-0000-0000-000000000091','28020000-0000-0000-0000-0000000000c3',3),('28020000-0000-0000-0000-0000000000a0','28020000-0000-0000-0000-000000000091','28020000-0000-0000-0000-0000000000c2',9);

-- one row per billing figure and per BoQ line, for the EXCEPT comparisons
create function pg_temp.bill_rows(j jsonb) returns table (k text, v text) language sql immutable as $$
  select 'top', (j - 'boq')::text union all select 'line', e::text from jsonb_array_elements(coalesce(j->'boq','[]'::jsonb)) e
$$;
grant execute on function pg_temp.bill_rows(jsonb) to authenticated;

select is((select prosecdef from pg_proc where oid='public.get_project_billing(uuid)'::regprocedure), false, 'AC-PERF-2802 billing read stays security invoker');
select is((select proconfig from pg_proc where oid='public.get_project_billing(uuid)'::regprocedure), (select proconfig from pg_proc where oid='public.zz_old_get_project_billing(uuid)'::regprocedure), 'AC-PERF-2802 billing read keeps its search path');
select is((select proconfig from pg_proc where oid='public.project_line_earned(uuid,date)'::regprocedure), (select proconfig from pg_proc where oid='public.zz_old_project_line_earned(uuid,date)'::regprocedure), 'AC-PERF-2802 line-earned read keeps its search path');
select is((select prosecdef from pg_proc where oid='public.project_line_earned(uuid,date)'::regprocedure), false, 'AC-PERF-2802 line-earned read stays security invoker');
select is((select provolatile from pg_proc where oid='public.get_project_billing(uuid)'::regprocedure), 's', 'AC-PERF-2802 billing read stays stable');
select is((select provolatile from pg_proc where oid='public.project_line_earned(uuid,date)'::regprocedure), 's', 'AC-PERF-2802 line-earned read stays stable');
select ok(has_function_privilege('authenticated','public.get_project_billing(uuid)','execute') and not has_function_privilege('anon','public.get_project_billing(uuid)','execute'), 'AC-PERF-2802 billing read grants are unchanged');
select ok(has_function_privilege('authenticated','public.project_line_earned(uuid,date)','execute') and not has_function_privilege('anon','public.project_line_earned(uuid,date)','execute'), 'AC-PERF-2802 line-earned read grants are unchanged');
set local role authenticated;
set local request.jwt.claims='{"sub":"28020000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from (select k,v from pg_temp.bill_rows(public.zz_old_get_project_billing('28020000-0000-0000-0000-0000000000d1')) except select k,v from pg_temp.bill_rows(public.get_project_billing('28020000-0000-0000-0000-0000000000d1'))) x), 0, 'AC-PERF-2802 Admin: billing rows the old read gave and the new one does not (d1) = none');
select is((select count(*)::int from (select k,v from pg_temp.bill_rows(public.get_project_billing('28020000-0000-0000-0000-0000000000d1')) except select k,v from pg_temp.bill_rows(public.zz_old_get_project_billing('28020000-0000-0000-0000-0000000000d1'))) x), 0, 'AC-PERF-2802 Admin: billing rows the new read gives and the old one does not (d1) = none');
select is((select count(*)::int from (select * from public.zz_old_project_line_earned('28020000-0000-0000-0000-0000000000d1') except select * from public.project_line_earned('28020000-0000-0000-0000-0000000000d1')) x), 0, 'AC-PERF-2802 Admin: earned rows lost (d1)');
select is((select count(*)::int from (select * from public.project_line_earned('28020000-0000-0000-0000-0000000000d1') except select * from public.zz_old_project_line_earned('28020000-0000-0000-0000-0000000000d1')) x), 0, 'AC-PERF-2802 Admin: earned rows added (d1)');
select is((select count(*)::int from (select k,v from pg_temp.bill_rows(public.zz_old_get_project_billing('28020000-0000-0000-0000-0000000000d2')) except select k,v from pg_temp.bill_rows(public.get_project_billing('28020000-0000-0000-0000-0000000000d2'))) x), 0, 'AC-PERF-2802 Admin: billing rows the old read gave and the new one does not (d2) = none');
select is((select count(*)::int from (select k,v from pg_temp.bill_rows(public.get_project_billing('28020000-0000-0000-0000-0000000000d2')) except select k,v from pg_temp.bill_rows(public.zz_old_get_project_billing('28020000-0000-0000-0000-0000000000d2'))) x), 0, 'AC-PERF-2802 Admin: billing rows the new read gives and the old one does not (d2) = none');
select is((select count(*)::int from (select * from public.zz_old_project_line_earned('28020000-0000-0000-0000-0000000000d2') except select * from public.project_line_earned('28020000-0000-0000-0000-0000000000d2')) x), 0, 'AC-PERF-2802 Admin: earned rows lost (d2)');
select is((select count(*)::int from (select * from public.project_line_earned('28020000-0000-0000-0000-0000000000d2') except select * from public.zz_old_project_line_earned('28020000-0000-0000-0000-0000000000d2')) x), 0, 'AC-PERF-2802 Admin: earned rows added (d2)');
select is((select count(*)::int from (select * from public.zz_old_project_line_earned('28020000-0000-0000-0000-0000000000d1', date '2020-01-15') except select * from public.project_line_earned('28020000-0000-0000-0000-0000000000d1', date '2020-01-15')) x) + (select count(*)::int from (select * from public.project_line_earned('28020000-0000-0000-0000-0000000000d1', date '2020-01-15') except select * from public.zz_old_project_line_earned('28020000-0000-0000-0000-0000000000d1', date '2020-01-15')) x), 0, 'AC-PERF-2802 Admin: earned rows as at 2020-01-15 equal');
select is((select count(*)::int from (select * from public.zz_old_project_line_earned('28020000-0000-0000-0000-0000000000d1', date '2020-03-15') except select * from public.project_line_earned('28020000-0000-0000-0000-0000000000d1', date '2020-03-15')) x) + (select count(*)::int from (select * from public.project_line_earned('28020000-0000-0000-0000-0000000000d1', date '2020-03-15') except select * from public.zz_old_project_line_earned('28020000-0000-0000-0000-0000000000d1', date '2020-03-15')) x), 0, 'AC-PERF-2802 Admin: earned rows as at 2020-03-15 equal');
set local role authenticated;
set local request.jwt.claims='{"sub":"28020000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*)::int from (select k,v from pg_temp.bill_rows(public.zz_old_get_project_billing('28020000-0000-0000-0000-0000000000d1')) except select k,v from pg_temp.bill_rows(public.get_project_billing('28020000-0000-0000-0000-0000000000d1'))) x), 0, 'AC-PERF-2802 Executive: billing rows the old read gave and the new one does not (d1) = none');
select is((select count(*)::int from (select k,v from pg_temp.bill_rows(public.get_project_billing('28020000-0000-0000-0000-0000000000d1')) except select k,v from pg_temp.bill_rows(public.zz_old_get_project_billing('28020000-0000-0000-0000-0000000000d1'))) x), 0, 'AC-PERF-2802 Executive: billing rows the new read gives and the old one does not (d1) = none');
select is((select count(*)::int from (select * from public.zz_old_project_line_earned('28020000-0000-0000-0000-0000000000d1') except select * from public.project_line_earned('28020000-0000-0000-0000-0000000000d1')) x), 0, 'AC-PERF-2802 Executive: earned rows lost (d1)');
select is((select count(*)::int from (select * from public.project_line_earned('28020000-0000-0000-0000-0000000000d1') except select * from public.zz_old_project_line_earned('28020000-0000-0000-0000-0000000000d1')) x), 0, 'AC-PERF-2802 Executive: earned rows added (d1)');
select is((select count(*)::int from (select k,v from pg_temp.bill_rows(public.zz_old_get_project_billing('28020000-0000-0000-0000-0000000000d2')) except select k,v from pg_temp.bill_rows(public.get_project_billing('28020000-0000-0000-0000-0000000000d2'))) x), 0, 'AC-PERF-2802 Executive: billing rows the old read gave and the new one does not (d2) = none');
select is((select count(*)::int from (select k,v from pg_temp.bill_rows(public.get_project_billing('28020000-0000-0000-0000-0000000000d2')) except select k,v from pg_temp.bill_rows(public.zz_old_get_project_billing('28020000-0000-0000-0000-0000000000d2'))) x), 0, 'AC-PERF-2802 Executive: billing rows the new read gives and the old one does not (d2) = none');
select is((select count(*)::int from (select * from public.zz_old_project_line_earned('28020000-0000-0000-0000-0000000000d2') except select * from public.project_line_earned('28020000-0000-0000-0000-0000000000d2')) x), 0, 'AC-PERF-2802 Executive: earned rows lost (d2)');
select is((select count(*)::int from (select * from public.project_line_earned('28020000-0000-0000-0000-0000000000d2') except select * from public.zz_old_project_line_earned('28020000-0000-0000-0000-0000000000d2')) x), 0, 'AC-PERF-2802 Executive: earned rows added (d2)');
select is((select count(*)::int from (select * from public.zz_old_project_line_earned('28020000-0000-0000-0000-0000000000d1', date '2020-01-15') except select * from public.project_line_earned('28020000-0000-0000-0000-0000000000d1', date '2020-01-15')) x) + (select count(*)::int from (select * from public.project_line_earned('28020000-0000-0000-0000-0000000000d1', date '2020-01-15') except select * from public.zz_old_project_line_earned('28020000-0000-0000-0000-0000000000d1', date '2020-01-15')) x), 0, 'AC-PERF-2802 Executive: earned rows as at 2020-01-15 equal');
select is((select count(*)::int from (select * from public.zz_old_project_line_earned('28020000-0000-0000-0000-0000000000d1', date '2020-03-15') except select * from public.project_line_earned('28020000-0000-0000-0000-0000000000d1', date '2020-03-15')) x) + (select count(*)::int from (select * from public.project_line_earned('28020000-0000-0000-0000-0000000000d1', date '2020-03-15') except select * from public.zz_old_project_line_earned('28020000-0000-0000-0000-0000000000d1', date '2020-03-15')) x), 0, 'AC-PERF-2802 Executive: earned rows as at 2020-03-15 equal');
set local role authenticated;
set local request.jwt.claims='{"sub":"28020000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is((select count(*)::int from (select k,v from pg_temp.bill_rows(public.zz_old_get_project_billing('28020000-0000-0000-0000-0000000000d1')) except select k,v from pg_temp.bill_rows(public.get_project_billing('28020000-0000-0000-0000-0000000000d1'))) x), 0, 'AC-PERF-2802 Finance: billing rows the old read gave and the new one does not (d1) = none');
select is((select count(*)::int from (select k,v from pg_temp.bill_rows(public.get_project_billing('28020000-0000-0000-0000-0000000000d1')) except select k,v from pg_temp.bill_rows(public.zz_old_get_project_billing('28020000-0000-0000-0000-0000000000d1'))) x), 0, 'AC-PERF-2802 Finance: billing rows the new read gives and the old one does not (d1) = none');
select is((select count(*)::int from (select * from public.zz_old_project_line_earned('28020000-0000-0000-0000-0000000000d1') except select * from public.project_line_earned('28020000-0000-0000-0000-0000000000d1')) x), 0, 'AC-PERF-2802 Finance: earned rows lost (d1)');
select is((select count(*)::int from (select * from public.project_line_earned('28020000-0000-0000-0000-0000000000d1') except select * from public.zz_old_project_line_earned('28020000-0000-0000-0000-0000000000d1')) x), 0, 'AC-PERF-2802 Finance: earned rows added (d1)');
select is((select count(*)::int from (select k,v from pg_temp.bill_rows(public.zz_old_get_project_billing('28020000-0000-0000-0000-0000000000d2')) except select k,v from pg_temp.bill_rows(public.get_project_billing('28020000-0000-0000-0000-0000000000d2'))) x), 0, 'AC-PERF-2802 Finance: billing rows the old read gave and the new one does not (d2) = none');
select is((select count(*)::int from (select k,v from pg_temp.bill_rows(public.get_project_billing('28020000-0000-0000-0000-0000000000d2')) except select k,v from pg_temp.bill_rows(public.zz_old_get_project_billing('28020000-0000-0000-0000-0000000000d2'))) x), 0, 'AC-PERF-2802 Finance: billing rows the new read gives and the old one does not (d2) = none');
select is((select count(*)::int from (select * from public.zz_old_project_line_earned('28020000-0000-0000-0000-0000000000d2') except select * from public.project_line_earned('28020000-0000-0000-0000-0000000000d2')) x), 0, 'AC-PERF-2802 Finance: earned rows lost (d2)');
select is((select count(*)::int from (select * from public.project_line_earned('28020000-0000-0000-0000-0000000000d2') except select * from public.zz_old_project_line_earned('28020000-0000-0000-0000-0000000000d2')) x), 0, 'AC-PERF-2802 Finance: earned rows added (d2)');
select is((select count(*)::int from (select * from public.zz_old_project_line_earned('28020000-0000-0000-0000-0000000000d1', date '2020-01-15') except select * from public.project_line_earned('28020000-0000-0000-0000-0000000000d1', date '2020-01-15')) x) + (select count(*)::int from (select * from public.project_line_earned('28020000-0000-0000-0000-0000000000d1', date '2020-01-15') except select * from public.zz_old_project_line_earned('28020000-0000-0000-0000-0000000000d1', date '2020-01-15')) x), 0, 'AC-PERF-2802 Finance: earned rows as at 2020-01-15 equal');
select is((select count(*)::int from (select * from public.zz_old_project_line_earned('28020000-0000-0000-0000-0000000000d1', date '2020-03-15') except select * from public.project_line_earned('28020000-0000-0000-0000-0000000000d1', date '2020-03-15')) x) + (select count(*)::int from (select * from public.project_line_earned('28020000-0000-0000-0000-0000000000d1', date '2020-03-15') except select * from public.zz_old_project_line_earned('28020000-0000-0000-0000-0000000000d1', date '2020-03-15')) x), 0, 'AC-PERF-2802 Finance: earned rows as at 2020-03-15 equal');
set local role authenticated;
set local request.jwt.claims='{"sub":"28020000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select is((select count(*)::int from (select k,v from pg_temp.bill_rows(public.zz_old_get_project_billing('28020000-0000-0000-0000-0000000000d1')) except select k,v from pg_temp.bill_rows(public.get_project_billing('28020000-0000-0000-0000-0000000000d1'))) x), 0, 'AC-PERF-2802 Project Manager: billing rows the old read gave and the new one does not (d1) = none');
select is((select count(*)::int from (select k,v from pg_temp.bill_rows(public.get_project_billing('28020000-0000-0000-0000-0000000000d1')) except select k,v from pg_temp.bill_rows(public.zz_old_get_project_billing('28020000-0000-0000-0000-0000000000d1'))) x), 0, 'AC-PERF-2802 Project Manager: billing rows the new read gives and the old one does not (d1) = none');
select is((select count(*)::int from (select * from public.zz_old_project_line_earned('28020000-0000-0000-0000-0000000000d1') except select * from public.project_line_earned('28020000-0000-0000-0000-0000000000d1')) x), 0, 'AC-PERF-2802 Project Manager: earned rows lost (d1)');
select is((select count(*)::int from (select * from public.project_line_earned('28020000-0000-0000-0000-0000000000d1') except select * from public.zz_old_project_line_earned('28020000-0000-0000-0000-0000000000d1')) x), 0, 'AC-PERF-2802 Project Manager: earned rows added (d1)');
select is((select count(*)::int from (select k,v from pg_temp.bill_rows(public.zz_old_get_project_billing('28020000-0000-0000-0000-0000000000d2')) except select k,v from pg_temp.bill_rows(public.get_project_billing('28020000-0000-0000-0000-0000000000d2'))) x), 0, 'AC-PERF-2802 Project Manager: billing rows the old read gave and the new one does not (d2) = none');
select is((select count(*)::int from (select k,v from pg_temp.bill_rows(public.get_project_billing('28020000-0000-0000-0000-0000000000d2')) except select k,v from pg_temp.bill_rows(public.zz_old_get_project_billing('28020000-0000-0000-0000-0000000000d2'))) x), 0, 'AC-PERF-2802 Project Manager: billing rows the new read gives and the old one does not (d2) = none');
select is((select count(*)::int from (select * from public.zz_old_project_line_earned('28020000-0000-0000-0000-0000000000d2') except select * from public.project_line_earned('28020000-0000-0000-0000-0000000000d2')) x), 0, 'AC-PERF-2802 Project Manager: earned rows lost (d2)');
select is((select count(*)::int from (select * from public.project_line_earned('28020000-0000-0000-0000-0000000000d2') except select * from public.zz_old_project_line_earned('28020000-0000-0000-0000-0000000000d2')) x), 0, 'AC-PERF-2802 Project Manager: earned rows added (d2)');
select is((select count(*)::int from (select * from public.zz_old_project_line_earned('28020000-0000-0000-0000-0000000000d1', date '2020-01-15') except select * from public.project_line_earned('28020000-0000-0000-0000-0000000000d1', date '2020-01-15')) x) + (select count(*)::int from (select * from public.project_line_earned('28020000-0000-0000-0000-0000000000d1', date '2020-01-15') except select * from public.zz_old_project_line_earned('28020000-0000-0000-0000-0000000000d1', date '2020-01-15')) x), 0, 'AC-PERF-2802 Project Manager: earned rows as at 2020-01-15 equal');
select is((select count(*)::int from (select * from public.zz_old_project_line_earned('28020000-0000-0000-0000-0000000000d1', date '2020-03-15') except select * from public.project_line_earned('28020000-0000-0000-0000-0000000000d1', date '2020-03-15')) x) + (select count(*)::int from (select * from public.project_line_earned('28020000-0000-0000-0000-0000000000d1', date '2020-03-15') except select * from public.zz_old_project_line_earned('28020000-0000-0000-0000-0000000000d1', date '2020-03-15')) x), 0, 'AC-PERF-2802 Project Manager: earned rows as at 2020-03-15 equal');
set local role authenticated;
set local request.jwt.claims='{"sub":"28020000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select is((select count(*)::int from (select k,v from pg_temp.bill_rows(public.zz_old_get_project_billing('28020000-0000-0000-0000-0000000000d1')) except select k,v from pg_temp.bill_rows(public.get_project_billing('28020000-0000-0000-0000-0000000000d1'))) x), 0, 'AC-PERF-2802 Engineer: billing rows the old read gave and the new one does not (d1) = none');
select is((select count(*)::int from (select k,v from pg_temp.bill_rows(public.get_project_billing('28020000-0000-0000-0000-0000000000d1')) except select k,v from pg_temp.bill_rows(public.zz_old_get_project_billing('28020000-0000-0000-0000-0000000000d1'))) x), 0, 'AC-PERF-2802 Engineer: billing rows the new read gives and the old one does not (d1) = none');
select is((select count(*)::int from (select * from public.zz_old_project_line_earned('28020000-0000-0000-0000-0000000000d1') except select * from public.project_line_earned('28020000-0000-0000-0000-0000000000d1')) x), 0, 'AC-PERF-2802 Engineer: earned rows lost (d1)');
select is((select count(*)::int from (select * from public.project_line_earned('28020000-0000-0000-0000-0000000000d1') except select * from public.zz_old_project_line_earned('28020000-0000-0000-0000-0000000000d1')) x), 0, 'AC-PERF-2802 Engineer: earned rows added (d1)');
select is((select count(*)::int from (select k,v from pg_temp.bill_rows(public.zz_old_get_project_billing('28020000-0000-0000-0000-0000000000d2')) except select k,v from pg_temp.bill_rows(public.get_project_billing('28020000-0000-0000-0000-0000000000d2'))) x), 0, 'AC-PERF-2802 Engineer: billing rows the old read gave and the new one does not (d2) = none');
select is((select count(*)::int from (select k,v from pg_temp.bill_rows(public.get_project_billing('28020000-0000-0000-0000-0000000000d2')) except select k,v from pg_temp.bill_rows(public.zz_old_get_project_billing('28020000-0000-0000-0000-0000000000d2'))) x), 0, 'AC-PERF-2802 Engineer: billing rows the new read gives and the old one does not (d2) = none');
select is((select count(*)::int from (select * from public.zz_old_project_line_earned('28020000-0000-0000-0000-0000000000d2') except select * from public.project_line_earned('28020000-0000-0000-0000-0000000000d2')) x), 0, 'AC-PERF-2802 Engineer: earned rows lost (d2)');
select is((select count(*)::int from (select * from public.project_line_earned('28020000-0000-0000-0000-0000000000d2') except select * from public.zz_old_project_line_earned('28020000-0000-0000-0000-0000000000d2')) x), 0, 'AC-PERF-2802 Engineer: earned rows added (d2)');
select is((select count(*)::int from (select * from public.zz_old_project_line_earned('28020000-0000-0000-0000-0000000000d1', date '2020-01-15') except select * from public.project_line_earned('28020000-0000-0000-0000-0000000000d1', date '2020-01-15')) x) + (select count(*)::int from (select * from public.project_line_earned('28020000-0000-0000-0000-0000000000d1', date '2020-01-15') except select * from public.zz_old_project_line_earned('28020000-0000-0000-0000-0000000000d1', date '2020-01-15')) x), 0, 'AC-PERF-2802 Engineer: earned rows as at 2020-01-15 equal');
select is((select count(*)::int from (select * from public.zz_old_project_line_earned('28020000-0000-0000-0000-0000000000d1', date '2020-03-15') except select * from public.project_line_earned('28020000-0000-0000-0000-0000000000d1', date '2020-03-15')) x) + (select count(*)::int from (select * from public.project_line_earned('28020000-0000-0000-0000-0000000000d1', date '2020-03-15') except select * from public.zz_old_project_line_earned('28020000-0000-0000-0000-0000000000d1', date '2020-03-15')) x), 0, 'AC-PERF-2802 Engineer: earned rows as at 2020-03-15 equal');
reset role;
set local role authenticated;
set local request.jwt.claims='{"sub":"28020000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is((select count(*)::int from pg_temp.bill_rows(public.get_project_billing('28020000-0000-0000-0000-0000000000d1')) where k='line'), 5, 'AC-PERF-2802 the comparison is not vacuous: Finance sees all five BoQ lines');
select ok((select count(*) from public.project_line_earned('28020000-0000-0000-0000-0000000000d1') where earned_quantity > 0) >= 2, 'AC-PERF-2802 the comparison is not vacuous: earned quantities are non-zero');
select ok((select (e->>'ordered_quantity')::numeric from jsonb_array_elements(public.get_project_billing('28020000-0000-0000-0000-0000000000d1')->'boq') e where e->>'boq_item_id'='28020000-0000-0000-0000-0000000000c1') = 30, 'AC-PERF-2802 a cancelled order does not count toward ordered quantity');
set local role authenticated;
set local request.jwt.claims='{"sub":"28020000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from (select k,v from pg_temp.bill_rows(public.zz_old_get_project_billing('28020000-0000-0000-0000-0000000000d1')) except select k,v from pg_temp.bill_rows(public.get_project_billing('28020000-0000-0000-0000-0000000000d1'))) x), 0, 'AC-PERF-2802 other organisation: billing rows the old read gave and the new one does not (d1) = none');
select is((select count(*)::int from (select k,v from pg_temp.bill_rows(public.get_project_billing('28020000-0000-0000-0000-0000000000d1')) except select k,v from pg_temp.bill_rows(public.zz_old_get_project_billing('28020000-0000-0000-0000-0000000000d1'))) x), 0, 'AC-PERF-2802 other organisation: billing rows the new read gives and the old one does not (d1) = none');
select is((select count(*)::int from (select * from public.zz_old_project_line_earned('28020000-0000-0000-0000-0000000000d1') except select * from public.project_line_earned('28020000-0000-0000-0000-0000000000d1')) x), 0, 'AC-PERF-2802 other organisation: earned rows lost (d1)');
select is((select count(*)::int from (select * from public.project_line_earned('28020000-0000-0000-0000-0000000000d1') except select * from public.zz_old_project_line_earned('28020000-0000-0000-0000-0000000000d1')) x), 0, 'AC-PERF-2802 other organisation: earned rows added (d1)');
select is((select count(*)::int from (select k,v from pg_temp.bill_rows(public.zz_old_get_project_billing('28020000-0000-0000-0000-0000000000d3')) except select k,v from pg_temp.bill_rows(public.get_project_billing('28020000-0000-0000-0000-0000000000d3'))) x), 0, 'AC-PERF-2802 other organisation: billing rows the old read gave and the new one does not (d3) = none');
select is((select count(*)::int from (select k,v from pg_temp.bill_rows(public.get_project_billing('28020000-0000-0000-0000-0000000000d3')) except select k,v from pg_temp.bill_rows(public.zz_old_get_project_billing('28020000-0000-0000-0000-0000000000d3'))) x), 0, 'AC-PERF-2802 other organisation: billing rows the new read gives and the old one does not (d3) = none');
select is((select count(*)::int from (select * from public.zz_old_project_line_earned('28020000-0000-0000-0000-0000000000d3') except select * from public.project_line_earned('28020000-0000-0000-0000-0000000000d3')) x), 0, 'AC-PERF-2802 other organisation: earned rows lost (d3)');
select is((select count(*)::int from (select * from public.project_line_earned('28020000-0000-0000-0000-0000000000d3') except select * from public.zz_old_project_line_earned('28020000-0000-0000-0000-0000000000d3')) x), 0, 'AC-PERF-2802 other organisation: earned rows added (d3)');
select is((select count(*)::int from pg_temp.bill_rows(public.get_project_billing('28020000-0000-0000-0000-0000000000d1')) where k='line'), 0, 'AC-PERF-2802 another organisation reads nothing of this project''s billing');
select * from finish();
rollback;
