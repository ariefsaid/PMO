-- 0337 rollback. Restores the pre-0337 schema and live function/ACL contracts.
-- Lossy allocation mapping: only a BoQ line with exactly one allocation is linked back.

-- Restore latest pre-0337 function and view bodies before removing allocation objects.

alter table public.boq_items add column work_order_id uuid references public.work_orders(id);
update public.boq_items b set work_order_id=x.work_order_id from (
 select boq_item_id,min(work_order_id::text)::uuid work_order_id from public.work_order_lines group by boq_item_id having count(*)=1
) x where x.boq_item_id=b.id;
create index boq_items_work_order_idx on public.boq_items(work_order_id);
create or replace function public.check_boq_item_work_order_same_project() returns trigger
  language plpgsql set search_path = public as $$
begin
  if new.work_order_id is not null
     and (select wo.project_id from public.work_orders wo where wo.id = new.work_order_id)
         is distinct from new.project_id then
    raise exception 'the work order must be on the same project as the bill of quantities line'
      using errcode = '23514';
  end if;
  return new;
end; $$;
create trigger boq_items_zz_check_work_order before insert or update on public.boq_items for each row execute function public.check_boq_item_work_order_same_project();
revoke all on function public.check_boq_item_work_order_same_project() from public,anon,authenticated;
revoke all on public.boq_items from authenticated,anon;
grant select on public.boq_items to authenticated;
grant insert (id,org_id,project_id,work_order_id,item_code,description,unit,quantity,rate) on public.boq_items to authenticated;
grant update (work_order_id,item_code,description,unit,quantity,rate) on public.boq_items to authenticated;
grant delete on public.boq_items to authenticated;
create or replace function public.get_project_billing(p_project_id uuid)
  returns jsonb language sql stable security invoker set search_path = public as $$
  with p as (
    select pr.id, pr.currency,
           case when pr.tax_treatment = 'inclusive' then pr.contract_value - coalesce(pr.tax_amount, 0)
                else pr.contract_value end as contract_net
      from public.projects pr where pr.id = p_project_id
  ),
  counted as (
    select w.is_down_payment, w.net, w.recovery
      from public.sales_invoice_work_billed w join p on p.id = w.project_id
     where w.status in ('Submitted','Unpaid','Paid') and w.net is not null and w.currency = p.currency
  ),
  c as (
    select pc.id, pc.kind, pc.gross_amount, pc.dp_recovery_amount, si.status as si_status
      from public.progress_claims pc
      left join public.sales_invoices si on si.id = pc.id and si.org_id = pc.org_id
     where pc.project_id = p_project_id and pc.withdrawn_at is null
       and si.status is distinct from 'Cancelled'
  ),
  claimed as (
    select l.boq_item_id, sum(l.quantity) as claimed_quantity
      from public.progress_claim_lines l join c on c.id = l.claim_id
     group by l.boq_item_id
  ),
  latest as (
    select e.id, e.month, e.pct_complete
      from public.project_progress_entries e
     where e.project_id = p_project_id
       and e.month <= public.org_current_month(
             (select o.default_timezone from public.organizations o where o.id = public.auth_org_id()), now())
     order by e.month desc
     limit 1
  ),
  assessed as (
    select q.boq_item_id, q.quantity_to_date
      from public.progress_assessment_quantities q join latest l on l.id = q.entry_id
  )
  select jsonb_build_object(
    'currency',      p.currency,
    'contract_net',  p.contract_net,
    'work_billed',   coalesce((select sum(net + recovery) from counted where not is_down_payment), 0),
    'dp_billed',     coalesce((select sum(net) from counted where is_down_payment), 0),
    'dp_recovered',  coalesce((select sum(recovery) from counted where not is_down_payment), 0),
    'not_submitted', coalesce((select sum(gross_amount - dp_recovery_amount) from c
                                where si_status is null or si_status = 'Draft'), 0),
    'assessment',    (select jsonb_build_object('month', l.month, 'pct_complete', l.pct_complete) from latest l),
    'boq',           coalesce((select jsonb_agg(jsonb_build_object(
                                        'boq_item_id', b.id,
                                        'claimed_quantity', coalesce(cl.claimed_quantity, 0),
                                        'assessed_quantity', a.quantity_to_date) order by b.id)
                                 from public.boq_items b
                                 left join claimed cl on cl.boq_item_id = b.id
                                 left join assessed a on a.boq_item_id = b.id
                                where b.project_id = p_project_id), '[]'::jsonb))
  from p
$$;
revoke all on function public.get_project_billing(uuid) from public,anon; grant execute on function public.get_project_billing(uuid) to authenticated;
create or replace function public.record_progress_assessment(
  p_project_id uuid, p_month date, p_quantities jsonb, p_note text default null)
  returns numeric language plpgsql volatile set search_path = public as $$
declare
  v_total numeric;
  v_done  numeric;
  v_pct   numeric;
  v_entry uuid;
