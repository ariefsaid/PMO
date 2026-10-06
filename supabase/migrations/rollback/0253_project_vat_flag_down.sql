-- Reverses 0253: drops the lock trigger, the flag column, and restores 0227's 8-argument set_project_contract_value verbatim.
drop trigger if exists projects_vat_flag_lock on public.projects;
drop function if exists public.guard_project_vat_flag_lock();
drop function if exists public.set_project_contract_value(uuid,numeric,text,numeric,numeric,text,integer,integer,boolean);
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
alter table public.projects drop column if exists subject_to_vat;
