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
      listCases: vi.fn().mockResolvedValue([]),
    };
    const report = await buildDryRunConflictReport([makeGroup('CASE-NEW')], {
      identity: { kind: 'provisional' }, skipLookup,
    });
    expect(report.wouldCreate).toBe(2); // 1 case header + 1 PR record
    expect(report.wouldSkip).toBe(0);
    expect(report.wouldCollide).toBe(0);
    expect(skipLookup.listCases).toHaveBeenCalled();
  });

  it('reports would-skip for a group whose case already exists in the SAME batch', async () => {
    const skipLookup: ImportSkipLookup = {
      findExistingCase: vi.fn().mockResolvedValue({ id: 'existing' }),
      listCases: vi.fn().mockResolvedValue([{ id: 'existing', import_key: 'CASE-DUP', import_batch_id: 'batch-1' }]),
      findExistingRecord: vi.fn().mockResolvedValue({ id: 'existing-rec' }),
      listCaseRecords: vi.fn().mockResolvedValue([{ id: 'existing-rec', import_key: 'pcy2:["r","CASE-DUP-PR"]', import_batch_id: 'batch-1', import_identity_version: 2, import_identity_facts: ['CASE-DUP-PR', 'Approved', '2025-01-01', '100.00'] }]),
      findCrossBatchCollision: vi.fn().mockResolvedValue(null),
    };
    const report = await buildDryRunConflictReport([makeGroup('CASE-DUP')], {
      identity: { kind: 'provisional' }, skipLookup,
    });
    expect(report.wouldSkip).toBe(2);
    expect(report.wouldCreate).toBe(0);
  });

  it('reports would-collide for a group whose key exists in a DIFFERENT batch', async () => {
    const skipLookup: ImportSkipLookup = {
      findExistingCase: vi.fn().mockResolvedValue(null),
      findExistingRecord: vi.fn().mockResolvedValue(null),
      findCrossBatchCollision: vi.fn().mockResolvedValue({ id: 'other', import_batch_id: 'batch-0' }),
      listCases: vi.fn().mockResolvedValue([{ id: 'other', import_key: 'CASE-COLLIDE', import_batch_id: 'batch-0' }]),
      listCaseRecords: vi.fn().mockResolvedValue([{ id: 'old', import_key: 'CASE-COLLIDE-PR', import_batch_id: null, import_identity_version: null, import_identity_facts: null }]),
    };
    const report = await buildDryRunConflictReport([makeGroup('CASE-COLLIDE')], {
      identity: { kind: 'provisional' }, skipLookup,
    });
    expect(report.wouldCollide).toBe(1);
    expect(report.wouldSkip).toBe(1);
    expect(report.wouldCreate).toBe(0);
  });
});

it('scopes record decisions to the previously matched case', async () => {
  const findCrossBatchCollision = vi.fn().mockImplementation(async (table: string, _key: string, _batch: string, id?: string) => {
    if (table === 'procurements') return { id: 'prior-case', import_batch_id: 'old' };
    return id === 'prior-case' ? { id: 'prior-record', import_batch_id: 'old' } : null;
  });
  const skipLookup: ImportSkipLookup = { findExistingCase: vi.fn().mockResolvedValue(null), findExistingRecord: vi.fn().mockResolvedValue(null), findCrossBatchCollision, listCases: vi.fn().mockResolvedValue([{ id: 'prior-case', import_key: 'C', import_batch_id: 'old' }]), listCaseRecords: vi.fn().mockImplementation(async (_table: string, id: string) => id === 'prior-case' ? [{ id: 'prior-record', import_key: 'C-PR', import_batch_id: null, import_identity_version: null, import_identity_facts: null }] : []) };
  const result = await buildDryRunConflictReport([makeGroup('C')], { identity: { kind: 'provisional' }, skipLookup });
  expect(result).toMatchObject({ wouldCreate: 0, wouldSkip: 1, wouldCollide: 1 });
});

