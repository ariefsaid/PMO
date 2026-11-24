-- Rollback of 2100: restore the 1309 bodies; drop the setter, reader and column.
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
  -- Archive vs post (#1512 S2b): share-lock the document's warehouses and items before the check, so an archive in flight
  -- finishes first (the check then sees it) and an archive started now waits for this post (its stock guard then sees the stock).
  perform 1 from public.stock_warehouses w where w.id in (d.warehouse_id, coalesce(d.to_warehouse_id, d.warehouse_id)) order by w.id for share;   -- mut:archivelock_wh_v3
  perform 1 from public.stock_items i where i.id in (select l.item_id from public.stock_document_lines l where l.document_id = d.id) order by i.id for share;   -- mut:archivelock_item_v3
  if exists (select 1 from public.stock_warehouses w where w.id in (d.warehouse_id, coalesce(d.to_warehouse_id, d.warehouse_id)) and w.archived_at is not null)
     or exists (select 1 from public.stock_document_lines l join public.stock_items i on i.id = l.item_id where l.document_id = d.id and i.archived_at is not null) then
    raise exception 'STK_ARCHIVED: a warehouse or item on this document was archived' using errcode = 'P0001'; end if;
  -- Retagging is allowed until the first movement; recheck any draft lines under item/tag locks.
  perform 1 from public.stock_tags t where t.id in (select i.tag_id from public.stock_document_lines l join public.stock_items i on i.id = l.item_id where l.document_id = d.id) order by t.id for share;
  if exists (select 1 from public.stock_document_lines l join public.stock_items i on i.id = l.item_id
             join public.stock_tags t on t.id = i.tag_id where l.document_id = d.id and t.zero_cost and l.unit_cost <> 0) then
    raise exception 'STK_ZERO_COST: a client-supplied item is received at cost 0' using errcode = 'P0001';
  end if;
  -- Lock live evidence before checking it, so an archive cannot race the posting.
  perform 1 from public.stock_document_files f where f.document_id = d.id and f.archived_at is null order by f.id for share;
  -- FR-SSW-022: a transfer of a zero-cost item whose tag says "paper required" posts only with a live attachment.
  if d.kind = 'transfer'
     and exists (select 1 from public.stock_document_lines l join public.stock_items i on i.id = l.item_id
                   join public.stock_tags t on t.id = i.tag_id
                  where l.document_id = d.id and t.zero_cost and t.paper_required)                     -- mut:paper
     and public.stock_proof_timing_of(d.org_id) = 'before_posting'                                   -- mut:timing_block
     and not exists (select 1 from public.stock_document_files f join storage.objects o on o.bucket_id = 'stock-documents' and o.name = f.file_path where f.document_id = d.id and f.archived_at is null) then
    raise exception 'STK_PAPER_REQUIRED: attach the delivery paper before posting this client-supplied transfer' using errcode = 'P0001';
  end if;
  perform public.stock_apply(d, true);
  update public.stock_documents set status = 'Posted', posted_by = v_uid, posted_at = now() where id = d.id;
  if v_override then
    perform public.log_audit('stock.admin_post', d.org_id, v_uid, d.id, jsonb_build_object('kind', d.kind, 'warehouse_id', d.warehouse_id, 'number', d.number));
  end if;
end $$;

create or replace function public.get_stock_movement_proof_status(p_status text default null, p_from date default null, p_to date default null)
  returns table (
    movement_id uuid, movement_number text, mode text, transfer_status text, movement_date date,
    from_warehouse_id uuid, from_warehouse_name text, to_warehouse_id uuid, to_warehouse_name text,
    tag_rules text[], required_proof text, has_paper boolean, has_confirmation boolean,
    proof_status text, missing text, proof_completed_at timestamptz)
  language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_org uuid;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  if p_status is not null and p_status not in ('outstanding', 'complete') then
    raise exception 'STK_INVALID: the proof status is outstanding or complete' using errcode = 'P0001'; end if;
  return query
  with one as (
    select d.id as movement_id, d.number as movement_number, 'one_step'::text as mode, d.status as transfer_status, d.occurred_on as movement_date,
           d.warehouse_id as from_id, d.to_warehouse_id as to_id, array['paper']::text[] as tag_rules,
           exists (select 1 from public.stock_document_files f join storage.objects o on o.bucket_id = 'stock-documents' and o.name = f.file_path
                    where f.document_id = d.id and f.archived_at is null) as has_paper,
           false as has_confirmation,
           (select max(f.created_at) from public.stock_document_files f join storage.objects o on o.bucket_id = 'stock-documents' and o.name = f.file_path
             where f.document_id = d.id and f.archived_at is null) as last_evidence
      from public.stock_documents d
     where d.org_id = v_org and d.kind = 'transfer' and d.status = 'Posted' and d.two_step_id is null
       and exists (select 1 from public.stock_document_lines l join public.stock_items i on i.id = l.item_id join public.stock_tags t on t.id = i.tag_id
                    where l.document_id = d.id and t.zero_cost and t.paper_required)
  ), two as (
    select t.id as movement_id, t.number as movement_number, 'two_step'::text as mode, t.status as transfer_status, sd.occurred_on as movement_date,
           t.from_warehouse_id as from_id, t.to_warehouse_id as to_id,
           (select array_agg(distinct tg.proof_required order by tg.proof_required) from public.stock_transfer_lines l
              join public.stock_items i on i.id = l.item_id join public.stock_tags tg on tg.id = i.tag_id
             where l.transfer_id = t.id and tg.proof_required <> 'none') as tag_rules,
           exists (select 1 from public.stock_handover_confirmations c where c.transfer_id = t.id and c.proof_type = 'paper') as has_paper,
           exists (select 1 from public.stock_handover_confirmations c where c.transfer_id = t.id and c.proof_type = 'in_app' and c.stage = 'receive') as has_confirmation,
           (select max(c.confirmed_at) from public.stock_handover_confirmations c where c.transfer_id = t.id) as last_evidence
      from public.stock_transfers t join public.stock_documents sd on sd.id = t.send_document_id
     where t.org_id = v_org and t.status <> 'Cancelled'
  ), u as (
    select * from one union all select * from two where tag_rules is not null
  )
  select x.movement_id, x.movement_number, x.mode, x.transfer_status, x.movement_date,
         x.from_id, fw.name, x.to_id, tw.name,
         x.tag_rules, case when cardinality(x.tag_rules) = 1 then x.tag_rules[1] else 'mixed' end,
         x.has_paper, x.has_confirmation,
         case when m.missing is null then 'complete' else 'outstanding' end, m.missing,
         case when m.missing is null then x.last_evidence end
    from u x
    join public.stock_warehouses fw on fw.id = x.from_id
    join public.stock_warehouses tw on tw.id = x.to_id
    cross join lateral (
      select nullif(array_to_string(array_remove(array[
          case when 'paper' = any (x.tag_rules) and not x.has_paper then 'paper' end,
          case when 'confirmation' = any (x.tag_rules) and not x.has_confirmation then 'confirmation' end,
          case when 'either' = any (x.tag_rules) and not (x.has_paper or x.has_confirmation) then 'either' end], null), ','), '') as missing) m
   where (p_from is null or x.movement_date >= p_from) and (p_to is null or x.movement_date <= p_to)
     and (p_status is null or p_status = case when m.missing is null then 'complete' else 'outstanding' end)
   order by x.movement_date desc, x.movement_number desc;
end $$;
revoke all on function public.get_stock_movement_proof_status(text, date, date) from public, anon;
grant execute on function public.get_stock_movement_proof_status(text, date, date) to authenticated;
drop function if exists public.set_stock_handover_scope(text);
drop function if exists public.stock_handover_scope_of(uuid);
alter table public.organizations drop column if exists stock_handover_scope;
