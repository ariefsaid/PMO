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
  // 1530 sits above this window: it puts the field-account guard at the top of this body, and its
  // rollback strips no body, so the catalog snapshotted at head can never be reproduced by
  // re-applying 0865 alone. The guard is therefore proven HERE, at head, and the expected forward
  // body is 0865's own level body: the head definition minus that one injected line. This is the
  // same ruling scripts/2195-capture-rollback.test.sql:15-20,34-41 applies to the entries 1209/1530
  // guarded; nothing else is tolerated, the comparison below is still exact.
  // The guard must be present at head as the literal injected line, so a root gate fails loudly if
  // 1530 stops guarding this money RPC. `strpos`/`chr(10)` keep it a literal match (no regex, no
  // LIKE wildcards), and a `--`-commented guard cannot satisfy it: the text has to start right after
  // a newline with the two-space indent 1530 injects.
  const script = `begin;
do $$ begin
  if not exists (select 1 from pg_proc
                  where oid='public.create_record_only_journal_purchase(jsonb,boolean)'::regprocedure
                    and strpos(prosrc, chr(10) || '  perform public.assert_not_light();') > 0) then
    raise exception 'head_guard_missing';
  end if;
end $$;
create temp table new_body as select replace(pg_get_functiondef('public.create_record_only_journal_purchase(jsonb,boolean)'::regprocedure), E'\\n  perform public.assert_not_light();', '') body, proacl from pg_proc where oid='public.create_record_only_journal_purchase(jsonb,boolean)'::regprocedure;
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
