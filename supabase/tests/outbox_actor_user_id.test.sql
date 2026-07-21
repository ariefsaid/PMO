-- outbox_actor_user_id.test.sql (0108 §C — Luna re-audit BLOCK 7)
--
-- `external_command_outbox` (0096) carried NO actor column: the dispatching user existed only in the
-- live request JWT. When the SWEEP later finalizes a committed-but-unmirrored SI there is no JWT, so
-- the author was unrecoverable -> `sales_invoices.author_user_id` NULL -> the approver≠author SoD
-- passed for everyone. 0108 §C adds a NULLABLE `actor_user_id` the dispatch stamps from the verified
-- JWT and the sweep reads back.
--
-- Nullability is load-bearing in BOTH directions: additive-nullable keeps the shipped P2 insert path
-- and every pre-0108 row valid, while B6's submit_sales_invoice guard is what makes a still-missing
-- author non-exploitable rather than silently SoD-exempt.
-- Uses namespaced UUIDs, begin/rollback, finish().

begin;
select plan(6);

-- 1) The column exists, on the right table, with the right type.
select has_column('public', 'external_command_outbox', 'actor_user_id',
  'B7: external_command_outbox.actor_user_id exists (the dispatching actor is persisted, not JWT-only)');
select col_type_is('public', 'external_command_outbox', 'actor_user_id', 'uuid',
  'B7: actor_user_id is uuid (matches sales_invoices.author_user_id / auth.users.id)');

-- 2) NULLABLE + FK to auth.users — additive, matching 0105's author_user_id convention.
select col_is_null('public', 'external_command_outbox', 'actor_user_id',
  'B7: actor_user_id is NULLABLE (existing P2 rows + machine/sweep-originated commands stay valid)');
select fk_ok('public', 'external_command_outbox', 'actor_user_id', 'auth', 'users', 'id',
  'B7: actor_user_id references auth.users(id) — a real user or nothing');

-- Fixtures for the round-trip (service_role: the dispatch writes the outbox with the service client).
insert into organizations (id, name) values
  ('11080000-0000-0000-0000-000000000301','B7 Outbox Org');
insert into auth.users (id, email) values
  ('11080000-0000-0000-0000-0000000003a1','actor-b7@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('11080000-0000-0000-0000-0000000003a1','11080000-0000-0000-0000-000000000301','Actor A','actor-b7@example.com','Finance','active');

set local request.jwt.claims = '{"role":"service_role"}';

-- 3) The dispatch's insert shape (the row `createDbMoneyOutboxDeps.insertOutboxPending` writes) round-
--    trips the actor — this is what a later sweep finalize reads to attribute the author.
insert into external_command_outbox
  (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, actor_user_id)
values
  ('11080000-0000-0000-0000-000000000301','revenue','11080000-0000-0000-0000-0000000003f1',
   'key-b7-roundtrip','erpnext','create','pending','11080000-0000-0000-0000-0000000003a1');

select is(
  (select actor_user_id from external_command_outbox
     where org_id = '11080000-0000-0000-0000-000000000301' and idempotency_key = 'key-b7-roundtrip'),
  '11080000-0000-0000-0000-0000000003a1'::uuid,
  'B7: an outbox row inserted through the dispatch''s column shape carries the dispatching actor');

-- 4) An actor-less insert (the shipped P2 path / a machine-originated command) is still accepted.
insert into external_command_outbox
  (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
values
  ('11080000-0000-0000-0000-000000000301','procurement','11080000-0000-0000-0000-0000000003f2',
   'key-b7-no-actor','erpnext','create','pending');

select is(
  (select actor_user_id from external_command_outbox
     where org_id = '11080000-0000-0000-0000-000000000301' and idempotency_key = 'key-b7-no-actor'),
  null,
  'B7: an actor-less insert still succeeds with a NULL actor (additive — the P2 path is not broken)');

select * from finish();
rollback;