begin
  if p_project_id is null or p_month is null or p_quantities is null
     or jsonb_typeof(p_quantities) <> 'array' or jsonb_array_length(p_quantities) = 0 then
    raise exception 'project, month and at least one quantity are required' using errcode = '23502';
  end if;
  if not public.may_record_project_progress(p_project_id) then
    raise exception 'you may record progress only on projects you manage, unless you are Finance, an Executive or an Admin'
      using errcode = '42501';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_quantities) as x(boq_item_id uuid, quantity_to_date numeric)
              where not coalesce(x.quantity_to_date >= 0 and x.quantity_to_date < 'Infinity'::numeric
                                 and x.quantity_to_date = round(x.quantity_to_date, 3), false)) then
    raise exception 'each quantity done to date must be 0 or more with at most 3 decimals' using errcode = '23514';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_quantities) as x(boq_item_id uuid, quantity_to_date numeric)
               left join public.boq_items b on b.id = x.boq_item_id and b.project_id = p_project_id
              where b.id is null) then
    raise exception 'every line must be a bill of quantities line of this project' using errcode = '23514';
  end if;
  if (select count(*) from jsonb_to_recordset(p_quantities) as x(boq_item_id uuid, quantity_to_date numeric))
     <> (select count(distinct x.boq_item_id) from jsonb_to_recordset(p_quantities) as x(boq_item_id uuid, quantity_to_date numeric)) then
    raise exception 'each bill of quantities line may appear once per assessment' using errcode = '23514';
  end if;
  select coalesce(sum(b.quantity * b.rate), 0) into v_total from public.boq_items b where b.project_id = p_project_id;
  if v_total <= 0 then
    raise exception 'this project''s bill of quantities has no value, so percent complete cannot be measured from quantities — record a percent instead'
      using errcode = '23514';
  end if;
  select coalesce(sum(least(x.quantity_to_date, b.quantity) * b.rate), 0) into v_done
    from jsonb_to_recordset(p_quantities) as x(boq_item_id uuid, quantity_to_date numeric)
    join public.boq_items b on b.id = x.boq_item_id;
  v_pct := round(v_done / v_total * 100, 2);

  -- ⚑ 0252: the derived writer is the one path allowed to change a quantity-measured month's percent.
  perform set_config('pmo.derived_pct_write', 'on', true);
  insert into public.project_progress_entries (project_id, month, pct_complete, note)
  values (p_project_id, date_trunc('month', p_month)::date, v_pct, nullif(btrim(p_note), ''))
  on conflict (project_id, month) do update
    set pct_complete = excluded.pct_complete,
        note         = excluded.note
  returning id into v_entry;
  -- Clear the flag at once: it is transaction-local, so leaving it on would let a later direct UPDATE in the
  -- same transaction slip past the guard.
  perform set_config('pmo.derived_pct_write', '', true);

  delete from public.progress_assessment_quantities q
   where q.entry_id = v_entry
     and not exists (select 1 from jsonb_to_recordset(p_quantities) as x(boq_item_id uuid, quantity_to_date numeric)
                      where x.boq_item_id = q.boq_item_id);
  insert into public.progress_assessment_quantities (entry_id, boq_item_id, quantity_to_date)
  select v_entry, x.boq_item_id, x.quantity_to_date
    from jsonb_to_recordset(p_quantities) as x(boq_item_id uuid, quantity_to_date numeric)
  on conflict (entry_id, boq_item_id) do update set quantity_to_date = excluded.quantity_to_date;
  return v_pct;
end; $$;
revoke all on function public.record_progress_assessment(uuid,date,jsonb,text) from public,anon; grant execute on function public.record_progress_assessment(uuid,date,jsonb,text) to authenticated;
create or replace function public.create_progress_claim(
  p_project_id          uuid,
  p_kind                text,
  p_work_order_id       uuid    default null,
  p_lines               jsonb   default null,
  p_down_payment_amount numeric default null,
  p_recovery_pct        numeric default null,
  p_recover_remaining   boolean default false)
  returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org         uuid := public.auth_org_id();
  v_role        user_role := public.auth_role();
  v_project_org uuid;
  v_currency    text;
  v_wo_project  uuid;
  v_wo_status   public.work_order_status;
  v_id          uuid := gen_random_uuid();
  v_item        text;
  v_gross       numeric := 0;
  v_recovery    numeric := 0;
  v_dp_amount   numeric;
  v_dp_pct      numeric;
  v_dp_item     text;
  v_dp_status   text;
  v_dp_found    boolean;
  v_balance     numeric;
