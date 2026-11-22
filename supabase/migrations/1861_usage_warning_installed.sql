-- 1861_usage_warning_installed.sql — the usage warning measures INSTALLED material (validated site reports) and tells the site engineer.
-- Spec docs/specs/usage-warning.spec.md (FR-UW-002..005, 007, 008). Proven by supabase/tests/usage_warning.test.sql (AC-UW-001..009).
-- REVERSE: rollback/1861_usage_warning_installed_down.sql.
--   §1 material_request_usage_alerts: one row per (work order, item); the request columns become the report that crossed.
--   §2 usage_installed_qty: THE definition of installed (live validated reports' material lines). usage_warning_recipient: THE recipient rule.
--   §3 usage_check_work_order + the trigger that runs it when a report is validated or a validated report is superseded.
--   §4 mrq_installed_for: the client read the request form and detail use. The request-based check is dropped in 1862.

-- ── §1 ───────────────────────────────────────────────────────────────────────────────────────────────
delete from public.material_request_usage_alerts where slot = 2;
alter table public.material_request_usage_alerts
  drop constraint material_request_usage_alerts_once,
  drop column slot,
  drop column request_id,
  add column report_id uuid references public.daily_site_reports(id) on delete set null,
  add constraint material_request_usage_alerts_once unique (work_order_id, item_id);               -- mut:usage_once
create index material_request_usage_alerts_report_idx on public.material_request_usage_alerts (report_id);

-- ── §2 ───────────────────────────────────────────────────────────────────────────────────────────────
-- Installed = the material lines of the work order's reports that are validated, not superseded and not archived
-- (the filter qcr_figures and work_order_validated_revenue use). Requests, transfers and stock issues never count.
create function public.usage_installed_qty(p_work_order uuid, p_item uuid) returns numeric
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(c.quantity), 0)
    from public.dsr_consumables c
    join public.daily_site_reports r on r.id = c.report_id
   where r.work_order_id = p_work_order and c.stock_item_id = p_item
     and r.status = 'validated' and r.superseded_at is null and r.archived_at is null              -- mut:usage_installed_only
$$;
revoke all on function public.usage_installed_qty(uuid, uuid) from public, anon, authenticated, service_role;

-- The "site engineer" (spec OQ-UW-1): the author of the most recently validated live report that carries the item. One body: change
-- the rule here and nowhere else. Null when that person is not an active member of the work order's organisation.
create function public.usage_warning_recipient(p_work_order uuid, p_item uuid) returns uuid
  language sql stable security definer set search_path = public, pg_temp as $$
  select r.author_id
    from public.daily_site_reports r
    join public.dsr_consumables c on c.report_id = r.id and c.stock_item_id = p_item
    join public.work_orders w on w.id = r.work_order_id
    join public.profiles p on p.id = r.author_id and p.org_id = w.org_id
   where r.work_order_id = p_work_order and r.status = 'validated' and r.superseded_at is null and r.archived_at is null
     and public.is_active_member(r.author_id)
   order by r.validated_at desc, r.id desc limit 1
$$;
revoke all on function public.usage_warning_recipient(uuid, uuid) from public, anon, authenticated, service_role;

-- ── §3 ───────────────────────────────────────────────────────────────────────────────────────────────
create function public.usage_check_work_order(p_work_order uuid) returns void
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_org uuid; v_pct numeric; v_label text; i record; v_plan numeric; v_inst numeric; v_to uuid; v_report uuid;
  v_item text; v_unit text; v_rows integer;
