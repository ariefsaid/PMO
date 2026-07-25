-- tier_ownership_and_actor_state.test.sql — round-7 cross-family audit, B9 + B6 (mig 0117).
--
-- B9: `domain_externally_owned(org, domain)` ignores `external_tier`, so an org that moved `revenue`
--     to another external system while keeping an ERPNext binding still passed the ERPNext dispatch's
--     ownership gate. `domain_owned_by_tier` must answer per (domain, TIER).
-- B6: the sweep's recovery pass must re-assert the ORIGINAL actor's CURRENT standing before replaying
--     a frozen money command. `actor_authorization_state` supplies that fact to a machine caller for an
--     arbitrary user id, and must NOT become a role/status oracle for a user caller.

begin;
select plan(13);

-- ── Fixtures: two orgs. Org 1 has revenue on ODOO + procurement on ERPNEXT (the B9 shape).
--    A = active Finance, D = disabled Finance, B = banned Finance, O = a member of the OTHER org. ──
insert into organizations (id, name) values
  ('11170000-0000-0000-0000-000000000101','Tier Ownership Org'),
  ('11170000-0000-0000-0000-000000000102','Other Org');

insert into auth.users (id, email) values
  ('11170000-0000-0000-0000-0000000001a1','tier-active@example.com'),
  ('11170000-0000-0000-0000-0000000001d1','tier-disabled@example.com'),
  ('11170000-0000-0000-0000-0000000001b1','tier-banned@example.com'),
  ('11170000-0000-0000-0000-0000000001c1','tier-other@example.com');
update auth.users set banned_until = now() + interval '30 days'
 where id = '11170000-0000-0000-0000-0000000001b1';

insert into profiles (id, org_id, full_name, email, role, status) values
  ('11170000-0000-0000-0000-0000000001a1','11170000-0000-0000-0000-000000000101','A Active','tier-active@example.com','Finance','active'),
  ('11170000-0000-0000-0000-0000000001d1','11170000-0000-0000-0000-000000000101','D Disabled','tier-disabled@example.com','Finance','disabled'),
  ('11170000-0000-0000-0000-0000000001b1','11170000-0000-0000-0000-000000000101','B Banned','tier-banned@example.com','Finance','active'),
  ('11170000-0000-0000-0000-0000000001c1','11170000-0000-0000-0000-000000000102','O Other','tier-other@example.com','Admin','active');

insert into external_domain_ownership (org_id, external_tier, domain) values
  ('11170000-0000-0000-0000-000000000101','odoo','revenue'),
  ('11170000-0000-0000-0000-000000000101','erpnext','procurement');

-- ════════════════════════════════════════════════════════════════════════════
-- B9 — ownership is answered per (domain, tier).
-- ════════════════════════════════════════════════════════════════════════════
reset role;
set local request.jwt.claims = '{"role":"service_role"}';

select is(
  domain_owned_by_tier('11170000-0000-0000-0000-000000000101','revenue','erpnext'),
  false,
  'B9: revenue is owned by ODOO — the ERPNEXT tier does NOT own it');

select is(
  domain_externally_owned('11170000-0000-0000-0000-000000000101','revenue'),
  true,
  'B9 (the defect): the tier-agnostic 0087 function still says "owned" — which is why the guard let an '
  'ERPNext revenue money command through');

select is(
  domain_owned_by_tier('11170000-0000-0000-0000-000000000101','procurement','erpnext'),
  true,
  'B9: the domain this org DID assign to erpnext is still permitted');

select is(
  domain_owned_by_tier('11170000-0000-0000-0000-000000000102','procurement','erpnext'),
  false,
  'B9: ownership is org-scoped — another org''s assignment does not carry over');

-- ════════════════════════════════════════════════════════════════════════════
-- B6 — the actor's CURRENT standing, for a machine (service_role) caller.
-- ════════════════════════════════════════════════════════════════════════════
select is(
  actor_authorization_state('11170000-0000-0000-0000-000000000101','11170000-0000-0000-0000-0000000001a1'),
  '{"role":"Finance","active":true}'::jsonb,
  'B6: an active member reports their current role and active=true (the replay may proceed)');

select is(
  actor_authorization_state('11170000-0000-0000-0000-000000000101','11170000-0000-0000-0000-0000000001d1') -> 'active',
  'false'::jsonb,
  'B6: a DISABLED actor is inactive — their frozen money command must not be auto-replayed');

select is(
  actor_authorization_state('11170000-0000-0000-0000-000000000101','11170000-0000-0000-0000-0000000001b1') -> 'active',
  'false'::jsonb,
  'B6: a BANNED actor (auth.users.banned_until in the future) is inactive — same predicate as is_active_member()');

select is(
  actor_authorization_state('11170000-0000-0000-0000-000000000101','11170000-0000-0000-0000-0000000001c1') -> 'active',
  'false'::jsonb,
  'B6: a member of ANOTHER org is not an active member of the org being reconciled');

select is(
  actor_authorization_state('11170000-0000-0000-0000-000000000101','11170000-0000-0000-0000-00000000dead'),
  '{"role":null,"active":false}'::jsonb,
  'B6: an unknown actor fails closed (no profile row ⇒ no role, not active)');

-- ════════════════════════════════════════════════════════════════════════════
-- The definer must not become a role/status oracle for a USER caller.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"11170000-0000-0000-0000-0000000001a1","role":"authenticated"}';

select throws_ok(
  $$ select actor_authorization_state('11170000-0000-0000-0000-000000000101','11170000-0000-0000-0000-0000000001d1') $$,
  '42501', null,
  'a user caller asking about ANOTHER user is denied (42501) — self-only');

select is(
  actor_authorization_state('11170000-0000-0000-0000-000000000101','11170000-0000-0000-0000-0000000001a1') -> 'role',
  '"Finance"'::jsonb,
  'a user caller may still resolve ITS OWN state — the synchronous dispatch guard runs on the deputy client');

-- ════════════════════════════════════════════════════════════════════════════
-- The sweep's recovery pass runs as the `service_role` DB role — the EXECUTE grants must actually
-- carry (both functions are `revoke all from public`), or every recovery re-check would 42501 and
-- wedge the outbox.
-- ════════════════════════════════════════════════════════════════════════════
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

select is(
  domain_owned_by_tier('11170000-0000-0000-0000-000000000101','procurement','erpnext'),
  true,
  'the service_role DB role may execute domain_owned_by_tier (grant carries)');

select is(
  actor_authorization_state('11170000-0000-0000-0000-000000000101','11170000-0000-0000-0000-0000000001a1') -> 'active',
  'true'::jsonb,
  'the service_role DB role may execute actor_authorization_state for ANOTHER user — the recovery re-check');

reset role;
select * from finish();
rollback;
