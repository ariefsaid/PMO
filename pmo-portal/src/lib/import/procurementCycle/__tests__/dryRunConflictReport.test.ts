import { describe, it, expect, vi } from 'vitest';
import { buildDryRunConflictReport } from '../dryRunConflictReport';
import type { ValidatedGroup } from '../types';
import type { ImportSkipLookup } from '@/src/lib/db/procurementImportSkip';


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
      importBatchId: 'batch-1', skipLookup,
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
      importBatchId: 'batch-1', skipLookup,
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
      importBatchId: 'batch-1', skipLookup,
    });
    expect(report.wouldCollide).toBe(2);
    expect(report.wouldCreate).toBe(0);
  });
});

it('scopes record decisions to the previously matched case', async () => {
  const findCrossBatchCollision = vi.fn().mockImplementation(async (table: string, _key: string, _batch: string, id?: string) => {
    if (table === 'procurements') return { id: 'prior-case', import_batch_id: 'old' };
    return id === 'prior-case' ? { id: 'prior-record', import_batch_id: 'old' } : null;
  });
  const skipLookup: ImportSkipLookup = { findExistingCase: vi.fn().mockResolvedValue(null), findExistingRecord: vi.fn().mockResolvedValue(null), findCrossBatchCollision };
  const result = await buildDryRunConflictReport([makeGroup('C')], { importBatchId: 'new', skipLookup });
  expect(result).toEqual({ wouldCreate: 0, wouldSkip: 0, wouldCollide: 2 });
});

it('does not probe another case for records when the case is new', async () => {
  const lookup: ImportSkipLookup = {
    findExistingCase: vi.fn().mockResolvedValue(null), findExistingRecord: vi.fn(),
    findCrossBatchCollision: vi.fn().mockImplementation(async (table: string) => table === 'procurements' ? null : { id: 'unrelated', import_batch_id: 'old' }),
  };
  expect(await buildDryRunConflictReport([makeGroup('new')], { importBatchId: 'batch', skipLookup: lookup })).toEqual({ wouldCreate: 2, wouldSkip: 0, wouldCollide: 0 });
  expect(lookup.findCrossBatchCollision).toHaveBeenCalledTimes(1);
});

it('classifies all seven types using the matched case and supports retry after a read error', async () => {
  const group = makeGroup('all');
  const types = ['PR', 'RFQ', 'Quotation', 'PO', 'GR', 'VI', 'Payment'];
  group.group.rows = types.map((type, i) => ({ ...group.group.rows[0], type, externalRef: `key-${i}`, rowNumber: i + 1 }));
  group.rows = types.map((_, i) => ({ rowNumber: i + 1, valid: true, errors: [] }));
  const listCaseRecords = vi.fn().mockRejectedValueOnce(new Error('unavailable')).mockImplementation(async (_table: string, id: string) => {
    expect(id).toBe('case-old');
    return [];
  });
  const lookup: ImportSkipLookup = { findExistingCase: vi.fn().mockResolvedValue(null), findExistingRecord: vi.fn(), findCrossBatchCollision: vi.fn().mockResolvedValue({ id: 'case-old', import_batch_id: 'old' }), listCaseRecords };
  await expect(buildDryRunConflictReport([group], { importBatchId: 'batch', skipLookup: lookup })).rejects.toThrow('unavailable');
  expect(await buildDryRunConflictReport([group], { importBatchId: 'batch', skipLookup: lookup })).toEqual({ wouldCreate: 7, wouldSkip: 0, wouldCollide: 1 });
  expect(listCaseRecords).toHaveBeenCalledTimes(8);
});

it('indexes same and earlier batch records for the matched case with one read per table', async () => {
  const group = makeGroup('matched');
  group.group.rows = [
    { ...group.group.rows[0], externalRef: 'same', rowNumber: 1 },
    { ...group.group.rows[0], externalRef: 'earlier', rowNumber: 2 },
    { ...group.group.rows[0], externalRef: 'new', rowNumber: 3 },
  ];
  group.rows = group.group.rows.map(row => ({ rowNumber: row.rowNumber, valid: true, errors: [] }));
  const listCaseRecords = vi.fn().mockResolvedValue([
    { id: 'same-id', import_key: 'same', import_batch_id: 'batch' },
    { id: 'old-id', import_key: 'earlier', import_batch_id: 'old' },
  ]);
  const lookup: ImportSkipLookup = { findExistingCase: vi.fn().mockResolvedValue({ id: 'matched-case' }), findExistingRecord: vi.fn(), findCrossBatchCollision: vi.fn(), listCaseRecords };
  expect(await buildDryRunConflictReport([group], { importBatchId: 'batch', skipLookup: lookup })).toEqual({ wouldCreate: 1, wouldSkip: 2, wouldCollide: 1 });
  expect(listCaseRecords).toHaveBeenCalledOnce();
  expect(listCaseRecords).toHaveBeenCalledWith('purchase_requests', 'matched-case', ['same', 'earlier', 'new']);
});
