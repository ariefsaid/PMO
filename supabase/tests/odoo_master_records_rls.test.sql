-- Odoo directory mirror (#1504 S4, migration 0421): org-isolated, role-gated reads; machine-only writes; the page-apply
-- RPC owns the cursor; census tombstones; reset of one kind; the sweep tick.
begin;
select plan(57);

insert into organizations (id, name) values
 ('a4210000-0000-0000-0000-000000000001','Odoo Mirror A'),
 ('a4210000-0000-0000-0000-000000000002','Odoo Mirror B');
insert into auth.users (id, email) values
 ('a4210000-0000-0000-0000-0000000000a1','a421-admin@example.com'),
 ('a4210000-0000-0000-0000-0000000000f1','a421-finance@example.com'),
 ('a4210000-0000-0000-0000-0000000000e1','a421-eng@example.com'),
 ('a4210000-0000-0000-0000-0000000000d1','a421-disabled@example.com'),
 ('a4210000-0000-0000-0000-000000000099','a421-operator@example.com'),
 ('a4210000-0000-0000-0000-0000000000b1','a421-b-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('a4210000-0000-0000-0000-0000000000a1','a4210000-0000-0000-0000-000000000001','Admin','a421-admin@example.com','Admin','active'),
 ('a4210000-0000-0000-0000-0000000000f1','a4210000-0000-0000-0000-000000000001','Finance','a421-finance@example.com','Finance','active'),
 ('a4210000-0000-0000-0000-0000000000e1','a4210000-0000-0000-0000-000000000001','Engineer','a421-eng@example.com','Engineer','active'),
 ('a4210000-0000-0000-0000-0000000000d1','a4210000-0000-0000-0000-000000000001','Disabled','a421-disabled@example.com','Admin','disabled'),
 ('a4210000-0000-0000-0000-000000000099','a4210000-0000-0000-0000-000000000002','Operator','a421-operator@example.com','Engineer','active'),
 ('a4210000-0000-0000-0000-0000000000b1','a4210000-0000-0000-0000-000000000002','B Admin','a421-b-admin@example.com','Admin','active');
insert into platform_operators (user_id) values ('a4210000-0000-0000-0000-000000000099');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at) values
 ('a4210000-0000-0000-0000-000000000001','odoo','https://o.example.test','a421_a','active','{"odoo_company_id":1}', now()),
 ('a4210000-0000-0000-0000-000000000002','odoo','https://o.example.test','a421_b','active','{"odoo_company_id":1}', now());

-- Seed as owner.
insert into external_master_records (org_id, external_tier, kind, external_id, name, source_write_date) values
 ('a4210000-0000-0000-0000-000000000001','odoo','product','1','A Widget','2026-10-31 10:00:00'),
 ('a4210000-0000-0000-0000-000000000001','odoo','account','10','A Payable','2026-10-31 10:00:00'),
 ('a4210000-0000-0000-0000-000000000002','odoo','product','1','B Widget','2026-10-31 10:00:00'),
 ('a4210000-0000-0000-0000-000000000002','odoo','account','10','B Payable','2026-10-31 10:00:00');

-- AC-ODC-020 reads: own org only; accounts, taxes and partners only for Admin, Executive and Finance.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a4210000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select results_eq($$select kind, external_id, name from external_master_records order by kind$$,
  $$values ('product'::text,'1'::text,'A Widget'::text)$$, 'AC-ODC-020 an Engineer sees own-org products only, no accounts');
set local request.jwt.claims = '{"sub":"a4210000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select results_eq($$select kind, name from external_master_records order by kind$$,
  $$values ('account'::text,'A Payable'::text), ('product','A Widget')$$, 'AC-ODC-020 Finance sees own-org accounts, never the other org');
set local request.jwt.claims = '{"sub":"a4210000-0000-0000-0000-0000000000d1","role":"authenticated"}';
select is((select count(*)::int from external_master_records), 0, 'AC-ODC-020 a disabled member sees nothing');

-- AC-ODC-020 writes: a user JWT cannot insert, update or delete, not even an Admin.
set local request.jwt.claims = '{"sub":"a4210000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$insert into external_master_records (org_id, external_tier, kind, external_id, name, source_write_date)
  values ('a4210000-0000-0000-0000-000000000001','odoo','product','9','X','2026-10-31 10:00:00')$$, '42501', null, 'AC-ODC-020 Admin insert is denied');
