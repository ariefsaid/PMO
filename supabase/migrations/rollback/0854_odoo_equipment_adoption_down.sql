-- Rollback for 0854_odoo_equipment_adoption.sql (#1511 F3). Reverse order of the forward file.
-- The links already adopted (equipment_assets.external_tier / external_ref) are deliberately left in place: the
-- columns predate 0854 (#1519 OQ-9) and a down migration must not lose what people matched in use. Releasing the
-- `equipment` ownership row is what hands the client writes back.

drop policy if exists equipment_assets_odoo_owned_insert on public.equipment_assets;
drop policy if exists equipment_assets_odoo_owned_update on public.equipment_assets;
drop policy if exists equipment_assets_odoo_owned_delete on public.equipment_assets;

drop function if exists public.record_odoo_asset_created(uuid, text, jsonb, uuid, text);
drop function if exists public.accept_equipment_asset_matches(jsonb);
drop function if exists public.list_equipment_asset_matches();
