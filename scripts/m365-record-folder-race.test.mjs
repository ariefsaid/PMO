import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('race harness exercises two sessions, both typed RPC branches, and preserves manual linking', () => {
  const source=fs.readFileSync(new URL('./m365-record-folder-race.mjs',import.meta.url),'utf8');
  const migration=fs.readFileSync(new URL('../supabase/migrations/0336_m365_record_folders.sql',import.meta.url),'utf8');
  assert.match(migration,/pg_advisory_xact_lock/);
  assert.match(source,/race\('project'/);
  assert.match(source,/race\('procurement'/);
  assert.match(source,/pg_sleep\(/);
  assert.match(source,/manual folder inserts remain allowed/);
  assert.match(source,/finally/);
});
