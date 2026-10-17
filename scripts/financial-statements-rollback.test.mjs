import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbContainer = process.env.SUPABASE_DB_CONTAINER || 'supabase_db_pmo-portal';
const migrations = ['0294_statement_account_source', '0295_statement_ledger_source', '0296_replace_erp_account_chart', '0312_statement_gl_replay_finish', '0304_statement_gl_missing_reference', '0305_statement_company_replay'];
const sqlFile = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function psql(sql) {
  const result = spawnSync('docker', ['exec', '-i', dbContainer, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], {
    input: sql, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  assert.equal(result.status, 0, output);
  return output.trim();
}

function verifyLocalTarget() {
  const target = execFileSync('docker', ['inspect', '--format', '{{.Name}}', dbContainer], { encoding: 'utf8' }).trim();
  assert.equal(target, `/${dbContainer}`, 'rollback test may target only the named local Supabase database container');
}

test('financial statement source migrations roll back and reapply inside a self-restoring transaction', () => {
  verifyLocalTarget();
  const [a294, a295, a296, a303, a304, a305] = migrations.map((name) => sqlFile(`supabase/migrations/${name}.sql`));
  const [d294, d295, d296, d303, d304, d305] = migrations.map((name) => sqlFile(`supabase/migrations/rollback/${name}_down.sql`));
  const fixture = `insert into public.erp_gl_entry_mirror(org_id,erp_name,company,account,debit,credit,erp_modified)
    values ('00000000-0000-0000-0000-000000000001','GL-ROLLBACK-FIXTURE','Rollback Co','Synthetic Account',0.123456789,0,'2026-01-01');`;
  const script = `begin;
set local client_min_messages=warning;
${fixture}
savepoint unsafe_narrowing;
\\set ON_ERROR_STOP off
${d295}
\\set ON_ERROR_STOP on
rollback to savepoint unsafe_narrowing;
do $$ begin
  if (select debit from public.erp_gl_entry_mirror where erp_name='GL-ROLLBACK-FIXTURE') <> 0.123456789 then
    raise exception 'unsafe numeric narrowing changed the source amount';
  end if;
  if (select data_type from information_schema.columns where table_schema='public' and table_name='erp_gl_entry_mirror' and column_name='debit') <> 'numeric' then
    raise exception 'unsafe numeric narrowing changed the column type';
  end if;
end $$;
${d305}
${d304}
${d303}
${d296}
update public.erp_gl_entry_mirror set debit=0 where erp_name='GL-ROLLBACK-FIXTURE';
${d295}
${d294}
${a294}
${a295}
${a296}
${a303}
${a304}
${a305}
rollback;
`;
  const output = psql(script);
  assert.match(output, /cannot narrow GL debit\/credit/i, 'down migration must explicitly refuse lossy numeric narrowing');
});
