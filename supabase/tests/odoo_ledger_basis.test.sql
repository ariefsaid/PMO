-- #1507 S6 AC-ODA-016: the Admin's explicit switch of an Odoo org to ledger basis (OQ-ODA-2, FR-ODA-060), and the basis read it drives.
begin;
select plan(45);

insert into organizations (id, name, default_currency) values
 ('a7470000-0000-0000-0000-00000000000a','Basis A','IDR'), ('a7470000-0000-0000-0000-00000000000b','Basis B','IDR'),
 ('a7470000-0000-0000-0000-00000000000c','Basis C','IDR'), ('a7470000-0000-0000-0000-00000000000d','Basis D','IDR'), ('a7470000-0000-0000-0000-00000000000e','Basis E','IDR');
insert into auth.users (id, email) values
 ('a7470000-0000-0000-0000-0000000000a1','bs-admin-a@example.test'), ('a7470000-0000-0000-0000-0000000000a2','bs-fin-a@example.test'),
 ('a7470000-0000-0000-0000-0000000000a3','bs-gone-a@example.test'), ('a7470000-0000-0000-0000-0000000000b1','bs-admin-b@example.test'),
 ('a7470000-0000-0000-0000-0000000000c1','bs-admin-c@example.test'), ('a7470000-0000-0000-0000-0000000000d1','bs-admin-d@example.test'), ('a7470000-0000-0000-0000-0000000000e1','bs-admin-e@example.test');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('a7470000-0000-0000-0000-0000000000a1','a7470000-0000-0000-0000-00000000000a','A Admin','bs-admin-a@example.test','Admin','active'),
 ('a7470000-0000-0000-0000-0000000000a2','a7470000-0000-0000-0000-00000000000a','A Fin','bs-fin-a@example.test','Finance','active'),
 ('a7470000-0000-0000-0000-0000000000a3','a7470000-0000-0000-0000-00000000000a','A Gone','bs-gone-a@example.test','Admin','disabled'),
 ('a7470000-0000-0000-0000-0000000000b1','a7470000-0000-0000-0000-00000000000b','B Admin','bs-admin-b@example.test','Admin','active'),
 ('a7470000-0000-0000-0000-0000000000c1','a7470000-0000-0000-0000-00000000000c','C Admin','bs-admin-c@example.test','Admin','active'),
 ('a7470000-0000-0000-0000-0000000000d1','a7470000-0000-0000-0000-00000000000d','D Admin','bs-admin-d@example.test','Admin','active'),
 ('a7470000-0000-0000-0000-0000000000e1','a7470000-0000-0000-0000-00000000000e','E Admin','bs-admin-e@example.test','Admin','active');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at) values
 ('a7470000-0000-0000-0000-00000000000a','odoo','https://odoo.example.test','fx-a','active','{"database":"db"}', now()),
 ('a7470000-0000-0000-0000-00000000000b','odoo','https://odoo-b.example.test','fx-b','active','{}', now()),
 ('a7470000-0000-0000-0000-00000000000c','erpnext','https://erp.example.test','fx-c','active','{"company":"C Co"}', now()),
 ('a7470000-0000-0000-0000-00000000000e','odoo','https://odoo-e.example.test','fx-e','active','{}', now());

select ok(has_function_privilege('authenticated','public.switch_odoo_ledger_basis(boolean,text)','execute')
      and not has_function_privilege('anon','public.switch_odoo_ledger_basis(boolean,text)','execute'),
  'AC-ODA-016 only signed-in users may execute the switch');

-- Admin of A: unswitched Odoo org keeps the document basis.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7470000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(org_reads_erp_ledger(), false, 'AC-ODA-016 an Odoo org that has not been switched does not read the ledger basis');
select throws_ok($$select switch_odoo_ledger_basis()$$, 'P0001', 'ledger_not_caught_up',
  'AC-ODA-016 refused before the feed has caught up (no cursor)');
reset role;
-- Feed position and the caught-up flag (written by the sweep after each pass), with the cursor's census day.
insert into external_sync_watermarks (org_id, external_tier, domain, watermark_cursor, updated_at) values
 ('a7470000-0000-0000-0000-00000000000a','odoo','ledger:odoo','{"w":"2026-11-02 10:00:00","id":10,"census_done_at":"2026-11-02T11:00:00.000Z"}', now()),
 ('a7470000-0000-0000-0000-00000000000a','odoo','ledger-caught-up:odoo','false', now()),
 ('a7470000-0000-0000-0000-00000000000e','odoo','ledger:odoo','{"w":"2026-11-02 10:00:00","id":10,"census_done_at":"2026-11-02T11:00:00.000Z"}', now()),
 ('a7470000-0000-0000-0000-00000000000e','odoo','ledger-caught-up:odoo','true', now());
