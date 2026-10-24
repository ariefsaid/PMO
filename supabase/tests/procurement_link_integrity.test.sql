-- procurement_link_integrity.test.sql — 0372. Linking ERP documents into purchases keeps commitments and
-- references correct:
--   (a) the financial and purchase-state helpers answer only active members, and only for purchases the caller can see;
--   (b) an order and the invoices billing it are linked one at a time (a shared lock on the order), so they cannot
--       land in two purchases;
--   (c) an ERP invoice recorded against several projects is not linked into one purchase;
--   (d) an empty PMO purchase (no line items, no approval, total 0) takes its total from the ERP documents linked in;
--   (e) a SharePoint file sent with a link must be on the organisation's own SharePoint host (one shared rule);
--   (f) unlinking refreshes totals; a file cannot be attached to a document whose link is gone.
-- The two-session lock proofs for (f) are in procurement_unlink_lock_order.test.sql.
begin;
select plan(44);

create extension if not exists dblink;

insert into organizations (id, name, default_currency) values ('03720000-0000-0000-0000-00000000000a','PLI A','IDR');
insert into auth.users (id, email) values
  ('03720000-0000-0000-0000-0000000000a1','pli-fin@example.com'), ('03720000-0000-0000-0000-0000000000a2','pli-off@example.com'),
  ('03720000-0000-0000-0000-0000000000a3','pli-eng1@example.com'), ('03720000-0000-0000-0000-0000000000a4','pli-eng2@example.com'),
  ('03720000-0000-0000-0000-0000000000a5','pli-appr@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('03720000-0000-0000-0000-0000000000a1','03720000-0000-0000-0000-00000000000a','Fin','pli-fin@example.com','Finance','active'),
  ('03720000-0000-0000-0000-0000000000a2','03720000-0000-0000-0000-00000000000a','Former Fin','pli-off@example.com','Finance','disabled'),
  ('03720000-0000-0000-0000-0000000000a3','03720000-0000-0000-0000-00000000000a','Eng One','pli-eng1@example.com','Engineer','active'),
  ('03720000-0000-0000-0000-0000000000a4','03720000-0000-0000-0000-00000000000a','Eng Two','pli-eng2@example.com','Engineer','active'),
  ('03720000-0000-0000-0000-0000000000a5','03720000-0000-0000-0000-00000000000a','Approver','pli-appr@example.com','Executive','active');
insert into projects (id, org_id, name, status) values
  ('03720000-0000-0000-0000-0000000000d1','03720000-0000-0000-0000-00000000000a','PLI P1','Ongoing Project'),
  ('03720000-0000-0000-0000-0000000000d2','03720000-0000-0000-0000-00000000000a','PLI P2','Ongoing Project');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config, activated_at, status) values
  ('03720000-0000-0000-0000-00000000000a','erpnext','https://erp.example.test','test-ref',
   '{"company":"Example Co","project_map":{"03720000-0000-0000-0000-0000000000d1":"ERP-A","03720000-0000-0000-0000-0000000000d2":"ERP-B"}}'::jsonb, now(), 'active');
insert into org_m365_document_settings (org_id, default_site_id, default_site_name, default_drive_id, default_drive_name, updated_by) values
  ('03720000-0000-0000-0000-00000000000a','corp.sharepoint.com,site-a,web-a','Site','drive-a','Library','03720000-0000-0000-0000-0000000000a1');
select upsert_erp_purchase_documents('03720000-0000-0000-0000-00000000000a', $$[
 {"erp_doctype":"Purchase Invoice","erp_name":"PINV-ONE","supplier":"SUP-1","currency":"IDR","grand_total":44,"net_total":40,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Order","erp_name":"PO-R","supplier":"SUP-1","currency":"IDR","grand_total":110,"net_total":100,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"PINV-R","supplier":"SUP-1","currency":"IDR","grand_total":110,"net_total":100,"erp_docstatus":1,"erp_project":"ERP-A","purchase_orders":["PO-R"],"erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Order","erp_name":"PO-S","supplier":"SUP-1","currency":"IDR","grand_total":77,"net_total":70,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"PINV-SPLIT","supplier":"SUP-1","currency":"IDR","grand_total":110,"net_total":100,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Order","erp_name":"PO-N1","supplier":"SUP-1","currency":"IDR","grand_total":110,"net_total":100,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Order","erp_name":"PO-N2","supplier":"SUP-1","currency":"IDR","grand_total":55,"net_total":50,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Order","erp_name":"PO-AP","supplier":"SUP-1","currency":"IDR","grand_total":110,"net_total":100,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Order","erp_name":"PO-IT","supplier":"SUP-1","currency":"IDR","grand_total":110,"net_total":100,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Order","erp_name":"PO-MAN","supplier":"SUP-1","currency":"IDR","grand_total":110,"net_total":100,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Order","erp_name":"PO-SP1","supplier":"SUP-1","currency":"IDR","grand_total":11,"net_total":10,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Order","erp_name":"PO-SP2","supplier":"SUP-1","currency":"IDR","grand_total":11,"net_total":10,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Order","erp_name":"PO-SP3","supplier":"SUP-1","currency":"IDR","grand_total":11,"net_total":10,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Order","erp_name":"PO-U1","supplier":"SUP-1","currency":"IDR","grand_total":33,"net_total":30,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Order","erp_name":"PO-U2","supplier":"SUP-1","currency":"IDR","grand_total":22,"net_total":20,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"}
]$$::jsonb);
-- PINV-SPLIT is recorded against both projects in ERPNext (its GL lines carry two projects).
update erp_purchase_documents set project_ids = array['03720000-0000-0000-0000-0000000000d1','03720000-0000-0000-0000-0000000000d2']::uuid[]
 where org_id = '03720000-0000-0000-0000-00000000000a' and erp_name = 'PINV-SPLIT';

