-- 0951_work_order_cost_attribution.sql — #2517: every cost source can name an optional work order and an optional
-- discipline. ADR-0103; spec docs/specs/work-order-cost-attribution.spec.md; plan
-- docs/plans/2026-11-20-work-order-cost-attribution.md. Proven by supabase/tests/0950_work_order_cost_attribution.test.sql.
--
-- What this adds, and what it deliberately does not touch:
--   §1 two nullable columns (work_order_id, discipline_id) on the seven cost sources: purchase_requests,
--      purchase_orders, procurement_receipts, procurement_invoices, timesheet_entries, stock_documents,
--      equipment_usage_entries.
--   §2 ONE rule trigger (check_cost_attribution) on all seven: a work order must be on the cost's OWN project and
--      org; a discipline must be the cost's org's. It guards every writer, the definers included.
--   §3 a purchase cannot move to another project while one of its records names a work order of the old project.
--   §4 a posted stock document stays immutable EXCEPT its two attribution columns.
--   §5 ONE write path for people: set_cost_attribution(source, ids, work_order, discipline).
--   §6 ONE read seam: the security_invoker view work_order_cost_lines (RLS of each source applies).
-- No status transition, approval, posting, outbox command or money figure changes; no create RPC is redefined.
-- Project totals never read these columns, so they are unchanged (the pgTAP file proves it).
--
-- ── REVERSE (also supabase/migrations/rollback/0951_work_order_cost_attribution_down.sql) ────────────
--   drop view if exists public.work_order_cost_lines;
--   drop function if exists public.set_cost_attribution(text, uuid[], uuid, uuid);
--   restore 0413's guard_stock_document_immutable body;
--   drop trigger if exists a0_procurements_work_order_move_guard on public.procurements;
--   drop function if exists public.guard_procurement_move_with_work_orders();
--   drop trigger if exists zz_cost_attribution_check on each of the seven tables;
--   drop function if exists public.check_cost_attribution();
--   alter table <each of the seven> drop column if exists work_order_id, drop column if exists discipline_id;

-- ── §1 columns + indexes ──────────────────────────────────────────────────────────────────────────────
alter table public.purchase_requests
  add column work_order_id uuid references public.work_orders(id),
  add column discipline_id uuid references public.cost_disciplines(id);
alter table public.purchase_orders
  add column work_order_id uuid references public.work_orders(id),
  add column discipline_id uuid references public.cost_disciplines(id);
alter table public.procurement_receipts
  add column work_order_id uuid references public.work_orders(id),
  add column discipline_id uuid references public.cost_disciplines(id);
alter table public.procurement_invoices
  add column work_order_id uuid references public.work_orders(id),
  add column discipline_id uuid references public.cost_disciplines(id);
alter table public.timesheet_entries
  add column work_order_id uuid references public.work_orders(id),
  add column discipline_id uuid references public.cost_disciplines(id);
alter table public.stock_documents
  add column work_order_id uuid references public.work_orders(id),
  add column discipline_id uuid references public.cost_disciplines(id);
alter table public.equipment_usage_entries
  add column work_order_id uuid references public.work_orders(id),
  add column discipline_id uuid references public.cost_disciplines(id);

create index purchase_requests_work_order_idx       on public.purchase_requests (work_order_id)       where work_order_id is not null;
create index purchase_orders_work_order_idx         on public.purchase_orders (work_order_id)         where work_order_id is not null;
create index procurement_receipts_work_order_idx    on public.procurement_receipts (work_order_id)    where work_order_id is not null;
create index procurement_invoices_work_order_idx    on public.procurement_invoices (work_order_id)    where work_order_id is not null;
create index timesheet_entries_work_order_idx       on public.timesheet_entries (work_order_id)       where work_order_id is not null;
create index stock_documents_work_order_idx         on public.stock_documents (work_order_id)         where work_order_id is not null;
create index equipment_usage_entries_work_order_idx on public.equipment_usage_entries (work_order_id) where work_order_id is not null;
create index purchase_requests_discipline_idx       on public.purchase_requests (discipline_id)       where discipline_id is not null;
create index purchase_orders_discipline_idx         on public.purchase_orders (discipline_id)         where discipline_id is not null;
create index procurement_receipts_discipline_idx    on public.procurement_receipts (discipline_id)    where discipline_id is not null;
create index procurement_invoices_discipline_idx    on public.procurement_invoices (discipline_id)    where discipline_id is not null;
create index timesheet_entries_discipline_idx       on public.timesheet_entries (discipline_id)       where discipline_id is not null;
create index stock_documents_discipline_idx         on public.stock_documents (discipline_id)         where discipline_id is not null;
create index equipment_usage_entries_discipline_idx on public.equipment_usage_entries (discipline_id) where discipline_id is not null;

