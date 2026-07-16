-- 0151_m365_lock_order_reconcile.test.sql
-- AC-M365-163/164/166 [pgTAP]: Luna round-3 fixes — the preflight regex/audit (HIGH), the lock-order
-- mutation RPCs that close the refresh/lifecycle DEADLOCK (MED), and the one-time reconcile scrub of
-- already-stale connections (MED). The actual two-session deadlock-freedom is proven by
-- scripts/m365-deadlock-probe.sh (pgTAP runs in a single transaction and cannot express it); this
-- file proves the DETERMINISTIC invariants those fixes rely on. Runs as pgTAP superuser.
begin;
select plan(19);

-- ============================================================================
-- SETUP: orgs/users/entitlements. One dedicated fixture per AC (no state bleed).
-- ============================================================================
insert into organizations (id, name) values
  ('a1510000-0000-0000-0000-000000000001','AC-M365-163 Org'),  -- foo..bar populated-upgrade
  ('a1510000-0000-0000-0000-000000000002','AC-M365-164 Org'),  -- lock-order RPCs
  ('a1510000-0000-0000-0000-000000000010','AC-M365-166 Survive'),  -- scrub survivor (active+entitled)
  ('a1510000-0000-0000-0000-000000000020','AC-M365-166 Inactive'), -- scrub: inactive user
  ('a1510000-0000-0000-0000-000000000030','AC-M365-166 Disentitled'); -- scrub: not-entitled org