begin
  -- SECURITY: membership, role and org re-assertions MUST stay — a SECURITY DEFINER body bypasses RLS.
  perform public.assert_is_active_member();
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'only Admin or Finance may create a progress claim' using errcode = '42501';
  end if;
  -- ⚑ 0262 (OD-BILL-1, DD-BWO-5): the work order's billing lock BEFORE the project row lock — the order every billing
  --   writer uses, so a claim and a native invoice on one work order cannot deadlock.
  if p_work_order_id is not null then
    perform public.lock_work_order_billing(p_work_order_id);
  end if;
  select p.org_id, p.currency into v_project_org, v_currency
    from public.projects p where p.id = p_project_id for update;
  if not found or v_project_org is distinct from v_org then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  if p_work_order_id is not null then
    select wo.project_id, wo.status into v_wo_project, v_wo_status
      from public.work_orders wo where wo.id = p_work_order_id;
    if v_wo_project is distinct from p_project_id then
      raise exception 'the work order must be on the same project as the claim' using errcode = '23514';
    end if;
    if v_wo_status not in ('Issued','Closed') then
      raise exception 'only an issued or closed work order can be billed — this one is %', v_wo_status
        using errcode = 'P0001';
    end if;
  end if;

  if p_kind = 'down_payment' then
    if p_lines is not null or coalesce(p_recover_remaining, false) then
      raise exception 'a down payment claim has no quantity lines and recovers nothing' using errcode = 'P0001';
    end if;
    if not coalesce(p_down_payment_amount > 0 and p_down_payment_amount < 'Infinity'::numeric
                    and p_down_payment_amount = round(p_down_payment_amount, 2), false) then
      raise exception 'the down payment amount must be a positive number with at most 2 decimals' using errcode = '23514';
    end if;
    if not coalesce(p_recovery_pct > 0 and p_recovery_pct <= 100 and p_recovery_pct = round(p_recovery_pct, 3), false) then
      raise exception 'the recovery percentage must be above 0 and at most 100, with at most 3 decimals' using errcode = '23514';
    end if;
    select o.down_payment_item into v_item from public.organizations o where o.id = v_org;
    if v_item is null then
      raise exception 'set the down payment item in Administration → Accounting before billing a down payment'
        using errcode = 'P0001';
    end if;
    if exists (select 1 from public.progress_claims pc
                 left join public.sales_invoices si on si.id = pc.id
                where pc.project_id = p_project_id and pc.kind = 'down_payment'
                  and pc.withdrawn_at is null and si.status is distinct from 'Cancelled') then
      raise exception 'this project already has a down payment — withdraw it or cancel its invoice before billing another'
        using errcode = 'P0001';
    end if;
    insert into public.progress_claims (id, org_id, project_id, work_order_id, kind, currency, gross_amount,
                                        down_payment_amount, recovery_pct, dp_recovery_amount, dp_item_code, created_by)
    values (v_id, v_org, p_project_id, p_work_order_id, 'down_payment', v_currency, p_down_payment_amount,
            p_down_payment_amount, p_recovery_pct, 0, v_item, auth.uid());
    v_gross := p_down_payment_amount;

  elsif p_kind = 'progress' then
    if p_down_payment_amount is not null or p_recovery_pct is not null then
      raise exception 'a progress claim states quantities, not a down payment' using errcode = 'P0001';
    end if;
    if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
      raise exception 'a progress claim needs at least one quantity line' using errcode = 'P0001';
    end if;
    if jsonb_array_length(p_lines) > 500 then
      raise exception 'a progress claim may have at most 500 lines' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)
                where not coalesce(x.quantity > 0 and x.quantity < 'Infinity'::numeric
                                   and x.quantity = round(x.quantity, 3), false)) then
      raise exception 'each quantity must be a positive number with at most 3 decimals' using errcode = '23514';
    end if;
    if exists (select 1 from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)
                 left join public.boq_items b on b.id = x.boq_item_id and b.project_id = p_project_id
                where b.id is null or b.work_order_id is distinct from p_work_order_id) then
      raise exception 'every line must be a bill of quantities line of this project and of the claim''s work order (or of no work order when the claim names none)'
        using errcode = '23514';
    end if;
    if (select count(*) from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric))
       <> (select count(distinct x.boq_item_id) from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)) then
      raise exception 'each bill of quantities line may appear once per claim' using errcode = '23514';
    end if;

    select coalesce(sum(round(x.quantity * b.rate, 2)), 0) into v_gross
      from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)
      join public.boq_items b on b.id = x.boq_item_id;

    select pc.down_payment_amount, pc.recovery_pct, pc.dp_item_code, si.status
      into v_dp_amount, v_dp_pct, v_dp_item, v_dp_status
      from public.progress_claims pc
      left join public.sales_invoices si on si.id = pc.id
     where pc.project_id = p_project_id and pc.kind = 'down_payment'
       and pc.withdrawn_at is null and si.status is distinct from 'Cancelled';
    v_dp_found := found;

    if v_dp_found then
      if v_dp_status is null or v_dp_status not in ('Submitted','Unpaid','Paid') then
        raise exception 'the down payment invoice has not been submitted yet: submit it (or withdraw the down payment) before claiming progress'
          using errcode = 'P0001';
      end if;
      select v_dp_amount - coalesce(sum(pc.dp_recovery_amount), 0) into v_balance
        from public.progress_claims pc
        left join public.sales_invoices si on si.id = pc.id
       where pc.project_id = p_project_id and pc.kind = 'progress'
         and pc.withdrawn_at is null and si.status is distinct from 'Cancelled';
      v_balance := greatest(v_balance, 0);
      if coalesce(p_recover_remaining, false) then
        v_recovery := least(v_balance, v_gross);
      else
        v_recovery := least(round(v_gross * v_dp_pct / 100, 2), v_balance);
      end if;
    elsif coalesce(p_recover_remaining, false) then
      raise exception 'there is no down payment to recover on this project' using errcode = 'P0001';
    end if;

    -- ⚑ 0262 (OD-BILL-1, DD-BWO-4): a claim reserves its gross against its work order when it is created.
    if p_work_order_id is not null then
      perform public.assert_work_order_invoiceable(v_org, p_work_order_id, p_project_id, v_id::text, v_gross, v_currency);
    end if;

    insert into public.progress_claims (id, org_id, project_id, work_order_id, kind, currency, gross_amount,
                                        dp_recovery_amount, dp_item_code, created_by)
    values (v_id, v_org, p_project_id, p_work_order_id, 'progress', v_currency, v_gross,
            v_recovery, case when v_recovery > 0 then v_dp_item end, auth.uid());
    insert into public.progress_claim_lines (org_id, claim_id, boq_item_id, item_code, description, unit,
                                             quantity, rate, amount)
    select v_org, v_id, b.id, b.item_code, b.description, b.unit, x.quantity, b.rate, round(x.quantity * b.rate, 2)
      from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)
      join public.boq_items b on b.id = x.boq_item_id;
  else
    raise exception 'a claim is either a down_payment or a progress claim, not %', coalesce(p_kind, 'null')
      using errcode = '22023';
  end if;

  perform public.log_audit('progress_claim.create', v_org, auth.uid(), v_id,
    jsonb_build_object('project_id', p_project_id, 'kind', p_kind, 'work_order_id', p_work_order_id,
                       'gross_amount', v_gross, 'dp_recovery_amount', v_recovery));
  return v_id;
