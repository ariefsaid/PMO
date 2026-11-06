-- #1932: recovery scan for confirmed posts the post-confirm change trigger missed. The 0685 trigger fires
-- only on UPDATE OF state, so a row inserted already-confirmed (or confirmed before the trigger existed,
-- or whose bookkeeping failed and rolled back) raises no statement intent and waits for the nightly.
-- The scan reuses 0685's lease, intent_revision and backoff machinery: it stamps exactly the missed rows
-- and raises ONE coalesced reserved-path intent, so the next sweep tick refreshes instead of waiting for
-- the organization-local 02:00. A transition the trigger did see is stamped by the trigger itself and is
-- never re-raised; while an organization is disabled the scan does nothing and the legacy cadence applies.
begin;
select no_plan();

insert into public.organizations(id,name,default_currency,default_timezone) values
 ('06980000-0000-0000-0000-000000000001','Scan fixture A','IDR','UTC'),
 ('06980000-0000-0000-0000-000000000002','Scan fixture B','IDR','UTC');
insert into public.external_org_bindings(id,org_id,external_tier,site_url,secret_ref,version_major,config,activated_at) values
 ('06980000-0000-0000-0000-000000000011','06980000-0000-0000-0000-000000000001','erpnext','https://example.invalid','fixture',16,'{"company":"Scan A","project_map":{}}','2026-01-15T09:00:00Z'),
 ('06980000-0000-0000-0000-000000000012','06980000-0000-0000-0000-000000000002','erpnext','https://example.invalid','fixture',16,'{"company":"Scan B","project_map":{}}','2026-01-15T09:00:00Z');
insert into public.erp_sweep_lock(org_id,holder,locked_until) values
 ('06980000-0000-0000-0000-000000000001','06980000-0000-0000-0000-000000000101',clock_timestamp()+interval '60 minutes'),
 ('06980000-0000-0000-0000-000000000002','06980000-0000-0000-0000-000000000102',clock_timestamp()+interval '60 minutes');
set local role service_role;
select is(public.sync_erp_statement_change_scope('06980000-0000-0000-0000-000000000001','06980000-0000-0000-0000-000000000101','06980000-0000-0000-0000-000000000011','2026-01-15T09:00:00Z')->>'enabled','false','state initializes disabled like every 0681 organization');
select public.sync_erp_statement_change_scope('06980000-0000-0000-0000-000000000002','06980000-0000-0000-0000-000000000102','06980000-0000-0000-0000-000000000012','2026-01-15T09:00:00Z');
reset role;
update public.erp_statement_change_state set enabled=true
 where org_id in ('06980000-0000-0000-0000-000000000001','06980000-0000-0000-0000-000000000002');

-- a confirmation that passes the post-confirm trigger stamps itself and raises the reserved intent
insert into public.external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state)
 values ('06980000-0000-0000-0000-000000000001','invoice','scan-r1','scan-k1','erpnext','create','committed');
update public.external_command_outbox set state='confirmed' where idempotency_key='scan-k1';
select ok((select statement_intent_at is not null from public.external_command_outbox where idempotency_key='scan-k1'),
  'a confirmation through the post-confirm trigger is stamped as accounted');
select is((select intent_revision from public.erp_statement_change_state where org_id='06980000-0000-0000-0000-000000000001'),
  1::bigint,'a seen confirmation still raises the reserved intent (unchanged 0685 behavior)');

-- the gap: a row inserted already-confirmed never passes UPDATE OF state
insert into public.external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state)
 values ('06980000-0000-0000-0000-000000000001','invoice','scan-r2','scan-k2','erpnext','create','confirmed');
select ok((select statement_intent_at is null from public.external_command_outbox where idempotency_key='scan-k2'),
  'a row inserted already-confirmed is unstamped: the change trigger structurally missed it');
select is((select intent_revision from public.erp_statement_change_state where org_id='06980000-0000-0000-0000-000000000001'),
  1::bigint,'and it raised no intent');

-- the scan recovers it: one stamp per missed row, one coalesced intent, idempotent
set local role service_role;
select is(public.scan_erp_statement_confirmed_misses('06980000-0000-0000-0000-000000000001','06980000-0000-0000-0000-000000000101','06980000-0000-0000-0000-000000000011','2026-01-15T09:00:00Z')->>'missed','1',
  'the scan recovers exactly the unstamped confirmed posts');
