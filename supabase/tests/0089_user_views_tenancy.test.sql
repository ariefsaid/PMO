-- 0089_user_views_tenancy.test.sql — user_views org isolation + scope-share (Issue I1, ADR-0036 §6).
-- Proves the cross-org wall and the shared_org visibility on user_views (migration 0045, hardened 0053):
--   AC-UV-003  a shared_org view is visible to a same-org member, but NOT to a member of another org.
--   AC-UV-002  a cross-org SELECT returns ZERO rows regardless of scope — org_id is the wall (even a
--              shared_org row in org A is invisible to org B).
--   AC-UV-004  (SEC-HIGH-1, migration 0053) the owner branch is ALSO org-gated: a user's OWN private
--              row that lives in ANOTHER org is invisible to them — the org_id predicate wraps the whole
--              policy (`org_id = auth_org_id() and (user_id = auth.uid() or scope = 'shared_org')`), it
--              is NOT an owner OR-branch that bypasses the org wall. Regression: the owner's own in-org
--              private + shared views still resolve, and a same-org non-owner still cannot read a
--              private row.
-- RLS is the enforcement authority (NFR-UV-SEC-001). Fixtures inserted as the table owner (bypassing
-- RLS). Org A = default org '00000000-…-0001'; Org B = '00890000-…-0002'. Fixture namespace: 00890000-….
begin;
select plan(9);

-- ── Fixtures (inserted as table owner, bypassing RLS) ───────────────────────
insert into organizations (id, name) values
  ('00890000-0000-0000-0000-000000000002','User Views Tenancy Org B');

insert into auth.users (id, email) values
  ('00890000-0000-0000-0000-0000000000a1','uv-ann@example.com'),
  ('00890000-0000-0000-0000-0000000000a2','uv-bob@example.com'),
  ('00890000-0000-0000-0000-0000000000b1','uv-carol@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00890000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001','UV Ann','uv-ann@example.com','Engineer'),
  ('00890000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000001','UV Bob','uv-bob@example.com','Engineer'),
  ('00890000-0000-0000-0000-0000000000b1','00890000-0000-0000-0000-000000000002','UV Carol','uv-carol@example.com','Engineer');

-- Ann (org A) owns a shared_org "Team Board" + a private "Ann Private".
insert into user_views (id, org_id, user_id, name, scope, spec) values
  ('00890000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','00890000-0000-0000-0000-0000000000a1','Team Board','shared_org','{}'::jsonb),
  ('00890000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','00890000-0000-0000-0000-0000000000a1','Ann Private','private','{}'::jsonb);

-- SEC-HIGH-1 fixture: a row OWNED BY Ann but living in ORG B (the org-move / mis-stamped-row case that
-- the pre-0053 owner OR-branch would leak to Ann regardless of her JWT org). Ann's JWT org is Org A, so
-- after 0053 this must be INVISIBLE to Ann (org_id != auth_org_id()). Inserted as table owner (RLS off).
insert into user_views (id, org_id, user_id, name, scope, spec) values
  ('00890000-0000-0000-0000-000000000012','00890000-0000-0000-0000-000000000002','00890000-0000-0000-0000-0000000000a1','Ann OrgB Private','private','{}'::jsonb),
  ('00890000-0000-0000-0000-000000000013','00890000-0000-0000-0000-000000000002','00890000-0000-0000-0000-0000000000a1','Ann OrgB Shared','shared_org','{}'::jsonb);

-- ════════════════════════════════════════════════════════════════════════════
-- AC-UV-003: shared_org view is visible to a same-org member, not to another org.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00890000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- Bob (same org A, NOT the owner) sees Ann's shared_org view.
select is(
  (select count(*)::int from user_views where name = 'Team Board'), 1,
  'AC-UV-003: shared_org view is visible to a same-org member');

reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00890000-0000-0000-0000-0000000000b1","role":"authenticated"}';

-- Carol (org B) does NOT see Ann's shared_org view (cross-org wall).
select is(
  (select count(*)::int from user_views where name = 'Team Board'), 0,
  'AC-UV-003: shared_org view is NOT visible to another org');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-UV-002: cross-org SELECT returns zero regardless of scope — org_id is the wall.
-- ════════════════════════════════════════════════════════════════════════════
-- Still Carol (org B): no org-A row of ANY scope is visible (shared_org "Team Board" + private "Ann Private").
select is(
  (select count(*)::int from user_views where org_id = '00000000-0000-0000-0000-000000000001'), 0,
  'AC-UV-002: cross-org SELECT returns zero regardless of scope — org_id is the wall');
-- No ORG-A row leaks across the wall to Carol (org B). She may legitimately see a shared_org row that
-- lives in her OWN org B — the leak oracle is specifically "any org-A row", not "any row at all".
select is(
  (select count(*)::int from user_views
     where org_id <> '00890000-0000-0000-0000-000000000002'), 0,
  'AC-UV-002: an org-B member sees none of org A''s views (no scope leaks across the org wall)');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AC-UV-004 (SEC-HIGH-1): the owner branch is org-gated — a user's OWN row in ANOTHER org is invisible.
-- Ann's JWT org is Org A. Her private + shared rows that live in Org B must NOT be returned; her Org-A
-- own rows (private + shared) MUST still be visible (no regression). A same-org non-owner still cannot
-- read her Org-A private row.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00890000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- Ann's OWN private row in Org B is invisible (org wall wraps the owner branch — the pre-0053 leak).
select is(
  (select count(*)::int from user_views where name = 'Ann OrgB Private'), 0,
  'AC-UV-004: a user''s OWN private row in ANOTHER org is invisible (owner branch is org-gated)');

-- Ann's OWN shared_org row in Org B is invisible too (org wall applies to every scope).
select is(
  (select count(*)::int from user_views where name = 'Ann OrgB Shared'), 0,
  'AC-UV-004: a user''s OWN shared row in ANOTHER org is invisible (org wall applies to every scope)');

-- Regression: Ann's own IN-ORG private row still resolves.
select is(
  (select count(*)::int from user_views where name = 'Ann Private'), 1,
  'AC-UV-004: the owner''s own in-org private view still resolves (no regression)');

-- Regression: Ann's own IN-ORG shared row still resolves; total visible to Ann = 2 (her Org-A rows only).
select is(
  (select count(*)::int from user_views), 2,
  'AC-UV-004: the owner sees exactly her two in-org rows — no cross-org own-row leak');

reset role;

-- Regression: a same-org non-owner (Bob) still cannot read Ann's Org-A PRIVATE row (owner asymmetry intact).
set local role authenticated;
set local request.jwt.claims = '{"sub":"00890000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select is(
  (select count(*)::int from user_views where name = 'Ann Private'), 0,
  'AC-UV-004: a same-org non-owner still cannot read another user''s private row (owner asymmetry intact)');

reset role;

select * from finish();
rollback;
