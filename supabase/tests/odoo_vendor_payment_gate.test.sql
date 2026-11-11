-- odoo_vendor_payment_gate.test.sql — 0508 (#1505 O2 P6, AC-OPP-064 P half, FR-OPP-063, FR-OPP-060).
-- (1) The database's payment rule and ceiling answer an Odoo-tier purchase exactly as any other: they take a purchase id, never a tier.
-- (2) resolve_held_outbox_command: the route out of HELD Odoo money commands. Admin or Finance, never the user who dispatched the
--     command, never another org, never a non-held row; it moves the row to `failed` (the ordinary recovery re-runs every gate) with the
--     operator's resolution recorded in the row's payload, and writes an audit row naming the actor.
begin;
select plan(46);

-- ── Fixtures ─────────────────────────────────────────────────────────────────────────────────────────────────────
insert into organizations (id, name, default_currency) values
  ('05080000-0000-0000-0000-00000000000a','Odoo Pay Org A','IDR'),
  ('05080000-0000-0000-0000-00000000000b','Odoo Pay Org B','IDR');

insert into auth.users (id, email) values
  ('05080000-0000-0000-0000-0000000000a1','admin-pay@example.com'),
  ('05080000-0000-0000-0000-0000000000a2','finance-creator@example.com'),
  ('05080000-0000-0000-0000-0000000000a3','finance-other@example.com'),
  ('05080000-0000-0000-0000-0000000000a4','engineer-pay@example.com'),
  ('05080000-0000-0000-0000-0000000000b1','admin-orgb-pay@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('05080000-0000-0000-0000-0000000000a1','05080000-0000-0000-0000-00000000000a','Admin Pay','admin-pay@example.com','Admin','active'),
  ('05080000-0000-0000-0000-0000000000a2','05080000-0000-0000-0000-00000000000a','Finance Creator','finance-creator@example.com','Finance','active'),
  ('05080000-0000-0000-0000-0000000000a3','05080000-0000-0000-0000-00000000000a','Finance Other','finance-other@example.com','Finance','active'),
  ('05080000-0000-0000-0000-0000000000a4','05080000-0000-0000-0000-00000000000a','Engineer Pay','engineer-pay@example.com','Engineer','active'),
  ('05080000-0000-0000-0000-0000000000b1','05080000-0000-0000-0000-00000000000b','Admin OrgB Pay','admin-orgb-pay@example.com','Admin','active');

-- The outbox is policy-less and machine-written: seeded as owner, the dispatch service role's stand-in. f1..f3 are HELD Odoo payments the
-- creator (a2) dispatched; f4 is a confirmed one; f5 an ERPNext payment; f6 a held Odoo bill; f7 a held Odoo payment of org B; f8 a held Odoo invoice.
insert into external_command_outbox (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, actor_user_id, payload, claim_generation, last_error) values
  ('05080000-0000-0000-0000-0000000000f1','05080000-0000-0000-0000-00000000000a','procurement','pay-1','k-pay-1','odoo','create','held','05080000-0000-0000-0000-0000000000a2','{"erp_doc_kind":"payment","paid_amount":98}',2,'recovery-inconclusive-absence'),
  ('05080000-0000-0000-0000-0000000000f2','05080000-0000-0000-0000-00000000000a','procurement','pay-2','k-pay-2','odoo','create','held','05080000-0000-0000-0000-0000000000a2','{"erp_doc_kind":"payment","paid_amount":98}',2,'recovery-probe-failed'),
  ('05080000-0000-0000-0000-0000000000f3','05080000-0000-0000-0000-00000000000a','procurement','pay-3','k-pay-3','odoo','create','held',null,'{"erp_doc_kind":"payment","paid_amount":98}',2,'creator unknown'),
  ('05080000-0000-0000-0000-0000000000f4','05080000-0000-0000-0000-00000000000a','procurement','pay-4','k-pay-4','odoo','create','confirmed','05080000-0000-0000-0000-0000000000a2','{"erp_doc_kind":"payment"}',1,null),
  ('05080000-0000-0000-0000-0000000000f5','05080000-0000-0000-0000-00000000000a','procurement','pay-5','k-pay-5','erpnext','create','held','05080000-0000-0000-0000-0000000000a2','{"erp_doc_kind":"payment"}',2,'held'),
  ('05080000-0000-0000-0000-0000000000f6','05080000-0000-0000-0000-00000000000a','procurement','bill-6','k-bill-6','odoo','create','held','05080000-0000-0000-0000-0000000000a2','{"erp_doc_kind":"purchase-invoice"}',2,'held'),
  ('05080000-0000-0000-0000-0000000000f7','05080000-0000-0000-0000-00000000000b','procurement','pay-7','k-pay-7','odoo','create','held','05080000-0000-0000-0000-0000000000a2','{"erp_doc_kind":"payment"}',2,'held'),
  ('05080000-0000-0000-0000-0000000000f8','05080000-0000-0000-0000-00000000000a','revenue','05080000-0000-0000-0000-0000000000c08','k-si-8','odoo','create','held','05080000-0000-0000-0000-0000000000a2','{"erp_doc_kind":"sales-invoice"}',2,'recovery-inconclusive-absence');
-- Odoo payment 77 is already mapped to another PMO record.
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values
  ('05080000-0000-0000-0000-00000000000a','procurement','some-other-payment','odoo','account.payment:77');

-- ── 1) The payment rule and the ceiling do not know the tier ────────────────────────────────────────────────────
insert into procurements (id, org_id, title, requested_by_id, currency, total_value, status, approved_by_id, approved_total_value, pr_number) values
  ('05080000-0000-0000-0000-000000000c01','05080000-0000-0000-0000-00000000000a','Within','05080000-0000-0000-0000-0000000000a4','IDR',100,'Vendor Invoiced','05080000-0000-0000-0000-0000000000a1',100,'PR-C1'),
  ('05080000-0000-0000-0000-000000000c02','05080000-0000-0000-0000-00000000000a','Over','05080000-0000-0000-0000-0000000000a4','IDR',200,'Vendor Invoiced','05080000-0000-0000-0000-0000000000a1',100,'PR-C2'),
  ('05080000-0000-0000-0000-000000000c03','05080000-0000-0000-0000-00000000000a','Awaiting','05080000-0000-0000-0000-0000000000a4','IDR',100,'Requested',null,null,'PR-C3');
insert into procurement_invoices (procurement_id, org_id, status, amount, currency, tax_treatment, tax_amount) values
  ('05080000-0000-0000-0000-000000000c01','05080000-0000-0000-0000-00000000000a','Received',90,'IDR','exclusive',0),
  ('05080000-0000-0000-0000-000000000c02','05080000-0000-0000-0000-00000000000a','Received',200,'IDR','exclusive',0);

create temp table rule_before as
  select procurement_payment_allowed('05080000-0000-0000-0000-000000000c01') as ok_case,
         procurement_payment_allowed('05080000-0000-0000-0000-000000000c03') as awaiting_case,
         (select row(ok, reason)::text from procurement_payment_within_ceiling('05080000-0000-0000-0000-000000000c01')) as within,
         (select row(ok, reason)::text from procurement_payment_within_ceiling('05080000-0000-0000-0000-000000000c02')) as over;

-- The org now employs procurement under Odoo.
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, activated_at, config) values
  ('05080000-0000-0000-0000-00000000000a','odoo','https://odoo.example.test','odoo_ref','active', now(), '{"database":"db1","odoo_company_id":1}');

