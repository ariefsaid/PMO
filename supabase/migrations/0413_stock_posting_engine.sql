-- 0413_stock_posting_engine.sql - #1512 S2a: stock documents, lines, ledger, balances; Receive and Transfer posting.
-- Spec docs/specs/inventory-project-consumption.spec.md · plan docs/plans/2026-10-31-inventory-project-consumption.md (S2a;
-- the plan's "0412" for this slice is 0413 after the renumber) · ADR-0097.
-- Reversal: supabase/migrations/rollback/0413_stock_posting_engine_down.sql (pre-production: supabase db reset).
-- ⚑ SINGLE WRITER (FR-STK-072, D1): stock_write_entry is the only function that inserts into stock_ledger or updates
--   stock_balances (stock_lock_for_document may seed a zero balance row). scripts/stock-single-writer.test.mjs enforces it.
-- ⚑ Predicates use role RANK (ADR-0070), never a role list: Admin = rank >= 50. `-- mut:<id>` marks the one line the
--   mutation harness (scripts/stock-mutation-proof.mjs) breaks; keep each guarded decision on that one line.
-- ⚑ ERP owns the GL (ADR-0048/0055): this is a stock sub-ledger, never a GL posting.

-- §1 tables, constraints, RLS, guard triggers --------------------------------------------------------------
create table public.stock_documents (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id),               -- no default: the RPC states it (0250 progress_claims)
  number           text not null,
  kind             text not null check (kind in ('receive','transfer','issue','return','adjustment','count')),
  status           text not null default 'Draft' check (status in ('Draft','Posted','Cancelled')),
  warehouse_id     uuid not null references public.stock_warehouses(id),
  to_warehouse_id  uuid references public.stock_warehouses(id),
  project_id       uuid references public.projects(id),
  procurement_id   uuid references public.procurements(id),
  reason           text check (reason is null or length(btrim(reason)) between 1 and 500),
  note             text check (note is null or length(note) <= 1000),
  occurred_on      date not null,
  client_request_id uuid,
  created_by       uuid not null references public.profiles(id),
  created_at       timestamptz not null default now(),
  posted_by        uuid references public.profiles(id),
  posted_at        timestamptz,
  cancelled_by     uuid references public.profiles(id),
  cancelled_at     timestamptz,
  constraint stock_documents_number_uniq unique (org_id, number),
  constraint stock_documents_shape check (
        ((kind = 'transfer') = (to_warehouse_id is not null))
    and (kind <> 'transfer' or to_warehouse_id <> warehouse_id)
    and (case kind when 'issue'  then project_id is not null
                   when 'return' then (status <> 'Posted' or project_id is not null)
                   else project_id is null end)
    and (procurement_id is null or kind = 'receive')
    and (kind <> 'adjustment' or reason is not null)
    and ((status = 'Posted') = (posted_at is not null and posted_by is not null))
    and ((status = 'Cancelled') = (cancelled_at is not null and cancelled_by is not null)))
);
create unique index stock_documents_idem_uniq on public.stock_documents (org_id, created_by, client_request_id) where client_request_id is not null;
create index stock_documents_org_created_idx on public.stock_documents (org_id, created_at desc, id desc);
create index stock_documents_warehouse_idx on public.stock_documents (warehouse_id);
create index stock_documents_project_idx on public.stock_documents (project_id) where project_id is not null;

create table public.stock_document_lines (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id),
  document_id       uuid not null references public.stock_documents(id),
  line_no           integer not null check (line_no > 0),
  item_id           uuid not null references public.stock_items(id),
  quantity          numeric(14,3) check (quantity is null or (quantity > 0 and quantity < 'Infinity'::numeric)),
  counted_quantity  numeric(14,3) check (counted_quantity is null or (counted_quantity >= 0 and counted_quantity < 'Infinity'::numeric)),
  expected_quantity numeric(14,3),
  direction         text check (direction in ('in','out')),                       -- adjustment lines only
  unit_cost         numeric(14,4) check (unit_cost is null or (unit_cost >= 0 and unit_cost < 'Infinity'::numeric)),
  boq_item_id       uuid references public.boq_items(id),
  source_line_id    uuid references public.stock_document_lines(id),
  constraint stock_document_lines_one_qty check ((quantity is null) <> (counted_quantity is null)),
  unique (document_id, line_no)
);
create index stock_document_lines_item_idx on public.stock_document_lines (item_id);
create index stock_document_lines_source_idx on public.stock_document_lines (source_line_id) where source_line_id is not null;

