-- ECA-3 (#1606, migration 0482): the send drain's three service-only functions.
-- AC-ECA-010 (DB half: one external reference per sent company, nothing written to accounts or taxes) and AC-ECA-012 (DB half:
-- a rejected send becomes a review row with a plain reason and leaves the others alone), NFR-ECA-004 (a held send says so).
begin;
select plan(78);

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
  $$values ('review'::text, 'held'::text, 'We could not confirm whether the ERP created this record. Look for it in the ERP by name and tax id; if it is not there, send it again.'::text, 'open'::text, true)$$,
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

-- 8. C1: a record that is already linked is never re-pointed, and a clash ends as a decision (I1), never a loop.
insert into auth.users (id, email) values ('a4520000-0000-0000-0000-0000000000a2','a452-pm@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('a4520000-0000-0000-0000-0000000000a2','a4520000-0000-0000-0000-000000000001','Manager','a452-pm@example.com','Project Manager','active');
insert into companies (id, org_id, name, type) values
 ('a4520000-0000-0000-0000-0000000000d2','a4520000-0000-0000-0000-000000000001','Linked Co','Vendor'),
 ('a4520000-0000-0000-0000-0000000000d3','a4520000-0000-0000-0000-000000000001','Same Name','Vendor'),
 ('a4520000-0000-0000-0000-0000000000d4','a4520000-0000-0000-0000-000000000001','Same Name','Vendor');
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values
 ('a4520000-0000-0000-0000-000000000001','companies','a4520000-0000-0000-0000-0000000000d2','erpnext','Supplier:ACME-OLD');
insert into erp_connect_proposals (id, org_id, binding_id, external_tier, kind, outcome, state, identity, pmo_ids, decided_by) values
 ('a4520000-0000-0000-0000-0000000000c2','a4520000-0000-0000-0000-000000000001',(select id from external_org_bindings where org_id='a4520000-0000-0000-0000-000000000001'),'erpnext','party','send','sending','send|["d2"]|[]','{a4520000-0000-0000-0000-0000000000d2}','a4520000-0000-0000-0000-0000000000a1'),
 ('a4520000-0000-0000-0000-0000000000c3','a4520000-0000-0000-0000-000000000001',(select id from external_org_bindings where org_id='a4520000-0000-0000-0000-000000000001'),'erpnext','party','send','sending','send|["d3"]|[]','{a4520000-0000-0000-0000-0000000000d3}','a4520000-0000-0000-0000-0000000000a1'),
 ('a4520000-0000-0000-0000-0000000000c4','a4520000-0000-0000-0000-000000000001',(select id from external_org_bindings where org_id='a4520000-0000-0000-0000-000000000001'),'erpnext','party','send','sending','send|["d4"]|[]','{a4520000-0000-0000-0000-0000000000d4}','a4520000-0000-0000-0000-0000000000a1');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.connect_send_existing_link('a4520000-0000-0000-0000-000000000001','erpnext','party','a4520000-0000-0000-0000-0000000000d2'), 'Supplier:ACME-OLD', 'C1 an already linked company reports its link');
select is(public.connect_send_existing_link('a4520000-0000-0000-0000-000000000001','erpnext','party','a4520000-0000-0000-0000-0000000000d3'), null, 'C1 an unlinked company reports none');
select is(public.connect_send_existing_link('a4520000-0000-0000-0000-000000000001','erpnext','project','a4520000-0000-0000-0000-0000000000f2'), 'PROJ-0001', 'C1 a mapped project reports its link');
select is(public.connect_send_existing_link('a4520000-0000-0000-0000-000000000002','erpnext','party','a4520000-0000-0000-0000-0000000000d2'), null, 'C1 the link read is scoped to the caller''s organisation');
select public.record_connect_send_result('a4520000-0000-0000-0000-000000000001','a4520000-0000-0000-0000-0000000000c2','Supplier:ACME-NEW',null);
reset role;
select is((select external_record_id from external_refs where org_id='a4520000-0000-0000-0000-000000000001' and domain='companies' and pmo_record_id='a4520000-0000-0000-0000-0000000000d2'), 'Supplier:ACME-OLD', 'C1 a result for a linked company never re-points its link');
select results_eq($$select outcome, state, reason, reason_text from erp_connect_proposals where id='a4520000-0000-0000-0000-0000000000c2'$$,
  $$values ('review'::text, 'open'::text, 'rejected'::text, 'This record is already linked to another ERP record'::text)$$, 'C1 the clash is an open decision in plain words');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.record_connect_send_result('a4520000-0000-0000-0000-000000000001','a4520000-0000-0000-0000-0000000000c3','Supplier:SUP-2',null);
select public.record_connect_send_result('a4520000-0000-0000-0000-000000000001','a4520000-0000-0000-0000-0000000000c4','Supplier:SUP-2',null);
reset role;
select is((select state from erp_connect_proposals where id='a4520000-0000-0000-0000-0000000000c3'), 'applied', 'I1 the first same-name vendor is linked');
select results_eq($$select outcome, state, reason_text from erp_connect_proposals where id='a4520000-0000-0000-0000-0000000000c4'$$,
  $$values ('review'::text, 'open'::text, 'This record is already linked to another ERP record'::text)$$, 'I1 the second same-name vendor ends as a decision, not a retry loop');
select is((select count(*)::int from external_refs where org_id='a4520000-0000-0000-0000-000000000001' and domain='companies' and external_record_id='Supplier:SUP-2'), 1, 'I1 one ERP supplier, one link');
select is((select count(*)::int from erp_connect_proposals where org_id='a4520000-0000-0000-0000-000000000001' and kind='party' and state='sending'), 0, 'I1 no party send is left waiting');

-- I1: trouble nobody can classify ends the send on the fifth tick.
insert into erp_connect_proposals (id, org_id, binding_id, external_tier, kind, outcome, state, identity, pmo_ids, decided_by) values
 ('a4520000-0000-0000-0000-0000000000c5','a4520000-0000-0000-0000-000000000001',(select id from external_org_bindings where org_id='a4520000-0000-0000-0000-000000000001'),'erpnext','party','send','sending','send|["d5"]|[]','{a4520000-0000-0000-0000-0000000000d5}','a4520000-0000-0000-0000-0000000000a1');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is((select array_agg(public.record_connect_send_failure('a4520000-0000-0000-0000-000000000001','a4520000-0000-0000-0000-0000000000c5')) from generate_series(1,5)), array[false,false,false,false,true], 'I1 four unclassified failures retry, the fifth ends the send');
reset role;
select results_eq($$select outcome, state, reason_text from erp_connect_proposals where id='a4520000-0000-0000-0000-0000000000c5'$$,
  $$values ('review'::text, 'open'::text, 'We could not finish sending this record. Check it in the ERP, then try again.'::text)$$, 'I1 the ended send is a decision in plain words');

-- 9. I2: a held send has a way out for an Admin only; the hold is released and the send waits for the drain again.
insert into projects (id, org_id, name, status) values ('a4520000-0000-0000-0000-0000000000f3','a4520000-0000-0000-0000-000000000001','P3','Ongoing Project');
insert into external_command_outbox (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, claim_generation) values
 ('a4520000-0000-0000-0000-0000000000e3','a4520000-0000-0000-0000-000000000001','projects','a4520000-0000-0000-0000-0000000000f3','seed:project:a4520000-0000-0000-0000-0000000000f3','erpnext','create','held',1);
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.record_connect_record_held('a4520000-0000-0000-0000-000000000001','erpnext','project','a4520000-0000-0000-0000-0000000000f3','P3');
select public.record_connect_record_held('a4520000-0000-0000-0000-000000000001','erpnext','project','a4520000-0000-0000-0000-0000000000f3','P3');
reset role;
select results_eq($$select count(*)::int, min(reason), min(state), min(snapshot->>'name') from erp_connect_proposals where kind='project' and pmo_ids[1]='a4520000-0000-0000-0000-0000000000f3'$$,
  $$values (1, 'held'::text, 'open'::text, 'P3'::text)$$, 'I2 a project the outbox held leaves one open decision row, however often it is recorded');
create temp table held as select id from erp_connect_proposals where kind='project' and pmo_ids[1]='a4520000-0000-0000-0000-0000000000f3';
grant select on held to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a4520000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$select public.retry_connect_send((select id from held))$$, '42501', null, 'I2 a Project Manager cannot send a held record again');
select set_config('request.jwt.claims', '{"sub":"a4520000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select throws_ok($$select public.retry_connect_send('a4520000-0000-0000-0000-0000000000c3')$$, 'P0002', null, 'I2 only a held send can be sent again');
select lives_ok($$select public.retry_connect_send((select id from held))$$, 'I2 an Admin sends a held record again');
reset role;
select results_eq($$select outcome, state, reason, reason_text, send_claimed_at is null from erp_connect_proposals where id=(select id from held)$$,
  $$values ('send'::text, 'sending'::text, null::text, null::text, true)$$, 'I2 the proposal waits for the drain again');
select is((select state from external_command_outbox where id='a4520000-0000-0000-0000-0000000000e3'), 'failed', 'I2 the outbox hold is released (the drain looks the record up before it creates anything)');
select is((select count(*)::int from audit_events where action='integration.connect_send_retry' and org_id='a4520000-0000-0000-0000-000000000001'), 1, 'I2 the retry is audited');

-- 10. I6: a disconnect takes the waiting sends and the outbox rows that never reached an ERP; a row that did is held, never deleted.
insert into organizations (id, name) values ('a4520000-0000-0000-0000-000000000003','Sends C');
insert into external_org_bindings (id, org_id, external_tier, site_url, secret_ref, status, config, activated_at) values
 ('a4520000-0000-0000-0000-0000000000bc','a4520000-0000-0000-0000-000000000003','erpnext','https://erp-c.example.test','a452_c','active','{"company":"Example C"}', now());
insert into erp_connect_proposals (id, org_id, binding_id, external_tier, kind, outcome, state, identity, pmo_ids) values
 ('a4520000-0000-0000-0000-0000000000cc','a4520000-0000-0000-0000-000000000003','a4520000-0000-0000-0000-0000000000bc','erpnext','party','send','sending','send|["c"]|[]','{a4520000-0000-0000-0000-0000000000dc}');
insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
  select 'a4520000-0000-0000-0000-000000000003', 'companies', 'rec-' || st, 'seed:party:rec-' || st, 'erpnext', 'create', st
    from unnest(array['pending','failed','committing','quarantined','committed','confirmed']) st;
insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state) values
 ('a4520000-0000-0000-0000-000000000003', 'companies', 'rec-plain', 'plain-key', 'erpnext', 'create', 'pending');
