-- ap_invoices_payments_offboarded_rls.test.sql
-- Luna re-audit BLOCK #10, AP half [pgTAP]: offboarded (disabled) users must not WRITE AP data.
--
-- ⚑ The audit finding as written ("a disabled user can export AP invoice/payment amounts") is
-- WRONG and this test records why: 0063's conjunction pass DID cover `procurement_invoices_select`
-- and `payments_select`, so reads were never exposed. What 0100's flip rewrite dropped is the
-- conjunct on the INSERT/UPDATE/DELETE policies.
--
-- Exploitability differs per table, which is why the assertions below are asymmetric:
--   • `procurement_invoices` — `authenticated` holds INSERT + DELETE grants, so the missing
--     conjunct was genuinely reachable: a disabled user with a live JWT could CREATE and DELETE
--     supplier invoices. That is the real hole; it is asserted directly.
--   • `payments` — `authenticated` holds SELECT only (no write grants), so the same policy gap was
--     never reachable from a client. 0110 still conjoins it as defence in depth (a future GRANT
--     must not silently re-open it), but no exploit assertion is written here, because a denial
--     would prove the grant, not the policy — both surface as 42501 and the test would pass for
--     the wrong reason.
--
-- Rows are seeded AS TABLE OWNER so a denial is a real DENY, and the ALLOW cases prove 0110 denies
-- offboarded users specifically rather than breaking the table for everyone.
-- ⚑⚑ SEVERITY, MEASURED NOT ASSUMED: the behavioural assertions below pass BOTH with and without
-- 0110 — a disabled user is already denied every AP write today, but TRANSITIVELY, not by these
-- policies:
--   • DELETE/UPDATE must locate rows through SELECT visibility, and SELECT already carries the
--     conjunct (0063).
--   • INSERT's `exists (select 1 from procurements …)` subquery reads `procurements`, whose SELECT
--     policy also carries it.
-- So this is NOT a live exploit — it is a fragility: the protection rests on OTHER tables' policies,
-- and a future GRANT or a rewrite of the `procurements` SELECT policy would silently open it. 0110
-- makes the guarantee local and explicit. The structural assertion below is therefore the one that
-- genuinely goes RED without 0110; the behavioural ones are regression guards.
begin;
select plan(7);

-- ── The assertion that actually proves 0110 landed (RED without it: 2 of 8). ──
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename in ('procurement_invoices','payments')
      and coalesce(qual,'') || coalesce(with_check,'') like '%is_active_member%'),
  8,
  'Luna B10-AP all 8 AP policies (select/insert/update/delete x2 tables) carry is_active_member()');

-- ── Fixtures: one org, one ACTIVE Finance member, one DISABLED Finance member. ──
insert into organizations (id, name) values
  ('01100000-0000-0000-0000-000000000001','Luna B10 AP Org');
insert into auth.users (id, email) values
  ('01100000-0000-0000-0000-0000000000a1','b10ap-active@example.com'),
  ('01100000-0000-0000-0000-0000000000a2','b10ap-disabled@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('01100000-0000-0000-0000-0000000000a1','01100000-0000-0000-0000-000000000001','A Active','b10ap-active@example.com','Finance','active'),
  ('01100000-0000-0000-0000-0000000000a2','01100000-0000-0000-0000-000000000001','D Disabled','b10ap-disabled@example.com','Finance','disabled');

insert into procurements (id, org_id, title) values
  ('01100000-0000-0000-0000-0000000d0001','01100000-0000-0000-0000-000000000001','B10 AP Procurement');
insert into procurement_invoices (id, org_id, procurement_id, vi_number, invoice_date, status) values
  ('01100000-0000-0000-0000-0000000e0001','01100000-0000-0000-0000-000000000001','01100000-0000-0000-0000-0000000d0001','VI-B10-0001','2026-07-01','Received');

-- ════════════════════════════════════════════════════════════════════════════
-- DENY — the disabled member cannot WRITE. This is the hole 0110 closes.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"01100000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select throws_ok(
  $$insert into procurement_invoices (org_id, procurement_id, vi_number, invoice_date, status)
    values ('01100000-0000-0000-0000-000000000001','01100000-0000-0000-0000-0000000d0001','VI-B10-EVIL','2026-07-02','Received')$$,
  '42501',
  null,
  'Luna B10-AP disabled member cannot INSERT a procurement_invoice (is_active_member conjunct)');

-- DELETE is granted to `authenticated` too, so the gap was reachable both ways. A disabled user
-- destroying an AP invoice is the more damaging half.
select lives_ok(
  $$delete from procurement_invoices where id = '01100000-0000-0000-0000-0000000e0001'$$,
  'Luna B10-AP disabled member DELETE executes without error…');

-- Reads were never the hole (0063 covered SELECT) — asserted as a regression guard so a future
-- rewrite cannot quietly drop it.
select is((select count(*)::int from procurement_invoices), 0,
  'Luna B10-AP disabled member still reads 0 procurement_invoices (0063 SELECT conjunct intact)');

-- ⚑ Survival MUST be checked as the table owner, not as the disabled user: that user's SELECT is
-- already filtered to zero rows, so counting through their view returns 0 whether the DELETE landed
-- or not — an assertion that cannot tell the exploit from the fix. Reset the role first.
reset role;
select is((select count(*)::int from procurement_invoices where id = '01100000-0000-0000-0000-0000000e0001'), 1,
  '…and deleted NOTHING — the row survives, verified as owner (is_active_member conjunct on DELETE)');
set local role authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ALLOW — an ACTIVE member of the SAME org is unaffected.
-- ════════════════════════════════════════════════════════════════════════════
set local request.jwt.claims = '{"sub":"01100000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is((select count(*)::int from procurement_invoices), 1,
  'Luna B10-AP ACTIVE member still reads the procurement_invoice');
select lives_ok(
  $$insert into procurement_invoices (org_id, procurement_id, vi_number, invoice_date, status)
    values ('01100000-0000-0000-0000-000000000001','01100000-0000-0000-0000-0000000d0001','VI-B10-OK','2026-07-02','Received')$$,
  'Luna B10-AP ACTIVE Finance member can still INSERT a procurement_invoice (0110 did not break writes)');

select * from finish();
rollback;