select is(procurement_payment_allowed('05080000-0000-0000-0000-000000000c01'), null, 'AC-OPP-054 an approved purchase is payable under tier odoo: the rule answers null');
select is(procurement_payment_allowed('05080000-0000-0000-0000-000000000c03'), 'awaiting_approval', 'AC-OPP-054 a purchase awaiting approval is refused under tier odoo with the same reason code');
select is((select ok from procurement_payment_within_ceiling('05080000-0000-0000-0000-000000000c01')), true, 'AC-OPP-054 bills within the approved amount pass the ceiling under tier odoo');
select is((select ok from procurement_payment_within_ceiling('05080000-0000-0000-0000-000000000c02')), false, 'AC-OPP-054 bills above the approved amount are refused by the ceiling under tier odoo');
select is((select row(procurement_payment_allowed('05080000-0000-0000-0000-000000000c01'), procurement_payment_allowed('05080000-0000-0000-0000-000000000c03'),
                      (select row(ok, reason)::text from procurement_payment_within_ceiling('05080000-0000-0000-0000-000000000c01')),
                      (select row(ok, reason)::text from procurement_payment_within_ceiling('05080000-0000-0000-0000-000000000c02')))::text),
          (select row(ok_case, awaiting_case, within, over)::text from rule_before),
  'AC-OPP-054 employing Odoo changes no answer of the rule or the ceiling: they take a purchase, never a tier');

