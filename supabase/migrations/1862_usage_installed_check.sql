-- 1862_usage_installed_check.sql — warn the responsible person when INSTALLED material passes the usage threshold (spec docs/specs/usage-warning.spec.md FR-UW-002..009).
-- Proven by supabase/tests/usage_warning.test.sql (AC-UW-001..009, 017, 018). REVERSE: rollback/1862_usage_installed_check_down.sql.
-- The request-time warning (1330-1333) is untouched and stays beside this one; this check reuses its first threshold (usage_warn_pct_1).
--   §1 material_installed_usage_alerts: one row per (work order, item): told once.
--   §2 usage_installed_qty: THE definition of installed, by the organisation's source (1861). usage_warning_recipient: THE recipient rule.
--   §3 usage_check_work_order, and usage_check_safe: the only thing a trigger calls. A failure is swallowed and logged, never raised:
--      a check can never block validating a report or posting a stock document.
--   §4 triggers: a report validated / superseded / archived, and a stock issue or return posted to a work order.

-- ── §1 ───────────────────────────────────────────────────────────────────────────────────────────────
create table public.material_installed_usage_alerts (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  work_order_id    uuid not null references public.work_orders(id),
  item_id          uuid not null references public.stock_items(id),
  pct              numeric(6,2) not null,                 -- the threshold as set when it was crossed
  installed_qty    numeric not null,
  plan_qty         numeric not null,
  source           text not null check (source in ('site_reports', 'stock_issues')),
  notified_user_id uuid,                                  -- null when nobody could be told
  created_at       timestamptz not null default now(),
  constraint material_installed_usage_alerts_once unique (work_order_id, item_id)        -- mut:usage_once
);
create index material_installed_usage_alerts_org_idx on public.material_installed_usage_alerts (org_id, created_at desc);
create index material_installed_usage_alerts_item_idx on public.material_installed_usage_alerts (item_id);
create trigger material_installed_usage_alerts_stamp_org_id before insert on public.material_installed_usage_alerts
  for each row execute function public.stamp_org_id();
alter table public.material_installed_usage_alerts enable row level security;
alter table public.material_installed_usage_alerts force row level security;
create policy material_installed_usage_alerts_select on public.material_installed_usage_alerts for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
revoke all on public.material_installed_usage_alerts from public, anon, authenticated;
grant select on public.material_installed_usage_alerts to authenticated;
-- A field (light) account reads none of it (1462/1480 convention: restrictive select, helper wrapped so it runs once per query).
create policy light_account_deny_select on public.material_installed_usage_alerts as restrictive for select to authenticated
  using ((select public.actor_is_light()) is not true);

-- ── §2 ───────────────────────────────────────────────────────────────────────────────────────────────
-- Installed of one item on one work order. site_reports: the material lines of live validated reports (not superseded, not archived).
-- stock_issues: posted issues less posted returns to the work order. Requests and transfers never count.
create function public.usage_installed_qty(p_work_order uuid, p_item uuid) returns numeric
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_source text;
begin
  select w.org_id into v_org from public.work_orders w where w.id = p_work_order;
  if v_org is null then return 0; end if;
  select coalesce((select s.usage_installed_source from public.material_request_settings s where s.org_id = v_org), 'site_reports') into v_source;
  if v_source = 'stock_issues' then
    return coalesce((select sum(-l.qty_delta)
                       from public.stock_ledger l join public.stock_documents d on d.id = l.document_id
                      where d.work_order_id = p_work_order and l.item_id = p_item and l.org_id = v_org
                        and l.kind in ('issue', 'return')), 0);                                   -- mut:usage_source
  end if;
  return coalesce((select sum(c.quantity)
                     from public.dsr_consumables c join public.daily_site_reports r on r.id = c.report_id
                    where r.work_order_id = p_work_order and c.stock_item_id = p_item
                      and r.status = 'validated' and r.superseded_at is null and r.archived_at is null), 0);   -- mut:usage_installed_only
end $$;
revoke all on function public.usage_installed_qty(uuid, uuid) from public, anon, authenticated, service_role;

-- Who is told: the work order's responsible person (1860); when there is none, or that person is no longer an active member,
-- the project's manager. Null when neither can be told. One body: change the rule here and nowhere else.
create function public.usage_warning_recipient(p_work_order uuid) returns uuid
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select w.responsible_person_id from public.work_orders w join public.profiles p on p.id = w.responsible_person_id and p.org_id = w.org_id
      where w.id = p_work_order and public.is_active_member(w.responsible_person_id)),
    (select pr.project_manager_id from public.work_orders w
       join public.projects pr on pr.id = w.project_id and pr.org_id = w.org_id
       join public.profiles p on p.id = pr.project_manager_id and p.org_id = w.org_id
      where w.id = p_work_order and public.is_active_member(pr.project_manager_id)))
