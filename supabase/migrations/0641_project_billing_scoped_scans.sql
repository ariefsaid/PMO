-- 0641_project_billing_scoped_scans.sql — project-scoped scans for get_project_billing.
-- Reversal: rollback/0641_project_billing_scoped_scans_down.sql.

create or replace function public.get_project_billing(p_project_id uuid)
 returns jsonb language sql stable security invoker set search_path=public as $$
with p as (
 select pr.id,pr.org_id,pr.currency,case when pr.tax_treatment='inclusive' then pr.contract_value-coalesce(pr.tax_amount,0) else pr.contract_value end contract_net
 from public.projects pr where pr.id=p_project_id
), counted as (
 select w.is_down_payment,w.net,w.recovery from public.sales_invoice_work_billed w join p on p.id=w.project_id
 where w.status in ('Submitted','Unpaid','Paid') and w.net is not null and w.currency=p.currency
), claims as (
 select pc.id,pc.kind,pc.gross_amount,pc.dp_recovery_amount,pc.work_order_id,si.status
 from public.progress_claims pc left join public.sales_invoices si on si.id=pc.id and si.org_id=pc.org_id
 where pc.project_id=p_project_id and pc.withdrawn_at is null and si.status is distinct from 'Cancelled'
), claimed_line as (
 select l.boq_item_id,sum(l.quantity) claimed from public.progress_claim_lines l join claims c on c.id=l.claim_id group by l.boq_item_id
), claimed_alloc as (
 select l.boq_item_id,c.work_order_id,sum(l.quantity) claimed from public.progress_claim_lines l join claims c on c.id=l.claim_id
 where c.work_order_id is not null group by l.boq_item_id,c.work_order_id
), latest as (
 select e.id,e.month,e.pct_complete from public.project_progress_entries e where e.project_id=p_project_id
 and e.month<=public.org_current_month((select o.default_timezone from public.organizations o where o.id=public.auth_org_id()),now()) order by e.month desc limit 1
), assessed as (select q.boq_item_id,q.quantity_to_date from public.progress_assessment_quantities q join latest l on l.id=q.entry_id),
latest_bast as (
 select distinct on (a.work_order_id) a.work_order_id,a.id,a.is_final
 from public.work_order_acceptances a
 where a.project_id=p_project_id and a.status='Confirmed'
 order by a.work_order_id,a.confirmed_at desc,a.id desc
), allocation as (
 select wl.boq_item_id,wl.work_order_id,wl.quantity,wo.status,wo.closing_acceptance_id,
   coalesce(ca.claimed,0) claimed,al.quantity accepted,coalesce(lb.is_final,false) final
 from public.work_order_lines wl join public.work_orders wo on wo.id=wl.work_order_id
 left join claimed_alloc ca on ca.boq_item_id=wl.boq_item_id and ca.work_order_id=wl.work_order_id
 left join latest_bast lb on lb.work_order_id=wl.work_order_id
 left join public.work_order_acceptance_lines al on al.acceptance_id=lb.id and al.boq_item_id=wl.boq_item_id
 where wl.org_id=public.auth_org_id() and wo.project_id=p_project_id and wo.status<>'Cancelled'
), alloc_summary as (
 select
  a.boq_item_id,
  coalesce(sum(a.quantity) filter (where a.status in ('Issued','Closed')), 0) as ordered_quantity,
  coalesce(sum(a.quantity) filter (where a.status = 'Issued'), 0) as issued_ordered,
  coalesce(sum(a.accepted) filter (where a.final and a.status = 'Closed'), 0) as closed_final,
  coalesce(sum(a.accepted) filter (where a.accepted is not null), 0) as accepted_quantity,
  coalesce(sum(a.quantity) filter (where a.status = 'Closed' and a.closing_acceptance_id is not null), 0) as closed_ordered,
  coalesce(jsonb_agg(
    jsonb_build_object(
      'work_order_id', a.work_order_id,
      'boq_item_id', a.boq_item_id,
      'quantity', a.quantity,
      'claimed_quantity', a.claimed,
      'accepted_quantity', a.accepted,
      'final', a.final
    ) order by a.work_order_id
  ), '[]'::jsonb) as allocations
 from allocation a
 group by a.boq_item_id
), agg as (
 select b.id,b.earning_basis,b.line_no,b.created_at,b.quantity contract_quantity,b.rate,
  coalesce(s.ordered_quantity, 0) ordered_quantity,
  coalesce(s.issued_ordered, 0) issued_ordered,
  coalesce(s.closed_final, 0) closed_final,
  coalesce(s.accepted_quantity, 0) accepted_quantity,
  coalesce(s.closed_ordered, 0) closed_ordered,
  coalesce(cl.claimed, 0) claimed_quantity,
  a.quantity_to_date assessed_quantity,
  coalesce(s.allocations, '[]'::jsonb) allocations
 from public.boq_items b
 left join claimed_line cl on cl.boq_item_id = b.id
 left join assessed a on a.boq_item_id = b.id
 left join alloc_summary s on s.boq_item_id = b.id
 where b.project_id = p_project_id
), lines as (
 select a.*,
  a.closed_final + least(greatest(coalesce(a.assessed_quantity, 0) - a.closed_ordered, 0), greatest(a.contract_quantity - a.closed_final, 0)) earned_quantity,
  a.contract_quantity - a.issued_ordered - a.closed_final contract_balance
 from agg a
)
select jsonb_build_object(
 'currency',p.currency,'contract_net',p.contract_net,
 'work_billed',coalesce((select sum(net+recovery) from counted where not is_down_payment),0),
 'dp_billed',coalesce((select sum(net) from counted where is_down_payment),0),
 'dp_recovered',coalesce((select sum(recovery) from counted where not is_down_payment),0),
 'not_submitted',coalesce((select sum(gross_amount-dp_recovery_amount) from claims where status is null or status='Draft'),0),
 'assessment',(select jsonb_build_object('month',l.month,'pct_complete',l.pct_complete) from latest l),
 'earned_value',coalesce((select sum(round(earned_quantity*rate,2)) from lines),0),
 'boq',coalesce((select jsonb_agg(jsonb_build_object('boq_item_id',id,'claimed_quantity',claimed_quantity,'assessed_quantity',assessed_quantity,
   'earning_basis',earning_basis,'line_no',line_no,'ordered_quantity',ordered_quantity,'accepted_quantity',accepted_quantity,'closed_final',closed_final,
   'earned_quantity',earned_quantity,'contract_balance',contract_balance,'allocations',allocations) order by line_no nulls last,created_at,id)
   from lines),'[]'::jsonb)) from p
$$;

revoke all on function public.get_project_billing(uuid) from public,anon;
grant execute on function public.get_project_billing(uuid) to authenticated;
