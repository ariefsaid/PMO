import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { readMigrationPair, runReversalProof } from './check-m365-document-link-reversal.mjs';

test('0292 reversal pair refuses linked state before any destructive DDL', () => {
  const { up, down, guard } = readMigrationPair();
  assert.match(up, /where file_path is not null/);
  assert.match(guard, /source='onedrive'/);
  assert.match(guard, /raise exception .*Unlink Microsoft references/s);
  assert.ok(down.indexOf(guard) < down.search(/\bdrop trigger\b/i));
});

test('0292 reversal pair restores the pre-feature transition function and grants', () => {
  const { down } = readMigrationPair();
  assert.match(down, /create or replace function public\.transition_document_status/);
  assert.match(down, /grant insert on public\.project_documents to authenticated/);
  assert.match(down, /grant insert,update on public\.procurement_documents to authenticated/);
  assert.match(down, /drop table public\.org_m365_document_settings/);
});

test('reversal witness refuses to touch the database without the shared lock', () => {
  const prior = process.env.PMO_DB_LOCK_HELD;
  delete process.env.PMO_DB_LOCK_HELD;
  try { assert.throws(runReversalProof, /with-db-lock\.sh/); }
  finally { if (prior !== undefined) process.env.PMO_DB_LOCK_HELD = prior; }
});

test('upgrade fixture owns only synthetic identifiers and checks old path plus metadata-only row', () => {
  const sql = fs.readFileSync(new URL('../supabase/migration-tests/m365_doc_linking_upgrade.test.sql', import.meta.url), 'utf8');
  assert.match(sql, /10200000-0000-0000-0000-000000000301/);
  assert.match(sql, /documents\/m365-fixture\.pdf/);
  assert.match(sql, /10200000-0000-0000-0000-000000000302/);
});