select throws_ok($$update external_master_records set name = 'X'$$, '42501', null, 'AC-ODC-020 Admin update is denied');
select throws_ok($$delete from external_master_records$$, '42501', null, 'AC-ODC-020 Admin delete is denied');
select throws_ok($$select public.apply_odoo_master_page('a4210000-0000-0000-0000-000000000001','product','[]','c')$$, '42501', null,
  'AC-ODC-020 apply_odoo_master_page is denied to a user JWT');
reset role;

-- Every new RPC is service-role-only.
select is(has_function_privilege('authenticated', f, 'execute'), false, 'AC-ODC-020 ' || f || ' is not executable by authenticated')
  from unnest(array['public.apply_odoo_master_page(uuid,text,jsonb,text)', 'public.mark_odoo_census_seen(uuid,text,timestamptz,text[])',
                    'public.finish_odoo_census(uuid,text,timestamptz,text)', 'public.reset_odoo_sync_kind(uuid,text,uuid)', 'public.odoo_sweep_tick()']) f;
select is(has_function_privilege('anon', f, 'execute'), false, 'AC-ODC-020 ' || f || ' is not executable by anon')
  from unnest(array['public.apply_odoo_master_page(uuid,text,jsonb,text)', 'public.mark_odoo_census_seen(uuid,text,timestamptz,text[])',
                    'public.finish_odoo_census(uuid,text,timestamptz,text)', 'public.reset_odoo_sync_kind(uuid,text,uuid)', 'public.odoo_sweep_tick()']) f;
select is(has_function_privilege('service_role', f, 'execute'), true, 'AC-ODC-020 ' || f || ' is executable by service_role')
  from unnest(array['public.apply_odoo_master_page(uuid,text,jsonb,text)', 'public.mark_odoo_census_seen(uuid,text,timestamptz,text[])',
                    'public.finish_odoo_census(uuid,text,timestamptz,text)', 'public.reset_odoo_sync_kind(uuid,text,uuid)']) f;

-- AC-ODC-020 a service write for org A whose external id equals one of B's leaves B's row alone.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.apply_odoo_master_page('a4210000-0000-0000-0000-000000000001','product',
  '[{"external_id":"1","name":"A Widget v2","source_write_date":"2026-10-31 11:00:00"}]','c0'), 1, 'AC-ODC-020 the service write lands in org A');
select is((select name from external_master_records where org_id='a4210000-0000-0000-0000-000000000002' and kind='product' and external_id='1'),
  'B Widget', 'AC-ODC-020 org B''s row with the same external id is unchanged');
select throws_ok($$select public.apply_odoo_master_page('a4210000-0000-0000-0000-0000000000ff','product','[]','c')$$, 'P0001', null,
  'apply_odoo_master_page refuses an org without an activated Odoo binding');
select throws_ok($$select public.apply_odoo_master_page('a4210000-0000-0000-0000-000000000001','bogus','[]','c')$$, '22023', null,
  'apply_odoo_master_page refuses an unknown kind');
-- The org stamp leaves a service insert's org alone: without org_id it lands in the default org, so every RPC passes org_id.
insert into external_master_records (external_tier, kind, external_id, name, source_write_date) values ('odoo','uom','a421','Unit','2026-10-31 10:00:00');
select is((select org_id from external_master_records where external_id='a421'), '00000000-0000-0000-0000-000000000001'::uuid,
  'stamp_org_id keeps the column default for a service insert with no org_id');
delete from external_master_records where external_id='a421';

