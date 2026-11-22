-- 1871_work_order_material_alerts.sql — material-vs-progress: the record of material issued ahead of progress, per work order and item.
-- Spec docs/specs/material-vs-progress.spec.md (FR-MVP-002..004, FR-MVP-012). Proven by supabase/tests/1870_work_order_ahead_alert.test.sql.
-- One OPEN row per (work order, item) while the item warns; resolved_at closes the episode and a later warning opens a new row.
-- Written only by wo_material_alert_check (1872, definer); a client reads its organisation's rows unless it is a light account.
-- REVERSE: rollback/1871_work_order_material_alerts_down.sql.

create table public.work_order_material_alerts (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  work_order_id    uuid not null references public.work_orders(id),
  item_id          uuid not null references public.stock_items(id),
  issued_pct       numeric(7,1) not null,
  progress_pct     numeric(7,1) not null,
  gap_pp           numeric(7,1) not null,
  threshold_pct    numeric(5,2) not null,
  notified_user_ids uuid[] not null default '{}',   -- empty when nobody was told (first run after release, or every recipient was the actor)
  opened_at        timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  resolved_at      timestamptz
);
create unique index work_order_material_alerts_open_uq on public.work_order_material_alerts (work_order_id, item_id) where resolved_at is null;
create index work_order_material_alerts_org_idx on public.work_order_material_alerts (org_id, work_order_id) where resolved_at is null;
create index work_order_material_alerts_item_idx on public.work_order_material_alerts (item_id);
create trigger work_order_material_alerts_stamp_org_id before insert on public.work_order_material_alerts
  for each row execute function public.stamp_org_id();

alter table public.work_order_material_alerts enable row level security;
alter table public.work_order_material_alerts force row level security;
create policy work_order_material_alerts_select on public.work_order_material_alerts for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy light_account_deny_select on public.work_order_material_alerts as restrictive for select to authenticated
  using ((select public.actor_is_light()) is not true);
revoke all on public.work_order_material_alerts from public, anon, authenticated;
grant select on public.work_order_material_alerts to authenticated;
grant all on public.work_order_material_alerts to service_role;
