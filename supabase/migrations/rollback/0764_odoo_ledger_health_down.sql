-- Rollback of 0764_odoo_ledger_health.sql (#1507 S4). The statement reader goes back to 0746's body (null caughtUp / lastCheck) before the table it read is dropped.
begin;
create or replace function public.get_odoo_statement(p_kind text, p_period jsonb, p_project_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_role text := public.auth_role()::text;
  v_fy int;
  v_pk text; v_start date;
  v_cs date; v_ce date; v_ps date; v_pe date;
  v_acc text;
  v_wide boolean;
  v_s date; v_e date; v_side int;
  v_accts jsonb; v_rep jsonb;
  v_cur jsonb; v_pri jsonb; v_prov jsonb;
  v_gen jsonb;
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
  select pb.cs, pb.ce, pb.ps, pb.pe into v_cs, v_ce, v_ps, v_pe from public.odoo_period_bounds(v_pk, v_start, v_fy) pb;

  if not public.odoo_ledger_in_use() then
    return jsonb_build_object('state', 'not_in_use');
  end if;
  select m.name into v_company from public.external_master_records m
   where m.org_id = v_org and m.external_tier = 'odoo' and m.kind = 'company' and m.tombstoned_at is null order by m.active desc, m.id limit 1;
  v_gen := public.odoo_statement_generation();

  if p_project_id is not null then
    select b.external_container_id into v_acc from public.external_project_bindings b
     where b.org_id = v_org and b.project_id = p_project_id and b.external_tier = 'odoo';
    if v_acc is null or exists (select 1 from public.external_project_bindings o
                                 where o.org_id = v_org and o.external_tier = 'odoo' and o.external_container_id = v_acc
                                   and o.project_id <> p_project_id) then
      return jsonb_build_object('state', 'unavailable', 'companyLabel', v_company, 'generation', null,
        'selection', jsonb_build_object('periodKind', v_pk, 'periodStart', v_cs::text, 'statement', p_kind, 'scopeKind', 'project', 'projectId', p_project_id,
          'viewKind', case when v_wide then 'account_breakdown' else 'project_totals' end),
        'result', null);
    end if;
    if not v_wide then
      -- Project Manager / Engineer: totals only, through the narrow project reader.
      v_proj := public.odoo_project_ledger(p_project_id, v_pk, v_start);
      return jsonb_build_object('state', 'complete', 'companyLabel', v_company, 'generation', v_gen,
        'selection', jsonb_build_object('periodKind', v_pk, 'periodStart', v_cs::text, 'statement', p_kind, 'scopeKind', 'project', 'projectId', p_project_id, 'viewKind', 'project_totals'),
        'result', jsonb_build_object('viewKind', 'project_totals',
          'period', jsonb_build_object('kind', v_pk, 'currentStart', v_cs::text, 'currentEnd', v_ce::text, 'priorStart', v_ps::text, 'priorEnd', v_pe::text),
          'hasActivity', (v_proj#>>'{current,income}')::numeric <> 0 or (v_proj#>>'{current,expense}')::numeric <> 0
                      or (v_proj#>>'{prior,income}')::numeric <> 0 or (v_proj#>>'{prior,expense}')::numeric <> 0,
          'payload', jsonb_build_object(
            'current', jsonb_build_object('income', v_proj#>>'{current,income}', 'expense', v_proj#>>'{current,expense}',
                                          'net', ((v_proj#>>'{current,income}')::numeric - (v_proj#>>'{current,expense}')::numeric)::text),
            'prior',   jsonb_build_object('income', v_proj#>>'{prior,income}', 'expense', v_proj#>>'{prior,expense}',
                                          'net', ((v_proj#>>'{prior,income}')::numeric - (v_proj#>>'{prior,expense}')::numeric)::text))));
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
            'opening_debit', greatest(x.open_net, 0)::text, 'opening_credit', greatest(-x.open_net, 0)::text,
            'debit', x.pd::text, 'credit', x.pc::text,
            'closing_debit', greatest(x.open_net + x.pd - x.pc, 0)::text, 'closing_credit', greatest(-(x.open_net + x.pd - x.pc), 0)::text
          ) order by x.account), '[]'::jsonb),
        'summary', jsonb_build_array(jsonb_build_object(
            'total_debit', coalesce(sum(x.pd), 0)::text, 'total_credit', coalesce(sum(x.pc), 0)::text,
            'opening_debit', coalesce(sum(greatest(x.open_net, 0)), 0)::text, 'opening_credit', coalesce(sum(greatest(-x.open_net, 0)), 0)::text,
            'closing_debit', coalesce(sum(greatest(x.open_net + x.pd - x.pc, 0)), 0)::text,
            'closing_credit', coalesce(sum(greatest(-(x.open_net + x.pd - x.pc), 0)), 0)::text)))
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
            'amount', (case when x.type like 'income%' then x.pc - x.pd else x.pd - x.pc end)::text
          ) order by x.account), '[]'::jsonb),
        'summary', jsonb_build_array(jsonb_build_object(
            'income', coalesce(sum(x.pc - x.pd) filter (where x.type like 'income%'), 0)::text,
            'expense', coalesce(sum(x.pd - x.pc) filter (where x.type like 'expense%'), 0)::text,
            'net', (coalesce(sum(x.pc - x.pd) filter (where x.type like 'income%'), 0)
                  - coalesce(sum(x.pd - x.pc) filter (where x.type like 'expense%'), 0))::text)))
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
              'balance', (case when x.type like 'asset%' then x.cum_net else -x.cum_net end)::text) order by x.account)
            from jsonb_to_recordset(v_accts) as x(account text, name text, type text, open_net numeric, pd numeric, pc numeric, cum_net numeric, fy_net numeric)
           where (x.type like 'asset%' or x.type like 'liability%' or x.type like 'equity%') and x.cum_net <> 0), '[]'::jsonb)
          || jsonb_build_array(
            jsonb_build_object('row_kind','current_year_earnings','section','equity','account_name','Current-year earnings','derived',true,
              'balance', (-coalesce(sum(y.fy_net) filter (where y.type like 'income%' or y.type like 'expense%'), 0))::text),
            jsonb_build_object('row_kind','previous_years_earnings','section','equity','account_name','Previous years'' earnings','derived',true,
              'balance', (-coalesce(sum(y.cum_net - y.fy_net) filter (where y.type like 'income%' or y.type like 'expense%'), 0))::text))),
        'summary', jsonb_build_array(jsonb_build_object(
            'total_assets', coalesce(sum(y.cum_net) filter (where y.type like 'asset%'), 0)::text,
            'total_liabilities_equity',
              (-coalesce(sum(y.cum_net) filter (where y.type like 'liability%' or y.type like 'equity%'), 0)
               - coalesce(sum(y.cum_net) filter (where y.type like 'income%' or y.type like 'expense%'), 0))::text,
            -- Accounts with no Odoo record sit outside the sections above but inside the difference: the ledger's own imbalance.
            'unclassified_balance', coalesce(sum(y.cum_net) filter (where y.type is null), 0)::text,
            'difference', coalesce(sum(y.cum_net), 0)::text,
            'balanced', coalesce(sum(y.cum_net), 0) = 0)))
        into v_rep
        from jsonb_to_recordset(v_accts) as y(account text, name text, type text, open_net numeric, pd numeric, pc numeric, cum_net numeric, fy_net numeric);
    end if;
    if v_side = 1 then v_cur := v_rep; v_has := exists (select 1 from jsonb_to_recordset(v_accts) as z(pd numeric, pc numeric) where z.pd <> 0 or z.pc <> 0);
    else v_pri := v_rep; end if;
    if v_side = 1 then
      -- Provenance of the current period: what is not in a project, not linked, or has no account record.
      -- Project scope: the company-wide unattributed / unlinked amounts are not "for the same scope" (FR-ODA-023), so they are left out.
      v_prov := jsonb_build_object(
        'ledgerAsOf', v_gen->'asOf', 'caughtUp', null, 'lastCheck', null, 'scope', case when v_acc is null then 'company' else 'project' end,
        'unattributed', case when v_acc is null then (select jsonb_build_object('count', count(*), 'debit', coalesce(sum(coalesce(m.debit,0)),0), 'credit', coalesce(sum(coalesce(m.credit,0)),0))
                           from public.erp_gl_entry_mirror m
                          where m.org_id = v_org and m.voucher_type = 'account.move' and not m.is_cancelled
                            and m.posting_date between v_cs and v_ce and m.project is null) end,
        'unlinked', case when v_acc is null then (select jsonb_build_object('count', count(*), 'debit', coalesce(sum(coalesce(m.debit,0)),0), 'credit', coalesce(sum(coalesce(m.credit,0)),0))
                       from public.erp_gl_entry_mirror m
                      where m.org_id = v_org and m.voucher_type = 'account.move' and not m.is_cancelled
                        and m.posting_date between v_cs and v_ce and m.project is not null
                        and m.project not in (select b.external_container_id from public.external_project_bindings b
                                               where b.org_id = v_org and b.external_tier = 'odoo'
                                               group by b.external_container_id having count(*) = 1)) end,
        -- Accounts with no Odoo record: any with activity in the period or a balance carried from before.
        'unclassified', (select jsonb_build_object('count', count(*), 'debit', coalesce(sum(z.pd),0), 'credit', coalesce(sum(z.pc),0), 'balance', coalesce(sum(z.cum_net),0))
                           from jsonb_to_recordset(v_accts) as z(type text, pd numeric, pc numeric, cum_net numeric) where z.type is null and (z.pd <> 0 or z.pc <> 0 or z.cum_net <> 0)));
    end if;
  end loop;

  return jsonb_build_object(
    'state', 'complete', 'companyLabel', v_company,
    'generation', v_gen,
    'selection', jsonb_build_object('periodKind', v_pk, 'periodStart', v_cs::text, 'statement', p_kind,
      'scopeKind', case when v_acc is null then 'company' else 'project' end, 'projectId', p_project_id, 'viewKind', 'account_breakdown'),
    'result', jsonb_build_object('viewKind', 'account_breakdown',
      'period', jsonb_build_object('kind', v_pk, 'currentStart', v_cs::text, 'currentEnd', v_ce::text, 'priorStart', v_ps::text, 'priorEnd', v_pe::text),
      'hasActivity', coalesce(v_has, false),
      'payload', jsonb_build_object('current', v_cur, 'prior', v_pri),
      'provenance', v_prov));
end $$;

drop function if exists public.get_odoo_ledger_lines(uuid, text, text, integer);
drop function if exists public.get_odoo_ledger_health(uuid);
drop function if exists public.record_odoo_ledger_check(uuid, timestamptz, jsonb, text, text, integer, text);
drop table if exists public.odoo_ledger_checks;
notify pgrst, 'reload schema';
commit;
