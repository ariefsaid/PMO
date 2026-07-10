-- 0085_external_domain_ownership.sql — the domain-ownership SWITCH (ADR-0055 P0, FR-EAS-001..007).
-- org-scoped; records employed external tiers + consequently externally-owned domains. DEFAULT EMPTY
-- (FR-EAS-002). RLS: own-org member read (FR-EAS-005/011); Operator-only write (OD-1, FR-EAS-006/012),
-- cross-org provisioning via operator_set_domain_ownership. org_id never sent by the client (column
-- default stamps it). Also defines domain_externally_owned() — used by 0088's read-model flip (FR-EAS-037).
-- Reversibility (ADR-0006): supabase db reset. Manual reverse:
--   drop function if exists public.operator_set_domain_ownership(uuid,text,text,text);
--   drop function if exists public.domain_externally_owned(uuid,text);
--   drop policy if exists external_domain_ownership_select on public.external_domain_ownership;
--   drop policy if exists external_domain_ownership_write on public.external_domain_ownership;
--   drop table if exists public.external_domain_ownership;

create table public.external_domain_ownership (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                  references public.organizations(id) on delete cascade,
  external_tier text not null,          -- 'reference' (P0); 'clickup'/'erpnext'/'odoo' (P1+)
  domain        text not null,          -- the PMO domain (e.g. 'reference')
  created_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id),
  unique (org_id, external_tier, domain)
);
create index external_domain_ownership_org_domain_idx on public.external_domain_ownership (org_id, domain);

alter table public.external_domain_ownership enable row level security;
alter table public.external_domain_ownership force  row level security;

-- READ: own-org members (FR-EAS-005/011).
create policy external_domain_ownership_select on public.external_domain_ownership
  for select using (org_id = public.auth_org_id() and public.is_active_member());

-- WRITE: Operator-only (OD-1). Mirrors org_features_write (0070): NO org_id = auth_org_id() constraint —
-- the Operator provisions any org via the security-definer RPC; a non-Operator matches no policy ⇒ every
-- write (incl. a spoofed org_id) is denied 42501 (FR-EAS-006/012). service_role bypasses RLS regardless.
create policy external_domain_ownership_write on public.external_domain_ownership
  for all using (public.is_operator() and public.is_active_member())
  with check (public.is_operator() and public.is_active_member());

-- Explicit client-role grants (auto_expose_new_tables=false, 0075): members SELECT only; NO client
-- INSERT/UPDATE/DELETE grant (Operator-via-RPC is the sole write path).
grant select on public.external_domain_ownership to authenticated;
grant select on public.external_domain_ownership to anon;

-- domain_externally_owned(org, domain): true iff the org assigned `domain` to an employed tier
-- (FR-EAS-003). SECURITY INVOKER (stable) — reads external_domain_ownership UNDER the caller's RLS, so
-- it reflects the caller's OWN org; the own-org ownership value is not a secret (the Integrations view
-- reads it directly). Used by external_reference_items' write-policy flip (0088, FR-EAS-037).
create or replace function public.domain_externally_owned(p_org_id uuid, p_domain text) returns boolean
  language sql stable security invoker set search_path = public as $$
  select exists (select 1 from public.external_domain_ownership
                  where org_id = p_org_id and domain = p_domain)
$$;
revoke all on function public.domain_externally_owned(uuid,text) from public;
grant  execute on function public.domain_externally_owned(uuid,text) to authenticated;

-- operator_set_domain_ownership: the Operator provisioning write contract (OD-2). Upserts ('employ') or
-- removes ('release') an (org, tier, domain) assignment; Operator-only; validates org exists (23503).
-- Mirrors operator_toggle_feature (0070). The capability-map bound (FR-EAS-004/AC-EAS-013) is enforced
-- at the TS routing layer (capabilityMap.ts); the DB stores what the Operator sets.
create or replace function public.operator_set_domain_ownership(
  p_org_id uuid, p_tier text, p_domain text, p_action text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active_member() then
    raise exception 'inactive' using errcode = '42501';
  end if;
  if not public.is_operator() then
    raise exception 'operator_only' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organizations where id = p_org_id) then
    raise exception 'unknown_org' using errcode = '23503';
  end if;
  if p_action = 'employ' then
    insert into public.external_domain_ownership (org_id, external_tier, domain, created_by)
      values (p_org_id, p_tier, p_domain, auth.uid())
    on conflict (org_id, external_tier, domain) do nothing;
  elsif p_action = 'release' then
    delete from public.external_domain_ownership
    where org_id = p_org_id and external_tier = p_tier and domain = p_domain;
  else
    raise exception 'bad_action' using errcode = 'P0001';
  end if;
end $$;
revoke all on function public.operator_set_domain_ownership(uuid,text,text,text) from public;
grant  execute on function public.operator_set_domain_ownership(uuid,text,text,text) to authenticated;
