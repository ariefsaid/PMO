-- Contact masters use the existing companies-domain feed staleness guard.
-- Rollback: drop contacts.erp_modified, restore the 0097 contacts native guard + contacts_delete policy,
-- and restore the 0154 record_outbox_ref body.
alter table public.contacts add column erp_modified timestamptz;
create or replace function public.contacts_native_mirror_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' and public.domain_externally_owned(new.org_id, 'companies') then
    return new;
  end if;
  if public.domain_externally_owned(new.org_id, 'companies') then
    if new.full_name is distinct from old.full_name
       or new.email is distinct from old.email
       or new.phone is distinct from old.phone
       or new.company_id is distinct from old.company_id
       or new.erp_modified is distinct from old.erp_modified then
      raise exception 'contact native fields are read-only while the parent companies domain is externally-owned' using errcode = '42501';
    end if;
  end if;
  return new;
end; $$;

-- A connected Contact's existence is ERP's: users may soft-archive it, never hard-delete it
-- (companies_delete precedent, 0097). Standalone orgs keep the 0097 predicate unchanged.
drop policy contacts_delete on contacts;
create policy contacts_delete on contacts for delete
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and is_active_member() and org_feature_enabled(auth_org_id(), 'crm')
    and exists (select 1 from public.companies c where c.id = contacts.company_id and c.org_id = auth_org_id())
    and not public.domain_externally_owned(auth_org_id(), 'companies'));

-- record_outbox_ref: the 0154 body (identity derived from the LOCKED outbox row) is kept for every
-- command; only a Contact CREATE records its mapping insert-only. A create must bind a NEW identity, so an
-- existing mapping is accepted only when it is the same tier + ERP Contact (a finalization replay) and is
-- otherwise refused 23505 instead of being repointed.
create or replace function public.record_outbox_ref(
  p_id uuid, p_generation int,
  p_domain text, p_pmo_record_id text, p_external_tier text, p_external_record_id text
) returns int
  language plpgsql security definer set search_path = public as $$
  declare v public.external_command_outbox;
  begin
    select * into v from public.external_command_outbox where id = p_id for update;
    if v.id is null or v.claim_generation is distinct from p_generation or v.state <> 'committed' then
      return 0;
    end if;
    if v.domain = 'companies' and v.operation = 'create' and v.payload ->> 'erp_doc_kind' = 'contact' then
      insert into public.external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id)
        values (v.org_id, v.domain, v.pmo_record_id, p_external_tier, p_external_record_id)
        on conflict (org_id, domain, pmo_record_id) do nothing;
      if not exists (
        select 1 from public.external_refs r
        where r.org_id = v.org_id and r.domain = v.domain and r.pmo_record_id = v.pmo_record_id
          and r.external_tier = p_external_tier and r.external_record_id = p_external_record_id
      ) then
        raise exception 'Contact mapping identity conflict' using errcode = '23505';
      end if;
      return 1;
    end if;
    insert into public.external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id)
      values (v.org_id, v.domain, v.pmo_record_id, p_external_tier, p_external_record_id)
      on conflict (org_id, domain, pmo_record_id)
        do update set external_record_id = excluded.external_record_id, external_tier = excluded.external_tier;
    return 1;
  end; $$;
