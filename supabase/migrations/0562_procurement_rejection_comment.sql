-- #1578: every Requested → Rejected transition carries a non-blank explanation.
-- Keep the invariant at the table boundary so the single and per-row bulk RPC paths share it.
create or replace function public.require_procurement_rejection_comment()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.status = 'Requested'
     and new.status = 'Rejected'
     and nullif(regexp_replace(new.rejection_notes, '[[:space:]]', '', 'g'), '') is null then
    raise exception 'rejection comment required' using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger procurement_rejection_comment_required
before update of status, rejection_notes on public.procurements
for each row execute function public.require_procurement_rejection_comment();
