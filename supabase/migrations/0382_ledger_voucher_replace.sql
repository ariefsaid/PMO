-- 0382 — replace a reposted voucher's mirrored ledger rows with ERPNext's current set, atomically.
--
-- ERPNext's "Repost Accounting Ledger" re-creates a voucher's GL Entry / Payment Ledger Entry rows and,
-- on a later repost, hard-deletes the earlier reposted rows (no Deleted Document). The ledger feed
-- upserts by erp_name, so those rows stayed live in the mirror and the voucher counted twice. The feed
-- now reads the voucher's full current set and calls one of these functions, which in ONE transaction
-- upsert the re-delivered rows (per-row erp_modified >= guard, as the feed's batch upsert) and delete
-- that voucher's mirror rows whose name ERPNext no longer has. Deleting (not flagging) matches the mirror's
-- existing convention for rows absent from ERPNext (finish_erp_gl_replay, 0312); the statement dirty-date
-- trigger (0321) sees the delete like any other mirror write.
--
-- Also: the Payment Ledger mirror gains the voucher it was written by (the replace key), and a one-off
-- repair marker per ledger source makes the next full sweep re-read both ledgers from the start, replacing
-- every reposted voucher and backfilling the PLE voucher columns.
-- Reversal: supabase/migrations/rollback/0382_ledger_voucher_replace_down.sql.

alter table public.erp_payment_ledger_mirror
  add column voucher_type text,
  add column voucher_no text;
create index erp_payment_ledger_mirror_org_voucher_idx
  on public.erp_payment_ledger_mirror (org_id, voucher_type, voucher_no);

-- Shared argument checks. A replace must name one voucher, a non-empty current set, and rows of that voucher only.
create or replace function public.erp_ledger_voucher_replace_check(
  p_org_id uuid, p_company text, p_voucher_type text, p_voucher_no text, p_rows jsonb, p_current_names text[]
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  bound_company text;
begin
  if p_org_id is null or p_company is null or btrim(p_company) = ''
     or p_voucher_type is null or p_voucher_type = '' or p_voucher_no is null or p_voucher_no = ''
     or p_current_names is null or cardinality(p_current_names) = 0
     or exists (select 1 from unnest(p_current_names) n where n is null or n = '')
     or p_rows is null or jsonb_typeof(p_rows) <> 'array'
     or exists (select 1 from jsonb_array_elements(p_rows) e
                 where jsonb_typeof(e) <> 'object'
                    or coalesce(e ->> 'erp_name', '') = ''
                    or e ->> 'voucher_type' is distinct from p_voucher_type
                    or e ->> 'voucher_no' is distinct from p_voucher_no
                    or (e ? 'company' and e ->> 'company' is not null and e ->> 'company' <> p_company)) then
    raise exception 'invalid ledger voucher replace' using errcode = '22023';
  end if;
  -- Serialize with a company-binding change: a replace for a company no longer bound changes nothing.
  select config ->> 'company' into bound_company
    from public.external_org_bindings
   where org_id = p_org_id and external_tier = 'erpnext'
   for share;
  return found and bound_company = p_company;
end;
$$;
revoke execute on function public.erp_ledger_voucher_replace_check(uuid, text, text, text, jsonb, text[]) from public, anon, authenticated, service_role;

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

create or replace function public.replace_erp_ple_voucher_rows(
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

  insert into public.erp_payment_ledger_mirror as m (
    org_id, erp_name, account, party_type, party, against_voucher_type, against_voucher_no, amount,
    posting_date, due_date, voucher_type, voucher_no, delinked, erp_docstatus, erp_modified)
  select p_org_id, r.erp_name, r.account, r.party_type, r.party, r.against_voucher_type, r.against_voucher_no, r.amount,
         r.posting_date, r.due_date, r.voucher_type, r.voucher_no, coalesce(r.delinked, false), r.erp_docstatus, r.erp_modified
    from jsonb_populate_recordset(null::public.erp_payment_ledger_mirror, p_rows) r
  on conflict (org_id, erp_name) do update set
    account = excluded.account, party_type = excluded.party_type, party = excluded.party,
    against_voucher_type = excluded.against_voucher_type, against_voucher_no = excluded.against_voucher_no,
    amount = excluded.amount, posting_date = excluded.posting_date, due_date = excluded.due_date,
    voucher_type = excluded.voucher_type, voucher_no = excluded.voucher_no, delinked = excluded.delinked,
    erp_docstatus = excluded.erp_docstatus, erp_modified = excluded.erp_modified
  where m.erp_modified <= excluded.erp_modified;
  get diagnostics upserted_count = row_count;

  -- The PLE mirror has no company column; the org's ledger feed reads one bound company.
  delete from public.erp_payment_ledger_mirror m
   where m.org_id = p_org_id
     and m.voucher_type = p_voucher_type
     and m.voucher_no = p_voucher_no
     and m.erp_name <> all (p_current_names);
  get diagnostics deleted_count = row_count;

  return jsonb_build_object('upserted', upserted_count, 'deleted', deleted_count);
end;
$$;
revoke execute on function public.replace_erp_ple_voucher_rows(uuid, text, text, text, jsonb, text[]) from public, anon, authenticated;
grant execute on function public.replace_erp_ple_voucher_rows(uuid, text, text, text, jsonb, text[]) to service_role;

-- The PLE voucher backfill's finish. Every PLE row from before 0382 has NULL voucher columns. Once the
-- feed's full PLE re-read (the repair marker below) has caught up, every row ERPNext still has carries its
-- voucher again (Payment Ledger Entry.voucher_no is mandatory), so a row still without one was never
-- re-delivered: ERPNext no longer has it. Retire those rows and the marker together, under the binding lock.
create or replace function public.finish_erp_ple_voucher_backfill(p_org_id uuid, p_company text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  bound_company text;
  deleted_count integer;
begin
  if p_org_id is null or p_company is null or btrim(p_company) = '' then
    raise exception 'invalid Payment Ledger backfill finish' using errcode = '22023';
  end if;
  select config ->> 'company' into bound_company
    from public.external_org_bindings
   where org_id = p_org_id and external_tier = 'erpnext'
   for update;
  if not found or bound_company is distinct from p_company then
    return jsonb_build_object('deleted', 0, 'stale_binding', true);
  end if;
  -- Only while the repair is pending: a second call after the marker is gone retires nothing.
  if not exists (select 1 from public.external_sync_watermarks
                  where org_id = p_org_id and external_tier = 'erpnext' and domain = 'ledger::Payment Ledger Entry::repair') then
    return jsonb_build_object('deleted', 0);
  end if;
  delete from public.erp_payment_ledger_mirror
   where org_id = p_org_id and voucher_type is null;
  get diagnostics deleted_count = row_count;
  delete from public.external_sync_watermarks
   where org_id = p_org_id and external_tier = 'erpnext' and domain = 'ledger::Payment Ledger Entry::repair';
  return jsonb_build_object('deleted', deleted_count);
end;
$$;
revoke execute on function public.finish_erp_ple_voucher_backfill(uuid, text) from public, anon, authenticated;
grant execute on function public.finish_erp_ple_voucher_backfill(uuid, text) to service_role;

-- One-off repair through the normal sweep. A repair marker per ledger source makes the next full tick
-- re-read every row from the start (GL: so each reposted voucher, whenever it was reposted, is replaced;
-- PLE: so each row gains its voucher columns), then the feed deletes the marker. Only the new feed
-- reads the marker, so an older edge function ticking before its deploy cannot consume the repair. The
-- ordinary cursors are untouched; re-reading is idempotent (the per-row erp_modified >= guard). The marker
-- keeps its source row's updated_at so the integration-health "last sync" is not refreshed by a migration.
insert into public.external_sync_watermarks (org_id, external_tier, domain, watermark_cursor, updated_at)
select w.org_id, w.external_tier, w.domain || '::repair',
       '2000-01-01 00:00:00',
       w.updated_at
  from public.external_sync_watermarks w
 where w.external_tier = 'erpnext' and w.domain in ('ledger::GL Entry', 'ledger::Payment Ledger Entry')
on conflict (org_id, external_tier, domain) do update
  set watermark_cursor = least(public.external_sync_watermarks.watermark_cursor, excluded.watermark_cursor);
