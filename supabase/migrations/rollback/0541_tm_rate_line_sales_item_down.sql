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

alter table public.contract_rate_lines
  drop constraint contract_rate_lines_sales_item_code_shape,
  drop column sales_item_code;
