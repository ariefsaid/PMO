-- #1505 O2 P7 (migration 0506): the Odoo purchase mirror columns are machine-written only.
-- AC-OPP-070 (FR-OPP-080, 084): org A's user cannot write any purchase mirror column; a service-role page apply carrying
-- org B's context cannot touch org A's rows; force row level security stays on every mirror table.
begin;
select plan(27);

insert into organizations (id, name) values
 ('a5060000-0000-0000-0000-000000000001','Guard A flipped'),
 ('a5060000-0000-0000-0000-000000000002','Guard B flipped'),
 ('a5060000-0000-0000-0000-000000000003','Guard C native');
insert into auth.users (id, email) values
 ('a5060000-0000-0000-0000-0000000000a1','a506-a-fin@example.com'),
 ('a5060000-0000-0000-0000-0000000000b1','a506-b-fin@example.com'),
 ('a5060000-0000-0000-0000-0000000000c1','a506-c-fin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('a5060000-0000-0000-0000-0000000000a1','a5060000-0000-0000-0000-000000000001','A Fin','a506-a-fin@example.com','Finance','active'),
 ('a5060000-0000-0000-0000-0000000000b1','a5060000-0000-0000-0000-000000000002','B Fin','a506-b-fin@example.com','Finance','active'),
 ('a5060000-0000-0000-0000-0000000000c1','a5060000-0000-0000-0000-000000000003','C Fin','a506-c-fin@example.com','Finance','active');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at) values
 ('a5060000-0000-0000-0000-000000000001','odoo','https://o.example.test','a506_a','active','{"odoo_company_id":1}', now()),
 ('a5060000-0000-0000-0000-000000000002','odoo','https://o.example.test','a506_b','active','{"odoo_company_id":1}', now());
insert into external_domain_ownership (org_id, external_tier, domain) values
 ('a5060000-0000-0000-0000-000000000001','odoo','procurement'),
 ('a5060000-0000-0000-0000-000000000002','odoo','procurement');
insert into procurements (id, org_id, title, requested_by_id, currency, total_value, status) values
 ('a5060000-0000-0000-0000-0000000000f1','a5060000-0000-0000-0000-000000000001','A case','a5060000-0000-0000-0000-0000000000a1','IDR',0,'Draft'),
 ('a5060000-0000-0000-0000-0000000000f2','a5060000-0000-0000-0000-000000000002','B case','a5060000-0000-0000-0000-0000000000b1','IDR',0,'Draft'),
 ('a5060000-0000-0000-0000-0000000000f3','a5060000-0000-0000-0000-000000000003','C case','a5060000-0000-0000-0000-0000000000c1','IDR',0,'Draft');
insert into purchase_orders (id, org_id, procurement_id, status, amount, currency) values
 ('a5060000-0000-0000-0000-0000000000e1','a5060000-0000-0000-0000-000000000001','a5060000-0000-0000-0000-0000000000f1','Issued',100,'IDR');
insert into procurement_receipts (id, org_id, procurement_id, status) values
 ('a5060000-0000-0000-0000-0000000000e2','a5060000-0000-0000-0000-000000000001','a5060000-0000-0000-0000-0000000000f1','Partial');
insert into procurement_invoices (id, org_id, procurement_id, status, amount, currency, tax_treatment, tax_amount) values
 ('a5060000-0000-0000-0000-0000000000e3','a5060000-0000-0000-0000-000000000001','a5060000-0000-0000-0000-0000000000f1','Received',100,'IDR','inclusive',0);
insert into payments (id, org_id, procurement_id, status, amount, currency) values
 ('a5060000-0000-0000-0000-0000000000e4','a5060000-0000-0000-0000-000000000001','a5060000-0000-0000-0000-0000000000f1','Scheduled',10,'IDR');

-- Today no user role can insert or update these tables at all (0075 and its successors). The guard must hold even if a later
-- grant widens that, so the statements below run with the widest grant a regression could introduce (rolled back with the test).
grant insert, update on public.purchase_orders, public.procurement_receipts, public.procurement_invoices, public.payments to authenticated;

-- the columns exist on all four tables, and force row level security is intact on them and on the native-document table
select is((select count(*) from information_schema.columns where table_schema='public'
            and table_name in ('purchase_orders','procurement_receipts','procurement_invoices','payments')
            and column_name in ('erp_state','erp_attention','erp_read_at','erp_census_seen_at')), 16::bigint,
  'AC-OPP-070 the four mirror tables carry the four Odoo mirror columns');
