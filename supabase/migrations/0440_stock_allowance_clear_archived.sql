-- #1626 item 1: an allowance on an archived stock item could not be cleared (the delete policy reused boq_allowance_ok,
-- which refuses archived items). Clearing only removes a planned quantity, so it needs the same project scope (PQ-7) but not
-- the live-item test. Setting and raising stay refused for archived items (insert/update policies unchanged).
-- Reversible via rollback/0440_stock_allowance_clear_archived_down.sql.
create or replace function public.boq_allowance_clear_ok(p_boq_item_id uuid, p_item_id uuid) returns boolean
  language sql stable set search_path = public as $$
  select exists (select 1 from public.boq_items b join public.stock_items i on i.org_id = b.org_id
                  where b.id = p_boq_item_id and i.id = p_item_id
                    and public.may_record_project_progress(b.project_id))                                -- mut:allowance_clear_scope
$$;
revoke all on function public.boq_allowance_clear_ok(uuid, uuid) from public, anon;
grant execute on function public.boq_allowance_clear_ok(uuid, uuid) to authenticated;

drop policy boq_material_allowances_delete on public.boq_material_allowances;
create policy boq_material_allowances_delete on public.boq_material_allowances for delete
  using (org_id = public.auth_org_id() and public.is_active_member() and public.boq_allowance_clear_ok(boq_item_id, item_id));
