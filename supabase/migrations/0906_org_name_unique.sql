-- 0906_org_name_unique.sql — one name per organization, enforced by the database (#2264, ADR-0101).
--
-- "Same name" = equal after lower-casing and trimming surrounding spaces (btrim): `Acme`, `acme` and
-- ` Acme ` are one name; `Acme  Works` (inner spacing) and `Acme Works` are two. This is the rule the
-- create function's guard already applied (it stores btrim(p_name) and compared lower(name)), now held
-- by a unique index so two concurrent creates with the same name cannot both commit, and so it binds
-- every writer (service role, provisioning, any future RPC) rather than one function.
--
-- §1 EXISTING DUPLICATES. The index cannot be built while two rows share a normalized name, and this
-- migration must apply on every database. Within each group of equal names the oldest organization
-- (created_at, then id) keeps its name; every later one is renamed to
-- `<name> (duplicate <first 8 characters of its id>)`, which is deterministic and distinct. No
-- organization is dropped or merged; each rename is reported with a NOTICE carrying the org id and
-- its previous name, so an operator can rename it properly afterwards. If a renamed value still
-- collided with an existing name, the index build below fails and the migration aborts as a whole.
--
-- §3 operator_create_org: 0213's body, with its read-before-insert name check replaced by the
-- index itself. The insert catches the index's unique violation and raises the function's existing
-- `org_name_taken` (23505), which the operator-org function maps to ORG_NAME_TAKEN.
--
-- Rollback: supabase/migrations/rollback/0906_org_name_unique_down.sql.

-- §1 — rename later duplicates so the index can be built.
do $$
declare r record;
begin
  for r in
    select id, name
    from (
      select id, name,
             row_number() over (partition by lower(btrim(name)) order by created_at, id) as rn
      from public.organizations
    ) ranked
    where rn > 1
    order by id
  loop
    update public.organizations
       set name = btrim(r.name) || ' (duplicate ' || left(r.id::text, 8) || ')'
     where id = r.id;
    raise notice '0906: organization % renamed from % (its name matched an older organization)', r.id, r.name;
  end loop;
end $$;

-- §2 — the rule.
create unique index organizations_name_normalized_key
  on public.organizations (lower(btrim(name)));

comment on index public.organizations_name_normalized_key is
  '#2264: one organization per name, compared ignoring letter case and surrounding spaces.';

-- §3 — operator_create_org: same signature, in-place replace of 0213's body.
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
  v_constraint  text;
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

  -- #2264: the unique index decides a taken name, so a concurrent create with the same name is
  -- refused too. Only that index's violation is renamed; any other unique violation propagates.
  begin
    insert into public.organizations
      (name, default_currency, default_locale, default_number_locale, default_timezone)
    values (btrim(p_name), p_default_currency, p_default_locale,
            nullif(btrim(p_default_number_locale), ''), p_default_timezone)
    returning id into v_org_id;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'organizations_name_normalized_key' then
      raise exception 'org_name_taken' using errcode = '23505';
    end if;
    raise;
  end;

  insert into public.profiles (id, org_id, full_name, email, role, status)
  values (p_admin_user_id, v_org_id, btrim(p_admin_full_name), v_admin_email, 'Admin', 'active');

  -- #619: per-org configuration companions (see 0213).
  perform public.seed_org_defaults(v_org_id);

  -- ⛔ NEXT COMPANION GOES HERE — and if it is per-org CONFIG ROWS, it goes in seed_org_defaults()
  -- so the backfill and the create path cannot drift. Remaining: pmo_epoch_at (DD-XING-2), lifecycle_state (#489).

  return v_org_id;
end $$;
