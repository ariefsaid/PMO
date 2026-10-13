-- #956 DD-TAX-4b: permit VAT changes only after all project invoices are verifiably cancelled
-- and all associated Sales Invoice commands have settled. The setter remains the write authority.

create or replace function public.project_invoice_vat_lock_reason(p_org uuid, p_project uuid)
returns text language sql volatile set search_path = public as $$
  select case
    when exists (
      select 1 from public.sales_invoices si
       where si.org_id = p_org and si.project_id = p_project
         and not coalesce(si.status::text = 'Cancelled' and (
           si.pmo_native or si.erp_docstatus = 2
           or (si.si_number is null and si.erp_docstatus is null)), false)
    ) then 'vat-live-invoice'
    when exists (
      select 1 from public.external_command_outbox o
       where o.org_id = p_org and o.domain = 'revenue'
         and o.payload->>'erp_doc_kind' = 'sales-invoice'
         and o.state not in ('confirmed','failed')
         and (
           lower(o.payload->>'projectId') = lower(p_project::text)
           or exists (select 1 from public.sales_invoices si
                       where si.org_id = p_org and si.project_id = p_project
                         and lower(si.id::text) = lower(o.pmo_record_id))
           or exists (select 1 from public.progress_claims pc
                       where pc.org_id = p_org and pc.project_id = p_project
                         and lower(pc.id::text) = lower(o.pmo_record_id))
         )
    ) then 'vat-command-pending'
    else null end
$$;
revoke all on function public.project_invoice_vat_lock_reason(uuid,uuid) from public, anon, authenticated;

create or replace function public.guard_project_vat_flag_lock() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_reason text;
begin
  v_reason := public.project_invoice_vat_lock_reason(new.org_id, new.id);
  if v_reason is not null then
    raise exception 'this project VAT setting is locked by its invoice state'
      using errcode = '42501', detail = v_reason;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_project_vat_flag_lock() from public, anon, authenticated;