select is((select count(*) from pg_class where relnamespace='public'::regnamespace and relforcerowsecurity
            and relname in ('purchase_orders','procurement_receipts','procurement_invoices','payments','erp_purchase_documents','external_refs')), 6::bigint,
  'AC-OPP-070 force row level security is intact on every mirror table');

-- A user JWT of the flipped org cannot change any mirror column (each statement is refused, the row is unchanged)
set local role authenticated;
set local request.jwt.claims = '{"sub":"a5060000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$update purchase_orders set erp_state = 'purchase' where id = 'a5060000-0000-0000-0000-0000000000e1'$$, '42501', 'purchase_orders Odoo mirror columns are machine-written', 'AC-OPP-070 a user cannot set purchase_orders.erp_state');
select throws_ok($$update purchase_orders set erp_attention = 'x' where id = 'a5060000-0000-0000-0000-0000000000e1'$$, '42501', 'purchase_orders Odoo mirror columns are machine-written', 'AC-OPP-070 a user cannot set purchase_orders.erp_attention');
select throws_ok($$update procurement_receipts set erp_state = 'done' where id = 'a5060000-0000-0000-0000-0000000000e2'$$, '42501', 'procurement_receipts Odoo mirror columns are machine-written', 'AC-OPP-070 a user cannot set procurement_receipts.erp_state');
select throws_ok($$update procurement_invoices set erp_state = 'posted' where id = 'a5060000-0000-0000-0000-0000000000e3'$$, '42501', 'procurement_invoices Odoo mirror columns are machine-written', 'AC-OPP-070 a user cannot set procurement_invoices.erp_state');
select throws_ok($$update procurement_invoices set erp_read_at = now() where id = 'a5060000-0000-0000-0000-0000000000e3'$$, '42501', 'procurement_invoices Odoo mirror columns are machine-written', 'AC-OPP-070 a user cannot set procurement_invoices.erp_read_at');
select throws_ok($$update payments set erp_census_seen_at = now() where id = 'a5060000-0000-0000-0000-0000000000e4'$$, '42501', 'payments Odoo mirror columns are machine-written', 'AC-OPP-070 a user cannot set payments.erp_census_seen_at');
select throws_ok($$update payments set erp_state = 'posted' where id = 'a5060000-0000-0000-0000-0000000000e4'$$, '42501', 'payments Odoo mirror columns are machine-written', 'AC-OPP-070 a user cannot set payments.erp_state');
-- INSERT: org C is not flipped, so no RLS policy refuses these; only the guard stops a user stating a mirror column.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a5060000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select throws_ok($$insert into procurement_invoices (org_id, procurement_id, status, amount, currency, tax_treatment, tax_amount, erp_state)
  values ('a5060000-0000-0000-0000-000000000003','a5060000-0000-0000-0000-0000000000f3','Received',1,'IDR','inclusive',0,'posted')$$,
  '42501', 'procurement_invoices Odoo mirror columns are machine-written', 'AC-OPP-070 a user cannot insert a bill that states a mirror column');
select throws_ok($$insert into procurement_invoices (org_id, procurement_id, status, amount, currency, tax_treatment, tax_amount, erp_attention)
  values ('a5060000-0000-0000-0000-000000000003','a5060000-0000-0000-0000-0000000000f3','Received',1,'IDR','inclusive',0,'x')$$,
  '42501', 'procurement_invoices Odoo mirror columns are machine-written', 'AC-OPP-070 a user cannot insert a bill that states a mirror attention reason');
select throws_ok($$insert into procurement_receipts (org_id, procurement_id, status, erp_state)
  values ('a5060000-0000-0000-0000-000000000003','a5060000-0000-0000-0000-0000000000f3','Partial','done')$$,
  '42501', 'procurement_receipts Odoo mirror columns are machine-written', 'AC-OPP-070 a user cannot insert a receipt that states a mirror column');
select lives_ok($$insert into procurement_invoices (org_id, procurement_id, status, amount, currency, tax_treatment, tax_amount)
  values ('a5060000-0000-0000-0000-000000000003','a5060000-0000-0000-0000-0000000000f3','Received',1,'IDR','inclusive',0)$$,
  'AC-OPP-070 an ordinary native bill insert is unaffected');
select lives_ok($$insert into procurement_receipts (org_id, procurement_id, status)
  values ('a5060000-0000-0000-0000-000000000003','a5060000-0000-0000-0000-0000000000f3','Partial')$$,
  'AC-OPP-070 an ordinary native receipt insert is unaffected');
