-- 0104_select_trigger_events_rpc.test.sql — SEC-HIGH-2: the dispatcher's org-correct event selection RPC.
--
-- select_trigger_events(p_source, p_last_seen_at, p_last_seen_id, p_filters) is the ENFORCEMENT
-- authority for cross-org trigger tenancy. Before this RPC the agent-dispatch edge fn read
-- procurement_status_events directly under service_role (RLS-bypassing) and filtered org in JS — a
-- violation of the "service_role never reads business data" invariant (ADR-0036 §2). The RPC now:
--   • returns ONLY events whose (org_id, to_status) matches one of the caller-supplied p_filters pairs,
--     so a cross-org event is NEVER returned to the edge fn at all;
--   • applies the compound (created_at, id) watermark cursor in SQL;
--   • returns only the MINIMAL projection (id, created_at, to_status, org_id);
--   • returns zero rows for a non-allowlisted source (no dynamic table access).
-- SECURITY DEFINER + pinned search_path; RLS is the wall inside — the org filtering is per-automation
-- (each filter pair carries its own org), so no cross-org row is ever materialised.
--
-- pgTAP after 0103. Fixture namespace: 01040000-…. Org A = default '00000000-…-0001'; Org B = '01040000-…-0002'.
begin;
select plan(8);

-- ── Fixtures (inserted as table owner, bypassing RLS) ───────────────────────
insert into organizations (id, name) values
  ('01040000-0000-0000-0000-000000000002','STE RPC Org B');

-- Two procurements, one per org (procurement_status_events FKs procurements.id).
insert into procurements (id, org_id, title, status) values
  ('01040000-0000-0000-0000-0000000000a0','00000000-0000-0000-0000-000000000001','STE Proc A','Ordered'),
  ('01040000-0000-0000-0000-0000000000b0','01040000-0000-0000-0000-000000000002','STE Proc B','Ordered');

-- Status events: two org-A events (one Ordered, one Received), one org-B event (Ordered).
insert into procurement_status_events (id, org_id, procurement_id, to_status, created_at) values
  ('01040000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','01040000-0000-0000-0000-0000000000a0','Ordered', '2026-07-06T08:00:00Z'),
  ('01040000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','01040000-0000-0000-0000-0000000000a0','Received','2026-07-06T08:00:01Z'),
  ('01040000-0000-0000-0000-000000000020','01040000-0000-0000-0000-000000000002','01040000-0000-0000-0000-0000000000b0','Ordered', '2026-07-06T08:00:00Z');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-STE-001: an Org-A filter returns ONLY the Org-A Ordered event; the Org-B Ordered event is NEVER
-- returned (cross-org row never materialises — the RPC is the enforcement authority, SEC-HIGH-2).
-- ════════════════════════════════════════════════════════════════════════════
-- Scope to this test's fixture namespace (seed.sql also has org-A Ordered events, correctly returned).
select is(
  (select array_agg(id::text order by id) from select_trigger_events(
    'procurement_status_events', null, null,
    '[{"org_id":"00000000-0000-0000-0000-000000000001","event":"Ordered"}]'::jsonb)
   where id::text like '01040000-%'),
  array['01040000-0000-0000-0000-000000000010'],
  'AC-STE-001: an Org-A Ordered filter returns only the Org-A Ordered event');

select is(
  (select count(*)::int from select_trigger_events(
    'procurement_status_events', null, null,
    '[{"org_id":"00000000-0000-0000-0000-000000000001","event":"Ordered"}]'::jsonb)
   where org_id = '01040000-0000-0000-0000-000000000002'),
  0,
  'AC-STE-001: the Org-B event is NEVER returned to an Org-A filter (no cross-org leak)');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-STE-002: a filter matches on BOTH org_id AND to_status — a same-org non-matching status is excluded,
-- and an Org-B filter returns only its own org's event.
-- ════════════════════════════════════════════════════════════════════════════
-- Org-A Ordered filter must NOT return the Org-A Received event (status mismatch).
select is(
  (select count(*)::int from select_trigger_events(
    'procurement_status_events', null, null,
    '[{"org_id":"00000000-0000-0000-0000-000000000001","event":"Ordered"}]'::jsonb)
   where to_status <> 'Ordered'),
  0,
  'AC-STE-002: a same-org event of a non-matching status is excluded (matches to_status too)');

-- An Org-B Ordered filter returns ONLY the Org-B event (and never the Org-A one).
select is(
  (select array_agg(id::text order by id) from select_trigger_events(
    'procurement_status_events', null, null,
    '[{"org_id":"01040000-0000-0000-0000-000000000002","event":"Ordered"}]'::jsonb)),
  array['01040000-0000-0000-0000-000000000020'],
  'AC-STE-002: an Org-B filter returns only the Org-B event');

-- Two filters (both orgs) return each org's own event — never cross-matched (scoped to fixtures).
select is(
  (select array_agg(id::text order by id) from select_trigger_events(
    'procurement_status_events', null, null,
    '[{"org_id":"00000000-0000-0000-0000-000000000001","event":"Ordered"},
      {"org_id":"01040000-0000-0000-0000-000000000002","event":"Ordered"}]'::jsonb)
   where id::text like '01040000-%'),
  array['01040000-0000-0000-0000-000000000010','01040000-0000-0000-0000-000000000020'],
  'AC-STE-002: multi-org filters return each org''s own event, never cross-matched');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-STE-003: the compound (created_at, id) cursor excludes already-seen rows.
-- ════════════════════════════════════════════════════════════════════════════
-- Cursor at the Org-A Ordered event (08:00:00, id …10): the next org-A Received event (08:00:01) is
-- strictly after, but a matching Ordered filter still excludes it (status), so query the Received filter.
select is(
  (select array_agg(id::text order by id) from select_trigger_events(
    'procurement_status_events', '2026-07-06T08:00:00Z'::timestamptz, '01040000-0000-0000-0000-000000000010'::uuid,
    '[{"org_id":"00000000-0000-0000-0000-000000000001","event":"Received"}]'::jsonb)
   where id::text like '01040000-%'),
  array['01040000-0000-0000-0000-000000000011'],
  'AC-STE-003: an event strictly after the cursor is returned');

-- Cursor at the Received event (08:00:01, id …11): nothing after it for org A → zero rows.
select is(
  (select count(*)::int from select_trigger_events(
    'procurement_status_events', '2026-07-06T08:00:01Z'::timestamptz, '01040000-0000-0000-0000-000000000011'::uuid,
    '[{"org_id":"00000000-0000-0000-0000-000000000001","event":"Ordered"},
      {"org_id":"00000000-0000-0000-0000-000000000001","event":"Received"}]'::jsonb)
   where id::text like '01040000-%'),
  0,
  'AC-STE-003: an event at-or-before the cursor is excluded (no double-fire)');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-STE-004: a non-allowlisted source returns zero rows (no dynamic table access).
-- ════════════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::int from select_trigger_events(
    'profiles', null, null,
    '[{"org_id":"00000000-0000-0000-0000-000000000001","event":"Ordered"}]'::jsonb)),
  0,
  'AC-STE-004: a non-allowlisted source returns zero rows');

select * from finish();
rollback;
