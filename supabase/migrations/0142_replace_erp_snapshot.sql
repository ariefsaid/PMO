-- 0142_replace_erp_snapshot.sql — audit round 10, HIGH-1: make snapshot-replace ATOMIC.
--
-- ⚑ THE DEFECT THIS CLOSES AT THE ROOT.
--
-- `erp_actuals_snapshot` / `erp_ap_aging_snapshot` / `erp_ar_aging_snapshot` are GENERATIONAL: a sweep
-- pass mints one `snapshot_id`, removes the org's previous generation and publishes its own. 0101's
-- table comment asserted the two happened "in the SAME service-role tx". They did not. The writers
-- (`actualsSnapshot.ts` / `agingSnapshot.ts`) issued `await delete()` and THEN `await insert()` — two
-- separate PostgREST round trips — and the sweep cron (`0102`) fires `net.http_post` fire-and-forget
-- every 5 minutes with no single-flight guard, so passes overlap by construction. Interleave two of
-- them (A deletes, A inserts, B's delete lands while A's insert is still uncommitted and removes
-- nothing, B inserts) and the table holds TWO generations of the same money.
--
-- Consequences, both real and both on the primary money screen:
--   • `get_budget_projection` summed ERP actuals with no `snapshot_id` predicate at all, so a $40,000
--     category reported $80,000 — an EAC of $115,000 against a $100,000 budget, a −$15,000 overrun
--     that does not exist, 1.15 utilization — stamped FRESH by `max(as_of)`, and persistent until the
--     next successful sweep. (0141 now also scopes its own read to one generation: a money aggregate
--     must be correct independently of who wrote it. Belt AND braces, deliberately.)
--   • Between the delete and the insert the org's snapshot was genuinely EMPTY, and the dashboard
--     rendered "No actuals snapshot yet" — byte-identical to an org that has never run a refresh — for
--     the duration of a multi-thousand-row insert, then cached it for 30s/5min.
--
-- ⚑ THE FIX IS THE WRITE, NOT A THIRD READER-SIDE DEFENCE. One statement — one transaction — publishes
-- a generation. After this migration no observer can see two generations, and none can see zero unless
-- the sweep genuinely published an empty one.
--
-- WHY SECURITY DEFINER. This is machine-written ERP truth (ADR-0048): the sweep's service-role client
-- is the only legitimate caller, and a user JWT must never author an accounting figure (0101 §5 gives
-- the three tables a SELECT-only policy for exactly that reason). Running as owner lets the function
-- re-assert the tenant boundary ITSELF rather than trusting the payload: `org_id` is taken from
-- `p_org_id` and every payload-supplied `org_id` is ignored, so no caller-shaped JSON can land a money
-- row in another tenant. `search_path` is pinned; EXECUTE is revoked from PUBLIC (hence from
-- `authenticated`/`anon`) and granted to `service_role` only.
--
-- WHY A WHITELIST AND NO DYNAMIC SQL. `p_table` selects one of three explicit branches and anything
-- else raises. A security-definer function that writes money does not build SQL from a caller's string,
-- not even a quoted one.
--
-- Scope note (deliberate): service_role retains direct DML on these tables. The e2e teardown and the
-- seed rely on it, and revoking it is a separate change. This RPC is the only PRODUCTION write path —
-- `accountingFanout` → `refreshActuals`/`refreshAging` route through it exclusively.
--
-- Proof: supabase/tests/erp_snapshot_generation_honesty.test.sql.
-- Reversibility (ADR-0006): drop function if exists public.replace_erp_snapshot(text, uuid, jsonb);

create or replace function public.replace_erp_snapshot(
  p_table  text,
  p_org_id uuid,
  p_rows   jsonb
) returns integer
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_rows    jsonb   := coalesce(p_rows, '[]'::jsonb);
  v_written integer := 0;
