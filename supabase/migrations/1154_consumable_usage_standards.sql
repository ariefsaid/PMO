-- 1154_consumable_usage_standards.sql — #2577 consumable needs from usage standards: the standards table.
-- Spec docs/specs/consumable-usage-standards.spec.md (FR-CUS-001..004, 015, 016) · plan docs/plans/2026-11-20-consumable-usage-standards.md.
-- Proven by supabase/tests/cus_standards.test.sql (AC-CUS-003, 011, 012, 014) and record_changes_catalog_gate.test.sql.
-- Reversible via supabase/migrations/rollback/1154_consumable_usage_standards_down.sql.
--
-- A usage standard is the organisation's rule "this consumable, this much per unit of work" (welding rod per dia-inch).
-- Reuse, not a new engine: stock items (0412), the stock master-data write rank (stock_master_writer, rank >= 20),
-- soft-archive (ADR-0018), record history (0260) and the column-grant write pattern of 0417 allowances.

-- §1 the table -------------------------------------------------------------------------------------------------
create table public.consumable_usage_standards (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  item_id         uuid not null references public.stock_items(id),
  work_unit       text not null constraint consumable_usage_standards_unit_check check (btrim(work_unit) <> '' and length(work_unit) <= 40),
  boq_code_prefix text constraint consumable_usage_standards_prefix_check check (boq_code_prefix is null or (btrim(boq_code_prefix) <> '' and length(boq_code_prefix) <= 40)),
  qty_per_unit    numeric(14,6) not null constraint consumable_usage_standards_qty_check check (qty_per_unit > 0 and qty_per_unit < 'Infinity'::numeric),
  margin_pct      numeric(5,2) not null default 0 constraint consumable_usage_standards_margin_check check (margin_pct >= 0 and margin_pct <= 100),
  archived_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
-- FR-CUS-003: one active standard per item, work unit (case/trim-insensitive) and prefix (empty and null are the same).
create unique index consumable_usage_standards_active_uniq on public.consumable_usage_standards
  (org_id, item_id, lower(btrim(work_unit)), lower(btrim(coalesce(boq_code_prefix, '')))) where archived_at is null;
create index consumable_usage_standards_item_idx on public.consumable_usage_standards (org_id, item_id);               -- NFR-CUS-004
create index consumable_usage_standards_unit_idx on public.consumable_usage_standards (org_id, lower(btrim(work_unit)));
create trigger consumable_usage_standards_stamp_org_id before insert on public.consumable_usage_standards
  for each row execute function public.stamp_org_id();

create or replace function public.touch_consumable_usage_standard() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
revoke all on function public.touch_consumable_usage_standard() from public, anon, authenticated;
create trigger consumable_usage_standards_touch before update on public.consumable_usage_standards
  for each row execute function public.touch_consumable_usage_standard();

-- FR-CUS-002/AC-CUS-014: the item is an active stock item of the caller's organisation. Invoker + RLS (the 0417
-- boq_allowance_ok precedent): a foreign item is invisible to stock_items_select, so it fails closed.
create or replace function public.cus_item_ok(p_item_id uuid) returns boolean
  language sql stable set search_path = public as $$
  select exists (select 1 from public.stock_items i
                  where i.id = p_item_id and i.archived_at is null and i.org_id = (select public.auth_org_id()))   -- mut:standard_item
$$;
revoke all on function public.cus_item_ok(uuid) from public, anon;
grant execute on function public.cus_item_ok(uuid) to authenticated;

-- §2 RLS + grants (⚑ every policy names is_active_member() literally, 0203; helpers wrapped in selects, 0646) ------
alter table public.consumable_usage_standards enable row level security;
alter table public.consumable_usage_standards force row level security;
create policy consumable_usage_standards_select on public.consumable_usage_standards for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy consumable_usage_standards_insert on public.consumable_usage_standards for insert
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member())
              and (select public.stock_master_writer()) and public.cus_item_ok(item_id));                       -- mut:standard_writer
-- item_id is not updatable (a different item is a different standard); unarchiving needs the item still active.
create policy consumable_usage_standards_update on public.consumable_usage_standards for update
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.stock_master_writer()))
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member())
              and (select public.stock_master_writer()) and (archived_at is not null or public.cus_item_ok(item_id)));
revoke all on public.consumable_usage_standards from authenticated, anon;
grant select on public.consumable_usage_standards to authenticated;
grant insert (item_id, work_unit, boq_code_prefix, qty_per_unit, margin_pct) on public.consumable_usage_standards to authenticated;
grant update (work_unit, boq_code_prefix, qty_per_unit, margin_pct, archived_at) on public.consumable_usage_standards to authenticated;
-- No delete: standards are archived, never deleted (ADR-0018).

-- §3 record history (0260 mechanism): every column classified once; the catalog gate proves it ------------------
insert into public.record_history_config (entity_type, table_name, parent_type, parent_col, parent_via, captured, flag_cols, omit_cols) values
  ('usage_standard', 'consumable_usage_standards', null, null, null,
   '{"item_id":"ref","work_unit":"text","boq_code_prefix":"text","qty_per_unit":"number","margin_pct":"number","archived_at":"timestamp"}',
   '{}', '{id,org_id,created_at,updated_at}');
create trigger consumable_usage_standards_zz_record_change
  after insert or update on public.consumable_usage_standards
  for each row execute function public.record_change_capture();

-- The catalog gate needs a visibility arm per registered entity: 0448's body verbatim plus one arm.
create or replace function public.record_history_visible(p_entity_type text,p_entity_id uuid) returns boolean
language plpgsql stable security invoker set search_path=public as $$
begin
 case p_entity_type
  when 'project' then return exists(select 1 from public.projects where id=p_entity_id);
  when 'budget_version' then return exists(select 1 from public.budget_versions where id=p_entity_id);
  when 'budget_line_item' then return exists(select 1 from public.budget_line_items where id=p_entity_id);
  when 'work_order' then return exists(select 1 from public.work_orders where id=p_entity_id);
  when 'procurement' then return exists(select 1 from public.procurements where id=p_entity_id);
  when 'purchase_request' then return exists(select 1 from public.purchase_requests where id=p_entity_id);
  when 'rfq' then return exists(select 1 from public.rfqs where id=p_entity_id);
  when 'purchase_order' then return exists(select 1 from public.purchase_orders where id=p_entity_id);
  when 'payment' then return exists(select 1 from public.payments where id=p_entity_id);
  when 'task' then return exists(select 1 from public.tasks where id=p_entity_id);
  when 'company' then return exists(select 1 from public.companies where id=p_entity_id);
  when 'contact' then return exists(select 1 from public.contacts where id=p_entity_id);
  when 'sales_invoice' then return exists(select 1 from public.sales_invoices where id=p_entity_id);
  when 'procurement_invoice' then return exists(select 1 from public.procurement_invoices where id=p_entity_id);
  when 'vendor_withholding_slip' then return exists(select 1 from public.vendor_withholding_slips where id=p_entity_id);
  when 'vendor_withholding_slip_bill' then return exists(select 1 from public.vendor_withholding_slip_bills where id=p_entity_id);
  when 'project_stage_entry' then return exists(select 1 from public.project_stage_entries where id=p_entity_id);
  when 'usage_standard' then return exists(select 1 from public.consumable_usage_standards where id=p_entity_id);
  else raise exception 'record_history_visible: no visibility arm for entity type %',p_entity_type using errcode='P0001';
 end case;
end $$;
revoke all on function public.record_history_visible(text,uuid) from public,anon;
grant execute on function public.record_history_visible(text,uuid) to authenticated,service_role;
