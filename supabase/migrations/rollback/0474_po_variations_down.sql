-- 0474_po_variations_down.sql — reverses 0474 (#1513 S4). Refuses while PO variations exist (NFR-SCA-007): export
-- (scripts/prod-read.sh / pg_dump -t) and remove them first. Never copy rows into a table in `public`: that schema is
-- API-exposed and an `as select *` copy carries no RLS. Spend already raised by an approved variation
-- (procurements.total_value / approved_total_value) stands; PO revisions that variations issued stay (they only point at
-- the variation through the dropped constraint, which must be cleared with the variations).
do $$ begin
  if exists (select 1 from public.po_variations) or exists (select 1 from public.po_variation_lines) then
    raise exception 'rollback refused: PO variations exist — export and remove them first';
  end if;
end $$;
drop function if exists public.project_subcontract_exposure(uuid);
drop function if exists public.subcontract_po_position(uuid);
-- restore the 0472 position read (no `disputed`)
create or replace function public.subcontract_po_position(p_po_id uuid)
  returns table (boq_item_id uuid, item_code text, description text, unit text, rate numeric, revision integer,
                 po_qty numeric, verified numeric, billed numeric, payable numeric, verified_not_on_po numeric,
                 verified_at timestamptz)
  language sql stable security invoker set search_path = public as $$
  with rev as (select public.po_effective_revision(p_po_id) as r),
  bl as (select l.boq_item_id, sum(l.quantity) q from public.procurement_invoice_lines l
           join public.procurement_invoices i on i.id = l.invoice_id
          where i.po_id = p_po_id and public.subcontract_bill_is_live(i.erp_docstatus, i.erp_cancelled_at)
          group by l.boq_item_id),
  money as (select public.auth_role() in ('Admin','Executive','Project Manager','Finance') as ok)  -- D6 / 0350 ruling
  select pl.boq_item_id, b.item_code, b.description, pl.unit, pl.rate, pl.revision, pl.quantity,
         coalesce(v.quantity, 0),
         case when money.ok then coalesce(bl.q, 0) end,
         case when money.ok then greatest(least(coalesce(v.quantity, 0), pl.quantity) - coalesce(bl.q, 0), 0) end,
         greatest(coalesce(v.quantity, 0) - pl.quantity, 0),
         v.confirmed_at
    from rev cross join money join public.purchase_order_lines pl on pl.po_id = p_po_id and pl.revision = rev.r
    join public.boq_items b on b.id = pl.boq_item_id
    left join public.subcontract_verified(p_po_id) v on v.boq_item_id = pl.boq_item_id
    left join bl on bl.boq_item_id = pl.boq_item_id
   order by b.line_no nulls last, b.item_code
$$;
revoke all on function public.subcontract_po_position(uuid) from public, anon;
grant execute on function public.subcontract_po_position(uuid) to authenticated;
drop function if exists public.work_order_cost_variations(uuid);
drop function if exists public.link_po_variation(uuid, uuid, text);
drop function if exists public.issue_po_revision(uuid);
drop function if exists public.decide_po_variation(uuid, boolean, text);
drop function if exists public.po_variation_route(uuid);
drop function if exists public.request_po_variation(uuid, text, jsonb, text);
alter table public.purchase_order_revisions drop constraint if exists purchase_order_revisions_variation_fk;
drop table if exists public.po_variation_lines;
drop table if exists public.po_variations;
drop function if exists public.guard_po_variation_line();
drop function if exists public.guard_po_variation();