begin
  select w.org_id, coalesce(w.wo_number, w.title) into v_org, v_label from public.work_orders w where w.id = p_work_order;
  if v_org is null then return; end if;
  select s.usage_warn_pct into v_pct from public.material_request_settings s where s.org_id = v_org;
  if v_pct is null then return; end if;                                                                -- mut:usage_unset  (default off)
  for i in select distinct c.stock_item_id as item_id
             from public.dsr_consumables c join public.daily_site_reports r on r.id = c.report_id
            where r.work_order_id = p_work_order and r.status = 'validated' and r.superseded_at is null and r.archived_at is null loop
    begin   -- a failed check never rolls back the validation that triggered it (FR-UW-007)
      v_plan := public.mrq_plan_quantity(p_work_order, i.item_id);
      v_inst := public.usage_installed_qty(p_work_order, i.item_id);
      -- plan 0 and any installed quantity is past the share; otherwise installed >= pct percent of plan, in exact numeric.
      continue when not ((v_plan = 0 and v_inst > 0) or (v_plan > 0 and v_inst * 100 >= v_pct * v_plan));   -- mut:usage_share
      v_to := public.usage_warning_recipient(p_work_order, i.item_id);
      select r.id into v_report
        from public.daily_site_reports r join public.dsr_consumables c on c.report_id = r.id and c.stock_item_id = i.item_id
       where r.work_order_id = p_work_order and r.status = 'validated' and r.superseded_at is null and r.archived_at is null
       order by r.validated_at desc, r.id desc limit 1;
      insert into public.material_request_usage_alerts (org_id, work_order_id, item_id, pct, use_qty, plan_qty, report_id, notified_user_id)
      values (v_org, p_work_order, i.item_id, v_pct, v_inst, v_plan, v_report, v_to)
      on conflict (work_order_id, item_id) do nothing;
      get diagnostics v_rows = row_count;
      if v_rows = 1 and v_to is not null then
        select it.name, u.code into v_item, v_unit from public.stock_items it join public.stock_units u on u.id = it.unit_id where it.id = i.item_id;
        perform public.notify_workflow_user(v_org, v_to, 'Installed material usage reached',
          format('%s on work order %s has reached the %s%% usage warning: %s of %s %s planned is installed. Go and check the site.',
                 v_item, v_label, trim_scale(v_pct)::text, trim_scale(v_inst)::text, trim_scale(v_plan)::text, v_unit),
          'warning', 'work_order', p_work_order, v_label);
      end if;
    exception when others then
      raise warning 'usage warning check failed for work order %: %', p_work_order, sqlerrm;
    end;
  end loop;
end $$;
revoke all on function public.usage_check_work_order(uuid) from public, anon, authenticated, service_role;

create function public.usage_check_trigger() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.usage_check_work_order(new.work_order_id);
  return null;
end $$;
revoke all on function public.usage_check_trigger() from public, anon, authenticated;
-- An original report counts once it is validated. A correction is validated BEFORE dsr_validate sets superseded_at on the version it
-- replaces (1041), so the check for a correction runs on that supersede: counting at validation time would count both versions.
create trigger daily_site_reports_zz_usage_check after update of status, superseded_at on public.daily_site_reports
  for each row when ((new.status = 'validated' and old.status is distinct from new.status and new.supersedes_id is null)
                     or (old.superseded_at is null and new.superseded_at is not null))
  execute function public.usage_check_trigger();

-- ── §4 ───────────────────────────────────────────────────────────────────────────────────────────────
create function public.mrq_installed_for(p_work_order_id uuid, p_item_ids uuid[])
  returns table (item_id uuid, installed_qty numeric)
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id();
begin
  perform public.assert_not_light();
  if v_org is null or not public.is_active_member() then return; end if;
  if not exists (select 1 from public.work_orders w where w.id = p_work_order_id and w.org_id = v_org) then return; end if;
  if coalesce(array_length(p_item_ids, 1), 0) > 200 then
    raise exception 'MRQ_INVALID: 200 items at most' using errcode = 'P0001'; end if;
  return query
  select i.id, public.usage_installed_qty(p_work_order_id, i.id)
    from public.stock_items i where i.id = any(p_item_ids) and i.org_id = v_org;
end $$;
revoke all on function public.mrq_installed_for(uuid, uuid[]) from public, anon;
grant execute on function public.mrq_installed_for(uuid, uuid[]) to authenticated;
