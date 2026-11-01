-- ECA-2 (#1605, migration 0480): census, match proposals and one-pass accept. Tier-keyed, shared by every ERP.
-- AC-ECA-004 here is sequential in one session (two accepts, then a pre-written ref race); the concurrent claim rests on
-- FOR UPDATE re-checking state='open' after the lock wait plus the external_refs reverse-unique claim (AC-ECA-004 traceability note).
-- AC-ECA-004 (exactly-once apply), AC-ECA-007 (audited, undoable while unused), plus the role / tenancy / grant contract.
begin;
select plan(106);

insert into organizations (id, name) values
 ('a4510000-0000-0000-0000-000000000001','Connect A'),
 ('a4510000-0000-0000-0000-000000000002','Connect B');
insert into auth.users (id, email) values
 ('a4510000-0000-0000-0000-0000000000a1','a451-admin@example.com'),
 ('a4510000-0000-0000-0000-0000000000f1','a451-finance@example.com'),
 ('a4510000-0000-0000-0000-0000000000e1','a451-eng@example.com'),
 ('a4510000-0000-0000-0000-0000000000b1','a451-b-admin@example.com'),
 ('a4510000-0000-0000-0000-0000000000c1','a451-u1@example.com'),
 ('a4510000-0000-0000-0000-0000000000c2','a451-u2@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('a4510000-0000-0000-0000-0000000000a1','a4510000-0000-0000-0000-000000000001','Admin','a451-admin@example.com','Admin','active'),
 ('a4510000-0000-0000-0000-0000000000f1','a4510000-0000-0000-0000-000000000001','Finance','a451-finance@example.com','Finance','active'),
 ('a4510000-0000-0000-0000-0000000000e1','a4510000-0000-0000-0000-000000000001','Engineer','a451-eng@example.com','Engineer','active'),
 ('a4510000-0000-0000-0000-0000000000b1','a4510000-0000-0000-0000-000000000002','B Admin','a451-b-admin@example.com','Admin','active'),
 ('a4510000-0000-0000-0000-0000000000c1','a4510000-0000-0000-0000-000000000001','Person One','a451-u1@example.com','Engineer','active'),
 ('a4510000-0000-0000-0000-0000000000c2','a4510000-0000-0000-0000-000000000001','Person Two','a451-u2@example.com','Engineer','active');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at) values
 ('a4510000-0000-0000-0000-000000000001','erpnext','https://erp.example.test','a451_a','active','{"company":"Example Co"}', now());
insert into companies (id, org_id, name, type) values
 ('a4510000-0000-0000-0000-0000000000d1','a4510000-0000-0000-0000-000000000001','Acme','Vendor'),
 ('a4510000-0000-0000-0000-0000000000d2','a4510000-0000-0000-0000-000000000001','Cliente','Client'),
 ('a4510000-0000-0000-0000-0000000000d9','a4510000-0000-0000-0000-000000000002','B Co','Vendor');
insert into projects (id, org_id, name, status) values
 ('a4510000-0000-0000-0000-0000000000f2','a4510000-0000-0000-0000-000000000001','Connect Project','Ongoing Project');
insert into erp_employees (org_id, employee_number, employee_name, work_email, link_state) values
 ('a4510000-0000-0000-0000-000000000001','HR-EMP-1','Person One','a451-u1@example.com','unlinked');

-- A run and its proposals, written the way the edge function writes them: the service role, one kind per call.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select set_config('a451.run', public.start_connect_run('a4510000-0000-0000-0000-000000000001','erpnext','a4510000-0000-0000-0000-0000000000a1')::text, true);
select is(public.start_connect_run('a4510000-0000-0000-0000-000000000001','erpnext',null), current_setting('a451.run')::uuid,
  'a second start while one run is open returns the open run');
select throws_ok($$select public.start_connect_run('a4510000-0000-0000-0000-000000000002','erpnext',null)$$, 'P0001', null,
  'a run needs an active binding for the tier');
select public.write_connect_census('a4510000-0000-0000-0000-000000000001','erpnext','[
  {"kind":"party","pmoCount":2,"erpCount":3,"scenario":"S-D"},
  {"kind":"employee","pmoCount":2,"erpCount":1,"scenario":"S-D"},
  {"kind":"account","pmoCount":1,"erpCount":1,"scenario":"S-D"},
  {"kind":"timesheet","pmoCount":0,"erpCount":null,"scenario":null}]'::jsonb);
select public.replace_connect_proposals('a4510000-0000-0000-0000-000000000001','erpnext',current_setting('a451.run')::uuid,'party','[
  {"outcome":"link","pmoIds":["a4510000-0000-0000-0000-0000000000d1"],"externalIds":["Supplier:ACME"],"key":"name","snapshot":{"taxId":"01.234"}},
  {"outcome":"link","pmoIds":["a4510000-0000-0000-0000-0000000000d2"],"externalIds":["Customer:CLI"],"key":"name","snapshot":{}},
  {"outcome":"bring-in","pmoIds":[],"externalIds":["Supplier:NEW"],"snapshot":{"name":"New Co","taxId":"9","role":"vendor"}},
  {"outcome":"review","pmoIds":["x1","x2"],"externalIds":["Supplier:DUP"],"reason":"ambiguous","reasonText":"Two PMO companies share this name."}]'::jsonb, true);
select public.replace_connect_proposals('a4510000-0000-0000-0000-000000000001','erpnext',current_setting('a451.run')::uuid,'employee','[
  {"outcome":"link","pmoIds":["a4510000-0000-0000-0000-0000000000c1"],"externalIds":["HR-EMP-1"],"key":"code","snapshot":{"code":"a451-u1@example.com"}},
  {"outcome":"link","pmoIds":["a4510000-0000-0000-0000-0000000000c2"],"externalIds":["HR-EMP-404"],"key":"code","snapshot":{"code":"a451-u2@example.com"}}]'::jsonb, true);
select public.replace_connect_proposals('a4510000-0000-0000-0000-000000000001','erpnext',current_setting('a451.run')::uuid,'account','[
  {"outcome":"link","pmoIds":["Labor"],"externalIds":["5100 - Labor"],"key":"code","snapshot":{"code":"Labor"}}]'::jsonb, true);
reset role;
set local request.jwt.claims = '{}';

-- 9. the census row counts the kind's link rows.
select is((select linked_count from erp_connect_census where org_id='a4510000-0000-0000-0000-000000000001' and kind='party'), 2,
  'AC-ECA-004 replace_connect_proposals sets the census linked_count to the number of link rows');
select is((select count(*)::int from erp_connect_proposals where org_id='a4510000-0000-0000-0000-000000000001'), 7,
  'AC-ECA-004 the run wrote seven proposal rows');
select is((select state from erp_connect_runs where id = current_setting('a451.run')::uuid), 'staging', 'the run is not ready while kinds are missing');
select is((select accepted_at from erp_connect_census where kind='party' and org_id='a4510000-0000-0000-0000-000000000001'), null,
  'nothing is accepted yet');

-- 7. RLS and grants.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a4510000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select is((select count(*)::int from erp_connect_proposals), 0, 'AC-ECA-007 an Engineer reads no proposal rows');
select is((select count(*)::int from erp_connect_census), 0, 'AC-ECA-007 an Engineer reads no census rows');
select throws_ok($$select public.accept_connect_proposals('erpnext')$$, '42501', null, 'AC-ECA-007 an Engineer cannot accept');
select throws_ok($$select public.decide_connect_review(gen_random_uuid(), '{"action":"dismiss"}')$$, '42501', null, 'AC-ECA-007 an Engineer cannot decide a review');
select throws_ok($$select public.unlink_connect_match(gen_random_uuid())$$, '42501', null, 'AC-ECA-007 an Engineer cannot unlink');
set local request.jwt.claims = '{"sub":"a4510000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select results_eq($$select distinct kind from erp_connect_proposals$$, $$values ('account'::text)$$, 'AC-ECA-007 Finance reads account rows only');
select throws_ok($$select public.accept_connect_proposals('erpnext','party')$$, '42501', null, 'AC-ECA-007 Finance cannot accept parties');
set local request.jwt.claims = '{"sub":"a4510000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from erp_connect_proposals) + (select count(*)::int from erp_connect_runs) + (select count(*)::int from erp_connect_census), 0,
  'AC-ECA-007 another organisation''s Admin reads nothing of A');
