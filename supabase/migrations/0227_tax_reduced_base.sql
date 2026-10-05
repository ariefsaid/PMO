-- #798: exact reduced tax bases on existing tax-bearing records.
-- Reversal: restore the four RPC definitions from 0196/0197 and pipeline from 0223;
-- drop the triggers/functions introduced here, then the two tax_base columns on each table.
-- Stored amounts are not backfilled or reinterpreted by this migration.

alter table public.projects
  add column tax_base_numerator integer not null default 1,
  add column tax_base_denominator integer not null default 1,
  add constraint projects_tax_base_fraction check
    (tax_base_numerator > 0 and tax_base_denominator >= tax_base_numerator);
alter table public.work_orders
  add column tax_base_numerator integer not null default 1,
  add column tax_base_denominator integer not null default 1,
  add constraint work_orders_tax_base_fraction check
    (tax_base_numerator > 0 and tax_base_denominator >= tax_base_numerator);
alter table public.sales_invoices
  add column tax_base_numerator integer not null default 1,
  add column tax_base_denominator integer not null default 1,
  add constraint sales_invoices_tax_base_fraction check
    (tax_base_numerator > 0 and tax_base_denominator >= tax_base_numerator);
alter table public.procurement_invoices
  add column tax_base_numerator integer not null default 1,
  add column tax_base_denominator integer not null default 1,
  add constraint procurement_invoices_tax_base_fraction check
    (tax_base_numerator > 0 and tax_base_denominator >= tax_base_numerator);

grant insert (tax_base_numerator, tax_base_denominator) on public.projects, public.work_orders, public.sales_invoices to authenticated;
revoke update (tax_rate) on public.work_orders from authenticated;

create function public.calculate_standalone_tax_amount(
  p_amount numeric, p_treatment text, p_rate numeric, p_numerator integer, p_denominator integer)
returns numeric language plpgsql immutable set search_path = public as $$
declare v_numerator numeric; v_denominator numeric;
begin
  if p_numerator is null or p_denominator is null or p_numerator <= 0 or p_denominator < p_numerator then
    raise exception 'tax base must be a positive fraction no greater than 1' using errcode = '23514';
  end if;
  if p_rate is null then return null; end if;
  if not (p_rate >= 0 and p_rate <= 100) then
    raise exception 'nominal tax rate must be between 0 and 100' using errcode = '23514';
  end if;
  v_numerator := round(p_amount,2) * 100 * round(p_rate,3) * 1000 * p_numerator;
  v_denominator := 100000::numeric * p_denominator;
  if p_treatment = 'inclusive' then
    v_denominator := v_denominator + round(p_rate,3) * 1000 * p_numerator;
  elsif p_treatment is distinct from 'exclusive' then
    raise exception 'tax treatment must be inclusive or exclusive' using errcode = '23514';
  end if;
  return div(2 * v_numerator + v_denominator, 2 * v_denominator) / 100;
end; $$;

create function public.apply_standalone_tax_base() returns trigger
language plpgsql set search_path = public as $$
declare v_amount numeric;
begin
  -- The ERP owns both the tax and the total; mirrors must preserve its answer verbatim.
  if tg_table_name in ('sales_invoices','procurement_invoices') then
    if coalesce(auth.jwt()->>'role', '') = 'service_role' then return new; end if;
    if public.domain_externally_owned(new.org_id,
      case when tg_table_name='sales_invoices' then 'revenue' else 'procurement' end) then return new; end if;
  end if;
  if tg_table_name='projects' then v_amount:=new.contract_value;
  elsif tg_table_name='work_orders' then v_amount:=new.order_value;
  else v_amount:=new.amount; end if;
  if new.tax_rate is not null and v_amount is not null then
    new.tax_amount := public.calculate_standalone_tax_amount(v_amount, new.tax_treatment,
      new.tax_rate, new.tax_base_numerator, new.tax_base_denominator);
  end if;
  return new;
end; $$;

