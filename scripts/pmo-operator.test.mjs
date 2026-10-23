import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { ALLOWED_TABLES, READ_ONLY_TABLES, ALLOWED_RPCS, OPERATOR_READ_RPCS, COMMANDS } from './pmo.mjs';

test('operator read surface is narrowly allow-listed', () => {
  assert.ok(!ALLOWED_TABLES.includes('budget_versions'));
  assert.ok(!ALLOWED_TABLES.includes('budget_line_items'));
  assert.ok(READ_ONLY_TABLES.budget_versions);
  assert.ok(READ_ONLY_TABLES.budget_line_items);
  assert.deepEqual(READ_ONLY_TABLES.budget_category_account_map, ['category', 'erp_account']);
  assert.ok(READ_ONLY_TABLES.erp_gl_entry_mirror.includes('project'));
  assert.ok(READ_ONLY_TABLES.project_documents.includes('id'));
  assert.ok(OPERATOR_READ_RPCS.includes('project_mapped_actuals'));
  assert.ok(!ALLOWED_RPCS.includes('project_mapped_actuals'));
  assert.ok(COMMANDS.includes('get'));
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const migration = fs.readFileSync(path.join(root, 'supabase/migrations/0367_api_client_operator_reads.sql'), 'utf8');
  for (const name of ['operator_read_tables', 'operator_read_rpcs']) assert.match(migration, new RegExp(`${name} constant text\\[\\]`));
  assert.match(migration, /auth_role\(\)::text in \('Admin', 'Executive', 'Project Manager', 'Finance'\) and public\.is_active_member\(\)/g);
  assert.equal((migration.match(/public\.is_active_member\(\)/g) ?? []).length >= 3, true);
});
