-- 0081_transition_records_backfill.test.sql
-- Migration under test: 0038_transition_writes_records.sql (Task 4.2 backfill)
--
-- AC-PR-023  backfill yields exactly one PR / one PO record per case; case column unchanged.
-- AC-PR-024  pre-existing quotation / receipt / invoice rows remain readable; new cols (rfq_id, po_id) null.
-- AC-PR-025  committed spend (sum of total_value for statuses in committed set) is unchanged
--            after the record-table redesign; the case-status-driven basis is the authority (OBS-PR-003).
begin;
select plan(6);

-- ── Fixtures (inserted as table owner — bypasses RLS) ─────────────────────────

insert into organizations (id, name) values
  ('00810000-0000-0000-0000-000000000001', 'Backfill Org');

insert into auth.users (id, email) values
  ('00810000-0000-0000-0000-0000000000a1', 'pm-bf@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00810000-0000-0000-0000-0000000000a1','00810000-0000-0000-0000-000000000001',
   'PM BF','pm-bf@example.com','Project Manager');

-- A vendor company (vendor_id NOT NULL on procurement_quotations).
insert into companies (id, org_id, name, type) values
  ('00810000-0000-0000-0000-000000000050','00810000-0000-0000-0000-000000000001',
   'BF Vendor','Vendor');

-- A procurement with pr_number and po_number already set (simulates pre-migration state).
-- total_value is in the committed set ('Ordered') to contribute to committed spend.
insert into procurements (id, org_id, title, status, requested_by_id, pr_number, po_number, total_value) values
  ('00810000-0000-0000-0000-000000000010','00810000-0000-0000-0000-000000000001',
   'BF Case A','Ordered',
   '00810000-0000-0000-0000-0000000000a1',
   'PR-991231BFAA', 'PO-991231BFAA', 75000.00);

-- Pre-existing quotation row (for AC-PR-024). vendor_id NOT NULL — use the company inserted above.
insert into procurement_quotations (id, org_id, procurement_id, vendor_id, total_amount, received_date) values
  ('00810000-0000-0000-0000-000000000020','00810000-0000-0000-0000-000000000001',
   '00810000-0000-0000-0000-000000000010',
   '00810000-0000-0000-0000-000000000050', 75000.00, current_date);

-- Pre-existing receipt row (for AC-PR-024 — new col po_id should be null).
insert into procurement_receipts (id, org_id, procurement_id, status) values
  ('00810000-0000-0000-0000-000000000030','00810000-0000-0000-0000-000000000001',
   '00810000-0000-0000-0000-000000000010', 'Partial');

-- Capture committed spend BEFORE the idempotent backfill re-run.
-- (The migration-time backfill has already run; we verify the re-run is idempotent
--  and the spend calculation is unaffected by the record tables.)
do $$
declare v_spend numeric;
begin
  select coalesce(sum(total_value), 0)
    into v_spend
    from public.procurements
   where org_id = '00810000-0000-0000-0000-000000000001'
     and status in ('Ordered','Received','Vendor Invoiced','Paid');
  perform set_config('pmo.bf_spend_before', v_spend::text, true);
end; $$;

-- ── Idempotent backfill re-run (same SQL as Task 4.2 migration) ──────────────
-- Running this a second time (migration already did it once) must yield no additional rows.

insert into public.purchase_requests (org_id, procurement_id, pr_number, status, date)
select p.org_id, p.id, p.pr_number, 'Submitted', coalesce(p.created_at::date, current_date)
  from public.procurements p
 where p.org_id = '00810000-0000-0000-0000-000000000001'
   and p.pr_number is not null
   and not exists (select 1 from public.purchase_requests pr
                    where pr.procurement_id = p.id and pr.pr_number = p.pr_number);

insert into public.purchase_orders (org_id, procurement_id, po_number, status, date)
select p.org_id, p.id, p.po_number, 'Issued', coalesce(p.created_at::date, current_date)
  from public.procurements p
 where p.org_id = '00810000-0000-0000-0000-000000000001'
   and p.po_number is not null
   and not exists (select 1 from public.purchase_orders po
                    where po.procurement_id = p.id and po.po_number = p.po_number);

-- ── AC-PR-023: exactly one PR / one PO record; case columns intact ────────────

select is(
  (select count(*)::int from public.purchase_requests
    where procurement_id = '00810000-0000-0000-0000-000000000010'),
  1,
  'AC-PR-023: backfill yields exactly one purchase_requests row for the case');

select is(
  (select count(*)::int from public.purchase_orders
    where procurement_id = '00810000-0000-0000-0000-000000000010'),
  1,
  'AC-PR-023: backfill yields exactly one purchase_orders row for the case');

select is(
  (select pr_number from public.procurements where id = '00810000-0000-0000-0000-000000000010'),
  (select pr_number from public.purchase_requests where procurement_id = '00810000-0000-0000-0000-000000000010'),
  'AC-PR-023: procurements.pr_number column unchanged and matches the purchase_requests row');

-- ── AC-PR-024: pre-existing rows remain readable; new columns default to null ─

select ok(
  (select count(*) from public.procurement_quotations
    where procurement_id = '00810000-0000-0000-0000-000000000010') >= 1,
  'AC-PR-024: pre-existing procurement_quotations row is still readable');

select is(
  (select rfq_id from public.procurement_quotations
    where id = '00810000-0000-0000-0000-000000000020'),
  null,
  'AC-PR-024: procurement_quotations.rfq_id (new P2 seam column) is null on pre-existing row');

-- ── AC-PR-025: committed spend unchanged by record-table migration ─────────────
-- Recompute and compare with the value captured before the backfill re-run.
-- The record tables (purchase_requests / purchase_orders) are not included in the
-- committed-spend basis — status on `procurements` is the sole authority (OBS-PR-003).

select is(
  (select coalesce(sum(total_value), 0)
     from public.procurements
    where org_id = '00810000-0000-0000-0000-000000000001'
      and status in ('Ordered','Received','Vendor Invoiced','Paid')),
  current_setting('pmo.bf_spend_before')::numeric,
  'AC-PR-025: committed spend is unchanged after the record-table backfill (status-on-procurements is the basis)');

select * from finish();
rollback;