create function public.guard_tax_base_metadata() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.tax_base_numerator is not distinct from old.tax_base_numerator
     and new.tax_base_denominator is not distinct from old.tax_base_denominator then return new; end if;
  if tg_table_name='work_orders' then
    if old.status <> 'Draft' then
      raise exception 'work order tax base is frozen after issue' using errcode='42501';
    end if;
  elsif coalesce(auth.jwt()->>'role', '') <> 'service_role' and public.domain_externally_owned(new.org_id,
    case when tg_table_name='sales_invoices' then 'revenue' else 'procurement' end) then
    raise exception 'ERP tax base metadata is read-only' using errcode='42501';
  end if;
  return new;
end; $$;
revoke all on function public.apply_standalone_tax_base(), public.guard_tax_base_metadata() from public, anon, authenticated;
create trigger projects_zz_apply_tax_base before insert
  on public.projects for each row execute function public.apply_standalone_tax_base();
create trigger work_orders_zz_apply_tax_base before insert
  on public.work_orders for each row execute function public.apply_standalone_tax_base();
create trigger work_orders_zzz_guard_tax_base before update on public.work_orders
  for each row execute function public.guard_tax_base_metadata();
create trigger sales_invoices_zz_apply_tax_base before insert
  on public.sales_invoices for each row execute function public.apply_standalone_tax_base();
create trigger sales_invoices_zzz_guard_tax_base before update on public.sales_invoices
  for each row execute function public.guard_tax_base_metadata();
create trigger procurement_invoices_zz_apply_tax_base before insert
  on public.procurement_invoices for each row execute function public.apply_standalone_tax_base();
create trigger procurement_invoices_zzz_guard_tax_base before update on public.procurement_invoices
  for each row execute function public.guard_tax_base_metadata();

drop trigger work_orders_stamp_value_witness on public.work_orders;
create trigger work_orders_stamp_value_witness before insert or update of order_value, tax_treatment, tax_amount, tax_rate, tax_base_numerator, tax_base_denominator
  on public.work_orders for each row execute function public.stamp_work_order_value_witness();
drop trigger projects_stamp_contract_value_witness on public.projects;
create trigger projects_stamp_contract_value_witness before insert or update of contract_value, tax_treatment, tax_amount, tax_rate, tax_base_numerator, tax_base_denominator
  on public.projects for each row execute function public.stamp_contract_value_witness();

drop function public.set_project_contract_value(uuid,numeric,text,numeric,numeric,text);
create or replace function set_project_contract_value(
  p_id uuid, p_value numeric,
  p_tax_treatment text default null, p_tax_amount numeric default null,
  p_tax_rate numeric default null, p_tax_template text default null,
  p_tax_base_numerator integer default null, p_tax_base_denominator integer default null)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_status project_status;
  v_org    uuid;
  v_old    numeric;
  v_role   user_role := auth_role();
  v_on_hand constant text[] := array['Won, Pending KoM','Ongoing Project','On Hold','Close Out'];
