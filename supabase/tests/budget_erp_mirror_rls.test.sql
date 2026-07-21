-- budget_erp_mirror_rls.test.sql (P3c slice 0) — the ADR-0059 §6 side mirror is MACHINE-ONLY.
-- The 0101 idiom (force RLS + SELECT-only policy): a user-JWT write is 42501; the service/owner writer
-- succeeds; org-isolated reads. Proves NFR-BUD-SEC-004 (machine-only side-mirror writes) at the schema
-- layer. Inline fixture idiom, modelled on erpnext_sales_invoices_flip_rls.test.sql. 0b3e UUIDs.
begin;
select plan(6);

-- Org A + Org B, an Admin in each, and a budget_version in Org A the mirror row references.
insert into organizations (id, name) values
  ('0b3e0000-0000-0000-0000-000000000001','AC-BUD mirror Org A'),
  ('0b3e0000-0000-0000-0000-000000000002','AC-BUD mirror Org B');
insert into auth.users (id, email) values
  ('0b3e0000-0000-0000-0000-0000000000a1','mirror-a@example.com'),
  ('0b3e0000-0000-0000-0000-0000000000b1','mirror-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('0b3e0000-0000-0000-0000-0000000000a1','0b3e0000-0000-0000-0000-000000000001','A Admin','mirror-a@example.com','Admin','active'),
  ('0b3e0000-0000-0000-0000-0000000000b1','0b3e0000-0000-0000-0000-000000000002','B Admin','mirror-b@example.com','Admin','active');
insert into projects (id, org_id, name, status) values
  ('0b3e0000-0000-0000-0000-0000000000c1','0b3e0000-0000-0000-0000-000000000001','Proj A','Ongoing Project');
insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('0b3e0000-0000-0000-0000-0000000000d1','0b3e0000-0000-0000-0000-000000000001',
   '0b3e0000-0000-0000-0000-0000000000c1',1,'v1','Active');

-- ── Structure: the (org, version, fy) upsert grain is unique ────────────────────────────────────
select has_table('public','budget_version_erp_mirror', 'the side mirror table exists');
select col_is_unique('public','budget_version_erp_mirror',
                     array['org_id','budget_version_id','fiscal_year'],
                     'unique(org, budget_version_id, fiscal_year) — one mirror row per version×FY');

-- ── Machine-only: a user-JWT INSERT is denied 42501 (no non-SELECT policy exists) ───────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"0b3e0000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$insert into public.budget_version_erp_mirror (org_id, budget_version_id, fiscal_year)
      values ('0b3e0000-0000-0000-0000-000000000001','0b3e0000-0000-0000-0000-0000000000d1','2026')$$,
  '42501', null, 'user-JWT INSERT into the side mirror denied 42501 (machine-only, NFR-BUD-SEC-004)');

-- ── The service/owner writer succeeds (the 0101 machine-mirror idiom: reset role → superuser) ───
reset role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$insert into public.budget_version_erp_mirror (org_id, budget_version_id, fiscal_year, push_state)
      values ('0b3e0000-0000-0000-0000-000000000001','0b3e0000-0000-0000-0000-0000000000d1','2026','pushed')$$,
  'service/owner INSERT of a mirror row succeeds');

-- ── Org isolation: org A member reads its row; org B member reads 0 ─────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"0b3e0000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from public.budget_version_erp_mirror), 1,
          'org-A member reads its own mirror row');
set local request.jwt.claims = '{"sub":"0b3e0000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from public.budget_version_erp_mirror), 0,
          'org-B member reads 0 rows of org-A mirror (org isolation)');

select finish();
rollback;
