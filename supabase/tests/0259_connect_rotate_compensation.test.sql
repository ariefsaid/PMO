-- AC-653-1..5: a failed ClickUp reconnect-rotate compensates to the PRIOR binding; first connect still
-- cleans up fully; the previous Vault secret is never removed on failure and is revoked on success.
-- AC-653-6: a failed reconnect over a DISCONNECTED binding leaves that row exactly as it was.
-- AC-653-7: the staging RPC refuses every caller but an active Admin of the org (or an operator).
begin;
select plan(39);
insert into organizations (id, name) values ('a2590000-0000-0000-0000-000000000001','Rotate Org');
insert into auth.users (id, email) values ('a2590000-0000-0000-0000-0000000000a1','a259-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('a2590000-0000-0000-0000-0000000000a1','a2590000-0000-0000-0000-000000000001','Admin','a259-admin@example.com','Admin','active');

select is((select has_function_privilege('authenticated','public.stage_vault_secret_for_org(uuid,text,text,text,uuid)','execute')), false, 'AC-653-5 stage RPC is not executable by authenticated');
select is((select has_function_privilege('anon','public.stage_vault_secret_for_org(uuid,text,text,text,uuid)','execute')), false, 'AC-653-5 stage RPC is not executable by anon');
select is((select has_function_privilege('service_role','public.stage_vault_secret_for_org(uuid,text,text,text,uuid)','execute')), true, 'AC-653-5 stage RPC is executable by service_role');
select is((select has_function_privilege('anon','public.cleanup_external_connect_attempt(uuid,text,text,uuid)','execute')), false, 'AC-653-5 cleanup RPC is not executable by anon');
select is((select has_function_privilege('authenticated','public.cleanup_external_connect_attempt(uuid,text,text,uuid)','execute')), false, 'AC-653-5 cleanup RPC is not executable by authenticated');
select is((select has_function_privilege('anon','public.finalize_external_connect(uuid,text,text,boolean,boolean,uuid)','execute')), false, 'AC-653-5 finalize RPC is not executable by anon');
select is((select has_function_privilege('authenticated','public.finalize_external_connect(uuid,text,text,boolean,boolean,uuid)','execute')), false, 'AC-653-5 finalize RPC is not executable by authenticated');

-- AC-653-7 denial matrix fixtures: an Admin of ANOTHER org, a non-Admin member, a disabled Admin.
insert into organizations (id, name) values ('a2590000-0000-0000-0000-000000000002','Other Org');
insert into auth.users (id, email) values
 ('a2590000-0000-0000-0000-0000000000b1','a259-other-admin@example.com'),
 ('a2590000-0000-0000-0000-0000000000c1','a259-member@example.com'),
 ('a2590000-0000-0000-0000-0000000000d1','a259-disabled@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('a2590000-0000-0000-0000-0000000000b1','a2590000-0000-0000-0000-000000000002','Other Admin','a259-other-admin@example.com','Admin','active'),
 ('a2590000-0000-0000-0000-0000000000c1','a2590000-0000-0000-0000-000000000001','Member','a259-member@example.com','Project Manager','active'),
 ('a2590000-0000-0000-0000-0000000000d1','a2590000-0000-0000-0000-000000000001','Disabled Admin','a259-disabled@example.com','Admin','disabled');

set local role authenticated;
select throws_ok($$select public.stage_vault_secret_for_org('a2590000-0000-0000-0000-000000000001','clickup','x','a259_deny_auth','a2590000-0000-0000-0000-0000000000a1')$$,
  '42501', null, 'AC-653-7 an authenticated caller cannot stage a secret');
reset role;
set local role anon;
select throws_ok($$select public.stage_vault_secret_for_org('a2590000-0000-0000-0000-000000000001','clickup','x','a259_deny_anon','a2590000-0000-0000-0000-0000000000a1')$$,
  '42501', null, 'AC-653-7 an anon caller cannot stage a secret');
reset role;
set local role service_role;
select throws_ok($$select public.stage_vault_secret_for_org('a2590000-0000-0000-0000-000000000001','clickup','x','a259_deny_other','a2590000-0000-0000-0000-0000000000b1')$$,
  '42501', 'insufficient privilege', 'AC-653-7 an Admin of another org cannot stage a secret for this org');
select throws_ok($$select public.stage_vault_secret_for_org('a2590000-0000-0000-0000-000000000001','clickup','x','a259_deny_member','a2590000-0000-0000-0000-0000000000c1')$$,
  '42501', 'insufficient privilege', 'AC-653-7 a non-Admin member cannot stage a secret');
select throws_ok($$select public.stage_vault_secret_for_org('a2590000-0000-0000-0000-000000000001','clickup','x','a259_deny_disabled','a2590000-0000-0000-0000-0000000000d1')$$,
  '42501', null, 'AC-653-7 a disabled Admin cannot stage a secret');
select throws_ok($$select public.stage_vault_secret_for_org('a2590000-0000-0000-0000-000000000001','clickup','x','a259_deny_null',null)$$,
  '42501', null, 'AC-653-7 a call with no actor cannot stage a secret');
reset role;
select is((select count(*)::int from vault.secrets where name like 'a259_deny_%'), 0, 'AC-653-7 refused calls write no Vault secret');
select is((select count(*)::int from external_org_bindings where org_id='a2590000-0000-0000-0000-000000000001'), 0, 'AC-653-7 refused calls write no binding');

-- Existing live binding (secret "a259_old")
select vault.create_secret('old-token','a259_old');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config)
 values ('a2590000-0000-0000-0000-000000000001','clickup','','a259_old','active','{"clickup_team_id":"t1"}');

set local role service_role;
-- Rotate: stage new
select is(public.stage_vault_secret_for_org('a2590000-0000-0000-0000-000000000001','clickup','new-token','a259_new','a2590000-0000-0000-0000-0000000000a1'), 'a259_new', 'AC-653-1 stage returns the new secret ref');
select is((select count(*)::int from vault.secrets where name='a259_old'), 1, 'AC-653-1 staging a rotation does not revoke the previous Vault secret');
select is((select secret_ref from external_org_bindings where org_id='a2590000-0000-0000-0000-000000000001' and external_tier='clickup'), 'a259_new', 'AC-653-1 binding points at the new secret while the attempt is in flight');

-- Failed finalize (readiness) -> compensate to prior
select is(public.finalize_external_connect('a2590000-0000-0000-0000-000000000001','clickup','a259_new',true,false,'a2590000-0000-0000-0000-0000000000a1'), 'rejected', 'AC-653-2 failed rotate finalize is rejected');
select is((select secret_ref from external_org_bindings where org_id='a2590000-0000-0000-0000-000000000001' and external_tier='clickup'), 'a259_old', 'AC-653-2 failed rotate restores the previous binding secret_ref');
select is((select status from external_org_bindings where org_id='a2590000-0000-0000-0000-000000000001' and external_tier='clickup'), 'active', 'AC-653-2 restored binding is still active');
select is((select config from external_org_bindings where org_id='a2590000-0000-0000-0000-000000000001' and external_tier='clickup'), '{"clickup_team_id":"t1"}'::jsonb, 'AC-653-2 restored binding keeps its config and drops the in-flight marker');
select is((select count(*)::int from vault.secrets where name='a259_old'), 1, 'AC-653-2 previous Vault secret survives a failed rotate');
select is((select count(*)::int from vault.secrets where name='a259_new'), 0, 'AC-653-2 only the failed attempt''s own secret is removed');

-- Rotate then explicit cleanup path (finalize RPC itself errored)
select public.stage_vault_secret_for_org('a2590000-0000-0000-0000-000000000001','clickup','new2','a259_new2','a2590000-0000-0000-0000-0000000000a1');
select public.cleanup_external_connect_attempt('a2590000-0000-0000-0000-000000000001','clickup','a259_new2','a2590000-0000-0000-0000-0000000000a1');
select is((select secret_ref from external_org_bindings where org_id='a2590000-0000-0000-0000-000000000001' and external_tier='clickup'), 'a259_old', 'AC-653-2 cleanup restores the previous binding too');

-- Successful rotate revokes the previous secret
select public.stage_vault_secret_for_org('a2590000-0000-0000-0000-000000000001','clickup','new3','a259_new3','a2590000-0000-0000-0000-0000000000a1');
select is(public.finalize_external_connect('a2590000-0000-0000-0000-000000000001','clickup','a259_new3',true,true,'a2590000-0000-0000-0000-0000000000a1'), 'active', 'AC-653-3 successful rotate finalizes');
select is((select count(*)::int from vault.secrets where name='a259_old'), 0, 'AC-653-3 previous secret is revoked only after a successful finalize');
select is((select secret_ref from external_org_bindings where org_id='a2590000-0000-0000-0000-000000000001' and external_tier='clickup'), 'a259_new3', 'AC-653-3 binding now holds the new secret');

-- First connect failure cleans up fully
reset role;
delete from external_org_bindings where org_id='a2590000-0000-0000-0000-000000000001';
set local role service_role;
select public.stage_vault_secret_for_org('a2590000-0000-0000-0000-000000000001','clickup','first','a259_first','a2590000-0000-0000-0000-0000000000a1');
select public.finalize_external_connect('a2590000-0000-0000-0000-000000000001','clickup','a259_first',true,false,'a2590000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from external_org_bindings where org_id='a2590000-0000-0000-0000-000000000001' and external_tier='clickup') + (select count(*)::int from vault.secrets where name='a259_first'), 0, 'AC-653-4 failed FIRST connect removes the binding and its secret');

-- Reconnect over a DISCONNECTED binding (its secret was already deleted at disconnect).
reset role;
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, connected_by, connected_at, disconnected_at)
 values ('a2590000-0000-0000-0000-000000000001','clickup','','a259_dead','disconnected','{"clickup_team_id":"t1"}',
         'a2590000-0000-0000-0000-0000000000a1','2026-01-01T00:00:00Z','2026-02-01T00:00:00Z');
create temp table a259_before as
  select status, secret_ref, connected_by, connected_at, disconnected_at, config from external_org_bindings
   where org_id='a2590000-0000-0000-0000-000000000001' and external_tier='clickup';
grant select on a259_before to service_role;
set local role service_role;
select public.stage_vault_secret_for_org('a2590000-0000-0000-0000-000000000001','clickup','re','a259_re','a2590000-0000-0000-0000-0000000000a1');
select is((select config->'prev_binding'->>'status' from external_org_bindings where org_id='a2590000-0000-0000-0000-000000000001' and external_tier='clickup'), 'disconnected',
  'AC-653-6 staging over a disconnected binding records it as disconnected, not as a live secret to retain');
select is(public.finalize_external_connect('a2590000-0000-0000-0000-000000000001','clickup','a259_re',true,false,'a2590000-0000-0000-0000-0000000000a1'), 'rejected', 'AC-653-6 failed reconnect over a disconnected binding is rejected');
select results_eq(
  $$select status, secret_ref, connected_by, connected_at, disconnected_at, config from external_org_bindings
     where org_id='a2590000-0000-0000-0000-000000000001' and external_tier='clickup'$$,
  $$select * from a259_before$$,
  'AC-653-6 failed reconnect (finalize) leaves the disconnected binding exactly as before');
select is((select count(*)::int from external_org_bindings b where b.status='active'
            and not exists (select 1 from vault.secrets v where v.name=b.secret_ref)), 0,
  'AC-653-6 no active binding is left pointing at a missing secret');
select is((select count(*)::int from vault.secrets where name='a259_re'), 0, 'AC-653-6 the failed attempt''s own secret is removed');

select public.stage_vault_secret_for_org('a2590000-0000-0000-0000-000000000001','clickup','re2','a259_re2','a2590000-0000-0000-0000-0000000000a1');
select public.cleanup_external_connect_attempt('a2590000-0000-0000-0000-000000000001','clickup','a259_re2','a2590000-0000-0000-0000-0000000000a1');
select results_eq(
  $$select status, secret_ref, connected_by, connected_at, disconnected_at, config from external_org_bindings
     where org_id='a2590000-0000-0000-0000-000000000001' and external_tier='clickup'$$,
  $$select * from a259_before$$,
  'AC-653-6 failed reconnect (cleanup) leaves the disconnected binding exactly as before');
select is((select count(*)::int from external_org_bindings b where b.status='active'
            and not exists (select 1 from vault.secrets v where v.name=b.secret_ref)), 0,
  'AC-653-6 cleanup leaves no active binding pointing at a missing secret');

-- A re-stage over an unfinalised attempt keeps the ORIGINAL prior state to restore to.
select public.stage_vault_secret_for_org('a2590000-0000-0000-0000-000000000001','clickup','re3','a259_re3','a2590000-0000-0000-0000-0000000000a1');
select public.stage_vault_secret_for_org('a2590000-0000-0000-0000-000000000001','clickup','re4','a259_re4','a2590000-0000-0000-0000-0000000000a1');
select public.cleanup_external_connect_attempt('a2590000-0000-0000-0000-000000000001','clickup','a259_re4','a2590000-0000-0000-0000-0000000000a1');
select results_eq(
  $$select status, secret_ref, connected_by, connected_at, disconnected_at, config from external_org_bindings
     where org_id='a2590000-0000-0000-0000-000000000001' and external_tier='clickup'$$,
  $$select * from a259_before$$,
  'AC-653-6 a re-staged attempt still restores the original disconnected state');

-- A successful reconnect over a disconnected binding goes active on the new secret.
select public.stage_vault_secret_for_org('a2590000-0000-0000-0000-000000000001','clickup','re5','a259_re5','a2590000-0000-0000-0000-0000000000a1');
select is(public.finalize_external_connect('a2590000-0000-0000-0000-000000000001','clickup','a259_re5',true,true,'a2590000-0000-0000-0000-0000000000a1'), 'active', 'AC-653-6 a successful reconnect over a disconnected binding finalizes');
select is((select status || ':' || secret_ref || ':' || (config ? 'prev_binding')::text from external_org_bindings
            where org_id='a2590000-0000-0000-0000-000000000001' and external_tier='clickup'), 'active:a259_re5:false',
  'AC-653-6 the reconnected binding is active on the new secret with no in-flight marker');
select finish(); rollback;
