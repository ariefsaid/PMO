-- 0820_procurement_core_policy_shape.test.sql — #842 slice 1. Migration under test: 0820_rls_procurement_core_policy_shape.sql
-- (+ rollback/0820_..._down.sql).
--   §1  SHAPE: the five ALL <t>_write policies are gone; <t>_write_insert/_update/_delete exist, permissive, same
--       role list; no <t>_write_select (the SELECT arm was implied by <t>_select); the old comment is carried.
--   §2  GAP A: on the nine slice tables no policy calls org_feature_enabled/domain_externally_owned per row.
--   §3  EQUIVALENCE: four callers x procurement_items + procurement_documents (read count, insert own/foreign org, update, delete,
--       each probe in a rolled-back sub-transaction). Record under the new policies ("new"), swap in the pre-0820 ALL
--       policy rebuilt from the split ones (the rollback's own transform, per-row form), record again ("old"),
--       require the two identical.
begin;
select plan(17);

-- ── §1 shape ──
select is_empty(
  $$select policyname from pg_policies where schemaname = 'public' and cmd = 'ALL'
     and tablename in ('procurement_items','procurement_quotations','procurement_documents','purchase_requests','rfqs')$$,
  'AC-RLS842-S1-001 no ALL policy is left on the five procurement-core tables');

select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and permissive = 'PERMISSIVE'
      and tablename in ('procurement_items','procurement_quotations','procurement_documents','purchase_requests','rfqs')
      and policyname ~ '_write_(insert|update|delete)$'
      and cmd = case right(policyname, 6) when 'insert' then 'INSERT' when 'update' then 'UPDATE' else 'DELETE' end),
  15, 'AC-RLS842-S1-002 each of the five tables has a permissive _write_insert/_update/_delete of the matching command');

select is_empty(
  $$select policyname from pg_policies where schemaname = 'public' and policyname ~ '_write_select$'
     and tablename in ('procurement_items','procurement_quotations','procurement_documents','purchase_requests','rfqs')$$,
  'AC-RLS842-S1-003 no _write_select branch (the SELECT policy already admits every row the ALL arm did)');

select is_empty(
  $$select t.tablename from (values ('procurement_items'),('procurement_quotations'),('procurement_documents'),('purchase_requests'),('rfqs')) t(tablename)
     where not exists (select 1 from pg_policies s where s.schemaname = 'public' and s.tablename = t.tablename
                          and s.policyname = t.tablename || '_select' and s.cmd = 'SELECT' and s.permissive = 'PERMISSIVE')$$,
  'AC-RLS842-S1-004 each table keeps its permissive SELECT policy');

select is_empty(
  $$select u.policyname from pg_policies u join pg_policies i on i.schemaname = u.schemaname and i.tablename = u.tablename
      and i.policyname = replace(u.policyname, '_write_update', '_write_insert')
     where u.schemaname = 'public' and u.policyname ~ '_write_update$'
       and u.tablename in ('procurement_items','procurement_quotations','procurement_documents','purchase_requests','rfqs')
       and (u.with_check is distinct from i.with_check or u.roles <> i.roles
            or u.qual is distinct from (select d.qual from pg_policies d where d.schemaname = 'public' and d.tablename = u.tablename
                                          and d.policyname = replace(u.policyname, '_write_update', '_write_delete'))
            or u.roles <> (select d.roles from pg_policies d where d.schemaname = 'public' and d.tablename = u.tablename
                                          and d.policyname = replace(u.policyname, '_write_update', '_write_delete')))$$,
  'AC-RLS842-S1-005 insert CHECK = update CHECK, update USING = delete USING, same roles on all three');

select ok(
  (select d.description like '%create_procurement_quotation%'
     from pg_policy p join pg_description d on d.objoid = p.oid and d.classoid = 'pg_policy'::regclass
    where p.polname = 'procurement_quotations_write_insert'),
  'AC-RLS842-S1-006 the old procurement_quotations_write annotation is carried onto the split policies');

-- ── §2 Gap A guard for the slice tables ──
create function pg_temp.q820_bare(expr text) returns integer language sql immutable as $$
  select (select count(*) from regexp_matches(coalesce(expr, ''),
    '(?<!SELECT )(org_feature_enabled|domain_externally_owned)\(\( SELECT auth_org_id\(\) AS auth_org_id\), ''[a-z_]+''::text\)', 'g'))::int $$;

select is_empty(
  $$select tablename || '.' || policyname from pg_policies
     where schemaname = 'public'
       and tablename in ('procurements','procurement_items','procurement_quotations','procurement_documents','procurement_invoices',
                         'procurement_receipts','purchase_orders','purchase_requests','rfqs')
       and pg_temp.q820_bare(qual) + pg_temp.q820_bare(with_check) > 0$$,
  'AC-RLS842-S1-007 no slice-table policy calls org_feature_enabled/domain_externally_owned per row');

