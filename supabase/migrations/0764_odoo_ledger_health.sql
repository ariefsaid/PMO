-- #1507 S4 — Odoo ledger reconciliation record, health read and line list (FR-ODA-030, 040..042, 051, 061, 062).
-- odoo_ledger_checks holds PMO's own check output (grouped Odoo totals compared with the mirrored sums). It mirrors no external
-- object, so it has no 0136 side-mirror inventory entry. The service role writes it; Admin, Finance and Executive read it.
-- get_odoo_ledger_health and get_odoo_ledger_lines are security invoker: the mirror's RLS (Admin/Finance/Executive) is the authority and
-- the role check inside only gives a plain refusal. Project Manager / Engineer get freshness for a visible project, never the check,
-- the reasons or line detail (their project totals come from odoo_project_ledger, 0746).
-- The caught-up flag is the watermark row domain 'ledger-caught-up:odoo' ('true' / 'false'), written by the sweep after every pass;
-- its updated_at is the time of the last pass that finished, so a quiet Odoo still counts as fresh.
-- Rollback: supabase/migrations/rollback/0764_odoo_ledger_health_down.sql
begin;

create table public.odoo_ledger_checks (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null default coalesce(public.auth_org_id(),'00000000-0000-0000-0000-000000000001')
               references public.organizations(id) on delete cascade,
  checked_at timestamptz not null default clock_timestamp(),
  cutoff     timestamptz not null,
  status     text not null check (status in ('matches','differs','not-checked')),
  reason     text check (reason is null or length(reason) <= 200),
  -- Accounts compared (union of PMO and Odoo accounts): a "matches" over 0 accounts compared nothing.
  accounts_checked integer not null default 0 check (accounts_checked >= 0),
  -- The feed position (cursor w + id) the check covered; a check whose position is not the feed's current one is stale (get_odoo_ledger_health).
  feed_position text,
  accounts   jsonb not null default '[]' check (jsonb_typeof(accounts) = 'array' and jsonb_array_length(accounts) <= 200)
);
alter table public.odoo_ledger_checks add constraint odoo_ledger_checks_reason_chk
  check ((status = 'not-checked') = (reason is not null));
create index odoo_ledger_checks_org_time_idx on public.odoo_ledger_checks (org_id, checked_at desc);
create trigger odoo_ledger_checks_stamp_org_id before insert on public.odoo_ledger_checks
  for each row execute function public.stamp_org_id();

alter table public.odoo_ledger_checks enable row level security;
alter table public.odoo_ledger_checks force row level security;
create policy odoo_ledger_checks_select on public.odoo_ledger_checks for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and (select public.auth_role()) in ('Admin','Finance','Executive'));
create policy odoo_ledger_checks_service on public.odoo_ledger_checks for all
  using (((select auth.jwt()) ->> 'role') = 'service_role') with check (((select auth.jwt()) ->> 'role') = 'service_role');
revoke all on public.odoo_ledger_checks from public, anon, authenticated;
grant select on public.odoo_ledger_checks to authenticated;
grant select, insert, update, delete on public.odoo_ledger_checks to service_role;

-- One check result. "not-checked" keeps the earlier results (the health read returns the last good one beside it).
-- The reason is an error-class slug and only a "not-checked" row has one. History is the newest 50 rows plus the newest matches/differs row,
-- so a long outage of "not-checked" rows never deletes the last real result; a repeat of the newest "not-checked" reason within a day is not stored again.
create or replace function public.record_odoo_ledger_check(p_org_id uuid, p_cutoff timestamptz, p_accounts jsonb, p_status text, p_reason text,
                                                           p_accounts_checked integer default 0, p_feed_position text default null)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if current_setting('role', true) <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  perform public.assert_odoo_activated(p_org_id);
  if p_status is null or p_status not in ('matches','differs','not-checked') or p_cutoff is null
     or jsonb_typeof(p_accounts) is distinct from 'array' or jsonb_array_length(p_accounts) > 200
     or (p_status = 'differs' and jsonb_array_length(p_accounts) = 0)
     or (p_status <> 'differs' and jsonb_array_length(p_accounts) > 0)
     or (p_status = 'not-checked') is distinct from (p_reason is not null)
     or (p_reason is not null and p_reason !~ '^[a-z0-9_:-]{1,100}$')
     or coalesce(p_accounts_checked, -1) < 0
     or length(coalesce(p_feed_position, '')) > 200
     or exists (select 1 from jsonb_array_elements(p_accounts) a
                 where jsonb_typeof(a) is distinct from 'object' or coalesce(a->>'account','') = ''
                    or jsonb_typeof(a->'pmo') is distinct from 'object' or jsonb_typeof(a->'odoo') is distinct from 'object') then
    raise exception 'invalid ledger check' using errcode = '22023';
  end if;
  if p_status = 'not-checked' and exists (
       select 1 from (select k.status, k.reason, k.checked_at from public.odoo_ledger_checks k where k.org_id = p_org_id
                       order by k.checked_at desc, k.id desc limit 1) n
        where n.status = 'not-checked' and n.reason = p_reason and n.checked_at > clock_timestamp() - interval '1 day') then
    return;
  end if;
  insert into public.odoo_ledger_checks (org_id, cutoff, status, reason, accounts, accounts_checked, feed_position)
    values (p_org_id, p_cutoff, p_status, p_reason, p_accounts, p_accounts_checked, p_feed_position);
  delete from public.odoo_ledger_checks c where c.org_id = p_org_id
     and c.id not in (select k.id from public.odoo_ledger_checks k where k.org_id = p_org_id order by k.checked_at desc, k.id desc limit 50)
     and c.id is distinct from (select g.id from public.odoo_ledger_checks g where g.org_id = p_org_id and g.status <> 'not-checked'
                                  order by g.checked_at desc, g.id desc limit 1);
