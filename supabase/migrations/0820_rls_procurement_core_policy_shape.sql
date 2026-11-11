-- 0820_rls_procurement_core_policy_shape.sql — procurement core: constant-argument helpers once per statement,
-- ALL write policies split (#842 slice 1, docs/plans/2026-11-09-rls-initplan-helpers.md).
-- Rollback: rollback/0820_rls_procurement_core_policy_shape_down.sql
--
-- Gap A: org_feature_enabled(<initplan>, '<key>') and domain_externally_owned(<initplan>, '<key>') have constant
--   arguments but still ran once per row. Wrapping the WHOLE call as ( SELECT fn(..) AS fn) makes it an InitPlan.
--   Both helpers are STABLE and statement-invariant for these arguments, so only the call count changes.
--   Applied with ALTER POLICY (OID, name, command, roles, permissive mode and comment untouched) to every policy
--   on the nine slice tables: procurements, procurement_items, procurement_quotations, procurement_documents,
--   procurement_invoices, procurement_receipts, purchase_orders, purchase_requests, rfqs.
-- Gap B: an ALL policy is also a permissive SELECT policy, so every read ORed it with the table's own SELECT
--   policy row by row. <t>_write becomes <t>_write_insert / _update / _delete (same roles, same expressions,
--   Gap A applied), the old comment is copied to each.
--   SELECT branch decision (plan §2.2), all five tables: DROPPED. Each table's permissive SELECT policy is
--   exactly (org_id = (select auth_org_id())) AND (select is_active_member()), and the ALL USING clause carries
--   both conjuncts (plus a role list, the org_feature gate and a parent-procurement EXISTS), so the ALL SELECT
--   arm was strictly narrower and widened no read. The block below RAISES if either fact stops being true.
--
-- Expressions are generated from the catalog at apply time (pg_policies = PostgreSQL's own deparse), not
-- hand-typed, so they cannot drift from what is deployed. Drift guard first: any unexpected shape aborts.
begin;

create function pg_temp.rls820_wrap(expr text) returns text language sql immutable as $$
  select regexp_replace(expr,
    '(?<!SELECT )(org_feature_enabled|domain_externally_owned)\(\( SELECT auth_org_id\(\) AS auth_org_id\), (''[a-z_]+''::text)\)',
    '( SELECT \1(( SELECT auth_org_id() AS auth_org_id), \2) AS \1)', 'g') $$;

do $mig$
declare
  all_tbls constant text[] := array['procurement_items','procurement_quotations','procurement_documents','purchase_requests','rfqs'];
  a_tbls   constant text[] := array['procurements','procurement_items','procurement_quotations','procurement_documents',
                                    'procurement_invoices','procurement_receipts','purchase_orders','purchase_requests','rfqs'];
  sel_qual constant text := '((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member))';
  t text; p record; r record; roles_sql text; cmt text; u text; c text; n int;
begin
  foreach t in array a_tbls loop
    execute format('lock table public.%I in access exclusive mode', t);
  end loop;

  -- Gap B first (reads the ALL expressions, then Gap A covers every other policy)
  foreach t in array all_tbls loop
    select count(*) into n from pg_policies where schemaname = 'public' and tablename = t and cmd = 'ALL';
    if n <> 1 then raise exception '0820 drift: % has % ALL policies, expected 1', t, n; end if;
    select * into p from pg_policies
     where schemaname = 'public' and tablename = t and policyname = t || '_write' and cmd = 'ALL' and permissive = 'PERMISSIVE';
    if not found then raise exception '0820 drift: %_write is not a permissive ALL policy', t; end if;
    select count(*) into n from pg_policies where schemaname = 'public' and tablename = t and cmd = 'SELECT' and permissive = 'PERMISSIVE';
    if n <> 1 then raise exception '0820 drift: % has % permissive SELECT policies, expected 1', t, n; end if;
    if (select qual from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_select') is distinct from sel_qual then
      raise exception '0820 drift: %_select is not the pinned org + active-member predicate', t;
    end if;
    if position('(org_id = ( SELECT auth_org_id() AS auth_org_id))' in p.qual) = 0
       or position('( SELECT is_active_member() AS is_active_member)' in p.qual) = 0 then
      raise exception '0820 drift: %_write USING no longer implies the SELECT policy; keep a _write_select branch', t;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t
                and policyname in (t || '_write_insert', t || '_write_update', t || '_write_delete', t || '_write_select')) then
      raise exception '0820 drift: % already has split policy names', t;
    end if;

    u := pg_temp.rls820_wrap(p.qual);
    c := pg_temp.rls820_wrap(coalesce(p.with_check, p.qual));
    roles_sql := case when p.roles = array['public']::name[] then '' else ' to ' || array_to_string(p.roles, ', ') end;
    cmt := obj_description((select oid from pg_policy where polrelid = ('public.' || t)::regclass and polname = t || '_write'), 'pg_policy');

    execute format('drop policy %I on public.%I', t || '_write', t);
    execute format('create policy %I on public.%I as permissive for insert%s with check (%s)', t || '_write_insert', t, roles_sql, c);
    execute format('create policy %I on public.%I as permissive for update%s using (%s) with check (%s)', t || '_write_update', t, roles_sql, u, c);
    execute format('create policy %I on public.%I as permissive for delete%s using (%s)', t || '_write_delete', t, roles_sql, u);
    if cmt is not null then
      foreach roles_sql in array array['_write_insert', '_write_update', '_write_delete'] loop
        execute format('comment on policy %I on public.%I is %L', t || roles_sql, t, cmt || ' (split from ' || t || '_write, 0820)');
      end loop;
    end if;
  end loop;

  -- Gap A on every remaining policy of the nine tables
  for r in select tablename, policyname, qual, with_check from pg_policies
            where schemaname = 'public' and tablename = any (a_tbls)
              and (pg_temp.rls820_wrap(qual) is distinct from qual or pg_temp.rls820_wrap(with_check) is distinct from with_check)
  loop
    execute format('alter policy %I on public.%I%s%s', r.policyname, r.tablename,
      case when r.qual is null then '' else ' using (' || pg_temp.rls820_wrap(r.qual) || ')' end,
      case when r.with_check is null then '' else ' with check (' || pg_temp.rls820_wrap(r.with_check) || ')' end);
  end loop;
end $mig$;

commit;
