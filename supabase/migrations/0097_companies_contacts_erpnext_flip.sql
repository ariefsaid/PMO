-- 0097_companies_contacts_erpnext_flip.sql
-- Purpose: the parties flip (Supplier + Customer(read-only) — OQ-4) onto `companies`/`contacts` with
-- per-command RLS, per spec §7's exact per-table enumeration (task 3.5, AC-ENA-003(companies)/040/
-- 041/042/072(companies) — this file itself does not OWN AC-ENA-003/072; the §7 per-table proof it
-- backs is erpnext_companies_flip_rls.test.sql; AC-ENA-003's owner is slice 4's
-- erpnext_procurement_flip_rls.test.sql and AC-ENA-072's owner is slice 6's erpnext_money_flip_rls.test.sql).
-- Mirrors the 0093 clickup_tasks_flip per-command-RLS-split template.
-- Reversibility: pre-prod via `supabase db reset`. Manual reverse block (forward-only if promoted):
--   drop trigger if exists contacts_native_mirror_guard on public.contacts;
--   drop function if exists public.contacts_native_mirror_guard();
--   drop policy if exists contacts_delete on public.contacts;
--   drop policy if exists contacts_update on public.contacts;
--   drop policy if exists contacts_insert on public.contacts;
--   create policy contacts_write on contacts for all
--     using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
--       and exists (select 1 from public.companies c where c.id = contacts.company_id and c.org_id = auth_org_id()))
--     with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
--       and exists (select 1 from public.companies c where c.id = contacts.company_id and c.org_id = auth_org_id()));
--   drop trigger if exists companies_native_mirror_guard on public.companies;
--   drop function if exists public.companies_native_mirror_guard();
--   drop policy if exists companies_delete on public.companies;
--   drop policy if exists companies_update on public.companies;
--   drop policy if exists companies_insert on public.companies;
--   create policy companies_write on companies for all
--     using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance'))
--     with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance'));
--   alter table public.companies drop column if exists erp_party_type;
--   alter table public.companies drop column if exists erp_supplier_name;
--   alter table public.companies drop column if exists erp_customer_name;
--   alter table public.companies drop column if exists erp_tax_id;
--   alter table public.companies drop column if exists erp_payment_terms_days;
--   alter table public.companies drop column if exists erp_cancelled_at;

-- ── companies (§7): Native mirrored = name, type (Vendor/Client only — 'Internal' rows are NEVER
-- ERP-flipped, FR-ENA-090/091, PMO's own org marker), + the six erp_* mirror cols below. PMO-owned
-- enhancement (stays user-writable) = archived_at (soft-archive, ADR-0018). Trigger (FR-ENA-171):
-- companies_stamp_org_id (0074) overrides NULL/seed-org org_id only — safe; the dispatch/mirror path
-- sets org_id explicitly, so the blanket trigger never interferes with a flipped org's mirror write. ──
alter table public.companies add column erp_party_type text;
alter table public.companies add column erp_supplier_name text;
alter table public.companies add column erp_customer_name text;
alter table public.companies add column erp_tax_id text;
alter table public.companies add column erp_payment_terms_days int;
alter table public.companies add column erp_cancelled_at timestamptz;

-- Per-command split (mirrors 0093's OD-CUA-1 discipline): companies_write (0002, as later live-
-- amended by 0063's is_active_member() append + 0081's crm org_feature_enabled() append — confirmed
-- via `pg_policies` at write time, NOT the 0002 source text) was FOR ALL — a wholesale USING guard
-- would also kill the still-permissive archived_at enhancement UPDATE. Replace it with INSERT/UPDATE/
-- DELETE policies carrying that SAME live predicate (is_active_member + crm feature gate) so
-- 0138_feature_flag_write_enforcement.test.sql / 0063 stay byte-for-byte: INSERT + DELETE ADDITIONALLY
-- denied while flipped (a new/deleted company row is ERP's to mint/cancel, never a direct user write);
-- UPDATE stays permissive at the RLS row level — the companies_native_mirror_guard trigger below
-- column-pins it while flipped.
drop policy companies_write on companies;

create policy companies_insert on companies for insert
  with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and is_active_member() and org_feature_enabled(auth_org_id(), 'crm')
    and not public.domain_externally_owned(auth_org_id(), 'companies'));

create policy companies_update on companies for update
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and is_active_member() and org_feature_enabled(auth_org_id(), 'crm'))
  with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and is_active_member() and org_feature_enabled(auth_org_id(), 'crm'));

create policy companies_delete on companies for delete
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and is_active_member() and org_feature_enabled(auth_org_id(), 'crm')
    and not public.domain_externally_owned(auth_org_id(), 'companies'));

