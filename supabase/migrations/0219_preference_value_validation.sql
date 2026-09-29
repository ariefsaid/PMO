-- 0219_preference_value_validation.sql — #711 (follow-up to #684): validate the locale / number-format /
-- timezone preference columns (0198) in the database, on BOTH profiles and organizations.
--
-- The columns were free text. The app falls back safely from an unusable stored value, but any
-- server-side reader (SQL timezone conversion, an edge function, email rendering) would not, and an
-- unusable value could be re-saved unchanged. Any authenticated user writes their OWN profile row, so
-- this is validation at a trust boundary.
--
-- The accepted sets are exactly what the app offers (ProfileSettings / the catalogue):
--   locale                          en | id
--   number locale                   en-US | id-ID | en | id   (0198: "a bare language tag is a valid Intl
--                                   number locale", so an org may state the derive-from-language form)
--   timezone                        an exact pg_timezone_names name
-- NULL stays legal wherever the column allows it today (profiles: all three = inherit the org;
-- organizations.default_number_locale = derive). Set membership rules out surrounding whitespace, blank
-- strings and unbounded length in one stroke (every member is <= 5 characters).
--
-- Mechanism: locale + number locale are IMMUTABLE set-membership predicates → CHECK constraints (they
-- also bind writers that disable triggers via session_replication_role). A timezone must exist in the
-- zone catalogue, which a CHECK cannot query → a BEFORE INSERT/UPDATE OF trigger. The trigger raises a
-- fixed message with no value echoed (`invalid_timezone`, 23514): the FE never shows server text and
-- shows its existing "Could not save your preferences" copy for any failed write.
--
-- Existing rows that would violate the rule are NORMALISED first (not failed): a profile's bad value
-- becomes NULL (= inherit), an org's becomes the column's own default ('en' / NULL / 'Asia/Jakarta').
-- Each step reports its row count as a NOTICE. Local seed rows touched: 0 (verified by db reset).
--
-- ── REVERSIBILITY (ADR-0006) — manual reverse; the normalisation is not undone (the discarded values
--    were unusable by definition):
--      drop trigger if exists profiles_timezone_valid on public.profiles;
--      drop trigger if exists organizations_timezone_valid on public.organizations;
--      drop function if exists public.assert_valid_timezone_preference();
--      alter table public.profiles
--        drop constraint if exists profiles_locale_supported,
--        drop constraint if exists profiles_number_locale_supported;
--      alter table public.organizations
--        drop constraint if exists organizations_default_locale_supported,
--        drop constraint if exists organizations_default_number_locale_supported;

-- ═══ §1 — normalise existing violators (before the rules exist, so the migration cannot fail on them) ═══
do $$
declare v_n int;
begin
  update public.profiles set locale = null
   where locale is not null and locale not in ('en', 'id');
  get diagnostics v_n = row_count;
  raise notice '0219: profiles.locale normalised to NULL on % row(s)', v_n;

  update public.profiles set number_locale = null
   where number_locale is not null and number_locale not in ('en-US', 'id-ID');
  get diagnostics v_n = row_count;
  raise notice '0219: profiles.number_locale normalised to NULL on % row(s)', v_n;

  update public.profiles set timezone = null
   where timezone is not null
     and not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = profiles.timezone);
  get diagnostics v_n = row_count;
  raise notice '0219: profiles.timezone normalised to NULL on % row(s)', v_n;

  update public.organizations set default_locale = 'en'
   where default_locale not in ('en', 'id');
  get diagnostics v_n = row_count;
  raise notice '0219: organizations.default_locale normalised to en on % row(s)', v_n;

  update public.organizations set default_number_locale = null
   where default_number_locale is not null
     and default_number_locale not in ('en-US', 'id-ID', 'en', 'id');
  get diagnostics v_n = row_count;
  raise notice '0219: organizations.default_number_locale normalised to NULL on % row(s)', v_n;

  update public.organizations set default_timezone = 'Asia/Jakarta'
   where not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = organizations.default_timezone);
  get diagnostics v_n = row_count;
  raise notice '0219: organizations.default_timezone normalised to Asia/Jakarta on % row(s)', v_n;
end $$;

-- ═══ §2 — locale + number locale: CHECK constraints (NULL passes a CHECK, so NULL = inherit/derive) ═══
alter table public.profiles
  add constraint profiles_locale_supported
    check (locale in ('en', 'id')),
  add constraint profiles_number_locale_supported
    -- A person picks a concrete format or inherits (NULL); the bare-language "derive" form is an
    -- org-level default only (0198). A stored bare tag would show as "inherit" in ProfileSettings.
    check (number_locale in ('en-US', 'id-ID'));

alter table public.organizations
  add constraint organizations_default_locale_supported
    check (default_locale in ('en', 'id')),
  add constraint organizations_default_number_locale_supported
    check (default_number_locale in ('en-US', 'id-ID', 'en', 'id'));

-- ═══ §3 — timezone: trigger (a CHECK cannot query the zone catalogue) ═══
-- Exact, case-sensitive match on the catalogue name: 'asia/jakarta', ' UTC' and '' are all refused, and
-- POSIX-style strings Postgres would otherwise parse ('EST5EDT-x') are not catalogue names. Security
-- INVOKER: pg_timezone_names is world-readable, so the trigger needs no elevated rights and adds no
-- definer surface. Fires on every write that names the column, so re-saving an unusable value is refused.
create or replace function public.assert_valid_timezone_preference()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_zone text;
begin
  if tg_table_name = 'organizations' then
    v_zone := new.default_timezone;
  else
    v_zone := new.timezone;
  end if;

  if v_zone is null then
    return new;  -- profiles: NULL = inherit. organizations: the NOT NULL constraint owns the refusal.
  end if;

  -- An unchanged value was already valid (existing rows are normalised above), and the zone catalogue
  -- lookup is not free: skip it on the many saves that resend the timezone unchanged.
  if tg_op = 'UPDATE' then
    if tg_table_name = 'organizations' then
      if new.default_timezone is not distinct from old.default_timezone then return new; end if;
    elsif new.timezone is not distinct from old.timezone then
      return new;
    end if;
  end if;

  if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = v_zone) then
    -- Fixed message: never echo the submitted value or the row.
    raise exception 'invalid_timezone' using errcode = '23514';
  end if;
  return new;
end $$;

comment on function public.assert_valid_timezone_preference() is
  '#711 (0219): BEFORE INSERT/UPDATE OF trigger body for profiles.timezone and organizations.default_timezone — '
  'the value must be an exact pg_timezone_names name. Generic error, no value echoed. Security invoker.';

create trigger profiles_timezone_valid
  before insert or update of timezone on public.profiles
  for each row execute function public.assert_valid_timezone_preference();

create trigger organizations_timezone_valid
  before insert or update of default_timezone on public.organizations
  for each row execute function public.assert_valid_timezone_preference();

revoke all on function public.assert_valid_timezone_preference() from public;
