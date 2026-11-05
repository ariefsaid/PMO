-- Rollback of 0686: drop the remark column, restore the 0382 voucher-replace body.
alter table public.erp_gl_entry_mirror drop column remarks;

create or replace function public.replace_erp_gl_voucher_rows(
  p_org_id uuid, p_company text, p_voucher_type text, p_voucher_no text, p_rows jsonb, p_current_names text[]
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  upserted_count integer;
  deleted_count integer;
begin
  if not public.erp_ledger_voucher_replace_check(p_org_id, p_company, p_voucher_type, p_voucher_no, p_rows, p_current_names) then
    return jsonb_build_object('upserted', 0, 'deleted', 0, 'stale_binding', true);
  end if;

  insert into public.erp_gl_entry_mirror as m (
    org_id, erp_name, company, is_opening, finance_book, account, cost_center, fiscal_year, project,
    party_type, party, voucher_type, voucher_no, posting_date, debit, credit, is_cancelled, erp_docstatus, erp_modified)
  select p_org_id, r.erp_name, p_company, r.is_opening, r.finance_book, r.account, r.cost_center, r.fiscal_year, r.project,
         r.party_type, r.party, r.voucher_type, r.voucher_no, r.posting_date, r.debit, r.credit,
         coalesce(r.is_cancelled, false), r.erp_docstatus, r.erp_modified
    from jsonb_populate_recordset(null::public.erp_gl_entry_mirror, p_rows) r
  on conflict (org_id, erp_name) do update set
    company = excluded.company, is_opening = excluded.is_opening, finance_book = excluded.finance_book,
    account = excluded.account, cost_center = excluded.cost_center, fiscal_year = excluded.fiscal_year,
    project = excluded.project, party_type = excluded.party_type, party = excluded.party,
    voucher_type = excluded.voucher_type, voucher_no = excluded.voucher_no, posting_date = excluded.posting_date,
    debit = excluded.debit, credit = excluded.credit, is_cancelled = excluded.is_cancelled,
    erp_docstatus = excluded.erp_docstatus, erp_modified = excluded.erp_modified
  where m.erp_modified <= excluded.erp_modified;
  get diagnostics upserted_count = row_count;

  -- This company's rows of the voucher (and legacy NULL-company ones) that ERPNext no longer has.
  delete from public.erp_gl_entry_mirror m
   where m.org_id = p_org_id
     and m.voucher_type = p_voucher_type
     and m.voucher_no = p_voucher_no
     and (m.company = p_company or m.company is null)
     and m.erp_name <> all (p_current_names);
  get diagnostics deleted_count = row_count;

  return jsonb_build_object('upserted', upserted_count, 'deleted', deleted_count);
end;
$$;
revoke execute on function public.replace_erp_gl_voucher_rows(uuid, text, text, text, jsonb, text[]) from public, anon, authenticated;
grant execute on function public.replace_erp_gl_voucher_rows(uuid, text, text, text, jsonb, text[]) to service_role;
