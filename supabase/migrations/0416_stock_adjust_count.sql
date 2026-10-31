-- 0416_stock_adjust_count.sql - #1512 S4: Adjustment and Count posting and the two-person write-off (FR-STK-024, 025, 062).
-- Replaces the two S2a stubs (stock_apply_adjustment, stock_apply_count). Fix round: a document revision the approver pins
-- (post_stock_document gains p_expected_revision), save_stock_draft keeps a stored unit cost, and a rank-gated line-cost read.
-- Plan docs/plans/2026-10-31-inventory-project-consumption.md (S4) · ADR-0097.
-- Reversal: supabase/migrations/rollback/0416_stock_adjust_count_down.sql (restores the stubs and the 0413 RPCs).

-- FR-STK-062: a write-off is posted by someone who is NOT its author and has rank >= 20 (ADR-0070). Admin gets no exemption (OD-PROC-8).
-- PQ-1: the poster of an Adjustment / Count needs no keeper role (a PM may approve a write-off on a site they do not keep).
create or replace function public.stock_assert_writeoff_approver(p_doc public.stock_documents, p_uid uuid) returns void
  language plpgsql stable security definer set search_path = public as $$
declare v_self_ok boolean; v_rank_ok boolean;
begin
  v_self_ok := p_doc.created_by is distinct from p_uid;                                                   -- mut:selfapprove
  if not v_self_ok then raise exception 'STK_SELF_APPROVE: a write-off must be posted by someone other than its author' using errcode = 'P0001'; end if;
  v_rank_ok := coalesce(public.role_rank(public.auth_role()) >= 20, false);                               -- mut:writeoff_rank
  if not v_rank_ok then raise exception 'STK_RANK: only a Project Manager or above posts a write-off' using errcode = 'P0001'; end if;
end $$;

-- FR-STK-024: out at the moving average (derived in stock_write_entry); in at the line's cost, else the moving average.
create or replace function public.stock_apply_adjustment(p_doc public.stock_documents, p_post boolean) returns void
  language plpgsql volatile security definer set search_path = public as $$
declare l record; b public.stock_balances; v_in numeric;
begin
  if not p_post then return; end if;                    -- reason, direction, cost and quantity shape were checked by stock_validate_payload
  perform public.stock_assert_writeoff_approver(p_doc, auth.uid());                 -- mut:adj_approver (an adjustment is always a non-zero change)
  perform public.stock_lock_for_document(p_doc);
  for l in select * from public.stock_document_lines where document_id = p_doc.id order by line_no loop
    if l.direction = 'out' then
      perform public.stock_write_entry(p_doc, l.id, l.item_id, p_doc.warehouse_id, -l.quantity, null, null, null, null);
    else
      select * into b from public.stock_balances x where x.item_id = l.item_id and x.warehouse_id = p_doc.warehouse_id;
      v_in := case when l.unit_cost is not null then round(l.quantity * l.unit_cost, 2)
                   when b.qty_on_hand > 0 then round(l.quantity * b.value_on_hand / b.qty_on_hand, 2) end;   -- mut:adj_avg
      if v_in is null then raise exception 'STK_INVALID: adjusting stock in where none is on hand needs a unit cost' using errcode = 'P0001'; end if;   -- mut:adj_nocost
      perform public.stock_write_entry(p_doc, l.id, l.item_id, p_doc.warehouse_id, l.quantity, v_in, null, null, null);
    end if;
  end loop;
end $$;

-- FR-STK-025: stamp the system quantity, post each line's variance (nothing for zero). The variance is read under the
-- balance locks and re-read in the second loop, so a movement between check and write cannot turn a "zero-variance"
-- author post into a non-zero write: every writer takes the same locks.
create or replace function public.stock_apply_count(p_doc public.stock_documents, p_post boolean) returns void
  language plpgsql volatile security definer set search_path = public as $$
declare l record; b public.stock_balances; v_var numeric; v_any boolean := false; v_in numeric;
begin
  if exists (select 1 from public.stock_document_lines x where x.document_id = p_doc.id group by x.item_id having count(*) > 1) then
    raise exception 'STK_INVALID: an item appears once per count' using errcode = 'P0001'; end if;
  if not p_post then return; end if;
  perform public.stock_lock_for_document(p_doc);                            -- balances locked BEFORE the variance is read
  for l in select * from public.stock_document_lines where document_id = p_doc.id order by line_no loop
    select * into b from public.stock_balances x where x.item_id = l.item_id and x.warehouse_id = p_doc.warehouse_id;
    update public.stock_document_lines set expected_quantity = b.qty_on_hand where id = l.id;          -- stamped while the document is still a Draft
    if l.counted_quantity <> b.qty_on_hand then v_any := true; end if;                                 -- mut:variance
  end loop;
  if v_any then perform public.stock_assert_writeoff_approver(p_doc, auth.uid()); end if;
  for l in select * from public.stock_document_lines where document_id = p_doc.id order by line_no loop
    select * into b from public.stock_balances x where x.item_id = l.item_id and x.warehouse_id = p_doc.warehouse_id;
    v_var := l.counted_quantity - b.qty_on_hand;
    if v_var < 0 then
      perform public.stock_write_entry(p_doc, l.id, l.item_id, p_doc.warehouse_id, v_var, null, null, null, null);
    elsif v_var > 0 then
      v_in := case when b.qty_on_hand > 0 then round(v_var * b.value_on_hand / b.qty_on_hand, 2)       -- mut:count_avg
                   when l.unit_cost is not null then round(v_var * l.unit_cost, 2) end;
      if v_in is null then raise exception 'STK_INVALID: finding stock where the system has none needs a unit cost' using errcode = 'P0001'; end if;   -- mut:count_nocost
      perform public.stock_write_entry(p_doc, l.id, l.item_id, p_doc.warehouse_id, v_var, v_in, null, null, null);
    end if;                                                                                            -- zero variance: nothing is posted
  end loop;
