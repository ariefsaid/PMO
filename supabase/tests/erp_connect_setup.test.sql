-- ECA-2 (#1605, migration 0451): census, match proposals and one-pass accept. Tier-keyed, shared by every ERP.
-- AC-ECA-004 (exactly-once apply), AC-ECA-007 (audited, undoable while unused), plus the role / tenancy / grant contract.
begin;
select plan(60);

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
  {"outcome":"link","pmoIds":["Labor"],"externalIds":["5100 - Labor"],"key":"code","snapshot":{}}]'::jsonb, true);
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
select is(public.accept_connect_proposals('erpnext'), '{}'::jsonb, 'AC-ECA-007 B''s Admin accept finds nothing of A''s rows');
set local request.jwt.claims = '{"sub":"a4510000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$insert into erp_connect_proposals (org_id, external_tier, kind, outcome, identity) values ('a4510000-0000-0000-0000-000000000001','erpnext','party','link','z')$$,
  '42501', null, 'AC-ECA-007 even an Admin cannot insert a proposal');
select throws_ok($$update erp_connect_proposals set state = 'applied'$$, '42501', null, 'AC-ECA-007 even an Admin cannot update a proposal');
select throws_ok($$select count(*) from erp_connect_staged$$, '42501', null, 'AC-ECA-007 nobody on a user JWT can read staged ERP pages');
select throws_ok($$delete from erp_connect_census$$, '42501', null, 'AC-ECA-007 even an Admin cannot delete census rows');
reset role;
select is(has_function_privilege('anon', f, 'execute'), false, 'AC-ECA-007 ' || f || ' is not executable by anon')
  from unnest(array['public.accept_connect_proposals(text,text,uuid[])','public.decide_connect_review(uuid,jsonb)','public.unlink_connect_match(uuid)',
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
select is(current_setting('a451.first')::jsonb, '{"party":{"link":0,"bring_in":1,"send":0,"left_open":0}}'::jsonb, 'AC-ECA-004 the first accept brings one company in');
select is(current_setting('a451.second')::jsonb, '{}'::jsonb, 'AC-ECA-004 the second accept finds nothing open: bring_in = 0');
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
insert into erp_connect_proposals (org_id, external_tier, kind, outcome, identity, external_ids, snapshot) values
 ('a4510000-0000-0000-0000-000000000001','erpnext','party','bring-in','race','{Supplier:RACE}','{"name":"Race Co","role":"vendor"}');
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
select is(current_setting('a451.all')::jsonb #> '{party,link}', '2'::jsonb, 'AC-ECA-004 accept-all applies both party links');
select is(current_setting('a451.all')::jsonb #> '{employee}', '{"link":1,"bring_in":0,"send":0,"left_open":1}'::jsonb, 'AC-ECA-004 one employee row applies, one stays open, neither aborts the other');
select is(current_setting('a451.all')::jsonb #> '{account,link}', '1'::jsonb, 'AC-ECA-004 the account link applies for an Admin');
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
select is(current_setting('a451.mail')::jsonb #> '{employee,left_open}', '1'::jsonb, 'AC-ECA-004 an email-keyed employee link whose ERP email changed since the proposal is left open');
update erp_employees set work_email='a451-u1@example.com' where employee_number='HR-EMP-1';

-- Finance: accept-all applies account rows only.
update erp_connect_proposals set state='open' where kind = 'account' and outcome='link';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a4510000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select is(public.accept_connect_proposals('erpnext') #>> '{account,link}', '1', 'AC-ECA-004 Finance accept-all reaches account rows');
select is(public.accept_connect_proposals('erpnext') ? 'party', false, 'AC-ECA-004 Finance accept-all never touches parties');
reset role;

-- 4. unlink: removes the link and writes audit; refuses while an ERP document names the master.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a4510000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select public.unlink_connect_match((select id from erp_connect_proposals where external_ids='{Supplier:ACME}'));
reset role;
select is((select count(*)::int from external_refs where external_record_id='Supplier:ACME'), 0, 'AC-ECA-007 unlink deletes the reference');
select is((select state from erp_connect_proposals where external_ids='{Supplier:ACME}'), 'open', 'AC-ECA-007 the proposal is open again');
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

select * from finish();
rollback;
