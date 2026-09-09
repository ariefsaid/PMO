-- 0213_seed_org_defaults.sql — #619: an org created by operator_create_org has no per-org configuration
-- rows. 0008 seeded the pipeline win-probabilities (OD-SP-2) for the SEED org at migration time and nothing
-- ever seeded them for any other org, so the RIS pipeline's weighted values read as zero. Same class as
-- #616: the demo org got it for free, the second tenant did not, and every test runs in the demo org.
--
-- Fix: ONE function holds the per-org defaults; operator_create_org calls it; this migration backfills
-- every org that lacks the rows; §3 asserts no org is left without them. New per-org config rows go
-- into seed_org_defaults(), never into a migration-time insert for the seed org alone.
--
-- Reversibility: drop function public.seed_org_defaults(uuid); re-run 0198's operator_create_org.

create or replace function public.seed_org_defaults(p_org_id uuid) returns void
language sql security definer set search_path = public as $$
  -- OD-SP-2 default win-probabilities (0008 A3 verbatim). Idempotent: an org that already tuned a stage keeps it.
  insert into public.pipeline_stage_config (org_id, status, win_probability) values
    (p_org_id, 'Leads',               0.100),
    (p_org_id, 'PQ Submitted',        0.250),
    (p_org_id, 'Quotation Submitted', 0.400),
    (p_org_id, 'Tender Submitted',    0.500),
    (p_org_id, 'Negotiation',         0.750)
  on conflict (org_id, status) do nothing;
$$;
-- Called only from definer bodies; never a client RPC (would let any member re-seed any org's config).
revoke all on function public.seed_org_defaults(uuid) from public, anon, authenticated;

-- §1 — operator_create_org: 0198's body plus the companion call (same signature, in-place replace).
create or replace function public.operator_create_org(
  p_name                  text,   -- the org's display name
  p_admin_user_id         uuid,   -- an EXISTING auth.users id — the first Admin
  p_admin_full_name       text,   -- display name for the Admin's profile
  p_default_currency      text,   -- ISO-4217 alpha-3; REQUIRED (0187)
  p_default_locale        text,   -- language tag (en | id …); REQUIRED, column is NOT NULL
  p_default_number_locale text,   -- Intl number locale; REQUIRED PARAM, NULL value = derive
  p_default_timezone      text    -- IANA tz; REQUIRED, column is NOT NULL
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org_id      uuid;
  v_admin_email text;
begin
  if not public.is_active_member() then
    raise exception 'inactive' using errcode = '42501';
  end if;
  if not public.is_operator() then
    raise exception 'operator_only' using errcode = '42501';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception 'org_name_required' using errcode = 'P0001';
  end if;
  if p_admin_user_id is null then
    raise exception 'admin_user_required' using errcode = 'P0001';
  end if;
  if p_admin_full_name is null or btrim(p_admin_full_name) = '' then
    raise exception 'admin_full_name_required' using errcode = 'P0001';
  end if;
  if p_default_currency is null or btrim(p_default_currency) = '' then
    raise exception 'default_currency_required' using errcode = 'P0001';
  end if;
  if p_default_locale is null or btrim(p_default_locale) = '' then
    raise exception 'default_locale_required' using errcode = 'P0001';
  end if;
  if p_default_number_locale is not null and btrim(p_default_number_locale) = '' then
    raise exception 'default_number_locale_invalid' using errcode = 'P0001';
  end if;
  if p_default_timezone is null or btrim(p_default_timezone) = '' then
    raise exception 'default_timezone_required' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.organizations where lower(name) = lower(btrim(p_name))) then
    raise exception 'org_name_taken' using errcode = '23505';
  end if;

  select u.email into v_admin_email from auth.users u where u.id = p_admin_user_id;
  if not found then
    raise exception 'unknown_admin_user' using errcode = '23503';
  end if;
  if v_admin_email is null or btrim(v_admin_email) = '' then
    raise exception 'admin_user_has_no_email' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.profiles where id = p_admin_user_id) then
    raise exception 'admin_already_has_profile' using errcode = '23505';
  end if;

  insert into public.organizations
    (name, default_currency, default_locale, default_number_locale, default_timezone)
  values (btrim(p_name), p_default_currency, p_default_locale,
          nullif(btrim(p_default_number_locale), ''), p_default_timezone)
  returning id into v_org_id;

  insert into public.profiles (id, org_id, full_name, email, role, status)
  values (p_admin_user_id, v_org_id, btrim(p_admin_full_name), v_admin_email, 'Admin', 'active');

  -- #619: per-org configuration companions. The seed org got these from 0008's migration-time insert;
  -- an org created here got nothing, so its pipeline read weighted values as zero (found at RIS).
  perform public.seed_org_defaults(v_org_id);

  -- ⛔ NEXT COMPANION GOES HERE — and if it is per-org CONFIG ROWS, it goes in seed_org_defaults()
  -- so the backfill and the create path cannot drift. Remaining: pmo_epoch_at (DD-XING-2), lifecycle_state (#489).

  return v_org_id;
end $$;

-- §2 — backfill every existing org that has no stage config (the RIS org on the live project).
do $$
declare o record;
begin
  for o in select id from public.organizations org
           where not exists (select 1 from public.pipeline_stage_config c where c.org_id = org.id)
  loop
    perform public.seed_org_defaults(o.id);
  end loop;
end $$;

-- §3 — assert on the migrated database: no org without its stage config.
do $$
declare v_missing text;
begin
  select string_agg(org.id::text, ', ') into v_missing
  from public.organizations org
  where not exists (select 1 from public.pipeline_stage_config c where c.org_id = org.id);
  if v_missing is not null then
    raise exception '0213: orgs without pipeline_stage_config: %', v_missing;
  end if;
end $$;
