-- 1861_usage_installed_source_setting.sql — what "installed" means for the usage warning: one organisation setting (spec docs/specs/usage-warning.spec.md FR-UW-020).
-- Proven by supabase/tests/usage_warning.test.sql (AC-UW-008, AC-UW-009). REVERSE: rollback/1861_usage_installed_source_setting_down.sql.
-- 'site_reports' (default): quantity on validated site reports. 'stock_issues': net storekeeper issues to the work order (issues less returns).
-- Admin only. Nothing changes for an organisation until it sets it; the warning itself stays off until the first usage threshold is set.

alter table public.material_request_settings
  add column usage_installed_source text not null default 'site_reports'
    constraint material_request_settings_usage_installed_source_check check (usage_installed_source in ('site_reports', 'stock_issues'));

create function public.set_usage_installed_source(p_source text) returns void
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_uid uuid := auth.uid(); v_old text;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  if public.auth_role() is distinct from 'Admin' then                                                    -- mut:usage_source_admin
    raise exception 'MRQ_USAGE_ADMIN_ONLY: only an Admin can change what counts as installed' using errcode = '42501'; end if;
  if p_source is null or p_source not in ('site_reports', 'stock_issues') then
    raise exception 'MRQ_USAGE_INVALID: choose site reports or stock issues' using errcode = 'P0001'; end if;
  select s.usage_installed_source into v_old from public.material_request_settings s where s.org_id = v_org;
  insert into public.material_request_settings (org_id, usage_installed_source, updated_by, updated_at)
  values (v_org, p_source, v_uid, now())
  on conflict (org_id) do update set usage_installed_source = excluded.usage_installed_source, updated_by = excluded.updated_by, updated_at = now();
  perform public.log_audit('material_request.usage_installed_source_set', v_org, v_uid, null,
                           jsonb_build_object('from', coalesce(v_old, 'site_reports'), 'to', p_source));
end $$;
revoke all on function public.set_usage_installed_source(text) from public, anon;
grant execute on function public.set_usage_installed_source(text) to authenticated;
