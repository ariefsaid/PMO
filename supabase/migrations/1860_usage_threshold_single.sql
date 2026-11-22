-- 1860_usage_threshold_single.sql — usage warning on installed material: ONE threshold instead of two (spec docs/specs/usage-warning.spec.md FR-UW-001, FR-UW-008).
-- Proven by supabase/tests/usage_warning.test.sql (AC-UW-008). REVERSE: rollback/1860_usage_threshold_single_down.sql.
-- usage_warn_pct_1 becomes usage_warn_pct (value kept); usage_warn_pct_2 is discarded. Unset (null) = off, as before; no organisation depends on #2686 yet.
-- mrq_set_usage_thresholds(p1, p2) is replaced by set_material_usage_threshold(p_pct): same Admin-only rule, one value, the light-account refusal (1480 convention).

alter table public.material_request_settings
  drop constraint material_request_settings_usage_pct_order,
  drop constraint material_request_settings_usage_pct_2_range,
  drop column usage_warn_pct_2;
alter table public.material_request_settings rename column usage_warn_pct_1 to usage_warn_pct;
alter table public.material_request_settings rename constraint material_request_settings_usage_pct_1_range to material_request_settings_usage_pct_range;

drop function public.mrq_set_usage_thresholds(numeric, numeric);

create function public.set_material_usage_threshold(p_pct numeric) returns void
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_uid uuid := auth.uid(); v_old numeric;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  if public.auth_role() is distinct from 'Admin' then                                                    -- mut:usage_admin
    raise exception 'MRQ_USAGE_ADMIN_ONLY: only an Admin can change the usage warning' using errcode = '42501'; end if;
  if p_pct is not null and (p_pct < 1 or p_pct > 1000) then                                              -- mut:usage_range
    raise exception 'MRQ_USAGE_INVALID: the usage warning is a percent of plan from 1 to 1000' using errcode = 'P0001'; end if;
  select s.usage_warn_pct into v_old from public.material_request_settings s where s.org_id = v_org;
  insert into public.material_request_settings (org_id, usage_warn_pct, updated_by, updated_at)
  values (v_org, round(p_pct, 2), v_uid, now())
  on conflict (org_id) do update set usage_warn_pct = excluded.usage_warn_pct, updated_by = excluded.updated_by, updated_at = now();
  perform public.log_audit('material_request.usage_threshold_set', v_org, v_uid, null,
                           jsonb_build_object('from', v_old, 'to', round(p_pct, 2)));
end $$;
revoke all on function public.set_material_usage_threshold(numeric) from public, anon;
grant execute on function public.set_material_usage_threshold(numeric) to authenticated;