it('does not probe another case for records when the case is new', async () => {
  const lookup: ImportSkipLookup = {
    findExistingCase: vi.fn().mockResolvedValue(null), findExistingRecord: vi.fn(), listCases: vi.fn().mockResolvedValue([]), listCaseRecords: vi.fn(),
    findCrossBatchCollision: vi.fn().mockImplementation(async (table: string) => table === 'procurements' ? null : { id: 'unrelated', import_batch_id: 'old' }),
  };
  expect(await buildDryRunConflictReport([makeGroup('new')], { identity: { kind: 'provisional' }, skipLookup: lookup })).toMatchObject({ wouldCreate: 2, wouldSkip: 0, wouldCollide: 0 });
  expect(lookup.listCaseRecords).not.toHaveBeenCalled();
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
  const lookup: ImportSkipLookup = { findExistingCase: vi.fn().mockResolvedValue(null), findExistingRecord: vi.fn(), findCrossBatchCollision: vi.fn().mockResolvedValue({ id: 'case-old', import_batch_id: 'old' }), listCases: vi.fn().mockResolvedValue([{ id: 'case-old', import_key: 'all', import_batch_id: 'old' }]), listCaseRecords };
  await expect(buildDryRunConflictReport([group], { identity: { kind: 'provisional' }, skipLookup: lookup })).rejects.toThrow('unavailable');
  expect(await buildDryRunConflictReport([group], { identity: { kind: 'provisional' }, skipLookup: lookup })).toMatchObject({ wouldCreate: 7, wouldSkip: 1, wouldCollide: 0 });
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
    { id: 'same-id', import_key: 'pcy2:["r","same"]', import_batch_id: 'batch', import_identity_version: 2, import_identity_facts: ['same', 'Approved', '2025-01-01', '100.00'] },
    { id: 'old-id', import_key: 'earlier', import_batch_id: 'old' },
  ]);
  const lookup: ImportSkipLookup = { findExistingCase: vi.fn().mockResolvedValue({ id: 'matched-case' }), findExistingRecord: vi.fn(), findCrossBatchCollision: vi.fn(), listCases: vi.fn().mockResolvedValue([{ id: 'matched-case', import_key: 'matched', import_batch_id: 'batch' }]), listCaseRecords };
  expect(await buildDryRunConflictReport([group], { identity: { kind: 'provisional' }, skipLookup: lookup })).toMatchObject({ wouldCreate: 1, wouldSkip: 2, wouldCollide: 1 });
  expect(listCaseRecords).toHaveBeenCalledOnce();
  expect(listCaseRecords).toHaveBeenCalledWith('purchase_requests', 'matched-case', ['same', 'pcy2:["r","same"]', 'earlier', 'pcy2:["r","earlier"]', 'new', 'pcy2:["r","new"]']);
});

it('bulk probes 500 case keys during preview', async () => {
  const listCases = vi.fn().mockResolvedValue([]);
  const lookup = { findExistingCase: vi.fn().mockResolvedValue(null), findExistingRecord: vi.fn(), findCrossBatchCollision: vi.fn().mockResolvedValue(null), listCases };
  const result = await buildDryRunConflictReport(Array.from({ length: 500 }, (_, i) => makeGroup(`C${i}`)), { identity: { kind: 'provisional' }, skipLookup: lookup });
  expect(result.wouldCreate).toBe(1000);
  expect(listCases).toHaveBeenCalledTimes(1);
  expect(listCases.mock.calls[0][0]).toHaveLength(500);
  expect(lookup.findExistingCase).not.toHaveBeenCalled();
});

it('reports ambiguity for multiple matching cases regardless of batch', async () => {
  const group = makeGroup('C');
  const { computeCaseImportKey } = await import('../importKey');
  const key = computeCaseImportKey(group.group);
  const listCases = vi.fn().mockResolvedValue([
    { id: 'old', import_key: key, import_batch_id: 'old' },
    { id: 'same', import_key: key, import_batch_id: 'batch' },
  ]);
  const listCaseRecords = vi.fn().mockResolvedValue([]);
  const lookup = { findExistingCase: vi.fn(), findExistingRecord: vi.fn(), findCrossBatchCollision: vi.fn(), listCases, listCaseRecords };
  expect(await buildDryRunConflictReport([group], { identity: { kind: 'provisional' }, skipLookup: lookup })).toMatchObject({ wouldCreate: 0, wouldSkip: 0, wouldCollide: 1 });
  expect(listCaseRecords).not.toHaveBeenCalled();
  listCases.mockResolvedValueOnce([{ id: 'a', import_key: key, import_batch_id: 'batch' }, { id: 'b', import_key: key, import_batch_id: 'batch' }]);
  expect((await buildDryRunConflictReport([group], { identity: { kind: 'provisional' }, skipLookup: lookup })).wouldCollide).toBe(1);
});