begin
  if p_value is null then
    raise exception 'contract value is required' using errcode = '23502';
  end if;
  if not (p_value >= 0 and p_value < 'Infinity'::numeric) then
    raise exception 'contract value must be a non-negative number' using errcode = '23514';
  end if;

  if p_tax_treatment is null or btrim(p_tax_treatment) not in ('inclusive','exclusive')
     or p_tax_amount is null then
    raise exception
      'a contract value must state its tax treatment: p_tax_treatment must be ''inclusive'' or ''exclusive'' (does the value already include the tax?) and p_tax_amount must be given (0 when there is no tax). Without it the drawdown compares this ceiling against work-order values on an unknown basis'
      using errcode = 'P0001';
  end if;

  select status, org_id, contract_value
    into v_status, v_org, v_old
    from public.projects where id = p_id for update;
  if v_status is null then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  if v_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if not public.is_active_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if v_status::text = any(v_on_hand) then
    if not public.holds_won_value_authority(v_role) then
      raise exception 'changing the contract value on a won project requires Executive or Finance'
        using errcode = '42501';
    end if;
  else
    if not public.holds_pipeline_value_authority(v_role) then
      raise exception 'not authorized to set the contract value' using errcode = '42501';
    end if;
  end if;

  update public.projects
    set contract_value = p_value,
        tax_treatment  = btrim(p_tax_treatment),
        tax_amount = case when p_tax_rate is not null then
          public.calculate_standalone_tax_amount(p_value, btrim(p_tax_treatment), p_tax_rate,
            coalesce(p_tax_base_numerator, tax_base_numerator), coalesce(p_tax_base_denominator, tax_base_denominator))
          else p_tax_amount end,
        tax_rate       = case when p_tax_base_numerator is not null and p_tax_base_denominator is not null
                          then p_tax_rate else coalesce(p_tax_rate, tax_rate) end,
        tax_template   = coalesce(p_tax_template, tax_template),
        tax_base_numerator = coalesce(p_tax_base_numerator, tax_base_numerator),
        tax_base_denominator = coalesce(p_tax_base_denominator, tax_base_denominator),
        last_update    = now()
  where id = p_id;

  perform public.log_audit('project.contract_value.set', v_org, auth.uid(), p_id,
                           jsonb_build_object('from', v_old, 'to', p_value,
                                              'tax_treatment', btrim(p_tax_treatment),
                                              'tax_amount', (select tax_amount from public.projects where id=p_id)));
end; $$;
revoke all on function public.set_project_contract_value(uuid,numeric,text,numeric,numeric,text,integer,integer) from public, anon;
grant execute on function public.set_project_contract_value(uuid,numeric,text,numeric,numeric,text,integer,integer) to authenticated;

drop function public.set_work_order_value(uuid,numeric,text,numeric);
create or replace function public.set_work_order_value(
  p_id uuid, p_value numeric,
  p_tax_treatment text default null, p_tax_amount numeric default null,
  p_tax_rate numeric default null, p_tax_base_numerator integer default null, p_tax_base_denominator integer default null)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_org    uuid;
  v_status public.work_order_status;
  v_old    numeric;
  v_role   user_role := auth_role();
begin
  if p_value is null then
    raise exception 'work order value is required' using errcode = '23502';
  end if;
  if not (p_value >= 0 and p_value < 'Infinity'::numeric) then
    raise exception 'work order value must be a non-negative number' using errcode = '23514';
  end if;

  if p_tax_treatment is null or btrim(p_tax_treatment) not in ('inclusive','exclusive')
     or p_tax_amount is null then
    raise exception
      'a work order value must state its tax treatment: p_tax_treatment must be ''inclusive'' or ''exclusive'' (does the value already include the tax?) and p_tax_amount must be given (0 when there is no tax). The drawdown is computed from both, so a value without its basis cannot be measured against the contract ceiling'
      using errcode = 'P0001';
  end if;

  select org_id, status, order_value into v_org, v_status, v_old
    from public.work_orders where id = p_id for update;
  if v_status is null then
    raise exception 'work order not found' using errcode = 'P0002';
  end if;

  if v_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  perform public.assert_is_active_member();

  if not public.holds_pipeline_value_authority(v_role) then
    raise exception 'not authorized to set the work order value' using errcode = '42501';
  end if;

  if v_status is distinct from 'Draft' then
    raise exception
      'the value of a work order that is % can no longer be changed: `issued_at` is the stamp an ERPNext push derives its idempotency key from, so a changed value under an unchanged stamp would be silently discarded there — cancel this work order and issue a replacement',
      v_status
      using errcode = '42501';
  end if;

  update public.work_orders
    set order_value   = p_value,
        tax_treatment = btrim(p_tax_treatment),
        tax_amount = case when p_tax_rate is not null then
          public.calculate_standalone_tax_amount(p_value, btrim(p_tax_treatment), p_tax_rate,
            coalesce(p_tax_base_numerator, tax_base_numerator), coalesce(p_tax_base_denominator, tax_base_denominator))
          else p_tax_amount end,
        tax_rate = case when p_tax_base_numerator is not null and p_tax_base_denominator is not null
                     then p_tax_rate else coalesce(p_tax_rate, tax_rate) end,
        tax_base_numerator = coalesce(p_tax_base_numerator, tax_base_numerator),
        tax_base_denominator = coalesce(p_tax_base_denominator, tax_base_denominator)
  where id = p_id;

  perform public.log_audit('work_order.value.set', v_org, auth.uid(), p_id,
                           jsonb_build_object('from', v_old, 'to', p_value,
                                              'tax_treatment', btrim(p_tax_treatment),
                                              'tax_amount', (select tax_amount from public.work_orders where id=p_id)));