reset role;
select is((select intent_revision from public.erp_statement_change_state where org_id='06980000-0000-0000-0000-000000000001'),
  2::bigint,'the missed post raises one coalesced reserved intent');
select ok((select statement_intent_at is not null from public.external_command_outbox where idempotency_key='scan-k2'),
  'the recovered row is stamped, so no later scan re-raises it');
set local role service_role;
select is(public.scan_erp_statement_confirmed_misses('06980000-0000-0000-0000-000000000001','06980000-0000-0000-0000-000000000101','06980000-0000-0000-0000-000000000011','2026-01-15T09:00:00Z')->>'missed','0',
  'a second scan finds nothing: the scan is idempotent');
select is((select intent_revision from public.erp_statement_change_state where org_id='06980000-0000-0000-0000-000000000001'),
  2::bigint,'and raises no further intent');

-- several missed posts coalesce into one intent per scan
reset role;
insert into public.external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state)
 values ('06980000-0000-0000-0000-000000000001','invoice','scan-r3','scan-k3','erpnext','create','confirmed'),
        ('06980000-0000-0000-0000-000000000001','invoice','scan-r4','scan-k4','erpnext','create','confirmed');
set local role service_role;
select is(public.scan_erp_statement_confirmed_misses('06980000-0000-0000-0000-000000000001','06980000-0000-0000-0000-000000000101','06980000-0000-0000-0000-000000000011','2026-01-15T09:00:00Z')->>'missed','2',
  'all missed rows are stamped in one scan');
reset role;
select is((select intent_revision from public.erp_statement_change_state where org_id='06980000-0000-0000-0000-000000000001'),
  3::bigint,'many missed posts still coalesce into a single intent');

-- a non-ERPNext tier and states before confirmation are not recovery material
insert into public.external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state)
 values ('06980000-0000-0000-0000-000000000001','invoice','scan-r5','scan-k5o','odoo','create','confirmed'),
        ('06980000-0000-0000-0000-000000000001','invoice','scan-r6','scan-k6c','erpnext','create','committed'),
        ('06980000-0000-0000-0000-000000000001','invoice','scan-r7','scan-k7h','erpnext','create','held');
set local role service_role;
select is(public.scan_erp_statement_confirmed_misses('06980000-0000-0000-0000-000000000001','06980000-0000-0000-0000-000000000101','06980000-0000-0000-0000-000000000011','2026-01-15T09:00:00Z')->>'missed','0',
  'another tier and pre-confirmation states are ignored');
reset role;

-- the trigger path keeps working after scans stamp nothing new: a fresh transition stamps + bumps
update public.external_command_outbox set state='confirmed' where idempotency_key='scan-k6c';
select ok((select statement_intent_at is not null from public.external_command_outbox where idempotency_key='scan-k6c'),
  'a fresh confirmation still stamps itself through the trigger');
select is((select intent_revision from public.erp_statement_change_state where org_id='06980000-0000-0000-0000-000000000001'),
  4::bigint,'and raises the reserved intent');
set local role service_role;
select is(public.scan_erp_statement_confirmed_misses('06980000-0000-0000-0000-000000000001','06980000-0000-0000-0000-000000000101','06980000-0000-0000-0000-000000000011','2026-01-15T09:00:00Z')->>'missed','0',
  'a trigger-seen confirmation is never recovered by the scan');

-- while the feature is disabled the scan does nothing; the trigger still stamps (legacy covers freshness)
reset role;
update public.erp_statement_change_state set enabled=false where org_id='06980000-0000-0000-0000-000000000001';
insert into public.external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state)
 values ('06980000-0000-0000-0000-000000000001','invoice','scan-r8','scan-k8','erpnext','create','confirmed');
update public.external_command_outbox set state='confirmed' where idempotency_key='scan-k7h';
set local role service_role;
select is(public.scan_erp_statement_confirmed_misses('06980000-0000-0000-0000-000000000001','06980000-0000-0000-0000-000000000101','06980000-0000-0000-0000-000000000011','2026-01-15T09:00:00Z')->>'status','disabled',
  'a disabled organization scans nothing');
reset role;
select is((select intent_revision from public.erp_statement_change_state where org_id='06980000-0000-0000-0000-000000000001'),
  4::bigint,'a disabled scan raises no intent');
select ok((select statement_intent_at is not null from public.external_command_outbox where idempotency_key='scan-k7h'),
  'a transition confirmed while disabled is still stamped by the trigger (legacy cadence covered it)');