update external_org_bindings set status = 'disconnected' where id = 'a4520000-0000-0000-0000-0000000000bc';
select is((select count(*)::int from erp_connect_proposals where org_id='a4520000-0000-0000-0000-000000000003'), 0, 'I6 a disconnect takes the waiting sends with it');
select is((select array_agg(replace(pmo_record_id, 'rec-', '') order by pmo_record_id) from external_command_outbox where org_id='a4520000-0000-0000-0000-000000000003' and idempotency_key like 'seed:%' and state <> 'held'), array['confirmed'], 'I6 seed rows that never reached an ERP are gone and a confirmed row stays');
select is((select array_agg(replace(pmo_record_id, 'rec-', '') order by pmo_record_id) from external_command_outbox where org_id='a4520000-0000-0000-0000-000000000003' and state = 'held'), array['committed','committing','quarantined'], 'I6 a row that may have reached the ERP is held, never deleted');
select is((select state from external_command_outbox where idempotency_key = 'plain-key'), 'pending', 'I6 an outbox row that is not a connect send is untouched');
select is((select count(*)::int from external_command_outbox where org_id='a4520000-0000-0000-0000-000000000001' and idempotency_key like 'seed:%'), 5, 'I6 another organisation''s outbox rows are untouched');

-- 11. T12 (FR-ECA-016, PD-ECA-15): after an item bulk accept, a new item name on an open purchase is queued as an automatic send, once.
insert into organizations (id, name) values ('a4520000-0000-0000-0000-000000000004','Sends D');
insert into external_org_bindings (id, org_id, external_tier, site_url, secret_ref, status, config, activated_at) values
 ('a4520000-0000-0000-0000-0000000000bd','a4520000-0000-0000-0000-000000000004','erpnext','https://erp-d.example.test','a452_d','active',
  '{"company":"Example D","item_map":{"Semen":"ITM-SEMEN"}}', now());