end; $$;
revoke all on function public.set_work_order_value(uuid,numeric,text,numeric,numeric,integer,integer) from public, anon;
grant execute on function public.set_work_order_value(uuid,numeric,text,numeric,numeric,integer,integer) to authenticated;

drop function public.capture_vendor_invoice(uuid,procurement_invoice_status,date,text,numeric,text,text,numeric,numeric,text);
create or replace function public.capture_vendor_invoice(
  p_procurement_id uuid,
  p_status         procurement_invoice_status,
  p_invoice_date   date,
  p_reference_number text default null,
  p_amount         numeric default null,
  p_notes          text default null,
  p_tax_treatment  text default null,
  p_tax_amount     numeric default null,
  p_tax_rate       numeric default null,
  p_tax_template   text default null,
  p_tax_base_numerator integer default 1, p_tax_base_denominator integer default 1)
  returns procurement_invoices
  language plpgsql security definer set search_path = public as $$
declare
  v_invoice public.procurement_invoices;
begin
  perform transition_procurement(p_procurement_id, 'Vendor Invoiced'::procurement_status, p_notes);

  v_invoice := create_procurement_invoice(
    p_procurement_id, p_status, p_invoice_date, p_reference_number, p_amount,
    p_tax_treatment  => p_tax_treatment,
    p_tax_amount     => p_tax_amount,
    p_tax_rate       => p_tax_rate,
    p_tax_template   => p_tax_template,
    p_tax_base_numerator => p_tax_base_numerator,
    p_tax_base_denominator => p_tax_base_denominator);

  return v_invoice;
end; $$;
revoke all on function public.capture_vendor_invoice(uuid,procurement_invoice_status,date,text,numeric,text,text,numeric,numeric,text,integer,integer) from public, anon;
grant execute on function public.capture_vendor_invoice(uuid,procurement_invoice_status,date,text,numeric,text,text,numeric,numeric,text,integer,integer) to authenticated;

drop function public.create_procurement_invoice(uuid,procurement_invoice_status,date,text,numeric,text,uuid,timestamptz,text,numeric,numeric,text);
create or replace function public.create_procurement_invoice(
  p_procurement_id uuid, p_status procurement_invoice_status, p_invoice_date date,
  p_reference_number text default null, p_amount numeric default null,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null,
  p_tax_treatment text default null, p_tax_amount numeric default null,
  p_tax_rate numeric default null, p_tax_template text default null,
  p_tax_base_numerator integer default 1, p_tax_base_denominator integer default 1)
  returns procurement_invoices language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.procurement_invoices;
