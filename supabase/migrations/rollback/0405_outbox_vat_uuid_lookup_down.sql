-- Restore the record-ID lookups as cast-and-lower text comparisons (reversal of 0405).
-- Bodies are the exact 0283_vat_flag_unlock.sql definitions.

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
