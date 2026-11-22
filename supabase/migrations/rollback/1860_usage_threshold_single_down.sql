-- Reverses 1860_usage_threshold_single.sql (run 1861's and 1862's rollbacks first). The second threshold comes back empty.
drop function if exists public.set_material_usage_threshold(numeric);
alter table public.material_request_settings rename constraint material_request_settings_usage_pct_range to material_request_settings_usage_pct_1_range;
alter table public.material_request_settings rename column usage_warn_pct to usage_warn_pct_1;
alter table public.material_request_settings
  add column usage_warn_pct_2 numeric(6,2),
  add constraint material_request_settings_usage_pct_2_range check (usage_warn_pct_2 is null or (usage_warn_pct_2 >= 1 and usage_warn_pct_2 <= 1000)),
  add constraint material_request_settings_usage_pct_order check (usage_warn_pct_1 is null or usage_warn_pct_2 is null or usage_warn_pct_2 > usage_warn_pct_1);

-- The 1330 body with the 1480 light-account guard (the state before 1860).
create or replace function public.mrq_set_usage_thresholds(p_pct_1 numeric, p_pct_2 numeric) returns void
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_uid uuid := auth.uid();
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  if public.auth_role() is distinct from 'Admin' then
    raise exception 'MRQ_ADMIN_ONLY: only an Admin can change the usage thresholds' using errcode = '42501'; end if;
  if (p_pct_1 is not null and (p_pct_1 < 1 or p_pct_1 > 1000)) or (p_pct_2 is not null and (p_pct_2 < 1 or p_pct_2 > 1000)) then
    raise exception 'MRQ_INVALID: a threshold is a percent of plan from 1 to 1000' using errcode = 'P0001'; end if;
  if p_pct_1 is not null and p_pct_2 is not null and p_pct_2 <= p_pct_1 then
    raise exception 'MRQ_INVALID: the second threshold must be greater than the first' using errcode = 'P0001'; end if;
  insert into public.material_request_settings (org_id, usage_warn_pct_1, usage_warn_pct_2, updated_by, updated_at)
  values (v_org, round(p_pct_1, 2), round(p_pct_2, 2), v_uid, now())
  on conflict (org_id) do update set usage_warn_pct_1 = excluded.usage_warn_pct_1, usage_warn_pct_2 = excluded.usage_warn_pct_2,
                                     updated_by = excluded.updated_by, updated_at = now();
  perform public.log_audit('material_request.usage_thresholds_set', v_org, v_uid, null,
                           jsonb_build_object('pct_1', p_pct_1, 'pct_2', p_pct_2));
end $$;
revoke all on function public.mrq_set_usage_thresholds(numeric, numeric) from public, anon;
grant execute on function public.mrq_set_usage_thresholds(numeric, numeric) to authenticated;