insert into erp_connect_census (org_id, binding_id, external_tier, kind, pmo_count, erp_count, scenario) values
 ('a4520000-0000-0000-0000-000000000004','a4520000-0000-0000-0000-0000000000bd','erpnext','item',4,0,'S-C');
insert into procurements (id, org_id, title, status) values
 ('a4520000-0000-0000-0000-0000000000e1','a4520000-0000-0000-0000-000000000004','Open case','Draft'),
 ('a4520000-0000-0000-0000-0000000000e2','a4520000-0000-0000-0000-000000000004','Second open case','Draft'),
 ('a4520000-0000-0000-0000-0000000000e3','a4520000-0000-0000-0000-000000000004','Paid case','Paid'),
 ('a4520000-0000-0000-0000-0000000000e4','a4520000-0000-0000-0000-000000000004','Cancelled case','Cancelled');
insert into procurement_items (org_id, procurement_id, name, quantity, rate) values
 ('a4520000-0000-0000-0000-000000000004','a4520000-0000-0000-0000-0000000000e1','Kabel 10 mm',1,1),
 ('a4520000-0000-0000-0000-000000000004','a4520000-0000-0000-0000-0000000000e2','Kabel 10 mm',2,1),
 ('a4520000-0000-0000-0000-000000000004','a4520000-0000-0000-0000-0000000000e1','Semen',1,1),
 ('a4520000-0000-0000-0000-000000000004','a4520000-0000-0000-0000-0000000000e1','Besi',1,1),
 ('a4520000-0000-0000-0000-000000000004','a4520000-0000-0000-0000-0000000000e3','Cat',1,1),
 ('a4520000-0000-0000-0000-000000000004','a4520000-0000-0000-0000-0000000000e4','Pipa',1,1);