-- companies_native_mirror_guard (0093 enforce_assignee_status_only pattern, column-pinned to the
-- native set): while `companies` is externally-owned for this row's org, a non-service-role UPDATE
-- that touches name/type/erp_* is denied 42501; every other column (archived_at) is unaffected.
-- Internal-type rows are EXEMPT regardless of flip state (FR-ENA-090/091 — checked on OLD *or* NEW
-- type so a user cannot dodge the guard by flipping type away from Internal mid-update).
create or replace function public.companies_native_mirror_guard()
  returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' and public.domain_externally_owned(new.org_id, 'companies') then
    return new;
  end if;
  if coalesce(old.type, new.type) = 'Internal' then
    return new;
  end if;
  if public.domain_externally_owned(new.org_id, 'companies') then
    if new.name is distinct from old.name
       or new.type is distinct from old.type
       or new.erp_party_type is distinct from old.erp_party_type
       or new.erp_supplier_name is distinct from old.erp_supplier_name
       or new.erp_customer_name is distinct from old.erp_customer_name
       or new.erp_tax_id is distinct from old.erp_tax_id
       or new.erp_payment_terms_days is distinct from old.erp_payment_terms_days
       or new.erp_cancelled_at is distinct from old.erp_cancelled_at
    then
      raise exception 'company native fields are read-only while companies are externally-owned'
        using errcode = '42501';
    end if;
  end if;
  return new;
end; $$;

create trigger companies_native_mirror_guard before update on companies
  for each row execute function public.companies_native_mirror_guard();

-- ── contacts (§7): no new mirror cols — reuses the shipped full_name/email/phone (ERP Contact,
-- FR-ENA-095), linked via the existing company_id FK. PMO-owned enhancement = archived_at, title,
-- notes (no ERP Contact equivalent mirrored in P2). Trigger (FR-ENA-171): contacts shipped (0030)
-- with NO dedicated stamp trigger of its own; contacts_stamp_org_id (0074's later, unrelated 42-table
-- blanket hardening — not authored for this flip) already exists and overrides NULL/seed-org org_id
-- only — confirmed live; this flip adds NO new stamp trigger for contacts, only the native-mirror
-- guard below. Contacts have no independent domain flip — they ride the PARENT `companies` domain's
-- ownership (FR-ENA-095: "Where companies is externally-owned, PMO contacts shall mirror ..."). ──
-- Same live-predicate-preservation discipline as companies above: contacts_write (0030, as later
-- live-amended by 0063 + 0081's crm gate) carries is_active_member() + org_feature_enabled(...,'crm')
-- — confirmed via pg_policies at write time. Preserved verbatim in the split below.
drop policy contacts_write on contacts;

create policy contacts_insert on contacts for insert
  with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and is_active_member() and org_feature_enabled(auth_org_id(), 'crm')
    and exists (select 1 from public.companies c where c.id = contacts.company_id and c.org_id = auth_org_id())
    -- M-2 (audit): contacts ride the PARENT `companies` domain's ownership (FR-ENA-095). While that
    -- domain is externally-owned, a user-JWT INSERT is DENIED (an ERP Contact mirror is machine-written
    -- via service_role, which bypasses RLS) — closing the hole where a user could mint a contact mirror
    -- row outside ERPNext. PMO-owned enhancement inserts are unaffected while NOT flipped (byte-for-byte).
    and not public.domain_externally_owned(auth_org_id(), 'companies'));

create policy contacts_update on contacts for update
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and is_active_member() and org_feature_enabled(auth_org_id(), 'crm')
    and exists (select 1 from public.companies c where c.id = contacts.company_id and c.org_id = auth_org_id()))
  with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and is_active_member() and org_feature_enabled(auth_org_id(), 'crm')
    and exists (select 1 from public.companies c where c.id = contacts.company_id and c.org_id = auth_org_id()));

create policy contacts_delete on contacts for delete
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and is_active_member() and org_feature_enabled(auth_org_id(), 'crm')
    and exists (select 1 from public.companies c where c.id = contacts.company_id and c.org_id = auth_org_id()));
-- contacts_delete_admin_only (0030, RESTRICTIVE, Admin-only) still ANDs with contacts_delete above —
-- unchanged, not touched by this migration.

-- contacts_native_mirror_guard: while the PARENT company's `companies` domain is externally-owned, a
-- non-service-role UPDATE that touches full_name/email/phone is denied 42501; title/notes/archived_at
-- (enhancement) are unaffected.
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
    then
      raise exception 'contact native fields are read-only while the parent companies domain is externally-owned'
        using errcode = '42501';
    end if;
  end if;
  return new;
end; $$;

create trigger contacts_native_mirror_guard before update on contacts
  for each row execute function public.contacts_native_mirror_guard();