-- ── 2) Grants ────────────────────────────────────────────────────────────────────────────────────────────────────
select ok(has_function_privilege('authenticated', 'public.resolve_held_outbox_command(uuid,text,text,text)', 'execute')
          and not has_function_privilege('anon', 'public.resolve_held_outbox_command(uuid,text,text,text)', 'execute'),
  'AC-OPP-064 resolve_held_outbox_command is executable by a signed-in member, never by anon');
select ok((select prosecdef and proconfig @> array['search_path=public'] from pg_proc where oid = 'public.resolve_held_outbox_command(uuid,text,text,text)'::regprocedure),
  'AC-OPP-064 resolve_held_outbox_command is SECURITY DEFINER with a pinned search_path');

-- ── 3) Who may not resolve ───────────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"05080000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$ select resolve_held_outbox_command('05080000-0000-0000-0000-0000000000f1', 'absent', null, 'an engineer') $$, '42501', null, 'AC-OPP-064 an Engineer is refused');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"05080000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$ select resolve_held_outbox_command('05080000-0000-0000-0000-0000000000f1', 'absent', null, 'my own command') $$, '42501', null, 'AC-OPP-064 the Finance user who dispatched the command is refused');
select throws_ok($$ select resolve_held_outbox_command('05080000-0000-0000-0000-0000000000f2', 'adopt', 'account.payment:90', 'my own command') $$, '42501', null, 'AC-OPP-064 ... for adopt too');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"05080000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$ select resolve_held_outbox_command('05080000-0000-0000-0000-0000000000f3', 'absent', null, 'creator unknown') $$, '42501', null, 'AC-OPP-064 a command whose dispatcher is unknown cannot be shown not to be the resolver: refused (fail closed)');
select throws_ok($$ select resolve_held_outbox_command('05080000-0000-0000-0000-0000000000f7', 'absent', null, 'other org') $$, '42501', null, 'AC-OPP-064 another organisation''s held command is refused');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"05080000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$ select resolve_held_outbox_command('05080000-0000-0000-0000-0000000000f1', 'absent', null, 'not my org') $$, '42501', null, 'AC-OPP-064 a cross-org Admin is refused');
reset role;

update profiles set status = 'disabled' where id = '05080000-0000-0000-0000-0000000000a1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"05080000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$ select resolve_held_outbox_command('05080000-0000-0000-0000-0000000000f1', 'absent', null, 'offboarded') $$, '42501', null, 'AC-OPP-064 a disabled Admin with a still-valid JWT is refused');
reset role;
update profiles set status = 'active' where id = '05080000-0000-0000-0000-0000000000a1';

select is((select string_agg(state, ',' order by id) from external_command_outbox where id in ('05080000-0000-0000-0000-0000000000f1','05080000-0000-0000-0000-0000000000f2','05080000-0000-0000-0000-0000000000f3','05080000-0000-0000-0000-0000000000f7')),
  'held,held,held,held', 'AC-OPP-064 every refusal left its row held');
select is((select count(*)::int from audit_events where action = 'resolve_held_outbox_command'), 0, 'AC-OPP-064 a refusal writes no audit row');

