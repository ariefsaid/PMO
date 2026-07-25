-- budget_category_account_map_rls.test.sql (P3c slice 0) — OWNS AC-BUD-010.
-- The crux map (FR-BUD-110..112): the shipped enum key, a BIJECTION (both uniques), ADMIN-only writes,
-- org isolation. Inline fixture idiom (set local role authenticated + jwt claims), modelled on
-- erpnext_sales_invoices_flip_rls.test.sql. Namespaced 0b3c UUIDs (valid hex, NOT seed-colliding).
-- begin/rollback + finish().
begin;
select plan(9);

-- Org A + Org B, an Admin and a Finance in A, an Admin in B.
insert into organizations (id, name) values
  ('0b3c0000-0000-0000-0000-000000000001','AC-BUD map Org A'),
  ('0b3c0000-0000-0000-0000-000000000002','AC-BUD map Org B');
insert into auth.users (id, email) values
  ('0b3c0000-0000-0000-0000-0000000000a1','map-admin-a@example.com'),
  ('0b3c0000-0000-0000-0000-0000000000a2','map-finance-a@example.com'),
  ('0b3c0000-0000-0000-0000-0000000000b1','map-admin-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('0b3c0000-0000-0000-0000-0000000000a1','0b3c0000-0000-0000-0000-000000000001','A Admin','map-admin-a@example.com','Admin','active'),
  ('0b3c0000-0000-0000-0000-0000000000a2','0b3c0000-0000-0000-0000-000000000001','A Finance','map-finance-a@example.com','Finance','active'),
  ('0b3c0000-0000-0000-0000-0000000000b1','0b3c0000-0000-0000-0000-000000000002','B Admin','map-admin-b@example.com','Admin','active');

-- ── Structure: the shipped enum key + the BIJECTION (both uniques are load-bearing, FR-BUD-111) ──
select has_table('public','budget_category_account_map', 'AC-BUD-010 the map table exists');
select col_type_is('public','budget_category_account_map','category','budget_category',
                   'AC-BUD-010 category is the shipped ENUM, not text (OD-BUDGET-4)');
select col_is_unique('public','budget_category_account_map', array['org_id','category'],
                     'AC-BUD-010 unique(org,category) — one account per category (the push)');
select col_is_unique('public','budget_category_account_map', array['org_id','erp_account'],
                     'AC-BUD-010 unique(org,erp_account) — one category per account (the projection inverse)');

-- ── Admin authors a map row in its own org ──────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"0b3c0000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$insert into public.budget_category_account_map (category, erp_account)
      values ('Labor','5100 - Direct Costs - PSC')$$,
  'AC-BUD-010 Admin may author a map row');

-- ⚑ Finance is DENIED — the map is Admin-only, deliberately STRICTER than OD-BUDGET-3 (FR-BUD-112)
set local request.jwt.claims = '{"sub":"0b3c0000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$insert into public.budget_category_account_map (category, erp_account)
      values ('Materials','5200 - Materials - PSC')$$,
  '42501', null, 'AC-BUD-010 Finance map write denied 42501 (Admin-only, FR-BUD-112)');

-- ── The bijection is enforced in BOTH directions ────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"0b3c0000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$insert into public.budget_category_account_map (category, erp_account)
      values ('Labor','5900 - Other - PSC')$$,
  '23505', null, 'AC-BUD-010 a second account for a mapped CATEGORY is rejected (the push)');
select throws_ok(
  $$insert into public.budget_category_account_map (category, erp_account)
      values ('Overheads','5100 - Direct Costs - PSC')$$,
  '23505', null, 'AC-BUD-010 a second category for a mapped ACCOUNT is rejected (the projection inverse)');

-- ── Org isolation: org B cannot read org A's map ────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"0b3c0000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from public.budget_category_account_map), 0,
          'AC-BUD-010 org B cannot read org A map rows');

select finish();
rollback;
