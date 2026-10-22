-- Reverse 0343 money-integrity serialization changes.
drop trigger if exists expense_claim_lines_lock_edit on public.expense_claim_lines;
drop function if exists public.lock_expense_claim_line_edit();
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
                where b.id is null or (p_work_order_id is not null and not exists(select 1 from public.work_order_lines wl where wl.boq_item_id=b.id and wl.work_order_id=p_work_order_id)) or (p_work_order_id is null and exists(select 1 from public.work_order_lines wl where wl.boq_item_id=b.id))) then
      raise exception 'every line must be allocated to the selected work order, or have no allocation for a project-level claim'
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
revoke all on function public.create_progress_claim(uuid, text, uuid, jsonb, numeric, numeric, boolean) from public, anon;
grant execute on function public.create_progress_claim(uuid, text, uuid, jsonb, numeric, numeric, boolean) to authenticated;
create or replace function public.sync_expense_claim_amount() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_claim uuid := coalesce(new.claim_id, old.claim_id);
begin
  update public.expense_claims c
     set amount = coalesce((select sum(l.amount) from public.expense_claim_lines l where l.claim_id = v_claim), 0)
   where c.id = v_claim and c.kind = 'claim';
  return null;
end; $$;
revoke all on function public.sync_expense_claim_amount() from public,anon,authenticated;
