-- 0157_m365_ciphertext_envelope_check.test.sql
-- AC-M365-160 [pgTAP]: the token ciphertext columns reject a non-envelope value (migration 0151).
--
-- REGRESSION for HIGH-A1 (live security audit, 2026-07-24). supabase-js JSON-encodes RPC args, so
-- passing a `Uint8Array` as a `bytea` parameter serialized it to `{"0":12,"1":255,…}` and Postgres
-- stored that LITERAL ASCII. The live row was 14,709 bytes of printable text starting `{"0"` —
-- genuine AES-GCM output inside, but wrapped so the IV could never be recovered. The row could
-- never be decrypted, so `disconnect`'s best-effort Microsoft revoke threw inside its catch: the
-- local row was deleted and `m365.connection.revoked` audited while the refresh token stayed LIVE
-- at Microsoft for ~90 days with our only copy destroyed.
--
-- Four adversarial review rounds and ~7,000 tests missed it because the unit mock holds writes as
-- in-memory JS objects and never crosses the JS<->Postgres boundary. This test exists BECAUSE it
-- runs against a real Postgres: it asserts the DATABASE refuses the exact byte shape that shipped.
begin;
select plan(3);

insert into organizations (id, name) values
  ('01570000-0000-0000-0000-000000000001','AC-M365-160 Org');
insert into auth.users (id, email) values
  ('01570000-0000-0000-0000-0000000000a1','m365-envelope@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('01570000-0000-0000-0000-0000000000a1','01570000-0000-0000-0000-000000000001','M365 Env','m365-envelope@example.com','Admin');
-- The 0113 write-guard runs BEFORE the CHECK; without the entitlement every insert fails as
-- org_not_entitled and this test would pass for entirely the wrong reason.
insert into org_features (org_id, feature_key, enabled) values
  ('01570000-0000-0000-0000-000000000001','m365_integration',true);

-- 1. The ACTUAL shape that shipped: the ASCII of a JSON-stringified Uint8Array.
select throws_ok(
  $$insert into ms_graph_connections
      (org_id, user_id, entra_tenant_id, entra_user_object_id, scopes,
       refresh_token_ciphertext, access_token_ciphertext, key_id, status)
    values ('01570000-0000-0000-0000-000000000001','01570000-0000-0000-0000-0000000000a1',
            '071bc60b-b833-4baf-83ce-7effd4028d3c','oid-env',array['Files.Read'],
            convert_to('{"0":12,"1":255,"2":88,"3":7,"4":19,"5":200,"6":3,"7":44,"8":91,"9":6,"10":77,"11":150,"12":8,"13":9,"14":10,"15":11,"16":12,"17":13,"18":14,"19":15,"20":16,"21":17,"22":18,"23":19,"24":20,"25":21,"26":22,"27":23}','UTF8'),
            '\x000102030405060708090a0b0c0d0e0f101112131415161718191a1b'::bytea,
            'kek-v1','active')$$,
  '23514',
  NULL,
  'AC-M365-160: a JSON-stringified Uint8Array (the live HIGH-A1 shape) is rejected by the CHECK'
);

-- 2. Shorter than iv(12) + gcm_tag(16) cannot be a valid envelope.
select throws_ok(
  $$insert into ms_graph_connections
      (org_id, user_id, entra_tenant_id, entra_user_object_id, scopes,
       refresh_token_ciphertext, access_token_ciphertext, key_id, status)
    values ('01570000-0000-0000-0000-000000000001','01570000-0000-0000-0000-0000000000a1',
            '071bc60b-b833-4baf-83ce-7effd4028d3c','oid-env',array['Files.Read'],
            '\x0011223344'::bytea,
            '\x000102030405060708090a0b0c0d0e0f101112131415161718191a1b'::bytea,
            'kek-v1','active')$$,
  '23514',
  NULL,
  'AC-M365-160: a ciphertext shorter than IV + GCM tag is rejected'
);

-- 3. A well-formed envelope still stores — the constraint must not block the happy path.
select lives_ok(
  $$insert into ms_graph_connections
      (org_id, user_id, entra_tenant_id, entra_user_object_id, scopes,
       refresh_token_ciphertext, access_token_ciphertext, key_id, status)
    values ('01570000-0000-0000-0000-000000000001','01570000-0000-0000-0000-0000000000a1',
            '071bc60b-b833-4baf-83ce-7effd4028d3c','oid-env',array['Files.Read'],
            '\x0c1f4b7d9e2a3c5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7'::bytea,
            '\x000102030405060708090a0b0c0d0e0f101112131415161718191a1b'::bytea,
            'kek-v1','active')$$,
  'AC-M365-160: a well-formed 32-byte envelope is accepted (the guard is not over-broad)'
);

select * from finish();
rollback;