create table public.stock_ledger (            -- MACHINE-WRITTEN, append-only (FR-STK-072)
  seq            bigint generated always as identity primary key,
  id             uuid not null unique default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id),
  document_id    uuid not null references public.stock_documents(id),
  line_id        uuid not null references public.stock_document_lines(id),
  item_id        uuid not null references public.stock_items(id),
  warehouse_id   uuid not null references public.stock_warehouses(id),
  project_id     uuid references public.projects(id),
  boq_item_id    uuid references public.boq_items(id),
  source_line_id uuid references public.stock_document_lines(id),
  kind           text not null,
  qty_delta      numeric(14,3) not null check (qty_delta <> 0),
  value_delta    numeric(14,2) not null,
  qty_after      numeric(14,3) not null,
  value_after    numeric(14,2) not null,
  occurred_on    date not null,
  posted_at      timestamptz not null default now(),
  posted_by      uuid not null references public.profiles(id),
  check ((qty_delta > 0 and value_delta >= 0) or (qty_delta < 0 and value_delta <= 0))
);
create index stock_ledger_item_wh_idx   on public.stock_ledger (org_id, item_id, warehouse_id, seq);
create index stock_ledger_project_idx   on public.stock_ledger (org_id, project_id, boq_item_id, occurred_on);
create index stock_ledger_document_idx  on public.stock_ledger (document_id);
create index stock_ledger_source_idx    on public.stock_ledger (source_line_id) where source_line_id is not null;

create table public.stock_balances (          -- MACHINE-WRITTEN
  org_id        uuid not null references public.organizations(id),
  item_id       uuid not null references public.stock_items(id),
  warehouse_id  uuid not null references public.stock_warehouses(id),
  qty_on_hand   numeric(14,3) not null default 0,
  value_on_hand numeric(14,2) not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (item_id, warehouse_id),
  check (qty_on_hand >= 0 and value_on_hand >= 0 and (qty_on_hand > 0 or value_on_hand = 0))
);
create index stock_balances_warehouse_idx on public.stock_balances (org_id, warehouse_id);

-- RLS + grants: documents and (cost-free columns of) lines are readable by active members; NOTHING is client-writable;
-- ledger and balances are NOT client-readable (cost is read only through the S3 RPCs, D5).
alter table public.stock_documents      enable row level security;  alter table public.stock_documents      force row level security;
alter table public.stock_document_lines enable row level security;  alter table public.stock_document_lines force row level security;
alter table public.stock_ledger         enable row level security;  alter table public.stock_ledger         force row level security;
alter table public.stock_balances       enable row level security;  alter table public.stock_balances       force row level security;
create policy stock_documents_select      on public.stock_documents      for select using (org_id = public.auth_org_id() and public.is_active_member());
create policy stock_document_lines_select on public.stock_document_lines for select using (org_id = public.auth_org_id() and public.is_active_member());
revoke all on public.stock_documents, public.stock_document_lines, public.stock_ledger, public.stock_balances from authenticated, anon;
-- ADR-0097 §1: append-only for every role, the service key included (precedent 0114). The RPCs write as their owner.
revoke insert, update, delete, truncate on public.stock_documents, public.stock_document_lines, public.stock_ledger, public.stock_balances from service_role;
grant select on public.stock_documents to authenticated;
grant select (id, org_id, document_id, line_no, item_id, quantity, counted_quantity, expected_quantity, direction, boq_item_id, source_line_id)
  on public.stock_document_lines to authenticated;                 -- unit_cost deliberately absent

-- Immutability (FR-STK-013, AC-STK-011): a Posted or Cancelled document, its lines and every ledger row never change.
create or replace function public.guard_stock_document_immutable() returns trigger
  language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'Draft' then raise exception 'STK_IMMUTABLE: a posted or cancelled document cannot be deleted' using errcode = 'P0001'; end if;
    return old;
  end if;
  if old.status <> 'Draft' then raise exception 'STK_IMMUTABLE: a posted or cancelled document cannot be changed' using errcode = 'P0001'; end if;
  return new;
end $$;
create or replace function public.guard_stock_line_immutable() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_status text; v_doc uuid;
begin
  if tg_op = 'DELETE' then v_doc := old.document_id; else v_doc := new.document_id; end if;
  select d.status into v_status from public.stock_documents d where d.id = v_doc;
  if v_status is distinct from 'Draft' then raise exception 'STK_IMMUTABLE: the lines of a posted or cancelled document cannot change' using errcode = 'P0001'; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create or replace function public.guard_stock_ledger_append_only() returns trigger
  language plpgsql set search_path = public as $$
begin raise exception 'STK_IMMUTABLE: the stock ledger is append-only' using errcode = 'P0001'; end $$;
create trigger stock_documents_immutable before update or delete on public.stock_documents for each row execute function public.guard_stock_document_immutable();
create trigger stock_document_lines_immutable before insert or update or delete on public.stock_document_lines for each row execute function public.guard_stock_line_immutable();
create trigger stock_ledger_append_only before update or delete on public.stock_ledger for each row execute function public.guard_stock_ledger_append_only();
create trigger stock_ledger_no_truncate before truncate on public.stock_ledger for each statement execute function public.guard_stock_ledger_append_only();

