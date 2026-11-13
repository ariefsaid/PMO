import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const up = readFileSync('supabase/migrations/0865_journal_capture_evidence.sql', 'utf8');
const down = readFileSync('supabase/migrations/rollback/0865_journal_capture_evidence_down.sql', 'utf8');
const original = readFileSync('supabase/migrations/0858_record_only_journal.sql', 'utf8');
const down0858 = readFileSync('supabase/migrations/rollback/0858_record_only_journal_down.sql', 'utf8');
const source = (sql) => sql.match(/create(?: or replace)? function public\.create_record_only_journal_purchase\([\s\S]*?\nend \$\$;/i)?.[0].replace('create or replace function', 'create function');
const psql = (sql) => spawnSync('docker', ['exec', '-i', 'supabase_db_pmo-portal', 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], { input: sql, encoding: 'utf8' });

test('AC-ROP-SAFETY-ROLLBACK restores the exact 0858 function body and names edge-first ordering', () => {
  assert.equal(source(down), source(original));
  assert.match(down0858, /deploy.*adapter-dispatch.*before.*database rollback/i);
  assert.doesNotMatch(down0858, /undo_record_only_purchase|record_only_journal_requests/);
});

test('AC-ROP-SAFETY-ROLLBACK catalog round trip restores body and grants without changing shared schema', () => {
  const script = `begin;
create temp table new_body as select pg_get_functiondef('public.create_record_only_journal_purchase(jsonb,boolean)'::regprocedure) body, proacl from pg_proc where oid='public.create_record_only_journal_purchase(jsonb,boolean)'::regprocedure;
${down}
create temp table restored as select pg_get_functiondef('public.create_record_only_journal_purchase(jsonb,boolean)'::regprocedure) body, proacl from pg_proc where oid='public.create_record_only_journal_purchase(jsonb,boolean)'::regprocedure;
${up}
do $$ begin
 if (select body from new_body) is distinct from pg_get_functiondef('public.create_record_only_journal_purchase(jsonb,boolean)'::regprocedure) then raise exception 'forward_body_differs'; end if;
 if (select proacl from restored) is distinct from (select proacl from new_body) then raise exception 'acl_changed'; end if;
end $$;
rollback;`;
  const result = psql(script);
  assert.equal(result.status, 0, result.stderr);
});

test('AC-ROP-SAFETY-ROLLBACK refuses to discard capture provenance', () => {
  const fixture = readFileSync('supabase/tests/2195_record_only_journal.test.sql', 'utf8');
  const setup = fixture.slice(fixture.indexOf('insert into organizations'), fixture.indexOf('select public.upsert_erp_purchase_documents'));
  const script = `begin;\n${setup}\ninsert into public.erp_purchase_captures(procurement_id,org_id,binding_id,request_id,payload,kind,stage,captured_by,source_evidence) values ('21950000-0000-0000-0000-0000000000e1','21950000-0000-0000-0000-00000000000a',(select id from public.external_org_bindings where org_id='21950000-0000-0000-0000-00000000000a'),'21950000-0000-0000-0000-000000000a96','{}','journal','paid','21950000-0000-0000-0000-0000000000a4','[]');\n${down}\nrollback;`;
  const result = psql(script);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /capture_evidence_exists/);
});
