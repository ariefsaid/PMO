-- 1323_dsr_post_stock.sql — #2676 (FR-DRS-010..017, 020..022, 041). Validation of a report posts its material to stock.
-- Proven by supabase/tests/1320_dsr_stock_issue.test.sql. The ledger is written only by the unchanged engine
-- (stock_insert_lines -> stock_post_core -> stock_apply -> stock_write_entry). dsr_validate is NOT restated: a trigger on the status change hooks in.
-- Mutation notes: mut:drs_on · mut:drs_short · mut:drs_keeper_marker · mut:drs_idem_posting · mut:drs_idem_line · mut:drs_reverse_once ·
--                 mut:drs_reverse_before_post · mut:drs_scope (marked below and in 1320/1321).
-- ── REVERSE: rollback/1323_dsr_post_stock_down.sql.

-- Reverses what an older version posted: one `return` document citing its issue lines, exactly once. Returns null on success or when nothing
-- was posted, else the engine's message (the caller records it; validation is never blocked).
create or replace function public.dsr_reverse_stock(p_report uuid) returns text
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid(); p public.dsr_stock_postings; d public.stock_documents; v_ret public.stock_documents;
  v_lines jsonb; v_today date; v_msg text;
begin
  select * into p from public.dsr_stock_postings x where x.report_id = p_report and x.org_id = v_org for update;
  if p.id is null or p.reversed_at is not null then return null; end if;                             -- mut:drs_reverse_once
  select coalesce(jsonb_agg(jsonb_build_object('item_id', l.item_id, 'quantity', l.quantity, 'source_line_id', l.issue_line_id) order by l.id), '[]'::jsonb)
    into v_lines from public.dsr_stock_posting_lines l where l.posting_id = p.id and l.state = 'posted';
  if jsonb_array_length(v_lines) = 0 then
    update public.dsr_stock_postings set reversed_at = now() where id = p.id;
    return null;
  end if;
  select * into d from public.stock_documents where id = p.issue_document_id;
  v_today := public.stock_org_today(v_org);
  begin
    insert into public.stock_documents (org_id, number, kind, warehouse_id, project_id, work_order_id, note, occurred_on, created_by)
    values (v_org, public.next_procurement_doc_number(v_org, public.stock_doc_prefix('return')), 'return', d.warehouse_id, d.project_id,
            d.work_order_id, 'Daily report corrected: earlier issue ' || d.number || ' returned', v_today, v_uid)
    returning * into v_ret;
    perform public.stock_insert_lines(v_ret, v_lines);
    perform set_config('pmo.dsr_stock_post', 'on', true);
    perform public.stock_post_core(v_ret.id);
    perform set_config('pmo.dsr_stock_post', 'off', true);
    update public.dsr_stock_postings set reversed_at = now(), reversal_document_id = v_ret.id where id = p.id;
    return null;
  exception when others then
    perform set_config('pmo.dsr_stock_post', 'off', true);
    get stacked diagnostics v_msg = message_text;
    return left(v_msg, 300);
  end;
end $$;
revoke all on function public.dsr_reverse_stock(uuid) from public, anon, authenticated;

create or replace function public.dsr_post_stock(p_report uuid) returns void
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  r public.daily_site_reports; v_org uuid; v_uid uuid := auth.uid(); v_scope text; v_on boolean; wo public.work_orders;
  v_posting public.dsr_stock_postings; v_wh uuid; v_wh_ok boolean; c record; v_boq uuid; v_boqs uuid[]; v_avail numeric; v_taken numeric;
  v_state text; v_short numeric; v_reason text; v_today date; v_occ date; v_lines jsonb := '[]'::jsonb; v_ids uuid[] := '{}'; v_n int;
  v_doc public.stock_documents; v_rev text; v_msg text; v_posted int; v_flag int; v_oos int; v_total int; v_note text; i int;
