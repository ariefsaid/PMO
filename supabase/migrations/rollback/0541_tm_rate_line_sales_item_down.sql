-- Restore the 0515 single-line writer before removing the metadata it adds.
create or replace function public.save_contract_rate_line(p_line jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_is_active_member();
  if coalesce(public.auth_role()::text, '') not in ('Admin', 'Finance') then
    raise exception 'not authorized to save contract rates' using errcode = '42501';
  end if;
  return public.contract_rate_line_write(p_line, 'update');
end $$;

revoke all on function public.save_contract_rate_line(jsonb) from public, anon, authenticated;
grant execute on function public.save_contract_rate_line(jsonb) to authenticated;
alter function public.save_contract_rate_line(jsonb) owner to postgres;

-- Restore the 0515 ending path before removing the sales-item column.
create or replace function public.end_contract_rate_line(p_project uuid, p_line_key uuid, p_effective_to date, p_expected_version integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_line public.contract_rate_lines;
  v_currency text;
begin
  perform public.assert_is_active_member();
  if coalesce(public.auth_role()::text, '') not in ('Admin', 'Finance') then
    raise exception 'not authorized to end contract rates' using errcode = '42501';
  end if;
  if p_effective_to is null then raise exception 'effective_to is required' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('contract_rates:' || public.auth_org_id()::text, 0));
  select * into v_line from public.contract_rate_lines l
   where l.org_id = public.auth_org_id() and l.project_id = p_project and l.line_key = p_line_key and l.is_current for update;
  if not found then raise exception 'rate line not found' using errcode = 'P0002'; end if;
  select p.currency into v_currency from public.projects p where p.id = p_project and p.org_id = public.auth_org_id();
  return public.contract_rate_line_write(jsonb_build_object(
    'project_id', p_project, 'line_key', p_line_key, 'expected_version', p_expected_version,
    'kind', v_line.kind, 'label', v_line.label, 'unit', v_line.unit, 'rate', v_line.rate,
    'currency', v_currency, 'effective_from', v_line.effective_from, 'effective_to', p_effective_to
  ), 'end');
end $$;

revoke all on function public.end_contract_rate_line(uuid, uuid, date, integer) from public, anon, authenticated;
grant execute on function public.end_contract_rate_line(uuid, uuid, date, integer) to authenticated;
alter function public.end_contract_rate_line(uuid, uuid, date, integer) owner to postgres;

alter table public.contract_rate_lines
  drop constraint contract_rate_lines_sales_item_code_shape,
  drop column sales_item_code;
