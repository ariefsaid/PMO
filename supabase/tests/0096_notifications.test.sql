-- 0096_notifications.test.sql — notifications schema + owner-only RLS + mark-read-only UPDATE
-- (ADR-0044 §5, FR-AAN-006..009). Proves:
--   AC-AAN-009  table + unread partial index exist.
--   AC-AAN-010  owner reads own notifications; non-owner same-org reads zero.
--   AC-AAN-011  cross-org read returns zero (incl. Admin).
--   AC-AAN-012  INSERT pins owner_id; a spoofed recipient is rejected.
--   AC-AAN-013  the mark-read UPDATE succeeds for the owner and touches only read_at.
--   AC-AAN-014  the mark-read UPDATE is denied for a non-owner.
--   AC-AAN-015  a direct UPDATE touching title/body/severity/metadata is rejected.
-- Fixtures inserted as the table owner (bypassing RLS), then `set local role authenticated` +
-- `set local request.jwt.claims`. Fixture namespace: 00980000-…. Org A = default
-- '00000000-…-0001'; Org B = '00980000-…-0002'.
begin;
select plan(26);

-- ── Fixtures (inserted as table owner, bypassing RLS) ───────────────────────
insert into organizations (id, name) values
  ('00980000-0000-0000-0000-000000000002','Notifications Tenancy Org B');

insert into auth.users (id, email) values
  ('00980000-0000-0000-0000-0000000000a1','ntf-ann@example.com'),
  ('00980000-0000-0000-0000-0000000000a2','ntf-bob@example.com'),
  ('00980000-0000-0000-0000-0000000000a3','ntf-dana@example.com'),
  ('00980000-0000-0000-0000-0000000000b2','ntf-erin@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00980000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001','NTF Ann','ntf-ann@example.com','Engineer'),
  ('00980000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000001','NTF Bob','ntf-bob@example.com','Engineer'),
  ('00980000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-000000000001','NTF Dana','ntf-dana@example.com','Admin'),
  ('00980000-0000-0000-0000-0000000000b2','00980000-0000-0000-0000-000000000002','NTF Erin','ntf-erin@example.com','Admin');

-- A notification addressed to Ann.
insert into notifications (id, owner_id, title, body, severity) values
  ('00980000-0000-0000-0000-000000000010','00980000-0000-0000-0000-0000000000a1','Automation fired','details here','info');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AAN-009: table exists with required columns and the unread partial index.
-- ════════════════════════════════════════════════════════════════════════════
select has_table('notifications', 'AC-AAN-009: notifications table exists');
select has_column('notifications', 'id',         'AC-AAN-009: notifications.id exists');
select has_column('notifications', 'org_id',     'AC-AAN-009: notifications.org_id exists');
select has_column('notifications', 'owner_id',   'AC-AAN-009: notifications.owner_id exists');
select has_column('notifications', 'severity',   'AC-AAN-009: notifications.severity exists');
select has_column('notifications', 'title',      'AC-AAN-009: notifications.title exists');
select has_column('notifications', 'body',       'AC-AAN-009: notifications.body exists');
select has_column('notifications', 'metadata',   'AC-AAN-009: notifications.metadata exists');
select has_column('notifications', 'read_at',    'AC-AAN-009: notifications.read_at exists');
select has_column('notifications', 'created_at', 'AC-AAN-009: notifications.created_at exists');
select col_type_is('notifications', 'severity', 'text', 'AC-AAN-009: severity is text');
select has_index('notifications', 'notifications_owner_unread_idx', array['owner_id'],
  'AC-AAN-009: notifications_owner_unread_idx exists on (owner_id)');
select is(
  (select count(*)::int from pg_indexes
     where tablename = 'notifications'
       and indexname = 'notifications_owner_unread_idx'
       and indexdef ilike '%where%read_at%is%null%'),
  1,
  'AC-AAN-009: notifications_owner_unread_idx has a WHERE (read_at IS NULL) predicate');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AAN-010: owner reads own notifications; non-owner in the SAME org reads zero.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00980000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select is((select count(*)::int from notifications where id = '00980000-0000-0000-0000-000000000010'), 0,
  'AC-AAN-010: non-owner same-org (Bob) reads zero notifications');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AAN-011: cross-org read returns zero regardless of role (incl. Admin).
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00980000-0000-0000-0000-0000000000b2","role":"authenticated"}';

select is((select count(*)::int from notifications where id = '00980000-0000-0000-0000-000000000010'), 0,
  'AC-AAN-011: cross-org Admin (Erin, org B) reads zero notifications');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AAN-012: INSERT pins owner_id; a caller cannot create a notification for another user.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00980000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ insert into notifications (owner_id, title)
       values ('00980000-0000-0000-0000-0000000000a2','Spoofed recipient') $$,
  '42501', null,
  'AC-AAN-012: insert addressed to another user (spoofed owner_id) is denied by WITH CHECK');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AAN-013: the mark-read UPDATE succeeds for the owner and touches only read_at.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00980000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$ update notifications set read_at = now() where id = '00980000-0000-0000-0000-000000000010' $$,
  'AC-AAN-013: owner mark-read UPDATE (read_at only) succeeds');

select is(
  (select title from notifications where id = '00980000-0000-0000-0000-000000000010'),
  'Automation fired',
  'AC-AAN-013: title is unchanged after mark-read');
select is(
  (select body from notifications where id = '00980000-0000-0000-0000-000000000010'),
  'details here',
  'AC-AAN-013: body is unchanged after mark-read');
select is(
  (select severity from notifications where id = '00980000-0000-0000-0000-000000000010'),
  'info',
  'AC-AAN-013: severity is unchanged after mark-read');
select is(
  (select metadata from notifications where id = '00980000-0000-0000-0000-000000000010'),
  null,
  'AC-AAN-013: metadata is unchanged after mark-read');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AAN-014: the mark-read UPDATE is denied for a non-owner (zero rows affected).
-- ════════════════════════════════════════════════════════════════════════════
-- A second, still-unread notification for Ann so Bob's attempt is testable.
insert into notifications (id, owner_id, title, read_at) values
  ('00980000-0000-0000-0000-000000000011','00980000-0000-0000-0000-0000000000a1','Second notice', null);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00980000-0000-0000-0000-0000000000a2","role":"authenticated"}';

update notifications set read_at = now() where id = '00980000-0000-0000-0000-000000000011';

reset role;

select is(
  (select read_at from notifications where id = '00980000-0000-0000-0000-000000000011'),
  null,
  'AC-AAN-014: non-owner (Bob) mark-read UPDATE affects zero rows (still unread)');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AAN-015: a direct UPDATE touching title/body/severity/metadata is rejected —
-- content is immutable even for the owner.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00980000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ update notifications set title = 'x' where id = '00980000-0000-0000-0000-000000000011' $$,
  '42501', null,
  'AC-AAN-015: owner UPDATE of title is rejected (content immutable)');
select throws_ok(
  $$ update notifications set body = 'x' where id = '00980000-0000-0000-0000-000000000011' $$,
  '42501', null,
  'AC-AAN-015: owner UPDATE of body is rejected (content immutable)');
select throws_ok(
  $$ update notifications set severity = 'critical' where id = '00980000-0000-0000-0000-000000000011' $$,
  '42501', null,
  'AC-AAN-015: owner UPDATE of severity is rejected (content immutable)');
select throws_ok(
  $$ update notifications set metadata = '{"x":1}'::jsonb where id = '00980000-0000-0000-0000-000000000011' $$,
  '42501', null,
  'AC-AAN-015: owner UPDATE of metadata is rejected (content immutable)');

reset role;

select * from finish();
rollback;
