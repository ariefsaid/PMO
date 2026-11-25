-- 2161_opening_balances_overview.sql — a read-only view of the opening balances loaded for the organisation.
-- Spec: docs/specs/opening-balances-screen.spec.md (FR-OBS-001..003). Proven by supabase/tests/2161_opening_balances_overview.test.sql.
-- Definer because the stock value is cost, which clients do not read (0413 D5); the role gate and the org filter are therefore here:
-- Admin and Finance only (opening_balance_report stays Admin-only for the CLI). Writes nothing; loading stays with the CLI.
-- Reverse: supabase/migrations/rollback/2161_opening_balances_overview_down.sql.

create or replace function public.opening_balances_overview()
  returns table (id uuid, kind text, as_of date, loaded_at timestamptz, loaded_by_name text, label text, sub_label text, currency text,
                 line_count integer, certified_value numeric, claimed_value numeric, stock_quantity numeric, stock_value numeric,
                 note text, lines jsonb)
  language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if public.auth_role() not in ('Admin', 'Finance') then
    raise exception 'only Admin and Finance read the opening balances' using errcode = '42501';
  end if;
  if not coalesce((select s.enabled from public.org_setup_workflow_settings s where s.org_id = public.auth_org_id()), false) then
    raise exception 'setup workflows are disabled for this organisation' using errcode = '42501';
  end if;
  return query
  select o.id, o.kind, o.as_of, o.loaded_at, p.full_name,
         case when o.kind = 'work_order' then coalesce(w.wo_number, w.title) else h.code end,
         case when o.kind = 'work_order' then pr.name else h.name end,
         coalesce(o.currency, (select g.default_currency from public.organizations g where g.id = o.org_id)),
         coalesce(wl.n, sl.n, 0)::int,
         wl.certified,
         case when o.kind = 'work_order' then o.claimed_amount end,
         sl.qty, sl.val, o.note,
         case when o.kind = 'work_order' then coalesce(wl.detail, '[]'::jsonb) else coalesce(sl.detail, '[]'::jsonb) end
    from public.opening_balances o
    left join public.profiles p on p.id = o.loaded_by
    left join public.work_orders w on w.id = o.work_order_id
    left join public.projects pr on pr.id = w.project_id
    left join public.stock_warehouses h on h.id = o.warehouse_id
    left join lateral (
      select count(*) n, sum(round(x.certified_quantity * b.rate, 2)) certified,
             jsonb_agg(jsonb_build_object('item_code', b.item_code, 'description', b.description, 'certified_quantity', x.certified_quantity,
                                          'claimed_quantity', x.claimed_quantity, 'claimed_amount', x.claimed_amount) order by b.item_code) detail
        from public.opening_balance_lines x join public.boq_items b on b.id = x.boq_item_id where x.opening_id = o.id) wl on o.kind = 'work_order'
    left join lateral (
      select count(*) n, coalesce(sum(b.qty), 0) qty, coalesce(sum(b.val), 0) val,
             jsonb_agg(jsonb_build_object('item_code', i.code, 'item_name', i.name, 'quantity', b.qty, 'value', b.val) order by i.code) detail
        from (
          select s.item_id, sum(s.qty_delta) qty, sum(s.value_delta) val
            from public.stock_ledger s
           where s.document_id = o.stock_document_id and s.kind = 'opening'
           group by s.item_id
          having sum(s.qty_delta) <> 0
        ) b join public.stock_items i on i.id = b.item_id) sl on o.kind = 'stock'
   where o.org_id = public.auth_org_id() and o.reversed_at is null
   order by o.kind, o.as_of, 6;
end $$;

revoke all on function public.opening_balances_overview() from public, anon;
grant execute on function public.opening_balances_overview() to authenticated;
comment on function public.opening_balances_overview() is
  'FR-OBS-001: the live opening balances (work-order and stock) with load date, who loaded, per-line detail and reconciliation totals. Admin and Finance only; read-only.';
