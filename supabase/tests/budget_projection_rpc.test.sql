-- budget_projection_rpc.test.sql (P3c slice 6) — OWNS AC-BUD-053.
-- get_budget_projection(project_id, fiscal_year): PMO's FORWARD VIEW (FR-BUD-151/153), org-scoped under
-- the CALLER'S RLS (SECURITY INVOKER), at PMO grain (category), derived on read, never stored. The RPC's
-- SQL `numeric` arithmetic must match the unit oracle (src/lib/budget/budgetProjection.ts) exactly —
-- AC-BUD-050/051 and this file assert the SAME numbers. Inline fixture idiom (set local role +
-- request.jwt.claims), modelled on budget_version_activated_at.test.sql / budget_category_account_map_rls
-- .test.sql. Namespaced 0b3e UUIDs (valid hex, not seed-colliding).
begin;
select plan(6);

-- ── Fixtures (inserted as table owner, bypassing RLS) ────────────────────────────────────────────
insert into organizations (id, name) values
  ('0b3e0000-0000-0000-0000-000000000001','AC-BUD projection Org A'),
  ('0b3e0000-0000-0000-0000-000000000002','AC-BUD projection Org B');

insert into auth.users (id, email) values
  ('0b3e0000-0000-0000-0000-0000000000a1','proj-admin-a@example.com'),
  ('0b3e0000-0000-0000-0000-0000000000a2','proj-finance-a@example.com'),
  ('0b3e0000-0000-0000-0000-0000000000b1','proj-finance-b@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('0b3e0000-0000-0000-0000-0000000000a1','0b3e0000-0000-0000-0000-000000000001','A Admin','proj-admin-a@example.com','Admin','active'),
  ('0b3e0000-0000-0000-0000-0000000000a2','0b3e0000-0000-0000-0000-000000000001','A Finance','proj-finance-a@example.com','Finance','active'),
  ('0b3e0000-0000-0000-0000-0000000000b1','0b3e0000-0000-0000-0000-000000000002','B Finance','proj-finance-b@example.com','Finance','active');

insert into projects (id, org_id, name, status) values
  ('0b3e1111-0000-0000-0000-000000000001','0b3e0000-0000-0000-0000-000000000001','AC-BUD Projection Project','Ongoing Project');

-- An Active budget_version for project A with a 'Labor' line of 100000.00 (PMO SoT, OD-BUDGET-1).
-- Line items may only be authored while Draft (the shipped guard) — insert as Draft, THEN flip Active.
insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('0b3e2222-0000-0000-0000-000000000001','0b3e0000-0000-0000-0000-000000000001','0b3e1111-0000-0000-0000-000000000001',1,'Active Budget','Draft');
insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, actual_amount) values
  ('0b3e0000-0000-0000-0000-000000000001','0b3e2222-0000-0000-0000-000000000001','Labor','Team costs',100000.00,0);
update budget_versions set status = 'Active' where id = '0b3e2222-0000-0000-0000-000000000001';

-- ERP GL actuals on the MAPPED account (P2's shipped ledger-sourced snapshot — machine-written).
-- Both rows inserted here, as table owner: erp_actuals_snapshot has NO insert policy for `authenticated`
-- (machine-only, 0101) — a user-JWT insert of it would itself be a modelling error.
insert into erp_actuals_snapshot (org_id, project_id, account, fiscal_year, debit, credit, net, snapshot_id) values
  ('0b3e0000-0000-0000-0000-000000000001','0b3e1111-0000-0000-0000-000000000001','5100 - Direct Costs - PSC','2026',40000.00,0,40000.00,gen_random_uuid()),
  ('0b3e0000-0000-0000-0000-000000000001','0b3e1111-0000-0000-0000-000000000001','5200 - Materials - PSC','2026',500.00,0,500.00,gen_random_uuid());

-- ── Structure: the read RPC exists and is SECURITY INVOKER (RLS is the org filter, not a hand-rolled where) ──
select has_function('public','get_budget_projection', array['uuid','text'], 'AC-BUD-053 the read RPC exists');
select is(p.prosecdef, false, 'AC-BUD-053 SECURITY INVOKER (org isolation comes from the underlying tables'' RLS)')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='get_budget_projection';

-- ── Admin maps Labor → the account the actuals snapshot uses ────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"0b3e0000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into public.budget_category_account_map (category, erp_account) values ('Labor','5100 - Direct Costs - PSC');

-- ── Finance (OD-BUDGET-3) authors a PMO ETC ──────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"0b3e0000-0000-0000-0000-0000000000a2","role":"authenticated"}';
insert into public.budget_projections (project_id, fiscal_year, category, pmo_etc)
  values ('0b3e1111-0000-0000-0000-000000000001','2026','Labor',35000.00);

-- ── The RPC derives EAC/variance matching the unit oracle, at PMO category grain ─────────────────
select results_eq(
  $$select category::text, pmo_budget_amount, actuals_to_date, pmo_etc, projected_final_cost, projected_variance
      from public.get_budget_projection('0b3e1111-0000-0000-0000-000000000001','2026')$$,
  $$values ('Labor'::text, 100000.00::numeric, 40000.00::numeric, 35000.00::numeric, 75000.00::numeric, 25000.00::numeric)$$,
  'AC-BUD-053 the RPC derives EAC/variance matching the unit oracle, at PMO category grain');

select is(
  (select projected_utilization from public.get_budget_projection('0b3e1111-0000-0000-0000-000000000001','2026')
    where category = 'Labor'),
  0.75::numeric,
  'AC-BUD-053 utilization = EAC / pmo_budget_amount (matches AC-BUD-050''s oracle)');

-- ── A category with no ETC and no budget line still surfaces its actuals, never silently dropped ──
set local request.jwt.claims = '{"sub":"0b3e0000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into public.budget_category_account_map (category, erp_account) values ('Materials','5200 - Materials - PSC');
set local request.jwt.claims = '{"sub":"0b3e0000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select results_eq(
  $$select category::text, pmo_budget_amount, actuals_to_date
      from public.get_budget_projection('0b3e1111-0000-0000-0000-000000000001','2026') where category = 'Materials'$$,
  $$values ('Materials'::text, null::numeric, 500.00::numeric)$$,
  'AC-BUD-053 a category with actuals but no PMO budget line still surfaces (never inner-joined away)');

-- ── Cross-org: org B''s Finance reads zero rows (RLS, not a hand-rolled org filter) ────────────────
set local request.jwt.claims = '{"sub":"0b3e0000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from public.get_budget_projection('0b3e1111-0000-0000-0000-000000000001','2026')), 0,
          'AC-BUD-053 cross-org read returns zero rows (RLS)');

select finish();
rollback;
