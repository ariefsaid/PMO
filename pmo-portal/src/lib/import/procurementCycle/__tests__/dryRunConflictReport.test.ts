import { describe, it, expect, vi } from 'vitest';
import { buildDryRunConflictReport } from '../dryRunConflictReport';
import { makeRefLookup } from '@/src/lib/import/refLookup';
import type { ValidatedGroup } from '../types';
import type { ImportSkipLookup } from '@/src/lib/db/procurementImportSkip';

const projectLookup = makeRefLookup([], 'Project');
const vendorLookup = makeRefLookup([], 'Vendor');

function makeGroup(caseRef: string): ValidatedGroup {
  return {
    valid: true, groupErrors: [],
    group: { caseRef, attrs: { title: caseRef, project: undefined, caseStatus: undefined }, rows: [
      { caseRef, type: 'PR', title: caseRef, project: undefined, caseStatus: undefined, vendor: undefined, externalRef: `${caseRef}-PR`, status: 'Approved', date: '2025-01-01', amount: '100', rowNumber: 1 },
    ], errors: [] },
    rows: [{ rowNumber: 1, valid: true, errors: [] }],
  };
}

describe('buildDryRunConflictReport — AC-IDEM-005 (zero writes, would-create/skip/collide tally)', () => {
  it('reports would-create for a group with no matching key anywhere', async () => {
    const skipLookup: ImportSkipLookup = {
      findExistingCase: vi.fn().mockResolvedValue(null),
      findExistingRecord: vi.fn().mockResolvedValue(null),
      findCrossBatchCollision: vi.fn().mockResolvedValue(null),
    };
    const report = await buildDryRunConflictReport([makeGroup('CASE-NEW')], {
      importBatchId: 'batch-1', skipLookup, projectLookup, vendorLookup,
    });
    expect(report.wouldCreate).toBe(2); // 1 case header + 1 PR record
    expect(report.wouldSkip).toBe(0);
    expect(report.wouldCollide).toBe(0);
    expect(skipLookup.findExistingCase).toHaveBeenCalled(); // read-only probe called
  });

  it('reports would-skip for a group whose case already exists in the SAME batch', async () => {
    const skipLookup: ImportSkipLookup = {
      findExistingCase: vi.fn().mockResolvedValue({ id: 'existing' }),
      findExistingRecord: vi.fn().mockResolvedValue({ id: 'existing-rec' }),
      findCrossBatchCollision: vi.fn().mockResolvedValue(null),
    };
    const report = await buildDryRunConflictReport([makeGroup('CASE-DUP')], {
      importBatchId: 'batch-1', skipLookup, projectLookup, vendorLookup,
    });
    expect(report.wouldSkip).toBe(2);
    expect(report.wouldCreate).toBe(0);
  });

  it('reports would-collide for a group whose key exists in a DIFFERENT batch', async () => {
    const skipLookup: ImportSkipLookup = {
      findExistingCase: vi.fn().mockResolvedValue(null),
      findExistingRecord: vi.fn().mockResolvedValue(null),
      findCrossBatchCollision: vi.fn().mockResolvedValue({ id: 'other', import_batch_id: 'batch-0' }),
    };
    const report = await buildDryRunConflictReport([makeGroup('CASE-COLLIDE')], {
      importBatchId: 'batch-1', skipLookup, projectLookup, vendorLookup,
    });
    expect(report.wouldCollide).toBe(2);
    expect(report.wouldCreate).toBe(0);
  });
});