-- Master-data rules that need the tables above (FR-STK-006, 008; PQ-9). Definer: balances/lines carry no client read.
create or replace function public.guard_stock_archive() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if old.archived_at is null and new.archived_at is not null then
    if (tg_table_name = 'stock_items' and exists (select 1 from public.stock_balances b where b.item_id = new.id and b.qty_on_hand > 0))
       or (tg_table_name = 'stock_warehouses' and exists (select 1 from public.stock_balances b where b.warehouse_id = new.id and b.qty_on_hand > 0)) then
      raise exception 'STK_HAS_STOCK: archive refused while stock is on hand' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create or replace function public.guard_stock_item_unit() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.unit_id is distinct from old.unit_id and exists (select 1 from public.stock_document_lines l where l.item_id = new.id) then
    raise exception 'STK_UNIT_LOCKED: the unit of an item with movements cannot change' using errcode = 'P0001';
  end if;
  return new;
end $$;
create or replace function public.guard_stock_unit_whole() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.whole_only is distinct from old.whole_only and exists (
       select 1 from public.stock_document_lines l join public.stock_items i on i.id = l.item_id where i.unit_id = new.id) then
    raise exception 'STK_UNIT_LOCKED: the whole-numbers flag of a unit with movements cannot change' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger stock_items_guard_archive      before update of archived_at on public.stock_items      for each row execute function public.guard_stock_archive();
create trigger stock_warehouses_guard_archive before update of archived_at on public.stock_warehouses for each row execute function public.guard_stock_archive();
create trigger stock_items_guard_unit         before update of unit_id     on public.stock_items      for each row execute function public.guard_stock_item_unit();
create trigger stock_units_guard_whole        before update of whole_only  on public.stock_units      for each row execute function public.guard_stock_unit_whole();
revoke all on function public.guard_stock_document_immutable(), public.guard_stock_line_immutable(), public.guard_stock_ledger_append_only(),
  public.guard_stock_archive(), public.guard_stock_item_unit(), public.guard_stock_unit_whole() from public, anon, authenticated;

-- §2 helpers and rule functions -------------------------------------------------------------------------
create or replace function public.stock_doc_prefix(p_kind text) returns text language sql immutable as $$
  select case p_kind when 'receive' then 'RCV' when 'transfer' then 'TRF' when 'issue' then 'ISS'
                     when 'return' then 'RTN' when 'adjustment' then 'ADJ' when 'count' then 'CNT' end $$;

create or replace function public.stock_org_today(p_org uuid) returns date language sql stable security definer set search_path = public as $$
  select (now() at time zone coalesce((select o.default_timezone from public.organizations o where o.id = p_org), 'UTC'))::date $$;

-- D6: first and fail closed. A null or an error from the ownership read refuses.
create or replace function public.stock_assert_standalone(p_org uuid) returns void
  language plpgsql stable security definer set search_path = public as $$
declare v_owned boolean; v_allowed boolean;
begin
  begin v_owned := public.domain_externally_owned(p_org, 'inventory');
  exception when others then v_owned := null; end;
  v_allowed := not coalesce(v_owned, true);                                         -- mut:owned
  if not v_allowed then
    raise exception 'STK_OWNED_BY_ERP: inventory is run in your connected ERP, so PMO does not post stock' using errcode = 'P0001';
  end if;
end $$;

-- FR-STK-061: keeper of the warehouse, else Admin (returns true when the Admin override was used, so the caller audits it).
create or replace function public.stock_assert_keeper(p_org uuid, p_warehouse uuid, p_uid uuid) returns boolean
  language plpgsql stable security definer set search_path = public as $$
declare v_keeper boolean; v_admin boolean;
begin
  v_keeper := exists (select 1 from public.stock_warehouse_keepers k
                       where k.org_id = p_org and k.warehouse_id = p_warehouse and k.user_id = p_uid);   -- mut:keeper
  if v_keeper then return false; end if;
  v_admin := coalesce(public.role_rank(public.auth_role()) >= 50, false);                               -- mut:keeper_admin
  if v_admin then return true; end if;
  raise exception 'STK_NOT_KEEPER: you do not keep this warehouse' using errcode = 'P0001';
end $$;

-- FR-STK-016 + PQ-2: never future (Admin included); older than 31 days only for Admin.
create or replace function public.stock_assert_dates(p_org uuid, p_occurred date) returns void
  language plpgsql stable security definer set search_path = public as $$
declare v_today date := public.stock_org_today(p_org); v_future_ok boolean; v_old_ok boolean;
begin
  v_future_ok := p_occurred <= v_today;                                                                  -- mut:future
  if not v_future_ok then raise exception 'STK_BACKDATE: a stock movement cannot be dated in the future' using errcode = 'P0001'; end if;
  v_old_ok := p_occurred >= v_today - 31 or coalesce(public.role_rank(public.auth_role()) >= 50, false); -- mut:backdate
  if not v_old_ok then raise exception 'STK_BACKDATE: only an Admin may date a movement more than 31 days back' using errcode = 'P0001'; end if;
