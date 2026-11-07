-- #1507 S4 AC-ODA-008/009/010: Odoo ledger reconciliation record, freshness states, and the three "not in a project" reasons.
begin;
select plan(46);

insert into organizations (id, name) values
 ('a7450000-0000-0000-0000-000000000011','Health A'),
 ('a7450000-0000-0000-0000-000000000012','Health B');
insert into auth.users (id, email) values
 ('a7450000-0000-0000-0000-0000000000e1','a745h-adm@example.test'),
 ('a7450000-0000-0000-0000-0000000000e2','a745h-fin@example.test'),
 ('a7450000-0000-0000-0000-0000000000e4','a745h-pm@example.test'),
 ('a7450000-0000-0000-0000-0000000000f1','a745h-badm@example.test');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('a7450000-0000-0000-0000-0000000000e1','a7450000-0000-0000-0000-000000000011','Health Admin','a745h-adm@example.test','Admin','active'),
 ('a7450000-0000-0000-0000-0000000000e2','a7450000-0000-0000-0000-000000000011','Health Fin','a745h-fin@example.test','Finance','active'),
 ('a7450000-0000-0000-0000-0000000000e4','a7450000-0000-0000-0000-000000000011','Health PM','a745h-pm@example.test','Project Manager','active'),
 ('a7450000-0000-0000-0000-0000000000f1','a7450000-0000-0000-0000-000000000012','Health B Admin','a745h-badm@example.test','Admin','active');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at) values
 ('a7450000-0000-0000-0000-000000000011','odoo','https://odoo.example.test','fixture-a','active','{"connection":{"state":"healthy"}}', now()),
 ('a7450000-0000-0000-0000-000000000012','odoo','https://odoo.example.test','fixture-b','active','{"connection":{"state":"healthy"}}', now());
insert into projects (id, org_id, code, name, status) values
 ('a7450000-0000-0000-0000-0000000000c1','a7450000-0000-0000-0000-000000000011','H-1','Health P1','Ongoing Project'),
 ('a7450000-0000-0000-0000-0000000000c2','a7450000-0000-0000-0000-000000000011','H-2','Health P2','Ongoing Project'),
 ('a7450000-0000-0000-0000-0000000000c3','a7450000-0000-0000-0000-000000000012','H-B','Health PB','Ongoing Project');
-- P1 -> analytic 301; P2 and P3(other org) share nothing. Analytic 999 is linked by no project.
insert into external_project_bindings (org_id, project_id, external_tier, external_container_id) values
 ('a7450000-0000-0000-0000-000000000011','a7450000-0000-0000-0000-0000000000c1','odoo','301'),
 ('a7450000-0000-0000-0000-000000000012','a7450000-0000-0000-0000-0000000000c3','odoo','301');
-- Only 5100 is mapped to a budget category.
insert into budget_category_account_map (org_id, category, erp_account) values
 ('a7450000-0000-0000-0000-000000000011','Labor','5100');
insert into erp_gl_entry_mirror (org_id, erp_name, account, project, voucher_type, voucher_no, posting_date, debit, credit, is_cancelled, erp_docstatus, erp_modified) values
 -- mapped, attributed, linked: counts in none of the three reasons
 ('a7450000-0000-0000-0000-000000000011','odoo:1:301','5100','301','account.move','A/1','2026-03-10',100,0,false,1,'2026-03-10 00:00:00'),
 -- unmapped account on the linked project
 ('a7450000-0000-0000-0000-000000000011','odoo:2:301','5900','301','account.move','A/2','2026-03-11',25,0,false,1,'2026-03-11 00:00:00'),
 ('a7450000-0000-0000-0000-000000000011','odoo:3:301','5900','301','account.move','A/3','2026-03-12',0,5,false,1,'2026-03-12 00:00:00'),
 -- no analytic account
 ('a7450000-0000-0000-0000-000000000011','odoo:4:-','5100',null,'account.move','A/4','2026-03-13',40,0,false,1,'2026-03-13 00:00:00'),
 -- analytic account no PMO project links
 ('a7450000-0000-0000-0000-000000000011','odoo:5:999','5100','999','account.move','A/5','2026-03-14',70,0,false,1,'2026-03-14 00:00:00'),
 -- cancelled lines count nowhere
 ('a7450000-0000-0000-0000-000000000011','odoo:6:-','5100',null,'account.move','A/6','2026-03-15',9999,0,true,0,'2026-03-15 00:00:00'),
 -- foreign org
 ('a7450000-0000-0000-0000-000000000012','odoo:1:-','5900',null,'account.move','B/1','2026-03-10',7777,0,false,1,'2026-03-10 00:00:00');

