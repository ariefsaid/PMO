// Run only against the local, locked fixture: this imports the shipped DAL and real client.
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { supabase } = await server.ssrLoadModule('/src/lib/supabase/client.ts');
  const { listBudgetVersions } = await server.ssrLoadModule('/src/lib/db/budgets.ts');
  const login = await supabase.auth.signInWithPassword({ email: 'admin@acme.test', password: 'Passw0rd!dev' });
  assert.equal(login.error, null);
  const project = '04000000-0000-0000-0002-000000000001';
  const old = await supabase.from('budget_versions').select('id,currency,line_items:budget_line_items(id)').eq('project_id', project).eq('version', 1).single();
  assert.equal(old.error, null);
  console.log(`Observed embedded line count: ${old.data.line_items.length}`);
  const versions = await listBudgetVersions(project);
  assert.equal(versions.length, 1001);
  assert.equal(versions[0].line_items.length, 1001);
  assert.equal(versions[0].editor_ids.length, 1001);
  assert.equal(versions[0].total, 10.01);
  assert.equal(versions[0].currency, old.data.currency);
  assert.equal(versions[1].total, 0);
  assert.equal(new Set(versions.map(v => v.id)).size, 1001);
  assert.equal(new Set(versions[0].line_items.map(v => v.id)).size, 1001);
  assert.equal(new Set(versions[0].editor_ids).size, 1001);
  assert.deepEqual(versions.map(v => v.version), Array.from({ length: 1001 }, (_, i) => i + 1));
  assert.deepEqual(versions[0].line_items.map(v => v.id), [...versions[0].line_items.map(v => v.id)].sort());
  assert.deepEqual(versions[0].editor_ids, [...versions[0].editor_ids].sort());
  console.log('Shipped DAL: 1001 versions, lines and editors; exact total 10.01');
  await supabase.auth.signOut();
} finally {
  await server.close();
}
