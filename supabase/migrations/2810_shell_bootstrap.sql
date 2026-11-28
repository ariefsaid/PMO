-- 2810: shell_bootstrap(), the shell's sign-in reads in one round trip.
--
-- The signed-in shell used to make about nine separate requests before first paint, most of them only after the
-- profile had landed (a second round trip). This returns the same answers in one call: the caller's profile row,
-- the organisation's locale defaults, term, role and stage names, the resolved features and plan, the Operator
-- membership and the price-visibility answers.
--
-- SECURITY INVOKER: every read below runs as the caller, so row-level security and each called function's own
-- checks stay the authority. It returns nothing a caller could not already read through the separate requests.
-- Sections a caller cannot read (no profile; an inactive member's features and plan) are left out, and the
-- client then makes that one request on its own, exactly as before.

create or replace function public.shell_bootstrap()
returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp
as $$
declare
  v_profile jsonb;
  v_out jsonb;
  v_hide boolean;
begin
  select to_jsonb(p) into v_profile from public.profiles p where p.id = auth.uid();
  if v_profile is null then
    return jsonb_build_object('profile', null);
  end if;

  v_hide := public.get_hide_prices_enabled();
  v_out := jsonb_build_object(
    'profile', v_profile,
    'org', (select to_jsonb(o) from (
        select default_locale, default_number_locale, default_timezone from public.organizations limit 1) o),
    'terminology', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select term_key, locale, singular, plural from public.org_terminology limit 200) t),
    'role_names', (select coalesce(jsonb_agg(r), '[]'::jsonb) from (
        select role_key, locale, name from public.org_role_names limit 100) r),
    'stage_names', (select coalesce(jsonb_agg(s order by s.status), '[]'::jsonb) from (
        select status, label_en, label_id from public.pipeline_stage_config order by status limit 12) s),
    'is_operator', public.is_operator(),
    'hide_prices_enabled', v_hide
  );
  if v_hide then
    v_out := v_out || jsonb_build_object('may_see_prices', public.get_may_see_prices());
  end if;
  if public.is_active_member() then
    v_out := v_out || jsonb_build_object(
      'features', (select coalesce(jsonb_agg(f), '[]'::jsonb) from public.resolved_org_features() f),
      'plan', (select to_jsonb(pl) from public.resolved_org_plan() pl limit 1)
    );
  end if;
  return v_out;
end $$;

revoke all on function public.shell_bootstrap() from public, anon;
grant execute on function public.shell_bootstrap() to authenticated, service_role;

comment on function public.shell_bootstrap() is
  'The signed-in shell''s start-up reads in one call. Security invoker: RLS and each called function decide what is returned.';
