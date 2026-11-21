-- 1324_dsr_stock_status_read.sql — #2676 (FR-DRS-030). One org-scoped read of what a validated report did to stock. Quantities only, no cost.
-- ── REVERSE: rollback/1324_dsr_stock_status_read_down.sql.
create or replace function public.dsr_stock_status(p_report uuid) returns jsonb
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.dsr_require_member(); p public.dsr_stock_postings;
begin
  if not exists (select 1 from public.daily_site_reports d where d.id = p_report and d.org_id = v_org) then   -- mut:drs_org
    raise exception 'report not found' using errcode = 'P0002'; end if;
  select * into p from public.dsr_stock_postings x where x.report_id = p_report and x.org_id = v_org;
  if p.id is null then return null; end if;
  return jsonb_build_object(
    'state', p.state, 'reason', p.reason, 'occurred_on', p.occurred_on, 'reversed', p.reversed_at is not null,
    'location', (select w.name from public.stock_warehouses w where w.id = p.warehouse_id),
    'document_number', (select d.number from public.stock_documents d where d.id = p.issue_document_id),
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
        'consumable_id', l.consumable_id, 'position', c.position, 'item_code', i.code, 'item_name', i.name, 'unit', c.unit,
        'quantity', trim_scale(l.quantity)::text, 'state', l.state, 'short_by', trim_scale(l.short_by)::text, 'reason', l.reason) order by c.position)
       from public.dsr_stock_posting_lines l join public.dsr_consumables c on c.id = l.consumable_id join public.stock_items i on i.id = l.item_id
      where l.posting_id = p.id), '[]'::jsonb));
end $$;
revoke all on function public.dsr_stock_status(uuid) from public, anon;
grant execute on function public.dsr_stock_status(uuid) to authenticated;
