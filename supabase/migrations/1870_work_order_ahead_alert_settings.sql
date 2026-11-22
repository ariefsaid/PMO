-- 1870_work_order_ahead_alert_settings.sql — material-vs-progress: who besides the project manager is told when material
-- issued to a work order runs ahead of its progress. Spec docs/specs/material-vs-progress.spec.md (FR-MVP-006, FR-MVP-010).
-- Proven by supabase/tests/1870_work_order_ahead_alert.test.sql (AC-MVP-009).
-- ahead_alert_roles holds built-in role KEYS (public.built_in_roles, 1200), never a role list in code; empty = project manager only.
-- No on/off switch: the alert follows the existing threshold (1340). REVERSE: rollback/1870_work_order_ahead_alert_settings_down.sql.

alter table public.work_order_stock_settings
  add column ahead_alert_roles text[] not null default '{}';

create or replace function public.set_work_order_ahead_alert_roles(p_roles text[]) returns text[]
  language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid(); v_old text[]; v_new text[];
begin
  perform public.assert_is_active_member();
  if public.auth_role() is distinct from 'Admin' then   -- mut:admin
    raise exception 'STK_ALERT_ROLES_ADMIN_ONLY: only an Admin sets who is told when material runs ahead of progress' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct k order by k), '{}') into v_new from unnest(coalesce(p_roles, '{}')) k;
  if exists (select 1 from unnest(v_new) k where not exists (select 1 from public.built_in_roles r where r.key = k)) then   -- mut:known_roles
    raise exception 'STK_ALERT_ROLE_UNKNOWN: one of the roles is not a built-in role' using errcode = '22023';
  end if;
  select s.ahead_alert_roles into v_old from public.work_order_stock_settings s where s.org_id = v_org for update;
  insert into public.work_order_stock_settings (org_id, ahead_alert_roles, updated_by, updated_at)
    values (v_org, v_new, v_uid, now())
  on conflict (org_id) do update set ahead_alert_roles = excluded.ahead_alert_roles,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  perform public.log_audit('work_order_ahead_alert_roles.set', v_org, v_uid, v_org,
    jsonb_build_object('from', coalesce(v_old, '{}'), 'to', v_new));
  return v_new;
end $$;
revoke all on function public.set_work_order_ahead_alert_roles(text[]) from public, anon;
grant execute on function public.set_work_order_ahead_alert_roles(text[]) to authenticated;