end $$;

-- Fixed lock order (D3): (2) cited issue lines by id, (3) balances by (item, warehouse). The document row is (1), locked by the caller.
create or replace function public.stock_lock_for_document(p_doc public.stock_documents) returns void
  language plpgsql volatile security definer set search_path = public as $$
declare r record;
begin
  perform 1 from public.stock_document_lines s
   where s.id in (select l.source_line_id from public.stock_document_lines l where l.document_id = p_doc.id and l.source_line_id is not null)
   order by s.id for update;
  for r in select distinct l.item_id, w.wid as warehouse_id
             from public.stock_document_lines l
             cross join lateral (values (p_doc.warehouse_id), (p_doc.to_warehouse_id)) as w(wid)
            where l.document_id = p_doc.id and w.wid is not null
            order by l.item_id, w.wid                                                                   -- mut:lockorder
  loop
    insert into public.stock_balances (org_id, item_id, warehouse_id) values (p_doc.org_id, r.item_id, r.warehouse_id)
      on conflict (item_id, warehouse_id) do nothing;
    perform 1 from public.stock_balances b where b.item_id = r.item_id and b.warehouse_id = r.warehouse_id for update;
  end loop;
end $$;

-- THE ONLY WRITER of stock_ledger and stock_balances (FR-STK-072, D1). A stock-out value is derived here, never passed in.
create or replace function public.stock_write_entry(
  p_doc public.stock_documents, p_line_id uuid, p_item uuid, p_wh uuid, p_qty_delta numeric,
  p_in_value numeric, p_project uuid, p_boq uuid, p_source_line uuid) returns numeric
  language plpgsql volatile security definer set search_path = public as $$
declare b public.stock_balances; v_out numeric; v_val numeric; v_dv numeric; v_item text; v_wh text;
begin
  select * into b from public.stock_balances x where x.item_id = p_item and x.warehouse_id = p_wh for update;
  if not found then raise exception 'STK_INVALID: balance row was not locked before writing' using errcode = 'P0001'; end if;
  if p_qty_delta < 0 then
    v_out := -p_qty_delta;
    if v_out > b.qty_on_hand then
      select i.code into v_item from public.stock_items i where i.id = p_item;
      select w.code into v_wh   from public.stock_warehouses w where w.id = p_wh;
      raise exception 'STK_INSUFFICIENT: item % at %: available %, requested %', v_item, v_wh, trim_scale(b.qty_on_hand)::text, trim_scale(v_out)::text
        using errcode = 'P0001', detail = jsonb_build_object('item', v_item, 'warehouse', v_wh,
          'available', trim_scale(b.qty_on_hand)::text, 'requested', trim_scale(v_out)::text)::text;
    end if;
    -- Multiply first, then divide: exact for q = Q. The explicit whole-remaining branch is belt and braces so FR-STK-030's
    -- "no residue" does not depend on numeric scale rules (it has no separate mutation case: the formula already returns V).
    v_val := case when v_out = b.qty_on_hand then b.value_on_hand
                  else round(v_out * b.value_on_hand / b.qty_on_hand, 2) end;                                  -- mut:avg
    v_dv := -v_val;
  else
    v_dv := p_in_value;
  end if;
  update public.stock_balances set qty_on_hand = b.qty_on_hand + p_qty_delta, value_on_hand = b.value_on_hand + v_dv, updated_at = now()
   where item_id = p_item and warehouse_id = p_wh;
  insert into public.stock_ledger (org_id, document_id, line_id, item_id, warehouse_id, project_id, boq_item_id, source_line_id, kind,
                                   qty_delta, value_delta, qty_after, value_after, occurred_on, posted_by)
  values (p_doc.org_id, p_doc.id, p_line_id, p_item, p_wh, p_project, p_boq, p_source_line, p_doc.kind,
          p_qty_delta, v_dv, b.qty_on_hand + p_qty_delta, b.value_on_hand + v_dv, p_doc.occurred_on, auth.uid());
  return v_dv;
end $$;

-- §3 payload validation and line insert ------------------------------------------------------------------
-- Static shape + parent-org checks shared by create and save. Raises the stable codes; touches nothing.
create or replace function public.stock_validate_payload(p_org uuid, p_kind text, p_header jsonb, p_lines jsonb) returns void
  language plpgsql stable security definer set search_path = public as $$
declare
  v_wh uuid := (p_header->>'warehouse_id')::uuid;
  v_to uuid := nullif(p_header->>'to_warehouse_id', '')::uuid;
  e jsonb; v_item record; v_q numeric; v_c numeric; v_cost numeric; v_dir text;
