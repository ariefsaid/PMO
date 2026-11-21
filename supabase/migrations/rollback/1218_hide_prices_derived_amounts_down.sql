-- rollback/1218_hide_prices_derived_amounts_down.sql
drop function if exists public.project_committed_spend(uuid);
alter function public.project_committed_spend_unmasked(uuid) rename to project_committed_spend;
drop function if exists public.procurement_open_commitments(uuid[]);
alter function public.procurement_open_commitments_unmasked(uuid[]) rename to procurement_open_commitments;
grant execute on function public.procurement_open_commitments(uuid[]) to authenticated, service_role;
drop function if exists public.procurement_open_commitment(public.procurements);
alter function public.procurement_open_commitment_unmasked(public.procurements) rename to procurement_open_commitment;
