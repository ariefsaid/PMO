-- 2792_org_term_keys_owner_material.sql — the eight stage terms of owner-supplied material are nameable (#3010, FR-016).
-- Requested, owner set-aside, received, issued, returned, transferred, closing stock, material reconciliation.
-- The key list is the front-end registry (pmo-portal/src/lib/i18n/terms.registry.json); orgTerms.registry.test.ts fails
-- if the two differ. No policy, grant or existing row changes: the key table stays code-owned reference data.
-- Reversal: supabase/migrations/rollback/2792_org_term_keys_owner_material_down.sql
insert into public.org_term_keys (term_key) values
  ('stageRequested'), ('stageSetAside'), ('stageReceived'), ('stageIssued'),
  ('stageReturned'), ('stageTransferred'), ('stageClosing'), ('materialReconciliation')
on conflict (term_key) do nothing;