-- ── 4) What may not be resolved, and what is not a resolution ────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"05080000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$ select resolve_held_outbox_command('05080000-0000-0000-0000-0000000000f4', 'absent', null, 'confirmed') $$, 'P0001', null, 'AC-OPP-064 a confirmed command is not resolvable: only a held one has a hold');
select throws_ok($$ select resolve_held_outbox_command('05080000-0000-0000-0000-0000000000f5', 'absent', null, 'erpnext') $$, 'P0001', null, 'AC-OPP-064 an ERPNext command is not resolved here (its route is release_outbox_hold)');
select throws_ok($$ select resolve_held_outbox_command('05080000-0000-0000-0000-0000000000f6', 'absent', null, 'a bill') $$, 'P0001', null, 'AC-OPP-064 a held Odoo vendor bill is not resolvable through the payment path');
select throws_ok($$ select resolve_held_outbox_command('05080000-0000-0000-0000-0000000000ff', 'absent', null, 'nope') $$, 'P0002', null, 'AC-OPP-064 an unknown id is a not-found');
select throws_ok($$ select resolve_held_outbox_command('05080000-0000-0000-0000-0000000000f1', 'retry', null, 'bad word') $$, '22023', null, 'AC-OPP-064 a resolution other than adopt or absent is refused');
select throws_ok($$ select resolve_held_outbox_command('05080000-0000-0000-0000-0000000000f1', 'adopt', null, 'no document named') $$, '22023', null, 'AC-OPP-064 adopt must name the Odoo payment');
select throws_ok($$ select resolve_held_outbox_command('05080000-0000-0000-0000-0000000000f1', 'adopt', 'account.move:90', 'a bill is not a payment') $$, '22023', null, 'AC-OPP-064 adopt must name an account.payment');
select throws_ok($$ select resolve_held_outbox_command('05080000-0000-0000-0000-0000000000f1', 'adopt', 'account.payment:90; drop', 'garbage') $$, '22023', null, 'AC-OPP-064 adopt takes only a model-qualified id');
select throws_ok($$ select resolve_held_outbox_command('05080000-0000-0000-0000-0000000000f1', 'absent', 'account.payment:90', 'absent names no document') $$, '22023', null, 'AC-OPP-064 absent names no document');
select throws_ok($$ select resolve_held_outbox_command('05080000-0000-0000-0000-0000000000f1', 'adopt', 'account.payment:77', 'linked elsewhere') $$, 'P0001', null, 'AC-OPP-064 a document already linked to another record cannot be adopted');
reset role;
select is((select state from external_command_outbox where id = '05080000-0000-0000-0000-0000000000f1'), 'held', 'AC-OPP-064 none of those moved the row');

-- ── 5) Finance (not the dispatcher) confirms absence; Admin adopts ───────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"05080000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok($$ select resolve_held_outbox_command('05080000-0000-0000-0000-0000000000f1', 'absent', null, 'checked the journal: no payment') $$, 'AC-OPP-064 a Finance user who did not dispatch it confirms it never existed');
reset role;
select is((select state from external_command_outbox where id = '05080000-0000-0000-0000-0000000000f1'), 'failed', 'AC-OPP-064 the row lands in failed: the ordinary bounded recovery re-runs every gate (nothing is fabricated as success)');
select is((select (payload->>'odoo_absent_confirmed')::boolean from external_command_outbox where id = '05080000-0000-0000-0000-0000000000f1'), true, 'AC-OPP-064 the confirmation travels in the payload the recovery probe reads');
select is((select claim_generation from external_command_outbox where id = '05080000-0000-0000-0000-0000000000f1'), 3, 'AC-OPP-064 the claim generation is bumped: a stale claimant''s late write-back is fenced out');
select ok((select last_error from external_command_outbox where id = '05080000-0000-0000-0000-0000000000f1') like '%05080000-0000-0000-0000-0000000000a3%checked the journal: no payment%', 'AC-OPP-064 the resolution names its actor and reason in last_error');
select is((select payload->>'paid_amount' from external_command_outbox where id = '05080000-0000-0000-0000-0000000000f1'), '98', 'AC-OPP-064 the rest of the command payload is untouched');

set local role authenticated;
set local request.jwt.claims = '{"sub":"05080000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select resolve_held_outbox_command('05080000-0000-0000-0000-0000000000f2', 'adopt', 'account.payment:90', 'the payment exists in Odoo, memo edited') $$, 'AC-OPP-064 an Admin who did not dispatch it adopts the Odoo payment');
reset role;
select is((select payload->>'odoo_adopted_ref' from external_command_outbox where id = '05080000-0000-0000-0000-0000000000f2'), 'account.payment:90', 'AC-OPP-064 the adopted document is recorded for the recovery probe to verify (it is not trusted blindly)');
select is((select state from external_command_outbox where id = '05080000-0000-0000-0000-0000000000f2'), 'failed', 'AC-OPP-064 an adopted row is re-driven by the ordinary recovery too');

-- C6 extends the same actor-checked decision to a held Odoo revenue invoice; it still returns to ordinary recovery.
set local role authenticated;
set local request.jwt.claims = '{"sub":"05080000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$ select resolve_held_outbox_command('05080000-0000-0000-0000-0000000000f8', 'adopt', 'account.payment:90', 'wrong kind') $$,
  '22023', null, 'AC-OCI-052 an invoice resolution must name an Odoo account.move');
