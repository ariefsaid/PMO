-- UNDO (do this when done): `supabase db reset`. Never run by seed.sql, CI or any script.
-- LOCAL ONLY. Marks the demo organisation as moved to the Odoo ledger (what the Admin's switch writes). See seed-odoo-ledger-demo.sql.
update external_org_bindings set config = coalesce(config, '{}'::jsonb) || jsonb_build_object('ledger_basis_at', now())
 where org_id = '00000000-0000-0000-0000-000000000001' and external_tier = 'odoo';
