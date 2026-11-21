-- rollback/1218_hide_prices_derived_amounts_down.sql
drop function if exists public.procurement_open_commitment_masked(public.procurements_masked);
drop function if exists public.project_committed_spend_masked(uuid);
drop function if exists public.procurement_open_commitments_masked(uuid[]);
