-- 1873_my_open_material_alerts.sql — material-vs-progress: the needs-you pointer for open alerts (FR-MVP-009).
-- Derived on read from open alert rows, so it clears when the alert resolves; nothing is stored or cleared by the reader.
-- Rows are the work orders whose controllers (wo_material_alert_recipients, 1872) include the caller. A light account gets none.
-- Proven by supabase/tests/1870_work_order_ahead_alert.test.sql. REVERSE: rollback/1873_my_open_material_alerts_down.sql.
create or replace function public.my_open_material_alerts()
  returns table (work_order_id uuid, project_id uuid, wo_label text, item_count integer)
  language sql stable security definer set search_path = public, pg_temp as $$
  select a.work_order_id, w.project_id, coalesce(w.wo_number, w.title), count(*)::integer
    from public.work_order_material_alerts a
    join public.work_orders w on w.id = a.work_order_id and w.org_id = a.org_id
   where a.org_id = public.auth_org_id() and a.resolved_at is null
     and public.is_active_member() and not public.actor_is_light()
     and auth.uid() = any(public.wo_material_alert_recipients(a.work_order_id))
   group by a.work_order_id, w.project_id, w.wo_number, w.title
   order by max(a.gap_pp) desc, a.work_order_id
$$;
revoke all on function public.my_open_material_alerts() from public, anon;
grant execute on function public.my_open_material_alerts() to authenticated;