-- ── §2 the rule (FR-WCA-020..024) ─────────────────────────────────────────────────────────────────────
-- The cost's project: its own project_id (timesheet line, equipment usage, stock issue/return); the destination
-- site warehouse's project (stock transfer — "moves to the work order's site"); the purchase's project (the four
-- purchase records). Any other stock kind (receive, adjustment, count) has no project, so it cannot name a work order.
-- Definer: it must read work_orders / procurements / warehouses whatever the caller's RLS. Never client-callable.
create function public.check_cost_attribution() returns trigger
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
           where w.id = new.to_warehouse_id and w.org_id = new.org_id and w.kind = 'site';
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

create trigger zz_cost_attribution_check before insert or update of work_order_id, discipline_id, procurement_id
  on public.purchase_requests for each row execute function public.check_cost_attribution();
create trigger zz_cost_attribution_check before insert or update of work_order_id, discipline_id, procurement_id
  on public.purchase_orders for each row execute function public.check_cost_attribution();
create trigger zz_cost_attribution_check before insert or update of work_order_id, discipline_id, procurement_id
  on public.procurement_receipts for each row execute function public.check_cost_attribution();
create trigger zz_cost_attribution_check before insert or update of work_order_id, discipline_id, procurement_id
  on public.procurement_invoices for each row execute function public.check_cost_attribution();
create trigger zz_cost_attribution_check before insert or update of work_order_id, discipline_id, project_id
  on public.timesheet_entries for each row execute function public.check_cost_attribution();
create trigger zz_cost_attribution_check before insert or update of work_order_id, discipline_id, project_id
  on public.equipment_usage_entries for each row execute function public.check_cost_attribution();
create trigger zz_cost_attribution_check before insert or update of work_order_id, discipline_id, project_id, kind, to_warehouse_id
  on public.stock_documents for each row execute function public.check_cost_attribution();

-- ── §3 a purchase keeps its records' work orders on its project (FR-WCA-023) ─────────────────────────
-- Same shape as 0699's journal-line move guard: refuse, name the way out.
create function public.guard_procurement_move_with_work_orders() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.project_id is distinct from old.project_id and exists (
       select 1 from (
         select work_order_id from public.purchase_requests    where procurement_id = new.id and work_order_id is not null
         union all
         select work_order_id from public.purchase_orders      where procurement_id = new.id and work_order_id is not null
         union all
         select work_order_id from public.procurement_receipts where procurement_id = new.id and work_order_id is not null
         union all
         select work_order_id from public.procurement_invoices where procurement_id = new.id and work_order_id is not null
       ) r join public.work_orders w on w.id = r.work_order_id
       where w.project_id is distinct from new.project_id) then
    raise exception 'COST_WO_PROJECT_MOVE: records of this purchase name a work order of its project. Clear their work orders before moving the purchase.'
      using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.guard_procurement_move_with_work_orders() from public, anon, authenticated;
create trigger a0_procurements_work_order_move_guard before update of project_id on public.procurements
  for each row execute function public.guard_procurement_move_with_work_orders();

-- ── §4 a posted stock document: only its attribution may change (FR-WCA-031) ──────────────────────────
-- 0413's body, plus one exemption: an UPDATE whose only changed columns are work_order_id / discipline_id.
-- Quantities, values and the ledger stay untouched — the ledger row is keyed to the document, not to these columns.
create or replace function public.guard_stock_document_immutable() returns trigger
  language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'Draft' then raise exception 'STK_IMMUTABLE: a posted or cancelled document cannot be deleted' using errcode = 'P0001'; end if;
    return old;
  end if;
  if old.status <> 'Draft' then
    if (to_jsonb(new) - 'work_order_id' - 'discipline_id') = (to_jsonb(old) - 'work_order_id' - 'discipline_id') then
      return new;
    end if;
    raise exception 'STK_IMMUTABLE: a posted or cancelled document cannot be changed' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.guard_stock_document_immutable() from public, anon, authenticated;

-- ── §5 set_cost_attribution (FR-WCA-030..034) ─────────────────────────────────────────────────────────
-- Sets BOTH columns on 1..500 records of one source (null clears). Who may:
--   Admin, Executive, Finance, Project Manager: any record of their org, any status (a correction is audited);
--   anyone else: only their own records, and only while the record is still editable —
--     timesheet line: own sheet in Draft · equipment usage: own entry in Draft/Rejected, not archived ·
--     stock document: created by them (a movement posts on create, so its author attributes it right after) ·
--     purchase records: a purchase they requested.
-- The §2 trigger decides whether the work order and discipline are allowed; existing record guards (record-only
-- purchase, voided bill, …) still apply, so a locked record stays locked.
create function public.set_cost_attribution(p_source text, p_ids uuid[], p_work_order_id uuid, p_discipline_id uuid)
  returns integer
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_uid uuid := auth.uid();
  v_role public.user_role := public.auth_role();
  v_priv boolean;
  v_ids uuid[];
  v_found int;
  v_allowed int;
  v_before jsonb;
  v_n int;
