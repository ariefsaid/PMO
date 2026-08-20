# Plan — FR-L10N-001..006: locale/timezone preference columns (DB half)

**Spec:** `docs/specs/i18n-framework.spec.md` §0.4, §2, §7 (traps 9 & 10) — binding.
**Issue lineage:** #468 → #450 step 1. Rulings: `DD-I18N-2`, `DD-RIS-2`.
**Executor:** ADW (bounded DB + FE-seam slice; no money/SoD/auth-tier logic beyond RLS proofs).
**Worktree:** `i18n-locale-prefs` (this worktree). Branch off `dev` → PR to `dev`.

---

## 0. Scope, verified against the tree (read §0 of the spec first — three brief premises are wrong)

**In scope (this plan):**
- `organizations.default_locale / default_number_locale / default_timezone` (FR-L10N-001)
- `profiles.locale / number_locale / timezone`, nullable = inherit (FR-L10N-002)
- `resolveLocale(profile, org)` — the ONE resolution helper (FR-L10N-003)
- "Reset to org default" = write NULL, never copy (FR-L10N-004)
- `operator_create_org` gains three REQUIRED params **in the same migration** (FR-L10N-005; deletes the ⛔ TODO at `supabase/migrations/0192_operator_create_org.sql:32-36`)
- RLS + grants so a user reads/writes **own** preferences only; org defaults have **no client write path** (FR-L10N-006)
- pgTAP proof for every rule, mutation-checked

**NOT in scope (do not touch):** `src/lib/format.ts` + call sites (sibling ADW owns the currency half), any i18n library/dependency, translation keys, any locale-picker UI, the export path.

**Facts established by recon (these shape the design):**
1. **`profiles` client UPDATE is a column allow-list** — 0184's seven columns (`full_name, avatar_url, title, location, skills, role, manager_id`). A new column is **NOT client-writable unless explicitly granted** (the inverse of `DD-CUR-4`'s trap; `grant update (col)` is additive but the house style re-declares the whole end-state). `organizations` has **table-level** grants, all revoked for clients (0192), so nothing is needed there.
2. **RLS:** `profiles_update_self` (0007) permits self-update and pins only `org_id/role/manager_id` — locale columns pass its WITH CHECK untouched. `profiles_hierarchy_update` (0179) lets Executive-rank+ update **others'** rows; without a guard, an Admin could set another user's locale once the column grant exists — violating FR-L10N-006's "and no one else's". A **restrictive** policy closes it.
3. **`operator_create_org` signature change is a trap:** `create or replace` with a *different parameter list* creates an **overload**, leaving the old 4-arg function callable. Must `drop function` the 4-arg signature first, then create the 7-arg one, then re-issue `revoke/grant execute` for the **new** signature.
4. Migration numbering: next free is **0198** (dir ends at `0197`; `rollback/` doesn't consume numbers).
5. `0191` already added `organizations.lifecycle_state`; the 0192 TODO block is stale about it — **leave the lifecycle/pmo_epoch TODOs alone**; remove only the locale bullet.
6. Callers of `operator_create_org`: only `docs/environments.md` (curl example), `docs/operator-runbook.md` (signature), and generated types `pmo-portal/src/lib/supabase/database.types.ts`. `scripts/lib/provisionOrgAdmin.mjs` only mentions it in prose (bootstrap path, unaffected). **Every existing call in `supabase/tests/operator_create_org.test.sql` must be bumped to 7 args** or the suite breaks.

---

## 1. Design

### 1.1 Column shapes (exactly per FR-L10N-001/002)

| Table | Column | Type | Constraint |
|---|---|---|---|
| organizations | `default_locale` | text | `not null default 'en'` |
| organizations | `default_number_locale` | text | nullable (NULL = derive from the locale) |
| organizations | `default_timezone` | text | `not null default 'Asia/Jakarta'` |
| profiles | `locale` | text | nullable (NULL = inherit org) |
| profiles | `number_locale` | text | nullable (NULL = inherit org) |
| profiles | `timezone` | text | nullable (NULL = inherit org) |

**No CHECK constraints** — deliberate: the spec defines none; locale tags are an open set (BCP-47: `en`, `id`, `id-ID`, `zh-Hans-CN`…), and IANA tz names can't be validated without a catalog. Validation is the **resolver's** job (FR-L10N-003), which fails closed to `en`/`Asia/Jakarta`. `default_currency` got a regex only because ISO-4217 is a tiny closed set. Do not invent constraints.

NOT NULL with default backfills existing org rows automatically (PG fast-default, no table rewrite). Profile columns are nullable — no backfill.

### 1.2 Authorization — three layers (house defence-in-depth)

- **Layer 1, grants:** extend the profiles UPDATE allow-list from 7 to **10** columns (`revoke` table-wide + re-grant the full list — 0182/0184 shape, end-state declared in full so the file is self-contained). `organizations` needs nothing: 0192 already revoked all client write DML.
- **Layer 2, RLS:** `profiles_update_self` already covers self-writes (nothing to change). Add ONE **restrictive** policy `profiles_locale_self_only`: for UPDATE, require `id = auth.uid()` OR all three preference columns unchanged vs the persisted row (same-row-read subselect idiom, precedent: 0002/0007). Restrictive policies AND against the permissive OR — so the 0179 hierarchy policy can no longer carry an Admin into someone else's locale columns. This is what makes FR-L10N-006's "and **no one else's**" true, not just the non-Admin case AC-L10N-005 tests.
- **Layer 3, org defaults:** set at creation via `operator_create_org` (FR-L10N-005) and by nothing else client-side — exactly `default_currency`'s posture. **No new setter RPC** (default_currency has none either; post-creation fixes are the operator/service-role path per the 0192 TODO's own framing). pgTAP asserts the absence of a client write path.

