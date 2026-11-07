-- #1507 S5 — Odoo statements read from the ledger mirror (Trial Balance, Profit and Loss, Balance Sheet, project P&L).
-- Odoo Community has no statement-report API (V-ODA9), so PMO sums the mirrored posted lines; the ledger stays the oracle (ADR-0048).
-- Same envelope shape as get_financial_statement (state / companyLabel / generation / selection / result): amounts are decimal strings,
-- generation carries currency + presentation, project totals use the shipped totals keys. The caller's org comes only from the JWT.
-- Accounts are classed by Odoo account_type from external_master_records (kind account). No closing logic here: the Balance Sheet shows
-- the ledger as Odoo has it plus two derived equity rows (current-year, previous-years earnings).
-- Ledger basis: nothing answers (state not_in_use) until an Admin has switched the org (binding config.ledger_basis_at, written by S6).
-- Fiscal year end: ONE source, binding config.fiscal_year_end {month, day}, persisted by the S3 feed from the Odoo company
-- (set_odoo_fiscal_year_end); calendar year when absent (OQ-ODA-3). Periods are month-aligned: a year end on day 15 or earlier
-- counts as the previous month's end, later days as that month's end.
-- Rollback: supabase/migrations/rollback/0746_odoo_statements_down.sql
begin;

-- The feed's write of the company's year end (service role only). Idempotent: an unchanged value touches no row.
create or replace function public.set_odoo_fiscal_year_end(p_org_id uuid, p_month integer, p_day integer)
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if p_org_id is null or p_month is null or p_month not between 1 and 12 or p_day is null or p_day not between 1 and 31 then
    raise exception 'Invalid fiscal year end' using errcode = '22023';
  end if;
  update public.external_org_bindings b
     set config = jsonb_set(coalesce(b.config, '{}'::jsonb), '{fiscal_year_end}', jsonb_build_object('month', p_month, 'day', p_day))
   where b.org_id = p_org_id and b.external_tier = 'odoo'
     and b.config->'fiscal_year_end' is distinct from jsonb_build_object('month', p_month, 'day', p_day);
