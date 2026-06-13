-- 0071_procurement_files_storage_rls.test.sql — storage.objects RLS for the procurement-files bucket.
-- Path shape: {org}/{proc}/{phase}/{file_id}/{filename} = 5 slash-separated segments.
--   AC-PF-006  in-org PM can write an object at the 5-seg procurement path; cross-org path → 42501
--   AC-PF-007  anon cannot read procurement-files objects (0 rows); in-org PM reads the seeded object (1)
begin;
select plan(4);

-- Fixtures (two orgs).
insert into organizations (id, name) values
  ('00710000-0000-0000-0000-000000000001','Proc-Stor Org A'),
  ('00710000-0000-0000-0000-000000000002','Proc-Stor Org B');

insert into auth.users (id, email) values
  ('00710000-0000-0000-0000-0000000000a1','ps-pm-a@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00710000-0000-0000-0000-0000000000a1','00710000-0000-0000-0000-000000000001','PS PM A','ps-pm-a@example.com','Project Manager');

-- Org-A procurement (the in-org parent referenced by path segment 2).
insert into procurements (id, org_id, title, status) values
  ('00710000-0000-0000-0000-000000000010','00710000-0000-0000-0000-000000000001','PS Proc A','Vendor Quoted');

-- Seed one object on the org-A procurement path (as table owner, bypassing RLS).
insert into storage.objects (id, bucket_id, name, owner)
  values (gen_random_uuid(), 'procurement-files',
    '00710000-0000-0000-0000-000000000001/00710000-0000-0000-0000-000000000010/quotation/00710000-0000-0000-0000-000000000099/seed.pdf',
    '00710000-0000-0000-0000-0000000000a1');

-- ── AC-PF-006: in-org PM can write at the 5-seg procurement path ─────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00710000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ insert into storage.objects (id, bucket_id, name, owner)
       values (gen_random_uuid(), 'procurement-files',
         '00710000-0000-0000-0000-000000000001/00710000-0000-0000-0000-000000000010/receipt/00710000-0000-0000-0000-0000000000aa/gr.pdf',
         '00710000-0000-0000-0000-0000000000a1') $$,
  'AC-PF-006: in-org PM can write a procurement-files object at the 5-seg path');

-- ── AC-PF-006: cross-org path (org-B segment 1) by PM-A → 42501 ──────────────
select throws_ok(
  $$ insert into storage.objects (id, bucket_id, name, owner)
       values (gen_random_uuid(), 'procurement-files',
         '00710000-0000-0000-0000-000000000002/00710000-0000-0000-0000-000000000010/quotation/00710000-0000-0000-0000-0000000000bb/x.pdf',
         '00710000-0000-0000-0000-0000000000a1') $$,
  '42501', null,
  'AC-PF-006: PM writing to a cross-org procurement-files path denied (42501)');

-- ── AC-PF-007: in-org PM reads the seeded object (1 row) ─────────────────────
select results_eq(
  $$ select count(*)::int from storage.objects where bucket_id = 'procurement-files' and name like '00710000-0000-0000-0000-000000000001/%' $$,
  $$ values (2) $$,
  'AC-PF-007: in-org PM reads the org-A procurement-files objects (seed + write = 2)');

reset role;

-- ── AC-PF-007: anon cannot read procurement-files objects ────────────────────
set local request.jwt.claims = '{}';
set local role anon;
select results_eq(
  $$ select count(*)::int from storage.objects where bucket_id = 'procurement-files' $$,
  $$ values (0) $$,
  'AC-PF-007: anon cannot read procurement-files storage objects (0 rows)');

select finish();
rollback;