-- "Besi" already has a decision waiting (two ERP items match it): the sweep never decides it
insert into erp_connect_proposals (org_id, binding_id, external_tier, kind, outcome, state, identity, pmo_ids)
  values ('a4520000-0000-0000-0000-000000000004','a4520000-0000-0000-0000-0000000000bd','erpnext','item','review','open','review|["Besi"]|["ITM-B1","ITM-B2"]','{Besi}');
-- another organisation's open item under an accepted census: never reached by D's call
insert into procurements (id, org_id, title, status) values ('a4520000-0000-0000-0000-0000000000e9','a4520000-0000-0000-0000-000000000002','B case','Draft');
insert into procurement_items (org_id, procurement_id, name, quantity, rate) values ('a4520000-0000-0000-0000-000000000002','a4520000-0000-0000-0000-0000000000e9','B item',1,1);
insert into erp_connect_census (org_id, binding_id, external_tier, kind, pmo_count, erp_count, scenario, accepted_at)
  select org_id, id, 'erpnext', 'item', 1, 0, 'S-C', now() from external_org_bindings where org_id = 'a4520000-0000-0000-0000-000000000002';

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.enqueue_new_item_sends('a4520000-0000-0000-0000-000000000004','erpnext'), 0, 'FR-ECA-016 before the first item accept nothing is queued');
reset role;
update erp_connect_census set accepted_at = now() where org_id = 'a4520000-0000-0000-0000-000000000004' and kind = 'item';
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.enqueue_new_item_sends('a4520000-0000-0000-0000-000000000004','erpnext'), 1, 'FR-ECA-016 after the accept one new open-purchase item is queued');
reset role;
select results_eq($$select kind, outcome, state, pmo_ids, decided_by is null, snapshot->>'auto', binding_id, run_id is null from erp_connect_proposals
                     where org_id = 'a4520000-0000-0000-0000-000000000004' and state = 'sending'$$,
  $$values ('item'::text, 'send'::text, 'sending'::text, array['Kabel 10 mm']::text[], true, 'true'::text, 'a4520000-0000-0000-0000-0000000000bd'::uuid, true)$$,
  'FR-ECA-016 the queued send is an automatic one for the distinct name, on this connection, with no deciding person');
