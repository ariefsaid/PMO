-- 0089_user_views_tenancy.test.sql — user_views org isolation + scope-share (Issue I1, ADR-0036 §6).
-- Proves the cross-org wall and the shared_org visibility on user_views (migration 0045):
--   AC-UV-003  a shared_org view is visible to a same-org member, but NOT to a member of another org.
--   AC-UV-002  a cross-org SELECT returns ZERO rows regardless of scope — org_id is the wall (even a
--              shared_org row in org A is invisible to org B).
-- RLS is the enforcement authority (NFR-UV-SEC-001). Fixtures inserted as the table owner (bypassing
-- RLS). Org A = default org '00000000-…-0001'; Org B = '00890000-…-0002'. Fixture namespace: 00890000-….
begin;
select plan(4);

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
select is(
  (select count(*)::int from user_views), 0,
  'AC-UV-002: an org-B member sees none of org A''s views (no scope leaks across the org wall)');

reset role;

select * from finish();
rollback;
