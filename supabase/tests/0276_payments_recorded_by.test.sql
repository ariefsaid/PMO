-- 0276_payments_recorded_by.test.sql — #910 (DD-VPAY-9, FR-VPAY-009, AC-VPAY-007).
-- `payments.recorded_by_id`: a nullable uuid FK to profiles; a service-role (mirror-writer) insert
-- states it and a machine (null-caller) insert leaves it null; neither `authenticated` nor `anon`
-- can INSERT or UPDATE any `payments` column including it (the table's no-client-write-grant
-- posture, 0058/0075/0100 — the column-grant oracle style of 0266/AC-VWH-009), and SELECT is
-- readable exactly where the other columns are. Also proves the record_history_config
-- classification stays in step (the AC-CHG-011 catalog gate owns the general rule; this pins the
-- payment row).
-- Migration under test: 0276_payments_recorded_by.sql.
begin;
create extension if not exists pgtap;
select plan(14);

-- ── fixtures (owner role — the seed idiom of erpnext_money_flip_rls) ─────────────────────────────
insert into organizations (id, name) values
  ('02760000-0000-0000-0000-000000000001','AC-VPAY-007 payer-attribution org');
insert into auth.users (id, email) values
  ('02760000-0000-0000-0000-0000000000b1','vpay-finance@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02760000-0000-0000-0000-0000000000b1','02760000-0000-0000-0000-000000000001','F Finance','vpay-finance@example.com','Finance','active');
insert into companies (id, org_id, name, type) values
  ('02760000-0000-0000-0000-0000000000f1','02760000-0000-0000-0000-000000000001','VPAY Supplier','Vendor');
insert into procurements (id, org_id, title, status, vendor_id) values
  ('02760000-0000-0000-0000-0000000000c1','02760000-0000-0000-0000-000000000001','AC-VPAY-007 case','Vendor Invoiced','02760000-0000-0000-0000-0000000000f1');

-- ── §A shape: exists, nullable, FK to profiles ───────────────────────────────────────────────────
select is((select count(*)::int from information_schema.columns
            where table_schema = 'public' and table_name = 'payments' and column_name = 'recorded_by_id'),
  1, 'AC-VPAY-007 payments.recorded_by_id exists');
select is((select is_nullable::text from information_schema.columns
            where table_schema = 'public' and table_name = 'payments' and column_name = 'recorded_by_id'),
  'YES', 'AC-VPAY-007 recorded_by_id is nullable (machine writes stay null)');
select is((select count(*)::int from pg_constraint con
            join pg_class rel on rel.oid = con.conrelid
           where rel.relname = 'payments' and con.conname like '%recorded_by_id%_fkey'
             and confrelid = 'public.profiles'::regclass and contype = 'f'),
  1, 'AC-VPAY-007 recorded_by_id is an FK to profiles');

-- ── §B writer semantics: a stated payer stamps, a null-caller insert stays null (service role) ────
set local role service_role;
select lives_ok($$ insert into payments (id, org_id, procurement_id, pay_number, status, date, amount, recorded_by_id)
                   values ('02760000-0000-0000-0000-000000000a01','02760000-0000-0000-0000-000000000001',
                           '02760000-0000-0000-0000-0000000000c1','ACC-PAY-2026-00910','Paid','2026-10-08',1090000,
                           '02760000-0000-0000-0000-0000000000b1') $$,
  'AC-VPAY-007 a service-role mirror insert states recorded_by_id (the dispatch caller)');
select lives_ok($$ insert into payments (id, org_id, procurement_id, pay_number, status, date, amount)
                   values ('02760000-0000-0000-0000-000000000a02','02760000-0000-0000-0000-000000000001',
                           '02760000-0000-0000-0000-0000000000c1','ACC-PAY-2026-00911','Scheduled','2026-10-08',500) $$,
  'AC-VPAY-007 a machine (null-caller) insert leaves recorded_by_id null');
select is((select recorded_by_id from payments where id = '02760000-0000-0000-0000-000000000a01'),
  '02760000-0000-0000-0000-0000000000b1'::uuid, 'AC-VPAY-007 the stated payer is the finance user');
select is((select recorded_by_id from payments where id = '02760000-0000-0000-0000-000000000a02'),
  null, 'AC-VPAY-007 the machine insert is unattributed (sweep finalize/replay)');
reset role;

-- ── §C the no-client-write posture holds INCLUDING the new column (0266/AC-VWH-009 idiom) ────────
select ok(not has_column_privilege('authenticated','public.payments','recorded_by_id','INSERT')
          and not has_column_privilege('authenticated','public.payments','recorded_by_id','UPDATE'),
  'AC-VPAY-007 authenticated can neither INSERT nor UPDATE recorded_by_id');
select ok(not has_column_privilege('anon','public.payments','recorded_by_id','INSERT')
          and not has_column_privilege('anon','public.payments','recorded_by_id','UPDATE'),
  'AC-VPAY-007 anon can neither INSERT nor UPDATE recorded_by_id');
select ok(not has_table_privilege('authenticated','public.payments','INSERT')
          and not has_table_privilege('authenticated','public.payments','UPDATE'),
  'AC-VPAY-007 authenticated holds NO insert/update grant on payments at all (0100 posture intact)');
select is(has_column_privilege('authenticated','public.payments','recorded_by_id','SELECT'),
          has_column_privilege('authenticated','public.payments','amount','SELECT'),
  'AC-VPAY-007 recorded_by_id is readable exactly where amount is');
-- as an AUTHENTICATED member (the forged-payer probe): the grant posture is what refuses it.
set local role authenticated;
set local request.jwt.claims = '{"sub":"02760000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$ insert into payments (id, org_id, procurement_id, pay_number, status, recorded_by_id)
                    values ('02760000-0000-0000-0000-000000000e09','02760000-0000-0000-0000-000000000001',
                            '02760000-0000-0000-0000-0000000000c1','FORGED','Scheduled',
                            '02760000-0000-0000-0000-0000000000b1') $$, '42501',
  'permission denied for table payments',
  'AC-VPAY-007 an authenticated INSERT (a forged payer stamp) is refused by the grant posture');
reset role;

-- ── §D the record_history_config classification rides along (0260 catalog discipline) ────────────
select is((select captured ->> 'recorded_by_id' from public.record_history_config where entity_type = 'payment'),
  'ref', 'AC-VPAY-007 recorded_by_id is classified in record_history_config (captured ref)');

-- ── §E FK enforcement: a payer from another org''s profile is refused (attribution is resolvable) ─
select throws_ok($$ insert into payments (id, org_id, procurement_id, pay_number, status, recorded_by_id)
                    values ('02760000-0000-0000-0000-000000000a03','02760000-0000-0000-0000-000000000001',
                            '02760000-0000-0000-0000-0000000000c1','ACC-PAY-2026-00912','Scheduled',
                            'ffffffff-0000-0000-0000-000000000001') $$, '23503',
  null,
  'AC-VPAY-007 a recorded_by_id naming no profile is refused (FK)');

select * from finish();
rollback;