### 1.3 `operator_create_org` — required params, no defaults (FR-L10N-005)

Seven params. `p_default_locale` and `p_default_timezone`: null/blank → `P0001` (columns are NOT NULL; omission must be a hard error, `DD-CUR-3` reasoning). `p_default_number_locale`: **required parameter, nullable value** — the caller must *state* it (Postgres errors if a no-default param is absent), and `null` is the legitimate "derive from locale" choice; only blank-string garbage raises. Drop the 4-arg signature (overload trap), re-grant EXECUTE for the new signature.

### 1.4 FE seam (DAL → repository), ADR-0017

- `src/lib/db/preferences.ts` — the DAL: `getMyLocalePreferences(userId)` / `setMyLocalePreferences(userId, prefs)` where **`null` means inherit** and is the only correct reset (FR-L10N-004 — copying the org's value would freeze it; AC-L10N-002 exists precisely to catch that design).
- `src/lib/repositories/preferences.ts` — standalone repository module wrapping the DAL with `toAppError` normalization (the `budgetProjection.ts`/`revenueDisplay.ts` precedent; `index.ts` is shared across concurrent slices — do NOT edit it).
- `src/lib/locale/resolveLocale.ts` — pure resolution helper (FR-L10N-003). No `Intl` construction (the ESLint fence stays clean): precedence is `profile.X ?? org.default_X ?? fallback`, with `numberLocale` falling through to the **resolved locale** (bare language tags are valid `Intl` number locales). ⚑ Open question Q1 (below) records the one spec ambiguity: whether org-null number-locale derives from `default_locale` literally or from the *resolved* locale when a user overrides theirs. Implemented as resolved-locale (a user who switches UI language should not keep foreign separators); one-line change if ruled otherwise; tests document it.
- `AuthProvider`'s existing `select('*')` read picks the new profile columns up automatically after typegen — no read-path change needed.

---

## 2. Tasks

TDD order throughout: **write the failing test first, watch it red, then implement.** Every task ends with its verify command. Paths are repo-root-relative. Work happens in this worktree (`i18n-locale-prefs`) on a feature branch off `dev`.

---

### Task 1 — pgTAP skeleton for the new rules (RED first)

**Create** `supabase/tests/locale_preferences.test.sql`. Owns **AC-L10N-005**; references AC-L10N-003.

```sql
-- locale_preferences.test.sql — proof for 0198_locale_preference_columns.sql (#468, FR-L10N-001..006).
--
-- AC ids owned here:
--   AC-L10N-005  a non-Admin user writing ANOTHER profile's locale is RLS-denied; and the
--               restrictive policy extends "no one else's" to Admin/Executive writers too.
--   (companions, owned elsewhere: AC-L10N-003 reset-writes-NULL is owned by the DAL unit test;
--    AC-L10N-004 by operator_create_org.test.sql)
--
-- ⚑ pgTAP runs as the superuser migration role, which BYPASSES RLS and grants. Authz assertions
-- therefore run under `set local role authenticated` + request.jwt.claims (operator_create_org
-- idiom). Catalog assertions use has_column_privilege / has_table_privilege.
--
-- MUTATION-CHECKED — see Task 9. No schema changes (fixtures inside begin/rollback).
begin;
select plan(10);

-- ── Fixtures (0468… ids, #468). All inserted before any jwt claims are set.
insert into organizations (id, name, default_currency, default_locale, default_number_locale, default_timezone)
values ('04680000-0000-0000-0000-000000000001', 'AC-L10N Home Org', 'IDR', 'id', null, 'Asia/Jakarta');
insert into auth.users (id, email) values
  ('04680000-0000-0000-0000-0000000000a1','l10n-self@example.com'),
  ('04680000-0000-0000-0000-0000000000a2','l10n-peer@example.com'),
  ('04680000-0000-0000-0000-0000000000a3','l10n-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('04680000-0000-0000-0000-0000000000a1','04680000-0000-0000-0000-000000000001','Self','l10n-self@example.com','Engineer','active'),
  ('04680000-0000-0000-0000-0000000000a2','04680000-0000-0000-0000-000000000001','Peer','l10n-peer@example.com','Engineer','active'),
  ('04680000-0000-0000-0000-0000000000a3','04680000-0000-0000-0000-000000000001','Admin','l10n-admin@example.com','Admin','active');

-- ═══ FR-L10N-001/002 — the columns exist with the ruled shapes (shape companions). ═══
select is((select column_default from information_schema.columns
            where table_schema='public' and table_name='organizations' and column_name='default_locale'),
          '''en''::text', 'FR-L10N-001 organizations.default_locale defaults to en');
select is((select is_nullable from information_schema.columns
            where table_schema='public' and table_name='organizations' and column_name='default_number_locale'),
          'YES', 'FR-L10N-001 organizations.default_number_locale is nullable (NULL = derive)');
select is((select is_nullable from information_schema.columns
            where table_schema='public' and table_name='profiles' and column_name='locale'),
          'YES', 'FR-L10N-002 profiles.locale is nullable (NULL = inherit org)');

-- ═══ FR-L10N-006 — the grant surface. The 0182/0184 allow-list is re-declared + extended. ═══
select ok(has_column_privilege('authenticated','public.profiles','locale','UPDATE'),
  'FR-L10N-006 authenticated may UPDATE profiles.locale (0198 allow-list)');
select ok(has_column_privilege('authenticated','public.profiles','number_locale','UPDATE'),
  'FR-L10N-006 authenticated may UPDATE profiles.number_locale');
select ok(has_column_privilege('authenticated','public.profiles','timezone','UPDATE'),
  'FR-L10N-006 authenticated may UPDATE profiles.timezone');
select ok(has_column_privilege('authenticated','public.profiles','role','UPDATE')
      and has_column_privilege('authenticated','public.profiles','full_name','UPDATE'),
  'FR-L10N-006 regression: the 0184 seven-column allow-list survived the re-grant');
select ok(not has_table_privilege('authenticated','public.organizations','UPDATE'),
  'FR-L10N-006 organizations has NO client write path (default_currency posture, org defaults are operator-set only)');

-- ═══ AC-L10N-005 — the write contract, as a live authenticated caller. ═══
set local role authenticated;
set local request.jwt.claims = '{"sub":"04680000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ update profiles set locale='en', number_locale='en-US', timezone='UTC'
      where id = '04680000-0000-0000-0000-0000000000a1' $$,
  'AC-L10N-005 companion: a user CAN write their OWN three preference columns (FR-L10N-006)');
select is((select locale from profiles where id='04680000-0000-0000-0000-0000000000a1'), 'en',
  'AC-L10N-005 companion: the own-write persisted');

select throws_ok(
  $$ update profiles set locale='en' where id = '04680000-0000-0000-0000-0000000000a2' $$,
  '42501', null,
  'AC-L10N-005 a non-Admin writing another profile''s locale is RLS-denied');

set local request.jwt.claims = '{"sub":"04680000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok(
  $$ update profiles set locale='en' where id = '04680000-0000-0000-0000-0000000000a2' $$,
  '42501', null,
  'AC-L10N-005 an ADMIN writing another profile''s locale is denied too (restrictive policy — FR-L10N-006 ''no one else''s'')');
select lives_ok(
  $$ update profiles set full_name='Admin Renamed'
      where id = '04680000-0000-0000-0000-0000000000a2' $$,
  'AC-L10N-005 companion: the 0179 hierarchy policy still lets an Admin edit others'' NON-preference columns (0198 narrows only locale/number_locale/timezone)');

reset role;
select finish();
rollback;
```

**Verify (expect RED — columns don't exist):** `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db --file supabase/tests/locale_preferences.test.sql'`
*(If `--file` isn't supported by your CLI version, run the full `supabase test db` — same lock.)* Record the red.

---

### Task 2 — pgTAP additions for `operator_create_org` (RED first)

**Edit** `supabase/tests/operator_create_org.test.sql`:
1. Bump **every** `operator_create_org(...)` call from 4 args to 7: append `'id', null, 'Asia/Jakarta'` — **except** where a param is deliberately `null` to prove P0001.
2. Add after the AC-ORG-010 block:

```sql
select throws_ok(
  $$ select operator_create_org('AC-L10N Org','04840000-0000-0000-0000-0000000000b2','Second Admin','IDR',null,'id','Asia/Jakarta') $$,
  'P0001', null,
  'AC-L10N-004 a missing default_locale is a hard error, never a silent en');
select throws_ok(
  $$ select operator_create_org('AC-L10N Org','04840000-0000-0000-0000-0000000000b2','Second Admin','IDR','id',null,null) $$,
  'P0001', null,
  'AC-L10N-004 a missing default_timezone is a hard error, never a silent default');
select throws_ok(
  $$ select operator_create_org('AC-L10N Org','04840000-0000-0000-0000-0000000000b2','Second Admin','IDR','id','','Asia/Jakarta') $$,
  'P0001', null,
  'AC-L10N-004 a blank default_number_locale is refused (explicit NULL is the legal derive choice)');
select lives_ok(
  $$ select operator_create_org('AC-L10N Stated Org','04840000-0000-0000-0000-0000000000b2','L10N Admin','IDR','id',null,'Asia/Jakarta') $$,
  'AC-L10N-004 companion: an explicit number_locale of NULL is accepted (derive)');
reset role;
select is((select default_locale || '|' || coalesce(default_number_locale,'<null>') || '|' || default_timezone
             from organizations where name = 'AC-L10N Stated Org'), 'id|<null>|Asia/Jakarta',
  'AC-L10N-004 companion: the org carries the STATED locale defaults (DD-RIS-2: id / Indonesian / Asia/Jakarta)');
set local role authenticated;
set local request.jwt.claims = '{"sub":"04840000-0000-0000-0000-0000000000a1","role":"authenticated"}';
```

Update the file header comment to note AC-L10N-004 is owned here. Bump `select plan(N)` to the new count.

**Verify (RED):** `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'` — the new AC-L10N-004 cases fail (function still 4-arg) AND the arity-bumped old calls fail. Record.

---

### Task 3 — Migration `0198_locale_preference_columns.sql` §1–§4: columns + grants + restrictive policy

**Create** `supabase/migrations/0198_locale_preference_columns.sql`:

```sql
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
```

**Verify:** `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db --file supabase/tests/locale_preferences.test.sql'` — Task 1's file should now be mostly GREEN (the operator_create_org cases still red until Task 4).

---

### Task 4 — Migration §5–§6: `operator_create_org` 7-arg replace

**Append** to the same migration file:

```sql
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
```

**Verify (expect GREEN):** `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'` — BOTH pgTAP files green, nothing else regressed.

---

### Task 5 — Retire the 0192 ⛔ TODO (prose-only edit to an applied migration)

**Edit** `supabase/migrations/0192_operator_create_org.sql` — comments ONLY, no SQL statements change:
1. Delete the `• organizations.default_locale / .default_number_locale / .default_timezone` bullet from the `⛔ TODO` block (keep `pmo_epoch_at` and `lifecycle_state`; leave the TODO header itself — two items remain).
2. In the `⛔ NEXT COLUMN GOES HERE` comment inside the function body: delete the `locale defaults (#468),` fragment (keep the other two).
3. In the file-header `SET HERE (columns exist today)` inventory, add one line:
   `--   organizations.default_locale/.default_number_locale/.default_timezone — 0198 (#468). ⚑ REQUIRED PARAMETERS, no defaults (except number_locale's value, where NULL = derive).`

Editing `--` comment text in an applied migration is replay-safe (not catalog state); the catalog-visible `comment on function` was superseded in Task 4 for the live (7-arg) signature.

**Verify:** `grep -n "DD-I18N-2" supabase/migrations/0192_operator_create_org.sql` → only historical-context mentions remain, no TODO bullet; then `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'` still green (proves no SQL drifted).

---

### Task 6 — Mutation battery for the pgTAP proofs (the brief's non-negotiable)

Run each mutation **one at a time**, observe the named test go RED, revert, re-run green. All under the db lock. **Report each observation** (which test, which line went red) in the build report — a suite that stays green while the rule is broken is not a suite.

| # | Mutation (edit, don't commit) | Must redden |
|---|---|---|
| M1 | In 0198 §5, comment out the `p_default_locale` null/blank raise | `AC-L10N-004 … missing default_locale` (org would be created silently `en`) |
| M2 | In 0198 §3, delete the `grant update (…)` re-grant | `AC-L10N-005 companion: a user CAN write their OWN…` (42501) + the three `has_column_privilege` assertions |
| M3 | In 0198 §4, `drop policy profiles_locale_self_only` (or add `as permissive`) | `AC-L10N-005 an ADMIN writing another profile's locale…` |
| M4 | In 0007's live behavior via a scratch `create or replace policy profiles_update_self … using (true)` in a temp migration, run tests, delete it | `AC-L10N-005 a non-Admin writing another profile's locale…` |

**Verify:** after reverting all four: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'` — green.

---

### Task 7 — Regenerate `database.types.ts`

**Run** from repo root (after a `db reset` so the local schema has 0198):
```
scripts/with-db-lock.sh supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts
```
**Diff check:** `git diff pmo-portal/src/lib/supabase/database.types.ts` must show ONLY: the six new columns on `organizations`/`profiles`, `operator_create_org` Args gaining the three params (and the 4-arg overload disappearing). Anything else → investigate, don't commit.

**Verify:** `cd pmo-portal && npm run typecheck` — zero errors.

---

### Task 8 — `resolveLocale` (FR-L10N-003) — test first

**Create** `pmo-portal/src/lib/locale/resolveLocale.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveLocale, FALLBACK_LOCALE, FALLBACK_TIMEZONE } from './resolveLocale';

const org = (o: Partial<Parameters<typeof resolveLocale>[1]> = {}) => ({
  defaultLocale: 'en', defaultNumberLocale: null, defaultTimezone: 'Asia/Jakarta', ...o,
});

describe('FR-L10N-003 resolveLocale — the ONE resolution seam', () => {
  it('AC-L10N-001 profile NULL inherits the org default (live link, not a frozen copy)', () => {
    expect(resolveLocale({ locale: null, numberLocale: null, timezone: null }, org({ defaultLocale: 'id' })).locale).toBe('id');
    // the org flips → the same NULL profile now resolves 'en': inherit, never copy
    expect(resolveLocale({ locale: null, numberLocale: null, timezone: null }, org({ defaultLocale: 'en' })).locale).toBe('en');
  });
  it('AC-L10N-002 an explicit profile override STAYS when the org flips', () => {
    expect(resolveLocale({ locale: 'en', numberLocale: null, timezone: null }, org({ defaultLocale: 'en' })).locale).toBe('en');
    expect(resolveLocale({ locale: 'en', numberLocale: null, timezone: null }, org({ defaultLocale: 'id' })).locale).toBe('en');
  });
  it('AC-L10N-003 companion: reset = resolve as if unset — the helper cannot tell a reset from never-set', () => {
    const reset = { locale: null, numberLocale: null, timezone: null };
    expect(resolveLocale(reset, org({ defaultLocale: 'id' }))).toEqual(
      resolveLocale({ locale: undefined, numberLocale: undefined, timezone: undefined }, org({ defaultLocale: 'id' })));
  });
  it('number_locale chain: profile → org → derived from the resolved locale', () => {
    expect(resolveLocale({ locale: null, numberLocale: null, timezone: null }, org()).numberLocale).toBe('en');
    expect(resolveLocale({ locale: null, numberLocale: null, timezone: null }, org({ defaultNumberLocale: 'id-ID' })).numberLocale).toBe('id-ID');
    expect(resolveLocale({ locale: null, numberLocale: 'en-US', timezone: null }, org({ defaultLocale: 'id' })).numberLocale).toBe('en-US');
    // ⚑ Q1: org number NULL + user locale override → follows the RESOLVED locale (documented decision)
    expect(resolveLocale({ locale: 'id', numberLocale: null, timezone: null }, org({ defaultLocale: 'en' })).numberLocale).toBe('id');
  });
  it('timezone chain: profile → org → Asia/Jakarta fallback', () => {
    expect(resolveLocale({ locale: null, numberLocale: null, timezone: 'UTC' }, org()).timezone).toBe('UTC');
    expect(resolveLocale({ locale: null, numberLocale: null, timezone: null }, org({ defaultTimezone: 'Europe/Berlin' })).timezone).toBe('Europe/Berlin');
    expect(resolveLocale({ locale: null, numberLocale: null, timezone: null }, { defaultLocale: 'id', defaultNumberLocale: null, defaultTimezone: null }).timezone).toBe(FALLBACK_TIMEZONE);
  });
  it('fails closed when everything is absent (spec §7: nothing inherits the environment)', () => {
    const r = resolveLocale({}, {});
    expect(r).toEqual({ locale: FALLBACK_LOCALE, numberLocale: FALLBACK_LOCALE, timezone: FALLBACK_TIMEZONE });
  });
});
```

**Verify (RED):** `cd pmo-portal && npx vitest run src/lib/locale` — module missing.

### Task 9 — implement `resolveLocale`

**Create** `pmo-portal/src/lib/locale/resolveLocale.ts`:

```ts
/**
 * resolveLocale — FR-L10N-003 (#468): the ONE locale-resolution seam. Never a scattered
 * `?? org.x` at call sites. Pure string selection — constructs NO `Intl` instance (the
 * format.ts ESLint fence stays intact); the formatting half consumes this, it never re-derives.
 *
 * Precedence per FR-L10N-002 (profile NULL = inherit org) and FR-L10N-001 (org number_locale
 * NULL = derive from the locale). Bare language tags are valid Intl number locales, so the
 * derive step is a pass-through of the RESOLVED locale.
 * ⚑ Q1 (flagged to Director): when a user overrides their locale and BOTH number_locales are
 * unset, this follows the user's locale (their separators should match the language they read).
 * The literal reading of FR-L10N-001 ("derive from default_locale") would follow the org's; the
 * change is one token (`locale` → `org.defaultLocale`) plus one test line if ruled that way.
 */
export interface LocalePreferencesInput {
  locale?: string | null;
  numberLocale?: string | null;
  timezone?: string | null;
}
export interface OrgLocaleDefaults {
  defaultLocale?: string | null;
  defaultNumberLocale?: string | null;
  defaultTimezone?: string | null;
}
export interface ResolvedLocale {
  locale: string;
  numberLocale: string;
  timezone: string;
}

export const FALLBACK_LOCALE = 'en';
export const FALLBACK_TIMEZONE = 'Asia/Jakarta';

export function resolveLocale(profile: LocalePreferencesInput, org: OrgLocaleDefaults): ResolvedLocale {
  const locale = profile.locale ?? org.defaultLocale ?? FALLBACK_LOCALE;
  return {
    locale,
    numberLocale: profile.numberLocale ?? org.defaultNumberLocale ?? locale,
    timezone: profile.timezone ?? org.defaultTimezone ?? FALLBACK_TIMEZONE,
  };
}
```

**Verify (GREEN):** `npx vitest run src/lib/locale`

---

### Task 10 — DAL for own preferences (FR-L10N-006/004) — test first

**Create** `pmo-portal/src/lib/db/preferences.test.ts` (chainable-mock idiom from `adminUsers.test.ts`):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown } };
  const calls = { from: [] as unknown[], select: [] as unknown[], eq: [] as unknown[], update: [] as unknown[] };
  const builder: Record<string, unknown> = {};
  const chain = (name: keyof typeof calls) => (...args: unknown[]) => {
    (calls[name] as unknown[]).push(args.length === 1 ? args[0] : args);
    return builder;
  };
  builder.select = chain('select'); builder.eq = chain('eq'); builder.update = chain('update');
  builder.maybeSingle = () => Promise.resolve(result.value);
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  const from = vi.fn((table: string) => { calls.from.push(table); return builder; });
  return { from, calls, result };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import { getMyLocalePreferences, setMyLocalePreferences } from './preferences';