$$;
revoke all on function public.usage_warning_recipient(uuid) from public, anon, authenticated, service_role;

-- ── §3 ───────────────────────────────────────────────────────────────────────────────────────────────
create function public.usage_check_work_order(p_work_order uuid) returns void
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_org uuid; v_pct numeric; v_source text; v_label text; i record; v_plan numeric; v_inst numeric; v_to uuid;
  v_item text; v_unit text; v_rows integer;
begin
  select w.org_id, coalesce(w.wo_number, w.title) into v_org, v_label from public.work_orders w where w.id = p_work_order;
  if v_org is null then return; end if;
  select s.usage_warn_pct_1, s.usage_installed_source into v_pct, v_source from public.material_request_settings s where s.org_id = v_org;
  if v_pct is null then return; end if;                                                                -- mut:usage_unset  (default off)
  v_source := coalesce(v_source, 'site_reports');
  for i in
    select c.stock_item_id as item_id
      from public.dsr_consumables c join public.daily_site_reports r on r.id = c.report_id
     where v_source = 'site_reports' and r.work_order_id = p_work_order
       and r.status = 'validated' and r.superseded_at is null and r.archived_at is null
    union
    select l.item_id
      from public.stock_ledger l join public.stock_documents d on d.id = l.document_id
     where v_source = 'stock_issues' and d.work_order_id = p_work_order and l.org_id = v_org and l.kind in ('issue', 'return')
  loop
    begin   -- one item's failure does not stop the others
      v_plan := public.mrq_plan_quantity(p_work_order, i.item_id);
      v_inst := public.usage_installed_qty(p_work_order, i.item_id);
      -- plan 0 and any installed quantity is past the share; otherwise installed >= pct percent of plan, in exact numeric.
      continue when not ((v_plan = 0 and v_inst > 0) or (v_plan > 0 and v_inst * 100 >= v_pct * v_plan));   -- mut:usage_share
      v_to := public.usage_warning_recipient(p_work_order);
      insert into public.material_installed_usage_alerts (org_id, work_order_id, item_id, pct, installed_qty, plan_qty, source, notified_user_id)
      values (v_org, p_work_order, i.item_id, v_pct, v_inst, v_plan, v_source, v_to)
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
      raise warning 'usage warning check failed for work order % item %: %', p_work_order, i.item_id, sqlerrm;
    end;
  end loop;
end $$;
revoke all on function public.usage_check_work_order(uuid) from public, anon, authenticated, service_role;

-- The only entry point a trigger uses. It swallows every error (and logs it as a database warning): validating a report or posting a
-- stock document must never fail, or wait, because of a warning.
create function public.usage_check_safe(p_work_order uuid) returns void
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  perform public.usage_check_work_order(p_work_order);
exception when others then                                                                              -- mut:usage_never_blocks
  raise warning 'usage warning check failed for work order %: %', p_work_order, sqlerrm;
end $$;
revoke all on function public.usage_check_safe(uuid) from public, anon, authenticated, service_role;

-- ── §4 ───────────────────────────────────────────────────────────────────────────────────────────────
create function public.usage_check_report_trigger() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.usage_check_safe(new.work_order_id);
  return null;
end $$;
revoke all on function public.usage_check_report_trigger() from public, anon, authenticated;
-- An original report counts once it is validated. A correction is validated BEFORE dsr_validate sets superseded_at on the version it replaces
-- (1041), so a correction is checked on that supersede: counting at its own validation would count both versions. Archiving removes a report.
create trigger daily_site_reports_zz_usage_check after update of status, superseded_at, archived_at on public.daily_site_reports
  for each row when ((new.status = 'validated' and old.status is distinct from new.status and new.supersedes_id is null)
                     or (old.superseded_at is null and new.superseded_at is not null)
                     or (old.archived_at is null and new.archived_at is not null))
  execute function public.usage_check_report_trigger();

create function public.usage_check_stock_trigger() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.usage_check_safe(new.work_order_id);
  return null;
end $$;
revoke all on function public.usage_check_stock_trigger() from public, anon, authenticated;
-- The ledger rows are written before the document turns Posted (stock_post_core), so the check sees the new quantity.
create trigger stock_documents_zz_usage_check after update of status on public.stock_documents
  for each row when (new.status = 'Posted' and old.status is distinct from new.status and new.kind in ('issue', 'return') and new.work_order_id is not null)
  execute function public.usage_check_stock_trigger();

-- The read the work order card uses is the table itself (org-scoped select above).
