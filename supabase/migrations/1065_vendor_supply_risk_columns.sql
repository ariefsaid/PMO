-- 1065_vendor_supply_risk_columns.sql — #2583 slice 2a: a supplier's supply-risk status (FR-VSR-001, FR-VSR-003).
--
--   §1 companies: supply_risk_status ('active' default | 'at_risk' | 'inactive'), the reason, who set it and when.
--      The status is a HUMAN decision (OD-VSR-1); the payables-age figure only suggests (1067).
--   §2 companies_supply_risk_guard: the four columns change only through set_vendor_supply_status() (1066).
--      `companies` carries table-level INSERT/UPDATE grants to authenticated and anon (0075) under a four-role UPDATE
--      policy (0097), and a column REVOKE cannot subtract from a table-level grant (0273's finding), so the rule is
--      a trigger honouring 1066's transaction-local flag (the 0252/0273 pattern). Exempt: the service role (the ERP
--      companies mirror, importers) and a session with no JWT (migrations, seed, psql).
--   §3 record_history_config: the status and its stamp are captured (the company record history shows who and when);
--      the reason is a flag column; who-set-it is omitted (the history row already names the actor). The reason
--      itself lives on the audit event (1066).
--
-- Rollback: supabase/migrations/rollback/1065_vendor_supply_risk_columns_down.sql (revert 1066/1067 and the FE first).

-- §1
alter table public.companies
  add column supply_risk_status text not null default 'active',
  add column supply_risk_reason text,
  add column supply_risk_set_by uuid references public.profiles(id) on delete set null,
  add column supply_risk_set_at timestamptz;

alter table public.companies
  add constraint companies_supply_risk_status_domain
    check (supply_risk_status in ('active', 'at_risk', 'inactive')),
  add constraint companies_supply_risk_reason_shape
    check (supply_risk_reason is null or length(btrim(supply_risk_reason)) between 1 and 500),
  add constraint companies_supply_risk_reason_required
    check (supply_risk_status = 'active' or supply_risk_reason is not null);

comment on column public.companies.supply_risk_status is
  '#2583: active (default) | at_risk | inactive. A human decision; the payables-age suggestion never writes it. '
  'inactive = do not rely on for new work; it does not archive the company. Set only via set_vendor_supply_status().';
comment on column public.companies.supply_risk_reason is
  '#2583: why the supplier is at_risk or inactive (1-500 chars). Required unless the status is active.';
comment on column public.companies.supply_risk_set_by is '#2583: who last changed the status (set by set_vendor_supply_status).';
comment on column public.companies.supply_risk_set_at is '#2583: when the status last changed.';

-- §2
create or replace function public.companies_supply_risk_guard() returns trigger
  language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('pmo.vendor_supply_risk_write', true), '') = 'on'
     or auth.jwt() is null
     or coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.supply_risk_status <> 'active' or new.supply_risk_reason is not null
       or new.supply_risk_set_by is not null or new.supply_risk_set_at is not null then
      raise exception 'supply-risk status is changed only through set_vendor_supply_status' using errcode = '42501';
    end if;
  elsif new.supply_risk_status is distinct from old.supply_risk_status
     or new.supply_risk_reason is distinct from old.supply_risk_reason
     or new.supply_risk_set_by is distinct from old.supply_risk_set_by
     or new.supply_risk_set_at is distinct from old.supply_risk_set_at then
    raise exception 'supply-risk status is changed only through set_vendor_supply_status' using errcode = '42501';
  end if;
  return new;
end; $$;
revoke all on function public.companies_supply_risk_guard() from public, anon, authenticated;
create trigger companies_supply_risk_guard before insert or update on public.companies
  for each row execute function public.companies_supply_risk_guard();

-- §3 — change history registry (record_changes_catalog_gate: every column classified exactly once).
update public.record_history_config
   set captured  = captured || '{"supply_risk_status":"enum","supply_risk_set_at":"timestamp"}'::jsonb,
       flag_cols = flag_cols || array['supply_risk_reason'],
       omit_cols = omit_cols || array['supply_risk_set_by']
 where entity_type = 'company';

notify pgrst, 'reload schema';