create or replace function public.get_project_vat_editability(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_reason text; v_has_invoices boolean;
begin
  if not public.is_active_member() then
    raise exception 'not authorized' using errcode='42501', detail='vat-not-authorized';
  end if;
  select org_id into v_org from public.projects where id = p_id;
  if not found then
    raise exception 'project not found' using errcode='P0002', detail='vat-project-not-found';
  end if;
  if v_org is distinct from public.auth_org_id() then
    raise exception 'not authorized' using errcode='42501', detail='vat-not-authorized';
  end if;
  v_reason := public.project_invoice_vat_lock_reason(v_org, p_id);
  select exists(select 1 from public.sales_invoices where org_id=v_org and project_id=p_id)
    into v_has_invoices;
  return jsonb_build_object('eligible', v_reason is null, 'reason', v_reason, 'hasInvoices', v_has_invoices);
end;
$$;
revoke all on function public.get_project_vat_editability(uuid) from public, anon;
grant execute on function public.get_project_vat_editability(uuid) to authenticated;

-- Project serialization for invoice facts. Shared locks do not block other invoice writers.
create or replace function public.lock_vat_project_for_invoice() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  for v_id in select distinct x from unnest(array[
      case when tg_op = 'UPDATE' then old.project_id else null end,
      new.project_id
    ]) x where x is not null order by x
  loop
    perform 1 from public.projects where id=v_id for share;
  end loop;
  return new;
end;
$$;
revoke all on function public.lock_vat_project_for_invoice() from public, anon, authenticated;
drop trigger if exists sales_invoices_zzzzz_vat_project_lock on public.sales_invoices;
create trigger sales_invoices_zzzzz_vat_project_lock
  before insert or update of project_id,status,erp_docstatus on public.sales_invoices
  for each row execute function public.lock_vat_project_for_invoice();

create or replace function public.guard_outbox_vat_context() returns trigger
language plpgsql security definer set search_path=public as $$
declare
  v_project uuid;
  v_invoice_project uuid;
  v_claim_project uuid;
  v_payload_project uuid;
  v_vat boolean;
  v_builds_body boolean;
  v_needs_witness boolean;
begin
  if new.domain is distinct from 'revenue' or new.payload->>'erp_doc_kind' is distinct from 'sales-invoice'
     or new.state in ('confirmed','failed') then return new; end if;

  select project_id into v_invoice_project from public.sales_invoices
    where org_id=new.org_id and lower(id::text)=lower(new.pmo_record_id) limit 1;
  select project_id into v_claim_project from public.progress_claims
    where org_id=new.org_id and lower(id::text)=lower(new.pmo_record_id) limit 1;
  if coalesce(new.payload->>'projectId','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_payload_project := (new.payload->>'projectId')::uuid;
  elsif nullif(new.payload->>'projectId','') is not null then
    raise exception 'invalid project association' using errcode='P0001', detail='vat-context-unavailable';
  end if;
  if (v_invoice_project is not null and v_claim_project is not null and v_invoice_project<>v_claim_project)
     or (v_invoice_project is not null and v_payload_project is not null and v_invoice_project<>v_payload_project)
     or (v_claim_project is not null and v_payload_project is not null and v_claim_project<>v_payload_project) then
    raise exception 'conflicting project association' using errcode='P0001', detail='vat-context-changed';
  end if;
  v_project := coalesce(v_invoice_project,v_claim_project,v_payload_project);
  if v_project is null then return new; end if;
  perform 1 from public.projects where id=v_project and org_id=new.org_id for share;
  if not found then raise exception 'project not found' using errcode='P0001', detail='vat-context-unavailable'; end if;
  select subject_to_vat into v_vat from public.projects where id=v_project and org_id=new.org_id;

  v_builds_body := new.operation in ('create','update')
    or (new.operation='transition' and new.payload->>'verb'='amend');
  v_needs_witness := tg_op='INSERT';
  if tg_op='UPDATE' then v_needs_witness := old.state='failed'; end if;
  if v_builds_body and v_needs_witness then
    if jsonb_typeof(new.payload->'vat_flag_at_resolution') is distinct from 'boolean' then
      raise exception 'invoice VAT context could not be verified' using errcode='P0001', detail='vat-context-unavailable';
    end if;
    if (new.payload->>'vat_flag_at_resolution')::boolean is distinct from v_vat then
      raise exception 'project VAT changed before this invoice command could be sent' using errcode='P0001', detail='vat-context-changed';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_outbox_vat_context() from public, anon, authenticated;
drop trigger if exists external_command_outbox_zzz_vat_context on public.external_command_outbox;
create trigger external_command_outbox_zzz_vat_context
  before insert or update of state,payload on public.external_command_outbox
  for each row execute function public.guard_outbox_vat_context();

create index if not exists sales_invoices_vat_project_idx on public.sales_invoices(org_id,project_id);
create index if not exists outbox_vat_project_pending_idx on public.external_command_outbox(org_id,lower(payload->>'projectId'))
  where domain='revenue' and payload->>'erp_doc_kind'='sales-invoice' and state not in ('confirmed','failed');
create index if not exists outbox_vat_invoice_pending_idx on public.external_command_outbox(org_id,lower(pmo_record_id))
  where domain='revenue' and payload->>'erp_doc_kind'='sales-invoice' and state not in ('confirmed','failed');

-- Preserve setter validation and audit/history behavior while prioritizing VAT-specific authorization.
create or replace function public.set_project_contract_value(
  p_id uuid, p_value numeric,
  p_tax_treatment text default null, p_tax_amount numeric default null,
  p_tax_rate numeric default null, p_tax_template text default null,
  p_tax_base_numerator integer default null, p_tax_base_denominator integer default null,
  p_subject_to_vat boolean default null)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_status project_status;
  v_org uuid;
  v_old numeric;
  v_old_vat boolean;
  v_role user_role := auth_role();
  v_on_hand constant text[] := array['Won, Pending KoM','Ongoing Project','On Hold','Close Out'];
begin
  if p_value is null then raise exception 'contract value is required' using errcode='23502'; end if;
  if not (p_value >= 0 and p_value < 'Infinity'::numeric) then raise exception 'contract value must be a non-negative number' using errcode='23514'; end if;
  if p_tax_treatment is null or btrim(p_tax_treatment) not in ('inclusive','exclusive') or p_tax_amount is null then
    raise exception
      'a contract value must state its tax treatment: p_tax_treatment must be ''inclusive'' or ''exclusive'' (does the value already include the tax?) and p_tax_amount must be given (0 when there is no tax). Without it the drawdown compares this ceiling against work-order values on an unknown basis'
      using errcode = 'P0001';
  end if;
  select status,org_id,contract_value,subject_to_vat into v_status,v_org,v_old,v_old_vat
    from public.projects where id=p_id for update;
  if v_status is null then raise exception 'project not found' using errcode='P0002', detail='vat-project-not-found'; end if;
  if v_org is distinct from auth_org_id() or not public.is_active_member() then
    raise exception 'not authorized' using errcode='42501', detail='vat-not-authorized';
  end if;
  if p_subject_to_vat is not null and p_subject_to_vat is distinct from v_old_vat
     and (v_role is null or v_role not in ('Finance','Admin')) then
    raise exception 'only Finance or Admin can change whether a project is subject to VAT'
      using errcode='42501', detail='vat-role-forbidden';
  end if;
  if v_status::text=any(v_on_hand) then
    if not public.holds_won_value_authority(v_role) then raise exception 'changing the contract value on a won project requires Executive or Finance' using errcode='42501'; end if;
  else
    if not public.holds_pipeline_value_authority(v_role) then raise exception 'not authorized to set the contract value' using errcode='42501'; end if;
  end if;
  update public.projects set contract_value=p_value,
    subject_to_vat=coalesce(p_subject_to_vat,subject_to_vat),
    tax_treatment=btrim(p_tax_treatment),
    tax_amount=case when p_tax_rate is not null then public.calculate_standalone_tax_amount(p_value,btrim(p_tax_treatment),p_tax_rate,
      coalesce(p_tax_base_numerator,tax_base_numerator),coalesce(p_tax_base_denominator,tax_base_denominator)) else p_tax_amount end,
    tax_rate=case when p_tax_base_numerator is not null and p_tax_base_denominator is not null then p_tax_rate else coalesce(p_tax_rate,tax_rate) end,
    tax_template=coalesce(p_tax_template,tax_template),
    tax_base_numerator=coalesce(p_tax_base_numerator,tax_base_numerator),
    tax_base_denominator=coalesce(p_tax_base_denominator,tax_base_denominator), last_update=now()
    where id=p_id;
  perform public.log_audit('project.contract_value.set',v_org,auth.uid(),p_id,
    jsonb_build_object('from',v_old,'to',p_value,'tax_treatment',btrim(p_tax_treatment),
      'tax_amount',(select tax_amount from public.projects where id=p_id),
      'subject_to_vat',(select subject_to_vat from public.projects where id=p_id)));
end;
$$;
revoke all on function public.set_project_contract_value(uuid,numeric,text,numeric,numeric,text,integer,integer,boolean) from public,anon;
grant execute on function public.set_project_contract_value(uuid,numeric,text,numeric,numeric,text,integer,integer,boolean) to authenticated;
