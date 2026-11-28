-- 2802: the project billing read sums each BoQ line's work-order allocation once, not once per line.
-- get_project_billing and project_line_earned summed the allocation set with correlated subselects, one scan of the
-- materialised allocation CTE per BoQ line and per sum. The allocation set is now grouped by BoQ line once and joined.
-- Same rows, same figures, same guards: language, volatility, search path, security mode and grants are unchanged.
-- No begin/commit: the rollback round trip wraps this file in its own transaction.
-- Rollback: supabase/migrations/rollback/2802_project_billing_allocation_once_down.sql
-- drops: get_project_billing(uuid) | "coalesce((select sum(a.quantity) from allocation a where a.boq_item_id=b.id and a.status in ('Issued','Closed')),0) ordered_quantity," | the per-line correlated sum is replaced by one grouped alloc_agg join
-- drops: get_project_billing(uuid) | "coalesce((select sum(a.quantity) from allocation a where a.boq_item_id=b.id and a.status='Issued'),0) issued_ordered," | the per-line correlated sum is replaced by one grouped alloc_agg join
-- drops: get_project_billing(uuid) | "coalesce((select sum(a.accepted) from allocation a where a.boq_item_id=b.id and a.final and a.status='Closed'),0) closed_final," | the per-line correlated sum is replaced by one grouped alloc_agg join
-- drops: get_project_billing(uuid) | "coalesce((select sum(a.accepted) from allocation a where a.boq_item_id=b.id and a.accepted is not null),0) accepted_quantity," | the per-line correlated sum is replaced by one grouped alloc_agg join
-- drops: get_project_billing(uuid) | "coalesce((select jsonb_agg(jsonb_build_object('work_order_id',x.work_order_id,'boq_item_id',x.boq_item_id,'quantity',x.quantity,'claimed_quantity',x.claimed,'accepted_quantity',x.accepted,'final',x.final) order by x.work_order_id)" | the per-line correlated sum is replaced by one grouped alloc_agg join
-- drops: get_project_billing(uuid) | "from allocation x where x.boq_item_id=b.id),'[]'::jsonb) allocations" | the per-line correlated sum is replaced by one grouped alloc_agg join
-- drops: get_project_billing(uuid) | "from public.boq_items b left join claimed_line cl on cl.boq_item_id=b.id left join assessed a on a.boq_item_id=b.id where b.project_id=p_project_id" | the per-line correlated sum is replaced by one grouped alloc_agg join
-- drops: project_line_earned(uuid,date) | "coalesce((select sum(x.accepted) from allocation x where x.boq_item_id=b.id and x.final and x.status='Closed'),0) closed_final," | the per-line correlated sum is replaced by one grouped alloc_agg join
-- drops: project_line_earned(uuid,date) | "coalesce((select sum(x.quantity) from allocation x,lim where x.boq_item_id=b.id and x.status='Closed' and x.closing_acceptance_id is not null and (lim.ts is null or x.final)),0) closed_ordered" | the per-line correlated sum is replaced by one grouped alloc_agg join
-- drops: project_line_earned(uuid,date) | "from public.boq_items b left join assessed a on a.boq_item_id=b.id where b.project_id=p_project_id" | the per-line correlated sum is replaced by one grouped alloc_agg join

CREATE OR REPLACE FUNCTION public.get_project_billing(p_project_id uuid)
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
), alloc_agg as (
 select a.boq_item_id,
  sum(a.quantity) filter (where a.status in ('Issued','Closed')) ordered_quantity,
  sum(a.quantity) filter (where a.status='Issued') issued_ordered,
  sum(a.accepted) filter (where a.final and a.status='Closed') closed_final,
  sum(a.accepted) filter (where a.accepted is not null) accepted_quantity,
  jsonb_agg(jsonb_build_object('work_order_id',a.work_order_id,'boq_item_id',a.boq_item_id,'quantity',a.quantity,'claimed_quantity',a.claimed,'accepted_quantity',a.accepted,'final',a.final) order by a.work_order_id) allocations
 from allocation a group by a.boq_item_id
), agg as (
 select b.id,b.earning_basis,b.line_no,b.created_at,b.quantity contract_quantity,b.rate,
  coalesce(aa.ordered_quantity,0) ordered_quantity,
  coalesce(aa.issued_ordered,0) issued_ordered,
  coalesce(aa.closed_final,0) closed_final,
  coalesce(aa.accepted_quantity,0) accepted_quantity,
  coalesce(cl.claimed,0) claimed_quantity,a.quantity_to_date assessed_quantity,
  coalesce(aa.allocations,'[]'::jsonb) allocations
 from public.boq_items b left join claimed_line cl on cl.boq_item_id=b.id left join assessed a on a.boq_item_id=b.id
 left join alloc_agg aa on aa.boq_item_id=b.id where b.project_id=p_project_id
), earned as (select * from public.project_line_earned(p_project_id)), lines as (
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
$function$
;

CREATE OR REPLACE FUNCTION public.project_line_earned(p_project_id uuid, p_as_at date DEFAULT NULL::date)
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
), alloc_agg as (
 select x.boq_item_id,
   sum(x.accepted) filter (where x.final and x.status='Closed') closed_final,
   sum(x.quantity) filter (where x.status='Closed' and x.closing_acceptance_id is not null and (lim.ts is null or x.final)) closed_ordered
 from allocation x, lim group by x.boq_item_id
), agg as (
 select b.id,b.rate,b.quantity contract_quantity,a.quantity_to_date assessed_quantity,
  coalesce(aa.closed_final,0) closed_final,
  coalesce(aa.closed_ordered,0) closed_ordered
 from public.boq_items b left join assessed a on a.boq_item_id=b.id left join alloc_agg aa on aa.boq_item_id=b.id where b.project_id=p_project_id
)
select g.id,g.earned_quantity,g.rate,round(g.earned_quantity*g.rate,2) from (
 select agg.*,agg.closed_final+least(greatest(coalesce(agg.assessed_quantity,0)-agg.closed_ordered,0),greatest(agg.contract_quantity-agg.closed_final,0)) earned_quantity from agg) g
$function$
;