select throws_ok($$select public.accept_connect_proposals('erpnext')$$, 'P0001', 'no active connection for this ERP', 'AC-ECA-007 B''s Admin has no connection, so accept reaches none of A''s rows');
set local request.jwt.claims = '{"sub":"a4510000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$insert into erp_connect_proposals (org_id, external_tier, kind, outcome, identity) values ('a4510000-0000-0000-0000-000000000001','erpnext','party','link','z')$$,
  '42501', null, 'AC-ECA-007 even an Admin cannot insert a proposal');
select throws_ok($$update erp_connect_proposals set state = 'applied'$$, '42501', null, 'AC-ECA-007 even an Admin cannot update a proposal');
select throws_ok($$select count(*) from erp_connect_staged$$, '42501', null, 'AC-ECA-007 nobody on a user JWT can read staged ERP pages');
select throws_ok($$delete from erp_connect_census$$, '42501', null, 'AC-ECA-007 even an Admin cannot delete census rows');
reset role;
select is(has_function_privilege('anon', f, 'execute'), false, 'AC-ECA-007 ' || f || ' is not executable by anon')
  from unnest(array['public.accept_connect_proposals(text,text,uuid[],int)','public.decide_connect_review(uuid,jsonb)','public.unlink_connect_match(uuid)',
    'public.start_connect_run(uuid,text,uuid)','public.write_connect_census(uuid,text,jsonb)','public.replace_connect_proposals(uuid,text,uuid,text,jsonb,boolean)',
    'public.apply_connect_outcome(uuid,text,text,text,text,text,jsonb)']) f;
select is(has_function_privilege('authenticated', f, 'execute'), false, 'AC-ECA-007 ' || f || ' is service-role only')
  from unnest(array['public.start_connect_run(uuid,text,uuid)','public.write_connect_census(uuid,text,jsonb)','public.replace_connect_proposals(uuid,text,uuid,text,jsonb,boolean)',
    'public.apply_connect_outcome(uuid,text,text,text,text,text,jsonb)','public.apply_connect_link(uuid,text,text,text,text,jsonb,uuid)']) f;
select is(bool_and(has_table_privilege('service_role', t, 'select') and has_table_privilege('service_role', t, 'insert')
  and has_table_privilege('service_role', t, 'update') and has_table_privilege('service_role', t, 'delete')), true,
  'AC-ECA-007 service_role has full DML on the four tables')
  from unnest(array['public.erp_connect_runs','public.erp_connect_staged','public.erp_connect_census','public.erp_connect_proposals']) t;

