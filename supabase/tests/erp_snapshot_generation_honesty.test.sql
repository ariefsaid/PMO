-- erp_snapshot_generation_honesty.test.sql — audit round 10, HIGH-1 (AC-BUD-053 / AC-ENA-060).
--
-- ⚑ THE GENERATIONAL-HONESTY INVARIANT.
--
--     A SNAPSHOT IS A GENERATION, AND MONEY IS SUMMED OVER EXACTLY ONE OF THEM. Two `snapshot_id`s
--     for one org are not "extra data" — they are the SAME money counted twice.
--
-- Round 10 found that `get_budget_projection`'s `actuals` CTE had no `snapshot_id` predicate at all:
-- it summed every row in `erp_actuals_snapshot` for a (project, fiscal_year), across generations. A
-- $40,000 category then reported $80,000 of ERP spend, an EAC of $115,000 against a $100,000 budget,
-- a −$15,000 overrun that does not exist and a 1.15 utilization — stamped FRESH by `max(as_of)` and
-- persistent until the next successful sweep, while the actuals card on the SAME dashboard showed
-- $40,000 because it filters generations.
--
-- The state was reachable because snapshot-replace was NOT one transaction: `actualsSnapshot.ts` did
-- `await delete()` and THEN `await insert()` — two PostgREST round trips — while the `*/5` sweep cron
-- fires `net.http_post` fire-and-forget (0102), so ticks overlap by construction. (The 0101 table
-- comment claiming the two run "in the SAME service-role tx" was simply false; it is corrected by
-- 0150.)
--
-- This file pins BOTH halves, because either alone leaves the money wrong for a different reason:
--   §1 THE WRITE — `replace_erp_snapshot` (0150) does the delete + the insert in ONE statement, so no
--      reader can ever observe two generations, and none can observe ZERO generations either (the
--      round-10 MED-1 window where the dashboard said "No actuals snapshot yet" mid-replace).
--   §2 THE READ  — `get_budget_projection` scopes its actuals to ONE generation ANYWAY. A money
--      aggregate must be correct independently of who wrote it; the guarantee above is the belt, this
--      is the braces. Existing fixtures could never see this: budget_projection_rpc.test.sql gives
--      every seeded row its own `gen_random_uuid()` snapshot_id, so no two generations ever land on
--      one account.
--
-- Namespaced 0c7a UUIDs (valid hex, not seed-colliding). Inline fixture idiom (set local role +
-- request.jwt.claims), as budget_projection_rpc.test.sql.
begin;
select plan(20);

-- ── Fixtures (inserted as table owner, bypassing RLS) ────────────────────────────────────────────
insert into organizations (id, name) values
  ('0c7a0000-0000-0000-0000-000000000001','Snapshot generation Org A'),
  ('0c7a0000-0000-0000-0000-000000000002','Snapshot generation Org B');

