-- Rollback 0560: restore get_project_finances to mapped ERP snapshots, then remove the PMO reader.
do $migration$
declare
  v_definition text;
  v_new_source constant text := 'select * from public.project_finance_actuals(p_project_id)';
  v_old_source constant text := 'select * from public.project_mapped_actuals(p_project_id,null)';
  v_new_currency constant text := $new$'currency',case when public.org_reads_erp_ledger() then o.default_currency else p.currency end$new$;
  v_old_currency constant text := $old$'currency',o.default_currency$old$;
begin
  select pg_get_functiondef('public.get_project_finances(uuid)'::regprocedure) into v_definition;
  if length(v_definition) - length(replace(v_definition, v_new_source, '')) <> length(v_new_source) then
    raise exception '0560 rollback expected one PMO actuals source in get_project_finances';
  end if;
  if length(v_definition) - length(replace(v_definition, v_new_currency, '')) <> length(v_new_currency) then
    raise exception '0560 rollback expected one conditional currency expression in get_project_finances';
  end if;
  v_definition := replace(v_definition, v_new_source, v_old_source);
  v_definition := replace(v_definition, v_new_currency, v_old_currency);
  execute v_definition;
end;
$migration$;

drop function public.project_finance_actuals(uuid);

create or replace function public.procurement_open_commitment(p public.procurements) returns numeric
language sql stable security invoker set search_path = public, pg_catalog as $$
  select case
    when p.status::text in ('Cancelled','Rejected') then 0::numeric
    when public.org_reads_erp_ledger() then greatest(0::numeric, coalesce(p.total_value, 0) - coalesce(public.procurement_ledger_held(p.id), 0))
    else coalesce(p.total_value, 0)::numeric end
$$;

drop function public.procurement_paid_pre_tax(public.procurements);
