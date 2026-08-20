-- operator_create_org.test.sql — proof for 0192_operator_create_org.sql (#484, DD-ORG-1 / DD-RIS-2).
--
-- AC ids owned here (minted for #484; the namespace was free before this file):
--   AC-ORG-001  a non-Operator calling operator_create_org gets 42501.
--   AC-ORG-002  a DISABLED Operator gets 42501 too — the standing gate, not just the grant.
--   AC-ORG-003  an Operator gets an org.
--   AC-ORG-004  …with the default_currency the caller STATED, not the column's 'USD' default.
--   AC-ORG-005  …and its first Admin membership, IN THE NEW ORG (the DD-CUR-2 stamp-trigger guard:
--               `profiles_stamp_org_id` would put the Admin in the OPERATOR's org if 0074's narrow
--               predicate were ever widened, and nothing would raise — this assertion is what sees it).
--   AC-ORG-006  …with the Admin's email READ FROM auth.users, never client-supplied (0184's identity
--               key must not diverge from GoTrue on day one).
--   AC-ORG-007  no client INSERT grant on `organizations` exists — the RPC is the sole write path.
--   AC-ORG-008  a duplicate org name is refused (23505) — the operator-typo guard.
--   AC-ORG-009  an unknown admin user id is refused (23503).
--   AC-ORG-010  a missing default_currency is a hard error (P0001), never a silent 'USD'.
--   AC-ORG-011  a user who already has a profile cannot be the first Admin (23505) — DD-ORG-2 says
--               the answer to "wrong org" is offboard + reinvite, never a reassignment.
--   AC-ORG-012  atomicity: a call that fails mid-way leaves NO org row and NO profile row behind.
--   AC-ORG-013  the EXECUTE surface — `authenticated` holds it, `anon` does not (0185's default-
--               privilege revoke means the explicit grant is the only thing that makes it callable).
--   AC-L10N-004 (owned here, minted for #468; see docs/specs/i18n-framework.spec.md): a missing/
--               blank default_locale or default_timezone is a hard error (P0001), never a silent
--               'en'/'Asia/Jakarta'; an explicit number_locale of NULL is the legal derive choice;
--               a stated call persists the STATED locale defaults (DD-RIS-2).
--
-- ⚑ pgTAP runs as the superuser migration role, which BYPASSES both RLS and grants. The authz
-- assertions therefore run under `set local role authenticated` + a JWT claim, and the GRANT
-- assertions read the CATALOG via has_table_privilege / has_function_privilege — the same idiom as
-- 0142_revoke_client_truncate_refs_trigger.test.sql, and the reason a `reset role` insert here is a
-- fixture, not a bypass of the thing under test.
--
-- MUTATION-CHECKED: forcing the operator gate true (`if not public.is_operator()` → `if false`) turns
-- AC-ORG-001 red. Recorded in the PR/report; re-run it before trusting this file.
--
-- Reversibility (ADR-0006): no schema changes (fixtures inside begin/rollback); re-run is a no-op.
begin;
select plan(22);

-- ── Fixtures. All inserted BEFORE any request.jwt.claims is set, so auth_org_id() is null and
-- `profiles_stamp_org_id` is a no-op on them (it must not silently rewrite a fixture's org).
insert into organizations (id, name) values
  ('04840000-0000-0000-0000-000000000001','AC-ORG Home Org');
insert into auth.users (id, email) values
  ('04840000-0000-0000-0000-0000000000a1','ac-org-operator@example.com'),
  ('04840000-0000-0000-0000-0000000000a2','ac-org-member@example.com'),
  ('04840000-0000-0000-0000-0000000000a3','ac-org-disabled-op@example.com'),
  ('04840000-0000-0000-0000-0000000000b1','ac-org-new-admin@example.com'),
  ('04840000-0000-0000-0000-0000000000b2','ac-org-second-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('04840000-0000-0000-0000-0000000000a1','04840000-0000-0000-0000-000000000001','Op','ac-org-operator@example.com','Admin','active'),
  ('04840000-0000-0000-0000-0000000000a2','04840000-0000-0000-0000-000000000001','Member','ac-org-member@example.com','Admin','active'),
  ('04840000-0000-0000-0000-0000000000a3','04840000-0000-0000-0000-000000000001','Disabled Op','ac-org-disabled-op@example.com','Admin','disabled');
insert into platform_operators (user_id) values
  ('04840000-0000-0000-0000-0000000000a1'),
  ('04840000-0000-0000-0000-0000000000a3');
-- b1 and b2 exist in auth.users with NO profile — that is the state the first Admin must be in.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- AC-ORG-007 / AC-ORG-013 — the privilege surface (catalog reads; role-independent).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select ok(not has_table_privilege('authenticated','public.organizations','INSERT'),
  'AC-ORG-007 authenticated holds NO INSERT on organizations (the RPC is the sole write path)');
select ok(not has_table_privilege('anon','public.organizations','INSERT'),
  'AC-ORG-007 anon holds NO INSERT on organizations');
select ok(has_function_privilege('authenticated','public.operator_create_org(text,uuid,text,text,text,text,text)','EXECUTE'),
  'AC-ORG-013 authenticated may EXECUTE operator_create_org (explicit grant, 0087 shape)');
select ok(not has_function_privilege('anon','public.operator_create_org(text,uuid,text,text,text,text,text)','EXECUTE'),
  'AC-ORG-013 anon may NOT EXECUTE operator_create_org');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- AC-ORG-001 / AC-ORG-002 — the gate.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"04840000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$ select operator_create_org('AC-ORG New Org','04840000-0000-0000-0000-0000000000b1','New Admin','IDR','id',null,'Asia/Jakarta') $$,
  '42501', null,
  'AC-ORG-001 a non-Operator (active org Admin) calling operator_create_org gets 42501');

set local request.jwt.claims = '{"sub":"04840000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok(
  $$ select operator_create_org('AC-ORG New Org','04840000-0000-0000-0000-0000000000b1','New Admin','IDR','id',null,'Asia/Jakarta') $$,
  '42501', null,
  'AC-ORG-002 a DISABLED Operator gets 42501 (active-member standing is checked, not just the grant)');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- AC-ORG-003..006 — the happy path and every companion it must carry.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local request.jwt.claims = '{"sub":"04840000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select operator_create_org('AC-ORG New Org','04840000-0000-0000-0000-0000000000b1','New Admin','IDR','id',null,'Asia/Jakarta') $$,
  'AC-ORG-003 an Operator creates the org');

-- Assertions read as the migration role: `organizations_select` scopes an authenticated read to the
-- caller's OWN org, and the Operator's own org is the home org, not the one just created.
reset role;
select is((select count(*)::int from organizations where name = 'AC-ORG New Org'), 1,
  'AC-ORG-003 exactly one organizations row exists for the created org');
select is((select default_currency from organizations where name = 'AC-ORG New Org'), 'IDR',
  'AC-ORG-004 default_currency is the STATED currency, not the column default');
select is(
  (select p.org_id::text || '|' || p.role::text || '|' || p.status::text
     from profiles p where p.id = '04840000-0000-0000-0000-0000000000b1'),
  (select o.id::text from organizations o where o.name = 'AC-ORG New Org') || '|Admin|active',
  'AC-ORG-005 the first Admin membership lands in the NEW org, active (stamp-trigger guard)');
select is((select email from profiles where id = '04840000-0000-0000-0000-0000000000b1'),
  'ac-org-new-admin@example.com',
  'AC-ORG-006 the Admin profile email is read from auth.users, not supplied by the caller');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- AC-ORG-008..012 — the refusals, all as a live Operator so only the stated reason can be failing.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"04840000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ select operator_create_org('ac-org new org','04840000-0000-0000-0000-0000000000b2','Second Admin','IDR','id',null,'Asia/Jakarta') $$,
  '23505', null,
  'AC-ORG-008 a duplicate org name (case-insensitive) is refused');