insert into procurements (id, org_id, title, requested_by_id, project_id, currency, total_value, status, approved_by_id, approved_total_value) values
  ('03720000-0000-0000-0000-0000000000e1','03720000-0000-0000-0000-00000000000a','Ledger','03720000-0000-0000-0000-0000000000a1','03720000-0000-0000-0000-0000000000d1','IDR',1000,'Ordered',null,null),
  ('03720000-0000-0000-0000-0000000000e2','03720000-0000-0000-0000-00000000000a','Eng own','03720000-0000-0000-0000-0000000000a3','03720000-0000-0000-0000-0000000000d1','IDR',10,'Requested',null,null),
  ('03720000-0000-0000-0000-0000000000e3','03720000-0000-0000-0000-00000000000a','Order','03720000-0000-0000-0000-0000000000a1','03720000-0000-0000-0000-0000000000d1','IDR',100,'Ordered',null,null),
  ('03720000-0000-0000-0000-0000000000e4','03720000-0000-0000-0000-00000000000a','Other','03720000-0000-0000-0000-0000000000a1','03720000-0000-0000-0000-0000000000d1','IDR',100,'Ordered',null,null),
  ('03720000-0000-0000-0000-0000000000e5','03720000-0000-0000-0000-00000000000a','Split','03720000-0000-0000-0000-0000000000a1','03720000-0000-0000-0000-0000000000d1','IDR',500,'Ordered',null,null),
  ('03720000-0000-0000-0000-0000000000e6','03720000-0000-0000-0000-00000000000a','Empty','03720000-0000-0000-0000-0000000000a1','03720000-0000-0000-0000-0000000000d1','IDR',0,'Draft',null,null),
  ('03720000-0000-0000-0000-0000000000e7','03720000-0000-0000-0000-00000000000a','Approved','03720000-0000-0000-0000-0000000000a1','03720000-0000-0000-0000-0000000000d1','IDR',500,'Approved','03720000-0000-0000-0000-0000000000a5',500),
  ('03720000-0000-0000-0000-0000000000e8','03720000-0000-0000-0000-00000000000a','Items','03720000-0000-0000-0000-0000000000a1','03720000-0000-0000-0000-0000000000d1','IDR',0,'Draft',null,null),
  ('03720000-0000-0000-0000-0000000000e9','03720000-0000-0000-0000-00000000000a','Typed','03720000-0000-0000-0000-0000000000a1','03720000-0000-0000-0000-0000000000d1','IDR',800,'Draft',null,null),
  ('03720000-0000-0000-0000-0000000000ea','03720000-0000-0000-0000-00000000000a','Files','03720000-0000-0000-0000-0000000000a1','03720000-0000-0000-0000-0000000000d1','IDR',0,'Draft',null,null);
insert into procurement_items (org_id, procurement_id, name, quantity, rate) values
  ('03720000-0000-0000-0000-00000000000a','03720000-0000-0000-0000-0000000000e8','Cable',1,300);

set local role authenticated;
set local request.jwt.claims = '{"sub":"03720000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- ── (a) active members only; purchase-state answers only for a visible purchase ─────────────────────────────
select is(link_erp_purchase_documents('[{"erp_name":"PINV-ONE","procurement_id":"03720000-0000-0000-0000-0000000000e1"}]') #>> '{results,0,outcome}', 'link',
  'fixture: a single-project ERP invoice links into its project''s purchase');
