-- Rolls back 0379: restores record_outbox_ref to its exact 0293 body and drops the one-off finalize.
-- Rows already finalized by 0379 §2 stay finalized: they mirror ERP Budgets that really exist.
drop function if exists public.finalize_wedged_v16_budget_commits();
create or replace function public.record_outbox_ref(
  p_id uuid, p_generation int,
  p_domain text, p_pmo_record_id text, p_external_tier text, p_external_record_id text
) returns int
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v public.external_command_outbox;
  dest public.budget_version_account_erp_mirror;
  src public.budget_version_account_erp_mirror;
  dest_version public.budget_versions;
  src_version public.budget_versions;
  src_project uuid;
  dest_project uuid;
  existing_ref public.external_refs;
begin
  select * into v from public.external_command_outbox where id=p_id for update;
  if v.id is null or v.claim_generation is distinct from p_generation or v.state <> 'committed' then
    return 0;
  end if;

  if v.domain='budget' and v.pmo_record_id ~* '^[0-9a-f-]{36}:a:' then
    -- Caller identity is deliberately ignored. The destination is derived from the locked command.
    select * into dest from public.budget_version_account_erp_mirror m
     where m.org_id=v.org_id
       and public.budget_account_identity(m.budget_version_id,m.fiscal_year,m.erp_account)=v.pmo_record_id
     for update;
    if dest.id is null then return 0; end if;
    select * into dest_version from public.budget_versions bv where bv.id=dest.budget_version_id and bv.org_id=v.org_id for update;
    if dest_version.id is null or dest_version.status <> 'Active'
       or dest.activated_at_witness is distinct from dest_version.activated_at
       or dest.erp_budget_name is distinct from p_external_record_id
       or p_external_tier is distinct from v.external_tier then
      return 0;
    end if;

    select * into existing_ref from public.external_refs r
     where r.org_id=v.org_id and r.domain='budget' and r.external_tier=v.external_tier
       and r.external_record_id=p_external_record_id
     for update;
    if existing_ref.org_id is not null and existing_ref.pmo_record_id <> v.pmo_record_id then
      select m.* into src
        from public.budget_version_account_erp_mirror m
        join public.budget_versions bv on bv.id=m.budget_version_id
       where m.org_id=v.org_id and m.erp_budget_name=p_external_record_id
         and m.push_state='pushed' and m.erp_docstatus=1
         and public.budget_account_identity(m.budget_version_id,m.fiscal_year,m.erp_account)=existing_ref.pmo_record_id
       for update of m;
      if src.id is null or src.erp_account is distinct from dest.erp_account
         or src.fiscal_year is distinct from dest.fiscal_year then return 0; end if;
      select * into src_version from public.budget_versions where id=src.budget_version_id for update;
      if src_version.id is null or src_version.status='Active'
         or src.activated_at_witness is distinct from src_version.activated_at then return 0; end if;
      src_project := src_version.project_id;
      dest_project := dest_version.project_id;
      if src_project is distinct from dest_project then return 0; end if;
      if dest.id is null then return 0; end if;
      update public.external_refs
         set pmo_record_id=v.pmo_record_id, external_tier=v.external_tier
       where org_id=v.org_id and domain='budget'
         and pmo_record_id=existing_ref.pmo_record_id and external_record_id=p_external_record_id;
      if not found then return 0; end if;
      return 1;
    elsif existing_ref.org_id is not null then
      if existing_ref.pmo_record_id=v.pmo_record_id then return 1; end if;
      return 0;
    end if;

    insert into public.external_refs(org_id,domain,pmo_record_id,external_tier,external_record_id)
      values(v.org_id,'budget',v.pmo_record_id,v.external_tier,p_external_record_id)
      on conflict(org_id,domain,pmo_record_id) do nothing;
    if exists(select 1 from public.external_refs r where r.org_id=v.org_id and r.domain='budget'
      and r.pmo_record_id=v.pmo_record_id and r.external_tier=v.external_tier
      and r.external_record_id=p_external_record_id) then return 1; end if;
    return 0;
  end if;

  if v.domain = 'companies' and v.operation = 'create' and v.payload ->> 'erp_doc_kind' = 'contact' then
    insert into public.external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id)
      values (v.org_id, v.domain, v.pmo_record_id, p_external_tier, p_external_record_id)
      on conflict (org_id, domain, pmo_record_id) do nothing;
    if not exists (select 1 from public.external_refs r where r.org_id=v.org_id and r.domain=v.domain
      and r.pmo_record_id=v.pmo_record_id and r.external_tier=p_external_tier
      and r.external_record_id=p_external_record_id) then
      raise exception 'Contact mapping identity conflict' using errcode='23505';
    end if;
    return 1;
  end if;
  insert into public.external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id)
    values (v.org_id,v.domain,v.pmo_record_id,p_external_tier,p_external_record_id)
    on conflict (org_id,domain,pmo_record_id)
      do update set external_record_id=excluded.external_record_id,external_tier=excluded.external_tier;
  return 1;
end; $$;
revoke all on function public.record_outbox_ref(uuid,integer,text,text,text,text) from public;
grant execute on function public.record_outbox_ref(uuid,integer,text,text,text,text) to service_role;

