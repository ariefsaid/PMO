-- 0950_cost_disciplines.sql — #2517: the organisation's own list of disciplines (civil, mechanical, electrical, …)
-- that a cost line can name. Spec: docs/specs/work-order-cost-attribution.spec.md (FR-WCA-010..013).
-- ADR-0104. Proven by supabase/tests/0950_work_order_cost_attribution.test.sql.
-- ── REVERSE (also supabase/migrations/rollback/0950_cost_disciplines_down.sql) ───────────────────────
--   drop table if exists public.cost_disciplines;   -- drops its policies and triggers (0951 must be reversed first)

create table public.cost_disciplines (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                references public.organizations(id) on delete cascade,
  code        text not null check (char_length(btrim(code)) between 1 and 20),
  name        text not null check (char_length(btrim(name)) between 1 and 120),
  created_by  uuid references public.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  archived_at timestamptz
);
-- One live code per org; an archived code can be reused.
create unique index cost_disciplines_code_live on public.cost_disciplines (org_id, lower(btrim(code))) where archived_at is null;
create index cost_disciplines_org_idx on public.cost_disciplines (org_id, name);
create trigger cost_disciplines_stamp_org_id before insert on public.cost_disciplines
  for each row execute function public.stamp_org_id();

alter table public.cost_disciplines enable row level security;
alter table public.cost_disciplines force row level security;

-- Every active member reads the list (the cost forms need the picker).
create policy cost_disciplines_select on public.cost_disciplines for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
-- FR-WCA-011: an Admin keeps the list. Soft-archive (ADR-0018) instead of deleting a discipline that is in use;
-- a referenced row FK-blocks a delete (23503).
create policy cost_disciplines_insert on public.cost_disciplines for insert
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) = 'Admin');
create policy cost_disciplines_update on public.cost_disciplines for update
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) = 'Admin')
  with check (org_id = (select public.auth_org_id()));
create policy cost_disciplines_delete on public.cost_disciplines for delete
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) = 'Admin');

revoke all on public.cost_disciplines from public, anon, authenticated;
grant select, delete on public.cost_disciplines to authenticated;
grant insert (code, name) on public.cost_disciplines to authenticated;
grant update (code, name, archived_at) on public.cost_disciplines to authenticated;
grant all on public.cost_disciplines to service_role;
