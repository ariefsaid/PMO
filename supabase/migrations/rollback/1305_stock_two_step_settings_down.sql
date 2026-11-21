-- 1305_stock_two_step_settings_down.sql — reverse 1305. Transit locations, 1306+ objects and tags using confirmation/either must be gone first.
drop trigger if exists stock_tags_zz_proof_mode on public.stock_tags;
drop trigger if exists stock_tags_aa_sync_proof on public.stock_tags;
drop function if exists public.guard_stock_tag_proof_mode();
drop function if exists public.sync_stock_tag_proof();
revoke insert (proof_required), update (proof_required) on public.stock_tags from authenticated;
alter table public.stock_tags drop column if exists proof_required;
create or replace function public.audit_stock_tag() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform public.log_audit('stock.tag.' || case when tg_op = 'INSERT' then 'create'
                                                when old.archived_at is null and new.archived_at is not null then 'archive'
                                                else 'update' end,
    new.org_id, auth.uid(), new.id,
    jsonb_build_object('name', new.name, 'zero_cost', new.zero_cost, 'paper_required', new.paper_required));
  return null;
end $$;
revoke insert (needs_quality_check), update (needs_quality_check) on public.stock_items from authenticated;
alter table public.stock_items drop column if exists needs_quality_check;
drop trigger if exists stock_documents_zz_transit on public.stock_documents;
drop function if exists public.guard_stock_document_transit();
drop trigger if exists stock_warehouses_zz_transit on public.stock_warehouses;
drop function if exists public.guard_stock_transit_location();
drop function if exists public.stock_system_write_on();
alter table public.stock_warehouses drop constraint if exists stock_warehouses_transit_shape;
alter table public.stock_warehouses drop constraint stock_warehouses_kind_check;
alter table public.stock_warehouses add constraint stock_warehouses_kind_check check (kind in ('central','site','yard','staging','vendor'));
drop function if exists public.set_stock_proof_timing(text);
drop function if exists public.set_stock_transfer_mode(text);
drop function if exists public.stock_mode_blockers(uuid, text);
drop function if exists public.stock_proof_timing_of(uuid);
drop function if exists public.stock_transfer_mode_of(uuid);
alter table public.organizations drop column if exists stock_proof_timing, drop column if exists stock_transfer_mode;
