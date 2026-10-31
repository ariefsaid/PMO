-- 0414_stock_out_flows.sql - #1512 S2b: Issue and Return posting (FR-STK-022, 023, 014, 017). Replaces ONLY the two S2a stubs
-- (stock_apply_issue, stock_apply_return); the dispatcher, the RPCs and every table are untouched (D2).
-- Plan docs/plans/2026-10-31-inventory-project-consumption.md (S2b) · ADR-0097.
-- Reversal: supabase/migrations/rollback/0414_stock_out_flows_down.sql (restores the stubs).

create or replace function public.stock_apply_issue(p_doc public.stock_documents, p_post boolean) returns void
  language plpgsql volatile security definer set search_path = public as $$
declare l record; v_status text; v_archived timestamptz; v_found boolean; v_active boolean; v_boq_ok boolean;
begin
  select p.status::text, p.archived_at, true into v_status, v_archived, v_found
    from public.projects p where p.id = p_doc.project_id and p.org_id = p_doc.org_id;
  if not coalesce(v_found, false) then
    raise exception 'STK_NOT_FOUND: the project is not in your organisation' using errcode = 'P0001'; end if;
  v_active := v_status = 'Ongoing Project' and v_archived is null;                                      -- mut:projactive
  if not v_active then
    raise exception 'STK_PROJECT_NOT_ACTIVE: issues are taken only to an Ongoing, un-archived project' using errcode = 'P0001'; end if;
  v_boq_ok := not exists (select 1 from public.stock_document_lines x
                           where x.document_id = p_doc.id
                             and (x.boq_item_id is null or not exists (select 1 from public.boq_items b
                                   where b.id = x.boq_item_id and b.project_id = p_doc.project_id and b.org_id = p_doc.org_id)));   -- mut:boq
  if not v_boq_ok then
    raise exception 'STK_BOQ_MISMATCH: every line needs a work item of this project' using errcode = 'P0001'; end if;
  if not p_post then return; end if;
  perform public.stock_lock_for_document(p_doc);
  for l in select * from public.stock_document_lines where document_id = p_doc.id order by line_no loop
    -- value is derived by stock_write_entry from the moving average; the client never supplies it (FR-STK-017)
    perform public.stock_write_entry(p_doc, l.id, l.item_id, p_doc.warehouse_id, -l.quantity, null, p_doc.project_id, l.boq_item_id, null);
  end loop;
end $$;

create or replace function public.stock_apply_return(p_doc public.stock_documents, p_post boolean) returns void
  language plpgsql volatile security definer set search_path = public as $$
declare l record; r record; v_lines int; v_matched int; v_projects int; v_project uuid;
        v_issued numeric; v_issued_val numeric; v_ret numeric; v_ret_val numeric; v_in numeric; v_cap_ok boolean;
begin
  -- Every line cites a POSTED issue line of the same item in this org; one project overall (the project comes from the issue, never the client).
  select count(*) into v_lines from public.stock_document_lines x where x.document_id = p_doc.id;
  select count(*), count(distinct sd.project_id), min(sd.project_id::text)::uuid into v_matched, v_projects, v_project
    from public.stock_document_lines x
    join public.stock_document_lines s on s.id = x.source_line_id and s.item_id = x.item_id
    join public.stock_documents sd on sd.id = s.document_id and sd.kind = 'issue' and sd.status = 'Posted' and sd.org_id = p_doc.org_id
   where x.document_id = p_doc.id;
  if v_matched <> v_lines then
    raise exception 'STK_BOQ_MISMATCH: each return line must cite a posted issue line of the same item' using errcode = 'P0001'; end if;
  if v_projects <> 1 then
    raise exception 'STK_INVALID: a return may cite issue lines of one project only' using errcode = 'P0001'; end if;
  if p_doc.project_id is distinct from v_project then
    update public.stock_documents set project_id = v_project where id = p_doc.id;                         -- Draft header, server-derived
  end if;
  -- Cap pre-check (re-checked under the lock below). Cumulative per cited line, including other lines of this document.
  for r in select x.source_line_id as src, sum(x.quantity) as q from public.stock_document_lines x where x.document_id = p_doc.id group by 1 order by 1 loop
    select -e.qty_delta into v_issued from public.stock_ledger e where e.line_id = r.src and e.kind = 'issue';
    select coalesce(sum(e.qty_delta), 0) into v_ret from public.stock_ledger e where e.source_line_id = r.src and e.kind = 'return';
    v_cap_ok := v_ret + r.q <= v_issued;                                                                 -- mut:cap
    if not v_cap_ok then
      raise exception 'STK_RETURN_EXCEEDS: issued %, already returned %, requested %', trim_scale(v_issued)::text, trim_scale(v_ret)::text, trim_scale(r.q)::text
        using errcode = 'P0001', detail = jsonb_build_object('issued', trim_scale(v_issued)::text, 'returned', trim_scale(v_ret)::text, 'requested', trim_scale(r.q)::text)::text;
    end if;
  end loop;
  if not p_post then return; end if;
  perform public.stock_lock_for_document(p_doc);               -- also locks the cited issue lines (order 2), so two returns of one line serialise
  for l in select x.*, s.boq_item_id as s_boq, sd.project_id as s_project
             from public.stock_document_lines x
             join public.stock_document_lines s on s.id = x.source_line_id
             join public.stock_documents sd on sd.id = s.document_id
            where x.document_id = p_doc.id order by x.line_no loop
    select -e.qty_delta, -e.value_delta into v_issued, v_issued_val from public.stock_ledger e where e.line_id = l.source_line_id and e.kind = 'issue';
    select coalesce(sum(e.qty_delta), 0), coalesce(sum(e.value_delta), 0) into v_ret, v_ret_val
      from public.stock_ledger e where e.source_line_id = l.source_line_id and e.kind = 'return';
    if v_ret + l.quantity > v_issued then
      raise exception 'STK_RETURN_EXCEEDS: issued %, already returned %, requested %', trim_scale(v_issued)::text, trim_scale(v_ret)::text, trim_scale(l.quantity)::text
        using errcode = 'P0001'; end if;
    -- The cost the issue line left at; the last return takes the remainder so cumulative returned value never differs from issued value.
    v_in := case when v_ret + l.quantity = v_issued then v_issued_val - v_ret_val
                 else round(l.quantity * v_issued_val / v_issued, 2) end;                                -- mut:returncost
    -- Partial returns that each round up could otherwise overshoot the issued value and leave the final return a negative remainder.
    v_in := least(v_in, v_issued_val - v_ret_val);                                                       -- mut:returnclamp
    perform public.stock_write_entry(p_doc, l.id, l.item_id, p_doc.warehouse_id, l.quantity, v_in, l.s_project, l.s_boq, l.source_line_id);
  end loop;
end $$;

revoke all on function public.stock_apply_issue(public.stock_documents, boolean), public.stock_apply_return(public.stock_documents, boolean)
  from public, anon, authenticated;
