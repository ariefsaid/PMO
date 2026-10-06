-- AC-653-1..5: a failed ClickUp reconnect-rotate compensates to the PRIOR binding; first connect still
-- cleans up fully; the previous Vault secret is never removed on failure and is revoked on success.
begin;
select plan(17);
insert into organizations (id, name) values ('a2590000-0000-0000-0000-000000000001','Rotate Org');
insert into auth.users (id, email) values ('a2590000-0000-0000-0000-0000000000a1','a259-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('a2590000-0000-0000-0000-0000000000a1','a2590000-0000-0000-0000-000000000001','Admin','a259-admin@example.com','Admin','active');

select is((select has_function_privilege('authenticated','public.stage_vault_secret_for_org(uuid,text,text,text,uuid)','execute')), false, 'AC-653-5 stage RPC is not executable by authenticated');
select is((select has_function_privilege('anon','public.stage_vault_secret_for_org(uuid,text,text,text,uuid)','execute')), false, 'AC-653-5 stage RPC is not executable by anon');
select is((select has_function_privilege('service_role','public.stage_vault_secret_for_org(uuid,text,text,text,uuid)','execute')), true, 'AC-653-5 stage RPC is executable by service_role');

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
select finish(); rollback;
