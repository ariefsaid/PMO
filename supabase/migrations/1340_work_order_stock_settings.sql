-- 1340_work_order_stock_settings.sql — #2674: the organisation's issued-versus-progress warning threshold.
-- Spec docs/specs/material-issued-vs-progress.spec.md (FR-MIP-001..003); proven by supabase/tests/1340_work_order_issue_threshold.test.sql.
-- One row per organisation; no row or a null figure means the feature is off. Written only by the Admin-only function below.
-- REVERSE: supabase/migrations/rollback/1340_work_order_stock_settings_down.sql.

create table public.work_order_stock_settings (
  org_id                     uuid primary key references public.organizations(id) on delete cascade
                               default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001'),
  issue_progress_threshold_pct numeric(5,2)
                               constraint work_order_stock_settings_threshold check (issue_progress_threshold_pct is null
                                 or (issue_progress_threshold_pct >= 0 and issue_progress_threshold_pct <= 100)),
  updated_by                 uuid references public.profiles(id),
  updated_at                 timestamptz not null default now()
);
comment on table public.work_order_stock_settings is
  '#2674: per-organisation stock settings read with a work order; issue_progress_threshold_pct (percentage points) null = no warning.';

alter table public.work_order_stock_settings enable row level security;
alter table public.work_order_stock_settings force row level security;
create policy work_order_stock_settings_select on public.work_order_stock_settings for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
revoke all on public.work_order_stock_settings from public, anon, authenticated;
grant select on public.work_order_stock_settings to authenticated;
grant all on public.work_order_stock_settings to service_role;

create or replace function public.set_work_order_issue_threshold(p_threshold_pct numeric) returns numeric
  language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid(); v_old numeric; v_new numeric;
begin
  perform public.assert_is_active_member();
  if public.auth_role() is distinct from 'Admin' then   -- mut:admin
    raise exception 'only an Admin sets the issued-versus-progress threshold' using errcode = '42501';
  end if;
  if p_threshold_pct is not null and not (p_threshold_pct >= 0 and p_threshold_pct <= 100) then
    raise exception 'the threshold is from 0 to 100 percentage points, or empty' using errcode = '22023';
  end if;
  v_new := round(p_threshold_pct, 2);
  select s.issue_progress_threshold_pct into v_old from public.work_order_stock_settings s where s.org_id = v_org for update;
  insert into public.work_order_stock_settings (org_id, issue_progress_threshold_pct, updated_by, updated_at)
    values (v_org, v_new, v_uid, now())
  on conflict (org_id) do update set issue_progress_threshold_pct = excluded.issue_progress_threshold_pct,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  perform public.log_audit('work_order_issue_threshold.set', v_org, v_uid, v_org,
    jsonb_build_object('from', v_old, 'to', v_new));
  return v_new;
end $$;
revoke all on function public.set_work_order_issue_threshold(numeric) from public, anon;
grant execute on function public.set_work_order_issue_threshold(numeric) to authenticated;
