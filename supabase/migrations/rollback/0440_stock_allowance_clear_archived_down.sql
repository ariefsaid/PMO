drop policy boq_material_allowances_delete on public.boq_material_allowances;
create policy boq_material_allowances_delete on public.boq_material_allowances for delete
  using (org_id = public.auth_org_id() and public.is_active_member() and public.boq_allowance_ok(boq_item_id, item_id));
drop function public.boq_allowance_clear_ok(uuid, uuid);
