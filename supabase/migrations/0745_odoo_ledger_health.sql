-- #1507 S4 — Odoo ledger reconciliation record, health read and line list (FR-ODA-030, 040..042, 051, 061, 062).
-- odoo_ledger_checks holds PMO's own check output (grouped Odoo totals compared with the mirrored sums). It mirrors no external
-- object, so it has no 0136 side-mirror inventory entry. The service role writes it; Admin, Finance and Executive read it.
-- get_odoo_ledger_health and get_odoo_ledger_lines are security invoker: the mirror's RLS (Admin/Finance/Executive) is the authority and
-- the role check inside only gives a plain refusal. Project Manager / Engineer get freshness for a visible project, never the check,
-- the reasons or line detail (their project totals come from odoo_project_ledger, 0746).
-- The caught-up flag is the watermark row domain 'ledger-caught-up:odoo' ('true' / 'false'), written by the sweep after every pass;
-- its updated_at is the time of the last pass that finished, so a quiet Odoo still counts as fresh.
-- Rollback: supabase/migrations/rollback/0745_odoo_ledger_health_down.sql
begin;

create table public.odoo_ledger_checks (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null default coalesce(public.auth_org_id(),'00000000-0000-0000-0000-000000000001')
               references public.organizations(id) on delete cascade,
  checked_at timestamptz not null default clock_timestamp(),
  cutoff     timestamptz not null,
  status     text not null check (status in ('matches','differs','not-checked')),
  reason     text check (reason is null or length(reason) <= 200),
  accounts   jsonb not null default '[]' check (jsonb_typeof(accounts) = 'array' and jsonb_array_length(accounts) <= 200)
);
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
create or replace function public.record_odoo_ledger_check(p_org_id uuid, p_cutoff timestamptz, p_accounts jsonb, p_status text, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if current_setting('role', true) <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  perform public.assert_odoo_activated(p_org_id);
  if p_status is null or p_status not in ('matches','differs','not-checked') or p_cutoff is null
     or jsonb_typeof(p_accounts) is distinct from 'array' or jsonb_array_length(p_accounts) > 200
     or (p_status = 'differs' and jsonb_array_length(p_accounts) = 0)
     or (p_status <> 'differs' and jsonb_array_length(p_accounts) > 0)
     or length(coalesce(p_reason, '')) > 200
     or exists (select 1 from jsonb_array_elements(p_accounts) a
                 where jsonb_typeof(a) is distinct from 'object' or coalesce(a->>'account','') = ''
                    or jsonb_typeof(a->'pmo') is distinct from 'object' or jsonb_typeof(a->'odoo') is distinct from 'object') then
    raise exception 'invalid ledger check' using errcode = '22023';
  end if;
  insert into public.odoo_ledger_checks (org_id, cutoff, status, reason, accounts) values (p_org_id, p_cutoff, p_status, p_reason, p_accounts);
  -- A bounded history: the newest 50.
  delete from public.odoo_ledger_checks c where c.org_id = p_org_id
     and c.id not in (select k.id from public.odoo_ledger_checks k where k.org_id = p_org_id order by k.checked_at desc, k.id desc limit 50);
end $$;
revoke all on function public.record_odoo_ledger_check(uuid,timestamptz,jsonb,text,text) from public, anon, authenticated;
grant execute on function public.record_odoo_ledger_check(uuid,timestamptz,jsonb,text,text) to service_role;

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
  v_asof timestamptz; v_cursor text; v_flag timestamptz; v_caught boolean; v_census text;
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
  v_caught := coalesce(v_caught, false);
  v_census := case when v_cursor like '{%' then v_cursor::jsonb->>'census_done_at' end;
  v_state := case when not v_healthy then 'unavailable' when v_asof is null or not v_caught then 'catching-up'
                  when now() - v_asof > interval '30 minutes' then 'stale' else 'fresh' end;

  if v_wide then
    select jsonb_build_object('status', c.status, 'checkedAt', c.checked_at, 'cutoff', c.cutoff, 'reason', c.reason, 'accounts', c.accounts) into v_check
      from public.odoo_ledger_checks c where c.org_id = v_org order by c.checked_at desc, c.id desc limit 1;
    select jsonb_build_object('status', c.status, 'checkedAt', c.checked_at, 'cutoff', c.cutoff, 'accounts', c.accounts) into v_good
      from public.odoo_ledger_checks c where c.org_id = v_org and c.status <> 'not-checked' order by c.checked_at desc, c.id desc limit 1;

    if p_project_id is not null then
      select b.external_container_id into v_acc from public.external_project_bindings b
       where b.org_id = v_org and b.project_id = p_project_id and b.external_tier = 'odoo';
    end if;
    with lines as (
      select m.account, m.project, coalesce(m.debit,0) d, coalesce(m.credit,0) c,
             (select count(*) from public.external_project_bindings b where b.org_id = v_org and b.external_tier = 'odoo' and b.external_container_id = m.project) links,
             exists (select 1 from public.budget_category_account_map k where k.org_id = v_org and k.erp_account = m.account) is_mapped
        from public.erp_gl_entry_mirror m
       where m.org_id = v_org and m.voucher_type = 'account.move' and not m.is_cancelled
         and (p_project_id is null or (v_acc is not null and m.project = v_acc))
    ), tagged as (
      select *, case when project is null then 'unattributed' when links <> 1 then 'unlinked' when not is_mapped then 'unmapped' end reason from lines
    )
    select
      jsonb_build_object('count', count(*) filter (where reason = 'unmapped'), 'debit', round(coalesce(sum(d) filter (where reason = 'unmapped'), 0), 2)::text,
        'credit', round(coalesce(sum(c) filter (where reason = 'unmapped'), 0), 2)::text,
        'accounts', coalesce((select jsonb_agg(a order by a) from (select distinct t2.account a from tagged t2 where t2.reason = 'unmapped' order by 1 limit 20) z), '[]'::jsonb)),
      jsonb_build_object('count', count(*) filter (where reason = 'unattributed'), 'debit', round(coalesce(sum(d) filter (where reason = 'unattributed'), 0), 2)::text,
        'credit', round(coalesce(sum(c) filter (where reason = 'unattributed'), 0), 2)::text),
      jsonb_build_object('count', count(*) filter (where reason = 'unlinked'), 'debit', round(coalesce(sum(d) filter (where reason = 'unlinked'), 0), 2)::text,
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

notify pgrst, 'reload schema';

commit;
