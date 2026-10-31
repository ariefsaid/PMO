-- 0416_stock_adjust_count.sql - #1512 S4: Adjustment and Count posting and the two-person write-off (FR-STK-024, 025, 062).
-- Replaces ONLY the two S2a stubs (stock_apply_adjustment, stock_apply_count); the dispatcher, the RPCs and every table are untouched (D2).
-- Plan docs/plans/2026-10-31-inventory-project-consumption.md (S4) · ADR-0097.
-- Reversal: supabase/migrations/rollback/0416_stock_adjust_count_down.sql (restores the stubs).

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
