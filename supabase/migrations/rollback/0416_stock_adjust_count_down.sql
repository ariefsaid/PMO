-- Reverses 0416_stock_adjust_count.sql (#1512 S4): restores the S2a stubs verbatim and drops the write-off rule. Pre-production reversal is also `supabase db reset`.
create or replace function public.stock_apply_adjustment(p_doc public.stock_documents, p_post boolean) returns void language plpgsql as $$
begin raise exception 'STK_KIND_UNAVAILABLE: adjustment posting is not enabled yet' using errcode = 'P0001'; end $$;
create or replace function public.stock_apply_count(p_doc public.stock_documents, p_post boolean) returns void language plpgsql as $$
begin raise exception 'STK_KIND_UNAVAILABLE: count posting is not enabled yet' using errcode = 'P0001'; end $$;
revoke all on function public.stock_apply_adjustment(public.stock_documents, boolean), public.stock_apply_count(public.stock_documents, boolean)
  from public, anon, authenticated, service_role;
drop function if exists public.stock_assert_writeoff_approver(public.stock_documents, uuid);
drop function if exists public.get_stock_document_costs(uuid);
drop function if exists public.post_stock_document(uuid, integer);
create or replace function public.post_stock_document(p_document_id uuid) returns uuid
  language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.assert_is_active_member();
  perform public.stock_post_core(p_document_id);
  return p_document_id;
end $$;
revoke all on function public.post_stock_document(uuid) from public, anon;
grant execute on function public.post_stock_document(uuid) to authenticated;
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
alter table public.stock_documents drop column if exists revision;