-- 1. + 3. accept the bring-in twice: one company, one ref, one audit row per call, accepted_at stamped.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a4510000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select set_config('a451.first', public.accept_connect_proposals('erpnext','party',
  array[(select id from erp_connect_proposals where outcome='bring-in')])::text, true);
select set_config('a451.second', public.accept_connect_proposals('erpnext','party',
  array[(select id from erp_connect_proposals where outcome='bring-in')])::text, true);
reset role;
select is(current_setting('a451.first')::jsonb -> 'counts', '{"party":{"link":0,"bring_in":1,"send":0,"left_open":0}}'::jsonb, 'AC-ECA-004 the first accept brings one company in');
select is(current_setting('a451.second')::jsonb -> 'counts', '{}'::jsonb, 'AC-ECA-004 the second accept finds nothing open: bring_in = 0');
select is((select count(*)::int from companies where org_id='a4510000-0000-0000-0000-000000000001' and name='New Co'), 1, 'AC-ECA-004 one company named New Co');
select is((select count(*)::int from external_refs where org_id='a4510000-0000-0000-0000-000000000001' and domain='companies' and external_record_id='Supplier:NEW'), 1, 'AC-ECA-004 one reference for Supplier:NEW');
select is((select type::text || '/' || erp_tax_id from companies where name='New Co'), 'Vendor/9', 'AC-ECA-004 the brought-in company carries the ERP type and tax id');
select is((select count(*)::int from audit_events where action='integration.connect_accept' and org_id='a4510000-0000-0000-0000-000000000001'), 1, 'AC-ECA-007 one accept that did something writes one audit row; a no-op writes none');
select is((select detail->'kinds' from audit_events where action='integration.connect_accept' order by created_at, id limit 1),
  '{"party":{"link":0,"bring_in":1,"send":0,"left_open":0}}'::jsonb, 'AC-ECA-007 the audit row names the kind and its counts');
select is((select actor_id from audit_events where action='integration.connect_accept' order by created_at, id limit 1), 'a4510000-0000-0000-0000-0000000000a1'::uuid, 'AC-ECA-007 the audit actor is the Admin');
select isnt((select accepted_at from erp_connect_census where kind='party' and org_id='a4510000-0000-0000-0000-000000000001'), null, 'AC-ECA-007 the first accept stamps the census row (set up once)');

-- 2. a bring-in whose reference the feed already wrote reconciles instead of making a second company.
set local request.jwt.claims = '{}';
insert into erp_connect_proposals (org_id, binding_id, external_tier, kind, outcome, identity, external_ids, snapshot) values
 ('a4510000-0000-0000-0000-000000000001',(select id from external_org_bindings where org_id='a4510000-0000-0000-0000-000000000001'),'erpnext','party','bring-in','race','{Supplier:RACE}','{"name":"Race Co","role":"vendor"}');
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values
 ('a4510000-0000-0000-0000-000000000001','companies','a4510000-0000-0000-0000-0000000000d1','erpnext','Supplier:RACE');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a4510000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select public.accept_connect_proposals('erpnext','party',array[(select id from erp_connect_proposals where identity='race')]);
reset role;
select is((select count(*)::int from companies where name='Race Co'), 0, 'AC-ECA-004 a bring-in the feed already linked adds no company');
select is((select state from erp_connect_proposals where identity='race'), 'applied', 'AC-ECA-004 the raced proposal is marked applied, not an error');
delete from external_refs where external_record_id = 'Supplier:RACE';

