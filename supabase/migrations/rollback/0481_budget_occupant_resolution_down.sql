-- 0481_budget_occupant_resolution_down.sql — reverse of 0483 (ECA-6, #1603). Drops the consent table and the three
-- functions; no PMO-owned budget row depends on them (a Draft created from an ERP budget is an ordinary budget version).
drop function if exists public.create_budget_draft_from_erp(uuid, text, jsonb);
drop function if exists public.consume_budget_occupant_consent(uuid, uuid, uuid);
drop function if exists public.consent_budget_occupant_replace(uuid, text, text, text);
drop table if exists public.budget_occupant_consents;
notify pgrst, 'reload schema';