select is((select count(*)::int from erp_connect_proposals where org_id = 'a4520000-0000-0000-0000-000000000004'), 2, 'only the new name was queued: the linked, the decided, the Paid and the Cancelled items were skipped');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.enqueue_new_item_sends('a4520000-0000-0000-0000-000000000004','erpnext'), 0, 'FR-ECA-016 a second call queues nothing');
reset role;
select is((select count(*)::int from erp_connect_proposals where org_id = 'a4520000-0000-0000-0000-000000000004' and state = 'sending'), 1, 'exactly one send per item name');
-- once sent (or dismissed or rejected) the name is never queued again
update erp_connect_proposals set state = 'applied' where org_id = 'a4520000-0000-0000-0000-000000000004' and state = 'sending';
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.enqueue_new_item_sends('a4520000-0000-0000-0000-000000000004','erpnext'), 0, 'a sent item is not queued again');
-- a name that arrives later is picked up
reset role;
insert into procurement_items (org_id, procurement_id, name, quantity, rate) values ('a4520000-0000-0000-0000-000000000004','a4520000-0000-0000-0000-0000000000e2','Kawat',1,1);
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.enqueue_new_item_sends('a4520000-0000-0000-0000-000000000004','erpnext'), 1, 'a later new item is queued by a later call');
reset role;
update external_org_bindings set activated_at = now() where org_id = 'a4520000-0000-0000-0000-000000000002';
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.enqueue_new_item_sends('a4520000-0000-0000-0000-000000000002','erpnext'), 1, 'organisation B is served by its own call');
select is(public.enqueue_new_item_sends('a4520000-0000-0000-0000-000000000004','erpnext'), 0, 'and D''s call did not queue B''s item (nor the reverse)');
reset role;
select is((select count(*)::int from erp_connect_proposals where org_id = 'a4520000-0000-0000-0000-000000000004' and pmo_ids = '{B item}'), 0, 'tenancy: B''s item name never lands in D');
-- a connection that is not activated, or was disconnected, queues nothing
insert into procurement_items (org_id, procurement_id, name, quantity, rate) values ('a4520000-0000-0000-0000-000000000004','a4520000-0000-0000-0000-0000000000e2','Baut',1,1);
update external_org_bindings set activated_at = null where id = 'a4520000-0000-0000-0000-0000000000bd';
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.enqueue_new_item_sends('a4520000-0000-0000-0000-000000000004','erpnext'), 0, 'a connection that is not activated queues nothing');
reset role;
update external_org_bindings set activated_at = now(), status = 'disconnected' where id = 'a4520000-0000-0000-0000-0000000000bd';
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.enqueue_new_item_sends('a4520000-0000-0000-0000-000000000004','erpnext'), 0, 'a disconnected connection queues nothing');
reset role;
select is((has_function_privilege('authenticated', 'public.enqueue_new_item_sends(uuid,text)', 'execute') or has_function_privilege('anon', 'public.enqueue_new_item_sends(uuid,text)', 'execute')), false, 'enqueue_new_item_sends is not callable by a client role');
select is(has_function_privilege('service_role', 'public.enqueue_new_item_sends(uuid,text)', 'execute'), true, 'enqueue_new_item_sends is service-role callable');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a4520000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.enqueue_new_item_sends('a4520000-0000-0000-0000-000000000004','erpnext')$$, '42501', null, 'an Admin on a user JWT cannot queue sends');
reset role;

select * from finish();
rollback;
