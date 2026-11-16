-- 0906_org_name_unique.sql — one name per organization, enforced by the database (#2264, ADR-0101).
--
-- "Same name" = equal under ONE function, public.org_name_key(text): every run of whitespace folded
-- to one space, both ends trimmed, letters lower-cased. Whitespace is any of: space, tab, newline,
-- carriage return, vertical tab, form feed, next line (U+0085), non-breaking space (U+00A0), the other
-- Unicode space characters (U+1680, U+2000-U+200A, U+2028, U+2029, U+202F, U+205F, U+3000), zero-width
-- space (U+200B) and the byte-order mark (U+FEFF). The list is spelled out rather than taken from
-- [[:space:]], whose meaning follows the database locale. The unique index, the blank-name check, the
-- duplicate rename and the operator-org function's re-run lookup (organization_id_by_name) all call
-- this one function, so they cannot disagree about what "the same name" is. So `Acme Works`, `acme works`, ` Acme Works\t`, `Acme\tWorks`,
-- `Acme<newline>Works`, `Acme<U+00A0>Works` and `Acme   Works` are one name: two names that look the
-- same on screen collide. A unique index holds the rule, so two concurrent creates with the same name
-- cannot both commit, and it binds every writer (service role, provisioning, any future RPC) rather
-- than one function.
--
-- §1 EXISTING DUPLICATES. The index cannot be built while two rows share a normalized name, and this
-- migration must apply on every database. Within each group of equal names the oldest organization
-- (created_at, then id) keeps its name; every later one is renamed to
-- `<name> (duplicate <first 8 characters of its id>)`, which is deterministic and distinct. No
-- organization is dropped or merged; each rename is reported with a NOTICE carrying the org id and
-- its previous name, so an operator can rename it properly afterwards. THE ROLLBACK DOES NOT REVERSE
-- THESE RENAMES: a renamed organization keeps its new name after the down migration; its previous
-- name survives only in this migration's NOTICE output. (Production held no duplicate names when this
-- shipped, so there the rename changes nothing; it exists so the migration applies on any database.) If a renamed value still
-- collided with an existing name, the index build below fails and the migration aborts as a whole.
--
-- §3 operator_create_org: 0213's body and error order, with its name checks made on the key: a name
-- whose key is empty is `org_name_required`; a taken name is `org_name_taken` (23505), checked where
-- 0213 checked it (before the Admin checks) and again by the index at insert, which catches a
-- concurrent create with the same name. The operator-org function maps it to ORG_NAME_TAKEN.
--
-- §4 organization_id_by_name: the operator-org function's re-run lookup. It answers "which
-- organization already has this name?" with the same key, so a re-run is recognised (or refused) before
-- any invitation is sent. Service role only.
--
-- Rollback: supabase/migrations/rollback/0906_org_name_unique_down.sql.

-- §0 — the one definition of "the same name".
create function public.org_name_key(p_name text) returns text
language sql immutable strict parallel safe set search_path = pg_catalog as $$
  select lower(btrim(regexp_replace(
    p_name,
    '[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]+',
    ' ', 'g')))
$$;
comment on function public.org_name_key(text) is
  '#2264: the key that decides when two organization names are the same: any whitespace run is one space, ends trimmed, case ignored.';

-- §1 — rename later duplicates so the index can be built. A function so the step is tested (pgTAP 0906
-- AC-ORG-028); no API role may run it.
create function public.organizations_rename_duplicate_names() returns void
language plpgsql set search_path = public as $$
declare r record;
begin
  for r in
    select id, name
    from (
      select id, name,
             row_number() over (partition by public.org_name_key(name) order by created_at, id) as rn
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
revoke all on function public.organizations_rename_duplicate_names() from public, anon, authenticated, service_role;

select public.organizations_rename_duplicate_names();

-- §2 — the rule.
create unique index organizations_name_normalized_key
  on public.organizations (public.org_name_key(name));

comment on index public.organizations_name_normalized_key is
  '#2264: one organization per name, compared by public.org_name_key (case ignored, ends trimmed, any whitespace run is one space).';

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
  -- Error order (pgTAP 0906 AC-ORG-024/026/027): inactive → operator_only → org_name_required →
  -- admin_user_required → admin_full_name_required → default_currency_required →
  -- default_locale_required → default_number_locale_invalid → default_timezone_required →
  -- org_name_taken → unknown_admin_user → admin_user_has_no_email → admin_already_has_profile →
  -- org_name_taken again from the index, for a create with the same name that committed meanwhile.
  if not public.is_active_member() then
    raise exception 'inactive' using errcode = '42501';
  end if;
  if not public.is_operator() then
    raise exception 'operator_only' using errcode = '42501';
  end if;

  if p_name is null or public.org_name_key(p_name) = '' then
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

  if exists (select 1 from public.organizations
             where public.org_name_key(name) = public.org_name_key(p_name)) then
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

  -- #2264: the unique index has the last word, so a concurrent create with the same name is refused
  -- too. Only that index's violation is renamed; any other unique violation propagates.
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

-- §4 — the operator-org function's re-run lookup, on the same key. The oldest match wins (only one
-- can exist while the index holds).
create function public.organization_id_by_name(p_name text) returns uuid
language plpgsql stable set search_path = public as $$
declare v_id uuid;
begin
  if p_name is null or public.org_name_key(p_name) = '' then
    raise exception 'org_name_required' using errcode = 'P0001';
  end if;
  select o.id into v_id from public.organizations o
   where public.org_name_key(o.name) = public.org_name_key(p_name)
   order by o.created_at, o.id limit 1;
  return v_id;
end $$;
revoke all on function public.organization_id_by_name(text) from public, anon, authenticated;
grant execute on function public.organization_id_by_name(text) to service_role;