select throws_ok(
  $$ select operator_create_org('AC-ORG Ghost Org','04840000-0000-0000-0000-0000000000ff','Ghost','IDR','id',null,'Asia/Jakarta') $$,
  '23503', null,
  'AC-ORG-009 an unknown admin user id is refused');
select throws_ok(
  $$ select operator_create_org('AC-ORG Currencyless','04840000-0000-0000-0000-0000000000b2','Second Admin',null,'id',null,'Asia/Jakarta') $$,
  'P0001', null,
  'AC-ORG-010 a missing default_currency is a hard error, never a silent USD');
select throws_ok(
  $$ select operator_create_org('AC-ORG Reassign','04840000-0000-0000-0000-0000000000a2','Existing Member','IDR','id',null,'Asia/Jakarta') $$,
  '23505', null,
  'AC-ORG-011 a user who already has a profile cannot be the first Admin (DD-ORG-2)');

-- Atomicity. A malformed currency passes this function's own null/blank check and fails the
-- organizations CHECK mid-statement; nothing may survive it. Both inserts share the caller's
-- transaction by construction (plpgsql), so the observable contract is "nothing half-lands".
select throws_ok(
  $$ select operator_create_org('AC-ORG Atomic','04840000-0000-0000-0000-0000000000b2','Second Admin','idr','id',null,'Asia/Jakarta') $$,
  '23514', null,
  'AC-ORG-012 a malformed currency aborts the create');
reset role;
select is(
  (select count(*)::int from organizations where name = 'AC-ORG Atomic')
  + (select count(*)::int from profiles where id = '04840000-0000-0000-0000-0000000000b2'),
  0,
  'AC-ORG-012 a failed create leaves NO org row and NO profile row behind');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- AC-L10N-004 (#468, FR-L10N-005) — the locale companions are REQUIRED, no defaults. Appended AFTER
-- AC-ORG-012 deliberately: this block's lives_ok creates b2's profile, and AC-ORG-011/012 both
-- require b2 to have none (012 asserts the absence on read-back), so it must run last.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"04840000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ select operator_create_org('AC-L10N Org','04840000-0000-0000-0000-0000000000b2','Second Admin','IDR',null,'id','Asia/Jakarta') $$,
  'P0001', null,
  'AC-L10N-004 a missing default_locale is a hard error, never a silent en');
select throws_ok(
  $$ select operator_create_org('AC-L10N Org','04840000-0000-0000-0000-0000000000b2','Second Admin','IDR','id',null,null) $$,
  'P0001', null,
  'AC-L10N-004 a missing default_timezone is a hard error, never a silent default');
select throws_ok(
  $$ select operator_create_org('AC-L10N Org','04840000-0000-0000-0000-0000000000b2','Second Admin','IDR','id','','Asia/Jakarta') $$,
  'P0001', null,
  'AC-L10N-004 a blank default_number_locale is refused (explicit NULL is the legal derive choice)');
select lives_ok(
  $$ select operator_create_org('AC-L10N Stated Org','04840000-0000-0000-0000-0000000000b2','L10N Admin','IDR','id',null,'Asia/Jakarta') $$,
  'AC-L10N-004 companion: an explicit number_locale of NULL is accepted (derive)');
reset role;
select is((select default_locale || '|' || coalesce(default_number_locale,'<null>') || '|' || default_timezone
             from organizations where name = 'AC-L10N Stated Org'), 'id|<null>|Asia/Jakarta',
  'AC-L10N-004 companion: the org carries the STATED locale defaults (DD-RIS-2: id / Indonesian / Asia/Jakarta)');

select finish();
rollback;