begin
  if p_kind is null or p_kind not in ('receive','transfer','issue','return','adjustment','count') then
    raise exception 'STK_INVALID: unknown document kind' using errcode = 'P0001'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 200 then
    raise exception 'STK_INVALID: a document needs 1 to 200 lines' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.stock_warehouses w where w.id = v_wh and w.org_id = p_org) then
    raise exception 'STK_NOT_FOUND: the warehouse is not in your organisation' using errcode = 'P0001'; end if;
  if p_kind = 'transfer' then
    if v_to is null or v_to = v_wh then raise exception 'STK_INVALID: a transfer needs a different destination warehouse' using errcode = 'P0001'; end if;
    if not exists (select 1 from public.stock_warehouses w where w.id = v_to and w.org_id = p_org) then          -- mut:xorg_dest
      raise exception 'STK_NOT_FOUND: the destination warehouse is not in your organisation' using errcode = 'P0001'; end if;
  elsif v_to is not null then
    raise exception 'STK_INVALID: only a transfer has a destination warehouse' using errcode = 'P0001'; end if;
  if exists (select 1 from public.stock_warehouses w where w.id in (v_wh, coalesce(v_to, v_wh)) and w.archived_at is not null) then
    raise exception 'STK_ARCHIVED: the warehouse is archived' using errcode = 'P0001'; end if;
  if nullif(p_header->>'procurement_id', '') is not null and p_kind <> 'receive' then
    raise exception 'STK_INVALID: only a receipt may cite a procurement case' using errcode = 'P0001'; end if;
  if p_kind not in ('issue','return') and nullif(p_header->>'project_id', '') is not null then
    raise exception 'STK_INVALID: only an issue or return names a project' using errcode = 'P0001'; end if;
  if p_kind = 'issue' and nullif(p_header->>'project_id', '') is null then
    raise exception 'STK_INVALID: an issue names a project' using errcode = 'P0001'; end if;
  if p_kind = 'adjustment' and nullif(btrim(p_header->>'reason'), '') is null then
    raise exception 'STK_INVALID: an adjustment needs a reason' using errcode = 'P0001'; end if;
  for e in select x from jsonb_array_elements(p_lines) as x loop
    select i.id, i.archived_at, u.whole_only into v_item
      from public.stock_items i join public.stock_units u on u.id = i.unit_id
     where i.id = (e->>'item_id')::uuid and i.org_id = p_org;
    if v_item.id is null then raise exception 'STK_NOT_FOUND: an item is not in your organisation' using errcode = 'P0001'; end if;
    if v_item.archived_at is not null then raise exception 'STK_ARCHIVED: an item is archived' using errcode = 'P0001'; end if;
    v_q := (e->>'quantity')::numeric;  v_c := (e->>'counted_quantity')::numeric;
    v_cost := (e->>'unit_cost')::numeric;  v_dir := e->>'direction';
    if p_kind = 'count' then
      if v_c is null or v_q is not null or v_c < 0 or v_c <> round(v_c, 3) or v_c >= 100000000000::numeric then
        raise exception 'STK_INVALID: a count line needs a counted quantity of 0 or more (3 decimals at most)' using errcode = 'P0001'; end if;
    else
      if v_q is null or v_c is not null or v_q <= 0 or v_q <> round(v_q, 3) or v_q >= 100000000000::numeric then
        raise exception 'STK_INVALID: a line needs a quantity above 0 (3 decimals at most)' using errcode = 'P0001'; end if;
    end if;
    if v_item.whole_only and coalesce(v_q, v_c) <> trunc(coalesce(v_q, v_c)) then
      raise exception 'STK_FRACTION: this item is counted in whole units' using errcode = 'P0001'; end if;
    if p_kind = 'receive' and (v_cost is null or v_cost < 0 or v_cost <> round(v_cost, 4)) then
      raise exception 'STK_INVALID: a receipt line needs a unit cost of 0 or more (4 decimals at most)' using errcode = 'P0001'; end if;
    if p_kind = 'count' and v_cost is not null and (v_cost < 0 or v_cost <> round(v_cost, 4)) then
      raise exception 'STK_INVALID: a unit cost is 0 or more (4 decimals at most)' using errcode = 'P0001'; end if;
    if p_kind = 'adjustment' and (coalesce(v_dir, '') not in ('in','out') or (v_cost is not null and (v_cost < 0 or v_cost <> round(v_cost, 4)))) then
      raise exception 'STK_INVALID: an adjustment line needs a direction (in or out)' using errcode = 'P0001'; end if;
    if v_cost is not null and (v_cost >= 10000000000::numeric or round(coalesce(v_q, v_c) * v_cost, 2) >= 1000000000000::numeric) then
      raise exception 'STK_INVALID: a unit cost or line value is too large' using errcode = 'P0001'; end if;   -- §5 precision, not a raw 22003
    if p_kind <> 'issue'  and nullif(e->>'boq_item_id', '')    is not null then raise exception 'STK_INVALID: only an issue line names a work item'   using errcode = 'P0001'; end if;
    if p_kind <> 'return' and nullif(e->>'source_line_id', '') is not null then raise exception 'STK_INVALID: only a return line cites an issue line' using errcode = 'P0001'; end if;
  end loop;
