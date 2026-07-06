import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveOrCreateStub, buildProvenanceEvent } from './historicalImportResolve.mjs';

test('AC-HIST-007: resolveOrCreateStub reports "found" when the lookup already has the name', async () => {
  const lookup = new Map([['acme corp', { id: 'existing-1' }]]);
  const findFn = async (name) => lookup.get(name.trim().toLowerCase()) ?? null;
  const createFn = async () => { throw new Error('should not be called'); };
  const result = await resolveOrCreateStub('Acme Corp', { findFn, createFn });
  assert.equal(result.id, 'existing-1');
  assert.equal(result.action, 'found');
});

test('AC-HIST-007: resolveOrCreateStub creates a stub and reports "created" when absent', async () => {
  const findFn = async () => null;
  const createFn = async (name) => ({ id: 'new-1', name });
  const result = await resolveOrCreateStub('New Vendor LLC', { findFn, createFn });
  assert.equal(result.id, 'new-1');
  assert.equal(result.action, 'created');
});

test('AC-HIST-005: buildProvenanceEvent produces from_status=NULL, the terminal to_status, and an explicit org_id', () => {
  const event = buildProvenanceEvent({
    procurementId: 'proc-1', orgId: 'org-explicit-1', terminalStatus: 'Paid',
    importBatchId: 'batch-1', importDate: '2026-07-04',
  });
  assert.equal(event.from_status, null);
  assert.equal(event.to_status, 'Paid');
  assert.equal(event.org_id, 'org-explicit-1'); // NEVER the column's demo-org default (FR-HIST-013)
  assert.match(event.notes, /Historical import.*batch-1.*2026-07-04/is);
});
