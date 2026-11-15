-- Down for 0906 (#2264): drops the normalized-name unique index, restores operator_create_org to its 0213 body, verbatim,
-- then drops 0906's functions (org_name_key, organizations_rename_duplicate_names, organization_id_by_name).
-- Organizations renamed by 0906 §1 keep their new names; each previous name was reported in that migration's NOTICE output.
drop index if exists public.organizations_name_normalized_key;
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
drop function if exists public.organization_id_by_name(text);
drop function if exists public.organizations_rename_duplicate_names();
drop function if exists public.org_name_key(text);