end $$;
revoke all on function public.set_odoo_fiscal_year_end(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.set_odoo_fiscal_year_end(uuid, integer, integer) to service_role;

-- Fiscal-year end month of the caller's org (binding config is member-readable).
create or replace function public.odoo_fiscal_end_month()
returns integer language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce((select case when b.config#>>'{fiscal_year_end,month}' ~ '^([1-9]|1[0-2])$' and b.config#>>'{fiscal_year_end,day}' ~ '^([1-9]|[12][0-9]|3[01])$'
                               then case when (b.config#>>'{fiscal_year_end,day}')::int <= 15
                                         then ((b.config#>>'{fiscal_year_end,month}')::int + 10) % 12 + 1
                                         else (b.config#>>'{fiscal_year_end,month}')::int end end
                     from public.external_org_bindings b
                    where b.org_id = public.auth_org_id() and b.external_tier = 'odoo' and b.activated_at is not null
                    limit 1), 12)
$$;
revoke all on function public.odoo_fiscal_end_month() from public, anon, authenticated;
grant execute on function public.odoo_fiscal_end_month() to authenticated;

-- Ledger basis: the org has an activated Odoo binding AND an Admin has switched it to the ledger.
create or replace function public.odoo_ledger_in_use()
returns boolean language sql stable security invoker set search_path = public, pg_temp as $$
  select exists (select 1 from public.external_org_bindings b
                  where b.org_id = public.auth_org_id() and b.external_tier = 'odoo' and b.activated_at is not null
                    and nullif(b.config->>'ledger_basis_at', '') is not null)
$$;
revoke all on function public.odoo_ledger_in_use() from public, anon, authenticated;
grant execute on function public.odoo_ledger_in_use() to authenticated;

-- The catalogue period (month / quarter / fiscal year) a start date names, current and prior; refuses a start the catalogue would not offer.
create or replace function public.odoo_period_bounds(p_kind text, p_start date, p_fy integer)
returns table (cs date, ce date, ps date, pe date) language plpgsql immutable security invoker set search_path = public, pg_temp as $$
declare
  v_n int := case p_kind when 'month' then 1 when 'quarter' then 3 when 'fiscal_year' then 12 end;
  v_off int;
begin
  if v_n is null or p_start is null or extract(day from p_start) <> 1 then
    raise exception 'Invalid statement selection' using errcode = '22023';
  end if;
  v_off := (extract(month from p_start)::int - (p_fy % 12 + 1) + 12) % 12;
  if (p_kind = 'quarter' and v_off % 3 <> 0) or (p_kind = 'fiscal_year' and v_off <> 0) then
    raise exception 'Invalid statement selection' using errcode = '22023';
  end if;
  return query select p_start, (p_start + make_interval(months => v_n))::date - 1,
                      (p_start - make_interval(months => v_n))::date, p_start - 1;
end $$;
revoke all on function public.odoo_period_bounds(text, date, integer) from public, anon, authenticated;
grant execute on function public.odoo_period_bounds(text, date, integer) to authenticated;

-- Generation block of the envelope: ledger as-of time, the company currency and how amounts are presented.
create or replace function public.odoo_statement_generation()
returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'asOf', (select w.updated_at from public.external_sync_watermarks w
              where w.org_id = public.auth_org_id() and w.external_tier = 'odoo' and w.domain = 'ledger:odoo'),
    'currency', (select m.attrs->>'currency' from public.external_master_records m
                  where m.org_id = public.auth_org_id() and m.external_tier = 'odoo' and m.kind = 'company' and m.tombstoned_at is null
                  order by m.active desc, m.id limit 1),
    'presentation', jsonb_build_object('precision', 2, 'roundingMethod', 'Commercial Rounding'))
$$;
revoke all on function public.odoo_statement_generation() from public, anon, authenticated;
grant execute on function public.odoo_statement_generation() to authenticated;

-- Project figures for every role that may see a project (Project Manager / Engineer cannot read the mirror under RLS).
-- No kind: the project's posting-date bounds (for the catalogue). Else a catalogue period (kind + first-of-period date, validated like
-- get_odoo_statement): income / expense for that period and the one before. Never a caller-chosen range, so no finer slice than the
-- month leaves this function. Totals only, one project, caller's org from the JWT; refuses a project that is not the caller's.
create or replace function public.odoo_project_ledger(p_project_id uuid, p_kind text default null, p_start date default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_acc text;
  v_cs date; v_ce date; v_ps date; v_pe date;
  v_asof timestamptz;
  v_out jsonb;
begin
  if v_org is null or not coalesce(public.is_active_member(), false)
     or public.auth_role()::text not in ('Admin','Finance','Executive','Project Manager','Engineer') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if p_project_id is null or not exists (select 1 from public.projects p where p.id = p_project_id and p.org_id = v_org) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if not public.odoo_ledger_in_use() then
    return jsonb_build_object('linked', false, 'notInUse', true);
  end if;
  select b.external_container_id into v_acc from public.external_project_bindings b
   where b.org_id = v_org and b.project_id = p_project_id and b.external_tier = 'odoo';
  if v_acc is null or exists (select 1 from public.external_project_bindings o
                               where o.org_id = v_org and o.external_tier = 'odoo' and o.external_container_id = v_acc
                                 and o.project_id <> p_project_id) then
    return jsonb_build_object('linked', false);
  end if;
  select w.updated_at into v_asof from public.external_sync_watermarks w
   where w.org_id = v_org and w.external_tier = 'odoo' and w.domain = 'ledger:odoo';
  if p_kind is null then
    return jsonb_build_object('linked', true, 'ledgerAsOf', v_asof,
      'minDate', (select min(m.posting_date) from public.erp_gl_entry_mirror m
                   where m.org_id = v_org and m.voucher_type = 'account.move' and not m.is_cancelled and m.project = v_acc),
      'maxDate', (select max(m.posting_date) from public.erp_gl_entry_mirror m
                   where m.org_id = v_org and m.voucher_type = 'account.move' and not m.is_cancelled and m.project = v_acc));
  end if;
  select pb.cs, pb.ce, pb.ps, pb.pe into v_cs, v_ce, v_ps, v_pe from public.odoo_period_bounds(p_kind, p_start, public.odoo_fiscal_end_month()) pb;
  select jsonb_build_object('linked', true, 'ledgerAsOf', v_asof,
    'current', jsonb_build_object(
      'income',  coalesce(sum(coalesce(m.credit,0) - coalesce(m.debit,0)) filter (where m.posting_date between v_cs and v_ce and a.t like 'income%'), 0),
      'expense', coalesce(sum(coalesce(m.debit,0) - coalesce(m.credit,0)) filter (where m.posting_date between v_cs and v_ce and a.t like 'expense%'), 0)),
    'prior', jsonb_build_object(
      'income',  coalesce(sum(coalesce(m.credit,0) - coalesce(m.debit,0)) filter (where m.posting_date between v_ps and v_pe and a.t like 'income%'), 0),
      'expense', coalesce(sum(coalesce(m.debit,0) - coalesce(m.credit,0)) filter (where m.posting_date between v_ps and v_pe and a.t like 'expense%'), 0)))
    into v_out
    from public.erp_gl_entry_mirror m
    join lateral (select r.attrs->>'account_type' t from public.external_master_records r
                   where r.org_id = v_org and r.external_tier = 'odoo' and r.kind = 'account'
                     and r.code = m.account and r.tombstoned_at is null order by r.active desc, r.id limit 1) a on true
   where m.org_id = v_org and m.voucher_type = 'account.move' and not m.is_cancelled and m.project = v_acc
     and m.posting_date between v_ps and v_ce;
  return v_out;
end $$;
revoke all on function public.odoo_project_ledger(uuid, text, date) from public, anon, authenticated;
grant execute on function public.odoo_project_ledger(uuid, text, date) to authenticated;

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
        'ledgerAsOf', v_gen->'asOf',
        -- Same sources as get_odoo_ledger_health (0745): the sweep's caught-up flag and the latest recorded check (Admin / Finance / Executive only under RLS; null for others).
        'caughtUp', (select w.watermark_cursor = 'true' from public.external_sync_watermarks w
                      where w.org_id = v_org and w.external_tier = 'odoo' and w.domain = 'ledger-caught-up:odoo'),
        'lastCheck', (select jsonb_build_object('status', c.status, 'checkedAt', c.checked_at) from public.odoo_ledger_checks c
                       where c.org_id = v_org order by c.checked_at desc, c.id desc limit 1), 'scope', case when v_acc is null then 'company' else 'project' end,
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
revoke all on function public.get_odoo_statement(text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.get_odoo_statement(text, jsonb, uuid) to authenticated;

-- Month / quarter / fiscal-year choices between the earliest and latest posting dates (no custom dates, OQ001 of #897).
-- Envelope keys as get_financial_statement_catalogue (state / companyLabel / generation / periods / scopes); not_in_use is the one extra state.
create or replace function public.get_odoo_statement_catalogue(p_project_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_role text := public.auth_role()::text;
  v_fy int := public.odoo_fiscal_end_month();
  v_min date; v_max date; v_proj jsonb;
  v_company text;
  v_gen jsonb;
  v_scopes jsonb;
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
  if not public.odoo_ledger_in_use() then
    return jsonb_build_object('state', 'not_in_use');
  end if;
  select m.name into v_company from public.external_master_records m
   where m.org_id = v_org and m.external_tier = 'odoo' and m.kind = 'company' and m.tombstoned_at is null order by m.active desc, m.id limit 1;
  v_gen := public.odoo_statement_generation();
  if p_project_id is null then
    select min(m.posting_date), max(m.posting_date) into v_min, v_max from public.erp_gl_entry_mirror m
     where m.org_id = v_org and m.voucher_type = 'account.move' and not m.is_cancelled;
    v_scopes := jsonb_build_array(jsonb_build_object('scopeKind', 'company', 'projectId', null,
      'statements', jsonb_build_array('trial_balance','profit_and_loss','balance_sheet'), 'viewKinds', jsonb_build_array('account_breakdown')));
  else
    v_proj := public.odoo_project_ledger(p_project_id);
    if not (v_proj->>'linked')::boolean then
      return jsonb_build_object('state', 'unavailable', 'companyLabel', v_company, 'generation', null, 'periods', '[]'::jsonb, 'scopes', '[]'::jsonb);
    end if;
    v_min := (v_proj->>'minDate')::date; v_max := (v_proj->>'maxDate')::date;
    v_scopes := jsonb_build_array(jsonb_build_object('scopeKind', 'project', 'projectId', p_project_id,
      'statements', jsonb_build_array('profit_and_loss'),
      'viewKinds', jsonb_build_array(case when v_role in ('Admin','Finance','Executive') then 'account_breakdown' else 'project_totals' end)));
  end if;
  if v_min is null then
    return jsonb_build_object('state', 'unavailable', 'companyLabel', v_company, 'generation', null, 'periods', '[]'::jsonb, 'scopes', '[]'::jsonb);
  end if;
  return jsonb_build_object('state', 'complete', 'companyLabel', v_company, 'generation', v_gen, 'scopes', v_scopes, 'periods', (
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