insert into auth.users (id, email) values
  ('0c7a0000-0000-0000-0000-0000000000a1','gen-admin-a@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('0c7a0000-0000-0000-0000-0000000000a1','0c7a0000-0000-0000-0000-000000000001','A Admin','gen-admin-a@example.com','Admin','active');

insert into projects (id, org_id, name, status) values
  ('0c7a1111-0000-0000-0000-000000000001','0c7a0000-0000-0000-0000-000000000001','Generation Honesty Project','Ongoing Project');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §2 (asserted first, on a hand-seeded two-generation table) — THE READ MUST NOT SUM ACROSS
-- GENERATIONS.
--
-- TWO generations coexist for org A. The NEWEST (`snap-new`) holds $40,000 on the mapped account
-- '5100'. The STALE one (`snap-old`) holds the SAME $40,000 on '5100' — the identical row the newest
-- generation replaced — plus a $500 row on '5200' that the newest generation no longer has (the GL
-- posting was cancelled, or the account stopped being used).
--
-- So the read has two ways to lie, and both are asserted: DOUBLE the money on '5100', and RESURRECT
-- a category that the current ledger reading does not mention at all.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
insert into erp_actuals_snapshot (org_id, project_id, account, fiscal_year, debit, credit, net, snapshot_id, as_of, created_at) values
  -- the CURRENT generation
  ('0c7a0000-0000-0000-0000-000000000001','0c7a1111-0000-0000-0000-000000000001','5100 - Direct Costs - PSC','2026',40000.00,0,40000.00,
   '0c7a5555-0000-0000-0000-00000000000b','2026-07-22T10:00:00Z','2026-07-22T10:00:00Z'),
  -- the STALE generation a racing delete failed to clear
  ('0c7a0000-0000-0000-0000-000000000001','0c7a1111-0000-0000-0000-000000000001','5100 - Direct Costs - PSC','2026',40000.00,0,40000.00,
   '0c7a5555-0000-0000-0000-00000000000a','2026-07-22T09:00:00Z','2026-07-22T09:00:00Z'),
  ('0c7a0000-0000-0000-0000-000000000001','0c7a1111-0000-0000-0000-000000000001','5200 - Materials - PSC','2026',500.00,0,500.00,
   '0c7a5555-0000-0000-0000-00000000000a','2026-07-22T09:00:00Z','2026-07-22T09:00:00Z');

set local role authenticated;
set local request.jwt.claims = '{"sub":"0c7a0000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into public.budget_category_account_map (category, erp_account) values
  ('Labor','5100 - Direct Costs - PSC'),
  ('Materials','5200 - Materials - PSC');

select is(
  (select actuals_to_date from public.get_budget_projection('0c7a1111-0000-0000-0000-000000000001','2026')
    where category = 'Labor'),
  40000.00::numeric,
  'AC-BUD-053 actuals are summed over ONE snapshot generation — a stale generation never doubles the money');

select is(
  (select actuals_as_of from public.get_budget_projection('0c7a1111-0000-0000-0000-000000000001','2026')
    where category = 'Labor'),
  '2026-07-22T10:00:00Z'::timestamptz,
  'AC-BUD-053 the provenance stamp is the CURRENT generation''s as_of, not a max() across generations');

select is(
  (select count(*)::int from public.get_budget_projection('0c7a1111-0000-0000-0000-000000000001','2026')
    where category = 'Materials'),
  0,
  'AC-BUD-053 a category present ONLY in a stale generation is not resurrected by the read');

select is(
  (select count(*)::int from public.get_budget_projection('0c7a1111-0000-0000-0000-000000000001','2026')),
  1,
  'AC-BUD-053 the projection returns exactly the current generation''s categories');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §1 — THE WRITE: replace_erp_snapshot is the atomic snapshot-replace, and the ONLY way a sweep may
-- publish a generation.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
reset role;

select has_function('public','replace_erp_snapshot', array['text','uuid','jsonb'],
  'AC-ENA-060 the atomic snapshot-replace RPC exists');

select is(p.prosecdef, true, 'AC-ENA-060 replace_erp_snapshot is SECURITY DEFINER (it re-asserts org scope itself)')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'replace_erp_snapshot';

select ok(has_function_privilege('service_role','public.replace_erp_snapshot(text,uuid,jsonb)','execute'),
  'AC-ENA-060 service_role (the sweep) may execute the replace');
select ok(not has_function_privilege('authenticated','public.replace_erp_snapshot(text,uuid,jsonb)','execute'),
  'AC-ENA-060 a user JWT may NOT execute the replace (ERP truth is machine-written, ADR-0048)');
select ok(not has_function_privilege('anon','public.replace_erp_snapshot(text,uuid,jsonb)','execute'),
  'AC-ENA-060 anon may NOT execute the replace');

-- Org B holds its own generation, which no replace of org A may touch.
insert into erp_actuals_snapshot (org_id, project_id, account, fiscal_year, debit, credit, net, snapshot_id) values
  ('0c7a0000-0000-0000-0000-000000000002',null,'5100 - Direct Costs - PSC','2026',777.00,0,777.00,
   '0c7a5555-0000-0000-0000-0000000000b1');

set local role service_role;

-- ⚑ A REPLACE, not an append: the two coexisting generations above are gone, and exactly the payload
-- remains. `org_id` in the payload is deliberately a FOREIGN org — the definer stamps `p_org_id` and
-- never lets a caller-supplied column decide which tenant a money row lands in.
select is(
  public.replace_erp_snapshot(
    'erp_actuals_snapshot',
    '0c7a0000-0000-0000-0000-000000000001',
    '[{"org_id":"0c7a0000-0000-0000-0000-000000000002",
       "project_id":"0c7a1111-0000-0000-0000-000000000001",
       "cost_center":"Main - PSC","account":"5100 - Direct Costs - PSC","fiscal_year":"2026",
       "debit":41000.00,"credit":0,"net":41000.00,
       "as_of":"2026-07-22T11:00:00Z","source_report":"GL Entry",
       "snapshot_id":"0c7a5555-0000-0000-0000-00000000000c"}]'::jsonb),
  1,
  'AC-ENA-060 the replace reports the number of rows it published');