-- Roles: the record is service only; nothing for users or anon.
select ok(not has_function_privilege('authenticated','public.record_odoo_ledger_check(uuid,timestamptz,jsonb,text,text,integer,text)','execute')
      and not has_function_privilege('anon','public.record_odoo_ledger_check(uuid,timestamptz,jsonb,text,text,integer,text)','execute')
      and has_function_privilege('service_role','public.record_odoo_ledger_check(uuid,timestamptz,jsonb,text,text,integer,text)','execute'),
  'AC-ODA-008 only the service role can record a check');
select ok(not (select prosecdef from pg_proc where oid = 'public.get_odoo_ledger_health(uuid)'::regprocedure), 'AC-ODA-009 health is security invoker');
select ok(not has_function_privilege('anon','public.get_odoo_ledger_health(uuid)','execute'), 'AC-ODA-009 anonymous cannot execute health');

-- AC-ODA-008: matches / differs / not checked (previous good result kept).
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select record_odoo_ledger_check('a7450000-0000-0000-0000-000000000011', now(), '[]', 'bogus', null)$$, '22023', null, 'AC-ODA-008 an unknown status is refused');
select throws_ok($$select record_odoo_ledger_check('a7450000-0000-0000-0000-000000000011', now(), '[]', 'differs', null)$$, '22023', null, 'AC-ODA-008 a difference must name its accounts');
select lives_ok($$select record_odoo_ledger_check('a7450000-0000-0000-0000-000000000011', '2026-11-07 10:00:00+00', '[]', 'matches', null)$$, 'AC-ODA-008 a matching check is stored');
reset role;
select is((select count(*)::int from odoo_ledger_checks where org_id = 'a7450000-0000-0000-0000-000000000011'), 1, 'AC-ODA-008 one check row stored');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a7450000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select is(get_odoo_ledger_health()#>>'{check,status}', 'matches', 'AC-ODA-008 Finance reads the latest check: matches');

reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$select record_odoo_ledger_check('a7450000-0000-0000-0000-000000000011', '2026-11-07 11:00:00+00',
  '[{"account":"5100","pmo":{"debit":"100.00","credit":"0.00"},"odoo":{"debit":"120.00","credit":"0.00"}}]', 'differs', null)$$, 'AC-ODA-008 a difference is stored with both figures');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7450000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select is(get_odoo_ledger_health()#>>'{check,status}', 'differs', 'AC-ODA-008 the latest check differs');
select is(get_odoo_ledger_health()#>>'{check,accounts,0,odoo,debit}', '120.00', 'AC-ODA-008 the difference carries the Odoo figure');
select is(get_odoo_ledger_health()#>>'{check,accounts,0,account}', '5100', 'AC-ODA-008 the difference names the account');

reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$select record_odoo_ledger_check('a7450000-0000-0000-0000-000000000011', '2026-11-07 12:00:00+00', '[]', 'not-checked', 'read-failed')$$, 'AC-ODA-008 a failed grouped read is stored as not checked');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7450000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select is(get_odoo_ledger_health()#>>'{check,status}', 'not-checked', 'AC-ODA-008 the latest check is not checked');
select is(get_odoo_ledger_health()#>>'{lastGood,status}', 'differs', 'AC-ODA-008 the previous good result is kept');
select is(get_odoo_ledger_health()#>>'{lastGood,cutoff}', '2026-11-07T11:00:00+00:00', 'AC-ODA-008 ... with its own time');

-- AC-ODA-009: states. No feed yet -> unavailable-free path: catching up.
reset role;
update external_org_bindings set config = '{"connection":{"state":"unreachable"}}' where org_id = 'a7450000-0000-0000-0000-000000000011';
insert into external_sync_watermarks (org_id, external_tier, domain, watermark_cursor, updated_at) values
 ('a7450000-0000-0000-0000-000000000011','odoo','ledger:odoo','{"w":"2026-11-07 09:00:00","id":9,"census_done_at":"2026-11-07T01:00:00.000Z"}', now() - interval '31 minutes'),
 ('a7450000-0000-0000-0000-000000000011','odoo','ledger-caught-up:odoo','true', now() - interval '31 minutes');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7450000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select is(get_odoo_ledger_health()->>'state', 'unavailable', 'AC-ODA-009 an unhealthy connection reads unavailable, last data kept');
select isnt(get_odoo_ledger_health()->>'asOf', null, 'AC-ODA-009 ... and the last as-of time is still shown');
reset role;
update external_org_bindings set config = '{"connection":{"state":"healthy"}}' where org_id = 'a7450000-0000-0000-0000-000000000011';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7450000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select is(get_odoo_ledger_health()->>'state', 'stale', 'AC-ODA-009 a healthy connection with a 31 minute old as-of reads stale');
select is(get_odoo_ledger_health()->>'lastCensus', '2026-11-07T01:00:00.000Z', 'AC-ODA-009 the last census time comes from the cursor');
reset role;
update external_sync_watermarks set watermark_cursor = 'false' where org_id = 'a7450000-0000-0000-0000-000000000011' and domain = 'ledger-caught-up:odoo';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7450000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select is(get_odoo_ledger_health()->>'state', 'catching-up', 'AC-ODA-009 a feed that is not caught up reads catching up');
reset role;
update external_sync_watermarks set watermark_cursor = 'true', updated_at = now() - interval '5 minutes' where org_id = 'a7450000-0000-0000-0000-000000000011' and domain in ('ledger-caught-up:odoo','ledger:odoo') and domain = 'ledger-caught-up:odoo';
update external_sync_watermarks set updated_at = now() - interval '5 minutes' where org_id = 'a7450000-0000-0000-0000-000000000011' and domain = 'ledger:odoo';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7450000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select is(get_odoo_ledger_health()->>'state', 'fresh', 'AC-ODA-009 a caught-up feed read 5 minutes ago reads fresh');

-- AC-ODA-010: three reasons, separate; cancelled and foreign rows are in none.
select is(get_odoo_ledger_health()#>>'{unmapped,count}' || '/' || (get_odoo_ledger_health()#>>'{unmapped,debit}') || '/' || (get_odoo_ledger_health()#>>'{unmapped,credit}'), '2/25.00/5.00', 'AC-ODA-010 unmapped account: count and amounts');
select is(get_odoo_ledger_health()#>>'{unattributed,count}' || '/' || (get_odoo_ledger_health()#>>'{unattributed,debit}'), '1/40.00', 'AC-ODA-010 no analytic account: count and amount');
select is(get_odoo_ledger_health()#>>'{unlinked,count}' || '/' || (get_odoo_ledger_health()#>>'{unlinked,debit}'), '1/70.00', 'AC-ODA-010 analytic account no project links: count and amount');
select is(get_odoo_ledger_health('a7450000-0000-0000-0000-0000000000c1')#>>'{unmapped,count}', '2', 'AC-ODA-010 project scope: its own unmapped lines');
select is(get_odoo_ledger_health('a7450000-0000-0000-0000-0000000000c1')->'unattributed', 'null'::jsonb, 'AC-ODA-010 project scope: org-wide reasons are left out');

-- Review fixes: reason slug only for not-checked, accounts checked, feed position / stale, caught-up ageing, history that keeps the last good check.
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select record_odoo_ledger_check('a7450000-0000-0000-0000-000000000011', now(), '[]', 'matches', 'grouped read failed')$$, '22023', null, 'AC-ODA-008 a matches row carries no reason');
select throws_ok($$select record_odoo_ledger_check('a7450000-0000-0000-0000-000000000011', now(), '[]', 'not-checked', null)$$, '22023', null, 'AC-ODA-008 a not-checked row must name its reason');
select throws_ok($$select record_odoo_ledger_check('a7450000-0000-0000-0000-000000000011', now(), '[]', 'not-checked', 'free text with spaces')$$, '22023', null, 'AC-ODA-008 the reason is an error-class slug, not free text');
select throws_ok($$select record_odoo_ledger_check('a7450000-0000-0000-0000-000000000011', now(), '[]', 'matches', null, -1, null)$$, '22023', null, 'AC-ODA-008 a negative accounts-checked count is refused');
select lives_ok($$select record_odoo_ledger_check('a7450000-0000-0000-0000-000000000011', '2026-11-07 13:00:00+00', '[]', 'matches', null, 3, '2026-11-07 09:00:00|9')$$, 'AC-ODA-008 a matches check stores the accounts compared and the feed position');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7450000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select is(get_odoo_ledger_health()#>>'{check,accountsChecked}', '3', 'AC-ODA-008 the check shows how many accounts were compared');
select is(get_odoo_ledger_health()#>>'{check,stale}', 'false', 'AC-ODA-008 a check at the feed''s current position is not stale');
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
reset role;
update external_sync_watermarks set watermark_cursor = '{"w":"2026-11-07 09:00:00","id":10,"census_done_at":"2026-11-07T01:00:00.000Z"}' where org_id = 'a7450000-0000-0000-0000-000000000011' and domain = 'ledger:odoo';
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7450000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select is(get_odoo_ledger_health()#>>'{check,stale}', 'true', 'AC-ODA-008 once the feed has moved past the check it is stale');
select is(get_odoo_ledger_health()#>>'{lastGood,stale}', 'true', 'AC-ODA-008 ... also on the last good result');
reset role;
update external_sync_watermarks set watermark_cursor = '{"w":"2026-11-07 09:00:00","id":9,"census_done_at":"2099-01-01T00:00:00.000Z"}' where org_id = 'a7450000-0000-0000-0000-000000000011' and domain = 'ledger:odoo';
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7450000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select is(get_odoo_ledger_health()#>>'{check,stale}', 'true', 'AC-ODA-008 a check older than the last census is stale');
reset role;
update external_sync_watermarks set watermark_cursor = '{"w":"2026-11-07 09:00:00","id":9,"census_done_at":"2026-11-07T01:00:00.000Z"}' where org_id = 'a7450000-0000-0000-0000-000000000011' and domain = 'ledger:odoo';
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7450000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select is(get_odoo_ledger_health()->>'caughtUp', 'true', 'AC-ODA-009 a recent caught-up flag reads caught up');
reset role;
update external_sync_watermarks set updated_at = now() - interval '40 minutes' where org_id = 'a7450000-0000-0000-0000-000000000011' and domain = 'ledger-caught-up:odoo';
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7450000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select is(get_odoo_ledger_health()->>'caughtUp', 'false', 'AC-ODA-009 a caught-up flag older than 30 minutes (a pass that died) is not caught up');
reset role;
update external_sync_watermarks set watermark_cursor = 'false', updated_at = now() where org_id = 'a7450000-0000-0000-0000-000000000011' and domain = 'ledger-caught-up:odoo';
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7450000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select is(get_odoo_ledger_health()->>'caughtUp', 'false', 'AC-ODA-009 a held or stalled feed is not caught up');

-- Repeats of the newest not-checked reason within a day are not stored again.
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select record_odoo_ledger_check('a7450000-0000-0000-0000-000000000011', now(), '[]', 'not-checked', 'access-denied');
select record_odoo_ledger_check('a7450000-0000-0000-0000-000000000011', now(), '[]', 'not-checked', 'access-denied');
reset role;
select is((select count(*)::int from odoo_ledger_checks where org_id = 'a7450000-0000-0000-0000-000000000011' and reason = 'access-denied'), 1, 'AC-ODA-008 a repeated not-checked reason is stored once');
-- History: 52 alternating not-checked rows must not delete the last real result.
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select record_odoo_ledger_check('a7450000-0000-0000-0000-000000000011', now(), '[]', 'not-checked', case when i % 2 = 0 then 'r-a' else 'r-b' end) from generate_series(1, 52) i;
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7450000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select is(get_odoo_ledger_health()#>>'{lastGood,status}', 'matches', 'AC-ODA-008 after 52 not-checked rows the last good result is still there');
select is(get_odoo_ledger_health()#>>'{lastGood,accountsChecked}', '3', 'AC-ODA-008 ... with its figures');
reset role;
select is((select count(*)::int from odoo_ledger_checks where org_id = 'a7450000-0000-0000-0000-000000000011'), 51, 'AC-ODA-008 history is the newest 50 plus the last good one');

-- The inner service-role check holds even if EXECUTE were granted: break it and this goes red.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7450000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select throws_ok($$select record_odoo_ledger_check('a7450000-0000-0000-0000-000000000011', now(), '[]', 'matches', null)$$, '42501', null, 'AC-ODA-008 authenticated cannot record a check');
reset role;
grant execute on function public.record_odoo_ledger_check(uuid,timestamptz,jsonb,text,text,integer,text) to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7450000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select throws_ok($$select record_odoo_ledger_check('a7450000-0000-0000-0000-000000000011', now(), '[]', 'matches', null)$$, '42501', 'service role required', 'AC-ODA-008 the record function refuses a non-service caller on its own');
reset role;
revoke execute on function public.record_odoo_ledger_check(uuid,timestamptz,jsonb,text,text,integer,text) from authenticated;

select finish();
rollback;
