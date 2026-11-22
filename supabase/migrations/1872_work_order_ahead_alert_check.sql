-- 1872_work_order_ahead_alert_check.sql — material-vs-progress: raise, refresh and resolve the alert when issue or progress changes.
-- Spec docs/specs/material-vs-progress.spec.md (FR-MVP-001..007, FR-MVP-011). Proven by supabase/tests/1870_work_order_ahead_alert.test.sql.
-- It re-uses get_work_order_material_vs_progress (1341, via 1451's light guard) unchanged: no second formula. It writes only the
-- alert record (1871) and notifications (notify_workflow_user, 1224); it never raises on a missing context and never blocks a posting.
-- Evaluation is SKIPPED (explicitly, AC-MVP-007) when the actor has no organisation context (a system actor), is not an active member,
-- is a light account (the guarded read would refuse them), or belongs to another organisation than the work order.
-- Notification text is a literal English body, as the shipped usage alerts (1331); the screens are translated.
-- REVERSE: rollback/1872_work_order_ahead_alert_check_down.sql.

-- Who controls a work order: the project's manager, plus active holders of the organisation's listed built-in roles, else active Admins.
-- Light accounts are never recipients. The actor is NOT removed here (the needs-you read uses the same set).
create or replace function public.wo_material_alert_recipients(p_work_order_id uuid) returns uuid[]
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_pm uuid; v_roles text[]; v_out uuid[];
begin
  select w.org_id, p.project_manager_id into v_org, v_pm
    from public.work_orders w join public.projects p on p.id = w.project_id and p.org_id = w.org_id where w.id = p_work_order_id;
  if v_org is null then return '{}'; end if;
  select coalesce(s.ahead_alert_roles, '{}') into v_roles from public.work_order_stock_settings s where s.org_id = v_org;
  select coalesce(array_agg(distinct pr.id), '{}') into v_out
    from public.profiles pr
   where pr.org_id = v_org and pr.status = 'active' and not public.is_light_role_key(pr.built_in_role)
     and (pr.id = v_pm or pr.built_in_role = any(coalesce(v_roles, '{}')));
  if cardinality(v_out) = 0 then
    select coalesce(array_agg(pr.id), '{}') into v_out
      from public.profiles pr
     where pr.org_id = v_org and pr.status = 'active' and pr.role = 'Admin' and not public.is_light_role_key(pr.built_in_role);
  end if;
  return v_out;
end $$;
revoke all on function public.wo_material_alert_recipients(uuid) from public, anon, authenticated, service_role;

create or replace function public.wo_material_alert_check(p_work_order_id uuid, p_quiet boolean default false) returns void
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := auth.uid(); v_org uuid; v_label text; v_project uuid; v_cmp jsonb; v_thr numeric; v_progress numeric;
  e jsonb; v_item uuid; v_warned uuid[] := '{}'; v_rows integer; v_who uuid[]; v_u uuid; v_told uuid[];
begin
  select w.org_id, coalesce(w.wo_number, w.title), w.project_id into v_org, v_label, v_project from public.work_orders w where w.id = p_work_order_id;
  if not found then return; end if;
  -- The explicit skip: no context, another organisation, not active, or a light account. The posting itself is never affected.
  if v_actor is null or public.auth_org_id() is distinct from v_org then return; end if;   -- mut:system_actor
  if not public.is_active_member(v_actor) or public.actor_is_light() then return; end if;

  v_cmp := public.get_work_order_material_vs_progress(p_work_order_id);
  v_thr := (v_cmp->>'threshold_pct')::numeric;
  if v_thr is null then   -- mut:unset  (feature off: nothing is raised and every open alert closes)
    update public.work_order_material_alerts a set resolved_at = now() where a.work_order_id = p_work_order_id and a.resolved_at is null;
    return;
  end if;
  v_progress := (v_cmp->>'progress_pct')::numeric;
  v_who := array_remove(public.wo_material_alert_recipients(p_work_order_id), v_actor);

  for e in select x from jsonb_array_elements(v_cmp->'items') x where (x->>'warn')::boolean loop
    v_item := (e->>'item_id')::uuid;
    v_warned := v_warned || v_item;
    update public.work_order_material_alerts a
       set issued_pct = (e->>'issued_pct')::numeric, progress_pct = v_progress, gap_pp = (e->>'gap_pp')::numeric,
           threshold_pct = v_thr, last_seen_at = now()
     where a.work_order_id = p_work_order_id and a.item_id = v_item and a.resolved_at is null;   -- mut:once  (an open alert never raises again)
    if found then continue; end if;
    v_told := case when p_quiet then '{}' else v_who end;
    insert into public.work_order_material_alerts (org_id, work_order_id, item_id, issued_pct, progress_pct, gap_pp, threshold_pct, notified_user_ids)
    values (v_org, p_work_order_id, v_item, (e->>'issued_pct')::numeric, v_progress, (e->>'gap_pp')::numeric, v_thr, v_told)
    on conflict (work_order_id, item_id) where resolved_at is null do nothing;
    get diagnostics v_rows = row_count;
    if v_rows = 1 then
      foreach v_u in array v_told loop
        perform public.notify_workflow_user(v_org, v_u, 'Material issued ahead of progress',
          format('%s on work order %s: issued %s%% of planned, progress %s%%, %s points ahead. Review before more is issued.',
                 e->>'item_name', v_label, e->>'issued_pct', trim_scale(v_progress)::text, e->>'gap_pp'),
          'warning', 'work_order_alert', v_project, v_label);
      end loop;
    end if;
  end loop;

  update public.work_order_material_alerts a set resolved_at = now()
   where a.work_order_id = p_work_order_id and a.resolved_at is null and not (a.item_id = any(v_warned));   -- mut:resolve
end $$;
revoke all on function public.wo_material_alert_check(uuid, boolean) from public, anon, authenticated, service_role;

-- The events that move the comparison. Additive AFTER triggers; each exits through the check's skips.
create or replace function public.wo_material_alert_trg() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_table_name = 'stock_documents' then
    if tg_op = 'UPDATE' and old.work_order_id is not null and old.work_order_id is distinct from new.work_order_id then
      perform public.wo_material_alert_check(old.work_order_id);
    end if;
    if new.work_order_id is not null then perform public.wo_material_alert_check(new.work_order_id); end if;
  else
    if new.work_order_id is not null then perform public.wo_material_alert_check(new.work_order_id); end if;
  end if;
  return null;
end $$;
revoke all on function public.wo_material_alert_trg() from public, anon, authenticated, service_role;

create trigger stock_documents_ahead_alert after insert or update of status, work_order_id on public.stock_documents
  for each row when (new.status = 'Posted' and new.kind in ('issue', 'return')) execute function public.wo_material_alert_trg();
create trigger daily_site_reports_ahead_alert after update of status, superseded_at, archived_at on public.daily_site_reports
  for each row when (old.status = 'validated' or new.status = 'validated') execute function public.wo_material_alert_trg();
create trigger work_order_acceptances_ahead_alert after update of status on public.work_order_acceptances
  for each row when (new.status = 'Confirmed' and old.status is distinct from new.status) execute function public.wo_material_alert_trg();

-- A changed threshold re-evaluates the work orders that have an open alert (a cleared threshold closes them all; a lowered one opens
-- new alerts at the next event, not here).
create or replace function public.wo_material_alert_threshold_trg() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_wo uuid;
begin
  if new.issue_progress_threshold_pct is null then
    update public.work_order_material_alerts a set resolved_at = now() where a.org_id = new.org_id and a.resolved_at is null;
  else
    for v_wo in select distinct a.work_order_id from public.work_order_material_alerts a where a.org_id = new.org_id and a.resolved_at is null loop
      perform public.wo_material_alert_check(v_wo);
    end loop;
  end if;
  return null;
end $$;
revoke all on function public.wo_material_alert_threshold_trg() from public, anon, authenticated, service_role;
create trigger work_order_stock_settings_ahead_alert_ins after insert on public.work_order_stock_settings
  for each row when (new.issue_progress_threshold_pct is not null) execute function public.wo_material_alert_threshold_trg();
create trigger work_order_stock_settings_ahead_alert_upd after update of issue_progress_threshold_pct on public.work_order_stock_settings
  for each row when (new.issue_progress_threshold_pct is distinct from old.issue_progress_threshold_pct) execute function public.wo_material_alert_threshold_trg();

-- First evaluation after release (AC-MVP-010): open alerts for items already warning, tell nobody. Runs once below and is callable
-- by the test as a superuser. Acts as an active, non-light Admin of each organisation that has a threshold; an organisation with
-- none, or with no such Admin, is left alone.
create or replace function public.wo_material_alerts_backfill() returns integer
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare o record; v_admin uuid; v_wo uuid; v_n integer := 0; v_prior text := current_setting('request.jwt.claims', true);
begin
  for o in select s.org_id from public.work_order_stock_settings s where s.issue_progress_threshold_pct is not null loop
    select pr.id into v_admin from public.profiles pr
     where pr.org_id = o.org_id and pr.status = 'active' and pr.role = 'Admin' and not public.is_light_role_key(pr.built_in_role) order by pr.id limit 1;
    continue when v_admin is null;
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    for v_wo in select distinct d.work_order_id from public.stock_documents d
                 where d.org_id = o.org_id and d.status = 'Posted' and d.kind in ('issue', 'return') and d.work_order_id is not null loop
      perform public.wo_material_alert_check(v_wo, true);
      v_n := v_n + 1;
    end loop;
  end loop;
  perform set_config('request.jwt.claims', coalesce(nullif(v_prior, ''), '{}'), true);
  return v_n;
end $$;
revoke all on function public.wo_material_alerts_backfill() from public, anon, authenticated, service_role;
select public.wo_material_alerts_backfill();