end; $$;
revoke all on function public.create_progress_claim(uuid,text,uuid,jsonb,numeric,numeric,boolean) from public,anon; grant execute on function public.create_progress_claim(uuid,text,uuid,jsonb,numeric,numeric,boolean) to authenticated;
create or replace function public.assert_work_order_invoiceable(
  p_org_id uuid, p_work_order_id uuid, p_project_id uuid, p_record_id text, p_billed numeric, p_currency text)
  returns void language plpgsql volatile set search_path = public as $$
declare
  v_org      uuid;
  v_project  uuid;
  v_status   public.work_order_status;
  v_currency text;
  v_label    text;
  v_net      numeric;
  v_existing numeric;
  v_unknown  boolean;
begin
  -- Taken FIRST, so every read below sees each billing write that committed before this one (DD-BWO-5).
  perform public.lock_work_order_billing(p_work_order_id);

  select wo.org_id, wo.project_id, wo.status, wo.currency, coalesce(wo.wo_number, wo.title),
         case when wo.tax_treatment = 'inclusive' then wo.order_value - wo.tax_amount else wo.order_value end
    into v_org, v_project, v_status, v_currency, v_label, v_net
    from public.work_orders wo where wo.id = p_work_order_id;
  if not found or v_org is distinct from p_org_id then
    raise exception 'work order not found' using errcode = 'BW001';
  end if;
  if v_project is distinct from p_project_id then
    raise exception 'the work order must be on the same project as the invoice' using errcode = 'BW001';
  end if;
  if v_status not in ('Issued', 'Closed') then
    raise exception 'work order % is %: only an issued or closed work order can be invoiced', v_label, v_status
      using errcode = 'BW001';
  end if;
  if p_currency is not null and p_currency is distinct from v_currency then
    raise exception 'this invoice is in % but work order % is in %: a work order is invoiced in its own currency',
      p_currency, v_label, v_currency using errcode = 'BW001';
  end if;
  -- `< 'Infinity'` is what rejects NaN (NaN sorts above every value) — the 0169/0193 construction.
  if p_billed is null or not (p_billed > '-Infinity'::numeric and p_billed < 'Infinity'::numeric) then
    raise exception 'the invoice amount could not be read, so it cannot be checked against work order %', v_label
      using errcode = 'BW001';
  end if;
  -- A claim is never negative and a down payment bills 0: a negative amount would only open room on the work order.
  if p_billed < 0 then
    raise exception 'an invoice cannot bill a negative amount against work order %', v_label using errcode = 'BW001';
  end if;

  with lines as (
    -- what the views count (mirrored invoices + unraised claims), minus the record being written
    select l.record_id::text as record_id, l.billed, l.currency
      from public.work_order_billing_lines l
     where l.org_id = p_org_id and l.work_order_id = p_work_order_id and l.record_id::text <> lower(p_record_id)
    union all
    -- ERP commands still in flight (not yet mirrored, or an edit/amend not yet read back). A claim's own command is
    -- excluded: the claim already counts at gross. A command with no line array rebuilds no body and moves no money.
    select lower(o.pmo_record_id), public.invoice_command_line_total(o.payload), v_currency
      from public.external_command_outbox o
     where o.org_id = p_org_id and o.domain = 'revenue'
       and o.state in ('pending', 'committing', 'committed', 'quarantined', 'held')
       and o.payload ->> 'erp_doc_kind' = 'sales-invoice'
       and jsonb_typeof(o.payload -> 'items') = 'array'
       and (o.operation in ('create', 'update') or (o.operation = 'transition' and o.payload ->> 'verb' = 'amend'))
       and lower(o.pmo_record_id) <> lower(p_record_id)
       -- Joined on the uuid so the primary keys can seek. The CASE (evaluated in order) turns an id that is not a uuid's
       -- text into NULL instead of a cast error — the same rows the text comparison matched, and only those.
       and not exists (select 1 from public.progress_claims pc
                        where pc.id = case when lower(o.pmo_record_id) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                                           then lower(o.pmo_record_id)::uuid end
                          and pc.org_id = p_org_id)
       and lower(coalesce(nullif(btrim(o.payload ->> 'workOrderId'), ''),
                          (select si.work_order_id::text from public.sales_invoices si
                            where si.id = case when lower(o.pmo_record_id) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                                               then lower(o.pmo_record_id)::uuid end
                              and si.org_id = p_org_id))) = p_work_order_id::text
  ), per_record as (
    -- an invoice with an edit in flight counts at the larger of its mirrored and its pending amount
    select record_id, max(billed) as billed,
           bool_or(billed is null or currency is distinct from v_currency) as unknown
      from lines group by record_id
  )
  select coalesce(sum(billed), 0), coalesce(bool_or(unknown), false)
    into v_existing, v_unknown
    from per_record;

  if v_unknown then
    raise exception 'an invoice on work order % has no amount or is in another currency, so what is still to invoice cannot be checked',
      v_label using errcode = 'BW001';
  end if;
  if v_existing + p_billed > v_net then
    raise exception 'this invoice would bill % against work order % (worth % excl. tax, with % already invoiced or in draft): only % is still to invoice',
      round(p_billed, 2), v_label, round(v_net, 2), round(v_existing, 2), round(greatest(v_net - v_existing, 0), 2)
      using errcode = 'BW001';
  end if;
