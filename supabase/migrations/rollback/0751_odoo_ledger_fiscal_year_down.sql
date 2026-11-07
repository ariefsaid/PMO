-- Reverse 0751: restore the 0744 page writer (no fiscal year).
begin;

create or replace function public.apply_odoo_ledger_page(p_org_id uuid, p_rows jsonb, p_cursor text)
returns integer language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_n integer;
  v_new jsonb;
  v_old jsonb;
begin
  if current_setting('role', true) <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  perform public.assert_odoo_activated(p_org_id);
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'rows must be an array' using errcode = '22023'; end if;
  begin
    v_new := p_cursor::jsonb;
  exception when others then
    raise exception 'malformed ledger cursor' using errcode = '22023';
  end;
  if jsonb_typeof(v_new) is distinct from 'object'
     or coalesce(v_new->>'w','2000-01-01 00:00:00') !~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$'
     or coalesce(v_new->>'id','0') !~ '^\d{1,15}$' then
    raise exception 'malformed ledger cursor' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_rows) r
              where public.odoo_ledger_line_id(r->>'erp_name') is null
                 or coalesce(r->>'voucher_no','') = '' or coalesce(r->>'account','') = ''
                 or coalesce(r->>'posting_date','') !~ '^\d{4}-\d{2}-\d{2}$'
                 or coalesce(r->>'source_write_date','') !~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$'
                 or coalesce(r->>'debit','') !~ '^-?\d+(\.\d+)?$' or coalesce(r->>'credit','') !~ '^-?\d+(\.\d+)?$'
                 or jsonb_typeof(r->'is_cancelled') is distinct from 'boolean') then
    raise exception 'malformed ledger row' using errcode = '22023';
  end if;

  with page as (
    select r->>'erp_name' as erp_name, public.odoo_ledger_line_id(r->>'erp_name') as line_id,
           r->>'account' as account, nullif(r->>'project','') as project, nullif(r->>'partner','') as party,
           r->>'voucher_no' as voucher_no, (r->>'posting_date')::date as posting_date,
           (r->>'debit')::numeric as debit, (r->>'credit')::numeric as credit,
           (r->>'is_cancelled')::boolean as is_cancelled, r->>'source_write_date' as w
      from jsonb_array_elements(p_rows) r
  ), up as (
    insert into public.erp_gl_entry_mirror as m (org_id, erp_name, account, project, party_type, party, voucher_type, voucher_no,
                                                 posting_date, debit, credit, is_cancelled, erp_docstatus, erp_modified)
    select p_org_id, erp_name, account, project, case when party is null then null else 'Partner' end, party, 'account.move',
           voucher_no, posting_date, debit, credit, is_cancelled, case when is_cancelled then 0 else 1 end, w
      from page p
     where not exists (select 1 from public.erp_gl_entry_mirror x
                        where x.org_id = p_org_id and x.voucher_type = 'account.move'
                          and public.odoo_ledger_line_id(x.erp_name) = p.line_id and x.erp_modified > p.w)
    on conflict (org_id, erp_name) do update set
      account = excluded.account, project = excluded.project, party_type = excluded.party_type, party = excluded.party,
      voucher_no = excluded.voucher_no, posting_date = excluded.posting_date, debit = excluded.debit, credit = excluded.credit,
      is_cancelled = excluded.is_cancelled, erp_docstatus = excluded.erp_docstatus, erp_modified = excluded.erp_modified,
      as_of = now()
    where m.erp_modified <= excluded.erp_modified
    returning 1
  )
  select count(*) into v_n from up;

  -- Rows of a page line that the page no longer carries, unless a newer write already replaced them.
  -- Candidates come from the per-line index (= any of the page's line ids), never a scan of the org's account.move set.
  with page as materialized (
    select r->>'erp_name' as erp_name, public.odoo_ledger_line_id(r->>'erp_name') as line_id, r->>'source_write_date' as w
      from jsonb_array_elements(p_rows) r
  ), lines as materialized (
    select line_id, max(w) as w from page group by line_id
  )
  delete from public.erp_gl_entry_mirror m
   where m.org_id = p_org_id and m.voucher_type = 'account.move'
     and public.odoo_ledger_line_id(m.erp_name) = any (array(select line_id from lines))
     and not exists (select 1 from page pg where pg.erp_name = m.erp_name)
     and m.erp_modified <= (select l.w from lines l where l.line_id = public.odoo_ledger_line_id(m.erp_name));

  -- Never rewind: the cursor moves only to an equal or later (w, id).
  select w.watermark_cursor::jsonb into v_old from public.external_sync_watermarks w
   where w.org_id = p_org_id and w.external_tier = 'odoo' and w.domain = 'ledger:odoo' and w.watermark_cursor like '{%';
  if v_old is null
     or (coalesce(v_new->>'w',''), coalesce((v_new->>'id')::bigint,0)) >= (coalesce(v_old->>'w',''), coalesce((v_old->>'id')::bigint,0)) then
    insert into public.external_sync_watermarks (org_id, external_tier, domain, watermark_cursor, updated_at)
    values (p_org_id, 'odoo', 'ledger:odoo', p_cursor, now())
    on conflict (org_id, external_tier, domain) do update set watermark_cursor = excluded.watermark_cursor, updated_at = now();
  end if;
  return v_n;
end $$;
revoke all on function public.apply_odoo_ledger_page(uuid,jsonb,text) from public, anon, authenticated;
grant execute on function public.apply_odoo_ledger_page(uuid,jsonb,text) to service_role;

notify pgrst, 'reload schema';

commit;
