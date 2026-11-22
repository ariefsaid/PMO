-- 1871_usage_ahead_check.sql — material-vs-progress: raise, refresh and resolve the "issued ahead of progress" alert when issue or progress moves.
-- Spec docs/specs/material-vs-progress.spec.md (REVISION: FR-MVP-001..005, 007, 011). Proven by supabase/tests/1870_ahead_of_progress_alert.test.sql.
-- The MEASURE is get_work_order_material_vs_progress (1341, with 1451's light guard) unchanged: no second formula. The ROW is 1862's
-- material_installed_usage_alerts (kind 'issued_ahead', 1870); the RECIPIENT is usage_warning_recipient (1862): the work order's responsible
-- person, else the project's manager, else nobody (the alert is still recorded). The same failure-swallowing wrapper as 1862: a failure is
-- logged as a warning, never raised, so posting a stock document, validating a report or confirming an acceptance can never fail on it.
-- Evaluation is skipped (not an error) when the actor has no organisation context (a system actor), is not an active member, belongs to
-- another organisation or is a light account (the guarded read would refuse them). Notification text is a literal English body like 1862's.
-- REVERSE: rollback/1871_usage_ahead_check_down.sql.

create function public.usage_ahead_check_work_order(p_work_order_id uuid, p_quiet boolean default false) returns void
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := auth.uid(); v_org uuid; v_label text; v_cmp jsonb; v_thr numeric; v_progress numeric;
  e jsonb; v_item uuid; v_warned uuid[] := '{}'; v_rows integer; v_to uuid;
begin
  select w.org_id, coalesce(w.wo_number, w.title) into v_org, v_label from public.work_orders w where w.id = p_work_order_id;
  if v_org is null then return; end if;
  if v_actor is null or public.auth_org_id() is distinct from v_org then return; end if;                -- mut:system_actor
  if not public.is_active_member(v_actor) or public.actor_is_light() then return; end if;

  v_cmp := public.get_work_order_material_vs_progress(p_work_order_id);
  v_thr := (v_cmp->>'threshold_pct')::numeric;
  if v_thr is null then                                                                                 -- mut:unset  (feature off: close everything)
    update public.material_installed_usage_alerts a set resolved_at = now()
     where a.work_order_id = p_work_order_id and a.kind = 'issued_ahead' and a.resolved_at is null;
    return;
  end if;
  v_progress := (v_cmp->>'progress_pct')::numeric;
  v_to := public.usage_warning_recipient(p_work_order_id);

  for e in select x from jsonb_array_elements(v_cmp->'items') x where (x->>'warn')::boolean loop
    begin   -- one item's failure does not stop the others
      v_item := (e->>'item_id')::uuid;
      v_warned := v_warned || v_item;
      continue when exists (select 1 from public.material_installed_usage_alerts a                      -- mut:once  (an open alert never raises again)
                             where a.work_order_id = p_work_order_id and a.item_id = v_item and a.kind = 'issued_ahead' and a.resolved_at is null);
      insert into public.material_installed_usage_alerts (org_id, work_order_id, item_id, kind, pct, installed_qty, plan_qty, source, notified_user_id)
      values (v_org, p_work_order_id, v_item, 'issued_ahead', v_thr, (e->>'issued_qty')::numeric, (e->>'planned_qty')::numeric, 'stock_issues',
              case when p_quiet then null else v_to end)
      on conflict (work_order_id, item_id, kind) where resolved_at is null do nothing;
      get diagnostics v_rows = row_count;
      if v_rows = 1 and v_to is not null and not p_quiet then
        perform public.notify_workflow_user(v_org, v_to, 'Material issued ahead of progress',
          format('%s on work order %s: issued %s%% of planned, progress %s%%, %s points ahead. Review before more is issued.',
                 e->>'item_name', v_label, e->>'issued_pct', trim_scale(v_progress)::text, e->>'gap_pp'),
          'warning', 'work_order', p_work_order_id, v_label);
      end if;
    exception when others then
      raise warning 'ahead-of-progress check failed for work order % item %: %', p_work_order_id, e->>'item_id', sqlerrm;
    end;
  end loop;

  update public.material_installed_usage_alerts a set resolved_at = now()                              -- mut:resolve
   where a.work_order_id = p_work_order_id and a.kind = 'issued_ahead' and a.resolved_at is null and not (a.item_id = any(v_warned));
end $$;
revoke all on function public.usage_ahead_check_work_order(uuid, boolean) from public, anon, authenticated, service_role;

-- The only entry point a trigger uses: swallows every error and logs it.
create function public.usage_ahead_check_safe(p_work_order_id uuid) returns void
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  perform public.usage_ahead_check_work_order(p_work_order_id);
exception when others then                                                                              -- mut:ahead_never_blocks
  raise warning 'ahead-of-progress check failed for work order %: %', p_work_order_id, sqlerrm;
end $$;
revoke all on function public.usage_ahead_check_safe(uuid) from public, anon, authenticated, service_role;

-- The events that move the comparison. Additive AFTER triggers; the body never raises.
create function public.usage_ahead_trigger() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_table_name = 'stock_documents' and tg_op = 'UPDATE' and old.work_order_id is not null and old.work_order_id is distinct from new.work_order_id then
    perform public.usage_ahead_check_safe(old.work_order_id);
  end if;
  if new.work_order_id is not null then perform public.usage_ahead_check_safe(new.work_order_id); end if;
  return null;
exception when others then
  raise warning 'ahead-of-progress trigger failed: %', sqlerrm;
  return null;
end $$;
revoke all on function public.usage_ahead_trigger() from public, anon, authenticated, service_role;

create trigger stock_documents_zz_ahead_check after insert or update of status, work_order_id on public.stock_documents
  for each row when (new.status = 'Posted' and new.kind in ('issue', 'return') and new.work_order_id is not null) execute function public.usage_ahead_trigger();
create trigger daily_site_reports_zz_ahead_check after update of status, superseded_at, archived_at on public.daily_site_reports
  for each row when (old.status = 'validated' or new.status = 'validated') execute function public.usage_ahead_trigger();
create trigger work_order_acceptances_zz_ahead_check after update of status on public.work_order_acceptances
  for each row when (new.status = 'Confirmed' and old.status is distinct from new.status) execute function public.usage_ahead_trigger();

-- A changed threshold re-evaluates the work orders with an open alert (cleared: all close; lowered: new alerts open at the next event).
create function public.usage_ahead_threshold_trigger() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_wo uuid;
begin
  if new.issue_progress_threshold_pct is null then
    update public.material_installed_usage_alerts a set resolved_at = now()
     where a.org_id = new.org_id and a.kind = 'issued_ahead' and a.resolved_at is null;
  else
    for v_wo in select distinct a.work_order_id from public.material_installed_usage_alerts a
                 where a.org_id = new.org_id and a.kind = 'issued_ahead' and a.resolved_at is null loop
      perform public.usage_ahead_check_safe(v_wo);
    end loop;
  end if;
  return null;
exception when others then
  raise warning 'ahead-of-progress threshold change failed: %', sqlerrm;
  return null;
end $$;
revoke all on function public.usage_ahead_threshold_trigger() from public, anon, authenticated, service_role;
create trigger work_order_stock_settings_ahead_ins after insert on public.work_order_stock_settings
  for each row when (new.issue_progress_threshold_pct is not null) execute function public.usage_ahead_threshold_trigger();
create trigger work_order_stock_settings_ahead_upd after update of issue_progress_threshold_pct on public.work_order_stock_settings
  for each row when (new.issue_progress_threshold_pct is distinct from old.issue_progress_threshold_pct) execute function public.usage_ahead_threshold_trigger();

-- First evaluation after release (AC-MVP-010): open alerts for items already ahead and tell nobody. Runs once below; callable by the test as a
-- superuser. Acts as an active, non-light Admin of each organisation that has a threshold; an organisation with none is left alone.
create function public.usage_ahead_backfill() returns integer
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
      begin
        perform public.usage_ahead_check_work_order(v_wo, true);
        v_n := v_n + 1;
      exception when others then
        raise warning 'ahead-of-progress backfill failed for work order %: %', v_wo, sqlerrm;
      end;
    end loop;
  end loop;
  perform set_config('request.jwt.claims', coalesce(nullif(v_prior, ''), '{}'), true);
  return v_n;
end $$;
revoke all on function public.usage_ahead_backfill() from public, anon, authenticated, service_role;
select public.usage_ahead_backfill();