select is(
  (select count(distinct snapshot_id)::int from erp_actuals_snapshot
    where org_id = '0c7a0000-0000-0000-0000-000000000001'),
  1,
  'AC-ENA-060 after a replace exactly ONE generation exists for the org (the two-generation state is unreachable)');

select is(
  (select net from erp_actuals_snapshot where org_id = '0c7a0000-0000-0000-0000-000000000001'),
  41000.00::numeric,
  'AC-ENA-060 the published generation holds exactly the payload the sweep summed');

select is(
  (select org_id from erp_actuals_snapshot where snapshot_id = '0c7a5555-0000-0000-0000-00000000000c'),
  '0c7a0000-0000-0000-0000-000000000001'::uuid,
  'AC-ENA-060 a payload-supplied org_id is IGNORED — the row lands under p_org_id, never another tenant');

select is(
  (select count(*)::int from erp_actuals_snapshot where org_id = '0c7a0000-0000-0000-0000-000000000002'),
  1,
  'AC-ENA-060 another org''s generation is untouched by the replace (org scope re-asserted in the definer)');

-- ⚑ NOTHING HALF-APPLIED. The delete and the insert are ONE statement, so a payload the insert cannot
-- accept aborts the whole replace. What this pins beyond Postgres'' statement atomicity is that the
-- function does NOT swallow the insert failure (an `exception when others` around it would leave the
-- delete standing and publish an EMPTY snapshot — a silent, dated $0 on the money screen).
select throws_ok(
  $$ select public.replace_erp_snapshot('erp_actuals_snapshot','0c7a0000-0000-0000-0000-000000000001',
       '[{"project_id":"not-a-uuid","net":1}]'::jsonb) $$,
  '22P02', null,
  'AC-ENA-060 a payload the insert rejects aborts the WHOLE replace (never a half-applied, empty snapshot)');

select is(
  (select count(*)::int from erp_actuals_snapshot where org_id = '0c7a0000-0000-0000-0000-000000000001'),
  1,
  'AC-ENA-060 the prior generation survives a rejected replace (fail-closed, not fail-empty)');

select throws_ok(
  $$ select public.replace_erp_snapshot('profiles','0c7a0000-0000-0000-0000-000000000001','[]'::jsonb) $$,
  '22023', null,
  'AC-ENA-060 the table name is a WHITELIST — the definer refuses to replace anything but a snapshot table');

select is(
  public.replace_erp_snapshot(
    'erp_ap_aging_snapshot',
    '0c7a0000-0000-0000-0000-000000000001',
    '[{"party":"Spike Supplier","party_type":"Supplier","currency":"IDR","total_outstanding":75000.00,
       "current":0,"b_0_30":75000.00,"b_31_60":0,"b_61_90":0,"b_90_plus":0,
       "range_labels":{"range1":"0-30"},"report_date":"2026-07-22","ageing_based_on":"Due Date",
       "as_of":"2026-07-22T11:00:00Z","source_report":"Accounts Payable","report_version":"erpnext-15",
       "snapshot_id":"0c7a5555-0000-0000-0000-00000000000d"}]'::jsonb),
  1,
  'AC-ENA-061 the AP aging snapshot replaces atomically through the same RPC');

select is(
  public.replace_erp_snapshot(
    'erp_ar_aging_snapshot',
    '0c7a0000-0000-0000-0000-000000000001',
    '[{"party":"Cust A","party_type":"Customer","currency":"IDR","total_outstanding":10.00,
       "current":10.00,"b_0_30":0,"b_31_60":0,"b_61_90":0,"b_90_plus":0,
       "range_labels":null,"report_date":null,"ageing_based_on":null,
       "as_of":"2026-07-22T11:00:00Z","source_report":"Accounts Receivable","report_version":"erpnext-15",
       "snapshot_id":"0c7a5555-0000-0000-0000-00000000000e"}]'::jsonb),
  1,
  'AC-SAR-050 the AR aging snapshot replaces atomically through the same RPC');

select is(
  (select range_labels from erp_ap_aging_snapshot where org_id = '0c7a0000-0000-0000-0000-000000000001'),
  '{"range1":"0-30"}'::jsonb,
  'AC-ENA-061 the report''s range labels are stored VERBATIM through the replace (FR-ENA-161)');

select * from finish();
rollback;
