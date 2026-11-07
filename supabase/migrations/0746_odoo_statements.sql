-- #1507 S5 — Odoo statements read from the ledger mirror (Trial Balance, Profit and Loss, Balance Sheet, project P&L).
-- Odoo Community has no statement-report API (V-ODA9), so PMO sums the mirrored posted lines; the ledger stays the oracle (ADR-0048).
-- Same envelope as get_financial_statement (state / companyLabel / generation / selection / result); the caller's org comes only
-- from the JWT. Accounts are classed by Odoo account_type from external_master_records (kind account). No closing logic here:
-- the Balance Sheet shows the ledger as Odoo has it plus two derived equity rows (current-year, previous-years earnings).
-- Fiscal year end: external_org_bindings.config.fiscal_year_end_month (string "1".."12"), else calendar year (OQ-ODA-3);
-- S3 does not mirror the company's fiscal-year fields yet.
-- Rollback: supabase/migrations/rollback/0746_odoo_statements_down.sql
begin;

-- Fiscal-year end month of the caller's org (binding config is member-readable).
create or replace function public.odoo_fiscal_end_month()
returns integer language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce((select case when b.config->>'fiscal_year_end_month' ~ '^([1-9]|1[0-2])$'
                               then (b.config->>'fiscal_year_end_month')::int end
                     from public.external_org_bindings b
                    where b.org_id = public.auth_org_id() and b.external_tier = 'odoo' and b.activated_at is not null
                    limit 1), 12)
$$;
revoke all on function public.odoo_fiscal_end_month() from public, anon, authenticated;
grant execute on function public.odoo_fiscal_end_month() to authenticated;