end $$;

-- Inserts the lines. PQ-3: a client cost is stored only where a cost is an input (receive; adjust-in; a count line that finds stock where the system has none) and ignored everywhere else.
create or replace function public.stock_insert_lines(p_doc public.stock_documents, p_lines jsonb) returns void
  language plpgsql volatile security definer set search_path = public as $$
begin
  insert into public.stock_document_lines (org_id, document_id, line_no, item_id, quantity, counted_quantity, direction, unit_cost, boq_item_id, source_line_id)
  select p_doc.org_id, p_doc.id, t.n::int, (t.e->>'item_id')::uuid,
         case when p_doc.kind <> 'count' then (t.e->>'quantity')::numeric end,
         case when p_doc.kind =  'count' then (t.e->>'counted_quantity')::numeric end,
         case when p_doc.kind = 'adjustment' then t.e->>'direction' end,
         case when p_doc.kind in ('receive','count') or (p_doc.kind = 'adjustment' and t.e->>'direction' = 'in') then (t.e->>'unit_cost')::numeric end,  -- mut:costignore
         case when p_doc.kind = 'issue'  then nullif(t.e->>'boq_item_id', '')::uuid end,
         case when p_doc.kind = 'return' then nullif(t.e->>'source_line_id', '')::uuid end
    from jsonb_array_elements(p_lines) with ordinality as t(e, n);
end $$;

-- §4 per-kind apply and the dispatcher (D2) -------------------------------------------------------------
create or replace function public.stock_apply_receive(p_doc public.stock_documents, p_post boolean) returns void
  language plpgsql volatile security definer set search_path = public as $$
declare l record;
begin
  if p_doc.procurement_id is not null
     and not exists (select 1 from public.procurements pr where pr.id = p_doc.procurement_id and pr.org_id = p_doc.org_id) then
    raise exception 'STK_NOT_FOUND: the procurement case is not in your organisation' using errcode = 'P0001';       -- AC-STK-029
  end if;
  if not p_post then return; end if;
  perform public.stock_lock_for_document(p_doc);
  for l in select * from public.stock_document_lines where document_id = p_doc.id order by line_no loop
    perform public.stock_write_entry(p_doc, l.id, l.item_id, p_doc.warehouse_id, l.quantity, round(l.quantity * l.unit_cost, 2), null, null, null);
  end loop;                                        -- the procurement case itself is never touched (OQ-STK-9, AC-STK-029)
end $$;

create or replace function public.stock_apply_transfer(p_doc public.stock_documents, p_post boolean) returns void
  language plpgsql volatile security definer set search_path = public as $$
declare l record; v_out numeric;
begin
  if not p_post then return; end if;
  perform public.stock_lock_for_document(p_doc);
  for l in select * from public.stock_document_lines where document_id = p_doc.id order by line_no loop
    v_out := public.stock_write_entry(p_doc, l.id, l.item_id, p_doc.warehouse_id, -l.quantity, null, null, null, null);   -- negative value
    perform public.stock_write_entry(p_doc, l.id, l.item_id, p_doc.to_warehouse_id, l.quantity, -v_out, null, null, null); -- mut:conserve
  end loop;
end $$;

-- Stubs (D2): S2b replaces issue and return, S4 replaces adjustment and count, each with `create or replace` of its own function only.
create or replace function public.stock_apply_issue(p_doc public.stock_documents, p_post boolean) returns void language plpgsql as $$
begin raise exception 'STK_KIND_UNAVAILABLE: issue posting is not enabled yet' using errcode = 'P0001'; end $$;
create or replace function public.stock_apply_return(p_doc public.stock_documents, p_post boolean) returns void language plpgsql as $$
begin raise exception 'STK_KIND_UNAVAILABLE: return posting is not enabled yet' using errcode = 'P0001'; end $$;
create or replace function public.stock_apply_adjustment(p_doc public.stock_documents, p_post boolean) returns void language plpgsql as $$
begin raise exception 'STK_KIND_UNAVAILABLE: adjustment posting is not enabled yet' using errcode = 'P0001'; end $$;
create or replace function public.stock_apply_count(p_doc public.stock_documents, p_post boolean) returns void language plpgsql as $$
begin raise exception 'STK_KIND_UNAVAILABLE: count posting is not enabled yet' using errcode = 'P0001'; end $$;

create or replace function public.stock_apply(p_doc public.stock_documents, p_post boolean) returns void
  language plpgsql volatile security definer set search_path = public as $$
begin
  case p_doc.kind
    when 'receive'    then perform public.stock_apply_receive(p_doc, p_post);
    when 'transfer'   then perform public.stock_apply_transfer(p_doc, p_post);
    when 'issue'      then perform public.stock_apply_issue(p_doc, p_post);
    when 'return'     then perform public.stock_apply_return(p_doc, p_post);
    when 'adjustment' then perform public.stock_apply_adjustment(p_doc, p_post);
    when 'count'      then perform public.stock_apply_count(p_doc, p_post);
  end case;