select is(procurement_ledger_held('03720000-0000-0000-0000-0000000000e1'), 40::numeric,
  'an active Finance member reads the purchase''s ledger-held amount');
select is(procurement_gate_violation('03720000-0000-0000-0000-0000000000e2', 'Ordered'), 'awaiting_approval',
  'an active Finance member reads another requester''s purchase state');
set local request.jwt.claims = '{"sub":"03720000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(procurement_ledger_held('03720000-0000-0000-0000-0000000000e1'), null::numeric,
  'a disabled former Finance member reads no ledger-held amount, though the token is still valid');
select is(procurement_gate_violation('03720000-0000-0000-0000-0000000000e2', 'Ordered'), null,
  'a disabled former member gets no purchase state (null: the write''s own guard and RLS refuse)');
set local request.jwt.claims = '{"sub":"03720000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is(procurement_gate_violation('03720000-0000-0000-0000-0000000000e2', 'Ordered'), 'awaiting_approval',
  'an Engineer reads the state of their own purchase');
set local request.jwt.claims = '{"sub":"03720000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select is(procurement_gate_violation('03720000-0000-0000-0000-0000000000e2', 'Ordered'), null,
  'an Engineer cannot learn the state of another requester''s purchase (hidden from them by RLS)');
select is(procurement_gate_violation('03720000-0000-0000-0000-0000000000e1', 'Paid'), null,
  'an Engineer gets the same answer (null) for any purchase they cannot see');
reset role;
select set_config('request.jwt.claims', '', true);
select is(procurement_gate_violation('03720000-0000-0000-0000-0000000000e2', 'Ordered'), 'awaiting_approval',
  'the server path (no user) still reads every purchase''s state');
select is(procurement_ledger_held('03720000-0000-0000-0000-0000000000e1'), 40::numeric,
  'the server path (no user) still reads the ledger-held amount');
select is(array(
  select p.proname::text from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef
     and has_function_privilege('authenticated', p.oid, 'execute')
     and p.proname = any (array['procurement_gate','get_procurement_gates','set_procurement_gates','procurement_gate_violation',
       'procurement_ledger_held','procurement_payment_within_ceiling','link_erp_purchase_documents','unlink_erp_purchase_document',
       'link_procurement_sharepoint_item','transition_procurement','mark_erp_purchase_documents','recategorise_budget_lines',
       'activate_budget_version','link_m365_documents_batch'])
     and regexp_replace(p.prosrc, '--[^\n]*', '', 'g') !~ 'is_active_member'
   order by 1), '{}'::text[],
  'every client-callable purchase, budget and document definer added or changed in 0360-0372 checks active membership');

-- ── (b) an order and its invoices are linked one at a time ──────────────────────────────────────────────────
-- A second session holds the lock on ERP order PO-R. Linking PO-R, or an invoice billing PO-R, must wait for it.
select dblink_connect('family', format('dbname=%s user=%s password=postgres host=%s port=%s',
  current_database(), current_user, coalesce(host(inet_server_addr()), 'supabase_db_pmo-portal'), coalesce(inet_server_port(), 5432)));
select dblink_exec('family', 'begin');
select is((select count(*)::int from dblink('family',
  $q$select 1 from (select public.lock_erp_order_family('03720000-0000-0000-0000-00000000000a', array['PO-R'])) x$q$) as t(n int)), 1,
  'fixture: a second session holds the lock on ERP order PO-R');
set local lock_timeout = '300ms';
set local role authenticated;
set local request.jwt.claims = '{"sub":"03720000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(link_erp_purchase_documents('[{"erp_name":"PINV-R","procurement_id":"03720000-0000-0000-0000-0000000000e4"}]') #>> '{results,0,outcome}', 'refused',
  'an invoice billing PO-R waits for the order''s lock (it does not link while another link of that order is open)');
select is(link_erp_purchase_documents('[{"erp_name":"PO-R","procurement_id":"03720000-0000-0000-0000-0000000000e3"}]') #>> '{results,0,outcome}', 'refused',
  'the order itself waits for the same lock');
select is(link_erp_purchase_documents('[{"erp_name":"PO-S","procurement_id":"03720000-0000-0000-0000-0000000000e3"}]') #>> '{results,0,outcome}', 'link',
  'an unrelated order is not held up by that lock');
reset role;
select is((select count(*)::int from procurement_erp_links l join erp_purchase_documents d on d.id = l.erp_purchase_document_id
            where d.org_id = '03720000-0000-0000-0000-00000000000a' and d.erp_name in ('PO-R','PINV-R')), 0,
  'nothing of the PO-R family was linked while its lock was held');