begin
  if p_org_id is null then
    raise exception 'replace_erp_snapshot: p_org_id is required'
      using errcode = '22004';
  end if;
  if jsonb_typeof(v_rows) <> 'array' then
    raise exception 'replace_erp_snapshot: p_rows must be a JSON array, got %', jsonb_typeof(v_rows)
      using errcode = '22023';
  end if;

  if p_table = 'erp_actuals_snapshot' then
    delete from public.erp_actuals_snapshot where org_id = p_org_id;
    insert into public.erp_actuals_snapshot
      (org_id, project_id, cost_center, account, fiscal_year, debit, credit, net, as_of, source_report, snapshot_id)
    select p_org_id, r.project_id, r.cost_center, r.account, r.fiscal_year, r.debit, r.credit, r.net,
           coalesce(r.as_of, now()), coalesce(r.source_report, 'GL Entry'), r.snapshot_id
      from jsonb_to_recordset(v_rows) as r(
        project_id    uuid,
        cost_center   text,
        account       text,
        fiscal_year   text,
        debit         numeric,
        credit        numeric,
        net           numeric,
        as_of         timestamptz,
        source_report text,
        snapshot_id   uuid);
    get diagnostics v_written = row_count;

  elsif p_table = 'erp_ap_aging_snapshot' then
    delete from public.erp_ap_aging_snapshot where org_id = p_org_id;
    insert into public.erp_ap_aging_snapshot
      (org_id, party, party_type, company_id, currency, total_outstanding, "current",
       b_0_30, b_31_60, b_61_90, b_90_plus, range_labels, report_date, ageing_based_on,
       as_of, source_report, report_version, snapshot_id)
    select p_org_id, r.party, r.party_type, r.company_id, r.currency, r.total_outstanding, r."current",
           r.b_0_30, r.b_31_60, r.b_61_90, r.b_90_plus, r.range_labels, r.report_date, r.ageing_based_on,
           coalesce(r.as_of, now()), r.source_report, r.report_version, r.snapshot_id
      from jsonb_to_recordset(v_rows) as r(
        party             text,
        party_type        text,
        company_id        uuid,
        currency          text,
        total_outstanding numeric,
        "current"         numeric,
        b_0_30            numeric,
        b_31_60           numeric,
        b_61_90           numeric,
        b_90_plus         numeric,
        range_labels      jsonb,
        report_date       date,
        ageing_based_on   text,
        as_of             timestamptz,
        source_report     text,
        report_version    text,
        snapshot_id       uuid);
    get diagnostics v_written = row_count;

  elsif p_table = 'erp_ar_aging_snapshot' then
    delete from public.erp_ar_aging_snapshot where org_id = p_org_id;
    insert into public.erp_ar_aging_snapshot
      (org_id, party, party_type, company_id, currency, total_outstanding, "current",
       b_0_30, b_31_60, b_61_90, b_90_plus, range_labels, report_date, ageing_based_on,
       as_of, source_report, report_version, snapshot_id)
    select p_org_id, r.party, r.party_type, r.company_id, r.currency, r.total_outstanding, r."current",
           r.b_0_30, r.b_31_60, r.b_61_90, r.b_90_plus, r.range_labels, r.report_date, r.ageing_based_on,
           coalesce(r.as_of, now()), r.source_report, r.report_version, r.snapshot_id
      from jsonb_to_recordset(v_rows) as r(
        party             text,
        party_type        text,
        company_id        uuid,
        currency          text,
        total_outstanding numeric,
        "current"         numeric,
        b_0_30            numeric,
        b_31_60           numeric,
        b_61_90           numeric,
        b_90_plus         numeric,
        range_labels      jsonb,
        report_date       date,
        ageing_based_on   text,
        as_of             timestamptz,
        source_report     text,
        report_version    text,
        snapshot_id       uuid);
    get diagnostics v_written = row_count;

  else
    raise exception 'replace_erp_snapshot: % is not a snapshot table', p_table
      using errcode = '22023';
  end if;

  return v_written;
end $$;

revoke all    on function public.replace_erp_snapshot(text, uuid, jsonb) from public;
grant  execute on function public.replace_erp_snapshot(text, uuid, jsonb) to service_role;

-- 0101's table comments asserted an atomicity the write path did not have. Correct the record on the
-- table itself, so the next reader of the schema is told what is actually guaranteed and by what.
comment on table public.erp_actuals_snapshot is
  'ERP GL actuals, GENERATIONAL (one snapshot_id per sweep pass). Published ONLY via '
  'public.replace_erp_snapshot(), which deletes the org''s prior generation and inserts the new one in '
  'ONE statement — so no reader can observe two generations, or zero mid-replace (0142).';
comment on table public.erp_ap_aging_snapshot is
  'ERP AP aging, GENERATIONAL. Published ONLY via public.replace_erp_snapshot() — atomic replace (0142).';
comment on table public.erp_ar_aging_snapshot is
  'ERP AR aging, GENERATIONAL. Published ONLY via public.replace_erp_snapshot() — atomic replace (0142).';
