-- 0088_user_views_crud.test.sql — user_views CRUD + owner/role gate (Issue I1, ADR-0036 §6/§10.1).
-- Proves the owner-private-by-default RLS write/read contract on user_views (migration 0045):
--   AC-UV-001  owner reads their own private view, NOT another user's private view (SELECT predicate).
--   AC-UV-005  owner INSERT with name/spec only is stamped org_id (default org) + user_id (auth.uid());
--              a cross-org spoofed INSERT (org_id = org B) is hard-rejected by WITH CHECK → 42501.
--   AC-UV-004  a non-owner non-Admin UPDATE/DELETE is a silent 0-row no-op (USING hides the row) and
--              the target row is unchanged. NOTE: per the Companies precedent (0051), an RLS USING
--              denial on UPDATE/DELETE is a 0-row no-op, NOT 42501 (DELETE/UPDATE-USING has no error
--              surface). The spec's "denied (42501)" for AC-UV-004 is satisfied by "the write does not
--              take effect" (no-op + state-unchanged). A WITH CHECK denial on INSERT IS 42501 (AC-UV-005).
--              Additionally: an owner cannot reassign user_id to another same-org user on UPDATE — the
--              post-image owner re-pin in WITH CHECK rejects it (42501) and the row's user_id is unchanged.
--   AC-UV-006  a soft-archived row (archived_at set) is excluded from the live (archived_at is null)
--              list but still exists in the table (not hard-deleted).
-- RLS is the enforcement authority; the FE can() gate is clarity-only (ADR-0016). Fixtures inserted as
-- the table owner (bypassing RLS). Fixture namespace: 00880000-… ; default org = '00000000-…-0001'.
begin;
select plan(13);

-- ── Fixtures (inserted as table owner, bypassing RLS) ───────────────────────
-- Org A is the DEFAULT org ('00000000-…-0001'): the user_views.org_id column default is that literal,
-- so an in-default-org caller satisfies WITH CHECK (org_id = auth_org_id()) WITHOUT sending org_id —
-- exactly the production createUserView() path. Org B is a separate org used only as the cross-org spoof.
insert into organizations (id, name) values
  ('00880000-0000-0000-0000-000000000002','User Views CRUD Org B');

insert into auth.users (id, email) values
  ('00880000-0000-0000-0000-0000000000a1','uv-ann@example.com'),
  ('00880000-0000-0000-0000-0000000000a2','uv-bob@example.com'),
  ('00880000-0000-0000-0000-0000000000a3','uv-admin@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00880000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001','UV Ann','uv-ann@example.com','Engineer'),
  ('00880000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000001','UV Bob','uv-bob@example.com','Engineer'),
  ('00880000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-000000000001','UV Admin','uv-admin@example.com','Admin');

-- Ann's private view + Bob's private view (both in org A).
insert into user_views (id, org_id, user_id, name, scope, spec) values
  ('00880000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','00880000-0000-0000-0000-0000000000a1','Ann-Only','private','{}'::jsonb),
  ('00880000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','00880000-0000-0000-0000-0000000000a2','Bob-Only','private','{}'::jsonb);

-- ════════════════════════════════════════════════════════════════════════════
-- AC-UV-001: owner reads their own private view, not another user's private view.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00880000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is(
  (select count(*)::int from user_views where name = 'Ann-Only'), 1,
  'AC-UV-001: owner reads their own private view');
select is(
  (select count(*)::int from user_views where name = 'Bob-Only'), 0,
  'AC-UV-001: owner does NOT see another user''s private view');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-UV-005: INSERT stamps org_id (default) + user_id (auth.uid()); spoofed cross-org INSERT → 42501.
-- ════════════════════════════════════════════════════════════════════════════
-- Ann inserts supplying only name/spec — org_id from the column default, user_id from auth.uid() default.
select lives_ok(
  $$ insert into user_views (name, spec) values ('Ann New', '{"k":1}'::jsonb) $$,
  'AC-UV-005: owner INSERT with name/spec only — org_id + user_id stamped server-side');

-- Ann tries to spoof org B in the INSERT — WITH CHECK (org_id = auth_org_id()) rejects → 42501.
select throws_ok(
  $$ insert into user_views (org_id, name, spec)
       values ('00880000-0000-0000-0000-000000000002','Spoof','{}'::jsonb) $$,
  '42501', null,
  'AC-UV-005: cross-org spoofed INSERT rejected (WITH CHECK → 42501)');

reset role;

-- Confirm the legitimate INSERT was stamped with Ann's org (default) + Ann as owner.
select is(
  (select org_id::text from user_views where name = 'Ann New'),
  '00000000-0000-0000-0000-000000000001',
  'AC-UV-005: the inserted row is stamped with the caller''s org (org_id column default)');
select is(
  (select user_id::text from user_views where name = 'Ann New'),
  '00880000-0000-0000-0000-0000000000a1',
  'AC-UV-005: the inserted row is stamped with the caller as owner (user_id = auth.uid())');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-UV-004: a non-owner non-Admin cannot UPDATE/DELETE another user's view (silent 0-row no-op).
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00880000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- Bob (non-owner, non-Admin) attempts to hijack Ann's view — USING hides it → 0-row no-op (not 42501).
select lives_ok(
  $$ update user_views set name = 'Hijack' where id = '00880000-0000-0000-0000-000000000010' $$,
  'AC-UV-004: non-owner non-Admin UPDATE is a 0-row no-op (USING hides the row)');

-- Bob attempts to delete Ann's view — also a silent 0-row no-op.
select lives_ok(
  $$ delete from user_views where id = '00880000-0000-0000-0000-000000000010' $$,
  'AC-UV-004: non-owner non-Admin DELETE is a 0-row no-op');

reset role;

-- Confirm Bob changed nothing: Ann's view still exists with its original name.
select is(
  (select name from user_views where id = '00880000-0000-0000-0000-000000000010'),
  'Ann-Only',
  'AC-UV-004: the target view is unchanged (name still ''Ann-Only''; row still present)');

-- Owner cannot reassign ownership: Ann (the owner) tries to hand her view to Bob via a crafted UPDATE.
-- The UPDATE WITH CHECK re-pins (user_id = auth.uid() or Admin) on the post-image, so Bob is rejected →
-- 42501 (WITH CHECK violation), and Ann's row's user_id is unchanged (integrity/repudiation hardening).
set local role authenticated;
set local request.jwt.claims = '{"sub":"00880000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ update user_views set user_id = '00880000-0000-0000-0000-0000000000a2'
       where id = '00880000-0000-0000-0000-000000000010' $$,
  '42501', null,
  'AC-UV-004: owner cannot reassign user_id to another user (UPDATE WITH CHECK re-pins ownership → 42501)');

reset role;

select is(
  (select user_id::text from user_views where id = '00880000-0000-0000-0000-000000000010'),
  '00880000-0000-0000-0000-0000000000a1',
  'AC-UV-004: ownership unchanged after the attempted reassignment (user_id still Ann)');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-UV-006: soft-archive hides the row from the live list but keeps it in the table.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00880000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- Ann archives her own view (the DAL archiveUserView() path stamps archived_at).
update user_views set archived_at = now() where id = '00880000-0000-0000-0000-000000000010';

select is(
  (select count(*)::int from user_views where name = 'Ann-Only' and archived_at is null), 0,
  'AC-UV-006: archived row is excluded from the live (archived_at is null) list');
select is(
  (select count(*)::int from user_views where name = 'Ann-Only'), 1,
  'AC-UV-006: the row still exists (soft-archive, not hard-delete)');

reset role;

select * from finish();
rollback;