select dblink_exec('family', 'rollback');
select dblink_disconnect('family');
set local lock_timeout = 0;
set local role authenticated;
set local request.jwt.claims = '{"sub":"03720000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(link_erp_purchase_documents('[{"erp_name":"PO-R","procurement_id":"03720000-0000-0000-0000-0000000000e3"}]') #>> '{results,0,outcome}', 'link',
  'once the lock is free the order links');
select is(link_erp_purchase_documents('[{"erp_name":"PINV-R","procurement_id":"03720000-0000-0000-0000-0000000000e4"}]') #>> '{results,0,reason}', 'order_linked_to_another_purchase',
  'and an invoice billing it is then refused for another purchase');

-- ── (c) a multi-project ERP invoice is not linked into one purchase ─────────────────────────────────────────
select is(link_erp_purchase_documents('[{"erp_name":"PINV-SPLIT","procurement_id":"03720000-0000-0000-0000-0000000000e5"}]') #>> '{results,0,reason}', 'document_spans_projects',
  'an invoice recorded against two projects is refused for a purchase on one of them');
select is(link_erp_purchase_documents('[{"erp_name":"PINV-SPLIT","project_id":"03720000-0000-0000-0000-0000000000d1"}]') #>> '{results,0,reason}', 'document_spans_projects',
  'and refused as a new purchase from the project tab');
select is((select total_value from procurements where id = '03720000-0000-0000-0000-0000000000e5'), 500::numeric,
  'the purchase is unchanged');

-- ── (d) an empty PMO purchase takes its total from linked ERP documents ─────────────────────────────────────
select is(link_erp_purchase_documents('[{"erp_name":"PO-N1","procurement_id":"03720000-0000-0000-0000-0000000000e6"}]') #>> '{results,0,outcome}', 'link',
  'fixture: an ERP order links into an empty PMO purchase');
select is((select total_value from procurements where id = '03720000-0000-0000-0000-0000000000e6'), 100::numeric,
  'the empty purchase takes the order''s pre-tax total');
select is((select procurement_open_commitment(p) from procurements p where p.id = '03720000-0000-0000-0000-0000000000e6'), 100::numeric,
  'so the project''s commitment includes the order');
select is(link_erp_purchase_documents('[{"erp_name":"PO-N2","procurement_id":"03720000-0000-0000-0000-0000000000e6"}]') #>> '{results,0,outcome}', 'link',
  'fixture: a second ERP order links into the same purchase');
select is((select total_value from procurements where id = '03720000-0000-0000-0000-0000000000e6'), 150::numeric,
  'a total that came from linked documents follows them (both orders)');
select is(link_erp_purchase_documents('[{"erp_name":"PO-AP","procurement_id":"03720000-0000-0000-0000-0000000000e7"}]') #>> '{results,0,outcome}', 'link',
  'fixture: an ERP order links into an approved purchase');
select is((select total_value from procurements where id = '03720000-0000-0000-0000-0000000000e7'), 500::numeric,
  'an approved purchase keeps the total its approval was decided on');
select is(link_erp_purchase_documents('[{"erp_name":"PO-IT","procurement_id":"03720000-0000-0000-0000-0000000000e8"}]') #>> '{results,0,outcome}', 'link',
  'fixture: an ERP order links into a purchase with line items');
select is((select total_value from procurements where id = '03720000-0000-0000-0000-0000000000e8'), 300::numeric,
  'a purchase with line items keeps its item total');
select is(link_erp_purchase_documents('[{"erp_name":"PO-MAN","procurement_id":"03720000-0000-0000-0000-0000000000e9"}]') #>> '{results,0,outcome}', 'link',
  'fixture: an ERP order links into a purchase with a typed total');
select is((select total_value from procurements where id = '03720000-0000-0000-0000-0000000000e9'), 800::numeric,
  'a non-zero total that did not come from linked documents is kept');

-- ── (e) SharePoint files sent with a link stay on the organisation's host ───────────────────────────────────
select is(link_erp_purchase_documents($$[{"erp_name":"PO-SP1","procurement_id":"03720000-0000-0000-0000-0000000000ea",
  "sharepoint":{"drive_id":"d","item_id":"x1","web_url":"https://files.example.com/po.pdf","name":"po.pdf","kind":"file"}}]$$) #>> '{results,0,reason}',
  'sharepoint_host_not_allowed', 'a file on another host is refused, and the document is not linked');