-- AC-ODC-021 (DB half): the page and its cursor commit together; replays are no-ops; older never overwrites newer.
select is(public.apply_odoo_master_page('a4210000-0000-0000-0000-000000000001','product',
  '[{"external_id":"p1","name":"One","code":"P-1","source_write_date":"2026-10-31 10:00:00"},
    {"external_id":"p2","name":"Two","source_write_date":"2026-10-31 10:00:00","attrs":{"uom_id":"1"}}]','C1'), 2, 'AC-ODC-021 a two-row page applies two rows');
select is((select watermark_cursor from external_sync_watermarks where org_id='a4210000-0000-0000-0000-000000000001' and external_tier='odoo' and domain='master:product'),
  'C1', 'AC-ODC-021 the page writes its cursor');
create temp table a421_before as select external_id, name, source_write_date from external_master_records
 where org_id='a4210000-0000-0000-0000-000000000001' and kind='product';
select public.apply_odoo_master_page('a4210000-0000-0000-0000-000000000001','product',
  '[{"external_id":"p1","name":"One","code":"P-1","source_write_date":"2026-10-31 10:00:00"},
    {"external_id":"p2","name":"Two","source_write_date":"2026-10-31 10:00:00","attrs":{"uom_id":"1"}}]','C1');
select results_eq($$select external_id, name, source_write_date from external_master_records
  where org_id='a4210000-0000-0000-0000-000000000001' and kind='product' order by external_id$$,
  $$select * from a421_before order by external_id$$, 'AC-ODC-021 a replayed page leaves identical rows');
select public.apply_odoo_master_page('a4210000-0000-0000-0000-000000000001','product',
  '[{"external_id":"p1","name":"Stale","source_write_date":"2026-10-30 09:00:00"}]','C1');
select is((select name from external_master_records where org_id='a4210000-0000-0000-0000-000000000001' and kind='product' and external_id='p1'),
  'One', 'AC-ODC-021 an older write_date never overwrites a newer row');
select throws_ok($$select public.apply_odoo_master_page('a4210000-0000-0000-0000-000000000001','product',
  '[{"external_id":"p3","name":"Three","source_write_date":"2026-10-31 10:00:00"},{"external_id":"p4","source_write_date":"2026-10-31 10:00:00"}]','C2')$$,
  '23502', null, 'AC-ODC-021 a page with a nameless row fails');
select is((select watermark_cursor from external_sync_watermarks where org_id='a4210000-0000-0000-0000-000000000001' and external_tier='odoo' and domain='master:product'),
  'C1', 'AC-ODC-021 a failed page leaves the cursor where it was');
select is((select count(*)::int from external_master_records where org_id='a4210000-0000-0000-0000-000000000001' and external_id='p3'), 0,
  'AC-ODC-021 a failed page writes no row');

-- AC-ODC-023 (DB half): the census tombstones what Odoo no longer returns, keeps it, and a returning id clears it.
select public.apply_odoo_master_page('a4210000-0000-0000-0000-000000000001','product',
  '[{"external_id":"p3","name":"Three","source_write_date":"2026-10-31 10:00:00"},
    {"external_id":"p4","name":"Four","active":false,"source_write_date":"2026-10-31 10:00:00"}]','C2');
select public.mark_odoo_census_seen('a4210000-0000-0000-0000-000000000001','product','2026-11-01 00:00:00+00', array['1','p1','p2','p4']);
select is(public.finish_odoo_census('a4210000-0000-0000-0000-000000000001','product','2026-11-01 00:00:00+00','C3'), 1,
  'AC-ODC-023 the census tombstones exactly the row Odoo no longer returns');
select ok((select tombstoned_at is not null from external_master_records where org_id='a4210000-0000-0000-0000-000000000001' and kind='product' and external_id='p3'),
  'AC-ODC-023 the unseen row is tombstoned and still present');
select is((select count(*)::int from external_master_records where org_id='a4210000-0000-0000-0000-000000000001' and kind='product'
  and external_id in ('1','p1','p2','p4') and tombstoned_at is null), 4, 'AC-ODC-023 the seen rows are not tombstoned');
select is((select active from external_master_records where org_id='a4210000-0000-0000-0000-000000000001' and kind='product' and external_id='p4'),
  false, 'AC-ODC-023 an archived row seen by the census stays inactive, not tombstoned');
select is((select count(*)::int from external_master_records where org_id='a4210000-0000-0000-0000-000000000001' and kind='account' and tombstoned_at is not null), 0,
  'AC-ODC-023 a census of one kind never touches another kind');
select is((select tombstoned_at from external_master_records where org_id='a4210000-0000-0000-0000-000000000002' and kind='product' and external_id='1'),
  null, 'AC-ODC-023 a census for org A never touches org B');
select is((select watermark_cursor from external_sync_watermarks where org_id='a4210000-0000-0000-0000-000000000001' and external_tier='odoo' and domain='master:product'),
  'C3', 'AC-ODC-023 finishing the census writes its cursor');
select public.apply_odoo_master_page('a4210000-0000-0000-0000-000000000001','product',
  '[{"external_id":"p3","name":"Three","source_write_date":"2026-11-01 08:00:00"}]','C4');
select is((select tombstoned_at from external_master_records where org_id='a4210000-0000-0000-0000-000000000001' and kind='product' and external_id='p3'),
  null, 'AC-ODC-023 a returning id clears the tombstone');
select public.finish_odoo_census('a4210000-0000-0000-0000-000000000001','product','2026-11-02 00:00:00+00','C5');
select public.mark_odoo_census_seen('a4210000-0000-0000-0000-000000000001','product','2026-11-03 00:00:00+00', array['p3']);
select is((select tombstoned_at from external_master_records where org_id='a4210000-0000-0000-0000-000000000001' and kind='product' and external_id='p3'),
  null, 'AC-ODC-023 an id the census sees again clears its tombstone');
select throws_ok($$select public.mark_odoo_census_seen('a4210000-0000-0000-0000-0000000000ff','product',now(),array['1'])$$, 'P0001', null,
  'mark_odoo_census_seen refuses an org without an activated Odoo binding');
select throws_ok($$select public.finish_odoo_census('a4210000-0000-0000-0000-0000000000ff','product',now(),'c')$$, 'P0001', null,
  'finish_odoo_census refuses an org without an activated Odoo binding');

-- AC-ODC-026 (P): only an active Admin of the org or a platform Operator resets one kind; the reset is audited.
select throws_ok($$select public.reset_odoo_sync_kind('a4210000-0000-0000-0000-000000000001','product','a4210000-0000-0000-0000-0000000000f1')$$,
  '42501', null, 'AC-ODC-026 Finance cannot reset a kind');
select throws_ok($$select public.reset_odoo_sync_kind('a4210000-0000-0000-0000-000000000001','product','a4210000-0000-0000-0000-0000000000d1')$$,
  '42501', null, 'AC-ODC-026 a disabled Admin cannot reset a kind');
select throws_ok($$select public.reset_odoo_sync_kind('a4210000-0000-0000-0000-000000000001','product','a4210000-0000-0000-0000-0000000000b1')$$,
  '42501', null, 'AC-ODC-026 another org''s Admin cannot reset a kind');
select throws_ok($$select public.reset_odoo_sync_kind('a4210000-0000-0000-0000-000000000001','bogus','a4210000-0000-0000-0000-0000000000a1')$$,
  '22023', null, 'AC-ODC-026 an unknown kind is refused');
select lives_ok($$select public.reset_odoo_sync_kind('a4210000-0000-0000-0000-000000000001','product','a4210000-0000-0000-0000-0000000000a1')$$,
  'AC-ODC-026 the Admin resets a kind');
select is((select count(*)::int from external_sync_watermarks where org_id='a4210000-0000-0000-0000-000000000001' and external_tier='odoo' and domain='master:product'),
  0, 'AC-ODC-026 the reset removes that kind''s cursor');
select is((select count(*)::int from external_master_records where org_id='a4210000-0000-0000-0000-000000000001' and kind='product'), 5,
  'AC-ODC-026 the reset keeps the mirror rows');
select is((select count(*)::int from audit_events where org_id='a4210000-0000-0000-0000-000000000001' and action='integration.odoo.reset'
  and actor_id='a4210000-0000-0000-0000-0000000000a1' and detail->>'kind'='product'), 1, 'AC-ODC-026 the reset writes one audit row');
select lives_ok($$select public.reset_odoo_sync_kind('a4210000-0000-0000-0000-000000000001','account','a4210000-0000-0000-0000-000000000099')$$,
  'AC-ODC-026 a platform Operator resets a kind');
reset role;

-- PQ-9 discard also clears the org's mirror, and only that org's.
select public.discard_odoo_mirror('a4210000-0000-0000-0000-000000000002', 'a4210000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from external_master_records where org_id='a4210000-0000-0000-0000-000000000002'), 0, 'discard_odoo_mirror clears the org''s mirror');
select is((select count(*)::int from external_master_records where org_id='a4210000-0000-0000-0000-000000000001'), 6, 'discard_odoo_mirror leaves other orgs alone');

-- FR-ODC-047 the scheduled tick.
select is((select count(*)::int from cron.job where jobname = 'odoo-sweep-tick'), 1, 'odoo sweep tick registered');
select lives_ok('select public.odoo_sweep_tick()', 'tick is a no-op without Vault secrets');

select * from finish();
rollback;
