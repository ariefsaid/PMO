-- 0379 — a fresh ERPNext v16 budget push can record its ERP Budget ref again.
--
-- The served dispatch writes each account slot (push_state 'pending', erp_budget_name NULL) before the
-- push, and the success writer fills erp_budget_name only AFTER record_outbox_ref returns. 0293 required
-- the slot to already carry the ERP name, so record_outbox_ref refused every fresh v16 account push: the
-- ERP Budget was created and submitted, the outbox row stayed 'committed', and the finalize never ran.
-- §1 accepts a slot with no name yet (a slot naming a DIFFERENT Budget is still refused).
-- §2 finalizes, once, the commits that were stranded before this migration, then drops the function.
-- Rollback: rollback/0379_budget_v16_fresh_ref_down.sql.

-- §1 — 0293's body; only the two destination-name tests change.
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
       -- 0379: the slot carries NO name until the success writer runs AFTER this ref, so a NULL name is
       -- the ordinary fresh state. Only a slot that already names a DIFFERENT Budget is refused.
       or (dest.erp_budget_name is not null and dest.erp_budget_name is distinct from p_external_record_id)
       -- 0379: the name must be the one this command's own commit stored, so a slot with no name cannot be
       -- claimed for any other Budget.
       or (v.external_record_id is not null and v.external_record_id is distinct from p_external_record_id)
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


-- §2 — finalize the v16 account commits stranded by the old ref rule, exactly as the shipped finalize would
-- have: record the ownership ref, mirror the committed ERP Budget as pushed, confirm the outbox row.
-- Only a row whose every fact agrees is touched: a committed 'ensure' account command with its ERP name on
-- both the outbox row and its stored canonical, a slot with no name (or that same name) whose version is
-- still Active under the same activation, and no ref for that ERP Budget held by another identity.
-- Anything else is left exactly as it is for the ordinary recovery path or an operator.
create or replace function public.finalize_wedged_v16_budget_commits()
returns int
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  o public.external_command_outbox;
  dest public.budget_version_account_erp_mirror;
  ver public.budget_versions;
  n int := 0;
begin
  for o in
    select * from public.external_command_outbox
     where domain='budget' and state='committed'
       and pmo_record_id ~* '^[0-9a-f-]{36}:a:'
       and external_record_id is not null
       and canonical->>'erp_budget_name' = external_record_id
     order by created_at, id
     for update
  loop
    select * into dest from public.budget_version_account_erp_mirror m
     where m.org_id=o.org_id
       and public.budget_account_identity(m.budget_version_id,m.fiscal_year,m.erp_account)=o.pmo_record_id
     for update;
    continue when dest.id is null or dest.budget_intent <> 'ensure'
      or (dest.erp_budget_name is not null and dest.erp_budget_name <> o.external_record_id);
    -- A tombstoned slot (its Budget was cancelled in ERPNext) is never revived as pushed.
    continue when dest.erp_cancelled_at is not null;
    select * into ver from public.budget_versions where id=dest.budget_version_id and org_id=o.org_id for update;
    continue when ver.id is null or ver.status <> 'Active' or dest.activated_at_witness is distinct from ver.activated_at;
    continue when exists (select 1 from public.external_refs r
      where r.org_id=o.org_id and r.domain='budget' and r.external_record_id=o.external_record_id
        and r.pmo_record_id <> o.pmo_record_id);

    insert into public.external_refs(org_id,domain,pmo_record_id,external_tier,external_record_id)
      values (o.org_id,'budget',o.pmo_record_id,o.external_tier,o.external_record_id)
      on conflict (org_id,domain,pmo_record_id) do nothing;
    continue when not exists (select 1 from public.external_refs r
      where r.org_id=o.org_id and r.domain='budget' and r.pmo_record_id=o.pmo_record_id
        and r.external_record_id=o.external_record_id);

    update public.budget_version_account_erp_mirror
       set push_state='pushed', push_error=null,
           erp_budget_name=o.external_record_id,
           erp_docstatus=(o.canonical->>'erp_docstatus')::smallint,
           erp_modified=o.canonical->>'erp_modified',
           erp_cancelled_at=null,
           pushed_at=now()
     where id=dest.id;
    update public.external_command_outbox set state='confirmed', updated_at=now()
     where id=o.id and claim_generation=o.claim_generation and state='committed';
    if found then n := n + 1; end if;
  end loop;
  return n;
end; $$;
revoke all on function public.finalize_wedged_v16_budget_commits() from public, anon, authenticated, service_role;

select public.finalize_wedged_v16_budget_commits();
-- One-off: dropped as soon as it has run, so nothing can call it again.
drop function public.finalize_wedged_v16_budget_commits();
