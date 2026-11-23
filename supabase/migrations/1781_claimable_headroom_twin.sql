-- 1781_claimable_headroom_twin.sql — survey-cap-stop (part B): the SQL twin of claimableHeadroom (pmo-portal/src/lib/progressBilling.ts),
-- the survey seam part C fills, and the work-order-line facts the claim trigger (1782) reads. Reversal: rollback/1781_..._down.sql.
-- Ceiling precedence (same as the TypeScript): surveyed if present, else accepted (a BAST of zero is a BAST), else ordered; integer milli-units.
create function public.claimable_headroom(p_ordered numeric, p_claimed numeric, p_accepted numeric, p_surveyed numeric)
  returns table (ceiling numeric, basis text, headroom numeric, signed_headroom numeric)
  language sql immutable set search_path = public as $$
  with m as (
    select case when p_surveyed is not null then 'surveyed' when p_accepted is not null then 'accepted' else 'ordered' end as b,
           round(coalesce(p_surveyed, p_accepted, p_ordered) * 1000) as c, round(p_claimed * 1000) as cl)
  select m.c / 1000, m.b, greatest(m.c - m.cl, 0) / 1000, (m.c - m.cl) / 1000 from m
$$;
revoke all on function public.claimable_headroom(numeric, numeric, numeric, numeric) from public, anon, authenticated;

-- The seam: the jointly surveyed quantity for a work-order line. Null until the survey record exists (part C replaces this body).
create function public.survey_quantity_for_line(p_work_order_id uuid, p_boq_item_id uuid)
  returns numeric language sql stable set search_path = public as $$ select null::numeric $$;
revoke all on function public.survey_quantity_for_line(uuid, uuid) from public, anon, authenticated;

-- Already claimed on one work-order line: lines of live claims (not withdrawn, invoice not Cancelled) plus live opening-balance claimed
-- quantities. This is get_project_billing's claimed_alloc (1046) read for one line; supabase/tests/1780 proves the two agree.
create function public.work_order_line_claimed_quantity(p_work_order_id uuid, p_boq_item_id uuid, p_except_claim uuid default null)
  returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(u.q), 0) from (
    select l.quantity as q
      from public.progress_claim_lines l
      join public.progress_claims c on c.id = l.claim_id
      left join public.sales_invoices si on si.id = c.id and si.org_id = c.org_id
     where c.work_order_id = p_work_order_id and l.boq_item_id = p_boq_item_id
       and c.withdrawn_at is null and si.status is distinct from 'Cancelled' and c.id is distinct from p_except_claim
    union all
    select x.claimed_quantity
      from public.opening_balance_lines x
      join public.opening_balances ob on ob.id = x.opening_id
     where ob.work_order_id = p_work_order_id and x.boq_item_id = p_boq_item_id and ob.reversed_at is null and x.claimed_quantity > 0
  ) u
$$;
revoke all on function public.work_order_line_claimed_quantity(uuid, uuid, uuid) from public, anon, authenticated;

-- Accepted on one work-order line: the line of the work order's latest Confirmed acceptance (null when none, or none for this line).
create function public.work_order_line_accepted_quantity(p_work_order_id uuid, p_boq_item_id uuid)
  returns numeric language sql stable security definer set search_path = public as $$
  select (select al.quantity from public.work_order_acceptance_lines al where al.acceptance_id = la.id and al.boq_item_id = p_boq_item_id)
    from (select a.id from public.work_order_acceptances a
           where a.work_order_id = p_work_order_id and a.status = 'Confirmed'
           order by a.confirmed_at desc, a.id desc limit 1) la
$$;
revoke all on function public.work_order_line_accepted_quantity(uuid, uuid) from public, anon, authenticated;

-- The headroom of one work-order line, measured against everything except p_except_claim. No row when the line has no allocation.
create function public.work_order_line_headroom(p_work_order_id uuid, p_boq_item_id uuid, p_except_claim uuid default null)
  returns table (ceiling numeric, basis text, headroom numeric, signed_headroom numeric)
  language sql stable security definer set search_path = public as $$
  select h.*
    from (select sum(wl.quantity) as ordered from public.work_order_lines wl
           where wl.work_order_id = p_work_order_id and wl.boq_item_id = p_boq_item_id having count(*) > 0) o
    cross join lateral public.claimable_headroom(
      o.ordered,
      public.work_order_line_claimed_quantity(p_work_order_id, p_boq_item_id, p_except_claim),
      public.work_order_line_accepted_quantity(p_work_order_id, p_boq_item_id),
      public.survey_quantity_for_line(p_work_order_id, p_boq_item_id)) h
$$;
revoke all on function public.work_order_line_headroom(uuid, uuid, uuid) from public, anon, authenticated;
