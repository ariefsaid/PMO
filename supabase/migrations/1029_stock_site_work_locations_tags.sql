-- 1029_stock_site_work_locations_tags.sql — #2523 (spec docs/specs/stock-site-work.spec.md; plan docs/plans/2026-11-20-stock-site-work.md).
-- Proven by supabase/tests/stock_site_work.test.sql.
--   §1 stock_warehouses.kind also allows 'yard' and 'staging' (FR-SSW-001..003); the #2517 work-order rule treats them like 'site'.
--   §2 stock_tags (an org names its own tags; one may be "zero cost"), stock_items.tag_id (FR-SSW-010/011).
--   §3 the zero-cost rule, in the database (FR-SSW-012): a line of a zero-cost item cannot carry a non-zero unit cost,
--      so its ledger value is 0 at every step. The posting engine is NOT edited: value 0 in -> value 0 out through stock_write_entry.
--   §4 an item's tag is frozen once it has movements (FR-SSW-014).
-- Nothing here writes the ledger.
--
-- ── REVERSE (also supabase/migrations/rollback/1029_stock_site_work_locations_tags_down.sql) ──────────
--   drop triggers/functions of §3, §4; alter table stock_items drop column tag_id; drop table stock_tags;
--   restore the kind check to ('central','site'); restore 0951's check_cost_attribution.

-- §1 kinds ---------------------------------------------------------------------------------------------
alter table public.stock_warehouses drop constraint stock_warehouses_kind_check;
alter table public.stock_warehouses add constraint stock_warehouses_kind_check check (kind in ('central','site','yard','staging'));

create or replace function public.check_cost_attribution() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_project uuid;
  v_wo_org uuid; v_wo_project uuid; v_wo_status public.work_order_status;
begin
  if new.work_order_id is not null then
    case tg_table_name
      when 'timesheet_entries', 'equipment_usage_entries' then
        v_project := new.project_id;
      when 'stock_documents' then
        if new.kind in ('issue', 'return') then
          v_project := new.project_id;
        elsif new.kind = 'transfer' then
          select w.project_id into v_project from public.stock_warehouses w
           where w.id = new.to_warehouse_id and w.org_id = new.org_id and w.kind in ('site', 'yard', 'staging');
        end if;
      else
        select p.project_id into v_project from public.procurements p
         where p.id = new.procurement_id and p.org_id = new.org_id;
    end case;
    if v_project is null then
      raise exception 'COST_WO_NO_PROJECT: this record has no project, so it cannot name a work order' using errcode = '23514';
    end if;
    select w.org_id, w.project_id, w.status into v_wo_org, v_wo_project, v_wo_status
      from public.work_orders w where w.id = new.work_order_id;
    if v_wo_org is distinct from new.org_id or v_wo_project is distinct from v_project then
      raise exception 'COST_WO_PROJECT: the work order belongs to another project' using errcode = '23514';
    end if;
    -- A cancelled work order takes no NEW costs; a row already on it keeps it (it was valid when written).
    if v_wo_status = 'Cancelled' and (tg_op = 'INSERT' or new.work_order_id is distinct from old.work_order_id) then
      raise exception 'COST_WO_CANCELLED: the work order is cancelled' using errcode = '23514';
    end if;
  end if;
  if new.discipline_id is not null and (tg_op = 'INSERT' or new.discipline_id is distinct from old.discipline_id) then
    if not exists (select 1 from public.cost_disciplines d
                    where d.id = new.discipline_id and d.org_id = new.org_id and d.archived_at is null) then
      raise exception 'COST_DISCIPLINE: the discipline is not on this organisation''s list' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.check_cost_attribution() from public, anon, authenticated;

-- The #2517 warehouse-move guard: a location may change between site/yard/staging, not to a kind that cannot carry a work order.
create or replace function public.guard_warehouse_move_with_work_orders() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (new.project_id is distinct from old.project_id or new.kind is distinct from old.kind)
     and exists (select 1 from public.stock_documents d
       join public.work_orders w on w.id = d.work_order_id
       where d.to_warehouse_id = new.id and d.kind = 'transfer'
         and (new.kind not in ('site', 'yard', 'staging') or w.project_id is distinct from new.project_id)) then
    raise exception 'COST_WO_PROJECT_MOVE: transfers to this warehouse name a work order of its project' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.guard_warehouse_move_with_work_orders() from public, anon, authenticated;

-- §2 tags ----------------------------------------------------------------------------------------------
create table public.stock_tags (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  name           text not null check (length(btrim(name)) between 1 and 80),
  zero_cost      boolean not null default false,
  paper_required boolean not null default false,          -- FR-SSW-022, per zero-cost tag (open question 5)
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  constraint stock_tags_paper_needs_zero_cost check (not paper_required or zero_cost)
);
create unique index stock_tags_org_name_uniq on public.stock_tags (org_id, lower(btrim(name)));
create trigger stock_tags_stamp_org_id before insert on public.stock_tags for each row execute function public.stamp_org_id();

