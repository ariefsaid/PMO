-- 1904_org_naming_lookup.sql — one database lookup of an organisation's own words (terminology reach, #2799).
-- org_naming(org) returns the organisation's term overrides and role names, both languages, in one jsonb document:
--   { terms: { en: { <key>: { singular, plural } }, id: {...} }, roles: { en: { <roleKey>: name }, id: {...} } }
-- Role names fall back to the catalogue default (built_in_roles.name_en / name_id). org_term(org, key, locale, plural)
-- is the single-word form for SQL producers; it returns null when the org has no override (the caller keeps its word).
-- Server-side text producers (email function, other functions, SQL) use these and keep no copy of the term list.
-- Service role only: clients already read the two tables under RLS.
-- Reversal: supabase/migrations/rollback/1904_org_naming_lookup_down.sql

create function public.org_naming(p_org uuid)
returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'terms', jsonb_build_object(
      'en', coalesce((select jsonb_object_agg(t.term_key, jsonb_build_object('singular', t.singular, 'plural', t.plural))
                        from public.org_terminology t where t.org_id = p_org and t.locale = 'en'), '{}'::jsonb),
      'id', coalesce((select jsonb_object_agg(t.term_key, jsonb_build_object('singular', t.singular, 'plural', t.plural))
                        from public.org_terminology t where t.org_id = p_org and t.locale = 'id'), '{}'::jsonb)),
    'roles', jsonb_build_object(
      'en', coalesce((select jsonb_object_agg(r.key, coalesce(n.name, r.name_en))
                        from public.built_in_roles r
                        left join public.org_role_names n on n.org_id = p_org and n.role_key = r.key and n.locale = 'en'), '{}'::jsonb),
      'id', coalesce((select jsonb_object_agg(r.key, coalesce(n.name, r.name_id))
                        from public.built_in_roles r
                        left join public.org_role_names n on n.org_id = p_org and n.role_key = r.key and n.locale = 'id'), '{}'::jsonb)));
$$;
revoke all on function public.org_naming(uuid) from public, anon, authenticated;
grant execute on function public.org_naming(uuid) to service_role;

create function public.org_term(p_org uuid, p_key text, p_locale text, p_plural boolean default false)
returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case when p_plural then t.plural else t.singular end
    from public.org_terminology t
   where t.org_id = p_org and t.term_key = p_key and t.locale = p_locale;
$$;
revoke all on function public.org_term(uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.org_term(uuid, text, text, boolean) to service_role;

comment on function public.org_naming(uuid) is
  'Terminology reach (#2799): one org''s term overrides and role names, both languages. Service role only.';
comment on function public.org_term(uuid, text, text, boolean) is
  'Terminology reach (#2799): one override word, or null when the org has none. Service role only.';