end $$;

-- §5 client RPCs and the ACL block -----------------------------------------------------------------------
create or replace function public.stock_post_core(p_document_id uuid) returns void
  language plpgsql volatile security definer set search_path = public as $$
declare d public.stock_documents; v_uid uuid := auth.uid(); v_override boolean := false;
begin
  select * into d from public.stock_documents x where x.id = p_document_id for update;                   -- lock order (1)
  if not found or d.org_id is distinct from public.auth_org_id() then
    raise exception 'STK_NOT_FOUND: the document is not in your organisation' using errcode = 'P0001'; end if;
  if d.status = 'Posted' then return; end if;                                                           -- replay-safe
  if d.status = 'Cancelled' then raise exception 'STK_IMMUTABLE: a cancelled document cannot be posted' using errcode = 'P0001'; end if;
  perform public.stock_assert_standalone(d.org_id);
  perform public.stock_assert_dates(d.org_id, d.occurred_on);
  if d.kind in ('receive','transfer','issue','return') then
    v_override := public.stock_assert_keeper(d.org_id, d.warehouse_id, v_uid);
  end if;
  if exists (select 1 from public.stock_warehouses w where w.id in (d.warehouse_id, coalesce(d.to_warehouse_id, d.warehouse_id)) and w.archived_at is not null)
     or exists (select 1 from public.stock_document_lines l join public.stock_items i on i.id = l.item_id where l.document_id = d.id and i.archived_at is not null) then
    raise exception 'STK_ARCHIVED: a warehouse or item on this document was archived' using errcode = 'P0001'; end if;
  perform public.stock_apply(d, true);
  update public.stock_documents set status = 'Posted', posted_by = v_uid, posted_at = now() where id = d.id;
  if v_override then
    perform public.log_audit('stock.admin_post', d.org_id, v_uid, d.id, jsonb_build_object('kind', d.kind, 'warehouse_id', d.warehouse_id, 'number', d.number));
  end if;
end $$;

create or replace function public.create_stock_document(p_header jsonb, p_lines jsonb, p_post boolean default false, p_client_request_id uuid default null)
  returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_org uuid; v_uid uuid := auth.uid(); v_kind text; v_wh uuid; v_occ date; v_doc public.stock_documents; v_id uuid; v_override boolean;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  if v_org is null then raise exception 'STK_NOT_FOUND: no organisation' using errcode = 'P0001'; end if;
  if p_client_request_id is not null then                                                               -- D7: replay returns the original
    select d.id into v_id from public.stock_documents d where d.org_id = v_org and d.created_by = v_uid and d.client_request_id = p_client_request_id;
    if v_id is not null then return v_id; end if;
  end if;
  if coalesce(p_post, false) then perform public.stock_assert_standalone(v_org); end if;                -- D6, before any write
  v_kind := p_header->>'kind';
  perform public.stock_validate_payload(v_org, v_kind, p_header, p_lines);
  v_wh := (p_header->>'warehouse_id')::uuid;
  v_override := public.stock_assert_keeper(v_org, v_wh, v_uid);                                         -- PQ-1: authors are keepers (or Admin)
  v_occ := coalesce(nullif(p_header->>'occurred_on', '')::date, public.stock_org_today(v_org));
  perform public.stock_assert_dates(v_org, v_occ);
  insert into public.stock_documents (org_id, number, kind, warehouse_id, to_warehouse_id, project_id, procurement_id, reason, note,
                                      occurred_on, client_request_id, created_by)
  values (v_org, public.next_procurement_doc_number(v_org, public.stock_doc_prefix(v_kind)), v_kind, v_wh,
          nullif(p_header->>'to_warehouse_id', '')::uuid, case when v_kind = 'issue' then nullif(p_header->>'project_id', '')::uuid end,
          nullif(p_header->>'procurement_id', '')::uuid, nullif(btrim(p_header->>'reason'), ''), nullif(btrim(p_header->>'note'), ''),
          v_occ, p_client_request_id, v_uid)
  on conflict (org_id, created_by, client_request_id) where client_request_id is not null do nothing
  returning * into v_doc;
  if v_doc.id is null then                                                                               -- lost a race to a concurrent replay
    select d.id into v_id from public.stock_documents d where d.org_id = v_org and d.created_by = v_uid and d.client_request_id = p_client_request_id;
    return v_id;
  end if;
  perform public.stock_insert_lines(v_doc, p_lines);
  perform public.stock_apply(v_doc, false);                                                              -- static validation per kind
  if coalesce(p_post, false) then perform public.stock_post_core(v_doc.id);                              -- a post audits its own override
  elsif v_override then
    perform public.log_audit('stock.admin_author', v_org, v_uid, v_doc.id, jsonb_build_object('kind', v_kind, 'warehouse_id', v_wh, 'number', v_doc.number));
  end if;
  return v_doc.id;
end $$;

