-- ECA-3 (#1606, migration 0482): the send drain's three service-only functions.
-- AC-ECA-010 (DB half: one external reference per sent company, nothing written to accounts or taxes) and AC-ECA-012 (DB half:
-- a rejected send becomes a review row with a plain reason and leaves the others alone), NFR-ECA-004 (a held send says so).
begin;
select plan(38);

insert into organizations (id, name) values
 ('a4520000-0000-0000-0000-000000000001','Sends A'),
 ('a4520000-0000-0000-0000-000000000002','Sends B');
insert into auth.users (id, email) values
 ('a4520000-0000-0000-0000-0000000000a1','a452-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('a4520000-0000-0000-0000-0000000000a1','a4520000-0000-0000-0000-000000000001','Admin','a452-admin@example.com','Admin','active');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at) values
 ('a4520000-0000-0000-0000-000000000001','erpnext','https://erp.example.test','a452_a','active','{"company":"Example Co"}', now()),
 ('a4520000-0000-0000-0000-000000000002','erpnext','https://erp-b.example.test','a452_b','active','{"company":"Example B"}', now());
insert into companies (id, org_id, name, type) values
 ('a4520000-0000-0000-0000-0000000000d1','a4520000-0000-0000-0000-000000000001','V1','Vendor'),
 ('a4520000-0000-0000-0000-0000000000d9','a4520000-0000-0000-0000-000000000002','B Co','Vendor');
insert into projects (id, org_id, name, status) values
 ('a4520000-0000-0000-0000-0000000000f2','a4520000-0000-0000-0000-000000000001','P1','Ongoing Project');

-- Proposals in `sending`, the way an Admin's accept leaves them.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select set_config('a452.run', public.start_connect_run('a4520000-0000-0000-0000-000000000001','erpnext','a4520000-0000-0000-0000-0000000000a1')::text, true);
select public.write_connect_census('a4520000-0000-0000-0000-000000000001','erpnext','[
  {"kind":"party","pmoCount":1,"erpCount":0,"scenario":"S-C"},{"kind":"project","pmoCount":1,"erpCount":0,"scenario":"S-C"},{"kind":"item","pmoCount":2,"erpCount":0,"scenario":"S-C"}]'::jsonb);
select public.replace_connect_proposals('a4520000-0000-0000-0000-000000000001','erpnext',current_setting('a452.run')::uuid,'party',
  '[{"outcome":"send","pmoIds":["a4520000-0000-0000-0000-0000000000d1"],"externalIds":[],"snapshot":{}}]'::jsonb, false);
select public.replace_connect_proposals('a4520000-0000-0000-0000-000000000001','erpnext',current_setting('a452.run')::uuid,'project',
  '[{"outcome":"send","pmoIds":["a4520000-0000-0000-0000-0000000000f2"],"externalIds":[],"snapshot":{}}]'::jsonb, false);
select public.replace_connect_proposals('a4520000-0000-0000-0000-000000000001','erpnext',current_setting('a452.run')::uuid,'item',
  '[{"outcome":"send","pmoIds":["Semen 50 kg"],"externalIds":[],"snapshot":{}},{"outcome":"send","pmoIds":["Pasir"],"externalIds":[],"snapshot":{}}]'::jsonb, false);
reset role;
update erp_connect_proposals set state = 'sending', decided_by = 'a4520000-0000-0000-0000-0000000000a1', decided_at = now()
 where org_id = 'a4520000-0000-0000-0000-000000000001';
-- Another organisation's queued send: never claimed, never settled by A's calls.
insert into erp_connect_proposals (id, org_id, binding_id, external_tier, kind, outcome, state, identity, pmo_ids)
  values ('a4520000-0000-0000-0000-0000000000b9','a4520000-0000-0000-0000-000000000002',(select id from external_org_bindings where org_id='a4520000-0000-0000-0000-000000000002'),'erpnext','party','send','sending','send|["b"]|[]','{a4520000-0000-0000-0000-0000000000d9}');

create temp table ids as select kind, pmo_ids[1] as pmo, id from erp_connect_proposals where org_id = 'a4520000-0000-0000-0000-000000000001';
grant select on ids to service_role;
select is((select count(*)::int from erp_connect_proposals where org_id = 'a4520000-0000-0000-0000-000000000001' and state = 'sending'), 4, 'premise: four sends wait in org A');

-- 1. claim: leases rows once.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is((select count(*)::int from public.claim_connect_sends('a4520000-0000-0000-0000-000000000001','erpnext',10)), 4, 'AC-ECA-010 claim_connect_sends returns the queued sends once');
select is((select count(*)::int from public.claim_connect_sends('a4520000-0000-0000-0000-000000000001','erpnext',10)), 0, 'a second claim within the lease returns none');
select is((select count(*)::int from erp_connect_proposals where id = 'a4520000-0000-0000-0000-0000000000b9' and send_claimed_at is null), 1, 'another organisation''s send was not leased by A''s claim');
reset role;
update erp_connect_proposals set send_claimed_at = now() - interval '6 minutes' where kind = 'item' and pmo_ids[1] = 'Pasir';
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select results_eq($$select pmo_ids[1] from public.claim_connect_sends('a4520000-0000-0000-0000-000000000001','erpnext',10)$$, $$values ('Pasir'::text)$$, 'a lease older than five minutes is claimed again');
select is((select count(*)::int from public.claim_connect_sends('a4520000-0000-0000-0000-000000000002','erpnext',1)), 1, 'B claims B''s own send');

-- 2. a company result: one external reference, applied, idempotent.
select public.record_connect_send_result('a4520000-0000-0000-0000-000000000001', (select id from ids where kind='party'), 'Supplier:SUP-1', null);
reset role;
select is((select count(*)::int from external_refs where org_id='a4520000-0000-0000-0000-000000000001' and domain='companies' and pmo_record_id='a4520000-0000-0000-0000-0000000000d1' and external_record_id='Supplier:SUP-1'), 1, 'AC-ECA-010 a sent company has exactly one external reference');
select is((select state from erp_connect_proposals where id=(select id from ids where kind='party')), 'applied', 'AC-ECA-010 the company proposal is applied');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.record_connect_send_result('a4520000-0000-0000-0000-000000000001', (select id from ids where kind='party'), 'Supplier:SUP-1', null);
reset role;
select is((select count(*)::int from external_refs where org_id='a4520000-0000-0000-0000-000000000001' and domain='companies' and pmo_record_id='a4520000-0000-0000-0000-0000000000d1'), 1, 'a repeated result writes no second reference');
select is((select state from erp_connect_proposals where id=(select id from ids where kind='party')), 'applied', 'a repeated result leaves the proposal applied');
-- the outbox already wrote the same reference: reconciled, not a rejection
update erp_connect_proposals set state = 'sending', outcome = 'send' where id = (select id from ids where kind='party');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.record_connect_send_result('a4520000-0000-0000-0000-000000000001', (select id from ids where kind='party'), 'Supplier:SUP-1', null);
reset role;
select is((select state from erp_connect_proposals where id=(select id from ids where kind='party')), 'applied', 'a reference the outbox already wrote with the same ERP id is reconciled');

-- 3. project and item results land in the binding's maps; an item keyed by its own name needs no entry.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.record_connect_send_result('a4520000-0000-0000-0000-000000000001', (select id from ids where kind='project'), 'PROJ-0001', null);
select public.record_connect_send_result('a4520000-0000-0000-0000-000000000001', (select id from ids where pmo='Semen 50 kg'), 'Semen 50 kg', null);
reset role;
select is((select config->'project_map'->>'a4520000-0000-0000-0000-0000000000f2' from external_org_bindings where org_id='a4520000-0000-0000-0000-000000000001'), 'PROJ-0001', 'a sent project is linked in project_map');
select is((select config->'item_map' from external_org_bindings where org_id='a4520000-0000-0000-0000-000000000001'), null, 'an item whose ERP code equals the line name writes nothing to item_map');
select is((select count(*)::int from external_refs where org_id='a4520000-0000-0000-0000-000000000001' and domain in ('projects','items')), 0, 'one link store per kind: no project or item reference row');
select is((select state from erp_connect_proposals where id=(select id from ids where pmo='Semen 50 kg')), 'applied', 'the item proposal is applied');
update erp_connect_proposals set state = 'sending' where id = (select id from ids where pmo='Pasir');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.record_connect_send_result('a4520000-0000-0000-0000-000000000001', (select id from ids where pmo='Pasir'), 'ITM-0007', null);
reset role;
select is((select config->'item_map'->>'Pasir' from external_org_bindings where org_id='a4520000-0000-0000-0000-000000000001'), 'ITM-0007', 'an item the ERP keyed differently is mapped line name to ERP code');

-- 4. a rejected send is a review row with the reason; the others are untouched. A held send says it could not be confirmed.
update erp_connect_proposals set state = 'sending', outcome = 'send', reason = null, reason_text = null where id = (select id from ids where pmo='Pasir');
update external_org_bindings set config = config - 'item_map' where org_id='a4520000-0000-0000-0000-000000000001';
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.record_connect_send_result('a4520000-0000-0000-0000-000000000001', (select id from ids where pmo='Pasir'), null, 'The ERP refused this item: the unit is missing');
select public.record_connect_send_held('a4520000-0000-0000-0000-000000000001', (select id from ids where kind='project'));
reset role;
select is((select state from erp_connect_proposals where id=(select id from ids where kind='project')), 'applied', 'a held call on an already applied send changes nothing');
update erp_connect_proposals set state = 'sending', outcome = 'send' where id = (select id from ids where kind='project');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.record_connect_send_held('a4520000-0000-0000-0000-000000000001', (select id from ids where kind='project'));
reset role;
select results_eq($$select outcome, reason, reason_text, state, run_id is null from erp_connect_proposals where id=(select id from ids where pmo='Pasir')$$,
  $$values ('review'::text, 'rejected'::text, 'The ERP refused this item: the unit is missing'::text, 'open'::text, true)$$,
  'AC-ECA-012 a rejection is an open review row, reason rejected, with the ERP''s words');
select results_eq($$select outcome, reason, reason_text, state, run_id is null from erp_connect_proposals where id=(select id from ids where kind='project')$$,
  $$values ('review'::text, 'held'::text, 'We could not confirm whether the ERP created this record'::text, 'open'::text, true)$$,
  'NFR-ECA-004 a held send is an open review row that says the ERP could not confirm it');
select is((select state from erp_connect_proposals where id=(select id from ids where kind='party')), 'applied', 'AC-ECA-012 the other sends are unaffected');
select is((select state from erp_connect_proposals where id=(select id from ids where pmo='Semen 50 kg')), 'applied', 'AC-ECA-012 the other item is unaffected');
select is((select count(*)::int from erp_connect_proposals where kind='project' and pmo_ids[1]='a4520000-0000-0000-0000-0000000000f2' and outcome='send'), 0, 'the review row replaced the send row (the matcher cannot re-offer it under the same identity)');

-- 5. no account or tax table was written by any of the above.
select is((select count(*)::int from budget_category_account_map where org_id='a4520000-0000-0000-0000-000000000001'), 0, 'AC-ECA-010 no account mapping was written by a send');

-- tenancy: B's send is out of reach of A's calls
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select public.record_connect_send_result('a4520000-0000-0000-0000-000000000001','a4520000-0000-0000-0000-0000000000b9','Supplier:X',null)$$, 'P0002', null, 'a result for another organisation''s proposal is refused');
select throws_ok($$select public.record_connect_send_held('a4520000-0000-0000-0000-000000000001','a4520000-0000-0000-0000-0000000000b9')$$, 'P0002', null, 'a hold for another organisation''s proposal is refused');
reset role;
select is((select state from erp_connect_proposals where id='a4520000-0000-0000-0000-0000000000b9'), 'sending', 'B''s send is still waiting');
select is((select count(*)::int from external_refs where org_id='a4520000-0000-0000-0000-000000000002'), 0, 'nothing was linked in B');

-- the run completes once the last send is settled
select is((select finished_at is null from erp_connect_runs where id = current_setting('a452.run')::uuid), true, 'premise: the run has not finished (it is not ready)');
update erp_connect_runs set state = 'ready' where id = current_setting('a452.run')::uuid;
update erp_connect_proposals set state = 'sending', outcome = 'send' where id = (select id from ids where pmo='Pasir');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.record_connect_send_result('a4520000-0000-0000-0000-000000000001', (select id from ids where pmo='Pasir'), 'ITM-0007', null);
reset role;
select is((select finished_at is not null from erp_connect_runs where id = current_setting('a452.run')::uuid), true, 'settling the last waiting send completes the run');

-- 7. the money outbox carries a send in each of the four domains end to end: claim, commit, one fenced reference write, confirm.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
  select 'a4520000-0000-0000-0000-000000000001', d, 'rec-' || d, 'seed:' || k || ':rec-' || d, 'erpnext', 'create', 'pending'
    from (values ('companies','party'),('projects','project'),('items','item'),('employees','employee')) v(d, k);
select is((select count(*)::int from external_command_outbox o, lateral public.claim_outbox_for_commit(o.id) c
            where o.idempotency_key like 'seed:%' and c.state = 'committing'), 4, 'the outbox claims a send in each of the four domains');
update external_command_outbox set state = 'committed', external_record_id = 'EXT-' || domain where idempotency_key like 'seed:%';
select is((select sum(public.record_outbox_ref(o.id, o.claim_generation, o.domain, o.pmo_record_id, 'erpnext', o.external_record_id))::int
             from external_command_outbox o where o.idempotency_key like 'seed:%'), 4, 'a fenced reference write is accepted for each send domain');
select is((select sum(public.confirm_outbox(o.id, o.claim_generation))::int from external_command_outbox o where o.idempotency_key like 'seed:%'), 4, 'each send confirms');
select is((select count(*)::int from external_command_outbox where idempotency_key like 'seed:%' and state = 'confirmed'), 4, 'all four sends are confirmed');
reset role;

-- 6. grants: service role only.
select is((has_function_privilege('authenticated', 'public.claim_connect_sends(uuid,text,int)', 'execute')
        or has_function_privilege('authenticated', 'public.record_connect_send_result(uuid,uuid,text,text)', 'execute')
        or has_function_privilege('authenticated', 'public.record_connect_send_held(uuid,uuid)', 'execute')
        or has_function_privilege('anon', 'public.claim_connect_sends(uuid,text,int)', 'execute')
        or has_function_privilege('anon', 'public.record_connect_send_result(uuid,uuid,text,text)', 'execute')
        or has_function_privilege('anon', 'public.record_connect_send_held(uuid,uuid)', 'execute')), false, 'the send functions are not callable by a client role');
select is((has_function_privilege('service_role', 'public.claim_connect_sends(uuid,text,int)', 'execute')
       and has_function_privilege('service_role', 'public.record_connect_send_result(uuid,uuid,text,text)', 'execute')
       and has_function_privilege('service_role', 'public.record_connect_send_held(uuid,uuid)', 'execute')), true, 'the send functions are service-role callable');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a4520000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.claim_connect_sends('a4520000-0000-0000-0000-000000000001','erpnext',10)$$, '42501', null, 'an Admin on a user JWT cannot claim sends');
select throws_ok($$select public.record_connect_send_result('a4520000-0000-0000-0000-000000000001', gen_random_uuid(), 'x', null)$$, '42501', null, 'an Admin on a user JWT cannot record a result');
reset role;

-- a connection that is not activated leases nothing
update external_org_bindings set activated_at = null where org_id = 'a4520000-0000-0000-0000-000000000002';
update erp_connect_proposals set send_claimed_at = null where id = 'a4520000-0000-0000-0000-0000000000b9';
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is((select count(*)::int from public.claim_connect_sends('a4520000-0000-0000-0000-000000000002','erpnext',10)), 0, 'nothing is sent for a connection that is not activated');
reset role;

select * from finish();
rollback;
