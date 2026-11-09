-- #1607 blocker B: a party link rewinds the revenue cursors (Odoo here; the ERPNext upsert is guarded by a trigger, last cases); a pass already in flight must not write its old cursor over the
-- rewind. Page and census writes take the cursor the pass last saw and keep the stored one when it has since changed.
begin;
select plan(12);

insert into organizations (id, name) values ('a7510000-0000-0000-0000-000000000001','Rewind A');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at) values
 ('a7510000-0000-0000-0000-000000000001','odoo','https://odoo.example.test','fixture-a','active','{}', now());
insert into external_domain_ownership (org_id, external_tier, domain) values ('a7510000-0000-0000-0000-000000000001','odoo','revenue');
insert into external_sync_watermarks (org_id, external_tier, domain, watermark_cursor) values
 ('a7510000-0000-0000-0000-000000000001','odoo','revenue:sales-invoice','c0');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.apply_odoo_revenue_page('a7510000-0000-0000-0000-000000000001','sales-invoice','[]'::jsonb,'c1','c0'), 0,
  'a pass that still holds the stored cursor advances it');
reset role;
select is((select watermark_cursor from external_sync_watermarks where org_id='a7510000-0000-0000-0000-000000000001' and domain='revenue:sales-invoice'),'c1',
  'the cursor moved to the page cursor');

-- the party link rewinds while the pass (which last saw c1) is mid-walk
update external_sync_watermarks set watermark_cursor = '' where org_id='a7510000-0000-0000-0000-000000000001' and domain='revenue:sales-invoice';
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.apply_odoo_revenue_page('a7510000-0000-0000-0000-000000000001','sales-invoice', $$[
  {"external_id":"41","name":"INV-C-41","source_write_date":"2026-11-02 10:00:00",
   "attrs":{"state":"posted","docstatus":1,"status":"Unpaid","partner":"41","partner_name":"C","date":"2026-11-01","currency":"IDR","amount_total":"100.00","residual":"60.00"}}
]$$::jsonb,'c2','c1'),1,'the stale pass still applies its page');
reset role;
select is((select watermark_cursor from external_sync_watermarks where org_id='a7510000-0000-0000-0000-000000000001' and domain='revenue:sales-invoice'),'',
  'but its cursor does not overwrite the rewind');
select is((select count(*)::int from revenue_erp_mirror where org_id='a7510000-0000-0000-0000-000000000001' and external_ref='account.move:41'),1,
  'the rows of the stale page are kept (the re-read applies them again, idempotently)');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.finish_odoo_revenue_census('a7510000-0000-0000-0000-000000000001','sales-invoice',now(),'c3','c2'),0,
  'a census that began before the rewind finishes');
reset role;
select is((select watermark_cursor from external_sync_watermarks where org_id='a7510000-0000-0000-0000-000000000001' and domain='revenue:sales-invoice'),'',
  'and does not overwrite the rewind either');

-- ERPNext: the sweep upserts the cursor with the value it last saw (expected_cursor); a rewind in between keeps.
insert into external_sync_watermarks (org_id, external_tier, domain, watermark_cursor) values
 ('a7510000-0000-0000-0000-000000000001','erpnext','revenue::Sales Invoice','e0');
insert into external_sync_watermarks as w (org_id, external_tier, domain, watermark_cursor, expected_cursor)
 values ('a7510000-0000-0000-0000-000000000001','erpnext','revenue::Sales Invoice','e1','e0')
 on conflict (org_id, external_tier, domain) do update set watermark_cursor = excluded.watermark_cursor, expected_cursor = excluded.expected_cursor;
select is((select watermark_cursor from external_sync_watermarks where org_id='a7510000-0000-0000-0000-000000000001' and domain='revenue::Sales Invoice'),'e1',
  'an ERPNext upsert that still holds the stored cursor advances it');
update external_sync_watermarks set watermark_cursor = '' where org_id='a7510000-0000-0000-0000-000000000001' and domain='revenue::Sales Invoice';
insert into external_sync_watermarks as w (org_id, external_tier, domain, watermark_cursor, expected_cursor)
 values ('a7510000-0000-0000-0000-000000000001','erpnext','revenue::Sales Invoice','e2','e1')
 on conflict (org_id, external_tier, domain) do update set watermark_cursor = excluded.watermark_cursor, expected_cursor = excluded.expected_cursor;
select is((select watermark_cursor from external_sync_watermarks where org_id='a7510000-0000-0000-0000-000000000001' and domain='revenue::Sales Invoice'),'',
  'an ERPNext upsert from before the rewind does not overwrite it');
select is((select expected_cursor from external_sync_watermarks where org_id='a7510000-0000-0000-0000-000000000001' and domain='revenue::Sales Invoice'),null,
  'the expectation is never stored');
insert into external_sync_watermarks as w (org_id, external_tier, domain, watermark_cursor)
 values ('a7510000-0000-0000-0000-000000000001','erpnext','revenue::Sales Invoice','e3')
 on conflict (org_id, external_tier, domain) do update set watermark_cursor = excluded.watermark_cursor;
select is((select watermark_cursor from external_sync_watermarks where org_id='a7510000-0000-0000-0000-000000000001' and domain='revenue::Sales Invoice'),'e3',
  'a writer that states no expectation (another feed) writes as before');
select is((select expected_cursor from external_sync_watermarks where org_id='a7510000-0000-0000-0000-000000000001' and domain='revenue::Sales Invoice'),null,
  'and leaves no expectation behind');

select * from finish();
rollback;