create or replace function public.save_stock_draft(p_document_id uuid, p_header jsonb, p_lines jsonb) returns void
  language plpgsql volatile security definer set search_path = public as $$
declare v_org uuid; v_uid uuid := auth.uid(); d public.stock_documents; v_occ date;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  select * into d from public.stock_documents x where x.id = p_document_id and x.org_id = v_org for update;
  if not found then raise exception 'STK_NOT_FOUND: the document is not in your organisation' using errcode = 'P0001'; end if;
  if d.status <> 'Draft' then raise exception 'STK_IMMUTABLE: only a draft can be edited' using errcode = 'P0001'; end if;
  if d.created_by <> v_uid then raise exception 'only the author edits a draft' using errcode = '42501'; end if;
  if coalesce(p_header->>'kind', d.kind) <> d.kind then raise exception 'STK_INVALID: a document''s kind cannot change' using errcode = 'P0001'; end if;
  perform public.stock_validate_payload(v_org, d.kind, p_header, p_lines);
  if public.stock_assert_keeper(v_org, (p_header->>'warehouse_id')::uuid, v_uid) then
    perform public.log_audit('stock.admin_author', v_org, v_uid, d.id, jsonb_build_object('kind', d.kind, 'warehouse_id', p_header->>'warehouse_id', 'number', d.number));
  end if;
  v_occ := coalesce(nullif(p_header->>'occurred_on', '')::date, d.occurred_on);
  perform public.stock_assert_dates(v_org, v_occ);
  update public.stock_documents set warehouse_id = (p_header->>'warehouse_id')::uuid, to_warehouse_id = nullif(p_header->>'to_warehouse_id', '')::uuid,
         project_id = case when d.kind = 'issue' then nullif(p_header->>'project_id', '')::uuid else d.project_id end, procurement_id = nullif(p_header->>'procurement_id', '')::uuid,
         reason = nullif(btrim(p_header->>'reason'), ''), note = nullif(btrim(p_header->>'note'), ''), occurred_on = v_occ
   where id = d.id returning * into d;
  delete from public.stock_document_lines where document_id = d.id;
  perform public.stock_insert_lines(d, p_lines);
  perform public.stock_apply(d, false);
end $$;

create or replace function public.post_stock_document(p_document_id uuid) returns uuid
  language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.assert_is_active_member();
  perform public.stock_post_core(p_document_id);
  return p_document_id;
end $$;

create or replace function public.cancel_stock_document(p_document_id uuid) returns void
  language plpgsql volatile security definer set search_path = public as $$
declare d public.stock_documents; v_uid uuid := auth.uid();
begin
  perform public.assert_is_active_member();
  select * into d from public.stock_documents x where x.id = p_document_id and x.org_id = public.auth_org_id() for update;
  if not found then raise exception 'STK_NOT_FOUND: the document is not in your organisation' using errcode = 'P0001'; end if;
  if d.status <> 'Draft' then raise exception 'STK_IMMUTABLE: a posted or cancelled document cannot be cancelled' using errcode = 'P0001'; end if;
  if d.created_by <> v_uid and not coalesce(public.role_rank(public.auth_role()) >= 50, false) then
    raise exception 'only the author or an Admin cancels a draft' using errcode = '42501'; end if;
  update public.stock_documents set status = 'Cancelled', cancelled_by = v_uid, cancelled_at = now() where id = d.id;
end $$;

-- ACL (hosted grants lesson). Internals: nobody. Client RPCs: authenticated only.
revoke all on function
  public.stock_doc_prefix(text), public.stock_org_today(uuid), public.stock_assert_standalone(uuid), public.stock_assert_keeper(uuid, uuid, uuid),
  public.stock_assert_dates(uuid, date), public.stock_lock_for_document(public.stock_documents),
  public.stock_write_entry(public.stock_documents, uuid, uuid, uuid, numeric, numeric, uuid, uuid, uuid),
  public.stock_validate_payload(uuid, text, jsonb, jsonb), public.stock_insert_lines(public.stock_documents, jsonb),
  public.stock_apply_receive(public.stock_documents, boolean), public.stock_apply_transfer(public.stock_documents, boolean),
  public.stock_apply_issue(public.stock_documents, boolean), public.stock_apply_return(public.stock_documents, boolean),
  public.stock_apply_adjustment(public.stock_documents, boolean), public.stock_apply_count(public.stock_documents, boolean),
  public.stock_apply(public.stock_documents, boolean), public.stock_post_core(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.create_stock_document(jsonb, jsonb, boolean, uuid), public.save_stock_draft(uuid, jsonb, jsonb),
  public.post_stock_document(uuid), public.cancel_stock_document(uuid) from public, anon;
grant execute on function public.create_stock_document(jsonb, jsonb, boolean, uuid), public.save_stock_draft(uuid, jsonb, jsonb),
  public.post_stock_document(uuid), public.cancel_stock_document(uuid) to authenticated;
