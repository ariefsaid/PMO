begin;
select no_plan();
insert into organizations(id,name) values ('39910000-0000-0000-0000-000000000001','Roles A'),('39910000-0000-0000-0000-000000000002','Roles B');
insert into auth.users(id,email,banned_until) values
 ('39910000-0000-0000-0000-000000000011','roles-a@example.invalid',null),
 ('39910000-0000-0000-0000-000000000012','roles-b@example.invalid',null),
 ('39910000-0000-0000-0000-000000000013','roles-engineer@example.invalid',null),
 ('39910000-0000-0000-0000-000000000014','roles-inactive@example.invalid',now()+interval '1 day');
insert into profiles(id,org_id,full_name,email,role) values
 ('39910000-0000-0000-0000-000000000011','39910000-0000-0000-0000-000000000001','A','roles-a@example.invalid','Admin'),
 ('39910000-0000-0000-0000-000000000012','39910000-0000-0000-0000-000000000002','B','roles-b@example.invalid','Admin'),
 ('39910000-0000-0000-0000-000000000013','39910000-0000-0000-0000-000000000001','Engineer','roles-engineer@example.invalid','Engineer'),
 ('39910000-0000-0000-0000-000000000014','39910000-0000-0000-0000-000000000001','Inactive','roles-inactive@example.invalid','Admin');
insert into procurements(id,org_id,title,status,requested_by_id) values ('39910000-0000-0000-0000-000000000021','39910000-0000-0000-0000-000000000001','Case','Draft','39910000-0000-0000-0000-000000000011');
insert into companies(id,org_id,name,type) values ('39910000-0000-0000-0000-000000000031','39910000-0000-0000-0000-000000000001','Vendor','Vendor');
create temporary table role_calls(label text, sql text);
insert into role_calls values
 ('request', $$select public.create_purchase_request('39910000-0000-0000-0000-000000000021',null,null,null,null)$$),
 ('rfq', $$select public.create_rfq('39910000-0000-0000-0000-000000000021',null,null,null,null)$$),
 ('quotation', $$select public.create_procurement_quotation('39910000-0000-0000-0000-000000000021','39910000-0000-0000-0000-000000000031',0,null)$$),
 ('order', $$select public.create_purchase_order('39910000-0000-0000-0000-000000000021',null,null,null,null)$$),
 ('receipt', $$select public.create_procurement_receipt('39910000-0000-0000-0000-000000000021','Complete',null)$$),
 ('invoice', $$select public.create_procurement_invoice('39910000-0000-0000-0000-000000000021','Received',null,p_tax_treatment=>'exclusive',p_tax_amount=>0)$$),
 ('payment', $$select public.create_payment('39910000-0000-0000-0000-000000000021',null,null,null,null,null)$$);
grant select on role_calls to authenticated, anon;
set local role authenticated;
set local request.jwt.claims = '{"sub":"39910000-0000-0000-0000-000000000013","role":"authenticated"}';
select throws_ok(sql,'42501',null,label || ' retains role gate') from role_calls order by label;
set local request.jwt.claims = '{"sub":"39910000-0000-0000-0000-000000000012","role":"authenticated"}';
select throws_ok(sql,'42501',null,label || ' retains org scope') from role_calls order by label;
set local request.jwt.claims = '{"sub":"39910000-0000-0000-0000-000000000014","role":"authenticated"}';
select throws_ok(sql,'42501',null,label || ' retains active member gate') from role_calls order by label;
select throws_ok($$select public.start_procurement_import_run()$$,'42501',null,'run registration requires active membership');
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(sql,'42501',null,label || ' denies anonymous execution') from role_calls order by label;
select throws_ok($$select public.start_procurement_import_run()$$,'42501',null,'anonymous cannot register a run');
select throws_ok($$select public.lookup_procurement_import_cases(array['x'])$$,'42501',null,'anonymous cannot look up cases');
select throws_ok($$select public.normalize_procurement_import_refs(array['x'])$$,'42501',null,'anonymous cannot normalize import references');
reset role;
select * from finish();
rollback;