end; $$;
revoke all on function public.assert_work_order_invoiceable(uuid,uuid,uuid,text,numeric,text) from public,anon,authenticated;
drop view public.work_order_billing;
create view public.work_order_billing with (security_invoker = true) as
  select wo.id as work_order_id, wo.org_id, wo.project_id, wo.status, wo.wo_number, wo.title, wo.closed_at, wo.currency,
         case when wo.tax_treatment = 'inclusive' then wo.order_value - wo.tax_amount else wo.order_value end as order_net,
         coalesce(sum(l.billed) filter (where l.submitted), 0) as invoiced,
         coalesce(sum(l.billed) filter (where not l.submitted), 0) as pending,
         coalesce(sum(l.billed) filter (where l.paid), 0) as paid,
         (case when wo.tax_treatment = 'inclusive' then wo.order_value - wo.tax_amount else wo.order_value end)
           - coalesce(sum(l.billed), 0) as remaining,
         coalesce(bool_and(l.billed is not null and l.currency = wo.currency)
                    filter (where l.record_id is not null), true) as figures_complete,
         count(l.record_id)::int as line_count,
         (count(l.record_id) filter (where l.submitted and not l.paid))::int as unpaid_count
    from public.work_orders wo
    left join public.work_order_billing_lines l on l.work_order_id = wo.id and l.org_id = wo.org_id
   group by wo.id;
revoke all on public.work_order_billing from public,anon,authenticated; grant select on public.work_order_billing to authenticated;
create or replace function public.get_project_drawdown(p_project_id uuid)
  returns table (committed numeric, draft numeric, ceiling numeric, currency text, basis text)
  language sql stable security invoker set search_path = public as $$
  -- `wo.tax_treatment` is a flat NOT NULL on work_orders (0193), so its branch is total. The
  -- project's is conditional (§1), and `is not distinct from` is NOT needed: a NULL treatment only
  -- ever accompanies contract_value = 0, where net and gross are the same number anyway.
  select coalesce(sum(case when wo.tax_treatment = 'inclusive' then wo.order_value - wo.tax_amount
                           else wo.order_value end)
                  filter (where wo.status in ('Issued','Closed')), 0)::numeric,
         coalesce(sum(case when wo.tax_treatment = 'inclusive' then wo.order_value - wo.tax_amount
                           else wo.order_value end)
                  filter (where wo.status = 'Draft'), 0)::numeric,
         (case when p.tax_treatment = 'inclusive' then p.contract_value - coalesce(p.tax_amount, 0)
               else p.contract_value end)::numeric,
         p.currency,
         'net'::text
    from public.projects p
    left join public.work_orders wo on wo.project_id = p.id
   where p.id = p_project_id
   group by p.id, p.contract_value, p.tax_treatment, p.tax_amount, p.currency
