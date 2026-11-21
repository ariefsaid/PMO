-- 1270 (#2733): project_discipline_revenue gains billed rows beside the validated_progress rows (same signature,
-- same validated_progress rows as 1266, byte-for-byte the same query). Billed = claims and invoices excluding tax:
--   billed_claims    per discipline and currency: amount of live progress-claim lines (claim not withdrawn, its
--                    invoice, if any, not cancelled), by the contract item's discipline;
--   billed_unitemised one row (no discipline): the project's billed work (the work_order_billing_lines rule: invoices
--                    at net plus recovery, a down payment bills 0, unraised claims at gross) less what claim lines itemise.
-- Empty while discipline_profit_enabled is off. Proven by supabase/tests/1270_earned_billed_revenue.test.sql.
-- Reverse: supabase/migrations/rollback/1270_discipline_billed_basis_down.sql (restores 1266's body).
create or replace function public.project_discipline_revenue(p_project uuid)
returns table (basis text, discipline_id uuid, currency text, revenue numeric, validated_lines integer, unrated_lines integer)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.dsr_require_member();
  if not exists (select 1 from public.projects p where p.id = p_project and p.org_id = public.auth_org_id()) then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  if not public.dsr_may_see_revenue(p_project) then
    raise exception 'you cannot see revenue on this project' using errcode = '42501';
  end if;
  if not coalesce((select o.discipline_profit_enabled from public.organizations o where o.id = public.auth_org_id()), false) then
    return;
  end if;
  return query
    select 'validated_progress'::text, b.discipline_id, w.currency,
           coalesce(sum(l.frozen_amount), 0)::numeric, count(*)::integer,
           (count(*) filter (where l.frozen_amount is null))::integer
      from public.dsr_progress_lines l
      join public.daily_site_reports d on d.id = l.report_id
      join public.work_orders w on w.id = d.work_order_id
      join public.work_order_lines wl on wl.id = l.work_order_line_id
      join public.boq_items b on b.id = wl.boq_item_id
     where d.project_id = p_project and d.org_id = public.auth_org_id()
       and d.status = 'validated' and d.superseded_at is null and d.archived_at is null
     group by b.discipline_id, w.currency
     order by b.discipline_id nulls last, w.currency;
  return query
    select 'billed_claims'::text, b.discipline_id, c.currency,
           coalesce(sum(cl.amount), 0)::numeric, count(*)::integer, 0::integer
      from public.progress_claim_lines cl
      join public.progress_claims c on c.id = cl.claim_id and c.org_id = cl.org_id
      join public.boq_items b on b.id = cl.boq_item_id
      left join public.sales_invoices si on si.id = c.id and si.org_id = c.org_id
     where c.project_id = p_project and c.org_id = public.auth_org_id()
       and c.withdrawn_at is null and c.kind = 'progress' and coalesce(si.status, 'Draft') <> 'Cancelled'
     group by b.discipline_id, c.currency
     order by b.discipline_id nulls last, c.currency;
  return query
    with billed as (
      select w.currency, case when w.is_down_payment then 0::numeric else w.net + w.recovery end as amount
        from public.sales_invoice_work_billed w
       where w.project_id = p_project and w.org_id = public.auth_org_id() and w.status <> 'Cancelled' and w.net is not null
      union all
      select pc.currency, case when pc.kind = 'down_payment' then 0::numeric else pc.gross_amount end
        from public.progress_claims pc
       where pc.project_id = p_project and pc.org_id = public.auth_org_id() and pc.withdrawn_at is null
         and not exists (select 1 from public.sales_invoices si where si.id = pc.id)
    ), itemised as (
      select c.currency, sum(cl.amount) as amount
        from public.progress_claim_lines cl
        join public.progress_claims c on c.id = cl.claim_id and c.org_id = cl.org_id
        left join public.sales_invoices si on si.id = c.id and si.org_id = c.org_id
       where c.project_id = p_project and c.org_id = public.auth_org_id()
         and c.withdrawn_at is null and c.kind = 'progress' and coalesce(si.status, 'Draft') <> 'Cancelled'
       group by c.currency
    )
    select 'billed_unitemised'::text, null::uuid, t.currency,
           (t.amount - coalesce(i.amount, 0))::numeric, 0::integer, 0::integer
      from (select b.currency, sum(b.amount) as amount from billed b group by b.currency) t
      left join itemised i on i.currency = t.currency
     where t.amount - coalesce(i.amount, 0) <> 0
     order by t.currency;
end $$;
