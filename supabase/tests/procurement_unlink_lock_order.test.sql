-- procurement_unlink_lock_order.test.sql — 0372. Unlinking an ERP document and attaching a file to one record of a
-- purchase both take the purchase's lock first (the lock linking and record inserts already take), then re-read the
-- link under it. So two unlinks on one purchase compute its total one after the other, and a file attached to an ERP
-- document either sees the link (and unlink then moves the file to the purchase) or sees it gone (and is refused).
--
-- Proof in TWO real sessions: a second session (dblink) holds the purchase row with FOR NO KEY UPDATE — the lock an
-- ordinary update of the purchase takes. It does not conflict with the key-share lock a foreign-key check takes, so
-- only an explicit purchase lock waits for it. Under a short lock_timeout each guarded call must wait (55P03); remove
-- the purchase lock from either function and the call goes through instead.
--
-- Fixtures must be visible to the second session, so that session creates and commits them, and deletes them at the
-- end (a pre-clean at the top heals a run that stopped half-way). This session never holds a lock on them: every
-- attempt runs through pg_temp.attempt, which rolls its own work back.
begin;
select plan(5);

create extension if not exists dblink;

create function pg_temp.attempt(p_sql text) returns text language plpgsql as $$
begin
  begin
    execute p_sql;
    raise exception using errcode = 'PLI99', message = 'completed';
  exception when others then
    return sqlstate;
  end;
end $$;

select dblink_connect('purchase', format('dbname=%s user=%s password=postgres host=%s port=%s',
  current_database(), current_user, coalesce(host(inet_server_addr()), 'supabase_db_pmo-portal'), coalesce(inet_server_port(), 5432)));

select dblink_exec('purchase', $cl$
  delete from procurement_documents where org_id = '03720000-0000-0000-0000-00000000000c';
  delete from procurement_erp_links where org_id = '03720000-0000-0000-0000-00000000000c';
  delete from procurement_status_events where org_id = '03720000-0000-0000-0000-00000000000c';
  delete from procurements where org_id = '03720000-0000-0000-0000-00000000000c';
  delete from erp_purchase_documents where org_id = '03720000-0000-0000-0000-00000000000c';
  delete from org_m365_document_settings where org_id = '03720000-0000-0000-0000-00000000000c';
  delete from profiles where org_id = '03720000-0000-0000-0000-00000000000c';
  delete from organizations where id = '03720000-0000-0000-0000-00000000000c';
  delete from auth.users where id = '03720000-0000-0000-0000-0000000000c1';
$cl$);
select dblink_exec('purchase', $fx$
  insert into organizations (id, name, default_currency) values ('03720000-0000-0000-0000-00000000000c','PLO C','IDR');
  insert into auth.users (id, email) values ('03720000-0000-0000-0000-0000000000c1','plo-fin@example.com');
  insert into profiles (id, org_id, full_name, email, role, status) values
    ('03720000-0000-0000-0000-0000000000c1','03720000-0000-0000-0000-00000000000c','Fin','plo-fin@example.com','Finance','active');
  insert into org_m365_document_settings (org_id, default_site_id, default_site_name, default_drive_id, default_drive_name, updated_by) values
    ('03720000-0000-0000-0000-00000000000c','corp.sharepoint.com,site-c,web-c','Site','drive-c','Library','03720000-0000-0000-0000-0000000000c1');
  insert into erp_purchase_documents (id, org_id, erp_doctype, erp_name, supplier, currency, grand_total, net_total, erp_docstatus, erp_modified) values
    ('03720000-0000-0000-0000-0000000000f1','03720000-0000-0000-0000-00000000000c','Purchase Order','PLO-PO-1','SUP-1','IDR',110,100,1,'2026-02-01');
  -- A typed total (not the linked documents' 100): unlinking leaves it as it is, so no total refresh writes the row and
  -- only the explicit purchase lock can make unlink wait.
  insert into procurements (id, org_id, title, requested_by_id, currency, total_value, status) values
    ('03720000-0000-0000-0000-0000000000e1','03720000-0000-0000-0000-00000000000c','PLO purchase','03720000-0000-0000-0000-0000000000c1','IDR',999,'Ordered');
  insert into procurement_erp_links (id, org_id, procurement_id, erp_purchase_document_id) values
    ('03720000-0000-0000-0000-0000000000b1','03720000-0000-0000-0000-00000000000c','03720000-0000-0000-0000-0000000000e1','03720000-0000-0000-0000-0000000000f1');
$fx$);

select dblink_exec('purchase', 'begin');
select is((select count(*)::int from dblink('purchase',
  $q$select 1 from procurements where id = '03720000-0000-0000-0000-0000000000e1' for no key update$q$) as t(n int)), 1,
  'fixture: a second session holds the purchase row (FOR NO KEY UPDATE)');

set local lock_timeout = '300ms';
set local role authenticated;
set local request.jwt.claims = '{"sub":"03720000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select is(pg_temp.attempt($$ select unlink_erp_purchase_document('03720000-0000-0000-0000-0000000000b1') $$), '55P03',
  'unlink waits for the purchase lock before it touches the link');
select is(pg_temp.attempt($$ select link_procurement_sharepoint_item('03720000-0000-0000-0000-0000000000e1', 'erp_document',
    '03720000-0000-0000-0000-0000000000f1',
    '{"drive_id":"d","item_id":"plo-1","web_url":"https://corp.sharepoint.com/po.pdf","name":"po.pdf","kind":"file"}') $$), '55P03',
  'a file attached to one ERP document of the purchase waits for the same lock');
select is(pg_temp.attempt($$ select link_procurement_sharepoint_item('03720000-0000-0000-0000-0000000000e1', null, null,
    '{"drive_id":"d","item_id":"plo-2","web_url":"https://corp.sharepoint.com/all.pdf","name":"all.pdf","kind":"file"}') $$), 'PLI99',
  'a purchase-level file does not wait (only record-targeted files re-read a record under the lock)');
reset role;
set local lock_timeout = 0;
select dblink_exec('purchase', 'rollback');
select is((select count(*)::int from procurement_erp_links where id = '03720000-0000-0000-0000-0000000000b1'), 1,
  'the link is still there: nothing ran past the held lock');

select dblink_exec('purchase', $cl$
  delete from procurement_documents where org_id = '03720000-0000-0000-0000-00000000000c';
  delete from procurement_erp_links where org_id = '03720000-0000-0000-0000-00000000000c';
  delete from procurement_status_events where org_id = '03720000-0000-0000-0000-00000000000c';
  delete from procurements where org_id = '03720000-0000-0000-0000-00000000000c';
  delete from erp_purchase_documents where org_id = '03720000-0000-0000-0000-00000000000c';
  delete from org_m365_document_settings where org_id = '03720000-0000-0000-0000-00000000000c';
  delete from profiles where org_id = '03720000-0000-0000-0000-00000000000c';
  delete from organizations where id = '03720000-0000-0000-0000-00000000000c';
  delete from auth.users where id = '03720000-0000-0000-0000-0000000000c1';
$cl$);
select dblink_disconnect('purchase');
select * from finish();
rollback;