beforeEach(() => {
  h.from.mockClear();
  for (const k of Object.keys(h.calls) as (keyof typeof h.calls)[]) (h.calls[k] as unknown[]).length = 0;
  h.result.value = { data: null, error: null };
});

describe('FR-L10N-006 own-preference DAL', () => {
  it('reads only the three preference columns, pinned to the caller id', async () => {
    h.result.value = { data: { locale: 'id', number_locale: null, timezone: 'Asia/Jakarta' }, error: null };
    const prefs = await getMyLocalePreferences('u1');
    expect(h.calls.from).toEqual(['profiles']);
    expect(h.calls.select).toEqual(['locale,number_locale,timezone']);
    expect(h.calls.eq).toEqual(['id']);
    expect(prefs).toEqual({ locale: 'id', numberLocale: null, timezone: 'Asia/Jakarta' });
  });
  it('AC-L10N-003 reset sends NULL — never the org value (copying freezes it)', async () => {
    await setMyLocalePreferences('u1', { locale: null, numberLocale: null, timezone: null });
    expect(h.calls.update).toEqual([{ locale: null, number_locale: null, timezone: null }]);
  });
  it('sets an explicit override payload, snake_cased', async () => {
    await setMyLocalePreferences('u1', { locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
    expect(h.calls.update).toEqual([{ locale: 'en', number_locale: 'en-US', timezone: 'UTC' }]);
  });
  it('throws on a PostgREST error', async () => {
    h.result.value = { data: null, error: { message: 'JWT', code: '42501' } };
    await expect(getMyLocalePreferences('u1')).rejects.toThrow('JWT');
    await expect(setMyLocalePreferences('u1', { locale: null, numberLocale: null, timezone: null })).rejects.toThrow('JWT');
  });
});
```

**Verify (RED):** `npx vitest run src/lib/db/preferences.test.ts`

### Task 11 — implement the DAL

**Create** `pmo-portal/src/lib/db/preferences.ts`:

```ts
import { supabase } from '@/src/lib/supabase/client';

/** The caller's three preference values. `null` = INHERIT the org default (FR-L10N-002). */
export interface MyLocalePreferences {
  locale: string | null;
  numberLocale: string | null;
  timezone: string | null;
}

/**
 * Read the caller's own preference columns (FR-L10N-006). RLS scopes rows to the caller's org
 * (profiles_select) and the eq(id) pins the read to self. Returns null when the profile row is
 * absent (the AuthProvider "no profile yet" state).
 */
export async function getMyLocalePreferences(userId: string): Promise<MyLocalePreferences | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('locale,number_locale,timezone')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { locale: data.locale, numberLocale: data.number_locale, timezone: data.timezone };
}

/**
 * Write the caller's own preference columns (FR-L10N-006). org_id is NEVER sent. Columns are
 * client-writable via 0198's allow-list; profiles_update_self pins the row to the caller; the
 * restrictive profiles_locale_self_only policy bars any other writer.
 *
 * ⚑ RESET IS NULL (FR-L10N-004): "reset to organization default" passes `null` for the column —
 * copying the org's current value would FREEZE it (AC-L10N-002 is the test that catches that
 * design). org_id/role/manager_id are untouched, so profiles_update_self's WITH CHECK holds.
 */
export async function setMyLocalePreferences(userId: string, prefs: MyLocalePreferences): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ locale: prefs.locale, number_locale: prefs.numberLocale, timezone: prefs.timezone })
    .eq('id', userId);
  if (error) throw new Error(error.message);
}
```

**Verify (GREEN):** `npx vitest run src/lib/db/preferences.test.ts`

---

### Task 12 — Repository seam (ADR-0017)

**Create** `pmo-portal/src/lib/repositories/preferences.ts` — standalone module (the `budgetProjection.ts` precedent; `index.ts` is shared across concurrent slices, do not edit it):

```ts
/**
 * repositories/preferences.ts — the API seam over the own-preference DAL (ADR-0017, FR-L10N-006).
 * Standalone by the budgetProjection/revenueDisplay precedent: imported directly by consumers;
 * `index.ts` stays untouched (it is shared across concurrent slices).
 * Thrown values normalize to AppError with the Postgres code preserved (RLS 42501 etc.).
 */