-- A real, current check on org A that differs, so only the feed state decides the next refusals.
insert into odoo_ledger_checks (org_id, checked_at, cutoff, status, accounts, accounts_checked, feed_position) values
 ('a7470000-0000-0000-0000-00000000000a', '2026-11-02 12:00:00+00', '2026-11-02 10:00:00+00', 'matches', '[]', 3, '2026-11-02 10:00:00|10');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7470000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select switch_odoo_ledger_basis(true, 'explained')$$, 'P0001', 'ledger_not_caught_up',
  'AC-ODA-016 a feed that says it is not caught up is refused, with a matching check and a confirmed difference');
reset role;
update external_sync_watermarks set watermark_cursor = 'true', updated_at = now() - interval '2 hours'
 where org_id = 'a7470000-0000-0000-0000-00000000000a' and domain = 'ledger-caught-up:odoo';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7470000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select switch_odoo_ledger_basis()$$, 'P0001', 'ledger_not_caught_up',
  'AC-ODA-016 a caught-up flag older than 30 minutes (a pass that died) is not caught up');
reset role;
update external_sync_watermarks set updated_at = now()
 where org_id = 'a7470000-0000-0000-0000-00000000000a' and domain = 'ledger-caught-up:odoo';
delete from odoo_ledger_checks where org_id = 'a7470000-0000-0000-0000-00000000000a';

-- Caught up, but no check at all.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7470000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select switch_odoo_ledger_basis(true, 'explained')$$, 'P0001', 'ledger_not_checked',
  'AC-ODA-016 caught up but never checked against Odoo: refused, an explained difference does not override');
select is(org_reads_erp_ledger(), false, 'AC-ODA-016 a refused switch leaves the document basis');
reset role;

-- Latest check not checked (Odoo unreachable): refused, no override.
insert into odoo_ledger_checks (org_id, checked_at, cutoff, status, reason, accounts, accounts_checked, feed_position) values
 ('a7470000-0000-0000-0000-00000000000a', '2026-11-02 12:00:00+00', '2026-11-02 10:00:00+00', 'not-checked', 'read-failed', '[]', 0, null);
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7470000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select switch_odoo_ledger_basis(true, 'explained')$$, 'P0001', 'ledger_not_checked',
  'AC-ODA-016 a latest check of "not checked" is refused, no override');
reset role;

-- A stale real result: it covers an older feed position.
insert into odoo_ledger_checks (org_id, checked_at, cutoff, status, accounts, accounts_checked, feed_position) values
 ('a7470000-0000-0000-0000-00000000000a', '2026-11-02 12:05:00+00', '2026-11-02 10:00:00+00', 'matches', '[]', 3, '2026-11-01 09:00:00|4');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7470000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select switch_odoo_ledger_basis()$$, 'P0001', 'ledger_check_stale',
  'AC-ODA-016 a matching check for an older feed position is stale: refused');
reset role;
-- A real result older than the last census (11:00) is stale too, and a stale difference is not overridable.
delete from odoo_ledger_checks where org_id = 'a7470000-0000-0000-0000-00000000000a';
insert into odoo_ledger_checks (org_id, checked_at, cutoff, status, accounts, accounts_checked, feed_position) values
 ('a7470000-0000-0000-0000-00000000000a', '2026-11-02 10:30:00+00', '2026-11-02 10:00:00+00', 'differs',
  '[{"account":"5100","pmo":{"debit":"100.00","credit":"0.00"},"odoo":{"debit":"120.00","credit":"0.00"}}]', 3, '2026-11-02 10:00:00|10');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7470000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select switch_odoo_ledger_basis(true, 'explained')$$, 'P0001', 'ledger_check_stale',
  'AC-ODA-016 a stale difference cannot be confirmed through');
reset role;
delete from odoo_ledger_checks where org_id = 'a7470000-0000-0000-0000-00000000000a';

-- "Matches" over no accounts compared nothing while the mirror has lines.
insert into erp_gl_entry_mirror (org_id, erp_name, account, project, voucher_type, voucher_no, posting_date, debit, credit, is_cancelled, erp_docstatus, erp_modified) values
 ('a7470000-0000-0000-0000-00000000000a','odoo:900:-','5100',null,'account.move','BILL/900','2026-11-01',10,0,false,1,'2026-11-01 00:00:00');
insert into odoo_ledger_checks (org_id, checked_at, cutoff, status, accounts, accounts_checked, feed_position) values
 ('a7470000-0000-0000-0000-00000000000a', '2026-11-02 12:07:00+00', '2026-11-02 10:00:00+00', 'matches', '[]', 0, '2026-11-02 10:00:00|10');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7470000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select switch_odoo_ledger_basis()$$, 'P0001', 'ledger_not_checked',
  'AC-ODA-016 a "matches" over 0 accounts, with lines mirrored, compared nothing: refused');