end $$;
revoke all on function public.record_odoo_ledger_check(uuid,timestamptz,jsonb,text,text,integer,text) from public, anon, authenticated;
grant execute on function public.record_odoo_ledger_check(uuid,timestamptz,jsonb,text,text,integer,text) to service_role;

-- Health of the org's Odoo ledger (p_project_id null) or of one project's scope.
-- state: unavailable (connection not healthy, last data kept) > catching-up > stale (as-of older than 30 min) > fresh.
-- The three "not in a project" reasons are separate, exclusive and checked in this order: no analytic account, an analytic account no
-- single PMO project links, then a linked project's line on an account no budget category maps. Cancelled lines are in none.
create or replace function public.get_odoo_ledger_health(p_project_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_role text := public.auth_role()::text;
  v_wide boolean := v_role in ('Admin','Finance','Executive');
  v_b record;
  v_acc text;
  v_asof timestamptz; v_cursor text; v_flag timestamptz; v_caught boolean; v_census text; v_pos text; v_checkpos text; v_checkat timestamptz; v_stale boolean;
  v_state text; v_healthy boolean;
  v_check jsonb; v_good jsonb;
  v_un jsonb; v_ua jsonb; v_ul jsonb;
begin
  if v_org is null or not coalesce(public.is_active_member(), false) then raise exception 'Not permitted' using errcode = '42501'; end if;
  if not v_wide and not (v_role in ('Project Manager','Engineer') and p_project_id is not null) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if p_project_id is not null and not exists (select 1 from public.projects p where p.id = p_project_id and p.org_id = v_org) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  select b.status, b.config into v_b from public.external_org_bindings b
   where b.org_id = v_org and b.external_tier = 'odoo' and b.activated_at is not null limit 1;
  v_healthy := case when found then v_b.status = 'active' and coalesce(v_b.config#>>'{connection,state}', '') in ('healthy','credential-expiring','degraded') else false end;

  select w.updated_at, w.watermark_cursor into v_asof, v_cursor from public.external_sync_watermarks w
   where w.org_id = v_org and w.external_tier = 'odoo' and w.domain = 'ledger:odoo';
  select w.updated_at, w.watermark_cursor = 'true' into v_flag, v_caught from public.external_sync_watermarks w
   where w.org_id = v_org and w.external_tier = 'odoo' and w.domain = 'ledger-caught-up:odoo';
  v_asof := greatest(v_asof, v_flag);
  v_census := case when v_cursor like '{%' then v_cursor::jsonb->>'census_done_at' end;
  v_pos := case when v_cursor like '{%' then coalesce(v_cursor::jsonb->>'w', '') || '|' || coalesce(v_cursor::jsonb->>'id', '') end;
  v_caught := coalesce(v_caught, false);
  v_state := case when not v_healthy then 'unavailable' when v_asof is null or not v_caught then 'catching-up'
                  when now() - v_asof > interval '30 minutes' then 'stale' else 'fresh' end;
  -- The flag is written when a pass finishes; a pass that dies leaves a stale "true", so a flag older than 30 minutes is not caught up.
  v_caught := v_caught and v_flag is not null and now() - v_flag <= interval '30 minutes';

  if v_wide then
    select jsonb_build_object('status', c.status, 'checkedAt', c.checked_at, 'cutoff', c.cutoff, 'reason', c.reason, 'accounts', c.accounts,
                              'accountsChecked', c.accounts_checked) into v_check
      from public.odoo_ledger_checks c where c.org_id = v_org order by c.checked_at desc, c.id desc limit 1;
    select jsonb_build_object('status', c.status, 'checkedAt', c.checked_at, 'cutoff', c.cutoff, 'accounts', c.accounts,
                              'accountsChecked', c.accounts_checked), c.feed_position, c.checked_at into v_good, v_checkpos, v_checkat
      from public.odoo_ledger_checks c where c.org_id = v_org and c.status <> 'not-checked' order by c.checked_at desc, c.id desc limit 1;
    -- A real result is current only for the feed position it covered and only if it is newer than the last census.
    v_stale := v_good is not null and (v_checkpos is distinct from v_pos or (v_census is not null and v_checkat < v_census::timestamptz));
    if v_good is not null then v_good := v_good || jsonb_build_object('feedPosition', v_checkpos, 'stale', v_stale); end if;
    if v_check is not null and v_check->>'status' <> 'not-checked' then v_check := v_check || jsonb_build_object('feedPosition', v_checkpos, 'stale', v_stale); end if;

    if p_project_id is not null then
      select b.external_container_id into v_acc from public.external_project_bindings b
       where b.org_id = v_org and b.project_id = p_project_id and b.external_tier = 'odoo';
    end if;
    -- Links and the account map are looked up once per distinct (project, account), not once per mirrored line.
    with grp as (
      select m.account, m.project, count(*) n, sum(coalesce(m.debit,0)) d, sum(coalesce(m.credit,0)) c
        from public.erp_gl_entry_mirror m
       where m.org_id = v_org and m.voucher_type = 'account.move' and not m.is_cancelled
         and (p_project_id is null or (v_acc is not null and m.project = v_acc))
       group by m.account, m.project
    ), lines as (
      select g.*,
             (select count(*) from public.external_project_bindings b where b.org_id = v_org and b.external_tier = 'odoo' and b.external_container_id = g.project) links,
             exists (select 1 from public.budget_category_account_map k where k.org_id = v_org and k.erp_account = g.account) is_mapped
        from grp g
    ), tagged as (
      select *, case when project is null then 'unattributed' when links <> 1 then 'unlinked' when not is_mapped then 'unmapped' end reason from lines
    )
    select
      jsonb_build_object('count', coalesce(sum(n) filter (where reason = 'unmapped'), 0), 'debit', round(coalesce(sum(d) filter (where reason = 'unmapped'), 0), 2)::text,
        'credit', round(coalesce(sum(c) filter (where reason = 'unmapped'), 0), 2)::text,
        'accounts', coalesce((select jsonb_agg(a order by a) from (select distinct t2.account a from tagged t2 where t2.reason = 'unmapped' order by 1 limit 20) z), '[]'::jsonb)),
      jsonb_build_object('count', coalesce(sum(n) filter (where reason = 'unattributed'), 0), 'debit', round(coalesce(sum(d) filter (where reason = 'unattributed'), 0), 2)::text,
        'credit', round(coalesce(sum(c) filter (where reason = 'unattributed'), 0), 2)::text),
      jsonb_build_object('count', coalesce(sum(n) filter (where reason = 'unlinked'), 0), 'debit', round(coalesce(sum(d) filter (where reason = 'unlinked'), 0), 2)::text,
        'credit', round(coalesce(sum(c) filter (where reason = 'unlinked'), 0), 2)::text)
      into v_un, v_ua, v_ul from tagged;
    -- A project's scope has only its own lines: the company-wide reasons are not "for the same scope".
    if p_project_id is not null then v_ua := null; v_ul := null; end if;
  end if;

  return jsonb_build_object('state', v_state, 'asOf', v_asof, 'caughtUp', v_caught, 'lastCensus', v_census,
    'check', v_check, 'lastGood', v_good, 'unmapped', v_un, 'unattributed', v_ua, 'unlinked', v_ul);
end $$;
revoke all on function public.get_odoo_ledger_health(uuid) from public, anon, authenticated;
grant execute on function public.get_odoo_ledger_health(uuid) to authenticated;

-- Source lines of one budget category of a project (FR-ODA-051). Keyset on the row id, never more than 200 a page (below max_rows).
-- Admin / Finance / Executive only; the row security of the mirror decides what is visible and a foreign project is "not permitted".
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

-- The statement reader's caught-up flag and last check (they were null placeholders in 0746; restated here so 0746 stays as shipped).
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
        -- Same sources as get_odoo_ledger_health: the sweep's caught-up flag and the latest recorded check (Admin / Finance / Executive only under RLS; null for others).
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

notify pgrst, 'reload schema';

commit;
