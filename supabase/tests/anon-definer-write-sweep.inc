-- The production sweep: direct role ACL entries are the oracle. `distinct` prevents one function
-- granted to both roles from being named twice. Retained names exempt authenticated grants only;
-- an anonymous or PUBLIC grant is always reported, including for retained writers.
create temp view anon_definer_write_sweep as
select distinct p.oid, p.proname
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  left join pg_roles grantee on grantee.oid = a.grantee
 where n.nspname = 'public'
   and p.prosecdef
   and (a.grantee = 0 or grantee.rolname in ('anon', 'authenticated'))
   and a.privilege_type = 'EXECUTE'
   and pg_get_functiondef(p.oid) ~* '(insert\s+into|update\s+(public\.)?[a-z_]|delete\s+from|merge\s+into)'
   and (a.grantee = 0 or grantee.rolname = 'anon'
        or not exists (select 1 from client_callable_rpc_names c where c.proname = p.proname));
