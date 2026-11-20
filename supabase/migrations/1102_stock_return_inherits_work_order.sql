-- 1102_stock_return_inherits_work_order.sql — #2612: a return carries the work order of the issue it cites.
-- Proven by supabase/tests/1102_stock_return_inherits_work_order.test.sql. REVERSE: rollback/1102_stock_return_inherits_work_order_down.sql

-- §3 A return cites posted issue lines; when it names no work order of its own and every cited issue carries the SAME one, the
-- return takes it, so the work order's issued quantity, balance and cost net down. An explicit choice is never overridden.
create or replace function public.stock_returns_inherit_work_order() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.stock_documents r
     set work_order_id = x.wo
    from (
      select rl.document_id, min(i.work_order_id::text)::uuid as wo
        from public.stock_document_lines rl
        join public.stock_document_lines sl on sl.id = rl.source_line_id
        join public.stock_documents i on i.id = sl.document_id and i.kind = 'issue'
       where rl.document_id in (select distinct document_id from new_lines)
       group by rl.document_id
      having count(*) = count(i.work_order_id) and count(distinct i.work_order_id) = 1
    ) x
   where r.id = x.document_id and r.kind = 'return' and r.work_order_id is null and r.status = 'Draft';
  return null;
end $$;
revoke all on function public.stock_returns_inherit_work_order() from public, anon, authenticated;
create trigger stock_document_lines_return_work_order
  after insert on public.stock_document_lines referencing new table as new_lines
  for each statement execute function public.stock_returns_inherit_work_order();