select lives_ok($$ select resolve_held_outbox_command('05080000-0000-0000-0000-0000000000f8', 'adopt', 'account.move:90', 'invoice exists in Odoo') $$,
  'AC-OCI-052 a different Admin may adopt the held invoice');
reset role;
select results_eq($$select state, payload->>'odoo_adopted_ref' from external_command_outbox where id='05080000-0000-0000-0000-0000000000f8'$$,
  $$values ('failed'::text,'account.move:90'::text)$$,'AC-OCI-052 invoice adoption records the decision and returns to recovery');

-- ── 6) The audit trail ───────────────────────────────────────────────────────────────────────────────────────────
select is((select count(*)::int from audit_events where action = 'resolve_held_outbox_command' and actor_id = '05080000-0000-0000-0000-0000000000a3' and entity_id = '05080000-0000-0000-0000-0000000000f1'
             and detail->>'resolution' = 'absent'), 1, 'AC-OPP-064 one audit row names the Finance user, the command and the resolution');
select is((select count(*)::int from audit_events where action = 'resolve_held_outbox_command' and actor_id = '05080000-0000-0000-0000-0000000000a1' and entity_id = '05080000-0000-0000-0000-0000000000f2'
             and detail->>'resolution' = 'adopt' and detail->>'external_record_id' = 'account.payment:90'), 1, 'AC-OPP-064 one audit row names the Admin, the command, the resolution and the adopted document');

-- ── 7) At most one in-flight payment per bill (I1/I2) ──────────────────────────────────────────────────────────
-- Two intents for one Odoo bill (two users, two tabs, or a fresh intent after a lost response) must not both go out: Odoo accepts an
-- overpayment, so the database is the only barrier. A payment's own record id is not enough: each intent has its own.
insert into external_command_outbox (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, actor_user_id, payload) values
  ('05080000-0000-0000-0000-0000000000e1','05080000-0000-0000-0000-00000000000a','procurement','pay-e1','k-pay-e1','odoo','create','committing','05080000-0000-0000-0000-0000000000a2','{"erp_doc_kind":"payment","odoo_bill_ref":"account.move:501"}');
select throws_ok($$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('05080000-0000-0000-0000-00000000000a','procurement','pay-e2','k-pay-e2','odoo','create','pending','{"erp_doc_kind":"payment","odoo_bill_ref":"account.move:501"}') $$,
  '23505', null, 'I1/I2 a second payment intent for a bill that already has one in flight is refused by the database');
select lives_ok($$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('05080000-0000-0000-0000-00000000000a','procurement','pay-e3','k-pay-e3','odoo','create','pending','{"erp_doc_kind":"payment","odoo_bill_ref":"account.move:502"}') $$,
  'I1/I2 a payment of a different bill is not blocked');
select lives_ok($$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('05080000-0000-0000-0000-00000000000b','procurement','pay-e4','k-pay-e4','odoo','create','pending','{"erp_doc_kind":"payment","odoo_bill_ref":"account.move:501"}') $$,
  'I1/I2 another org''s payment of a bill with the same Odoo reference is not blocked');
insert into external_command_outbox (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, actor_user_id, payload) values
  ('05080000-0000-0000-0000-0000000000e5','05080000-0000-0000-0000-00000000000a','procurement','pay-e5','k-pay-e5','odoo','create','held','05080000-0000-0000-0000-0000000000a2','{"erp_doc_kind":"payment","odoo_bill_ref":"account.move:503"}');
select throws_ok($$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('05080000-0000-0000-0000-00000000000a','procurement','pay-e6','k-pay-e6','odoo','create','pending','{"erp_doc_kind":"payment","odoo_bill_ref":"account.move:503"}') $$,
  '23505', null, 'I1/I2 a HELD payment holds its bill: a fresh intent waits for the operator''s decision');
update external_command_outbox set state = 'confirmed' where id = '05080000-0000-0000-0000-0000000000e1';
select lives_ok($$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('05080000-0000-0000-0000-00000000000a','procurement','pay-e7','k-pay-e7','odoo','create','pending','{"erp_doc_kind":"payment","odoo_bill_ref":"account.move:501"}') $$,
  'I1/I2 once the first payment is confirmed the bill can take another (a partial payment, then the rest)');

select * from finish();
rollback;
