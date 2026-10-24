-- Round trip for 0372 (procurement link integrity): down, then up again. Run by
-- scripts/test-procurement-link-integrity-rollback.sh, which inlines the migration files at the markers.
-- The down half doubles as a mutation check: without 0372 a disabled member still reads the ledger-held amount and a
-- multi-project ERP invoice links into one purchase.
begin;
select plan(10);
insert into organizations (id, name, default_currency) values ('03729000-0000-0000-0000-00000000000a','PLI RT','IDR');
insert into auth.users (id, email) values ('03729000-0000-0000-0000-0000000000a1','pli-rt@example.com'), ('03729000-0000-0000-0000-0000000000a2','pli-rt-off@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('03729000-0000-0000-0000-0000000000a1','03729000-0000-0000-0000-00000000000a','RT Fin','pli-rt@example.com','Finance','active'),
  ('03729000-0000-0000-0000-0000000000a2','03729000-0000-0000-0000-00000000000a','RT Off','pli-rt-off@example.com','Finance','disabled');
insert into projects (id, org_id, name, status) values
  ('03729000-0000-0000-0000-0000000000d1','03729000-0000-0000-0000-00000000000a','RT P1','Ongoing Project'),
  ('03729000-0000-0000-0000-0000000000d2','03729000-0000-0000-0000-00000000000a','RT P2','Ongoing Project');
insert into erp_purchase_documents (org_id, erp_doctype, erp_name, supplier, currency, grand_total, net_total, erp_docstatus, erp_modified, project_ids) values
  ('03729000-0000-0000-0000-00000000000a','Purchase Invoice','RT-SPLIT-1','SUP-1','IDR',110,100,1,'2026-02-01',
   array['03729000-0000-0000-0000-0000000000d1','03729000-0000-0000-0000-0000000000d2']::uuid[]),
  ('03729000-0000-0000-0000-00000000000a','Purchase Invoice','RT-SPLIT-2','SUP-1','IDR',110,100,1,'2026-02-01',
   array['03729000-0000-0000-0000-0000000000d1','03729000-0000-0000-0000-0000000000d2']::uuid[]);
insert into procurements (id, org_id, title, requested_by_id, project_id, currency, total_value, status) values
  ('03729000-0000-0000-0000-0000000000e1','03729000-0000-0000-0000-00000000000a','RT down','03729000-0000-0000-0000-0000000000a1','03729000-0000-0000-0000-0000000000d1','IDR',500,'Ordered'),
  ('03729000-0000-0000-0000-0000000000e2','03729000-0000-0000-0000-00000000000a','RT up','03729000-0000-0000-0000-0000000000a1','03729000-0000-0000-0000-0000000000d1','IDR',500,'Ordered');
-- @0372_DOWN@
select hasnt_function('public', 'sharepoint_url_on_org_host', array['uuid','text'], 'down 0372: the SharePoint host helper is gone');
select hasnt_function('public', 'lock_erp_order_family', array['uuid','text[]'], 'down 0372: the ERP order lock helper is gone');
select hasnt_function('public', 'erp_linked_documents_total', array['uuid'], 'down 0372: the linked-documents total helper is gone');
set local role authenticated;
set local request.jwt.claims = '{"sub":"03729000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(link_erp_purchase_documents('[{"erp_name":"RT-SPLIT-1","procurement_id":"03729000-0000-0000-0000-0000000000e1"}]') #>> '{results,0,outcome}', 'link',
  'down 0372 (mutation check): a multi-project ERP invoice links into one purchase');
set local request.jwt.claims = '{"sub":"03729000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(procurement_ledger_held('03729000-0000-0000-0000-0000000000e1'), 100::numeric,
  'down 0372 (mutation check): a disabled member reads the ledger-held amount');
reset role;
select set_config('request.jwt.claims', '', true);
-- @0372_UP@
select has_function('public', 'sharepoint_url_on_org_host', array['uuid','text'], 'up again: the SharePoint host helper');
select ok(not has_function_privilege('authenticated', 'public.lock_erp_order_family(uuid,text[])', 'execute')
          and not has_function_privilege('authenticated', 'public.sharepoint_url_on_org_host(uuid,text)', 'execute')
          and not has_function_privilege('authenticated', 'public.refresh_native_purchase_total_from_links(uuid,numeric)', 'execute'),
  'up again: the helpers are not callable by clients');
set local role authenticated;
set local request.jwt.claims = '{"sub":"03729000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(link_erp_purchase_documents('[{"erp_name":"RT-SPLIT-2","procurement_id":"03729000-0000-0000-0000-0000000000e2"}]') #>> '{results,0,reason}', 'document_spans_projects',
  'up again: a multi-project ERP invoice is refused');
set local request.jwt.claims = '{"sub":"03729000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(procurement_ledger_held('03729000-0000-0000-0000-0000000000e1'), null::numeric,
  'up again: a disabled member reads no ledger-held amount');
reset role;
select set_config('request.jwt.claims', '', true);
select is(procurement_ledger_held('03729000-0000-0000-0000-0000000000e1'), 100::numeric,
  'up again: the server path still reads it');
select * from finish();
rollback;
