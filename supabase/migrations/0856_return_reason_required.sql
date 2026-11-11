create function public.require_timesheet_rejection_reason() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if old.status = 'Submitted' and new.status = 'Rejected' and
     (nullif(regexp_replace(new.rejection_reason, '[[:space:]]', '', 'g'), '') is null
      or length(btrim(new.rejection_reason)) > 1000) then
    raise exception using errcode = '22023', message = 'A rejection reason is required';
  end if;
  return new;
end;
$$;
revoke execute on function public.require_timesheet_rejection_reason() from public, anon, authenticated;
create constraint trigger require_timesheet_rejection_reason_trigger after update on public.timesheets
  deferrable initially immediate for each row execute function public.require_timesheet_rejection_reason();

create function public.require_expense_rejection_reason() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if old.status = 'Submitted' and new.status = 'Rejected' and
     (nullif(regexp_replace(new.rejection_notes, '[[:space:]]', '', 'g'), '') is null
      or length(btrim(new.rejection_notes)) > 1000) then
    raise exception using errcode = '22023', message = 'A rejection reason is required';
  end if;
  return new;
end;
$$;
revoke execute on function public.require_expense_rejection_reason() from public, anon, authenticated;
create constraint trigger require_expense_rejection_reason_trigger after update on public.expense_claims
  deferrable initially immediate for each row execute function public.require_expense_rejection_reason();

create function public.require_imprest_rejection_reason() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if old.status = 'Requested' and new.status = 'Rejected' and
     (nullif(regexp_replace(new.decided_notes, '[[:space:]]', '', 'g'), '') is null
      or length(btrim(new.decided_notes)) > 1000) then
    raise exception using errcode = '22023', message = 'A rejection reason is required';
  end if;
  return new;
end;
$$;
revoke execute on function public.require_imprest_rejection_reason() from public, anon, authenticated;
create constraint trigger require_imprest_rejection_reason_trigger after update on public.imprest_replenishments
  deferrable initially immediate for each row execute function public.require_imprest_rejection_reason();

create function public.require_equipment_rejection_reason() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if old.status = 'Submitted' and new.status = 'Rejected' and
     (nullif(regexp_replace(new.decision_notes, '[[:space:]]', '', 'g'), '') is null
      or length(btrim(new.decision_notes)) > 500) then
    raise exception using errcode = '22023', message = 'A rejection reason is required';
  end if;
  return new;
end;
$$;
revoke execute on function public.require_equipment_rejection_reason() from public, anon, authenticated;
create constraint trigger require_equipment_rejection_reason_trigger after update on public.equipment_usage_entries
  deferrable initially immediate for each row execute function public.require_equipment_rejection_reason();
