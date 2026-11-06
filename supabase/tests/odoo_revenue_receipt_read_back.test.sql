-- #1825 (migration 0695, review round): `record_sales_invoice_receipt_read_back` — the receipt
-- finalize's invoice read-back merge as ONE atomic statement.
--
-- ⚑ WHY THIS FILE DRIVES A REAL SECOND SESSION (0155_command_held_interleave pattern). The bug under
-- review (I2) was a read-merge-write: two receipts finalizing on one invoice interleaved between the
-- select and the update, and the loser's stale merge dropped the winner's reference — with the clock
-- fallback disabled, that receipt's awaiting-Odoo flag could never clear. A serial "merge A, then
-- merge B" test cannot distinguish one atomic statement from a re-introduced read-merge-write, so it
-- would stay green while the race re-opened. Here the concurrent session (dblink) finalizes receipt A
-- INSIDE an open transaction (holding the invoice row's lock); this session's finalize of receipt B
-- must BLOCK on that exact row (lock_timeout ⇒ 55P03 — a read-merge-write's select would sail through
-- on a stale read first), and once A commits, B's merge must keep BOTH references.
--
-- The serial half pins the rest of the contract: the ACL (machine-only, 0163 pattern), the 0511 mirror
-- guard still governing the write (service-role JWT claims are the only way in), additivity and the
-- replay dedupe (`array(select distinct …)`), org scoping, and — review M1 — that a NULL fact argument
-- keeps the column it would have written (erp_modified / odoo_read_at included): the mirror never
-- erases what the ledger said, and the money keys move only with a readable outstanding figure.
--
-- ⚑ SELF-HEALING fixtures (0155 S5): everything the second session touches is COMMITTED by the second
-- session and cleaned by it too (pre-clean before, cleanup after — identical deletes), so a run that
-- dies mid-file leaves no ghost for the rest of the `supabase test db` run. The ids are unique to this
-- file. The LOCAL session never writes the fixture rows: its only write (the 42501 guard probe) is
-- rolled back by throws_ok, and the blocked finalize (55P03) never got past the lock — so the cleanup
-- deletes cannot deadlock against a lock this session holds.
begin;
select plan(14);

create extension if not exists dblink;

-- ── The concurrent session (loopback connect, 0155's pattern; password=postgres is the Supabase LOCAL
-- default; this file only runs against the local/CI `supabase test db`). ────────────────────────────
select dblink_connect('rb', format(
  'dbname=%s user=%s password=postgres host=%s port=%s',
  current_database(), current_user,
  coalesce(host(inet_server_addr()), 'supabase_db_pmo-portal'),
  coalesce(inet_server_port(), 5432)));
-- A second connection reads COMMITTED state while 'rb' holds its open finalize transaction — reading
-- through 'rb' mid-flight would see its own uncommitted write and prove nothing.
select dblink_connect('rb2', format(
  'dbname=%s user=%s password=postgres host=%s port=%s',
  current_database(), current_user,
  coalesce(host(inet_server_addr()), 'supabase_db_pmo-portal'),
  coalesce(inet_server_port(), 5432)));

-- ⚑ S5: the idempotent PRE-clean — identical to the cleanup at the end. A run that died mid-file left
-- these rows committed; this erases them before re-creating them.
select dblink_exec('rb', $pre$
  delete from sales_invoices where org_id = '18f5825a-0000-0000-0000-000000000001';
  delete from companies      where org_id = '18f5825a-0000-0000-0000-000000000001';
  delete from organizations  where id     = '18f5825a-0000-0000-0000-000000000001';
$pre$);

-- Fixtures COMMITTED by the second session so both sessions see + row-lock them.
select dblink_exec('rb', $fx$
  insert into organizations (id, name) values
    ('18f5825a-0000-0000-0000-000000000001', 'Read-back Org');
  insert into companies (id, org_id, name, type) values
    ('18f5825a-0000-0000-0000-0000000000c1', '18f5825a-0000-0000-0000-000000000001', 'Read-back Client', 'Client');
  insert into sales_invoices (id, org_id, customer_id, si_number, invoice_date, amount, tax_amount, tax_treatment, status, erp_docstatus) values
    ('18f5825a-0000-0000-0000-0000000000e1', '18f5825a-0000-0000-0000-000000000001', '18f5825a-0000-0000-0000-0000000000c1', 'INV/2026/00001', '2026-11-03', 1110.00, 110.00, 'inclusive', 'Unpaid', 1),
    ('18f5825a-0000-0000-0000-0000000000e2', '18f5825a-0000-0000-0000-000000000001', '18f5825a-0000-0000-0000-0000000000c1', 'INV/2026/00002', '2026-11-03', 2220.00, 220.00, 'inclusive', 'Unpaid', 1);
$fx$);

-- Every later remote call runs AS THE MIRROR WRITER: the service role holding its JWT claims — the
-- only shape the 0511 guard lets write the Odoo facts (reset before the cleanup deletes).
select dblink_exec('rb', $ctx$set role service_role; set request.jwt.claims = '{"role":"service_role"}';$ctx$);

-- ── ACL discipline (0163 pattern): MACHINE-ONLY. ────────────────────────────────────────────────────
select ok(has_function_privilege('service_role', 'public.record_sales_invoice_receipt_read_back(uuid,uuid,text[],text,numeric,text,timestamptz)', 'EXECUTE'),
  '#1825 (review I2) the service-role dispatch edge fn can call the atomic read-back merge');
select is(has_function_privilege('anon', 'public.record_sales_invoice_receipt_read_back(uuid,uuid,text[],text,numeric,text,timestamptz)', 'EXECUTE')
          or has_function_privilege('authenticated', 'public.record_sales_invoice_receipt_read_back(uuid,uuid,text[],text,numeric,text,timestamptz)', 'EXECUTE'), false,
  '#1825 (review I2) client roles cannot forge the read-back evidence (the awaiting-Odoo flag''s oracle)');

-- ── The 0511 mirror guard still governs: WITHOUT service-role JWT claims the write is refused, so the
-- RPC cannot become a side door around the pin (this session runs unclaimed — exactly a non-mirror
-- caller's shape). ───────────────────────────────────────────────────────────────────────────────────
select throws_ok(
  $$select public.record_sales_invoice_receipt_read_back(
       '18f5825a-0000-0000-0000-000000000001'::uuid, '18f5825a-0000-0000-0000-0000000000e1'::uuid,
       array['account.payment:1']::text[], null, null, null, null) $$,
  '42501', 'the Odoo facts of an invoice are written only by the mirror',
  '#1825 (review I2) without the service-role claims the guard refuses the write — the RPC is not a pin bypass');

-- ── Serial contract on invoice e1 (every call autocommitted by the second session; this session only
-- reads committed state, so it never holds a fixture lock). ─────────────────────────────────────────
-- 0695's default: a fresh invoice row states an EMPTY SET, not null.
select is(
  (select refs from dblink('rb', $q$select odoo_matched_payment_refs::text from sales_invoices where id = '18f5825a-0000-0000-0000-0000000000e2'$q$) as t(refs text)),
  '{}', '#1825 (review M3) a fresh invoice''s matched references are the empty set (the 0695 default), not null');

-- First finalize: the reference lands WITH the readable money the read-back showed.
select called from dblink('rb', $a$select (public.record_sales_invoice_receipt_read_back(
  '18f5825a-0000-0000-0000-000000000001'::uuid, '18f5825a-0000-0000-0000-0000000000e1'::uuid,
  array['account.payment:1']::text[], '2026-11-05 10:00:00', '0.00', 'Paid', '2026-11-05T10:00:01.000Z'::timestamptz) is null)::text$a$) as t(called text);
select is(
  (select sorted from dblink('rb', $q$select array_agg(r order by r) from unnest((select odoo_matched_payment_refs from sales_invoices where id = '18f5825a-0000-0000-0000-0000000000e1')) r$q$) as t(sorted text[])),
  array['account.payment:1']::text[],
  '#1825 the finalize records the receipt reference the read-back matched');
select is(
  (select row(erp_modified, odoo_read_at::text, erp_outstanding_amount::text, status)::text
     from dblink('rb', $q$select erp_modified, odoo_read_at, erp_outstanding_amount, status from sales_invoices where id = '18f5825a-0000-0000-0000-0000000000e1'$q$) as t(erp_modified text, odoo_read_at timestamptz, erp_outstanding_amount numeric, status text)),
  '("2026-11-05 10:00:00","2026-11-05 10:00:01+00",0.00,Paid)',
  '#1825 the read-back''s money moves with the reference (outstanding + the status derived from it)');

-- A REPLAY of the same receipt (review M2's same-ref case) duplicates nothing, and — review M1 — every
-- NULL fact argument keeps the column it would have written: the mirror never erases what the ledger said.
select called from dblink('rb', $b$select (public.record_sales_invoice_receipt_read_back(
  '18f5825a-0000-0000-0000-000000000001'::uuid, '18f5825a-0000-0000-0000-0000000000e1'::uuid,
  array['account.payment:1']::text[], null, null, null, null) is null)::text$b$) as t(called text);
select is(
  (select sorted from dblink('rb', $q$select array_agg(r order by r) from unnest((select odoo_matched_payment_refs from sales_invoices where id = '18f5825a-0000-0000-0000-0000000000e1')) r$q$) as t(sorted text[])),
  array['account.payment:1']::text[],
  '#1825 (review M2) a replayed finalize does not duplicate the reference it already recorded');
select is(
  (select row(erp_modified, odoo_read_at::text, erp_outstanding_amount::text, status)::text
     from dblink('rb', $q$select erp_modified, odoo_read_at, erp_outstanding_amount, status from sales_invoices where id = '18f5825a-0000-0000-0000-0000000000e1'$q$) as t(erp_modified text, odoo_read_at timestamptz, erp_outstanding_amount numeric, status text)),
  '("2026-11-05 10:00:00","2026-11-05 10:00:01+00",0.00,Paid)',
  '#1825 (review M1) an unreadable read-back header (all facts null) keeps erp_modified, odoo_read_at AND the money exactly as the ledger said');

-- A second receipt on the same invoice: additive, with the in-call duplicate collapsed by the distinct.
select called from dblink('rb', $c$select (public.record_sales_invoice_receipt_read_back(
  '18f5825a-0000-0000-0000-000000000001'::uuid, '18f5825a-0000-0000-0000-0000000000e1'::uuid,
  array['account.payment:2','account.payment:2']::text[], null, null, null, null) is null)::text$c$) as t(called text);
select is(
  (select sorted from dblink('rb', $q$select array_agg(r order by r) from unnest((select odoo_matched_payment_refs from sales_invoices where id = '18f5825a-0000-0000-0000-0000000000e1')) r$q$) as t(sorted text[])),
  array['account.payment:1','account.payment:2']::text[],
  '#1825 (review M2) a second receipt''s reference is appended beside the first''s, and an in-call duplicate collapses');

-- Org scope: a call naming ANOTHER org matches no row and touches nothing.
select called from dblink('rb', $d$select (public.record_sales_invoice_receipt_read_back(
  '18f5825a-0000-0000-0000-0000000000ff'::uuid, '18f5825a-0000-0000-0000-0000000000e1'::uuid,
  array['account.payment:alien']::text[], '2026-01-01 00:00:00', null, null, null) is null)::text$d$) as t(called text);
select is(
  (select sorted from dblink('rb', $q$select array_agg(r order by r) from unnest((select odoo_matched_payment_refs from sales_invoices where id = '18f5825a-0000-0000-0000-0000000000e1')) r$q$) as t(sorted text[])),
  array['account.payment:1','account.payment:2']::text[],
  '#1825 the merge is org-scoped: another org''s call writes nothing');

-- ── THE CONCURRENCY PROOF (review I2), on invoice e2 — TWO REAL SESSIONS. ───────────────────────────
-- The concurrent session opens a transaction and finalizes receipt :7, holding the invoice row lock.
select dblink_exec('rb', 'begin');
select ok(
  (select count(*)::int from dblink('rb',
     $q$select id::text from sales_invoices where id = '18f5825a-0000-0000-0000-0000000000e2' for update$q$)
     as t(id text)) = 1,
  '#1825 setup: the second session holds the invoice row''s FOR UPDATE lock (receipt :7 finalizing)');

-- ...and, in that same open transaction, finalizes receipt :7 — the reference is written but NOT yet
-- committed (exactly a receipt finalize in flight while another lands).
select called from dblink('rb', $s$select (public.record_sales_invoice_receipt_read_back(
  '18f5825a-0000-0000-0000-000000000001'::uuid, '18f5825a-0000-0000-0000-0000000000e2'::uuid,
  array['account.payment:7']::text[], null, null, null, null) is null)::text$s$) as t(called text);

-- (1) This session's finalize of receipt :42 WAITS on that exact row — it cannot compute its merge
-- from a stale read while :7 is in flight. Delete the row lock (an un-locked read-merge-write) and the
-- statement would sail through instead of timing out: that is the mutation this assertion catches.
set local lock_timeout = '1500ms';
select throws_ok(
  $$select public.record_sales_invoice_receipt_read_back(
       '18f5825a-0000-0000-0000-000000000001'::uuid, '18f5825a-0000-0000-0000-0000000000e2'::uuid,
       array['account.payment:42']::text[], null, null, null, null) $$,
  '55P03', 'canceling statement due to lock timeout',
  '#1825 (review I2)(1) the second receipt''s merge serializes on the invoice row — no stale-read window');
set local lock_timeout = 0;
select is(
  (select refs from dblink('rb2', $q$select odoo_matched_payment_refs::text from sales_invoices where id = '18f5825a-0000-0000-0000-0000000000e2'$q$) as t(refs text)),
  '{}', '#1825 (review I2)(1) the blocked finalize wrote nothing (it never got past the lock)');

-- (2) Receipt :7 commits; the delayed :42 finalize re-runs (committed context) and must keep BOTH
-- references. A blind `set refs = p_refs` (or a re-introduced read-merge-write) drops :7 and fails here.
select dblink_exec('rb', 'commit');
select called from dblink('rb', $r$select (public.record_sales_invoice_receipt_read_back(
  '18f5825a-0000-0000-0000-000000000001'::uuid, '18f5825a-0000-0000-0000-0000000000e2'::uuid,
  array['account.payment:42']::text[], null, null, null, null) is null)::text$r$) as t(called text);
select is(
  (select sorted from dblink('rb', $q$select array_agg(r order by r) from unnest((select odoo_matched_payment_refs from sales_invoices where id = '18f5825a-0000-0000-0000-0000000000e2')) r$q$) as t(sorted text[])),
  array['account.payment:42','account.payment:7']::text[],
  '#1825 (review I2)(2) two concurrent receipt finalizes on one invoice keep BOTH references — no lost update');

-- ── Cleanup: the second session drops its service-role context and removes the committed fixtures
-- (this session holds none of them). ────────────────────────────────────────────────────────────────
select dblink_exec('rb', 'reset role; reset request.jwt.claims;');
select dblink_exec('rb', $cl$
  delete from sales_invoices where org_id = '18f5825a-0000-0000-0000-000000000001';
  delete from companies      where org_id = '18f5825a-0000-0000-0000-000000000001';
  delete from organizations  where id     = '18f5825a-0000-0000-0000-000000000001';
$cl$);
select dblink_disconnect('rb');
select dblink_disconnect('rb2');

select * from finish();
rollback;