begin
  perform public.assert_is_active_member();
  if v_uid is null or v_org is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_source is null or p_source not in ('purchase_request', 'purchase_order', 'goods_receipt', 'vendor_bill',
                                          'timesheet_entry', 'stock_document', 'equipment_usage') then
    raise exception 'unknown cost source' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct i), '{}') into v_ids from unnest(coalesce(p_ids, '{}')) i where i is not null;
  if cardinality(v_ids) = 0 or cardinality(v_ids) > 500 then
    raise exception 'name between 1 and 500 records' using errcode = '22023';
  end if;
  v_priv := v_role in ('Admin', 'Executive', 'Finance', 'Project Manager');

  -- Lock the rows, count those in the caller's org, and count those the caller may change.
  case p_source
    when 'purchase_request' then
      perform 1 from public.purchase_requests r where r.id = any(v_ids) and r.org_id = v_org for update of r;
      select count(*), count(*) filter (where v_priv or p.requested_by_id = v_uid),
             jsonb_agg(jsonb_build_object('id', r.id, 'work_order_id', r.work_order_id, 'discipline_id', r.discipline_id))
        into v_found, v_allowed, v_before
        from public.purchase_requests r join public.procurements p on p.id = r.procurement_id
       where r.id = any(v_ids) and r.org_id = v_org;
    when 'purchase_order' then
      perform 1 from public.purchase_orders r where r.id = any(v_ids) and r.org_id = v_org for update of r;
      select count(*), count(*) filter (where v_priv or p.requested_by_id = v_uid),
             jsonb_agg(jsonb_build_object('id', r.id, 'work_order_id', r.work_order_id, 'discipline_id', r.discipline_id))
        into v_found, v_allowed, v_before
        from public.purchase_orders r join public.procurements p on p.id = r.procurement_id
       where r.id = any(v_ids) and r.org_id = v_org;
    when 'goods_receipt' then
      perform 1 from public.procurement_receipts r where r.id = any(v_ids) and r.org_id = v_org for update of r;
      select count(*), count(*) filter (where v_priv or p.requested_by_id = v_uid),
             jsonb_agg(jsonb_build_object('id', r.id, 'work_order_id', r.work_order_id, 'discipline_id', r.discipline_id))
        into v_found, v_allowed, v_before
        from public.procurement_receipts r join public.procurements p on p.id = r.procurement_id
       where r.id = any(v_ids) and r.org_id = v_org;
    when 'vendor_bill' then
      perform 1 from public.procurement_invoices r where r.id = any(v_ids) and r.org_id = v_org for update of r;
      select count(*), count(*) filter (where v_priv or p.requested_by_id = v_uid),
             jsonb_agg(jsonb_build_object('id', r.id, 'work_order_id', r.work_order_id, 'discipline_id', r.discipline_id))
        into v_found, v_allowed, v_before
        from public.procurement_invoices r join public.procurements p on p.id = r.procurement_id
       where r.id = any(v_ids) and r.org_id = v_org;
    when 'timesheet_entry' then
      perform 1 from public.timesheet_entries e where e.id = any(v_ids) and e.org_id = v_org for update of e;
      select count(*), count(*) filter (where v_priv or (t.user_id = v_uid and t.status = 'Draft')),
             jsonb_agg(jsonb_build_object('id', e.id, 'work_order_id', e.work_order_id, 'discipline_id', e.discipline_id))
        into v_found, v_allowed, v_before
        from public.timesheet_entries e join public.timesheets t on t.id = e.timesheet_id
       where e.id = any(v_ids) and e.org_id = v_org;
    when 'stock_document' then
      perform 1 from public.stock_documents d where d.id = any(v_ids) and d.org_id = v_org for update of d;
      select count(*), count(*) filter (where v_priv or d.created_by = v_uid),
             jsonb_agg(jsonb_build_object('id', d.id, 'work_order_id', d.work_order_id, 'discipline_id', d.discipline_id))
        into v_found, v_allowed, v_before
        from public.stock_documents d
       where d.id = any(v_ids) and d.org_id = v_org;
    when 'equipment_usage' then
      perform 1 from public.equipment_usage_entries u where u.id = any(v_ids) and u.org_id = v_org for update of u;
      select count(*), count(*) filter (where v_priv or (u.author_id = v_uid and u.status in ('Draft', 'Rejected') and u.archived_at is null)),
             jsonb_agg(jsonb_build_object('id', u.id, 'work_order_id', u.work_order_id, 'discipline_id', u.discipline_id))
        into v_found, v_allowed, v_before
        from public.equipment_usage_entries u
       where u.id = any(v_ids) and u.org_id = v_org;
  end case;

  if v_found <> cardinality(v_ids) then
    raise exception 'record not found' using errcode = 'P0002';   -- SECURITY: another org's id reads as absent
  end if;
  if v_allowed <> v_found then
    raise exception 'you cannot change the work order or discipline of this record' using errcode = '42501';
  end if;

  case p_source
    when 'purchase_request' then update public.purchase_requests set work_order_id = p_work_order_id, discipline_id = p_discipline_id where id = any(v_ids);
    when 'purchase_order'   then update public.purchase_orders   set work_order_id = p_work_order_id, discipline_id = p_discipline_id where id = any(v_ids);
    when 'goods_receipt'    then update public.procurement_receipts set work_order_id = p_work_order_id, discipline_id = p_discipline_id where id = any(v_ids);
    when 'vendor_bill'      then update public.procurement_invoices set work_order_id = p_work_order_id, discipline_id = p_discipline_id where id = any(v_ids);
    when 'timesheet_entry'  then update public.timesheet_entries set work_order_id = p_work_order_id, discipline_id = p_discipline_id where id = any(v_ids);
    when 'stock_document'   then update public.stock_documents   set work_order_id = p_work_order_id, discipline_id = p_discipline_id where id = any(v_ids);
    when 'equipment_usage'  then update public.equipment_usage_entries set work_order_id = p_work_order_id, discipline_id = p_discipline_id where id = any(v_ids);
  end case;
  get diagnostics v_n = row_count;

  -- One audit row per record, carrying what it named before.
  perform public.log_audit('cost_attribution.set', v_org, v_uid, (b->>'id')::uuid,
            jsonb_build_object('source', p_source, 'before', b - 'id',
                               'after', jsonb_build_object('work_order_id', p_work_order_id, 'discipline_id', p_discipline_id)))
     from jsonb_array_elements(v_before) b;
  return v_n;
