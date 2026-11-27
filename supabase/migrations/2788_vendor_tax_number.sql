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

-- Exactly the vendor-edit roles, in the caller's own organisation — for reads and for writes.
create policy company_tax_numbers_select on public.company_tax_numbers for select
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance'));
create policy company_tax_numbers_write on public.company_tax_numbers for all
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance'))
  with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance'));

grant select, insert, update, delete on public.company_tax_numbers to authenticated;