begin
  select * into r from public.daily_site_reports where id = p_report for update;
  if r.id is null then return; end if;
  v_org := r.org_id;
  if r.supersedes_id is not null then                                                                  -- the older version's issue goes back first, even if the setting is off now
    v_rev := public.dsr_reverse_stock(r.supersedes_id);                                                -- mut:drs_reverse_before_post
  end if;
  v_on := public.dsr_stock_issue_on(v_org);                                                            -- mut:drs_on
  if not v_on then return; end if;
  if not exists (select 1 from public.dsr_consumables where report_id = r.id) then return; end if;
  if exists (select 1 from public.dsr_stock_postings where report_id = r.id) then return; end if;     -- replay-safe (mut:drs_idem_posting)
  select o.dsr_stock_issue_items into v_scope from public.organizations o where o.id = v_org;
  select * into wo from public.work_orders where id = r.work_order_id;
  v_wh := wo.site_warehouse_id;
  v_wh_ok := v_wh is not null and exists (select 1 from public.stock_warehouses w where w.id = v_wh and w.org_id = v_org and w.archived_at is null);

  insert into public.dsr_stock_postings (org_id, report_id, state, warehouse_id) values (v_org, r.id, 'flagged', v_wh) returning * into v_posting;

  select array_agg(distinct l.boq_item_id) into v_boqs
    from public.dsr_progress_lines pl join public.work_order_lines l on l.id = pl.work_order_line_id where pl.report_id = r.id;
  for c in select cn.*, si.consumable from public.dsr_consumables cn join public.stock_items si on si.id = cn.stock_item_id
            where cn.report_id = r.id order by cn.position loop
    v_state := 'pending'; v_short := null; v_reason := null;
    if v_rev is not null then
      v_state := 'failed'; v_reason := 'DRS_REVERSAL_FAILED: the earlier issue could not be returned: ' || v_rev;
    elsif v_scope = 'consumables' and not c.consumable then                                            -- mut:drs_scope
      v_state := 'not_stocked';
    elsif not v_wh_ok then
      v_state := 'no_location';
    else
      v_boq := null;
      if c.work_order_line_id is not null then
        select l.boq_item_id into v_boq from public.work_order_lines l where l.id = c.work_order_line_id and l.work_order_id = r.work_order_id;
      elsif coalesce(array_length(v_boqs, 1), 0) = 1 then
        v_boq := v_boqs[1];
      elsif (select count(*) from public.work_order_lines l where l.work_order_id = r.work_order_id) = 1 then
        select l.boq_item_id into v_boq from public.work_order_lines l where l.work_order_id = r.work_order_id;
      end if;
      if v_boq is null then
        v_state := 'no_work_item';
      else
        select coalesce(b.qty_on_hand, 0) into v_avail from (select 1) z
          left join public.stock_balances b on b.item_id = c.stock_item_id and b.warehouse_id = v_wh;
        select coalesce(sum(x.quantity), 0) into v_taken from public.dsr_stock_posting_lines x where x.posting_id = v_posting.id and x.item_id = c.stock_item_id and x.state = 'pending';
        if c.quantity > coalesce(v_avail, 0) - v_taken then                                            -- mut:drs_short (whole line or nothing)
          v_state := 'short'; v_short := c.quantity - greatest(coalesce(v_avail, 0) - v_taken, 0);
        end if;
      end if;
    end if;
    insert into public.dsr_stock_posting_lines (org_id, posting_id, consumable_id, item_id, quantity, state, short_by, reason)
    values (v_org, v_posting.id, c.id, c.stock_item_id, c.quantity, v_state, v_short, v_reason);
    if v_state = 'pending' then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('item_id', c.stock_item_id, 'quantity', c.quantity, 'boq_item_id', v_boq));
      v_ids := v_ids || c.id;
    end if;
  end loop;

  if jsonb_array_length(v_lines) > 0 then
    v_today := public.stock_org_today(v_org);
    v_occ := case when r.work_date > v_today or r.work_date < v_today - 31 then v_today else r.work_date end;
    v_note := 'Daily report ' || r.work_date::text || ' v' || r.version::text
              || case when v_occ <> r.work_date then ' (work date out of range: posted on the validation day)' else '' end;
    begin
      insert into public.stock_documents (org_id, number, kind, warehouse_id, project_id, work_order_id, note, occurred_on, created_by)
      values (v_org, public.next_procurement_doc_number(v_org, public.stock_doc_prefix('issue')), 'issue', v_wh, r.project_id, r.work_order_id, v_note, v_occ, v_uid)
      returning * into v_doc;
      perform public.stock_insert_lines(v_doc, v_lines);
      perform public.stock_apply(v_doc, false);                                                        -- static validation, as create_stock_document does
      perform set_config('pmo.dsr_stock_post', 'on', true);                                            -- mut:drs_keeper_marker
      perform public.stock_post_core(v_doc.id);
      perform set_config('pmo.dsr_stock_post', 'off', true);
      for i in 1 .. array_length(v_ids, 1) loop
        update public.dsr_stock_posting_lines pl set state = 'posted',
               issue_line_id = (select sl.id from public.stock_document_lines sl where sl.document_id = v_doc.id and sl.line_no = i)
         where pl.posting_id = v_posting.id and pl.consumable_id = v_ids[i];
      end loop;
      update public.dsr_stock_postings set issue_document_id = v_doc.id, occurred_on = v_occ where id = v_posting.id;
    exception when others then                                                                         -- the sub-transaction rolled the document back
      perform set_config('pmo.dsr_stock_post', 'off', true);
      get stacked diagnostics v_msg = message_text;
      update public.dsr_stock_posting_lines set state = 'failed', reason = left(v_msg, 300)
       where posting_id = v_posting.id and state = 'pending';
    end;
  end if;

  select count(*) filter (where state = 'posted'), count(*) filter (where state in ('short', 'no_location', 'no_work_item', 'failed')),
         count(*) filter (where state = 'not_stocked'), count(*)
    into v_posted, v_flag, v_oos, v_total from public.dsr_stock_posting_lines where posting_id = v_posting.id;
  update public.dsr_stock_postings set state = case when v_flag = 0 and v_posted > 0 then 'posted'
                                                    when v_flag = 0 then 'out_of_scope'
                                                    when v_posted > 0 then 'partial' else 'flagged' end,
         reason = case when v_rev is not null then left('DRS_REVERSAL_FAILED: ' || v_rev, 300) end
   where id = v_posting.id;
end $$;
revoke all on function public.dsr_post_stock(uuid) from public, anon, authenticated;

create or replace function public.dsr_post_stock_trigger() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.dsr_post_stock(new.id);
  return null;
end $$;
revoke all on function public.dsr_post_stock_trigger() from public, anon, authenticated;
create trigger daily_site_reports_zz_post_stock after update of status on public.daily_site_reports
  for each row when (old.status is distinct from new.status and new.status = 'validated')
  execute function public.dsr_post_stock_trigger();