-- Project figures for every role that may see a project (Project Manager / Engineer cannot read the mirror under RLS).
-- p_ranges null: posting-date bounds and ledger as-of. Else [{from,to}...]: income / expense per range.
-- Totals only, one project, caller's org from the JWT; refuses a project that is not the caller's or not linked to exactly one account.
create or replace function public.odoo_project_ledger(p_project_id uuid, p_ranges jsonb default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_acc text;
  v_out jsonb;
begin
  if v_org is null or not coalesce(public.is_active_member(), false)
     or public.auth_role()::text not in ('Admin','Finance','Executive','Project Manager','Engineer') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if p_project_id is null or not exists (select 1 from public.projects p where p.id = p_project_id and p.org_id = v_org) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  select b.external_container_id into v_acc from public.external_project_bindings b
   where b.org_id = v_org and b.project_id = p_project_id and b.external_tier = 'odoo';
  if v_acc is null or exists (select 1 from public.external_project_bindings o
                               where o.org_id = v_org and o.external_tier = 'odoo' and o.external_container_id = v_acc
                                 and o.project_id <> p_project_id) then
    return jsonb_build_object('linked', false);
  end if;
  if p_ranges is null then
    return jsonb_build_object('linked', true,
      'minDate', (select min(m.posting_date) from public.erp_gl_entry_mirror m
                   where m.org_id = v_org and m.voucher_type = 'account.move' and not m.is_cancelled and m.project = v_acc),
      'maxDate', (select max(m.posting_date) from public.erp_gl_entry_mirror m
                   where m.org_id = v_org and m.voucher_type = 'account.move' and not m.is_cancelled and m.project = v_acc),
      'ledgerAsOf', (select w.updated_at from public.external_sync_watermarks w
                      where w.org_id = v_org and w.external_tier = 'odoo' and w.domain = 'ledger:odoo'));
  end if;
  if jsonb_typeof(p_ranges) is distinct from 'array' then raise exception 'Invalid statement selection' using errcode = '22023'; end if;
  select jsonb_build_object('linked', true,
    'ledgerAsOf', (select w.updated_at from public.external_sync_watermarks w
                    where w.org_id = v_org and w.external_tier = 'odoo' and w.domain = 'ledger:odoo'),
    'ranges', coalesce(jsonb_agg(jsonb_build_object(
      'income',  (select coalesce(sum(coalesce(m.credit,0) - coalesce(m.debit,0)), 0)
                    from public.erp_gl_entry_mirror m
                    join lateral (select r.attrs->>'account_type' t from public.external_master_records r
                                   where r.org_id = v_org and r.external_tier = 'odoo' and r.kind = 'account'
                                     and r.code = m.account and r.tombstoned_at is null order by r.active desc, r.id limit 1) a on true
                   where m.org_id = v_org and m.voucher_type = 'account.move' and not m.is_cancelled and m.project = v_acc
                     and m.posting_date between (x->>'from')::date and (x->>'to')::date and a.t like 'income%'),
      'expense', (select coalesce(sum(coalesce(m.debit,0) - coalesce(m.credit,0)), 0)
                    from public.erp_gl_entry_mirror m
                    join lateral (select r.attrs->>'account_type' t from public.external_master_records r
                                   where r.org_id = v_org and r.external_tier = 'odoo' and r.kind = 'account'
                                     and r.code = m.account and r.tombstoned_at is null order by r.active desc, r.id limit 1) a on true
                   where m.org_id = v_org and m.voucher_type = 'account.move' and not m.is_cancelled and m.project = v_acc
                     and m.posting_date between (x->>'from')::date and (x->>'to')::date and a.t like 'expense%')
    ) order by ord), '[]'::jsonb)) into v_out
  from jsonb_array_elements(p_ranges) with ordinality as t(x, ord);
  return v_out;
end $$;
revoke all on function public.odoo_project_ledger(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.odoo_project_ledger(uuid, jsonb) to authenticated;

create or replace function public.get_odoo_statement(p_kind text, p_period jsonb, p_project_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_role text := public.auth_role()::text;
  v_fy int;
  v_pk text; v_start date; v_n int; v_off int;
  v_cs date; v_ce date; v_ps date; v_pe date;
  v_acc text;
  v_wide boolean;
  v_s date; v_e date; v_side int;
  v_accts jsonb; v_rep jsonb;
  v_cur jsonb; v_pri jsonb; v_prov jsonb;
  v_asof timestamptz;
  v_proj jsonb;
  v_has boolean;
  v_company text;
begin
  if p_kind is null or p_kind not in ('trial_balance','profit_and_loss','balance_sheet')
     or p_period is null or jsonb_typeof(p_period) <> 'object'
     or exists (select 1 from jsonb_object_keys(p_period) k where k not in ('kind','start'))
     or coalesce(p_period->>'kind','') not in ('month','quarter','fiscal_year')
     or coalesce(p_period->>'start','') !~ '^\d{4}-\d{2}-01$' then
    raise exception 'Invalid statement selection' using errcode = '22023';
  end if;
  if p_project_id is not null and p_kind <> 'profit_and_loss' then
    raise exception 'Invalid statement selection' using errcode = '22023';
  end if;
  if v_org is null or not coalesce(public.is_active_member(), false)
     or v_role not in ('Admin','Finance','Executive','Project Manager','Engineer') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  v_wide := v_role in ('Admin','Finance','Executive');
  if not v_wide and p_project_id is null then raise exception 'Not permitted' using errcode = '42501'; end if;
  if p_project_id is not null and not exists (select 1 from public.projects p where p.id = p_project_id and p.org_id = v_org) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;

  begin
    v_start := (p_period->>'start')::date;
  exception when others then
    raise exception 'Invalid statement selection' using errcode = '22023';
  end;
  v_pk := p_period->>'kind';
  v_fy := public.odoo_fiscal_end_month();
  v_n := case v_pk when 'month' then 1 when 'quarter' then 3 else 12 end;
  v_off := (extract(month from v_start)::int - (v_fy % 12 + 1) + 12) % 12;
  if (v_pk = 'quarter' and v_off % 3 <> 0) or (v_pk = 'fiscal_year' and v_off <> 0) then
    raise exception 'Invalid statement selection' using errcode = '22023';
  end if;
  v_cs := v_start; v_ce := (v_start + make_interval(months => v_n))::date - 1;
  v_ps := (v_start - make_interval(months => v_n))::date; v_pe := v_start - 1;

  if not exists (select 1 from public.external_org_bindings b
                  where b.org_id = v_org and b.external_tier = 'odoo' and b.activated_at is not null) then
    return jsonb_build_object('state', 'not_in_use');
  end if;
  select m.name into v_company from public.external_master_records m
   where m.org_id = v_org and m.external_tier = 'odoo' and m.kind = 'company' and m.tombstoned_at is null order by m.active desc, m.id limit 1;
  select w.updated_at into v_asof from public.external_sync_watermarks w
   where w.org_id = v_org and w.external_tier = 'odoo' and w.domain = 'ledger:odoo';

  if p_project_id is not null then
    select b.external_container_id into v_acc from public.external_project_bindings b
     where b.org_id = v_org and b.project_id = p_project_id and b.external_tier = 'odoo';
    if v_acc is null or exists (select 1 from public.external_project_bindings o
                                 where o.org_id = v_org and o.external_tier = 'odoo' and o.external_container_id = v_acc
                                   and o.project_id <> p_project_id) then
      return jsonb_build_object('state', 'unlinked', 'companyLabel', v_company,
        'selection', jsonb_build_object('periodKind', v_pk, 'periodStart', v_cs::text, 'statement', p_kind, 'scopeKind', 'project', 'projectId', p_project_id));
    end if;
    if not v_wide then
      -- Project Manager / Engineer: totals only, through the narrow project reader.
      v_proj := public.odoo_project_ledger(p_project_id, jsonb_build_array(
        jsonb_build_object('from', v_cs, 'to', v_ce), jsonb_build_object('from', v_ps, 'to', v_pe)));
      return jsonb_build_object('state', 'complete', 'companyLabel', v_company,
        'generation', jsonb_build_object('asOf', v_asof),
        'selection', jsonb_build_object('periodKind', v_pk, 'periodStart', v_cs::text, 'statement', p_kind, 'scopeKind', 'project', 'projectId', p_project_id, 'viewKind', 'project_totals'),
        'result', jsonb_build_object('viewKind', 'project_totals',
          'period', jsonb_build_object('kind', v_pk, 'currentStart', v_cs::text, 'currentEnd', v_ce::text, 'priorStart', v_ps::text, 'priorEnd', v_pe::text),
          'hasActivity', exists (select 1 from jsonb_array_elements(v_proj->'ranges') x where (x->>'income')::numeric <> 0 or (x->>'expense')::numeric <> 0),
          'payload', jsonb_build_object(
            'current', jsonb_build_object('income', v_proj#>'{ranges,0,income}', 'expense', v_proj#>'{ranges,0,expense}',
                                          'net', (v_proj#>>'{ranges,0,income}')::numeric - (v_proj#>>'{ranges,0,expense}')::numeric),
            'prior',   jsonb_build_object('income', v_proj#>'{ranges,1,income}', 'expense', v_proj#>'{ranges,1,expense}',
                                          'net', (v_proj#>>'{ranges,1,income}')::numeric - (v_proj#>>'{ranges,1,expense}')::numeric)),
          'provenance', jsonb_build_object('ledgerAsOf', v_asof)));
    end if;
  end if;

  for v_side in 1..2 loop
    v_s := case v_side when 1 then v_cs else v_ps end;
    v_e := case v_side when 1 then v_ce else v_pe end;
    -- One pass over the mirror: per account opening, period, cumulative and fiscal-year-to-date nets.
    select coalesce(jsonb_agg(jsonb_build_object(
             'account', g.account, 'name', a.name, 'type', a.t,
             'open_net', g.open_net, 'pd', g.pd, 'pc', g.pc, 'cum_net', g.cum_net, 'fy_net', g.fy_net) order by g.account), '[]'::jsonb)
      into v_accts
      from (select m.account,
                   coalesce(sum(coalesce(m.debit,0) - coalesce(m.credit,0)) filter (where m.posting_date < v_s), 0) as open_net,
                   coalesce(sum(coalesce(m.debit,0)) filter (where m.posting_date >= v_s), 0) as pd,
                   coalesce(sum(coalesce(m.credit,0)) filter (where m.posting_date >= v_s), 0) as pc,
                   coalesce(sum(coalesce(m.debit,0) - coalesce(m.credit,0)), 0) as cum_net,
                   coalesce(sum(coalesce(m.debit,0) - coalesce(m.credit,0))
                     filter (where m.posting_date >= (date_trunc('month', v_e) - make_interval(months => (extract(month from v_e)::int - (v_fy % 12 + 1) + 12) % 12))::date), 0) as fy_net
              from public.erp_gl_entry_mirror m
             where m.org_id = v_org and m.voucher_type = 'account.move' and not m.is_cancelled
               and m.posting_date <= v_e and (v_acc is null or m.project = v_acc)
             group by m.account) g
      left join lateral (select r.name, r.attrs->>'account_type' t from public.external_master_records r
                          where r.org_id = v_org and r.external_tier = 'odoo' and r.kind = 'account'
                            and r.code = g.account and r.tombstoned_at is null order by r.active desc, r.id limit 1) a on true;

    if p_kind = 'trial_balance' then
      select jsonb_build_object(
        'columns', jsonb_build_array(
          jsonb_build_object('fieldname','account','label','Account','type','text'),
          jsonb_build_object('fieldname','account_name','label','Name','type','text'),
          jsonb_build_object('fieldname','opening_debit','label','Opening debit','type','currency'),
          jsonb_build_object('fieldname','opening_credit','label','Opening credit','type','currency'),
          jsonb_build_object('fieldname','debit','label','Debit','type','currency'),
          jsonb_build_object('fieldname','credit','label','Credit','type','currency'),
          jsonb_build_object('fieldname','closing_debit','label','Closing debit','type','currency'),
          jsonb_build_object('fieldname','closing_credit','label','Closing credit','type','currency')),
        'rows', coalesce(jsonb_agg(jsonb_build_object(
            'account', x.account, 'account_name', x.name, 'account_type', x.type,
            'opening_debit', greatest(x.open_net, 0), 'opening_credit', greatest(-x.open_net, 0),
            'debit', x.pd, 'credit', x.pc,
            'closing_debit', greatest(x.open_net + x.pd - x.pc, 0), 'closing_credit', greatest(-(x.open_net + x.pd - x.pc), 0)
          ) order by x.account), '[]'::jsonb),
        'summary', jsonb_build_array(jsonb_build_object(
            'total_debit', coalesce(sum(x.pd), 0), 'total_credit', coalesce(sum(x.pc), 0),
            'opening_debit', coalesce(sum(greatest(x.open_net, 0)), 0), 'opening_credit', coalesce(sum(greatest(-x.open_net, 0)), 0),
            'closing_debit', coalesce(sum(greatest(x.open_net + x.pd - x.pc, 0)), 0),
            'closing_credit', coalesce(sum(greatest(-(x.open_net + x.pd - x.pc), 0)), 0))))
        into v_rep
        from jsonb_to_recordset(v_accts) as x(account text, name text, type text, open_net numeric, pd numeric, pc numeric, cum_net numeric, fy_net numeric)
       where x.open_net <> 0 or x.pd <> 0 or x.pc <> 0;
    elsif p_kind = 'profit_and_loss' then
      select jsonb_build_object(
        'columns', jsonb_build_array(
          jsonb_build_object('fieldname','account','label','Account','type','text'),
          jsonb_build_object('fieldname','account_name','label','Name','type','text'),
          jsonb_build_object('fieldname','amount','label','Amount','type','currency')),
        'rows', coalesce(jsonb_agg(jsonb_build_object(
            'account', x.account, 'account_name', x.name, 'account_type', x.type,
            'section', case when x.type like 'income%' then 'income' else 'expense' end,
            'amount', case when x.type like 'income%' then x.pc - x.pd else x.pd - x.pc end
          ) order by x.account), '[]'::jsonb),
        'summary', jsonb_build_array(jsonb_build_object(
            'income', coalesce(sum(x.pc - x.pd) filter (where x.type like 'income%'), 0),
            'expense', coalesce(sum(x.pd - x.pc) filter (where x.type like 'expense%'), 0),
            'net', coalesce(sum(x.pc - x.pd) filter (where x.type like 'income%'), 0)
                 - coalesce(sum(x.pd - x.pc) filter (where x.type like 'expense%'), 0))))
        into v_rep
        from jsonb_to_recordset(v_accts) as x(account text, name text, type text, open_net numeric, pd numeric, pc numeric, cum_net numeric, fy_net numeric)
       where (x.type like 'income%' or x.type like 'expense%') and (x.pd <> 0 or x.pc <> 0);
    else
      select jsonb_build_object(
        'columns', jsonb_build_array(
          jsonb_build_object('fieldname','account','label','Account','type','text'),
          jsonb_build_object('fieldname','account_name','label','Name','type','text'),
          jsonb_build_object('fieldname','balance','label','Balance','type','currency')),
        'rows', (
          coalesce((select jsonb_agg(jsonb_build_object(
              'row_kind', 'account', 'account', x.account, 'account_name', x.name, 'account_type', x.type,
              'section', case when x.type like 'asset%' then 'asset' when x.type like 'liability%' then 'liability' else 'equity' end,
              'balance', case when x.type like 'asset%' then x.cum_net else -x.cum_net end) order by x.account)
            from jsonb_to_recordset(v_accts) as x(account text, name text, type text, open_net numeric, pd numeric, pc numeric, cum_net numeric, fy_net numeric)
           where (x.type like 'asset%' or x.type like 'liability%' or x.type like 'equity%') and x.cum_net <> 0), '[]'::jsonb)
          || jsonb_build_array(
            jsonb_build_object('row_kind','current_year_earnings','section','equity','account_name','Current-year earnings','derived',true,
              'balance', -coalesce(sum(y.fy_net) filter (where y.type like 'income%' or y.type like 'expense%'), 0)),
            jsonb_build_object('row_kind','previous_years_earnings','section','equity','account_name','Previous years'' earnings','derived',true,
              'balance', -coalesce(sum(y.cum_net - y.fy_net) filter (where y.type like 'income%' or y.type like 'expense%'), 0)))),
        'summary', jsonb_build_array(jsonb_build_object(
            'total_assets', coalesce(sum(y.cum_net) filter (where y.type like 'asset%'), 0),
            'total_liabilities_equity',
              -coalesce(sum(y.cum_net) filter (where y.type like 'liability%' or y.type like 'equity%'), 0)
              - coalesce(sum(y.cum_net) filter (where y.type like 'income%' or y.type like 'expense%'), 0),
            'difference',
              coalesce(sum(y.cum_net) filter (where y.type like 'asset%'), 0)
              + coalesce(sum(y.cum_net) filter (where y.type like 'liability%' or y.type like 'equity%'), 0)
              + coalesce(sum(y.cum_net) filter (where y.type like 'income%' or y.type like 'expense%'), 0),
            'balanced',
              coalesce(sum(y.cum_net) filter (where y.type like 'asset%'), 0)
              + coalesce(sum(y.cum_net) filter (where y.type like 'liability%' or y.type like 'equity%'), 0)
              + coalesce(sum(y.cum_net) filter (where y.type like 'income%' or y.type like 'expense%'), 0) = 0)))
        into v_rep
        from jsonb_to_recordset(v_accts) as y(account text, name text, type text, open_net numeric, pd numeric, pc numeric, cum_net numeric, fy_net numeric);
    end if;
    if v_side = 1 then v_cur := v_rep; v_has := exists (select 1 from jsonb_to_recordset(v_accts) as z(pd numeric, pc numeric) where z.pd <> 0 or z.pc <> 0);
    else v_pri := v_rep; end if;
    if v_side = 1 then
      -- Provenance of the current period: what is not in a project, not linked, or has no account record.
      v_prov := jsonb_build_object(
        'ledgerAsOf', v_asof, 'caughtUp', null, 'lastCheck', null, 'scope', case when v_acc is null then 'company' else 'project' end,
        'unattributed', (select jsonb_build_object('count', count(*), 'debit', coalesce(sum(coalesce(m.debit,0)),0), 'credit', coalesce(sum(coalesce(m.credit,0)),0))
                           from public.erp_gl_entry_mirror m
                          where m.org_id = v_org and m.voucher_type = 'account.move' and not m.is_cancelled
                            and m.posting_date between v_cs and v_ce and m.project is null),
        'unlinked', (select jsonb_build_object('count', count(*), 'debit', coalesce(sum(coalesce(m.debit,0)),0), 'credit', coalesce(sum(coalesce(m.credit,0)),0))
                       from public.erp_gl_entry_mirror m
                      where m.org_id = v_org and m.voucher_type = 'account.move' and not m.is_cancelled
                        and m.posting_date between v_cs and v_ce and m.project is not null
                        and m.project not in (select b.external_container_id from public.external_project_bindings b
                                               where b.org_id = v_org and b.external_tier = 'odoo'
                                               group by b.external_container_id having count(*) = 1)),
        'unclassified', (select jsonb_build_object('count', count(*), 'debit', coalesce(sum(z.pd),0), 'credit', coalesce(sum(z.pc),0))
                           from jsonb_to_recordset(v_accts) as z(type text, pd numeric, pc numeric) where z.type is null and (z.pd <> 0 or z.pc <> 0)));
    end if;
  end loop;

  return jsonb_build_object(
    'state', 'complete', 'companyLabel', v_company,
    'generation', jsonb_build_object('asOf', v_asof),
    'selection', jsonb_build_object('periodKind', v_pk, 'periodStart', v_cs::text, 'statement', p_kind,
      'scopeKind', case when v_acc is null then 'company' else 'project' end, 'projectId', p_project_id, 'viewKind', 'account_breakdown'),
    'result', jsonb_build_object('viewKind', 'account_breakdown',
      'period', jsonb_build_object('kind', v_pk, 'currentStart', v_cs::text, 'currentEnd', v_ce::text, 'priorStart', v_ps::text, 'priorEnd', v_pe::text),
      'hasActivity', coalesce(v_has, false),
      'payload', jsonb_build_object('current', v_cur, 'prior', v_pri),
      'provenance', v_prov));
end $$;
revoke all on function public.get_odoo_statement(text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.get_odoo_statement(text, jsonb, uuid) to authenticated;

-- Month / quarter / fiscal-year choices between the earliest and latest posting dates (no custom dates, OQ001 of #897).
create or replace function public.get_odoo_statement_catalogue(p_project_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_role text := public.auth_role()::text;
  v_fy int := public.odoo_fiscal_end_month();
  v_min date; v_max date; v_proj jsonb;
  v_asof timestamptz;
begin
  if v_org is null or not coalesce(public.is_active_member(), false)
     or v_role not in ('Admin','Finance','Executive','Project Manager','Engineer') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if p_project_id is null and v_role not in ('Admin','Finance','Executive') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if p_project_id is not null and not exists (select 1 from public.projects p where p.id = p_project_id and p.org_id = v_org) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.external_org_bindings b
                  where b.org_id = v_org and b.external_tier = 'odoo' and b.activated_at is not null) then
    return jsonb_build_object('state', 'not_in_use');
  end if;
  select w.updated_at into v_asof from public.external_sync_watermarks w
   where w.org_id = v_org and w.external_tier = 'odoo' and w.domain = 'ledger:odoo';
  if p_project_id is null then
    select min(m.posting_date), max(m.posting_date) into v_min, v_max from public.erp_gl_entry_mirror m
     where m.org_id = v_org and m.voucher_type = 'account.move' and not m.is_cancelled;
  else
    v_proj := public.odoo_project_ledger(p_project_id);
    if not (v_proj->>'linked')::boolean then
      return jsonb_build_object('state', 'unlinked', 'periods', '[]'::jsonb);
    end if;
    v_min := (v_proj->>'minDate')::date; v_max := (v_proj->>'maxDate')::date;
  end if;
  if v_min is null then
    return jsonb_build_object('state', 'empty', 'fiscalYearEndMonth', v_fy, 'ledgerAsOf', v_asof, 'periods', '[]'::jsonb);
  end if;
  return jsonb_build_object('state', 'complete', 'fiscalYearEndMonth', v_fy, 'ledgerAsOf', v_asof, 'periods', (
    select coalesce(jsonb_agg(jsonb_build_object('kind', k.kind, 'currentStart', k.s::text,
             'currentEnd', ((k.s + make_interval(months => k.n))::date - 1)::text,
             'priorStart', (k.s - make_interval(months => k.n))::date::text, 'priorEnd', (k.s - 1)::text)
           order by k.s, case k.kind when 'month' then 0 when 'quarter' then 1 else 2 end), '[]'::jsonb)
    from (select 'month' as kind, 1 as n, d::date as s
            from generate_series(date_trunc('month', v_min), date_trunc('month', v_max), interval '1 month') d
          union all
          select 'quarter', 3, d::date
            from generate_series(date_trunc('month', v_min) - make_interval(months => ((extract(month from v_min)::int - (v_fy % 12 + 1) + 12) % 12) % 3),
                                 date_trunc('month', v_max), interval '3 months') d
          union all
          select 'fiscal_year', 12, d::date
            from generate_series(date_trunc('month', v_min) - make_interval(months => (extract(month from v_min)::int - (v_fy % 12 + 1) + 12) % 12),
                                 date_trunc('month', v_max), interval '12 months') d) k));
end $$;
revoke all on function public.get_odoo_statement_catalogue(uuid) from public, anon, authenticated;
grant execute on function public.get_odoo_statement_catalogue(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
