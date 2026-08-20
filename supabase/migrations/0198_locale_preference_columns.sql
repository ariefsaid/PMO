-- 0198_locale_preference_columns.sql — FR-L10N-001..006 (#468, DD-I18N-2): the locale/timezone
-- preference columns + operator_create_org's required locale params, in ONE migration (spec §0.4 /
-- trap 10: adding the columns without the function leaves the RIS org silently inheriting 'en').
--
-- ── REVERSIBILITY (ADR-0006) — NOT `supabase db reset`; v0.9.x is in production. Manual reverse,
--    after removing callers (restore the 4-arg operator_create_org from 0192's file verbatim):
--      drop policy if exists profiles_locale_self_only on public.profiles;
--      revoke update on public.profiles from authenticated, anon;
--      grant update (full_name, avatar_url, title, location, skills, role, manager_id)
--        on public.profiles to authenticated;
--      drop function if exists public.operator_create_org(text,uuid,text,text,text,text,text);
--      -- re-create the 4-arg function from 0192, then:
--      grant execute on function public.operator_create_org(text,uuid,text,text) to authenticated;
--      alter table public.profiles
--        drop column if exists locale, drop column if exists number_locale, drop column if exists timezone;
--      alter table public.organizations
--        drop column if exists default_locale, drop column if exists default_number_locale,
--        drop column if exists default_timezone;

-- ═══ §1 — organizations defaults (FR-L10N-001). NOT NULL + default backfills existing orgs. ═══
alter table public.organizations
  add column if not exists default_locale         text not null default 'en',
  add column if not exists default_number_locale  text,
  add column if not exists default_timezone       text not null default 'Asia/Jakarta';

comment on column public.organizations.default_locale is
  'FR-L10N-001 (DD-I18N-2): the org''s default UI language tag (catalogue key: en | id). Profile NULL inherits this. '
  'Operator-set at creation via operator_create_org; organizations has no client write path (default_currency posture).';
comment on column public.organizations.default_number_locale is
  'FR-L10N-001: the org''s default Intl number locale. NULL = derive from the locale (a bare language tag is a valid '
  'Intl number locale). Kept separate from default_locale because separators and language are independent choices.';
comment on column public.organizations.default_timezone is
  'FR-L10N-001 (DD-RIS-2): IANA tz. Defaults to Asia/Jakarta — the deployment''s operating timezone — so an org '
  'created before the operator states one is wrong by a timezone, not by a continent. Profile NULL inherits this.';

-- ═══ §2 — profiles preferences (FR-L10N-002). NULL = inherit the org (NEVER copy the org value ═══
-- down: copying freezes it — the design AC-L10N-002 exists to reject. Reset = write NULL, FR-L10N-004.)
alter table public.profiles
  add column if not exists locale         text,
  add column if not exists number_locale  text,
  add column if not exists timezone       text;

comment on column public.profiles.locale is
  'FR-L10N-002: the user''s UI language override. NULL = inherit organizations.default_locale (live, not a frozen copy). '
  'Self-service only — profiles_locale_self_only (0198) bars everyone, Admin included, from another user''s row.';
comment on column public.profiles.number_locale is
  'FR-L10N-002: the user''s Intl number-locale override. NULL = inherit the org default, which itself may be NULL (derive).';
comment on column public.profiles.timezone is
  'FR-L10N-002: the user''s IANA timezone override. NULL = inherit organizations.default_timezone.';

-- ═══ §3 — the column allow-list (FR-L10N-006). profiles UPDATE is an explicit column allow-list  ═══
-- (0182/0184). A column NOT in the list is not client-writable, so the three preferences must be
-- granted. 0182/0184's shape re-declares the END STATE in full: revoke table-wide, re-grant the
-- whole list (a column grant is additive, but self-contained files beat archaeology).
revoke update on public.profiles from authenticated, anon;
grant update (full_name, avatar_url, title, location, skills, role, manager_id,
              locale, number_locale, timezone)
  on public.profiles to authenticated;

comment on table public.profiles is
  '⚑ 0198: client UPDATE allow-list is now TEN columns (0184''s seven + locale, number_locale, timezone). '
  'email, company_id, utilization, updated_at, id, org_id, created_at and status remain NOT client-writable. '
  'The three preference columns are additionally pinned to SELF by the restrictive policy '
  'profiles_locale_self_only — the org_id pin and immutable trigger are unchanged.';

-- ═══ §4 — restrictive policy (FR-L10N-006: "their OWN three preference columns and no one else's").═
-- 0179's permissive profiles_hierarchy_update lets Executive-rank+ update others' rows; policies OR,
-- so a column grant alone would let an Admin set another user's locale. Restrictive policies AND:
-- an UPDATE passes only if the writer IS the row owner, or the three preference values are
-- unchanged (same-row-read subselect, the 0002/0007 idiom — the persisted row still holds OLD
-- during WITH CHECK evaluation, so this reads "did this statement change them?").
create policy profiles_locale_self_only on public.profiles
  as restrictive for update
  using (true)
  with check (
    id = (select auth.uid())
    or (
         locale        is not distinct from (select p.locale        from public.profiles p where p.id = profiles.id)
     and number_locale is not distinct from (select p.number_locale from public.profiles p where p.id = profiles.id)
     and timezone      is not distinct from (select p.timezone      from public.profiles p where p.id = profiles.id)
    )
  );

comment on policy profiles_locale_self_only on public.profiles is
  'FR-L10N-006 (#468): only the profile''s OWNER may change locale/number_locale/timezone — Admin and '
  'Executive hierarchy edits (0179) must not carry a locale override onto someone else. '
  '"Unchanged" is tolerated so non-preference hierarchy edits stay legal.';

-- ═══ §5 — operator_create_org gains the locale companions (FR-L10N-005, the 0192 ⛔ TODO). ═══
-- ⚑ DROP FIRST: create-or-replace with a different parameter list creates an OVERLOAD and leaves the
-- old 4-arg function callable — the exact silent-en-org the TODO warns about. All three params are
-- REQUIRED with NO defaults (DD-CUR-3 reasoning: omission must be a hard error). number_locale is
-- required-but-nullable: the caller must STATE it; explicit NULL is the legal "derive" choice.
drop function if exists public.operator_create_org(text,uuid,text,text);

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

  -- ⛔ NEXT COLUMN GOES HERE. Remaining companions: pmo_epoch_at (DD-XING-2), lifecycle_state (#489).

  return v_org_id;
end $$;

comment on function public.operator_create_org(text,uuid,text,text,text,text,text) is
  'DD-ORG-1 (#484, #468): Operator-only, security-definer creation of an org AND its companions (first '
  'Admin membership, default_currency, default_locale/number_locale/timezone — all REQUIRED, no defaults) '
  'in one transaction. No UI. pmo_epoch_at (DD-XING-2) and lifecycle_state (#489) remain TODO. '
  'Runbook: docs/environments.md.';

revoke all     on function public.operator_create_org(text,uuid,text,text,text,text,text) from public;
grant  execute on function public.operator_create_org(text,uuid,text,text,text,text,text) to authenticated;
