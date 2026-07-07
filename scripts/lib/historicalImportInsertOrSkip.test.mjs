import { test } from 'node:test';
import assert from 'node:assert/strict';
import { insertOrSkip } from './historicalImportInsertOrSkip.mjs';

test('B2: inserts and returns {action:"created", id} when nothing exists', async () => {
  let inserted = null;
  const res = await insertOrSkip({
    findExisting: async () => null,
    insert: async () => { inserted = { id: 'new-1' }; return { data: inserted, error: null }; },
  });
  assert.deepEqual(res, { action: 'created', id: 'new-1' });
  assert.ok(inserted);
});

test('B2: re-run — skips (action:"skipped") and does NOT insert when the row already exists', async () => {
  let insertCalled = false;
  const res = await insertOrSkip({
    findExisting: async () => ({ id: 'existing-1' }),
    insert: async () => { insertCalled = true; return { data: { id: 'x' }, error: null }; },
  });
  assert.deepEqual(res, { action: 'skipped', id: 'existing-1' });
  assert.equal(insertCalled, false, 'must not insert when a matching row already exists');
});

test('A4/B2: a 23505 from insert (concurrent/race) is treated as skipped, re-resolving the row', async () => {
  const res = await insertOrSkip({
    findExisting: async () => null,          // missed at check time
    insert: async () => ({ data: null, error: { code: '23505', message: 'duplicate key' } }),
    reResolve: async () => ({ id: 'raced-1' }),
  });
  assert.deepEqual(res, { action: 'skipped', id: 'raced-1' });
});

test('B2: a non-23505 insert error surfaces as {action:"failed", error}', async () => {
  const res = await insertOrSkip({
    findExisting: async () => null,
    insert: async () => ({ data: null, error: { code: '23502', message: 'null violates not-null' } }),
  });
  assert.equal(res.action, 'failed');
  assert.match(res.error, /null violates not-null/);
});
