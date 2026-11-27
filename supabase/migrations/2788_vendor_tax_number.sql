-- 2788_vendor_tax_number.sql — #3025 slice 2 (AC-3025): the vendor's tax number, held in its
-- own table so its read rule can be tighter than the companies row it belongs to.
--
-- The ruling (coordinator, option 1): a side table with the org seam whose select and write are
-- exactly the four vendor-edit roles (Admin, Executive, Project Manager, Finance — the
-- companies_write set). The tax number is personal data for individuals; a companies column
-- could not carry that rule (reads are org-membership-wide, 0002/0075, and 0273 ruled
-- column-grant conversion out), so the value lives apart and its table carries its own policy.
--
-- The PMO-native `erp_tax_id` mirror column is NOT copied, read or exposed by any of this: the
-- side table is written only through the app's own form, and nothing here touches the ERP
-- mirror or its sync paths.
--
-- The org seam is stamped by the BEFORE trigger from the parent company, so a row can never be
-- written into (or moved to) a foreign organisation, and RLS is evaluated after BEFORE-row
-- triggers fire — the with-check sees the stamped org. Foreign account: company_id is the
-- primary key (one tax number per vendor), so the app upserts by company and clears by delete.
--
-- Proof: supabase/tests/vendor_tax_number.test.sql — per-role read/write, Engineer refused,
-- second-organisation read refusal, cross-org stamp refusal, clearing, blank refused.
-- Mutation-check: drop either conjunct of the policies (the four-role set or the org match)
-- and the Engineer / second-organisation legs go red.
-- Rollback: supabase/migrations/rollback/2788_vendor_tax_number_down.sql

create table public.company_tax_numbers (
  company_id  uuid primary key references public.companies(id) on delete cascade,
  org_id      uuid not null references public.organizations(id),
  tax_number  text not null check (btrim(tax_number) <> ''),
  updated_at  timestamptz not null default now()
);

alter table public.company_tax_numbers enable row level security;
alter table public.company_tax_numbers force row level security;

-- The org seam: stamped from the parent company on every write, so the stored org is always
-- the company's own; updated_at is maintained here rather than trusted to the client.
create function public.stamp_company_tax_number() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid;
begin
  select c.org_id into v_org from public.companies c where c.id = new.company_id;
  if v_org is null then
    raise exception 'company not found' using errcode = 'P0002';
  end if;
  new.org_id := v_org;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end $$;
revoke all on function public.stamp_company_tax_number() from public, anon, authenticated;

create trigger company_tax_numbers_stamp
  before insert or update on public.company_tax_numbers
  for each row execute function public.stamp_company_tax_number();

-- Exactly the vendor-edit roles, active members of the caller's own organisation with CRM on
-- (the companies_write shape, 2778), for reads and for writes. A field account reads nothing.
create policy company_tax_numbers_select on public.company_tax_numbers for select to authenticated
  using (org_id = (select public.auth_org_id())
    and (select public.auth_role()) in ('Admin','Executive','Project Manager','Finance')
    and (select public.is_active_member())
    and (select public.org_feature_enabled((select public.auth_org_id()), 'crm')));
create policy company_tax_numbers_insert on public.company_tax_numbers for insert to authenticated
  with check (org_id = (select public.auth_org_id())
    and (select public.auth_role()) in ('Admin','Executive','Project Manager','Finance')
    and (select public.is_active_member())
    and (select public.org_feature_enabled((select public.auth_org_id()), 'crm')));
create policy company_tax_numbers_update on public.company_tax_numbers for update to authenticated
  using (org_id = (select public.auth_org_id())
    and (select public.auth_role()) in ('Admin','Executive','Project Manager','Finance')
    and (select public.is_active_member())
    and (select public.org_feature_enabled((select public.auth_org_id()), 'crm')))
  with check (org_id = (select public.auth_org_id())
    and (select public.auth_role()) in ('Admin','Executive','Project Manager','Finance')
    and (select public.is_active_member())
    and (select public.org_feature_enabled((select public.auth_org_id()), 'crm')));
create policy company_tax_numbers_delete on public.company_tax_numbers for delete to authenticated
  using (org_id = (select public.auth_org_id())
    and (select public.auth_role()) in ('Admin','Executive','Project Manager','Finance')
    and (select public.is_active_member())
    and (select public.org_feature_enabled((select public.auth_org_id()), 'crm')));
create policy light_account_deny_select on public.company_tax_numbers as restrictive for select to authenticated
  using ((select public.actor_is_light()) is not true);

revoke all on public.company_tax_numbers from public, anon, authenticated;
grant select, insert, update, delete on public.company_tax_numbers to authenticated;
grant all on public.company_tax_numbers to service_role;