end $$;
revoke all on function public.set_cost_attribution(text, uuid[], uuid, uuid) from public, anon;
grant execute on function public.set_cost_attribution(text, uuid[], uuid, uuid) to authenticated;

-- ── §6 the read seam (FR-WCA-040) ─────────────────────────────────────────────────────────────────────
-- One row per attributed-or-not cost record, by source. security_invoker: each source's own RLS decides what the
-- caller sees (an Engineer sees only their own timesheet lines, a foreign org sees nothing). Money is NOT here:
-- each source's money stays behind its own read (purchase money roles, stock value RPCs); #2519 adds plan vs actual.
create view public.work_order_cost_lines with (security_invoker = true) as
  select 'purchase_request'::text as source, r.id as record_id, r.org_id, p.project_id, r.work_order_id, r.discipline_id,
         r.date as occurred_on, coalesce(r.pr_number, r.reference_number) as reference,
         null::numeric as quantity, null::text as quantity_unit
    from public.purchase_requests r join public.procurements p on p.id = r.procurement_id
  union all
  select 'purchase_order', r.id, r.org_id, p.project_id, r.work_order_id, r.discipline_id,
         r.date, coalesce(r.po_number, r.reference_number), null, null
    from public.purchase_orders r join public.procurements p on p.id = r.procurement_id
  union all
  select 'goods_receipt', r.id, r.org_id, p.project_id, r.work_order_id, r.discipline_id,
         r.receipt_date, r.gr_number, null, null
    from public.procurement_receipts r join public.procurements p on p.id = r.procurement_id
  union all
  select 'vendor_bill', r.id, r.org_id, p.project_id, r.work_order_id, r.discipline_id,
         r.invoice_date, r.vi_number, null, null
    from public.procurement_invoices r join public.procurements p on p.id = r.procurement_id
  union all
  select 'timesheet_entry', e.id, e.org_id, e.project_id, e.work_order_id, e.discipline_id,
         e.entry_date, null, e.hours, 'hours'
    from public.timesheet_entries e
  union all
  select 'stock_document', d.id, d.org_id,
         case when d.kind = 'transfer' then w.project_id else d.project_id end, d.work_order_id, d.discipline_id,
         d.occurred_on, d.number, null, null
    from public.stock_documents d left join public.stock_warehouses w on w.id = d.to_warehouse_id
   where d.kind in ('issue', 'return', 'transfer')
  union all
  select 'equipment_usage', u.id, u.org_id, u.project_id, u.work_order_id, u.discipline_id,
         u.work_date, null, u.quantity, u.unit
    from public.equipment_usage_entries u
   where u.archived_at is null;
revoke all on public.work_order_cost_lines from public, anon, authenticated;
grant select on public.work_order_cost_lines to authenticated;
