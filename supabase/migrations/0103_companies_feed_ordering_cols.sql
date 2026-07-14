-- 0103_companies_feed_ordering_cols — the parties mirror was missing the feed-ordering pair.
--
-- feedKinds.ts routes the `supplier`/`customer` kinds to the `companies` mirror table, and the
-- shared feed apply (erpnextFeedDeps.ts) reads/writes `erp_modified` (stale-event guard) and
-- `erp_docstatus` on EVERY mirror table — but 0097 added only the six party mirror columns, not
-- this pair (the procurement mirrors got it in 0098/0099). Result: the first LIVE inbound Supplier
-- webhook failed 42703 `column companies.erp_modified does not exist` (found 2026-07-14 arming the
-- demo feed; the apply path had only ever run against mocked deps).
--
-- Rollback:
--   alter table public.companies drop column if exists erp_modified;
--   alter table public.companies drop column if exists erp_docstatus;
--   (companies_native_mirror_guard: re-create from 0097)

-- erp_amended_from: parties are non-submittable masters and never amend — it stays NULL forever,
-- but the shared feed status-patch (erpnextFeedDeps.mirrorStatusPatch) writes the SAME uniform
-- column set to every mirror table, so the column must exist (the alternative — a per-table patch
-- branch — buys nothing but a fork).
alter table public.companies
  add column erp_docstatus    smallint,
  add column erp_modified     text,
  add column erp_amended_from text;

-- Same guard as 0097, with the two new machine-only columns pinned into the native set (the guard
-- enumerates columns — a new erp_* column MUST be added here or users could write it while flipped).
create or replace function public.companies_native_mirror_guard()
  returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' and public.domain_externally_owned(new.org_id, 'companies') then
    return new;
  end if;
  -- Internal exemption requires the row to BE and STAY Internal. 0097's `coalesce(old.type,
  -- new.type)` exempted any UPDATE whose OLD type was Internal — so a user on a flipped org could
  -- set type='Vendor' + arbitrary erp_* mirror fields in one UPDATE and mint a fake ERP-linked row
  -- (Luna money review 2026-07-14, BLOCK 1). Internal→Vendor/Client conversion on a flipped org now
  -- goes through the ERP-owned flow like any other native-field change.
  if old.type = 'Internal' and new.type = 'Internal' then
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
       or new.erp_docstatus is distinct from old.erp_docstatus
       or new.erp_modified is distinct from old.erp_modified
       or new.erp_amended_from is distinct from old.erp_amended_from
    then
      raise exception 'company native fields are read-only while companies are externally-owned'
        using errcode = '42501';
    end if;
  end if;
  return new;
end; $$;
