import assert from 'node:assert/strict';
import test from 'node:test';
import { warnIfOlderThanOneYear, buildSummary } from './historicalImportSummary.mjs';

test('AC-HIST-009: a row dated > 1 year before "now" produces a warning (does not block)', () => {
  const now = new Date('2026-07-04T00:00:00Z');
  const warning = warnIfOlderThanOneYear('2024-01-01', now);
  assert.match(warning, /more than 1 year/i);
});

test('AC-HIST-009: a row dated within 1 year produces no warning', () => {
  const now = new Date('2026-07-04T00:00:00Z');
  const warning = warnIfOlderThanOneYear('2026-01-01', now);
  assert.equal(warning, null);
});

test('AC-HIST-008: buildSummary prints created/skipped/failed counts by entity + the batch id', () => {
  const summary = buildSummary({
    importBatchId: 'batch-xyz',
    projects: { created: 3, skipped: 1, failed: 0 },
    cases: { created: 5, skipped: 2, failed: 1 },
    recordsByType: { PR: { created: 5, skipped: 0, failed: 0 }, PO: { created: 4, skipped: 1, failed: 0 } },
    references: { resolved: 10, created: 2 },
  });
  assert.match(summary, /batch-xyz/);
  assert.match(summary, /projects.*created:\s*3/is);
  assert.match(summary, /cases.*created:\s*5/is);
  assert.match(summary, /PR.*created:\s*5/is);
});
