-- 1872_my_open_ahead_alerts.sql — material-vs-progress: the needs-you pointer for open "issued ahead of progress" alerts.
-- Derived on read from open rows (kind 'issued_ahead', 1870), so it clears when the alert resolves. The caller sees the work orders whose
-- recipient (usage_warning_recipient, 1862) is the caller. A light account gets none. REVERSE: rollback/1872_my_open_ahead_alerts_down.sql.
create function public.my_open_ahead_alerts()
  returns table (work_order_id uuid, project_id uuid, wo_label text, item_count integer)
  language sql stable security definer set search_path = public, pg_temp as $$
  select a.work_order_id, w.project_id, coalesce(w.wo_number, w.title), count(*)::integer
    from public.material_installed_usage_alerts a
    join public.work_orders w on w.id = a.work_order_id and w.org_id = a.org_id
   where a.org_id = public.auth_org_id() and a.kind = 'issued_ahead' and a.resolved_at is null
     and public.is_active_member() and not public.actor_is_light()
     and public.usage_warning_recipient(a.work_order_id) = auth.uid()
   group by a.work_order_id, w.project_id, w.wo_number, w.title
   order by a.work_order_id
$$;
revoke all on function public.my_open_ahead_alerts() from public, anon;
grant execute on function public.my_open_ahead_alerts() to authenticated;
