-- procurement_doc_number_format.test.sql — AC-803 (re-homed from the deleted formatDocNumber TS
-- helper, #1710). The reference-number format is ENFORCED by the shipped security-definer minter
-- next_procurement_doc_number (0006, never redefined): `<prefix>-<YYMMDD><seq>` with the sequence
-- zero-padded to width 4 — pad, never truncate. The date authority is the database clock
-- (current_date); the deleted TS mirror was a SECOND date authority and the source of the C4
-- timezone drift bug, so the assertion pins the minted number to the same to_char(current_date)
-- expression the function itself uses.
-- Mutation-check: edit 0006's return line (e.g. lpad(v_seq::text, 4, '0') → 2, or 'YYMMDD' →
-- 'YYYYMMDD') and the format cases here go red.
-- (FR-PROC-010; per-day reset + uniqueness under concurrency are owned by 0016/0017 (AC-811/812).)
-- The minter is internal-only (execute revoked from authenticated/anon), so this test calls it as
-- the table owner, exactly as its RPC callers do.
-- Isolated org; UUID prefix 17120000-… (issue #1710).
begin;
create extension if not exists pgtap;
select plan(5);

insert into organizations (id, name) values
  ('17120000-0000-0000-0000-000000000001','Doc Number Org (1710)');

-- ── AC-803: the first mint of the day is <prefix>-<YYMMDD>0001 ───────────────
select is(
  next_procurement_doc_number('17120000-0000-0000-0000-000000000001','PO'),
  'PO-' || to_char(current_date,'YYMMDD') || '0001',
  'AC-803: prefix PO, first sequence → PO-<YYMMDD>0001 (width-4 zero-pad) (FR-PROC-010)');

-- ── AC-803: the AC's sequence-42 example — width-4 zero-pad, not concatenated ─
update public.procurement_doc_counters set last_seq = 41
 where org_id = '17120000-0000-0000-0000-000000000001' and prefix = 'PO' and doc_date = current_date;
select is(
  next_procurement_doc_number('17120000-0000-0000-0000-000000000001','PO'),
  'PO-' || to_char(current_date,'YYMMDD') || '0042',
  'AC-803: sequence 42 → PO-<YYMMDD>0042 (FR-PROC-010)');

-- ── AC-803: the prefix is the number's literal head (second counter, PO untouched) ──
select is(
  next_procurement_doc_number('17120000-0000-0000-0000-000000000001','PR'),
  'PR-' || to_char(current_date,'YYMMDD') || '0001',
  'AC-803: prefix PR mints its own PR-<YYMMDD>0001 (FR-PROC-010)');

-- ── AC-803: width 4 pads, never truncates — 999+1 → …1000 (five digits stay) ─
update public.procurement_doc_counters set last_seq = 999
 where org_id = '17120000-0000-0000-0000-000000000001' and prefix = 'PR' and doc_date = current_date;
select is(
  next_procurement_doc_number('17120000-0000-0000-0000-000000000001','PR'),
  'PR-' || to_char(current_date,'YYMMDD') || '1000',
  'AC-803: sequence 1000 → <prefix>-<YYMMDD>1000 (pad does not truncate) (FR-PROC-010)');

-- ── AC-803: the date engine itself — the AC's fixed example 2026-06-04 → 260604 ──
select is(
  to_char('2026-06-04'::date,'YYMMDD'),
  '260604',
  'AC-803: the YYMMDD date engine formats 2026-06-04 as 260604 (FR-PROC-010)');

select * from finish();
rollback;
