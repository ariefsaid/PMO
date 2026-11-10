-- Rollback of 0790_odoo_ledger_lines_total.sql (#2064): the lines read goes back to 0764's body (no `total`).
begin;
create or replace function public.get_odoo_ledger_lines(p_project_id uuid, p_category text, p_after text default null, p_limit integer default 50)
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_acc text;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_after uuid;
  v_cat public.budget_category;
  v_rows jsonb;
  v_n integer;
begin
  if v_org is null or not coalesce(public.is_active_member(), false) or public.auth_role()::text not in ('Admin','Finance','Executive') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if p_project_id is null or not exists (select 1 from public.projects p where p.id = p_project_id and p.org_id = v_org) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  begin
    v_cat := p_category::public.budget_category;
    v_after := nullif(p_after, '')::uuid;
  exception when others then
    raise exception 'Invalid line request' using errcode = '22023';
  end;
  select b.external_container_id into v_acc from public.external_project_bindings b
   where b.org_id = v_org and b.project_id = p_project_id and b.external_tier = 'odoo';
  -- An analytic account claimed by two projects is unattributed (OBS-ODA-002): no lines for either.
  if v_acc is null or exists (select 1 from public.external_project_bindings o where o.org_id = v_org and o.external_tier = 'odoo'
                                and o.external_container_id = v_acc and o.project_id <> p_project_id) then
    return jsonb_build_object('lines', '[]'::jsonb, 'next', null, 'limit', v_limit, 'linked', false);
  end if;
  with page as (
    select m.id, m.posting_date, m.voucher_no, m.account, m.party, coalesce(m.debit,0) debit, coalesce(m.credit,0) credit
      from public.erp_gl_entry_mirror m
     where m.org_id = v_org and m.voucher_type = 'account.move' and not m.is_cancelled and m.project = v_acc
       and exists (select 1 from public.budget_category_account_map k where k.org_id = v_org and k.category = v_cat and k.erp_account = m.account)
       and (v_after is null or m.id > v_after)
     order by m.id limit v_limit + 1
  ), shown as (select * from page order by id limit v_limit)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'date', posting_date, 'moveName', voucher_no, 'account', account, 'partner', party,
                                               'debit', round(debit, 2)::text, 'credit', round(credit, 2)::text) order by id), '[]'::jsonb),
         (select count(*) from page)
    into v_rows, v_n from shown;
  return jsonb_build_object('lines', v_rows, 'limit', v_limit, 'linked', true,
    'next', case when v_n > v_limit then v_rows->(v_limit - 1)->>'id' end);
end $$;
revoke all on function public.get_odoo_ledger_lines(uuid,text,text,integer) from public, anon, authenticated;
grant execute on function public.get_odoo_ledger_lines(uuid,text,text,integer) to authenticated;
notify pgrst, 'reload schema';
commit;