insert into auth.users (id, email) values
  ('a1510000-0000-0000-0000-0000000000a1','m365-163-u@example.com'),
  ('a1510000-0000-0000-0000-0000000000a2','m365-164-active@example.com'),
  ('a1510000-0000-0000-0000-0000000000a3','m365-164-disabled@example.com'),
  ('a1510000-0000-0000-0000-0000000000b1','m365-166-survive@example.com'),
  ('a1510000-0000-0000-0000-0000000000b2','m365-166-inactive@example.com'),
  ('a1510000-0000-0000-0000-0000000000b3','m365-166-disent@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('a1510000-0000-0000-0000-0000000000a1','a1510000-0000-0000-0000-000000000001','U','m365-163-u@example.com','Engineer','active'),
  ('a1510000-0000-0000-0000-0000000000a2','a1510000-0000-0000-0000-000000000002','Active','m365-164-active@example.com','Engineer','active'),
  ('a1510000-0000-0000-0000-0000000000a3','a1510000-0000-0000-0000-000000000002','Disabled','m365-164-disabled@example.com','Engineer','disabled'),
  ('a1510000-0000-0000-0000-0000000000b1','a1510000-0000-0000-0000-000000000010','Survive','m365-166-survive@example.com','Engineer','active'),
  ('a1510000-0000-0000-0000-0000000000b2','a1510000-0000-0000-0000-000000000020','Inactive','m365-166-inactive@example.com','Engineer','disabled'),
  ('a1510000-0000-0000-0000-0000000000b3','a1510000-0000-0000-0000-000000000030','Disent','m365-166-disent@example.com','Engineer','active');

-- Entitlements: 163/164/166-Survive/166-Inactive entitled; 166-Disentitled has NO m365 row.
insert into org_features (org_id, feature_key, enabled, updated_by) values
  ('a1510000-0000-0000-0000-000000000001','m365_integration',true,null),
  ('a1510000-0000-0000-0000-000000000002','m365_integration',true,null),
  ('a1510000-0000-0000-0000-000000000010','m365_integration',true,null),
  ('a1510000-0000-0000-0000-000000000020','m365_integration',true,null);

-- ============================================================================
-- AC-M365-163: populated-upgrade 'foo..bar' — the corrected preflight matches dot-segments, scrubs
-- the offending row (with a 'reconciled' audit), and the tightened CHECK then adds cleanly.
-- Reproduces the OLD (0102-era) looser tenant CHECK so a legacy 'foo..bar' row is seedable, then
-- re-runs the EXACT corrected 0103 §5a(ii) preflight + re-adds the §6 CHECK. Proves 0103 no longer
-- aborts on a populated DB (the round-3 HIGH).
-- ============================================================================

-- Regression proof of the escaping bug itself (standard_conforming_strings is ON).

select is(text 'foo..bar' ~ '\\.\\.', false,
  'AC-M365-163: the BUGGY pre-round-3 preflight regex (double-backslashed under SCS=on) does NOT match a dot-segment tenant - the round-3 HIGH root cause');
select is(text 'foo..bar' ~ '\.\.', true,
  'AC-M365-163: the FIXED regex (single-backslashed) matches a dot-segment tenant');

-- Revert the tenant CHECK to the looser 0102-era form so 'foo..bar' is seedable (legacy data).
alter table public.ms_graph_connections drop constraint ms_graph_connections_entra_tenant_id_fmt;
alter table public.ms_graph_connections add constraint ms_graph_connections_entra_tenant_id_fmt
  check (entra_tenant_id ~ '^[A-Za-z0-9._-]+$');

-- Seed a legacy 'foo..bar' row (the write-guard would reject it only on user/org state, not tenant
-- format — so suspend it to mimic a row that predates the guard, as 0150 does for leftovers).
alter table public.ms_graph_connections disable trigger m365_connection_write_guard;
insert into public.ms_graph_connections
  (org_id, user_id, entra_tenant_id, scopes, refresh_token_ciphertext, key_id, status)
values ('a1510000-0000-0000-0000-000000000001','a1510000-0000-0000-0000-0000000000a1',
        'foo..bar', array['offline_access'], '\x63'::bytea, 'kek-v1', 'active');
alter table public.ms_graph_connections enable trigger m365_connection_write_guard;
select is(count(*)::int, 1, 'AC-M365-163 setup: the legacy foo..bar row is present (0102-era constraint allowed it)')
  from public.ms_graph_connections where org_id = 'a1510000-0000-0000-0000-000000000001';

-- Re-run the EXACT corrected 0103 §5a(ii) preflight (scrub + 'reconciled' audit per deleted row).
do $$
declare v_id uuid; v_org uuid;
begin
  for v_id, v_org in
    delete from public.ms_graph_connections
     where entra_tenant_id ~ '\.\.' or entra_tenant_id ~ '^[.]+'
    returning id, org_id
  loop
    perform public.log_audit('m365.connection.revoked', v_org, null, v_id,
      jsonb_build_object('reason','reconciled','source','preflight_bad_tenant'));
  end loop;
end $$;

select is(count(*)::int, 0, 'AC-M365-163: the corrected preflight DELETED the foo..bar row')
  from public.ms_graph_connections where entra_tenant_id ~ '\.\.';
select is(count(*)::int, 1, 'AC-M365-163: the preflight emitted a m365.connection.revoked audit row (reason=reconciled, source=preflight_bad_tenant)')
  from public.audit_events
 where action = 'm365.connection.revoked' and org_id = 'a1510000-0000-0000-0000-000000000001'
   and detail->>'reason' = 'reconciled' and detail->>'source' = 'preflight_bad_tenant';

-- Re-add the tightened §6 CHECK — it now adds CLEANLY (no violating rows). Under the buggy preflight
-- the foo..bar row would have survived and this ALTER would have ABORTED (→ 0103 never installed).
alter table public.ms_graph_connections drop constraint ms_graph_connections_entra_tenant_id_fmt;
select lives_ok($$
  alter table public.ms_graph_connections add constraint ms_graph_connections_entra_tenant_id_fmt
    check (entra_tenant_id ~ '^[A-Za-z0-9._-]+$' and entra_tenant_id !~ '\.\.' and entra_tenant_id !~ '^[.]+$')
$$, 'AC-M365-163: the tightened tenant CHECK adds cleanly after the scrub (0103 no longer aborts on a populated DB)');

-- ============================================================================
-- AC-M365-164: the 0105 lock-order connection-mutation RPCs. Shape + grants + the deterministic
-- success/reject/no-row contract. (The two-session deadlock-freedom is proven by the shell probe.)
-- ============================================================================

-- Shape: all three exist, are SECURITY DEFINER.
select is(count(*)::int, 3, 'AC-M365-164: the three 0105 connection-mutation RPCs exist in public')
  from pg_proc
 where pronamespace = 'public'::regnamespace
   and proname in ('m365_upsert_connection','m365_refresh_connection','m365_set_connection_status');
select is(count(*)::int, 3, 'AC-M365-164: all three RPCs are SECURITY DEFINER')
  from pg_proc
 where pronamespace = 'public'::regnamespace
   and proname in ('m365_upsert_connection','m365_refresh_connection','m365_set_connection_status')
   and prosecdef;

-- Grants: service_role may execute (the edge fn's client role); authenticated (a client role) may NOT.
select ok(has_function_privilege('service_role',
  'public.m365_upsert_connection(uuid,uuid,text,text,text[],bytea,bytea,timestamptz,text,timestamptz,timestamptz)', 'execute'),
  'AC-M365-164: service_role may execute m365_upsert_connection (the edge-fn write path)');
select ok(not has_function_privilege('authenticated',
  'public.m365_upsert_connection(uuid,uuid,text,text,text[],bytea,bytea,timestamptz,text,timestamptz,timestamptz)', 'execute'),
  'AC-M365-164: authenticated may NOT execute m365_upsert_connection (client-role lockdown)');

-- The guard still rejects via the RPC: upsert for a DISABLED user → 42501 (the RPC propagates it).
select throws_ok(
  $$ select public.m365_upsert_connection(
       'a1510000-0000-0000-0000-000000000002','a1510000-0000-0000-0000-0000000000a3',
       '11111111-2222-3333-4444-555555555555','oid-d',array['offline_access'],
       '\x01'::bytea,'\x02'::bytea,now(),'kek-v1',now(),now()) $$,
  '42501', null, 'AC-M365-164: m365_upsert_connection for a DISABLED user is rejected (42501) via the write-guard');

-- Success: upsert for an active+entitled target creates the connection (the RPC returned an id).
select public.m365_upsert_connection(
  'a1510000-0000-0000-0000-000000000002','a1510000-0000-0000-0000-0000000000a2',
  '11111111-2222-3333-4444-555555555555','oid-a',array['offline_access'],
  '\x01'::bytea,'\x02'::bytea,now(),'kek-v1',now(),now());
select is(count(*)::int, 1, 'AC-M365-164: m365_upsert_connection created the connection for an active+entitled target (returned an id)')
  from public.ms_graph_connections
 where org_id = 'a1510000-0000-0000-0000-000000000002' and user_id = 'a1510000-0000-0000-0000-0000000000a2';

-- refresh on the existing connection returns the id; refresh/status on a nonexistent id return null.
select ok(
  (select public.m365_refresh_connection(
            'a1510000-0000-0000-0000-000000000002','a1510000-0000-0000-0000-0000000000a2',
            c.id,'\x11'::bytea,'\x12'::bytea,now(),now())
     from public.ms_graph_connections c
    where c.org_id = 'a1510000-0000-0000-0000-000000000002' and c.user_id = 'a1510000-0000-0000-0000-0000000000a2')
  is not null,
  'AC-M365-164: m365_refresh_connection returns the id for an existing connection');
select is(
  public.m365_refresh_connection(
    'a1510000-0000-0000-0000-000000000002','a1510000-0000-0000-0000-0000000000a2',
    '00000000-0000-0000-0000-000000000000'::uuid,'\x11'::bytea,'\x12'::bytea,now(),now()),
  null::uuid,
  'AC-M365-164: m365_refresh_connection returns null for a nonexistent connection (no-row → caller treats as failure)');
select is(
  public.m365_set_connection_status(
    'a1510000-0000-0000-0000-000000000002','a1510000-0000-0000-0000-0000000000a2',
    '00000000-0000-0000-0000-000000000000'::uuid,'stale',now()),
  null::uuid,
  'AC-M365-164: m365_set_connection_status returns null for a nonexistent connection');

-- ============================================================================
-- AC-M365-166: the one-time reconcile scrub (0105 §4). Seed a survivor (active+entitled) and two
-- stale connections (inactive user / not-entitled org), then re-run the scrub's exact logic and
-- assert each stale row is deleted WITH a 'reconciled' audit row while the survivor is untouched.
-- (The scrub runs once at migrate time; this re-runs its logic to prove the conditional + audit.)
-- ============================================================================

-- Seed the survivor (active+entitled) via the upsert RPC.
select public.m365_upsert_connection(
  'a1510000-0000-0000-0000-000000000010','a1510000-0000-0000-0000-0000000000b1',
  '11111111-2222-3333-4444-555555555555','oid-s',array['offline_access'],
  '\x01'::bytea,'\x02'::bytea,now(),'kek-v1',now(),now());

-- Seed the two stale connections by suspending the write-guard (the guard would reject them —
-- inactive user / not-entitled org — which is precisely why they are stale leftovers).
alter table public.ms_graph_connections disable trigger m365_connection_write_guard;
insert into public.ms_graph_connections
  (org_id, user_id, entra_tenant_id, scopes, refresh_token_ciphertext, key_id, status)
values ('a1510000-0000-0000-0000-000000000020','a1510000-0000-0000-0000-0000000000b2',
        '11111111-2222-3333-4444-555555555555', array['offline_access'], '\x20'::bytea, 'kek-v1', 'active'),
       ('a1510000-0000-0000-0000-000000000030','a1510000-0000-0000-0000-0000000000b3',
        '11111111-2222-3333-4444-555555555555', array['offline_access'], '\x30'::bytea, 'kek-v1', 'active');
alter table public.ms_graph_connections enable trigger m365_connection_write_guard;

-- Re-run the EXACT 0105 §4 reconcile scrub.
do $$
declare v_id uuid; v_org uuid; v_user uuid;
begin
  for v_id, v_org, v_user in
    delete from public.ms_graph_connections c
     where exists (select 1 from public.profiles p
                    where p.id = c.user_id and p.org_id = c.org_id and p.status <> 'active')
        or not exists (select 1 from public.org_features f
                        where f.org_id = c.org_id and f.feature_key = 'm365_integration' and f.enabled)
    returning c.id, c.org_id, c.user_id
  loop
    perform public.log_audit('m365.connection.revoked', v_org, null, v_id,
      jsonb_build_object('reason','reconciled','source','scrub_inactive_or_disentitled','user_id',v_user));
  end loop;
end $$;

select is(count(*)::int, 1, 'AC-M365-166: the survivor (active+entitled) connection is NOT scrubbed')
  from public.ms_graph_connections where org_id = 'a1510000-0000-0000-0000-000000000010';
select is(count(*)::int, 0, 'AC-M365-166: the inactive-user connection was scrubbed')
  from public.ms_graph_connections where org_id = 'a1510000-0000-0000-0000-000000000020';
select is(count(*)::int, 0, 'AC-M365-166: the not-entitled-org connection was scrubbed')
  from public.ms_graph_connections where org_id = 'a1510000-0000-0000-0000-000000000030';
select is(count(*)::int, 2, 'AC-M365-166: each scrubbed connection emitted a reconcile audit row (reason=reconciled, source=scrub_inactive_or_disentitled)')
  from public.audit_events
 where action = 'm365.connection.revoked' and detail->>'reason' = 'reconciled'
   and detail->>'source' = 'scrub_inactive_or_disentitled';

select * from finish();
rollback;