it('reports a conflict when an unknown candidate accompanies an equal marked source', async () => {
  const group = makeGroup('C');
  const row = group.group.rows[0];
  const lookup = {
    findExistingCase: vi.fn(), findExistingRecord: vi.fn(), findCrossBatchCollision: vi.fn(),
    listCases: vi.fn().mockResolvedValue([{ id: 'case', import_key: 'C', import_batch_id: 'batch' }]),
    listCaseRecords: vi.fn().mockResolvedValue([
      { id: 'marked', import_key: `pcy2:${JSON.stringify(['r', row.externalRef])}`, import_batch_id: 'batch', import_identity_version: 2, import_identity_facts: [row.externalRef, row.status, row.date, '100.00'] },
      { id: 'unknown', import_key: row.externalRef, import_batch_id: 'batch', import_identity_version: null, import_identity_facts: null },
    ]),
  };
  const result = await buildDryRunConflictReport([group], { identity: { kind: 'provisional' }, skipLookup: lookup });
  expect(result.wouldCollide).toBe(1);
  expect(result.wouldSkip).toBe(1);
  expect(result.conflicts).toEqual([expect.objectContaining({ caseRef: 'C', rowNumber: 1, type: 'PR', id: 'unknown' })]);
});

it('reports multiple normalized case matches without probing child records', async () => {
  const group = makeGroup('Case');
  const listCaseRecords = vi.fn();
  const lookup = {
    findExistingCase: vi.fn(), findExistingRecord: vi.fn(), findCrossBatchCollision: vi.fn(),
    normalizeCases: vi.fn().mockResolvedValue(new Map([['Case', 'case']])),
    listCases: vi.fn().mockResolvedValue([
      { id: 'one', import_key: 'case', normalized_ref: 'case', import_batch_id: null },
      { id: 'two', import_key: 'CASE', normalized_ref: 'case', import_batch_id: 'other' },
    ]), listCaseRecords,
  };
  const report = await buildDryRunConflictReport([group], { identity: { kind: 'provisional' }, skipLookup: lookup });
  expect(report.wouldCollide).toBeGreaterThan(0);
  expect(listCaseRecords).not.toHaveBeenCalled();
});

it('rejects incoming groups that database normalization maps to one case', async () => {
  const first = makeGroup('A');
  const second = makeGroup('B');
  const listCases = vi.fn().mockResolvedValue([]);
  const lookup = { findExistingCase: vi.fn(), findExistingRecord: vi.fn(), findCrossBatchCollision: vi.fn(),
    normalizeCases: vi.fn().mockResolvedValue(new Map([['A', 'same'], ['B', 'same']])), listCases, listCaseRecords: vi.fn() };
  const report = await buildDryRunConflictReport([first, second], { identity: { kind: 'provisional' }, skipLookup: lookup });
  expect(report.wouldCollide).toBeGreaterThanOrEqual(2);
  expect(report.wouldCreate).toBe(0);
});

it('uses an existing invoice ID for a linked payment preview', async () => {
  const group = makeGroup('C');
  const invoiceId = '39900000-0000-0000-0000-000000000051';
  const common = group.group.rows[0];
  group.group.rows = [
    { ...common, type: 'VI', externalRef: 'VI', status: 'Received', taxTreatment: 'exclusive', taxAmount: '0', amount: '1', rowNumber: 1 },
    { ...common, type: 'Payment', externalRef: 'PAY', status: 'Scheduled', amount: '1', rowNumber: 2 },
  ];
  group.rows = group.group.rows.map(row => ({ rowNumber: row.rowNumber, valid: true, errors: [] }));
  const lookup = { findExistingCase: vi.fn().mockResolvedValue({ id: 'case' }), findExistingRecord: vi.fn(), findCrossBatchCollision: vi.fn(), listCases: vi.fn().mockResolvedValue([{ id: 'case', import_key: 'C', import_batch_id: 'batch' }]),
    listCaseRecords: vi.fn().mockImplementation(async (table: string) => table === 'procurement_invoices'
      ? [{ id: invoiceId, import_key: 'pcy2:["r","VI"]', import_batch_id: 'other', import_identity_version: 2, import_identity_facts: ['VI', 'Received', '2025-01-01', '1.00', 'exclusive', '0.00'] }]
      : [{ id: 'payment', import_key: 'pcy2:["r","PAY"]', import_batch_id: 'other', import_identity_version: 2, import_identity_facts: ['PAY', invoiceId, 'Scheduled', '2025-01-01', '1.00'] }]) };
  const report = await buildDryRunConflictReport([group], { identity: { kind: 'provisional' }, skipLookup: lookup });
  expect(report.wouldSkip).toBe(3);
  expect(report.wouldCollide).toBe(0);
});

