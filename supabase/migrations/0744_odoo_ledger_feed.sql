-- #1507 S2 — Odoo ledger feed writer: attribution rows into erp_gl_entry_mirror, cursor, line replacement, census.
-- The binding org is passed by the verified Odoo resolver; no JSON field selects an org.
-- Rollback: supabase/migrations/rollback/0744_odoo_ledger_feed_down.sql
begin;

-- S5 reads by voucher type, period and account.
create index erp_gl_entry_mirror_org_voucher_date_account_idx
  on public.erp_gl_entry_mirror (org_id, voucher_type, posting_date, account);

-- Lines the running census has seen; rows of unseen lines go only when the census finishes.
create table public.odoo_ledger_census_seen (
  org_id  uuid not null references public.organizations(id) on delete cascade,
  run_at  timestamptz not null,
  line_id bigint not null,
  primary key (org_id, run_at, line_id)
);
alter table public.odoo_ledger_census_seen enable row level security;
alter table public.odoo_ledger_census_seen force row level security;
create policy odoo_ledger_census_seen_service on public.odoo_ledger_census_seen
  for all using ((auth.jwt() ->> 'role') = 'service_role')
  with check ((auth.jwt() ->> 'role') = 'service_role');
revoke all on public.odoo_ledger_census_seen from public, anon, authenticated;
revoke all on public.odoo_ledger_census_seen from service_role;

-- The line id inside a row name `odoo:<line>:<analytic id | ->`.
create or replace function public.odoo_ledger_line_id(p_erp_name text) returns bigint
language sql immutable set search_path = public, pg_catalog as $$
  select (regexp_match(p_erp_name, '^odoo:([1-9][0-9]*):(-|[1-9][0-9]*)$'))[1]::bigint
$$;
revoke all on function public.odoo_ledger_line_id(text) from public, anon, authenticated;
grant execute on function public.odoo_ledger_line_id(text) to service_role;

-- Page of attribution rows (S1 `fanOutLine`). One transaction: any bad row aborts the rows and the cursor.
-- A line's rows are replaced by line id, so a reset-to-draft + repost with another distribution leaves no row of the old split.
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
  if jsonb_typeof(v_new) is distinct from 'object' then raise exception 'malformed ledger cursor' using errcode = '22023'; end if;
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
      from page
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
  delete from public.erp_gl_entry_mirror m
   where m.org_id = p_org_id and m.voucher_type = 'account.move'
     and public.odoo_ledger_line_id(m.erp_name) in (select public.odoo_ledger_line_id(r->>'erp_name') from jsonb_array_elements(p_rows) r)
     and not exists (select 1 from jsonb_array_elements(p_rows) r where r->>'erp_name' = m.erp_name)
     and m.erp_modified <= (select max(r->>'source_write_date') from jsonb_array_elements(p_rows) r
                             where public.odoo_ledger_line_id(r->>'erp_name') = public.odoo_ledger_line_id(m.erp_name));

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

create or replace function public.mark_odoo_ledger_census_seen(p_org_id uuid, p_run timestamptz, p_line_ids text[])
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if current_setting('role', true) <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  perform public.assert_odoo_activated(p_org_id);
  if exists (select 1 from unnest(coalesce(p_line_ids,'{}')) id where id !~ '^[1-9][0-9]*$') then
    raise exception 'malformed ledger census id' using errcode = '22023';
  end if;
  insert into public.odoo_ledger_census_seen (org_id, run_at, line_id)
    select p_org_id, p_run, id::bigint from unnest(coalesce(p_line_ids,'{}')) id
    on conflict do nothing;
  delete from public.odoo_ledger_census_seen where org_id = p_org_id and run_at < p_run - interval '1 day';
end $$;
revoke all on function public.mark_odoo_ledger_census_seen(uuid,timestamptz,text[]) from public, anon, authenticated;
grant execute on function public.mark_odoo_ledger_census_seen(uuid,timestamptz,text[]) to service_role;

-- Only a finished census deletes: rows of lines Odoo no longer returns, written before the run began.
create or replace function public.finish_odoo_ledger_census(p_org_id uuid, p_run timestamptz)
returns integer language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_cut text := to_char((p_run - interval '10 minutes') at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS');
  v_eligible integer;
  v_n integer;
begin
  if current_setting('role', true) <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  perform public.assert_odoo_activated(p_org_id);
  select count(distinct public.odoo_ledger_line_id(m.erp_name)) into v_eligible from public.erp_gl_entry_mirror m
   where m.org_id = p_org_id and m.voucher_type = 'account.move' and m.erp_modified < v_cut
     and public.odoo_ledger_line_id(m.erp_name) is not null;
  if v_eligible > 0 and not exists (select 1 from public.odoo_ledger_census_seen s where s.org_id = p_org_id and s.run_at = p_run) then
    raise exception 'ledger census saw no lines' using errcode = 'P0001';
  end if;
  delete from public.erp_gl_entry_mirror m
   where m.org_id = p_org_id and m.voucher_type = 'account.move' and m.erp_modified < v_cut
     and public.odoo_ledger_line_id(m.erp_name) is not null
     and not exists (select 1 from public.odoo_ledger_census_seen s
                      where s.org_id = p_org_id and s.run_at = p_run and s.line_id = public.odoo_ledger_line_id(m.erp_name));
  get diagnostics v_n = row_count;
  delete from public.odoo_ledger_census_seen where org_id = p_org_id and run_at = p_run;
  return v_n;
end $$;
revoke all on function public.finish_odoo_ledger_census(uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.finish_odoo_ledger_census(uuid,timestamptz) to service_role;

notify pgrst, 'reload schema';

commit;