import { AppError, toAppError } from '@/src/lib/appError';
import {
  getMyLocalePreferences,
  setMyLocalePreferences,
  type MyLocalePreferences,
} from '@/src/lib/db/preferences';

export type { MyLocalePreferences };

export const preferencesRepository = {
  getMine: (userId: string): Promise<MyLocalePreferences | null> =>
    getMyLocalePreferences(userId).catch((e: unknown) => { throw toAppError(e); }),
  /** Reset = nulls, by construction of the DAL (FR-L10N-004). */
  setMine: (userId: string, prefs: MyLocalePreferences): Promise<void> =>
    setMyLocalePreferences(userId, prefs).catch((e: unknown) => { throw toAppError(e); }),
};
```

**Create** `pmo-portal/src/lib/repositories/preferences.test.ts` — same chainable mock, two cases: (a) delegates and maps `{locale:'id',…}` payload through; (b) a thrown `{message:'x',code:'42501'}` surfaces as an `AppError` with code preserved (`expect(err instanceof AppError).toBe(true)` — mirror `toAppError` usage in an existing repository test if the exact shape differs; do not weaken to `toThrow()` alone).

**Verify:** `npx vitest run src/lib/repositories/preferences` then `npm run typecheck`

---

### Task 13 — Docs: the operator surface changed

1. `docs/environments.md` § "Creating an org (Operator)" (~:614-660): update the signature line to the 7-param form, add the three fields to the curl example JSON (`"p_default_locale": "id", "p_default_number_locale": null, "p_default_timezone": "Asia/Jakarta"`), note number_locale's explicit-NULL-is-legal, and update the "current list" pointer (0192 header → 0198 §5 for the locale half).
2. `docs/operator-runbook.md` (~:61): update the invoke signature to 7 params.

**Verify:** `grep -n "operator_create_org" docs/environments.md docs/operator-runbook.md` — no 4-arg invocation remains.

---

### Task 14 — Full gates (binding, in this order)

```
cd <repo-root>
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'
cd pmo-portal
npm run verify:locked        # the shared-machine form of `npm run verify` (with-test-lock)
```
Both must be fully green — the WHOLE suites, never just touched files. If any test is red: fix the code, never weaken/skip/delete a test. `npm run verify` gates: migrations check, ADRs, e2e-isolation, nul-bytes, edge-test-binding, redirect-targets, edge-error-reporting, dashboard-tiles, typecheck, edge typecheck, lint, unit, build.

**No new e2e spec** — nothing here is cross-stack (no UI); spec §6 traceability assigns AC-L10N-060's journey to the formatting half.

---

## 3. Traceability (ADR-0010 — one owning layer per AC)

| AC | Owning layer | Owning test (this plan) |
|---|---|---|
| AC-L10N-001 | Unit (Vitest) | `src/lib/locale/resolveLocale.test.ts` |
| AC-L10N-002 | Unit (Vitest) | `src/lib/locale/resolveLocale.test.ts` |
| AC-L10N-003 | Unit (Vitest) | `src/lib/db/preferences.test.ts` (payload-null) + pgTAP companion in `locale_preferences.test.sql` |
| AC-L10N-004 | Integration (pgTAP) | `supabase/tests/operator_create_org.test.sql` |
| AC-L10N-005 | Integration (pgTAP) | `supabase/tests/locale_preferences.test.sql` |

FR coverage: 001→T3§1 · 002→T3§2 · 003→T8/9 · 004→T10/11 (+pgTAP companion) · 005→T4 · 006→T3§3/§4 + T7/T11.

## 4. Open questions for the Director

- **Q1 (implemented, flagged):** when a user overrides `locale` and BOTH number_locales are unset, `resolveLocale` derives the number locale from the **resolved** locale (user's), not the org's `default_locale` (the literal FR-L10N-001 wording). One-token change + one test line if the literal reading is ruled. Recorded in the helper's docstring and its test.
- **Q2 (deliberate non-addition):** no post-creation `operator_set_org_locale_defaults` RPC — matches `default_currency`'s posture exactly (creation-time only, no client path). If operators need an in-band fix path, that is a separate small ticket (mirror `operator_set_org_lifecycle_state`).
- **Q3 (stale TODO noted, not fixed):** 0192's TODO block still lists `lifecycle_state` as unbuilt, but 0191 added the column. Left for #489's slice.