update public.erp_statement_change_state set enabled=true where org_id='06980000-0000-0000-0000-000000000001';
set local role service_role;
select is(public.scan_erp_statement_confirmed_misses('06980000-0000-0000-0000-000000000001','06980000-0000-0000-0000-000000000101','06980000-0000-0000-0000-000000000011','2026-01-15T09:00:00Z')->>'missed','1',
  'after re-enabling, only the never-seen insert-as-confirmed is recovered');

-- fences: stranger holder, foreign binding, other organization's holder and an expired lease refuse
select throws_ok($q$select public.scan_erp_statement_confirmed_misses('06980000-0000-0000-0000-000000000001','06980000-0000-0000-0000-0000000009ff','06980000-0000-0000-0000-000000000011','2026-01-15T09:00:00Z')$q$,'55000',null,
  'a stranger holder cannot scan');
select throws_ok($q$select public.scan_erp_statement_confirmed_misses('06980000-0000-0000-0000-000000000001','06980000-0000-0000-0000-000000000101','06980000-0000-0000-0000-000000000012','2026-01-15T09:00:00Z')$q$,'55000',null,
  'a foreign binding cannot scan');
select throws_ok($q$select public.scan_erp_statement_confirmed_misses('06980000-0000-0000-0000-000000000001','06980000-0000-0000-0000-000000000102','06980000-0000-0000-0000-000000000011','2026-01-15T09:00:00Z')$q$,'55000',null,
  'another organization''s holder cannot scan this organization');
reset role;
update public.erp_sweep_lock set locked_until=clock_timestamp()-interval '1 second' where org_id='06980000-0000-0000-0000-000000000001';
set local role service_role;
select throws_ok($q$select public.scan_erp_statement_confirmed_misses('06980000-0000-0000-0000-000000000001','06980000-0000-0000-0000-000000000101','06980000-0000-0000-0000-000000000011','2026-01-15T09:00:00Z')$q$,'55000',null,
  'an expired lease cannot scan');
reset role;
update public.erp_sweep_lock set locked_until=clock_timestamp()+interval '60 minutes' where org_id='06980000-0000-0000-0000-000000000001';

-- cross-organization isolation: B's missed posts stay B's
insert into public.external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state)
 values ('06980000-0000-0000-0000-000000000002','invoice','scan-rb','scan-kb','erpnext','create','confirmed');
set local role service_role;
select is(public.scan_erp_statement_confirmed_misses('06980000-0000-0000-0000-000000000001','06980000-0000-0000-0000-000000000101','06980000-0000-0000-0000-000000000011','2026-01-15T09:00:00Z')->>'missed','0',
  'organization B''s missed posts do not leak into organization A''s scan');
select is(public.scan_erp_statement_confirmed_misses('06980000-0000-0000-0000-000000000002','06980000-0000-0000-0000-000000000102','06980000-0000-0000-0000-000000000012','2026-01-15T09:00:00Z')->>'missed','1',
  'organization B recovers its own missed post');
reset role;
select is((select intent_revision from public.erp_statement_change_state where org_id='06980000-0000-0000-0000-000000000001'),
  5::bigint,'organization A''s intent is untouched by organization B''s recovery');
select is((select intent_revision from public.erp_statement_change_state where org_id='06980000-0000-0000-0000-000000000002'),
  1::bigint,'organization B''s intent rose only for its own post');

-- only the sweep may run the scan; and no confirmed ERPNext post is left unstamped at the end
select ok(not has_function_privilege('anon','public.scan_erp_statement_confirmed_misses(uuid,uuid,uuid,timestamptz)','EXECUTE')
  and not has_function_privilege('authenticated','public.scan_erp_statement_confirmed_misses(uuid,uuid,uuid,timestamptz)','EXECUTE')
  and has_function_privilege('service_role','public.scan_erp_statement_confirmed_misses(uuid,uuid,uuid,timestamptz)','EXECUTE'),
  'only the sweep (service_role) can run the recovery scan');
select is((select count(*)::int from public.external_command_outbox
   where org_id in ('06980000-0000-0000-0000-000000000001','06980000-0000-0000-0000-000000000002')
     and external_tier='erpnext' and state='confirmed' and statement_intent_at is null),0,
  'every confirmed ERPNext post of the scanned organizations is accounted for');

select * from finish();
rollback;