alter table public.stock_items add column tag_id uuid references public.stock_tags(id);
create index stock_items_tag_idx on public.stock_items (tag_id) where tag_id is not null;

-- A tag on an item must be the item's own org's (invoker: the tag is read under the caller's RLS, so another org's fails closed).
create or replace function public.check_stock_item_tag() returns trigger
  language plpgsql set search_path = public as $$
begin
  if new.tag_id is not null and (select t.org_id from public.stock_tags t where t.id = new.tag_id) is distinct from new.org_id then
    raise exception 'STK_NOT_FOUND: the tag is not in your organisation' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.check_stock_item_tag() from public, anon, authenticated;
create trigger stock_items_zz_check_tag before insert or update of tag_id on public.stock_items
  for each row execute function public.check_stock_item_tag();

alter table public.stock_tags enable row level security;
alter table public.stock_tags force row level security;
-- Every policy names is_active_member() literally (0203). Read: any member; write: Admin only (rank >= 50), soft-archive only.
create policy stock_tags_select on public.stock_tags for select using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy stock_tags_insert on public.stock_tags for insert
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.stock_admin());
create policy stock_tags_update on public.stock_tags for update
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.stock_admin())
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.stock_admin());
revoke all on public.stock_tags from authenticated, anon;
grant select on public.stock_tags to authenticated;                                  -- no delete: archive only
grant insert (id, name, zero_cost, paper_required) on public.stock_tags to authenticated;
grant update (name, zero_cost, paper_required, archived_at) on public.stock_tags to authenticated;
grant insert (tag_id) on public.stock_items to authenticated;
grant update (tag_id) on public.stock_items to authenticated;

-- audit_stock_master reads a `code` column tags do not have: a small audit trigger of their own.
create or replace function public.audit_stock_tag() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform public.log_audit('stock.tag.' || case when tg_op = 'INSERT' then 'create'
                                                when old.archived_at is null and new.archived_at is not null then 'archive'
                                                else 'update' end,
    new.org_id, auth.uid(), new.id,
    jsonb_build_object('name', new.name, 'zero_cost', new.zero_cost, 'paper_required', new.paper_required));
  return null;
end $$;
revoke all on function public.audit_stock_tag() from public, anon, authenticated;
create trigger stock_tags_audit after insert or update on public.stock_tags for each row execute function public.audit_stock_tag();

-- A tag's zero-cost flag is frozen while any item carrying it has movements: flipping it would change what those rows meant.
create or replace function public.guard_stock_tag_flags() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if (new.zero_cost is distinct from old.zero_cost) and exists (
       select 1 from public.stock_items i join public.stock_ledger l on l.item_id = i.id where i.tag_id = new.id) then
    raise exception 'STK_TAG_LOCKED: the zero-cost flag of a tag whose items have movements cannot change' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.guard_stock_tag_flags() from public, anon, authenticated;
create trigger stock_tags_guard_flags before update of zero_cost on public.stock_tags for each row execute function public.guard_stock_tag_flags();

-- §3 the zero-cost rule (FR-SSW-012) ---------------------------------------------------------------------
-- On every line that carries a unit cost (receive; adjust-in; count): a zero-cost item may only be at cost 0.
-- Definer: it reads the item's tag whatever the caller's RLS. `-- mut:zero_cost` marks the line the mutation check breaks.
create or replace function public.guard_stock_line_zero_cost() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_zero boolean;
begin
  if new.unit_cost is null then return new; end if;
  select coalesce(t.zero_cost, false) into v_zero
    from public.stock_items i left join public.stock_tags t on t.id = i.tag_id where i.id = new.item_id;
  if v_zero and new.unit_cost <> 0 then                                                      -- mut:zero_cost
    raise exception 'STK_ZERO_COST: a client-supplied item is received at cost 0' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.guard_stock_line_zero_cost() from public, anon, authenticated;
create trigger stock_document_lines_zz_zero_cost before insert or update of unit_cost, item_id on public.stock_document_lines
  for each row execute function public.guard_stock_line_zero_cost();

-- §4 the tag is frozen once the item has moved (FR-SSW-014) ----------------------------------------------
create or replace function public.guard_stock_item_tag() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.tag_id is distinct from old.tag_id and exists (select 1 from public.stock_ledger l where l.item_id = new.id) then   -- mut:tag_frozen
    raise exception 'STK_TAG_LOCKED: the tag of an item with movements cannot change' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.guard_stock_item_tag() from public, anon, authenticated;
create trigger stock_items_guard_tag before update of tag_id on public.stock_items for each row execute function public.guard_stock_item_tag();