begin
  perform public.assert_is_active_member();
  select org_id into v_org from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  if public.domain_externally_owned(v_org, 'procurement') then
    raise exception 'procurement is externally-owned — vendor invoices route through the ERPNext adapter'
      using errcode = '42501';
  end if;
  if p_status is null or p_status::text not in ('Received','Scheduled') then
    raise exception
      'procurement_invoices.status "%" is not an origination status: a vendor invoice is recorded as Received or Scheduled, and Paid is reached only by paying it — the case transition that enforces that the approver does not pay their own request',
      p_status
      using errcode = 'P0001';
  end if;
  if p_tax_treatment is null or btrim(p_tax_treatment) not in ('inclusive','exclusive')
     or p_tax_amount is null then
    raise exception
      'a vendor invoice must state its tax treatment: p_tax_treatment must be ''inclusive'' or ''exclusive'' (does the amount already include the tax?) and p_tax_amount must be given (0 when there is no tax). Neither can be inferred from the total afterwards'
      using errcode = 'P0001';
  end if;
  insert into public.procurement_invoices
    (procurement_id, status, invoice_date, vi_number, reference_number, amount,
     import_key, import_batch_id, imported_at,
     tax_treatment, tax_amount, tax_rate, tax_template, tax_base_numerator, tax_base_denominator)
    values (p_procurement_id, p_status, p_invoice_date,
            next_procurement_doc_number(v_org, 'VI'), p_reference_number, p_amount,
            p_import_key, p_import_batch_id, p_imported_at,
            p_tax_treatment, p_tax_amount, p_tax_rate, p_tax_template, p_tax_base_numerator, p_tax_base_denominator)
    returning * into v_row;
  return v_row;
end; $$;
revoke all on function public.create_procurement_invoice(uuid,procurement_invoice_status,date,text,numeric,text,uuid,timestamptz,text,numeric,numeric,text,integer,integer) from public, anon;
grant execute on function public.create_procurement_invoice(uuid,procurement_invoice_status,date,text,numeric,text,uuid,timestamptz,text,numeric,numeric,text,integer,integer) to authenticated;

create or replace function public.get_sales_pipeline()
  returns json
  language sql
  stable
  security invoker
  set search_path = public
as $$
  with pl as (
    select
      p.id,
      p.name,
      p.client_id,
      p.end_client_id,
      p.status,
      p.contract_value,
      p.currency,
      p.tax_treatment,
      p.tax_rate, p.tax_base_numerator, p.tax_base_denominator,
      p.last_update,
      p.project_manager_id,
      coalesce(c.win_probability, 0) as win_prob
    from projects p
    left join pipeline_stage_config c on c.status = p.status
    where p.status::text = any(pipeline_project_statuses())
  )
  select json_build_object(
    'stages', coalesce((
      select json_agg(
        json_build_object(
          'status',        s.status,
          'count',         s.cnt,
          'total_value',   s.total_value,
          'win_probability', s.win_prob,
          'weighted_value',  s.total_value * s.win_prob
        )
        order by s.status
      )
      from (
        select
          status,
          count(*)::int           as cnt,
          sum(contract_value)     as total_value,
          max(win_prob)           as win_prob
        from pl
        group by status
      ) s
    ), '[]'::json),
    'projects', coalesce((
      select json_agg(
        json_build_object(
          'id',              pl.id,
          'name',            pl.name,
          'client_name',     coalesce(nullif(btrim(co.short_name), ''), co.name),
          'client_legal_name', co.name,
          'end_client_id',   pl.end_client_id,
          'end_client_name', coalesce(nullif(btrim(ec.short_name), ''), ec.name),
          'end_client_legal_name', ec.name,
          'status',          pl.status,
          'contract_value',  pl.contract_value,
          'currency',        pl.currency,
          'tax_treatment',   pl.tax_treatment,
          'tax_rate', pl.tax_rate,
          'tax_base_numerator', pl.tax_base_numerator,
          'tax_base_denominator', pl.tax_base_denominator,
          'win_probability', pl.win_prob,
          'last_update',     pl.last_update,
          'pm_name',         pm.full_name
        )
        order by pl.contract_value desc
      )
      from pl
      left join companies co on co.id = pl.client_id
      left join companies ec on ec.id = pl.end_client_id
      left join profiles  pm on pm.id = pl.project_manager_id
    ), '[]'::json)
  );
$$;

revoke all on function public.get_sales_pipeline() from public, anon;
grant execute on function public.get_sales_pipeline() to authenticated;