reset role;
delete from odoo_ledger_checks where org_id = 'a7470000-0000-0000-0000-00000000000a';
delete from erp_gl_entry_mirror where org_id = 'a7470000-0000-0000-0000-00000000000a';

-- A current difference: the Admin must confirm AND explain.
insert into odoo_ledger_checks (org_id, checked_at, cutoff, status, accounts, accounts_checked, feed_position) values
 ('a7470000-0000-0000-0000-00000000000a', '2026-11-02 12:08:00+00', '2026-11-02 10:00:00+00', 'differs',
  '[{"account":"5100","pmo":{"debit":"100.00","credit":"0.00"},"odoo":{"debit":"120.00","credit":"0.00"}}]', 3, '2026-11-02 10:00:00|10');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7470000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select switch_odoo_ledger_basis()$$, 'P0001', 'ledger_difference_unconfirmed', 'AC-ODA-016 a current difference is refused without confirmation');
select throws_ok($$select switch_odoo_ledger_basis(true)$$, 'P0001', 'ledger_difference_unconfirmed', 'AC-ODA-016 a confirmed difference needs a reason');
select throws_ok($$select switch_odoo_ledger_basis(true, '   ')$$, 'P0001', 'ledger_difference_unconfirmed', 'AC-ODA-016 a blank reason is no reason');
select throws_ok($$select switch_odoo_ledger_basis(false, 'timing difference')$$, 'P0001', 'ledger_difference_unconfirmed', 'AC-ODA-016 a reason without the confirmation is refused');
reset role;

-- Not an Admin, not active, no Odoo binding of its own.
set local request.jwt.claims = '{"sub":"a7470000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$select switch_odoo_ledger_basis(true)$$, '42501', null, 'AC-ODA-016 Finance cannot switch, even confirming a difference');
set local request.jwt.claims = '{"sub":"a7470000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$select switch_odoo_ledger_basis(true)$$, '42501', null, 'AC-ODA-016 an offboarded Admin cannot switch');
set local request.jwt.claims = '{"sub":"a7470000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select throws_ok($$select switch_odoo_ledger_basis(true)$$, 'P0002', null, 'AC-ODA-016 an ERPNext org has no Odoo connection to switch');
set local request.jwt.claims = '{"sub":"a7470000-0000-0000-0000-0000000000d1","role":"authenticated"}';
select throws_ok($$select switch_odoo_ledger_basis(true)$$, 'P0002', null, 'AC-ODA-016 an org with no connection finds nothing');
reset role;
select is((select config ? 'ledger_basis_at' from external_org_bindings where org_id = 'a7470000-0000-0000-0000-00000000000a' and external_tier = 'odoo'),
  false, 'AC-ODA-016 none of the refusals wrote the switch');
select is((select count(*)::int from audit_events where org_id = 'a7470000-0000-0000-0000-00000000000a' and action = 'odoo.ledger_basis_switch'),
  0, 'AC-ODA-016 none of the refusals is audited as a switch');

-- The Admin confirms and explains the difference.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7470000-0000-0000-0000-0000000000a1","role":"authenticated"}';
create temp table sw as select switch_odoo_ledger_basis(true, ' Odoo holds two bills posted after the cut-off ') as at;
grant all on sw to authenticated;
select ok((select at from sw) is not null, 'AC-ODA-016 a confirmed switch returns when it took effect');
select is(org_reads_erp_ledger(), true, 'AC-ODA-016 after the switch the org reads the ledger basis');
reset role;
select is((select (config->>'ledger_basis_at')::timestamptz = (select at from sw) from external_org_bindings
            where org_id = 'a7470000-0000-0000-0000-00000000000a' and external_tier = 'odoo'),
  true, 'AC-ODA-016 config.ledger_basis_at holds the switch time');
select is((select config->>'database' from external_org_bindings where org_id = 'a7470000-0000-0000-0000-00000000000a' and external_tier = 'odoo'),
  'db', 'AC-ODA-016 the rest of the binding config is kept');
select is((select count(*)::int from audit_events where org_id = 'a7470000-0000-0000-0000-00000000000a' and action = 'odoo.ledger_basis_switch'
              and actor_id = 'a7470000-0000-0000-0000-0000000000a1' and detail->>'confirmed_difference' = 'true' and detail->>'check' = 'differs'
              and detail->>'reason' = 'Odoo holds two bills posted after the cut-off'),
  1, 'AC-ODA-016 the switch is audited with who, the difference it confirmed and the reason given');

