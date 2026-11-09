-- Rollback of 0820: recreate the five ALL <t>_write policies (USING/WITH CHECK taken from the split policies
-- with the Gap A wrap undone, comment restored) and unwrap Gap A on the nine slice tables.
begin;

create function pg_temp.rls820_unwrap(expr text) returns text language sql immutable as $$
  select regexp_replace(expr,
    '\( SELECT (org_feature_enabled|domain_externally_owned)\((\( SELECT auth_org_id\(\) AS auth_org_id\), ''[a-z_]+''::text)\) AS \1\)',
    '\1(\2)', 'g') $$;

do $rb$
declare
  all_tbls constant text[] := array['procurement_items','procurement_quotations','procurement_documents','purchase_requests','rfqs'];
  a_tbls   constant text[] := array['procurements','procurement_items','procurement_quotations','procurement_documents',
                                    'procurement_invoices','procurement_receipts','purchase_orders','purchase_requests','rfqs'];
  t text; p record; r record; roles_sql text; cmt text;
begin
  foreach t in array a_tbls loop
    execute format('lock table public.%I in access exclusive mode', t);
  end loop;

  foreach t in array all_tbls loop
    select * into p from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_write_update';
    if not found then raise exception '0820 rollback: %_write_update is missing', t; end if;
    roles_sql := case when p.roles = array['public']::name[] then '' else ' to ' || array_to_string(p.roles, ', ') end;
    cmt := obj_description((select oid from pg_policy where polrelid = ('public.' || t)::regclass and polname = t || '_write_update'), 'pg_policy');
    cmt := regexp_replace(cmt, ' \(split from [a-z_]+_write, 0820\)$', '');
    execute format('drop policy %I on public.%I', t || '_write_insert', t);
    execute format('drop policy %I on public.%I', t || '_write_update', t);
    execute format('drop policy %I on public.%I', t || '_write_delete', t);
    execute format('create policy %I on public.%I as permissive for all%s using (%s) with check (%s)',
      t || '_write', t, roles_sql, pg_temp.rls820_unwrap(p.qual), pg_temp.rls820_unwrap(p.with_check));
    if cmt is not null then
      execute format('comment on policy %I on public.%I is %L', t || '_write', t, cmt);
    end if;
  end loop;

  for r in select tablename, policyname, qual, with_check from pg_policies
            where schemaname = 'public' and tablename = any (a_tbls)
              and (pg_temp.rls820_unwrap(qual) is distinct from qual or pg_temp.rls820_unwrap(with_check) is distinct from with_check)
  loop
    execute format('alter policy %I on public.%I%s%s', r.policyname, r.tablename,
      case when r.qual is null then '' else ' using (' || pg_temp.rls820_unwrap(r.qual) || ')' end,
      case when r.with_check is null then '' else ' with check (' || pg_temp.rls820_unwrap(r.with_check) || ')' end);
  end loop;
end $rb$;

commit;
