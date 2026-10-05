-- Contact masters use the existing companies-domain feed staleness guard.
-- Rollback: drop contacts.erp_modified and restore the 0097 contacts native guard.
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
       or new.erp_modified is distinct from old.erp_modified then
      raise exception 'contact native fields are read-only while the parent companies domain is externally-owned' using errcode = '42501';
    end if;
  end if;
  return new;
end; $$;