it('does not compare a new invoice payment to an invoice-less fingerprint', async () => {
  const group = makeGroup('C');
  const common = group.group.rows[0];
  group.group.rows = [
    { ...common, type: 'VI', externalRef: 'VI', status: 'Received', taxTreatment: 'exclusive', taxAmount: '0', amount: '1', rowNumber: 1 },
    { ...common, type: 'Payment', externalRef: undefined, status: 'Scheduled', amount: '1', rowNumber: 2 },
  ];
  group.rows = group.group.rows.map(row => ({ rowNumber: row.rowNumber, valid: true, errors: [] }));
  const lookup = { findExistingCase: vi.fn().mockResolvedValue({ id: 'case' }), findExistingRecord: vi.fn(), findCrossBatchCollision: vi.fn(), listCases: vi.fn().mockResolvedValue([{ id: 'case', import_key: 'C', import_batch_id: 'batch' }]),
    listCaseRecords: vi.fn().mockImplementation(async (table: string) => table === 'payments'
      ? [{ id: 'other', import_key: 'pcy2:["f",[null,null,"Scheduled","2025-01-01","1.00"]]', import_batch_id: 'other', import_identity_version: 2, import_identity_facts: [null, null, 'Scheduled', '2025-01-01', '1.00'] }]
      : []) };
  const report = await buildDryRunConflictReport([group], { identity: { kind: 'provisional' }, skipLookup: lookup });
  expect(report.wouldCreate).toBe(2);
  expect(report.wouldSkip).toBe(1);
});

it('flags duplicate input identities before classifying a new case', async () => {
  const group = makeGroup('C');
  group.group.rows.push({ ...group.group.rows[0], amount: '200', rowNumber: 2 });
  group.rows.push({ rowNumber: 2, valid: true, errors: [] });
  const lookup = { findExistingCase: vi.fn(), findExistingRecord: vi.fn(), findCrossBatchCollision: vi.fn(), listCases: vi.fn().mockResolvedValue([]), listCaseRecords: vi.fn() };
  const report = await buildDryRunConflictReport([group], { identity: { kind: 'provisional' }, skipLookup: lookup });
  expect(report.wouldCreate).toBe(0);
  expect(report.wouldCollide).toBeGreaterThanOrEqual(2);
});

it('resolves one existing case regardless of its original batch', async () => {
  const lookup = { findExistingCase: vi.fn(), findExistingRecord: vi.fn(), findCrossBatchCollision: vi.fn(),
    listCases: vi.fn().mockResolvedValue([{ id: 'case', import_key: 'C', import_batch_id: null }]),
    listCaseRecords: vi.fn().mockResolvedValue([]) };
  const report = await buildDryRunConflictReport([makeGroup('C')], { identity: { kind: 'provisional' }, skipLookup: lookup });
  expect(report.wouldSkip).toBe(1);
  expect(report.wouldCreate).toBe(1);
  expect(report.wouldCollide).toBe(0);
});

it('classifies tax-distinct invoices sharing a legacy key independently', async () => {
  const group = makeGroup('C');
  const first = { ...group.group.rows[0], type: 'VI', externalRef: undefined, status: 'Received', taxTreatment: 'exclusive', taxAmount: '1', rowNumber: 1 };
  const second = { ...first, taxAmount: '2', rowNumber: 2 };
  group.group.rows = [first, second];
  group.rows = [1, 2].map(rowNumber => ({ rowNumber, valid: true, errors: [] }));
  const facts = [null, 'Received', '2025-01-01', '100.00', 'exclusive', '1.00'];
  const lookup = { findExistingCase: vi.fn(), findExistingRecord: vi.fn(), findCrossBatchCollision: vi.fn(), listCases: vi.fn().mockResolvedValue([{ id: 'case', import_key: 'C', import_batch_id: null }]), listCaseRecords: vi.fn().mockResolvedValue([{ id: 'one', import_key: `pcy2:${JSON.stringify(['f', facts])}`, import_batch_id: 'run', import_identity_version: 2, import_identity_facts: facts }]) };
  expect(await buildDryRunConflictReport([group], { identity: { kind: 'provisional' }, skipLookup: lookup })).toMatchObject({ wouldCreate: 1, wouldSkip: 2, wouldCollide: 0 });
});
