-- outbox_serialization.test.sql
-- AC-SAR-012 [pgTAP] — round-7 cross-family B3 + B7: the outbox is the SERIALIZATION point for money.
--
-- B3 (duplicate money): the pre-0116 uniqueness was only (org, domain, pmo_record_id, idempotency_key),
-- so two requests naming the SAME PMO record with DIFFERENT keys both saw no row, both inserted, and both
-- POSTed — two ERP documents (for a Payment Entry, two submitted cash/AR docs). The fix is a PARTIAL
-- unique index: at most one NON-TERMINAL outbox row per (org_id, domain, pmo_record_id). The second create
-- is refused by the DB at INSERT — before any ERP write — while the two paths that MUST keep working do:
--   • the legitimate same-key retry (it finds/claims its OWN row, it never re-inserts), and
--   • the sweep's recovery claim/quarantine cycle (state transitions on the one row).
--
-- B7 (key reuse across records): the key was scoped to the 4-tuple, and every active member could read
-- other people's keys, so a key lifted from an orphaned `committing` row could be re-presented under a NEW
-- pmo_record_id — the recovery probe then adopts the OLD ERP document and attributes its amount to
-- attacker-chosen PMO links. The fix makes a key SINGLE-USE per (org_id, domain) + removes member SELECT
-- on the key/payload columns.
begin;
select plan(16);

insert into organizations (id, name) values
  ('01160000-0000-0000-0000-000000000001','B3 Outbox Org A'),
  ('01160000-0000-0000-0000-000000000002','B3 Outbox Org B');