select is(link_erp_purchase_documents($$[{"erp_name":"PO-SP1","procurement_id":"03720000-0000-0000-0000-0000000000ea",
  "sharepoint":{"drive_id":"d","item_id":"x1","web_url":"https://corp.sharepoint.com.example.com/po.pdf","name":"po.pdf","kind":"file"}}]$$, true) #>> '{results,0,reason}',
  'sharepoint_host_not_allowed', 'a look-alike host is refused on a dry run too');
select is(link_erp_purchase_documents($$[{"erp_name":"PO-SP2","procurement_id":"03720000-0000-0000-0000-0000000000ea",
  "sharepoint":{"drive_id":"d","item_id":"x2","web_url":"https://Corp.SharePoint.com/sites/s/po.pdf","name":"po.pdf","kind":"file"}}]$$) #>> '{results,0,outcome}',
  'link', 'a file on the organisation''s own host is accepted');
select is((select array_agg(ms_item_id order by ms_item_id) from procurement_documents where procurement_id = '03720000-0000-0000-0000-0000000000ea'),
  array['x2'], 'only the own-host file was stored');

-- ── (f) unlink refreshes totals; attaching to a document whose link is gone refuses ─────────────────────────
select is((select count(*)::int from jsonb_array_elements(link_erp_purchase_documents('[{"erp_name":"PO-U1","project_id":"03720000-0000-0000-0000-0000000000d1","group":"U"},{"erp_name":"PO-U2","project_id":"03720000-0000-0000-0000-0000000000d1","group":"U"}]') -> 'results') r
            where r->>'outcome' = 'link'), 2, 'fixture: a new purchase from two ERP orders');
reset role;
select set_config('pli.u', (select l.procurement_id::text from procurement_erp_links l join erp_purchase_documents d on d.id = l.erp_purchase_document_id
                             where d.org_id = '03720000-0000-0000-0000-00000000000a' and d.erp_name = 'PO-U1'), true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"03720000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select unlink_erp_purchase_document(l.id) from procurement_erp_links l
 where l.procurement_id = current_setting('pli.u')::uuid;
select is((select total_value from procurements where id = current_setting('pli.u')::uuid), 0::numeric,
  'unlinking both documents leaves the purchase at 0');
select unlink_erp_purchase_document(l.id) from procurement_erp_links l join erp_purchase_documents d on d.id = l.erp_purchase_document_id
 where l.procurement_id = '03720000-0000-0000-0000-0000000000e6' and d.erp_name = 'PO-N2';
select is((select total_value from procurements where id = '03720000-0000-0000-0000-0000000000e6'), 100::numeric,
  'unlinking one order from the once-empty purchase leaves the other''s total');
select throws_ok(format($$ select link_procurement_sharepoint_item(%L, 'erp_document',
    (select id from erp_purchase_documents where org_id = '03720000-0000-0000-0000-00000000000a' and erp_name = 'PO-U1'),
    '{"drive_id":"d","item_id":"x9","web_url":"https://corp.sharepoint.com/u.pdf","name":"u.pdf","kind":"file"}') $$, current_setting('pli.u')),
  '23514', null, 'a file cannot be attached to an ERP document whose link is gone');
reset role;
-- With no SharePoint library chosen, a file sent with a link is refused with that reason; a link without one is not.
delete from org_m365_document_settings where org_id = '03720000-0000-0000-0000-00000000000a';
set local role authenticated;
set local request.jwt.claims = '{"sub":"03720000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(link_erp_purchase_documents($$[{"erp_name":"PO-SP3","procurement_id":"03720000-0000-0000-0000-0000000000ea"}]$$) #>> '{results,0,outcome}', 'link',
  'a link with no file needs no SharePoint library');
select is(link_erp_purchase_documents($$[{"erp_name":"PO-SP1","procurement_id":"03720000-0000-0000-0000-0000000000ea",
  "sharepoint":{"drive_id":"d","item_id":"x3","web_url":"https://corp.sharepoint.com/po.pdf","name":"po.pdf","kind":"file"}}]$$) #>> '{results,0,reason}',
  'm365_not_configured', 'a file sent with a link needs the organisation''s SharePoint library');
reset role;

-- (a) the org purchase rules are read for active members only.
update organizations set procurement_gates = '{"approval_before_order": true}' where id = '03720000-0000-0000-0000-00000000000a';
set local role authenticated;
set local request.jwt.claims = '{"sub":"03720000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(procurement_gate('03720000-0000-0000-0000-00000000000a', 'approval_before_order'), true,
  'an active member reads the organisation''s purchase rules');
set local request.jwt.claims = '{"sub":"03720000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(procurement_gate('03720000-0000-0000-0000-00000000000a', 'approval_before_order'), false,
  'a disabled former member does not read the organisation''s purchase rules');
reset role;
select * from finish();
rollback;
