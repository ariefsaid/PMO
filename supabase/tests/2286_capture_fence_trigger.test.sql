-- #2286 PR B AC-CAPV-010: the capture fence trigger reads the org column directly instead of serializing the row. The same 22
-- tables, the same shared capture-fence:<org> lock for the old and the new org, and organizations fenced on its own id.
begin;
select plan(14);
-- The 0866 list minus the three statement snapshot tables 0873 dropped, plus 0882's invoice assignments.
create temp table fenced(name text primary key);
insert into fenced values ('erp_purchase_documents'),('procurement_erp_links'),('erp_purchase_document_marks'),('erp_gl_entry_mirror'),
  ('erp_journal_line_links'),('budget_category_account_map'),('erp_account_mirror'),('external_org_bindings'),('external_refs'),('projects'),
  ('companies'),('procurements'),('external_domain_ownership'),('organizations'),('erp_capture_feed_witnesses'),('erp_purchase_captures'),
  ('purchase_requests'),('purchase_orders'),('procurement_receipts'),('procurement_invoices'),('payments'),('erp_capture_invoice_assignments');
create function pg_temp.trigger_function(p_table text) returns text language sql as $$
  select p.proname::text from pg_trigger t join pg_proc p on p.oid=t.tgfoid
  where t.tgrelid=('public.'||p_table)::regclass and t.tgname='capture_census_fence' and not t.tgisinternal
$$;
select is((select count(*)::int from fenced),22,'AC-CAPV-010 the fence covers 22 tables');
select is((select array_agg(name order by name) from fenced where pg_temp.trigger_function(name) is null),null,'AC-CAPV-010 every fenced table has its capture_census_fence trigger');
select is((select count(*)::int from pg_trigger where tgname='capture_census_fence' and not tgisinternal),22,'AC-CAPV-010 no other table carries the fence trigger');
select is(pg_temp.trigger_function('organizations'),'fence_capture_org_change','AC-CAPV-010 organizations is fenced on its own id');
select is((select array_agg(name order by name) from fenced where name<>'organizations' and pg_temp.trigger_function(name) is distinct from 'fence_capture_source_change'),null,
  'AC-CAPV-010 every other table is fenced on its org_id');
select is((select array_agg(distinct t.tgtype) from pg_trigger t where t.tgname='capture_census_fence' and not t.tgisinternal),
  (select array_agg(distinct t.tgtype) from pg_trigger t where t.tgrelid='public.projects'::regclass and t.tgname='capture_census_fence'),
  'AC-CAPV-010 every fence trigger fires before insert, update and delete for each row');
select ok(not exists(select 1 from unnest(array['public','anon','authenticated','service_role']) r(role)
  cross join unnest(array['public.fence_capture_source_change()','public.fence_capture_org_change()']) f(fn)
  where r.role<>'public' and has_function_privilege(r.role,f.fn,'execute'))
  and not exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.oid in ('public.fence_capture_source_change()'::regprocedure,'public.fence_capture_org_change()'::regprocedure) and a.grantee=0),
  'AC-CAPV-010 neither fence function is executable by public, anon, authenticated or service_role');

-- The fixture is written with triggers off, so it holds no fence lock; each case then writes a different org, so the locks it
-- adds are its own (an advisory transaction lock is held to the end of the transaction).
set local session_replication_role = replica;
insert into organizations (id,name,default_currency) select ('22860333-0000-0000-0000-00000000000'||x)::uuid,'Fence '||x,'USD' from unnest(array['a','b','c','d']) x;
insert into budget_category_account_map (id,org_id,category,erp_account) values
  ('22860333-0000-0000-0000-000000000011','22860333-0000-0000-0000-00000000000a','Materials','Cost'),
  ('22860333-0000-0000-0000-000000000012','22860333-0000-0000-0000-00000000000c','Materials','Cost');
set local session_replication_role = origin;
-- The fence locks this backend holds, as org ids of the fixture.
create function pg_temp.fenced_orgs() returns uuid[] language sql as $$
  select coalesce(array_agg(o.id order by o.id),'{}') from (select ('22860333-0000-0000-0000-00000000000'||x)::uuid as id from unnest(array['a','b','c','d','e']) x) o
  where exists(select 1 from pg_locks l where l.locktype='advisory' and l.pid=pg_backend_pid() and l.granted
    and l.mode='ShareLock' and l.objsubid=1
    and l.classid=((hashtextextended('capture-fence:'||o.id::text,0) >> 32) & 4294967295)::oid
    and l.objid=(hashtextextended('capture-fence:'||o.id::text,0) & 4294967295)::oid)
$$;
select is(pg_temp.fenced_orgs(),'{}'::uuid[],'AC-CAPV-010 the fixture holds no fence lock');
update budget_category_account_map set org_id='22860333-0000-0000-0000-00000000000b' where id='22860333-0000-0000-0000-000000000011';
select is(pg_temp.fenced_orgs(),array['22860333-0000-0000-0000-00000000000a','22860333-0000-0000-0000-00000000000b']::uuid[],
  'AC-CAPV-010 a row moved between two orgs takes the shared fence of both');
delete from budget_category_account_map where id='22860333-0000-0000-0000-000000000012';
select is(pg_temp.fenced_orgs(),array['22860333-0000-0000-0000-00000000000a','22860333-0000-0000-0000-00000000000b','22860333-0000-0000-0000-00000000000c']::uuid[],
  'AC-CAPV-010 a delete takes the shared fence of the old org');
update organizations set name='Fence d renamed' where id='22860333-0000-0000-0000-00000000000d';
select is(pg_temp.fenced_orgs(),array['22860333-0000-0000-0000-00000000000a','22860333-0000-0000-0000-00000000000b','22860333-0000-0000-0000-00000000000c','22860333-0000-0000-0000-00000000000d']::uuid[],
  'AC-CAPV-010 an organization write takes the fence of its own id');
insert into organizations (id,name,default_currency) values ('22860333-0000-0000-0000-00000000000e','Fence e','USD');
select is(pg_temp.fenced_orgs(),array['22860333-0000-0000-0000-00000000000a','22860333-0000-0000-0000-00000000000b','22860333-0000-0000-0000-00000000000c','22860333-0000-0000-0000-00000000000d','22860333-0000-0000-0000-00000000000e']::uuid[],
  'AC-CAPV-010 a new organization takes the fence of its new id');
-- A row with no org takes no fence lock and the trigger does not fail (unchanged): every fenced table's org_id is NOT NULL, so a
-- nullable temp table carries the same trigger function under another trigger name.
create temp table fence_null(id integer primary key, org_id uuid);
create trigger fence_null_probe before insert or update or delete on pg_temp.fence_null for each row execute function public.fence_capture_source_change();
select set_config('fence.locks_before',(select count(*) from pg_locks where locktype='advisory' and pid=pg_backend_pid())::text,true) is not null;
select lives_ok($$insert into pg_temp.fence_null values (1,null)$$,'AC-CAPV-010 an insert with no org passes the fence trigger');
select is((select count(*) from pg_locks where locktype='advisory' and pid=pg_backend_pid()),current_setting('fence.locks_before')::bigint,
  'AC-CAPV-010 an insert with no org takes no advisory lock');
select * from finish();
rollback;