reset role;

-- A SECURITY DEFINER function a user calls on their own behalf is the same user: the guard follows the session role, not the owner.
create function public.a506_definer_write() returns void language sql security definer set search_path = public as
  $$update public.purchase_orders set erp_state = 'x' where id = 'a5060000-0000-0000-0000-0000000000e1'$$;
grant execute on function public.a506_definer_write() to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a5060000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.a506_definer_write()$$, '42501', 'purchase_orders Odoo mirror columns are machine-written', 'AC-OPP-070 a definer function a user calls cannot write a mirror column either');
reset role;

-- the rows are unchanged
select is((select erp_state from purchase_orders where id='a5060000-0000-0000-0000-0000000000e1'), null, 'AC-OPP-070 the refused updates changed nothing');

-- the service role (the sweep) may write them
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$update purchase_orders set erp_state = 'purchase', erp_read_at = now() where id = 'a5060000-0000-0000-0000-0000000000e1'$$, 'AC-OPP-070 the service role may write the mirror columns');
reset role;

-- tenancy of the page apply: the org comes from the binding's context, never from the page. Org B's page names org A's ref.
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values
 ('a5060000-0000-0000-0000-000000000001','procurement','a5060000-0000-0000-0000-0000000000e1','odoo','purchase.order:7'),
 ('a5060000-0000-0000-0000-000000000001','procurement','a5060000-0000-0000-0000-0000000000e3','odoo','account.move:9');
update purchase_orders set erp_state = null, erp_docstatus = null, erp_modified = null where id = 'a5060000-0000-0000-0000-0000000000e1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a5060000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.apply_odoo_purchase_page('a5060000-0000-0000-0000-000000000001','purchase-order','[]'::jsonb,'c')$$, '42501', null, 'AC-OPP-070 a user JWT cannot call the page apply');
select throws_ok($$select public.mark_odoo_purchase_census_seen('a5060000-0000-0000-0000-000000000001','purchase-order', now(), array['7'])$$, '42501', null, 'AC-OPP-070 a user JWT cannot call the census marker');
select throws_ok($$select public.finish_odoo_purchase_census('a5060000-0000-0000-0000-000000000001','purchase-order', now(), 'c')$$, '42501', null, 'AC-OPP-070 a user JWT cannot call the census finish');
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.apply_odoo_purchase_page('a5060000-0000-0000-0000-000000000002', 'purchase-order', $$[
  {"external_id":"7","name":"P00007","active":true,"source_write_date":"2026-11-01 10:00:00","org_id":"a5060000-0000-0000-0000-000000000001",
   "attrs":{"state":"purchase","status":"Issued","docstatus":1,"cancelled":false,"amount_total":"500.00","partner":"1","partner_name":"V","date":"2026-11-01"}}]$$::jsonb, 'cb');
reset role;
select is((select erp_state from purchase_orders where id='a5060000-0000-0000-0000-0000000000e1'), null, 'AC-OPP-070 org B''s page cannot touch org A''s purchase order');
select is((select count(*) from erp_purchase_documents where org_id='a5060000-0000-0000-0000-000000000001'), 0::bigint, 'AC-OPP-070 a body org_id is ignored: nothing lands in org A');
select is((select count(*) from erp_purchase_documents where org_id='a5060000-0000-0000-0000-000000000002' and external_ref='purchase.order:7'), 1::bigint, 'AC-OPP-070 the page lands in the verified binding''s org only');
select is((select watermark_cursor from external_sync_watermarks where org_id='a5060000-0000-0000-0000-000000000002' and domain='purchase:purchase-order'), 'cb', 'AC-OPP-070 the cursor is org B''s');
select is((select count(*) from external_sync_watermarks where org_id='a5060000-0000-0000-0000-000000000001' and domain like 'purchase:%'), 0::bigint, 'AC-OPP-070 org A''s cursor did not move');

-- an org with no activated Odoo binding cannot apply a page
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select public.apply_odoo_purchase_page('a5060000-0000-0000-0000-000000000003','bill','[]'::jsonb,'c')$$, 'P0001', null, 'AC-OPP-070 an org without an activated Odoo binding is refused');
select throws_ok($$select public.apply_odoo_purchase_page('a5060000-0000-0000-0000-000000000001','nonsense','[]'::jsonb,'c')$$, '22023', null, 'AC-OPP-070 an unknown domain is refused');
reset role;

select * from finish();
rollback;
