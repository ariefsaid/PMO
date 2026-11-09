-- #1017 S2 (migration 0818): a changed or removed org app clears the org's personal Microsoft 365 connections
-- (their tokens were issued by the old app), one audit row per connection; a secret-only rotation keeps them.
-- AC-M365SS-008.
-- Mutation check (CI proves): skip the connection delete on app change -> AC-M365SS-008 red.
begin;
select plan(11);

insert into organizations (id, name) values
 ('e8180000-0000-0000-0000-00000000000a','Org A'),
 ('e8180000-0000-0000-0000-00000000000b','Org B');
insert into auth.users (id, email) values
 ('e8180000-0000-0000-0000-0000000000a1','e818-admin-a@example.com'),
 ('e8180000-0000-0000-0000-0000000000a2','e818-member-a@example.com'),
 ('e8180000-0000-0000-0000-0000000000b1','e818-admin-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('e8180000-0000-0000-0000-0000000000a1','e8180000-0000-0000-0000-00000000000a','Admin A','e818-admin-a@example.com','Admin','active'),
 ('e8180000-0000-0000-0000-0000000000a2','e8180000-0000-0000-0000-00000000000a','Member A','e818-member-a@example.com','Project Manager','active'),
 ('e8180000-0000-0000-0000-0000000000b1','e8180000-0000-0000-0000-00000000000b','Admin B','e818-admin-b@example.com','Admin','active');
insert into org_features (org_id, feature_key, enabled) values
 ('e8180000-0000-0000-0000-00000000000a','m365_integration',true),
 ('e8180000-0000-0000-0000-00000000000b','m365_integration',true);

-- Connections for both A users and for B's Admin; the app for A.
create function pg_temp.seed_connections() returns void language sql as $$
  insert into public.ms_graph_connections (org_id, user_id, entra_tenant_id, scopes, refresh_token_ciphertext, key_id, status)
  select o, u, 'tenant', array['Files.Read'], '\x01000000000000000000000000000000000000000000000000000000'::bytea, 'kek-v1', 'active'
    from (values
      ('e8180000-0000-0000-0000-00000000000a'::uuid, 'e8180000-0000-0000-0000-0000000000a1'::uuid),
      ('e8180000-0000-0000-0000-00000000000a'::uuid, 'e8180000-0000-0000-0000-0000000000a2'::uuid)) v(o, u)
  on conflict (org_id, user_id) do nothing;
$$;
select pg_temp.seed_connections();
insert into public.ms_graph_connections (org_id, user_id, entra_tenant_id, scopes, refresh_token_ciphertext, key_id, status)
values ('e8180000-0000-0000-0000-00000000000b','e8180000-0000-0000-0000-0000000000b1','tenant',array['Files.Read'],
        '\x02000000000000000000000000000000000000000000000000000000'::bytea,'kek-v1','active');

set local role service_role;
select public.m365_set_org_app('e8180000-0000-0000-0000-00000000000a','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','s1','e8180000-0000-0000-0000-0000000000a1');
reset role;
select is((select count(*)::int from ms_graph_connections where org_id='e8180000-0000-0000-0000-00000000000a'), 2,
  'AC-M365SS-008 a first save leaves the org''s connections alone');

-- secret-only rotation keeps them
set local role service_role;
select is((public.m365_set_org_app('e8180000-0000-0000-0000-00000000000a','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','s2','e8180000-0000-0000-0000-0000000000a1'))->>'changed_app',
  'false', 'AC-M365SS-008 a secret-only rotation reports no app change');
reset role;
select is((select count(*)::int from ms_graph_connections where org_id='e8180000-0000-0000-0000-00000000000a'), 2,
  'AC-M365SS-008 a secret-only rotation keeps both connections');

-- a changed client id clears them, one audit row each
select set_config('e818.ids', (select string_agg(id::text, ',' order by id) from ms_graph_connections where org_id='e8180000-0000-0000-0000-00000000000a'), true);
set local role service_role;
select is((public.m365_set_org_app('e8180000-0000-0000-0000-00000000000a','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','cccccccc-cccc-cccc-cccc-cccccccccccc',null,'e8180000-0000-0000-0000-0000000000a1'))->>'changed_app',
  'true', 'AC-M365SS-008 a changed client id reports an app change');
reset role;
select is((select count(*)::int from ms_graph_connections where org_id='e8180000-0000-0000-0000-00000000000a'), 0,
  'AC-M365SS-008 a changed client id removes the org''s connections');
select is((select string_agg(entity_id::text, ',' order by entity_id) from audit_events
            where org_id='e8180000-0000-0000-0000-00000000000a' and action='m365.connection.cleared' and detail->>'reason'='app_changed'),
  current_setting('e818.ids'), 'AC-M365SS-008 one audit row per removed connection, reason app_changed');
select is((select count(*)::int from ms_graph_connections where org_id='e8180000-0000-0000-0000-00000000000b'), 1,
  'AC-M365SS-008 another org''s connection is untouched');

-- a changed tenant id clears them too
select pg_temp.seed_connections();
set local role service_role;
select public.m365_set_org_app('e8180000-0000-0000-0000-00000000000a','dddddddd-dddd-dddd-dddd-dddddddddddd','cccccccc-cccc-cccc-cccc-cccccccccccc',null,'e8180000-0000-0000-0000-0000000000a1');
reset role;
select is((select count(*)::int from ms_graph_connections where org_id='e8180000-0000-0000-0000-00000000000a'), 0,
  'AC-M365SS-008 a changed tenant id removes the org''s connections');

-- clearing the app clears them
select pg_temp.seed_connections();
set local role service_role;
select public.m365_clear_org_app('e8180000-0000-0000-0000-00000000000a','e8180000-0000-0000-0000-0000000000a1');
reset role;
select is((select count(*)::int from ms_graph_connections where org_id='e8180000-0000-0000-0000-00000000000a'), 0,
  'AC-M365SS-008 clearing the app removes the org''s connections');
select is((select count(*)::int from audit_events where org_id='e8180000-0000-0000-0000-00000000000a' and action='m365.connection.cleared'), 6,
  'AC-M365SS-008 each removal across change, change and clear is audited');
select is((select count(*)::int from ms_graph_connections where org_id='e8180000-0000-0000-0000-00000000000b'), 1,
  'AC-M365SS-008 another org''s connection survives the clear');

select * from finish();
rollback;