end $$;

revoke all on function public.stock_assert_writeoff_approver(public.stock_documents, uuid),
  public.stock_apply_adjustment(public.stock_documents, boolean), public.stock_apply_count(public.stock_documents, boolean)
  from public, anon, authenticated, service_role;

-- §2 approve what you saw (FR-STK-062). Every save of a Draft bumps its revision; the approver of an adjustment or a count
-- posts with the revision they reviewed, and a draft the author changed since is refused (STK_STALE), not posted.
alter table public.stock_documents add column revision integer not null default 1;

-- 0413's save_stock_draft plus: the revision bump, and a stored unit cost kept when the re-saved line omits it (the cost is
-- not client-readable below rank 20, so a reopened form cannot send it back). Matched on item + direction.
create or replace function public.save_stock_draft(p_document_id uuid, p_header jsonb, p_lines jsonb) returns void
  language plpgsql volatile security definer set search_path = public as $$
declare v_org uuid; v_uid uuid := auth.uid(); d public.stock_documents; v_occ date; v_old jsonb;
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
         reason = nullif(btrim(p_header->>'reason'), ''), note = nullif(btrim(p_header->>'note'), ''), occurred_on = v_occ,
         revision = d.revision + 1                                                                                   -- mut:revision
   where id = d.id returning * into d;
  select coalesce(jsonb_agg(o), '[]'::jsonb) into v_old from (
    select distinct on (l.item_id, l.direction) l.item_id, l.direction, l.unit_cost from public.stock_document_lines l
     where l.document_id = d.id and l.unit_cost is not null order by l.item_id, l.direction, l.line_no) o;
  delete from public.stock_document_lines where document_id = d.id;
  perform public.stock_insert_lines(d, p_lines);
  if d.kind in ('adjustment','count') then
    update public.stock_document_lines n set unit_cost = (o->>'unit_cost')::numeric                                 -- mut:keepcost
      from jsonb_array_elements(v_old) o
     where n.document_id = d.id and n.unit_cost is null and n.item_id = (o->>'item_id')::uuid
       and n.direction is not distinct from (o->>'direction') and (d.kind = 'count' or n.direction = 'in');
  end if;
  perform public.stock_apply(d, false);
end $$;

drop function public.post_stock_document(uuid);
create function public.post_stock_document(p_document_id uuid, p_expected_revision integer default null) returns uuid
  language plpgsql volatile security definer set search_path = public as $$
declare d public.stock_documents; v_fresh boolean;
begin
  perform public.assert_is_active_member();
  select * into d from public.stock_documents x where x.id = p_document_id and x.org_id = public.auth_org_id() for update;   -- lock order (1)
  if found and d.status = 'Draft' and d.kind in ('adjustment','count') then
    v_fresh := p_expected_revision is not distinct from d.revision;                                                -- mut:stale
    if not v_fresh then raise exception 'STK_STALE: this draft changed since you opened it; review it again' using errcode = 'P0001'; end if;
  end if;
  perform public.stock_post_core(p_document_id);                      -- refuses a missing or other-org document itself
  return p_document_id;
end $$;
revoke all on function public.post_stock_document(uuid, integer) from public, anon;
grant execute on function public.post_stock_document(uuid, integer) to authenticated;

-- FR-STK-063: line unit costs of one document, for the approver. `has_cost` for everyone; the cost itself at rank >= 20 only.
create or replace function public.get_stock_document_costs(p_document_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare v_cost boolean;
begin
  perform public.assert_is_active_member();
  v_cost := public.stock_can_see_cost();                                                                         -- mut:doc_cost
  return (select coalesce(jsonb_agg(jsonb_build_object('line_id', l.id, 'has_cost', l.unit_cost is not null)
                 || case when v_cost and l.unit_cost is not null then jsonb_build_object('unit_cost', l.unit_cost::text) else '{}'::jsonb end
                 order by l.line_no), '[]'::jsonb)
            from public.stock_document_lines l join public.stock_documents d on d.id = l.document_id
           where d.id = p_document_id and d.org_id = public.auth_org_id());
end $$;
revoke all on function public.get_stock_document_costs(uuid) from public, anon;
grant execute on function public.get_stock_document_costs(uuid) to authenticated;