insert into auth.users (id, email) values ('01160000-0000-0000-0000-0000000000a1','b3-outbox@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('01160000-0000-0000-0000-0000000000a1','01160000-0000-0000-0000-000000000001','A','b3-outbox@example.com','Admin','active');

reset role;

-- ── B3: one non-terminal row per (org, domain, pmo_record_id) ────────────────────────────────────────
insert into external_command_outbox (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
values ('01160000-0000-0000-0000-0000000000c1','01160000-0000-0000-0000-000000000001','revenue','pmo-si-1','11111111-1111-1111-1111-111111111111','erpnext','create','pending');

select throws_ok(
  $$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
       values ('01160000-0000-0000-0000-000000000001','revenue','pmo-si-1','22222222-2222-2222-2222-222222222222','erpnext','create','pending') $$,
  '23505', null,
  'AC-SAR-012 B3 a SECOND create for the same PMO record under a DIFFERENT idempotency key is refused (no duplicate ERP document)');

-- The same refusal holds once the first row is mid-flight (`committing`) and after it has committed —
-- the whole window in which an ERP document may already exist for this record.
update external_command_outbox set state='committing' where id='01160000-0000-0000-0000-0000000000c1';
select throws_ok(
  $$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
       values ('01160000-0000-0000-0000-000000000001','revenue','pmo-si-1','33333333-3333-3333-3333-333333333333','erpnext','create','pending') $$,
  '23505', null,
  'AC-SAR-012 B3 a second create is refused while the first row is committing (the ERP POST may be in flight)');

-- ...and the legitimate SAME-KEY retry still reconciles: it reads its own row and CLAIMS it (no insert).
-- (dispatchMoneyWrite reads by the 4-tuple first; only a miss inserts.)
select is((select count(*)::int from external_command_outbox
            where org_id='01160000-0000-0000-0000-000000000001' and domain='revenue' and pmo_record_id='pmo-si-1'
              and idempotency_key='11111111-1111-1111-1111-111111111111'), 1,
  'AC-SAR-012 B3 the same-key retry still finds its own row (the read path is untouched)');

-- The sweep recovery cycle still works end to end on that one row: stale committing -> quarantine ->
-- (window elapsed) -> claim. The partial index must not interfere with STATE TRANSITIONS of a single row.
update external_command_outbox set updated_at = now() - interval '61 seconds' where id='01160000-0000-0000-0000-0000000000c1';
select is((select state from public.quarantine_committing('01160000-0000-0000-0000-0000000000c1')), 'quarantined',
  'AC-SAR-012 B3 the sweep can still quarantine a stale committing row (the index does not block transitions)');
update external_command_outbox set reconcile_after = now() - interval '1 second' where id='01160000-0000-0000-0000-0000000000c1';
select is((select state from public.claim_outbox_for_commit('01160000-0000-0000-0000-0000000000c1')), 'committing',
  'AC-SAR-012 B3 the sweep recovery claim still wins on the quarantined row (recovery is not broken)');

-- Terminal states free the record: a CONFIRMED create no longer blocks the NEXT command on the same
-- record (the submit/cancel that legitimately follows a create).
update external_command_outbox set state='confirmed' where id='01160000-0000-0000-0000-0000000000c1';
insert into external_command_outbox (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
values ('01160000-0000-0000-0000-0000000000c2','01160000-0000-0000-0000-000000000001','revenue','pmo-si-1','44444444-4444-4444-4444-444444444444','erpnext','transition','pending');
select is((select count(*)::int from external_command_outbox
            where org_id='01160000-0000-0000-0000-000000000001' and domain='revenue' and pmo_record_id='pmo-si-1'), 2,
  'AC-SAR-012 B3 a CONFIRMED row is terminal: the next command on the same record is admitted');

-- A `failed` row is likewise non-blocking: an ERP-rejected command minted no document, and the payload
-- digest binds the old key to the OLD payload — so a CORRECTED retry must be able to take a fresh key.
update external_command_outbox set state='failed' where id='01160000-0000-0000-0000-0000000000c2';
insert into external_command_outbox (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
values ('01160000-0000-0000-0000-0000000000c3','01160000-0000-0000-0000-000000000001','revenue','pmo-si-1','55555555-5555-5555-5555-555555555555','erpnext','transition','pending');
select is((select count(*)::int from external_command_outbox
            where org_id='01160000-0000-0000-0000-000000000001' and domain='revenue' and pmo_record_id='pmo-si-1' and state='pending'), 1,
  'AC-SAR-012 B3 a FAILED (ERP-rejected, no document minted) row does not block a corrected retry under a new key');

-- The index is org- and domain-scoped: another tenant, and another domain, are unaffected.
insert into external_command_outbox (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
values ('01160000-0000-0000-0000-0000000000c4','01160000-0000-0000-0000-000000000002','revenue','pmo-si-1','66666666-6666-6666-6666-666666666666','erpnext','create','pending');
select is((select org_id::text from external_command_outbox where id='01160000-0000-0000-0000-0000000000c4'), '01160000-0000-0000-0000-000000000002',
  'AC-SAR-012 B3 another ORG may hold a non-terminal row for the same pmo_record_id (the guard is org-scoped)');
insert into external_command_outbox (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
values ('01160000-0000-0000-0000-0000000000c5','01160000-0000-0000-0000-000000000001','procurement','pmo-si-1','77777777-7777-7777-7777-777777777777','erpnext','create','pending');
select is((select domain from external_command_outbox where id='01160000-0000-0000-0000-0000000000c5'), 'procurement',
  'AC-SAR-012 B3 another DOMAIN may hold a non-terminal row for the same pmo_record_id (the guard is domain-scoped)');

-- ── B7: an idempotency key is single-use per (org, domain) ───────────────────────────────────────────
-- The attack: lift key K off an orphaned row and re-present it under a DIFFERENT pmo_record_id so the
-- recovery probe adopts the ERP document minted for the ORIGINAL record.
select throws_ok(
  $$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
       values ('01160000-0000-0000-0000-000000000001','revenue','pmo-si-ATTACKER','11111111-1111-1111-1111-111111111111','erpnext','create','pending') $$,
  '23505', null,
  'AC-SAR-012 B7 an idempotency key already used by ANOTHER pmo record in this (org, domain) is refused');
-- Even after the original row reached a terminal state the key stays burned (the ERP document it anchors
-- lives forever, so the probe would still adopt it).
select throws_ok(
  $$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
       values ('01160000-0000-0000-0000-000000000001','revenue','pmo-si-OTHER','11111111-1111-1111-1111-111111111111','erpnext','create','pending') $$,
  '23505', null,
  'AC-SAR-012 B7 a key is burned for good — a CONFIRMED command''s key cannot be re-presented under a new record');
-- A DIFFERENT tenant is unaffected (keys are org-scoped, and a UUID collision across orgs is not a leak).
insert into external_command_outbox (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
values ('01160000-0000-0000-0000-0000000000c6','01160000-0000-0000-0000-000000000002','revenue','pmo-si-2','11111111-1111-1111-1111-111111111111','erpnext','create','pending');
select is((select count(*)::int from external_command_outbox where idempotency_key='11111111-1111-1111-1111-111111111111'), 2,
  'AC-SAR-012 B7 the key uniqueness is org-scoped (another tenant may hold the same UUID)');

-- Column privileges: an active member can still see WHAT is in flight (state/record), but not the
-- idempotency KEY or the frozen command PAYLOAD — the two fields the B7 replay needs.
select ok(not has_column_privilege('authenticated', 'public.external_command_outbox', 'idempotency_key', 'select'),
  'AC-SAR-012 B7 authenticated has NO column privilege on idempotency_key');
-- `payload` stays readable BY DESIGN: 0109's block_delete_with_inflight_external_command trigger reads
-- `payload ->> '<link>'` under the DELETING USER's privileges — revoking it breaks the in-flight-link
-- delete guard on projects/companies/sales_invoices (proven by that guard's own pgTAP suite).
select ok(has_column_privilege('authenticated', 'public.external_command_outbox', 'payload', 'select'),
  'AC-SAR-012 B7 payload REMAINS member-readable (0109''s in-flight delete-guard trigger reads it as the caller)');
select ok(has_column_privilege('authenticated', 'public.external_command_outbox', 'state', 'select'),
  'AC-SAR-012 B7 authenticated can still read the operational columns (state) — the row stays visible');

set local role authenticated;
set local request.jwt.claims = '{"sub":"01160000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ select idempotency_key from external_command_outbox $$,
  '42501', null,
  'AC-SAR-012 B7 a live member SELECT of idempotency_key is denied at runtime (42501)');
reset role;

select finish();
rollback;
