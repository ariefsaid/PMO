-- Atomic full-chart replacement; service_role-only PostgREST boundary.
-- Rollback: rollback/0296_replace_erp_account_chart_down.sql
create or replace function public.replace_erp_account_chart(p_org_id uuid, p_company text, p_rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  upserted_count integer;
  deleted_count integer;
begin
  if p_org_id is null or p_company is null or btrim(p_company) = '' or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'invalid account chart replacement' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_rows) as r(org_id uuid, company text, erp_name text)
    where r.org_id is distinct from p_org_id or r.company is distinct from p_company or r.erp_name is null or r.erp_name = ''
  ) or (select count(*) <> count(distinct r.erp_name) from jsonb_to_recordset(p_rows) as r(erp_name text)) then
    raise exception 'invalid or duplicate account chart identity' using errcode = '22023';
  end if;

  insert into public.erp_account_mirror (
    org_id, company, erp_name, account_name, root_type, report_type, parent_account,
    is_group, account_number, account_currency, lft, rgt, account_type,
    include_in_gross, disabled, erp_modified, as_of, refresh_id
  )
  select r.org_id, r.company, r.erp_name, r.account_name, r.root_type, r.report_type, r.parent_account,
    r.is_group, r.account_number, r.account_currency, r.lft, r.rgt, r.account_type,
    r.include_in_gross, r.disabled, r.erp_modified, r.as_of, r.refresh_id
  from jsonb_to_recordset(p_rows) as r(
    org_id uuid, company text, erp_name text, account_name text, root_type text, report_type text,
    parent_account text, is_group boolean, account_number text, account_currency text,
    lft integer, rgt integer, account_type text, include_in_gross boolean, disabled boolean,
    erp_modified timestamptz, as_of timestamptz, refresh_id uuid
  )
  on conflict (org_id, company, erp_name) do update set
    account_name = excluded.account_name, root_type = excluded.root_type, report_type = excluded.report_type,
    parent_account = excluded.parent_account, is_group = excluded.is_group, account_number = excluded.account_number,
    account_currency = excluded.account_currency, lft = excluded.lft, rgt = excluded.rgt,
    account_type = excluded.account_type, include_in_gross = excluded.include_in_gross,
    disabled = excluded.disabled, erp_modified = excluded.erp_modified, as_of = excluded.as_of,
    refresh_id = excluded.refresh_id;
  get diagnostics upserted_count = row_count;

  delete from public.erp_account_mirror a
  where a.org_id = p_org_id and a.company = p_company
    and not exists (select 1 from jsonb_to_recordset(p_rows) as r(erp_name text) where r.erp_name = a.erp_name);
  get diagnostics deleted_count = row_count;
  return jsonb_build_object('upserted', upserted_count, 'deleted', deleted_count);
end;
$$;
revoke execute on function public.replace_erp_account_chart(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.replace_erp_account_chart(uuid, text, jsonb) to service_role;
