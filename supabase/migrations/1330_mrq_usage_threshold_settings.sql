-- 1330_mrq_usage_threshold_settings.sql — #2686 two usage thresholds (percent of plan) per organisation.
-- Spec docs/specs/material-request-usage-thresholds.spec.md (FR-MUT-001, FR-MUT-007). Proven by
-- supabase/tests/mrq_usage_thresholds.test.sql. REVERSE: supabase/migrations/rollback/1330_mrq_usage_threshold_settings_down.sql
--
-- Both columns are NULL (off) for every organisation until an Admin sets them, so nothing changes for an existing organisation.

alter table public.material_request_settings
  add column usage_warn_pct_1 numeric(6,2),
  add column usage_warn_pct_2 numeric(6,2),
  add constraint material_request_settings_usage_pct_1_range check (usage_warn_pct_1 is null or (usage_warn_pct_1 >= 1 and usage_warn_pct_1 <= 1000)),
  add constraint material_request_settings_usage_pct_2_range check (usage_warn_pct_2 is null or (usage_warn_pct_2 >= 1 and usage_warn_pct_2 <= 1000)),
  add constraint material_request_settings_usage_pct_order check (usage_warn_pct_1 is null or usage_warn_pct_2 is null or usage_warn_pct_2 > usage_warn_pct_1);

-- Admin only. NULL clears a threshold. Mirrors mrq_set_cutoff (1001).
create or replace function public.mrq_set_usage_thresholds(p_pct_1 numeric, p_pct_2 numeric) returns void
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_uid uuid := auth.uid();
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  if public.auth_role() is distinct from 'Admin' then                                                    -- mut:usage_admin
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