-- A matching check needs no confirmation (org E, caught up).
insert into odoo_ledger_checks (org_id, checked_at, cutoff, status, accounts, accounts_checked, feed_position) values
 ('a7470000-0000-0000-0000-00000000000e', '2026-11-02 12:00:00+00', '2026-11-02 10:00:00+00', 'matches', '[]', 2, '2026-11-02 10:00:00|10');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7470000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select lives_ok($$select switch_odoo_ledger_basis()$$, 'AC-ODA-016 a current matching check switches without a confirmation flag');
select is(org_reads_erp_ledger(), true, 'AC-ODA-016 and the org then reads the ledger basis');
reset role;
select is((select count(*)::int from audit_events where org_id = 'a7470000-0000-0000-0000-00000000000e' and action = 'odoo.ledger_basis_switch'
              and detail->>'confirmed_difference' = 'false' and detail->>'check' = 'matches' and detail->'reason' = 'null'::jsonb),
  1, 'AC-ODA-016 a matching switch is audited as matched, nothing confirmed');

-- Second call: no-op.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7470000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(switch_odoo_ledger_basis(), (select at from sw), 'AC-ODA-016 a second call returns the original time');
reset role;
select is((select count(*)::int from audit_events where org_id = 'a7470000-0000-0000-0000-00000000000a' and action = 'odoo.ledger_basis_switch'),
  1, 'AC-ODA-016 a second call is not audited again');

-- Other orgs are untouched; the ERPNext org still reads the ledger.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7470000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is(org_reads_erp_ledger(), false, 'AC-ODA-016 another Odoo org stays on the document basis');
select throws_ok($$select switch_odoo_ledger_basis()$$, 'P0001', 'ledger_not_caught_up', 'AC-ODA-016 and has to catch up on its own');
set local request.jwt.claims = '{"sub":"a7470000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select is(org_reads_erp_ledger(), true, 'AC-ODA-016 an active ERPNext binding still reads the ledger basis');
set local request.jwt.claims = '{"sub":"a7470000-0000-0000-0000-0000000000d1","role":"authenticated"}';
select is(org_reads_erp_ledger(), false, 'AC-ODA-016 an org with no binding reads the document basis');
set local request.jwt.claims = '{"sub":"a7470000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is(org_reads_erp_ledger(), false, 'AC-ODA-016 an offboarded member of a switched org reads nothing');
reset role;

-- S6-T5: the ERPNext-only statement machinery says "not in use" to a switched Odoo org (S5 serves Odoo statements), never a number.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7470000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from erp_financial_statement_availability), 0,
  'AC-ODA-016 S6-T5 a switched Odoo org has no ERPNext statement availability');
select is(get_financial_statement('month', '2026-03-01', 'trial_balance')->>'state', 'unavailable',
  'AC-ODA-016 S6-T5 the ERPNext statement read says unavailable to a switched Odoo org');
select is(request_financial_statement_refresh()->>'status', 'unavailable',
  'AC-ODA-016 S6-T5 the ERPNext statement refresh says unavailable to a switched Odoo org');
reset role;


-- A disconnected Odoo org that was switched stops reading the ledger.
update external_org_bindings set status = 'disconnected' where org_id = 'a7470000-0000-0000-0000-00000000000a' and external_tier = 'odoo';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7470000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(org_reads_erp_ledger(), false, 'AC-ODA-016 a switched org whose connection is not active does not read the ledger');
select throws_ok($$select switch_odoo_ledger_basis()$$, 'P0002', null, 'AC-ODA-016 and cannot be switched again while disconnected');
reset role;
update external_org_bindings set status = 'active' where org_id = 'a7470000-0000-0000-0000-00000000000a' and external_tier = 'odoo';
-- An Odoo binding that is active but never activated does not count either.
update external_org_bindings set activated_at = null where org_id = 'a7470000-0000-0000-0000-00000000000a' and external_tier = 'odoo';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7470000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(org_reads_erp_ledger(), false, 'AC-ODA-016 an unactivated Odoo binding does not read the ledger');
reset role;
update external_org_bindings set activated_at = now() where org_id = 'a7470000-0000-0000-0000-00000000000a' and external_tier = 'odoo';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7470000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(org_reads_erp_ledger(), true, 'AC-ODA-016 reconnected, the switch still stands');
reset role;

select is((select prosecdef from pg_proc where proname = 'switch_odoo_ledger_basis'), true, 'AC-ODA-016 the switch is a security-definer function');
select is((select count(*)::int from pg_proc where proname = 'switch_odoo_ledger_basis'), 1, 'AC-ODA-016 one overload only');

select * from finish();
rollback;