$$;
revoke all on function public.get_project_drawdown(uuid) from public; grant execute on function public.get_project_drawdown(uuid) to authenticated; revoke execute on function public.get_project_drawdown(uuid) from anon;
create or replace function public.transition_work_order(
  p_id uuid,
  p_to public.work_order_status,
  p_over_commit_ack boolean default null)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_from       public.work_order_status;
  v_org        uuid;
  v_project    uuid;
  v_value      numeric;
  v_set_by     uuid;
  v_set_at     timestamptz;
  v_number     text;
  v_role       user_role := auth_role();
  v_ceiling    numeric;
  v_treatment  text;      -- #513: this work order's own tax basis
  v_tax        numeric;   -- #513: this work order's own tax amount
  v_net        numeric;   -- #513: v_value normalised to net
  v_committed  numeric;
  v_exceeds    boolean := false;
  v_ack_by     uuid;
  v_ack_at     timestamptz;
  v_legal jsonb := jsonb_build_object(
    'Draft',     jsonb_build_array('Issued','Cancelled'),
    'Issued',    jsonb_build_array('Closed','Cancelled'),
    'Closed',    jsonb_build_array(),
    'Cancelled', jsonb_build_array()
  );
begin
  -- Load + lock the work order. The witness pair is read under the SAME lock as the value it
  -- witnesses — a concurrent set_work_order_value takes that lock too, so they cannot be read torn.
  -- ⚑ #513: this row's OWN tax facts are read under the SAME lock as its value, for the same reason
  -- the witness pair is — a basis read separately from the figure it describes can be read torn.
  select status, org_id, project_id, order_value, order_value_set_by, order_value_set_at, wo_number,
         tax_treatment, tax_amount
    into v_from, v_org, v_project, v_value, v_set_by, v_set_at, v_number,
         v_treatment, v_tax
    from public.work_orders where id = p_id for update;
  if v_from is null then
    raise exception 'work order not found' using errcode = 'P0002';
  end if;

  -- SECURITY: this org re-assertion MUST stay — removing it leaks cross-org transitions.
  if v_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- SECURITY: this active-membership gate MUST stay — see the twin comment in set_work_order_value.
  perform public.assert_is_active_member();

  -- Coarse role gate (the transition_project shape: revenue is not procurement, so there is no
  -- per-transition matrix). SECURITY: MUST stay — without it any authenticated user may issue.
  if v_role is null or v_role not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Transition-map legality: (from,to) must be in the data map and not a no-op.
  if p_to = v_from or not (v_legal -> v_from::text) ? p_to::text then
    raise exception 'illegal transition % -> %', v_from, p_to using errcode = 'P0001';
  end if;

  -- The acknowledgement is meaningful ONLY on the issue step. Accepting it elsewhere would let a
  -- client attach it to every call and turn it into noise.
  if p_to is distinct from 'Issued' and p_over_commit_ack is not null then
    raise exception
      'the over-commitment acknowledgement applies only to issuing a work order, not to a % transition',
      p_to
      using errcode = 'P0001';
  end if;

  if p_to = 'Issued' then
    -- ── THE MONEY SoD. SECURITY: this block MUST stay. Without it one person sets the value on a
    -- Draft, issues it alone, and books client revenue at a figure NOBODY ELSE EVER APPROVED.
    -- Every clause is TOTAL (`is distinct from`, an explicit `is null` branch, helpers that all
    -- coalesce to FALSE) because a NULL-valued condition does not fire an `if` — the exact defect
    -- 0176 §6 had to repair in four other guards.
    --   (i)   there is money on the row              -> otherwise there is nothing to ratify;
    --   (ii)  the ISSUER does not themselves hold won-value authority -> a Finance/Exec/Admin issuer
    --         is already the accountable party and needs nobody;
    --   (iii) the value was authored by a DISTINCT, ACTIVE person who may approve THIS issuer's work.
    --         The direction matters and is easy to get backwards: the question is not "may the issuer
    --         approve the author?" but "did someone with authority OVER THE ISSUER put their name on
    --         this number?" A PM whose line manager set the value is cleared; a PM whose PEER set it
    --         is not.
    if coalesce(v_value, 0) > 0
       and not public.holds_won_value_authority(v_role)
       and (    v_set_at is null                                   -- never witnessed -> FAIL CLOSED
             or v_set_by is null                                   -- unattributed    -> FAIL CLOSED
             or v_set_by is not distinct from auth.uid()           -- issuer authored it themselves
             or not public.is_active_member(v_set_by)              -- witness offboarded / banned
             or not public.may_approve_work_of(v_set_by, auth.uid()) )
    then
      if v_set_at is null or v_set_by is null then
        raise exception
          'this work order''s value has no recorded author, so you cannot issue it: the value must be set by your supervisor or by someone who outranks you, through set_work_order_value (which records who set it) — or ask them to issue it'
          using errcode = '42501';
      elsif v_set_by is not distinct from auth.uid() then
        raise exception
          'you set this work order''s value yourself, so you cannot also issue it: the value must be confirmed by your supervisor or by someone who outranks you, through set_work_order_value (which records who set it) — or ask them to issue it'
          using errcode = '42501';
      elsif not public.is_active_member(v_set_by) then
        -- Ordered BEFORE the seniority branch: an offboarded peer is offboarded first and not-senior
        -- second, and the operator needs "get someone who is still here".
        raise exception
          'this work order''s value was set by someone who is no longer an active member of this organisation, so you cannot issue it: it must be re-set by your supervisor or by someone who outranks you who is currently active, through set_work_order_value (which records who set it) — or ask them to issue it'
          using errcode = '42501';
      else
        raise exception
          'this work order''s value was not set by anyone senior to you, so you cannot issue it: it must be confirmed by your supervisor or by someone who outranks you, through set_work_order_value (which records who set it) — or ask them to issue it'
          using errcode = '42501';
      end if;
    end if;

    -- ── THE DRAWDOWN, COMPUTED UNDER THE PARENT'S LOCK (DD-WO-2). Locking the project row is what
    -- serializes two concurrent issues on the SAME project: without it both read the same committed
    -- total, both decide they fit, and the pair lands over the ceiling with no acknowledgement.
    -- ⚑ #513: EVERY figure below is NET. Before this, the gate compared a work order's stated
    -- `order_value` against a `contract_value` with no tax basis at all, so an exclusive WO under an
    -- inclusive ceiling made the drawdown look SMALLER than it is — the control UNDER-detected the
    -- over-commitment it exists to detect, and nobody was ever asked to acknowledge it. The
    -- normalisation here is byte-identical to `get_project_drawdown`'s (§3), deliberately: a gate
    -- that computes the drawdown differently from the screen showing it is worse than either being
    -- wrong alone, because the two disagree and neither is visibly at fault.
    select (case when p.tax_treatment = 'inclusive' then p.contract_value - coalesce(p.tax_amount, 0)
                 else p.contract_value end)
      into v_ceiling
      from public.projects p where p.id = v_project for update;
    if v_ceiling is null then
      raise exception 'work order parent project not found' using errcode = 'P0002';
    end if;

    select coalesce(sum(case when wo.tax_treatment = 'inclusive' then wo.order_value - wo.tax_amount
                             else wo.order_value end), 0)
      into v_committed
      from public.work_orders wo
     where wo.project_id = v_project and wo.status in ('Issued','Closed');

    v_net := case when v_treatment = 'inclusive' then coalesce(v_value, 0) - coalesce(v_tax, 0)
                  else coalesce(v_value, 0) end;

    v_exceeds := (v_committed + v_net) > v_ceiling;

    -- FAIL CLOSED: the acknowledgement is never assumed. `is not true` covers both NULL (the caller
    -- said nothing) and false (the caller explicitly declined) — a `= false` test would let an
    -- omitted parameter through.
    if v_exceeds and p_over_commit_ack is not true then
      raise exception
        'issuing this work order would commit % against a contract ceiling of % (already committed: %): this is allowed, but it must be acknowledged explicitly — re-issue with the over-commitment acknowledgement so the decision is recorded against your name',
        v_committed + v_net, v_ceiling, v_committed
        using errcode = 'P0001';
    end if;

    -- The mirror of fail-closed: an acknowledgement with nothing to acknowledge is refused rather
    -- than accepted-and-ignored. If it were ignored, a client could send it unconditionally and the
    -- stamp would stop meaning "a person looked at an over-commitment and chose it".
    if p_over_commit_ack is not null and not v_exceeds then
      raise exception
        'there is no over-commitment to acknowledge: committing % leaves the contract ceiling of % intact',
        v_committed + v_net, v_ceiling
        using errcode = 'P0001';
    end if;

    if v_exceeds then
      v_ack_by := auth.uid();
      v_ack_at := now();
    end if;

    -- Mint the document number (once) and stamp the issue. `coalesce` rather than an unconditional
    -- mint so a re-run can never burn a second number on the same row.
    update public.work_orders set
      status             = p_to,
      wo_number          = coalesce(wo_number, public.next_procurement_doc_number(v_org, 'WO')),
      issued_by          = auth.uid(),
      issued_at          = now(),
      over_commit_ack_by = v_ack_by,
      over_commit_ack_at = v_ack_at
    where id = p_id;

  elsif p_to = 'Closed' then
    update public.work_orders set status = p_to, closed_at = now() where id = p_id;
  else  -- 'Cancelled'
    update public.work_orders set status = p_to, cancelled_at = now() where id = p_id;
  end if;

  perform public.log_audit('work_order.transition', v_org, auth.uid(), p_id,
                           jsonb_build_object('from',               v_from::text,
                                              'to',                 p_to::text,
                                              'project_id',         v_project,
                                              'order_value',        v_value,
                                              'order_value_set_by', v_set_by,
                                              'order_value_set_at', v_set_at,
                                              'contract_ceiling',   v_ceiling,
                                              'committed_before',   v_committed,
                                              'over_commit_ack_by', v_ack_by));