select ok(
  (select count(*) from pg_policies where schemaname = 'public'
      and tablename in ('procurements','procurement_items','procurement_quotations','procurement_documents','procurement_invoices',
                        'procurement_receipts','purchase_orders','purchase_requests','rfqs')
      and (qual ~ '\( SELECT org_feature_enabled\(' or with_check ~ '\( SELECT org_feature_enabled\(')) >= 20,
  'AC-RLS842-S1-008 the wrapped form is present on at least 20 slice policies (the guard has real input)');

-- ── §3 equivalence fixtures (postgres) ──
insert into organizations (id, name) values
  ('08200000-0000-0000-0000-0000000000a1', 'S1 Org A'), ('08200000-0000-0000-0000-0000000000b1', 'S1 Org B');
insert into auth.users (id, email) values
  ('08200000-0000-0000-0000-000000000001', 's1-pm@example.com'),
  ('08200000-0000-0000-0000-000000000002', 's1-eng@example.com'),
  ('08200000-0000-0000-0000-000000000003', 's1-off@example.com'),
  ('08200000-0000-0000-0000-000000000008', 's1-pm-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('08200000-0000-0000-0000-000000000001', '08200000-0000-0000-0000-0000000000a1', 'S1 PM',  's1-pm@example.com',   'Project Manager', 'active'),
  ('08200000-0000-0000-0000-000000000002', '08200000-0000-0000-0000-0000000000a1', 'S1 Eng', 's1-eng@example.com',  'Engineer', 'active'),
  ('08200000-0000-0000-0000-000000000003', '08200000-0000-0000-0000-0000000000a1', 'S1 Off', 's1-off@example.com',  'Project Manager', 'disabled'),
  ('08200000-0000-0000-0000-000000000008', '08200000-0000-0000-0000-0000000000b1', 'S1 PM B','s1-pm-b@example.com', 'Project Manager', 'active');
-- Draft: procurement_items_draft_only* (restrictive) admit item writes only on a Draft procurement.
insert into procurements (id, org_id, title, status) values
  ('08200000-0000-0000-0000-000000000010', '08200000-0000-0000-0000-0000000000a1', 'S1 Proc A', 'Draft'),
  ('08200000-0000-0000-0000-000000000011', '08200000-0000-0000-0000-0000000000b1', 'S1 Proc B', 'Draft');
insert into procurement_items (org_id, procurement_id, name) values
  ('08200000-0000-0000-0000-0000000000a1', '08200000-0000-0000-0000-000000000010', 'S1 item A'),
  ('08200000-0000-0000-0000-0000000000b1', '08200000-0000-0000-0000-000000000011', 'S1 item B');
insert into procurement_documents (org_id, procurement_id, type) values
  ('08200000-0000-0000-0000-0000000000a1', '08200000-0000-0000-0000-000000000010', 'evidence'),
  ('08200000-0000-0000-0000-0000000000b1', '08200000-0000-0000-0000-000000000011', 'evidence');

create temporary table q820_snap (phase text, caller text, probe text, outcome text);
grant all on q820_snap to public;

create function pg_temp.q820_snap(p_phase text) returns void language plpgsql as $f$
declare
  callers jsonb := jsonb_build_array(
    jsonb_build_object('c','pm',   'u','08200000-0000-0000-0000-000000000001','o','08200000-0000-0000-0000-0000000000a1','p','08200000-0000-0000-0000-000000000010','xo','08200000-0000-0000-0000-0000000000b1'),
    jsonb_build_object('c','eng',  'u','08200000-0000-0000-0000-000000000002','o','08200000-0000-0000-0000-0000000000a1','p','08200000-0000-0000-0000-000000000010','xo','08200000-0000-0000-0000-0000000000b1'),
    jsonb_build_object('c','off',  'u','08200000-0000-0000-0000-000000000003','o','08200000-0000-0000-0000-0000000000a1','p','08200000-0000-0000-0000-000000000010','xo','08200000-0000-0000-0000-0000000000b1'),
    jsonb_build_object('c','pmB',  'u','08200000-0000-0000-0000-000000000008','o','08200000-0000-0000-0000-0000000000b1','p','08200000-0000-0000-0000-000000000011','xo','08200000-0000-0000-0000-0000000000a1'));
  caller jsonb; probes jsonb; pr jsonb; v text; n int; res text[]; labels text[];
begin
  for caller in select * from jsonb_array_elements(callers) loop
    probes := jsonb_build_object(
      'items_n',   'select count(*)::text from public.procurement_items',
      'docs_n',    'select count(*)::text from public.procurement_documents',
      'item_ins',  format('insert into public.procurement_items (org_id, procurement_id, name) values (%L, %L, ''x'')', caller->>'o', caller->>'p'),
      'item_ins_xorg', format('insert into public.procurement_items (org_id, procurement_id, name) values (%L, %L, ''x'')', caller->>'xo', caller->>'p'),
      'item_upd',  'update public.procurement_items set name = name',
      'item_del',  'delete from public.procurement_items',
      'doc_ins',   format('insert into public.procurement_documents (org_id, procurement_id, type) values (%L, %L, ''evidence'')', caller->>'o', caller->>'p'),
      'doc_ins_xorg', format('insert into public.procurement_documents (org_id, procurement_id, type) values (%L, %L, ''evidence'')', caller->>'xo', caller->>'p'),
      'doc_upd',   'update public.procurement_documents set type = type',
      'doc_del',   'delete from public.procurement_documents');
    res := '{}'; labels := '{}';
    perform set_config('request.jwt.claims', json_build_object('sub', caller->>'u', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    for pr in select jsonb_build_object('k', key, 'q', value) from jsonb_each_text(probes) loop
      begin
        if pr->>'k' ~ '_n$' then
          execute pr->>'q' into v;
          labels := labels || (pr->>'k'); res := res || v;
        else
          execute pr->>'q'; get diagnostics n = row_count;
          raise exception using errcode = 'P0999', message = n::text;
        end if;
      exception when others then
        if sqlstate = 'P0999' then v := 'rows=' || sqlerrm; else v := 'err=' || sqlstate; end if;
        if pr->>'k' !~ '_n$' then labels := labels || (pr->>'k'); res := res || v; end if;
      end;
    end loop;
    execute 'reset role';
    insert into q820_snap select p_phase, caller->>'c', l, o from unnest(labels, res) as t(l, o);
  end loop;
end $f$;

select pg_temp.q820_snap('new');

-- Swap in the pre-0820 shape for procurement_items + procurement_documents: ALL policy rebuilt from the split ones, per-row helper form.
do $swap$
declare t text; p record; u text; c text;
begin
  foreach t in array array['procurement_items','procurement_documents'] loop
    select * into p from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_write_update';
    u := regexp_replace(p.qual, '\( SELECT (org_feature_enabled)\((\( SELECT auth_org_id\(\) AS auth_org_id\), ''[a-z_]+''::text)\) AS \1\)', '\1(\2)', 'g');
    c := regexp_replace(p.with_check, '\( SELECT (org_feature_enabled)\((\( SELECT auth_org_id\(\) AS auth_org_id\), ''[a-z_]+''::text)\) AS \1\)', '\1(\2)', 'g');
    execute format('drop policy %I on public.%I', t || '_write_insert', t);
    execute format('drop policy %I on public.%I', t || '_write_update', t);
    execute format('drop policy %I on public.%I', t || '_write_delete', t);
    execute format('create policy %I on public.%I as permissive for all using (%s) with check (%s)', t || '_write', t, u, c);
  end loop;
end $swap$;

select pg_temp.q820_snap('old');

select ok((select count(*) from q820_snap where phase = 'new') >= 4 * 10 and
          (select count(*) from q820_snap where phase = 'new') = (select count(*) from q820_snap where phase = 'old'),
  'AC-RLS842-S1-009 both phases recorded every probe for every caller');
select is_empty($$select caller, probe, outcome from q820_snap where phase = 'new' except select caller, probe, outcome from q820_snap where phase = 'old'$$,
  'AC-RLS842-S1-010 nothing any caller sees or may write changed (new minus old is empty)');
select is_empty($$select caller, probe, outcome from q820_snap where phase = 'old' except select caller, probe, outcome from q820_snap where phase = 'new'$$,
  'AC-RLS842-S1-011 and old minus new is empty');

-- Anti-vacuity: the probes distinguish roles, tenants and offboarded members.
select is((select outcome from q820_snap where phase = 'new' and caller = 'pm' and probe = 'items_n'), '1', 'AC-RLS842-S1-012 a Project Manager sees only the org-A item');
select is((select outcome from q820_snap where phase = 'new' and caller = 'pm' and probe = 'item_ins'), 'rows=1', 'AC-RLS842-S1-013 a Project Manager may insert an item in their org');
select is((select outcome from q820_snap where phase = 'new' and caller = 'eng' and probe = 'item_ins'), 'err=42501', 'AC-RLS842-S1-014 an Engineer may not insert an item');
select is((select outcome from q820_snap where phase = 'new' and caller = 'pm' and probe = 'item_ins_xorg'), 'err=42501', 'AC-RLS842-S1-015 a Project Manager may not insert an item into a foreign org');
select is((select outcome from q820_snap where phase = 'new' and caller = 'pm' and probe = 'doc_del'), 'rows=1', 'AC-RLS842-S1-016 a Project Manager deletes only the org-A document');
select is((select outcome from q820_snap where phase = 'new' and caller = 'off' and probe = 'item_upd'), 'rows=0', 'AC-RLS842-S1-017 an offboarded member updates nothing');

select * from finish();
rollback;
