-- 1046_opening_balances_down.sql — reverses 1046. Refuses while any opening was ever loaded: an opening stock document
-- and its ledger rows are append-only (ADR-0097), so a loaded organisation is rolled back by `supabase db reset`, not here.
do $$ begin
  if exists (select 1 from public.opening_balances) then
    raise exception '1046 down: opening balances exist; reset the database instead';
  end if;
end $$;

create or replace view public.work_order_billing_lines with (security_invoker = true) as
  select w.id as record_id, w.org_id, w.work_order_id, w.currency,
         case when w.is_down_payment then 0::numeric else w.net + w.recovery end as billed,
         (w.status in ('Submitted', 'Unpaid', 'Paid')) as submitted,
         (w.status = 'Paid') as paid
    from public.sales_invoice_work_billed w
   where w.work_order_id is not null and w.status <> 'Cancelled'
  union all
  select pc.id, pc.org_id, pc.work_order_id, pc.currency,
         case when pc.kind = 'down_payment' then 0::numeric else pc.gross_amount end,
         false, false
    from public.progress_claims pc
   where pc.work_order_id is not null and pc.withdrawn_at is null
     and not exists (select 1 from public.sales_invoices si where si.id = pc.id);

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
$$;
revoke all on function public.get_project_billing(uuid) from public,anon;
grant execute on function public.get_project_billing(uuid) to authenticated;

create or replace function public.billing_reconciliation(p_project uuid, p_work_order uuid default null)
  returns table (boq_item_id uuid, item_code text, description text, unit text, rate numeric, line_no integer,
                 scope_qty numeric, progress_qty numeric, measured_qty numeric, billed_qty numeric, billed_amount numeric,
                 unbilled_qty numeric, surplus_qty numeric, status text)
  language sql stable security invoker set search_path = public as $$
  with scope as (
    select b.id, b.item_code, b.description, b.unit, b.rate, b.line_no,
           case when p_work_order is null then b.quantity else wl.quantity end as qty,
           p_work_order is not null
             and exists (select 1 from public.work_order_lines o where o.boq_item_id = b.id and o.work_order_id <> p_work_order) as shared
      from public.boq_items b
      left join public.work_order_lines wl on wl.boq_item_id = b.id and wl.work_order_id = p_work_order
     where b.project_id = p_project
       and (p_work_order is null or wl.id is not null)
  ),
  progress as (
    select distinct on (q.boq_item_id) q.boq_item_id, q.quantity_to_date
      from public.progress_assessment_quantities q
      join public.project_progress_entries e on e.id = q.entry_id
     where e.project_id = p_project
     order by q.boq_item_id, e.month desc
  ),
  claimed as (
    select l.boq_item_id,
           sum(l.quantity) filter (where pc.withdrawn_at is null) as measured,
           sum(l.quantity) filter (where si.id is not null and si.status <> 'Cancelled')                    as billed,
           sum(l.amount)   filter (where si.id is not null and si.status <> 'Cancelled')                    as billed_amount
      from public.progress_claim_lines l
      join public.progress_claims pc on pc.id = l.claim_id
      left join public.sales_invoices si on si.id = pc.id and si.org_id = pc.org_id
     where pc.project_id = p_project and pc.kind = 'progress'
       and (p_work_order is null or pc.work_order_id = p_work_order)
     group by l.boq_item_id
  )
  select s.id, s.item_code, s.description, s.unit, s.rate, s.line_no,
         s.qty,
         case when s.shared then null else coalesce(p.quantity_to_date, 0) end,
         coalesce(c.measured, 0),
         coalesce(c.billed, 0),
         coalesce(c.billed_amount, 0),
         case when s.shared then null else greatest(coalesce(p.quantity_to_date, 0) - coalesce(c.billed, 0), 0) end,
         greatest(greatest(case when s.shared then 0 else coalesce(p.quantity_to_date, 0) end, coalesce(c.billed, 0)) - s.qty, 0),
         case when coalesce(c.billed, 0) = 0 then 'unbilled'
              when c.billed > s.qty then 'surplus'
              when c.billed = s.qty then 'fully_billed'
              else 'partly_billed' end
    from scope s
    left join progress p on p.boq_item_id = s.id
    left join claimed c on c.boq_item_id = s.id
   order by s.line_no nulls last, s.item_code
$$;
revoke all on function public.billing_reconciliation(uuid, uuid) from public, anon;
grant execute on function public.billing_reconciliation(uuid, uuid) to authenticated, service_role;

create or replace function public.guard_work_order_acceptance_immutable() returns trigger
 language plpgsql set search_path=public as $$
begin
 if tg_op='DELETE' then
   if old.status='Confirmed' or old.status='Withdrawn' then raise exception 'acceptance is immutable' using errcode='42501'; end if;
   raise exception 'acceptances are managed by their RPC' using errcode='42501';
 end if;
 if old.status<>'Draft' or (new.id,new.org_id,new.project_id,new.work_order_id) is distinct from (old.id,old.org_id,old.project_id,old.work_order_id) then
   raise exception 'acceptance is immutable' using errcode='42501';
 end if;
 return new;
end; $$;
create or replace function public.guard_work_order_acceptance_line_immutable() returns trigger
 language plpgsql set search_path=public as $$
declare v_status text;
begin
 select status into v_status from public.work_order_acceptances where id=coalesce(new.acceptance_id,old.acceptance_id);
 if v_status is distinct from 'Draft' or (tg_op='DELETE' and coalesce(current_setting('pmo.replace_work_order_acceptance',true),'')<>'on') then raise exception 'acceptance lines are immutable outside draft replacement' using errcode='42501'; end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end; $$;
revoke all on function public.guard_work_order_acceptance_immutable() from public,anon,authenticated;
revoke all on function public.guard_work_order_acceptance_line_immutable() from public,anon,authenticated;

create or replace function public.stock_doc_prefix(p_kind text) returns text language sql immutable as $$
  select case p_kind when 'receive' then 'RCV' when 'transfer' then 'TRF' when 'issue' then 'ISS'
                     when 'return' then 'RTN' when 'adjustment' then 'ADJ' when 'count' then 'CNT' end $$;

drop function if exists public.opening_balance_report();
drop function if exists public.reverse_opening_balance(uuid);
drop function if exists public.load_stock_opening(uuid, date, jsonb, text);
drop function if exists public.load_work_order_opening(uuid, date, jsonb, text);
drop function if exists public.opening_work_order_has_activity(uuid, uuid);
drop function if exists public.opening_assert_load(uuid, date);
drop table if exists public.opening_balance_lines;
drop table if exists public.opening_balances;

alter table public.stock_documents drop constraint stock_documents_kind_check;
alter table public.stock_documents add constraint stock_documents_kind_check
  check (kind in ('receive','transfer','issue','return','adjustment','count'));
alter table public.work_order_acceptances drop constraint work_order_acceptances_confirm_basis_check;
alter table public.work_order_acceptances add constraint work_order_acceptances_confirm_basis_check
  check (confirm_basis in ('standard','sole_operator'));
