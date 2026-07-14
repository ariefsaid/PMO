-- 0143_ms_graph_connections_schema.test.sql
-- AC-M365-002 [pgTAP]: token columns are ciphertext (bytea), NO plaintext token column exists, the
-- KEK-reference + scopes metadata are present, and the status CHECK rejects a bad value (FR-M365-001/003,
-- NFR-M365-003 structural).
begin;
select plan(6);

select col_type_is('public','ms_graph_connections','refresh_token_ciphertext','bytea',
  'AC-M365-002 refresh token stored as bytea ciphertext');
select col_type_is('public','ms_graph_connections','access_token_ciphertext','bytea',
  'AC-M365-002 access token stored as bytea ciphertext');
select is(
  (select count(*)::int from information_schema.columns
     where table_schema = 'public' and table_name = 'ms_graph_connections'
       and column_name like '%token%' and data_type = 'text'),
  0, 'AC-M365-002 no text-typed *token* column (no plaintext token at rest)');
select has_column('public','ms_graph_connections','key_id',
  'AC-M365-002 key_id (KEK reference) column present');
select has_column('public','ms_graph_connections','scopes',
  'AC-M365-002 scopes column present');

insert into organizations (id, name) values
  ('01430000-0000-0000-0000-000000000001','AC-M365-002 Org');
insert into auth.users (id, email) values
  ('01430000-0000-0000-0000-0000000000a1','m365-schema@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('01430000-0000-0000-0000-0000000000a1','01430000-0000-0000-0000-000000000001','S','m365-schema@example.com','Admin');
select throws_ok(
  $$ insert into public.ms_graph_connections
       (org_id,user_id,entra_tenant_id,refresh_token_ciphertext,key_id,status)
     values ('01430000-0000-0000-0000-000000000001','01430000-0000-0000-0000-0000000000a1',
             't','\x00'::bytea,'k','bogus') $$,
  '23514', null, 'AC-M365-002 status CHECK rejects an unknown value');

select * from finish();
rollback;