end; $$;
create or replace function public.api_client_request_guard()
  returns void
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  -- API CLIENT SURFACE — keep in step with scripts/pmo.mjs.
  write_tables constant text[] := array['projects', 'project_milestones', 'tasks', 'meetings', 'crm_activities', 'companies', 'contacts'];
  read_only_tables constant text[] := array['profiles', 'external_domain_ownership'];
  rpcs constant text[] := array['get_project_milestones'];
  -- ACTIVE-ADMIN TIER (`pmo load`, #796) — keep in step with scripts/pmo.mjs LOAD_TABLES / LOAD_RPCS.
  admin_write_tables constant text[] := array['budget_versions', 'budget_line_items'];
  admin_rpcs constant text[] := array['set_project_contract_value', 'transition_project'];
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  headers jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  method text := current_setting('request.method', true);
  path text := coalesce(current_setting('request.path', true), '');
  target text;
begin
  if claims is null or not (claims ? 'client_id') then
    return; -- not an OAuth API client: nothing to decide here
  end if;

  if coalesce(headers ->> 'accept-profile', 'public') <> 'public'
     or coalesce(headers ->> 'content-profile', 'public') <> 'public' then
    raise exception using errcode = '42501',
      message = 'OAuth API clients may use the public schema only';
  end if;

  -- `Prefer: resolution=merge-duplicates|ignore-duplicates` turns a POST into an upsert (an UPDATE on
  -- conflict), which would let a POST-only grant edit rows. The CLI never sends it; refuse it everywhere.
  if coalesce(headers ->> 'prefer', '') ilike '%resolution=%' then
    raise exception using errcode = '42501',
      message = 'OAuth API clients may not upsert (Prefer: resolution=)';
  end if;

  if path like '/rpc/%' then
    target := substr(path, 6);
    if method = 'POST' and target = any (rpcs) then
      return;
    end if;
    if method = 'POST' and target = any (admin_rpcs) then
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then
        return;
      end if;
    end if;
  else
    target := substr(path, 2); -- exact table name; anything longer matches no list entry
    if method = 'GET' and (target = any (write_tables) or target = any (read_only_tables)) then
      return;
    end if;
    if method in ('POST', 'PATCH') and target = any (write_tables) then
      return;
    end if;
    if method in ('GET', 'POST') and target = any (admin_write_tables) then
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then
        return;
      end if;
    end if;
  end if;

  raise exception using errcode = '42501',
    message = format('%s %s is not available to OAuth API clients', method, path),
    hint = 'The API client surface is documented in docs/runbooks/pmo-cli.md';
end;
$$;
revoke all on function public.api_client_request_guard() from public; grant execute on function public.api_client_request_guard() to anon,authenticated,service_role; notify pgrst, 'reload config';

drop trigger if exists work_orders_zzzz_closing_guard on public.work_orders;
drop function if exists public.guard_work_order_closing_value();
drop trigger if exists work_order_acceptance_lines_immutable on public.work_order_acceptance_lines;
drop trigger if exists work_order_acceptances_immutable on public.work_order_acceptances;
drop function if exists public.guard_work_order_acceptance_line_immutable();
drop function if exists public.guard_work_order_acceptance_immutable();
drop function if exists public.confirm_work_order_acceptance(uuid);
drop function if exists public.withdraw_work_order_acceptance(uuid);
drop function if exists public.prepare_work_order_acceptance(uuid,date,boolean,jsonb,uuid,text,uuid);
drop trigger if exists work_order_lines_zz_scope on public.work_order_lines;
drop function if exists public.check_work_order_line_scope();
alter table public.work_orders drop constraint if exists work_orders_closing_pair;
alter table public.work_orders drop column if exists closing_acceptance_id;
alter table public.work_orders drop column if exists closing_value;
update public.record_history_config set captured=captured - 'closing_value' - 'closing_acceptance_id' where table_name='work_orders';
drop table if exists public.work_order_acceptance_lines;
drop table if exists public.work_order_acceptances;
drop table if exists public.work_order_lines;
drop index if exists public.boq_items_project_line_order_idx;
alter table public.boq_items drop constraint if exists boq_items_project_import_key;
alter table public.boq_items drop constraint if exists boq_items_lump_sum_quantity;
alter table public.boq_items drop constraint if exists boq_items_earning_basis_check;
alter table public.boq_items drop column if exists import_key;
alter table public.boq_items drop column if exists line_no;
alter table public.boq_items drop column if exists earning_basis;