-- 6. + 5. + 8. accept everything as the Admin: links, the employee batch (one bad row stays open), reviews untouched.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a4510000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select set_config('a451.all', public.accept_connect_proposals('erpnext')::text, true);
reset role;
select is(current_setting('a451.all')::jsonb #> '{counts,party,link}', '2'::jsonb, 'AC-ECA-004 accept-all applies both party links');
select is(current_setting('a451.all')::jsonb #> '{counts,employee}', '{"link":1,"bring_in":0,"send":0,"left_open":1}'::jsonb, 'AC-ECA-004 one employee row applies, one stays open, neither aborts the other');
select is(current_setting('a451.all')::jsonb #> '{counts,account,link}', '1'::jsonb, 'AC-ECA-004 the account link applies for an Admin');
select is((select link_state || '/' || linked_by::text from erp_employees where employee_number='HR-EMP-1'),
  'confirmed/a4510000-0000-0000-0000-0000000000a1', 'AC-ECA-004 the employee link is confirmed by the accepting Admin');
select is((select reason_text from erp_connect_proposals where kind='employee' and external_ids = '{HR-EMP-404}'),
  'This person has not been read from the ERP yet', 'AC-ECA-004 the unread employee keeps a plain reason');
select is((select state from erp_connect_proposals where kind='employee' and external_ids = '{HR-EMP-404}'), 'open', 'AC-ECA-004 the unread employee row stays open');
select is((select state from erp_connect_proposals where outcome='review'), 'open', 'AC-ECA-004 a review row is untouched by accept-all');
select is((select erp_account from budget_category_account_map where org_id='a4510000-0000-0000-0000-000000000001' and category='Labor'), '5100 - Labor', 'AC-ECA-004 the account map got the link');
select is((select erp_tax_id from companies where id='a4510000-0000-0000-0000-0000000000d1'), '01.234', 'AC-ECA-004 a link fills a missing tax id');

-- A changed work email blocks an email-keyed employee link.
update erp_employees set link_state='unlinked', profile_id=null, linked_by=null, linked_at=null where employee_number='HR-EMP-1';
update erp_employees set work_email='changed@example.com' where employee_number='HR-EMP-1';
update erp_connect_proposals set state='open', reason_text=null where kind='employee' and external_ids='{HR-EMP-1}';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a4510000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select set_config('a451.mail', public.accept_connect_proposals('erpnext','employee',array[(select id from erp_connect_proposals where external_ids='{HR-EMP-1}')])::text, true);
reset role;
select is(current_setting('a451.mail')::jsonb #> '{counts,employee,left_open}', '1'::jsonb, 'AC-ECA-004 an email-keyed employee link whose ERP email changed since the proposal is left open');
update erp_employees set work_email='a451-u1@example.com' where employee_number='HR-EMP-1';

-- Finance: accept-all applies account rows only.
update erp_connect_proposals set state='open' where kind = 'account' and outcome='link';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a4510000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select is(public.accept_connect_proposals('erpnext') #>> '{counts,account,link}', '1', 'AC-ECA-004 Finance accept-all reaches account rows');
select is(public.accept_connect_proposals('erpnext') -> 'counts' ? 'party', false, 'AC-ECA-004 Finance accept-all never touches parties');
reset role;

-- 4. unlink: removes the link and writes audit; refuses while an ERP document names the master.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a4510000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select public.unlink_connect_match((select id from erp_connect_proposals where external_ids='{Supplier:ACME}'));
reset role;
select is((select count(*)::int from external_refs where external_record_id='Supplier:ACME'), 0, 'AC-ECA-007 unlink deletes the reference');
select is((select state from erp_connect_proposals where external_ids='{Supplier:ACME}'), 'dismissed', 'AC-ECA-007 an unlinked pairing is dismissed, so no accept puts it back');
select is((select count(*)::int from audit_events where action='integration.connect_unlink'), 1, 'AC-ECA-007 unlink writes audit');
update erp_connect_proposals set state='applied' where external_ids='{Supplier:ACME}';
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values
 ('a4510000-0000-0000-0000-000000000001','companies','a4510000-0000-0000-0000-0000000000d1','erpnext','Supplier:ACME');
insert into procurements (id, org_id, title, requested_by_id, vendor_id, currency, total_value, status) values
 ('a4510000-0000-0000-0000-0000000000f3','a4510000-0000-0000-0000-000000000001','Acme case','a4510000-0000-0000-0000-0000000000a1','a4510000-0000-0000-0000-0000000000d1','IDR',1,'Ordered');
insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload) values
 ('a4510000-0000-0000-0000-000000000001','procurement','a4510000-0000-0000-0000-0000000000f3','k1','erpnext','create','confirmed',
  '{"procurementId":"a4510000-0000-0000-0000-0000000000f3"}');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a4510000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.unlink_connect_match((select id from erp_connect_proposals where external_ids='{Supplier:ACME}'))$$, 'P0001', 'link in use',
  'AC-ECA-007 a vendor with an ERP-bound purchase cannot be unlinked');
reset role;
insert into sales_invoices (id, org_id, project_id, customer_id, amount, tax_treatment, tax_amount, currency, status, pmo_native, native_lines) values
 ('a4510000-0000-0000-0000-0000000000f4','a4510000-0000-0000-0000-000000000001','a4510000-0000-0000-0000-0000000000f2','a4510000-0000-0000-0000-0000000000d2',1,'exclusive',0,'IDR','Draft', true,
  '[{"item_code":"SVC","description":null,"qty":1,"rate":1,"amount":1.00}]');
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values
 ('a4510000-0000-0000-0000-000000000001','revenue','a4510000-0000-0000-0000-0000000000f4','erpnext','SINV-1');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a4510000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.unlink_connect_match((select id from erp_connect_proposals where external_ids='{Customer:CLI}'))$$, 'P0001', 'link in use',
  'AC-ECA-007 a client with a pushed native invoice cannot be unlinked');
reset role;

-- ===== fix round (review of ECA2-T1..T10) ==================================================================
insert into auth.users (id, email) values
 ('a4510000-0000-0000-0000-0000000000c3','a451-u3@example.com'),
 ('a4510000-0000-0000-0000-0000000000c4','a451-u4@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('a4510000-0000-0000-0000-0000000000c3','a4510000-0000-0000-0000-000000000001','Person Three','a451-u3@example.com','Engineer','active'),
 ('a4510000-0000-0000-0000-0000000000c4','a4510000-0000-0000-0000-000000000001','Person Four','a451-u4@example.com','Engineer','active');
insert into erp_employees (org_id, employee_number, employee_name, work_email, link_state) values
 ('a4510000-0000-0000-0000-000000000001','HR-EMP-N1','Person Two','someone-else@example.com','unlinked'),
 ('a4510000-0000-0000-0000-000000000001','HR-EMP-N2','Person Three','a451-u3@example.com','unlinked'),
 ('a4510000-0000-0000-0000-000000000001','HR-EMP-N3','Person Two','a451-u2@example.com','unlinked'),
 ('a4510000-0000-0000-0000-000000000001','HR-EMP-DUP','Person Dup','a451-u2@example.com','unlinked'),
 ('a4510000-0000-0000-0000-000000000001','HR-EMP-DUP','Person Dup','a451-u2@example.com','unlinked');
create temp table a451_ids (k text primary key, id uuid);
grant all on a451_ids to authenticated;

-- C1: a person and an account never link on a bare name, in accept-all or by a stale key; I6: nothing applied, nothing stamped.
insert into erp_connect_proposals (org_id, binding_id, external_tier, kind, outcome, identity, pmo_ids, external_ids, match_key, snapshot) values
 ('a4510000-0000-0000-0000-000000000001',(select id from external_org_bindings where org_id='a4510000-0000-0000-0000-000000000001'),'erpnext','employee','link','c1-name',
  '{a4510000-0000-0000-0000-0000000000c2}','{HR-EMP-N1}','name','{}'),
 ('a4510000-0000-0000-0000-000000000001',(select id from external_org_bindings where org_id='a4510000-0000-0000-0000-000000000001'),'erpnext','employee','link','c1-name-samemail',
  '{a4510000-0000-0000-0000-0000000000c2}','{HR-EMP-N3}','name','{"code":"a451-u2@example.com"}'),
 ('a4510000-0000-0000-0000-000000000001',(select id from external_org_bindings where org_id='a4510000-0000-0000-0000-000000000001'),'erpnext','account','link','c1-acc-name',
  '{Equipment}','{5900 - Equipment}','name','{"code":"Equipment"}'),
 ('a4510000-0000-0000-0000-000000000001',(select id from external_org_bindings where org_id='a4510000-0000-0000-0000-000000000001'),'erpnext','account','link','c1-acc-badcode',
  '{Materials}','{5000 - Materials}','code','{"code":"Other"}'),
 ('a4510000-0000-0000-0000-000000000001',(select id from external_org_bindings where org_id='a4510000-0000-0000-0000-000000000001'),'erpnext','party','link','c1-tax-moved',
  '{a4510000-0000-0000-0000-0000000000d2}','{Customer:MOVED}','tax','{"taxId":"999"}');
update erp_connect_census set accepted_at = null where org_id='a4510000-0000-0000-0000-000000000001' and kind in ('employee','account','party');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a4510000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select set_config('a451.c1', public.accept_connect_proposals('erpnext', null, array(select id from erp_connect_proposals where identity in ('c1-name','c1-name-samemail','c1-acc-name','c1-acc-badcode','c1-tax-moved')))::text, true);
reset role;
select is(current_setting('a451.c1')::jsonb #> '{counts,employee}', '{"link":0,"bring_in":0,"send":0,"left_open":2}'::jsonb, 'C1 a name-keyed employee link is left open by accept-all, whether or not the work emails agree');
select is(current_setting('a451.c1')::jsonb #> '{counts,account}', '{"link":0,"bring_in":0,"send":0,"left_open":2}'::jsonb, 'C1 a name-keyed account link and a wrong-code account link are left open');
select is(current_setting('a451.c1')::jsonb #> '{counts,party}', '{"link":0,"bring_in":0,"send":0,"left_open":1}'::jsonb, 'C1 a tax-keyed party link whose company tax id differs is left open');
select is((select string_agg(link_state || '/' || coalesce(profile_id::text, '-'), ',') from erp_employees where employee_number in ('HR-EMP-N1','HR-EMP-N3')), 'unlinked/-,unlinked/-', 'C1 the employee rows are untouched');
select is((select count(*)::int from budget_category_account_map where erp_account in ('5900 - Equipment','5000 - Materials')), 0, 'C1 no account map row was written');
select is((select reason_text from erp_connect_proposals where identity='c1-name'), 'This pairing needs a person to confirm it', 'C1 the name-keyed row keeps a plain reason');
select is((select count(*)::int from erp_connect_census where org_id='a4510000-0000-0000-0000-000000000001' and kind in ('employee','account','party') and accepted_at is not null), 0,
  'I6 a kind whose rows were all left open is not stamped as set up');

-- decide (the individual path): a person looks at the pair and links it, even when the work emails differ.
insert into erp_connect_proposals (org_id, binding_id, external_tier, kind, outcome, identity, pmo_ids, external_ids, reason, reason_text) values
 ('a4510000-0000-0000-0000-000000000001',(select id from external_org_bindings where org_id='a4510000-0000-0000-0000-000000000001'),'erpnext','employee','review','c1-review',
  '{a4510000-0000-0000-0000-0000000000c4}','{HR-EMP-N1}','ambiguous','Same name, different work email.');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a4510000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select public.decide_connect_review((select id from erp_connect_proposals where identity='c1-review'),
  '{"action":"link","pmoId":"a4510000-0000-0000-0000-0000000000c4","externalId":"HR-EMP-N1"}');
reset role;
select is((select link_state || '/' || profile_id::text from erp_employees where employee_number='HR-EMP-N1'),
  'confirmed/a4510000-0000-0000-0000-0000000000c4', 'C1 a person can still confirm a doubtful pair on the review screen');
select is((select detail->>'externalId' from audit_events where action='integration.connect_review' order by created_at desc, id desc limit 1), 'HR-EMP-N1',
  'I4 the review audit names the linked pair');
select is((select entity_id from audit_events where action='integration.connect_review' order by created_at desc, id desc limit 1),
  (select id from erp_connect_proposals where identity='c1-review'), 'I4 the review audit points at the proposal');

-- I4 + I3 (employee): an applied person link is audited pair by pair; unlinking it is audited, declines the pairing, and sticks.
insert into erp_connect_proposals (org_id, binding_id, external_tier, kind, outcome, identity, pmo_ids, external_ids, match_key, snapshot) values
 ('a4510000-0000-0000-0000-000000000001',(select id from external_org_bindings where org_id='a4510000-0000-0000-0000-000000000001'),'erpnext','employee','link','i3-emp',
  '{a4510000-0000-0000-0000-0000000000c3}','{HR-EMP-N2}','code','{"code":"a451-u3@example.com"}');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a4510000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select public.accept_connect_proposals('erpnext', 'employee', array(select id from erp_connect_proposals where identity='i3-emp'));
reset role;
select is((select link_state from erp_employees where employee_number='HR-EMP-N2'), 'confirmed', 'I4 the work-email-keyed person link applies');
select is((select count(*)::int from audit_events where action='integration.connect_accept'
            and detail->'links' @> '[{"kind":"employee","pmoId":"a4510000-0000-0000-0000-0000000000c3","externalId":"HR-EMP-N2"}]'::jsonb), 1,
  'I4 the accept audit names each applied person pair');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a4510000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select public.unlink_connect_match((select id from erp_connect_proposals where identity='i3-emp'));
select public.accept_connect_proposals('erpnext');
reset role;
select is((select link_state from erp_employees where employee_number='HR-EMP-N2'), 'rejected', 'I3 an unlinked person is declined, so the feed cannot re-propose the same pairing');
select is((select state from erp_connect_proposals where identity='i3-emp'), 'dismissed', 'I3 accept-all after an unlink does not put the link back');
select is((select detail->>'externalId' || '/' || (detail->>'linkedBy') from audit_events where action='integration.connect_unlink' and entity_id=(select id from erp_connect_proposals where identity='i3-emp')),
  'HR-EMP-N2/a4510000-0000-0000-0000-0000000000a1', 'I4 the unlink audit names the pair and who linked it');

-- Minor: an unlink that removes nothing says so instead of reporting success.
insert into companies (id, org_id, name, type) values ('a4510000-0000-0000-0000-0000000000d3','a4510000-0000-0000-0000-000000000001','Gone Co','Vendor');
insert into erp_connect_proposals (org_id, binding_id, external_tier, kind, outcome, identity, pmo_ids, external_ids, state, match_key) values
 ('a4510000-0000-0000-0000-000000000001',(select id from external_org_bindings where org_id='a4510000-0000-0000-0000-000000000001'),'erpnext','party','link','gone',
  '{a4510000-0000-0000-0000-0000000000d3}','{Supplier:GONE}','applied','tax');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a4510000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.unlink_connect_match((select id from erp_connect_proposals where identity='gone'))$$, 'P0001', 'nothing to unlink',
  'an unlink whose link is already gone raises instead of reporting success');
reset role;
select is((select state from erp_connect_proposals where identity='gone'), 'applied', 'the proposal of a failed unlink is unchanged');

-- Minor: two ERP people with one number are never guessed between; a malformed link row is refused by the table.
insert into erp_connect_proposals (org_id, binding_id, external_tier, kind, outcome, identity, pmo_ids, external_ids, match_key, snapshot) values
 ('a4510000-0000-0000-0000-000000000001',(select id from external_org_bindings where org_id='a4510000-0000-0000-0000-000000000001'),'erpnext','employee','link','dup-emp',
  '{a4510000-0000-0000-0000-0000000000c2}','{HR-EMP-DUP}','code','{"code":"a451-u2@example.com"}');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a4510000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(public.accept_connect_proposals('erpnext','employee', array(select id from erp_connect_proposals where identity='dup-emp')) #>> '{counts,employee,left_open}', '1',
  'an ERP person number shared by two rows is left open, never guessed');
reset role;
select throws_ok($$insert into erp_connect_proposals (org_id, binding_id, external_tier, kind, outcome, identity, pmo_ids, external_ids)
  values ('a4510000-0000-0000-0000-000000000001',(select id from external_org_bindings where org_id='a4510000-0000-0000-0000-000000000001'),'erpnext','item','link','two','{a,b}','{c}')$$,
  '23514', null, 'a link row names exactly one pair');

-- I5: the end-of-kind cleanup keeps review rows no run wrote (a held send, a feed review) and removes a stale run row.
insert into erp_connect_runs (id, org_id, binding_id, external_tier, state) values
 ('a4510000-0000-0000-0000-0000000000e9','a4510000-0000-0000-0000-000000000001',(select id from external_org_bindings where org_id='a4510000-0000-0000-0000-000000000001'),'erpnext','ready');
insert into erp_connect_proposals (org_id, binding_id, run_id, external_tier, kind, outcome, identity, pmo_ids, external_ids) values
 ('a4510000-0000-0000-0000-000000000001',(select id from external_org_bindings where org_id='a4510000-0000-0000-0000-000000000001'),'a4510000-0000-0000-0000-0000000000e9','erpnext','project','send','stale','{p-old}','{}');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.record_connect_review('a4510000-0000-0000-0000-000000000001','erpnext','project','{p-held}','{}','held','We could not confirm whether the ERP created this record.');
select public.replace_connect_proposals('a4510000-0000-0000-0000-000000000001','erpnext',current_setting('a451.run')::uuid,'project','[]'::jsonb, true);
reset role;
select is((select count(*)::int from erp_connect_proposals where kind='project' and reason='held'), 1, 'I5 a review row no run wrote survives the end-of-kind cleanup');
select is((select count(*)::int from erp_connect_proposals where identity='stale'), 0, 'I5 a row an earlier run wrote and this run no longer makes is removed');

-- I1: one call is bounded and says how many are left; a 500-row call finishes inside the 8 s user timeout.
insert into erp_connect_proposals (org_id, binding_id, external_tier, kind, outcome, identity, pmo_ids, external_ids, match_key)
  select 'a4510000-0000-0000-0000-000000000001',(select id from external_org_bindings where org_id='a4510000-0000-0000-0000-000000000001'),'erpnext','item','link','bulk-'||g,
         array['bulk-pmo-'||g], array['BULK-'||g], 'code' from generate_series(1, 600) g;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a4510000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select set_config('a451.small', public.accept_connect_proposals('erpnext','item', array(select id from erp_connect_proposals where identity in ('bulk-1','bulk-2','bulk-3')), 2)::text, true);
select set_config('a451.t0', clock_timestamp()::text, true);
set local statement_timeout = '8s';
select set_config('a451.big', public.accept_connect_proposals('erpnext','item')::text, true);
select set_config('a451.t1', clock_timestamp()::text, true);
reset statement_timeout;
reset role;
select diag('I1 a 500-row accept took ' || round(extract(epoch from current_setting('a451.t1')::timestamptz - current_setting('a451.t0')::timestamptz)::numeric, 2) || ' s');
select is(current_setting('a451.small')::jsonb, '{"counts":{"item":{"link":2,"bring_in":0,"send":0,"left_open":0}},"remaining":1}'::jsonb, 'I1 a batch of 2 applies 2 and reports 1 remaining');
select is(current_setting('a451.big')::jsonb #> '{counts,item,link}', '500'::jsonb, 'I1 an unbounded call stops at 500 rows');
select is(current_setting('a451.big')::jsonb -> 'remaining', '98'::jsonb, 'I1 the call reports the rest (600 - 2 - 500)');
select cmp_ok(extract(epoch from current_setting('a451.t1')::timestamptz - current_setting('a451.t0')::timestamptz)::numeric, '<', 8::numeric, 'I1 a 500-row call stays under the 8 s user statement timeout');
select is((select count(*)::int from jsonb_object_keys((select config->'item_map' from external_org_bindings where org_id='a4510000-0000-0000-0000-000000000001'))), 502, 'I1 every applied item link is in the map');

-- I6 (item): a kind with a row that failed and nothing else applied stays unstamped.
update external_org_bindings set config = jsonb_set(config, '{item_map}', config->'item_map' || '{"bulk-pmo-600":"ELSEWHERE"}'::jsonb)
  where org_id='a4510000-0000-0000-0000-000000000001';
delete from erp_connect_proposals where identity like 'bulk-%';
insert into erp_connect_proposals (org_id, binding_id, external_tier, kind, outcome, identity, pmo_ids, external_ids, match_key) values
 ('a4510000-0000-0000-0000-000000000001',(select id from external_org_bindings where org_id='a4510000-0000-0000-0000-000000000001'),'erpnext','item','link','i6-item','{bulk-pmo-600}','{BULK-600}','code');
insert into erp_connect_census (org_id, binding_id, external_tier, kind, pmo_count, erp_count, scenario) values ('a4510000-0000-0000-0000-000000000001',(select id from external_org_bindings where org_id='a4510000-0000-0000-0000-000000000001'),'erpnext','item',1,1,'S-D')
  on conflict do nothing;
update erp_connect_census set accepted_at = null where org_id='a4510000-0000-0000-0000-000000000001' and kind='item';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a4510000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(public.accept_connect_proposals('erpnext','item') #>> '{counts,item,left_open}', '1', 'I6 the only item row cannot be applied');
reset role;
select is((select accepted_at from erp_connect_census where org_id='a4510000-0000-0000-0000-000000000001' and kind='item'), null, 'I6 an item kind with nothing applied is not stamped');

-- I2: a disconnect takes the tier's setup state with it; a reconnect starts clean and an old row cannot apply.
delete from external_org_bindings where org_id='a4510000-0000-0000-0000-000000000001' and external_tier='erpnext';
select is((select count(*)::int from erp_connect_proposals where org_id='a4510000-0000-0000-0000-000000000001') + (select count(*)::int from erp_connect_runs where org_id='a4510000-0000-0000-0000-000000000001')
  + (select count(*)::int from erp_connect_census where org_id='a4510000-0000-0000-0000-000000000001'), 0, 'I2 a disconnect removes the tier''s proposals, runs and census');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a4510000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.accept_connect_proposals('erpnext')$$, 'P0001', 'no active connection for this ERP', 'I2 accept needs an active connection');
select throws_ok($$select public.decide_connect_review((select 'a4510000-0000-0000-0000-0000000000e8'::uuid), '{"action":"dismiss"}')$$, 'P0002', 'review not found', 'I2 a review of the disconnected ERP is gone');
reset role;

-- Part B: a stuck run fails (Minor 8) and a run is not complete while sends wait (Minor 10).
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at) values
 ('a4510000-0000-0000-0000-000000000001','erpnext','https://erp.example.test','a451_a2','active','{"company":"Example Co"}', now());
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select set_config('a451.f1', public.start_connect_run('a4510000-0000-0000-0000-000000000001','erpnext',null)::text, true);
select is(public.fail_connect_run('a4510000-0000-0000-0000-000000000001', current_setting('a451.f1')::uuid, 'timeout'), 'staging',
  'Minor 8 one failed tick leaves the run open');
select is(public.fail_connect_run('a4510000-0000-0000-0000-000000000001', current_setting('a451.f1')::uuid, 'timeout'), 'staging',
  'Minor 8 two failed ticks leave the run open');
select is(public.fail_connect_run('a4510000-0000-0000-0000-000000000001', current_setting('a451.f1')::uuid, 'timeout'), 'failed',
  'Minor 8 the third consecutive failure ends the run');
select is((select error_class || ':' || (finished_at is not null)::text from erp_connect_runs where id = current_setting('a451.f1')::uuid), 'timeout:true',
  'Minor 8 a failed run records its class and an end time');
select isnt(public.start_connect_run('a4510000-0000-0000-0000-000000000001','erpnext',null), current_setting('a451.f1')::uuid,
  'Minor 8 a failed run no longer blocks a new run');
select set_config('a451.f2', (select id::text from erp_connect_runs where org_id='a4510000-0000-0000-0000-000000000001' and state='staging'), true);
select public.fail_connect_run('a4510000-0000-0000-0000-000000000001', current_setting('a451.f2')::uuid, 'timeout');
select public.stage_connect_master_page('a4510000-0000-0000-0000-000000000001', current_setting('a451.f2')::uuid, 'party',
  '[{"kind":"party","externalId":"Supplier:S1","name":"S1","active":true}]'::jsonb, 'cursor-1');
select is((select failed_ticks from erp_connect_runs where id = current_setting('a451.f2')::uuid), 0, 'Minor 8 a page that lands resets the failure count');
select is(public.fail_connect_run('a4510000-0000-0000-0000-000000000001', current_setting('a451.f2')::uuid, 'budget-exceeded', true), 'failed',
  'Minor 8 a fatal failure (the run outlived its budget) ends the run at once');
select is((select count(*)::int from erp_connect_staged where run_id = current_setting('a451.f2')::uuid), 0, 'Minor 8 a failed run drops its staged pages');
select throws_ok($$select public.stage_connect_master_page('a4510000-0000-0000-0000-000000000001', current_setting('a451.f2')::uuid, 'party', '[]'::jsonb, null)$$,
  'P0001', 'no staging run for this organisation', 'Minor 8 a failed run takes no more pages');
select throws_ok($$select public.fail_connect_run('a4510000-0000-0000-0000-000000000002', current_setting('a451.f2')::uuid, 'timeout')$$,
  'P0001', 'no open run for this organisation', 'Minor 8 another organisation cannot fail the run');

-- Minor 10: all five kinds proposed while a send is still waiting: the proposals are ready, the run is not complete.
select set_config('a451.f3', public.start_connect_run('a4510000-0000-0000-0000-000000000001','erpnext',null)::text, true);
insert into erp_connect_proposals (org_id, binding_id, external_tier, kind, outcome, state, identity, pmo_ids)
  values ('a4510000-0000-0000-0000-000000000001', (select id from external_org_bindings where org_id='a4510000-0000-0000-0000-000000000001'), 'erpnext', 'project', 'send', 'sending', 'send|["p-wait"]|[]', '{p-wait}');
select public.replace_connect_proposals('a4510000-0000-0000-0000-000000000001','erpnext',current_setting('a451.f3')::uuid,k,'[]'::jsonb,true)
  from unnest(array['party','item','project','employee','account']) k;
select is((select state || ':' || (finished_at is null)::text from erp_connect_runs where id = current_setting('a451.f3')::uuid), 'ready:true',
  'Minor 10 a run with sends waiting is ready but not complete');
update erp_connect_proposals set state = 'applied' where identity = 'send|["p-wait"]|[]';
select public.settle_connect_run('a4510000-0000-0000-0000-000000000001', 'erpnext');
select is((select finished_at is not null from erp_connect_runs where id = current_setting('a451.f3')::uuid), true,
  'Minor 10 once no send waits the run is complete');
insert into erp_connect_proposals (org_id, binding_id, external_tier, kind, outcome, identity, pmo_ids)
  values ('a4510000-0000-0000-0000-000000000001', (select id from external_org_bindings where org_id='a4510000-0000-0000-0000-000000000001'), 'erpnext', 'project', 'send', 'send|["p-new"]|[]', '{p-new}');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a4510000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select public.accept_connect_proposals('erpnext', 'project');
reset role;
select is((select finished_at is null from erp_connect_runs where id = current_setting('a451.f3')::uuid), true,
  'Minor 10 queuing a send re-opens a completed run');
select is((has_function_privilege('authenticated', 'public.fail_connect_run(uuid,uuid,text,boolean)', 'execute')
        or has_function_privilege('anon', 'public.settle_connect_run(uuid,text)', 'execute')), false, 'Minor 8/10 the new writers are not client-callable');
select is((has_function_privilege('service_role', 'public.fail_connect_run(uuid,uuid,text,boolean)', 'execute')
       and has_function_privilege('service_role', 'public.settle_connect_run(uuid,text)', 'execute')), true, 'Minor 8/10 the new writers are service-role callable');

select * from finish();
rollback;
