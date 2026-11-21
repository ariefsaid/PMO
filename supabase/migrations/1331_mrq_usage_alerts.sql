-- 1331_mrq_usage_alerts.sql — #2686 the record of each threshold crossing, and the check that raises it.
-- Spec docs/specs/material-request-usage-thresholds.spec.md (FR-MUT-003..005, NFR-MUT-001).
-- Proven by supabase/tests/mrq_usage_thresholds.test.sql. REVERSE: supabase/migrations/rollback/1331_mrq_usage_alerts_down.sql
--
-- One row per (work order, item, slot): that key is what makes a crossing raise once, however often the request is
-- re-saved, resubmitted or repeated. Written only by mrq_usage_check (definer); a client can read its organisation's rows.
-- Notification wording is plain English through notify_workflow_user (0237), a deliberate deviation recorded in the spec.

create table public.material_request_usage_alerts (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  work_order_id    uuid not null references public.work_orders(id),
  item_id          uuid not null references public.stock_items(id),
  slot             smallint not null check (slot in (1, 2)),
  pct              numeric(6,2) not null,           -- the threshold that was crossed, as set at the time
  use_qty          numeric not null,
  plan_qty         numeric not null,
  request_id       uuid references public.material_requests(id),
  notified_user_id uuid,                            -- null when nobody was notified (no manager, or the submitter is the manager)
  created_at       timestamptz not null default now(),
  constraint material_request_usage_alerts_once unique (work_order_id, item_id, slot)
);
create index material_request_usage_alerts_org_idx on public.material_request_usage_alerts (org_id, created_at desc);
create index material_request_usage_alerts_item_idx on public.material_request_usage_alerts (item_id);
create index material_request_usage_alerts_request_idx on public.material_request_usage_alerts (request_id);
create trigger material_request_usage_alerts_stamp_org_id before insert on public.material_request_usage_alerts
  for each row execute function public.stamp_org_id();

alter table public.material_request_usage_alerts enable row level security;
alter table public.material_request_usage_alerts force row level security;
create policy material_request_usage_alerts_select on public.material_request_usage_alerts for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
revoke all on public.material_request_usage_alerts from public, anon, authenticated;
grant select on public.material_request_usage_alerts to authenticated;

-- Internal: raise the crossings of one submitted request. Called by mrq_submit under its per-work-order lock, after the
-- plan loop. "Use" is the FR-MRQ-002 measure (prior quantity on the work order plus this request's own quantity).
create or replace function public.mrq_usage_check(p_request_id uuid) returns void
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  r public.material_requests; v_p1 numeric; v_p2 numeric; v_pm uuid; v_notify uuid; l record; v_pct numeric; v_slot smallint;
  v_plan numeric; v_use numeric; v_label text; v_item text; v_unit text; v_rows integer;
begin
  select * into r from public.material_requests where id = p_request_id;
  if not found then return; end if;
  select s.usage_warn_pct_1, s.usage_warn_pct_2 into v_p1, v_p2 from public.material_request_settings s where s.org_id = r.org_id;
  if v_p1 is null and v_p2 is null then return; end if;                                                  -- mut:usage_unset  (default off)

  -- "The work order's engineer" is the project's manager until a work-order responsible person exists (spec, ruling 2026-11-21).
  select p.project_manager_id into v_pm from public.projects p where p.id = r.project_id and p.org_id = r.org_id;
  v_notify := case when v_pm is not null and v_pm is distinct from auth.uid()
                        and exists (select 1 from public.profiles pr where pr.id = v_pm and pr.org_id = r.org_id)
                        and public.is_active_member(v_pm)
                   then v_pm end;
  select coalesce(w.wo_number, w.title) into v_label from public.work_orders w where w.id = r.work_order_id;

  for l in select ml.item_id, ml.quantity from public.material_request_lines ml where ml.request_id = r.id order by ml.line_no loop
    v_plan := public.mrq_plan_quantity(r.work_order_id, l.item_id);
    v_use  := public.mrq_prior_quantity(r.work_order_id, l.item_id, r.id) + l.quantity;
    select i.name, u.code into v_item, v_unit from public.stock_items i join public.stock_units u on u.id = i.unit_id where i.id = l.item_id;
    for v_slot in 1..2 loop
      v_pct := case v_slot when 1 then v_p1 else v_p2 end;
      continue when v_pct is null;
      -- plan 0 and any use crosses every threshold; otherwise use >= pct percent of plan, in exact numeric.
      continue when not ((v_plan = 0 and v_use > 0) or (v_plan > 0 and v_use * 100 >= v_pct * v_plan));
      insert into public.material_request_usage_alerts (org_id, work_order_id, item_id, slot, pct, use_qty, plan_qty, request_id, notified_user_id)
      values (r.org_id, r.work_order_id, l.item_id, v_slot, v_pct, v_use, v_plan, r.id, v_notify)
      on conflict (work_order_id, item_id, slot) do nothing;                                              -- mut:usage_once
      get diagnostics v_rows = row_count;
      if v_rows = 1 and v_notify is not null then
        perform public.notify_workflow_user(r.org_id, v_notify, 'Material usage threshold reached',
          format('%s on work order %s has reached the %s%% usage threshold: %s of %s %s planned. Review before more is used.',
                 v_item, v_label, trim_scale(v_pct)::text, trim_scale(v_use)::text, trim_scale(v_plan)::text, v_unit),
          'warning', 'material_request', r.id, r.number);
      end if;
    end loop;
  end loop;
end $$;
revoke all on function public.mrq_usage_check(uuid) from public, anon, authenticated, service_role;
