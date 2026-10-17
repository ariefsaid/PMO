-- 0314 — a binding company change invalidates the statement source and schedules a full replay.
-- Rollback: rollback/0314_statement_company_replay_down.sql
create or replace function public.request_statement_replay_on_company_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.external_tier = 'erpnext'
     and old.config ->> 'company' is distinct from new.config ->> 'company' then
    new.statement_full_ledger_replay_needed := true;
    new.statement_update_delayed := true;
  end if;
  return new;
end;
$$;

create trigger external_org_bindings_statement_company_replay
before update of config on public.external_org_bindings
for each row execute function public.request_statement_replay_on_company_change();
