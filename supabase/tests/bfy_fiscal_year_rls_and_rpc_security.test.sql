-- bfy_fiscal_year_rls_and_rpc_security.test.sql (BFY T11) — OWNS AC-BFY-017
-- (FR-BFY-001, FR-BFY-090; NFR-BFY-SEC-001). Review finding 10.
--
-- ⚑ WHY THIS FILE EXISTS. 0153 DROPS AND RE-CREATES four functions. A re-create is the one moment a
-- function's SECURITY MODE, its `search_path` pin and its ACL can silently change — and nothing else
-- in the suite would notice. Recreate `list_budget_fiscal_years` or `get_budget_push_status` as
-- SECURITY DEFINER (they have no hand-rolled org filter, by design — RLS is the boundary) and an
-- authenticated member of org A calling them with org B's project UUID gets B's phased year labels,
-- ERP `Budget` document name, push errors and per-year enforcement state. That is a tenancy breach
-- reachable directly over PostgREST, with no code change anywhere else.
--
-- So the security mode of every re-created function is ACCEPTANCE-BOUND here, in four dimensions:
--   • `prosecdef`  — INVOKER for the three read RPCs, DEFINER for the two lifecycle writes
--   • `proconfig`  — `search_path` pinned (a definer function without one is injectable)
--   • the ACL      — `authenticated` may execute; `anon` may not; PUBLIC holds nothing
--   • behaviour    — a real cross-org call returns nothing, and a cross-org WRITE of the new column
--                    is refused (the column inherits budget_line_items' shipped policies)
--
-- Mutations: recreate any read RPC `security definer` → its `prosecdef` assertion red; drop the
-- `set search_path` → its `proconfig` assertion red; `grant execute … to anon` → the anon assertion
-- red; strip clone/activate's internal org+role re-assertion → the cross-org clone assertion red.
begin;
select plan(26);

-- ── Fixtures: two orgs, each with a phased line item ─────────────────────────────────────────────
insert into organizations (id, name) values
  ('0bff0000-0000-0000-0000-000000000001','BFY security Org A'),
  ('0bff0000-0000-0000-0000-000000000002','BFY security Org B');
insert into auth.users (id, email) values
  ('0bff0000-0000-0000-0000-0000000000a1','bfy-sec-pm-a@example.com'),
  ('0bff0000-0000-0000-0000-0000000000b1','bfy-sec-pm-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('0bff0000-0000-0000-0000-0000000000a1','0bff0000-0000-0000-0000-000000000001','A PM','bfy-sec-pm-a@example.com','Project Manager','active'),
  ('0bff0000-0000-0000-0000-0000000000b1','0bff0000-0000-0000-0000-000000000002','B PM','bfy-sec-pm-b@example.com','Project Manager','active');

insert into projects (id, org_id, name, status, start_date, end_date) values
  ('0bff1111-0000-0000-0000-000000000001','0bff0000-0000-0000-0000-000000000001','Org A Project','Ongoing Project',date '2025-08-01',date '2027-03-31'),
  ('0bff1111-0000-0000-0000-000000000002','0bff0000-0000-0000-0000-000000000002','Org B Project','Ongoing Project',date '2025-08-01',date '2027-03-31');

insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('0bff2222-0000-0000-0000-000000000001','0bff0000-0000-0000-0000-000000000001','0bff1111-0000-0000-0000-000000000001',1,'A v1','Draft'),
  ('0bff2222-0000-0000-0000-000000000002','0bff0000-0000-0000-0000-000000000002','0bff1111-0000-0000-0000-000000000002',1,'B v1','Draft');
insert into budget_line_items (id, org_id, budget_version_id, category, description, budgeted_amount, actual_amount, fiscal_year) values
  ('0bff3333-0000-0000-0000-000000000001','0bff0000-0000-0000-0000-000000000001','0bff2222-0000-0000-0000-000000000001','Labor','A crew',90000.00,0,'2026'),
  ('0bff3333-0000-0000-0000-000000000002','0bff0000-0000-0000-0000-000000000002','0bff2222-0000-0000-0000-000000000002','Labor','B crew',77000.00,0,'2026-B-SECRET');
-- Org B's version is Active + pushed, so it has the richest possible state to leak.
update budget_versions set status='Active', activated_at=now() where id='0bff2222-0000-0000-0000-000000000002';
insert into budget_version_erp_mirror (org_id, budget_version_id, fiscal_year, push_state, erp_budget_name) values
  ('0bff0000-0000-0000-0000-000000000002','0bff2222-0000-0000-0000-000000000002','2026-B-SECRET','pushed','BUDGET-B-SECRET-0001');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- STRUCTURE — the security mode of every function 0153 re-creates.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- The three READ RPCs: SECURITY INVOKER, so org isolation comes from the underlying tables' RLS and
-- there is no hand-rolled org filter to forget.
select is((select p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.proname='get_budget_projection'), false,
  'AC-BFY-017 get_budget_projection is SECURITY INVOKER after the re-create');
select is((select p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.proname='list_budget_fiscal_years'), false,
  'AC-BFY-017 list_budget_fiscal_years is SECURITY INVOKER after the re-create');
select is((select p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.proname='get_budget_push_status'), false,
  'AC-BFY-017 get_budget_push_status is SECURITY INVOKER after the re-create');
select is((select p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.proname='budget_fiscal_year_token'), false,
  'AC-BFY-017 budget_fiscal_year_token is SECURITY INVOKER (a pure string helper needs no elevation)');

-- `search_path` pinned on all four, so no caller can shadow `public` objects via pg_temp.
select ok((select 'search_path=public, pg_temp' = any(p.proconfig) from pg_proc p
            join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname='get_budget_projection'),
  'AC-BFY-017 get_budget_projection pins search_path = public, pg_temp');
select ok((select 'search_path=public, pg_temp' = any(p.proconfig) from pg_proc p
            join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname='list_budget_fiscal_years'),
  'AC-BFY-017 list_budget_fiscal_years pins search_path = public, pg_temp');
select ok((select 'search_path=public, pg_temp' = any(p.proconfig) from pg_proc p
            join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname='get_budget_push_status'),
  'AC-BFY-017 get_budget_push_status pins search_path = public, pg_temp');
select ok((select 'search_path=public, pg_temp' = any(p.proconfig) from pg_proc p
            join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname='budget_fiscal_year_token'),
  'AC-BFY-017 budget_fiscal_year_token pins search_path = public, pg_temp');

-- ACL: authenticated executes; anon does not; PUBLIC holds nothing (grantee 0 is PUBLIC).
select ok(has_function_privilege('authenticated','public.get_budget_projection(uuid,text)','execute'),
  'AC-BFY-017 authenticated may execute get_budget_projection');
select ok(not has_function_privilege('anon','public.get_budget_projection(uuid,text)','execute'),
  'AC-BFY-017 anon may NOT execute get_budget_projection');
select ok(has_function_privilege('authenticated','public.list_budget_fiscal_years(uuid)','execute'),
  'AC-BFY-017 authenticated may execute list_budget_fiscal_years');
select ok(not has_function_privilege('anon','public.list_budget_fiscal_years(uuid)','execute'),
  'AC-BFY-017 anon may NOT execute list_budget_fiscal_years');
select ok(has_function_privilege('authenticated','public.get_budget_push_status(uuid)','execute'),
  'AC-BFY-017 authenticated may execute get_budget_push_status');
select ok(not has_function_privilege('anon','public.get_budget_push_status(uuid)','execute'),
  'AC-BFY-017 anon may NOT execute get_budget_push_status');
select ok(not has_function_privilege('anon','public.budget_fiscal_year_token(text)','execute'),
  'AC-BFY-017 anon may NOT execute budget_fiscal_year_token');
select is(
  (select count(*)::int from pg_proc p, aclexplode(p.proacl) a
    where p.oid in ('public.get_budget_projection(uuid,text)'::regprocedure,
                    'public.list_budget_fiscal_years(uuid)'::regprocedure,
                    'public.get_budget_push_status(uuid)'::regprocedure,
                    'public.budget_fiscal_year_token(text)'::regprocedure,
                    'public.clone_budget_version(uuid)'::regprocedure)
      and a.grantee = 0),
  0,
  'AC-BFY-017 PUBLIC holds NO privilege on any re-created function (revoke all from public survived)');

-- The two LIFECYCLE WRITES keep their definer rights — and therefore keep the internal authz that
-- makes definer rights safe (0005; asserted behaviourally below).
select is((select p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.proname='clone_budget_version'), true,
  'AC-BFY-017 clone_budget_version is still SECURITY DEFINER after the re-create (0005''s contract)');
select is((select p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.proname='activate_budget_version'), true,
  'AC-BFY-017 activate_budget_version is still SECURITY DEFINER (0153 does not touch it)');
select ok((select 'search_path=public' = any(p.proconfig) from pg_proc p
            join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname='clone_budget_version'),
  'AC-BFY-017 clone_budget_version still pins search_path (a definer function without one is injectable)');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- BEHAVIOUR — a real cross-org caller, not just catalogue metadata.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"0bff0000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is((select count(*)::int from public.get_budget_projection('0bff1111-0000-0000-0000-000000000002','2026-B-SECRET')), 0,
  'AC-BFY-017 org A''s member projects NOTHING for org B''s project (RLS, not a hand-rolled filter)');
select is((select count(*)::int from public.list_budget_fiscal_years('0bff1111-0000-0000-0000-000000000002')), 0,
  'AC-BFY-017 …and learns none of org B''s fiscal-year LABELS — a phased year name is client data');
select is((select erp_budget_name from public.get_budget_push_status('0bff1111-0000-0000-0000-000000000002')), null,
  'AC-BFY-017 …and no ERP Budget document name leaks through the per-year status');
select is((select push_state from public.get_budget_push_status('0bff1111-0000-0000-0000-000000000002')), null,
  'AC-BFY-017 …and no per-year enforcement state either');

-- The COLUMN itself inherits budget_line_items' shipped policies: a cross-org read sees no row, and a
-- cross-org write of `fiscal_year` changes nothing (0 rows matched — RLS, silently, as it should).
select is((select count(*)::int from public.budget_line_items li where li.id = '0bff3333-0000-0000-0000-000000000002'), 0,
  'AC-BFY-017 org A cannot READ org B''s line item, so it cannot read its fiscal_year');
update public.budget_line_items set fiscal_year = 'HIJACKED' where id = '0bff3333-0000-0000-0000-000000000002';
set local role postgres;
select is((select fiscal_year from public.budget_line_items where id = '0bff3333-0000-0000-0000-000000000002'), '2026-B-SECRET',
  'AC-BFY-017 a cross-org WRITE of fiscal_year changes nothing — the new column is covered by budget_line_items_write');

-- And the definer clone still refuses to cross orgs (the re-create kept 0005's internal re-assertion,
-- which is the ONLY thing standing between definer rights and a cross-org write).
set local role authenticated;
set local request.jwt.claims = '{"sub":"0bff0000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$select public.clone_budget_version('0bff2222-0000-0000-0000-000000000002')$$,
  '42501',
  'not authorized',
  'AC-BFY-017 the re-created clone still refuses a CROSS-ORG clone — definer rights bypass RLS, so its internal authz is load-bearing');

select finish();
rollback;
