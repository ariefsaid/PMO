import { describe, expect, it, vi } from 'vitest';
import { applyMatches } from '../validateRows';
import type { MatchExisting, RowValidation } from '../types';

/** AC-PIU-001/005/006 — classify each valid row against the records already on the target. Pure, zero writes. */
type Rec = { name: string };
const match: MatchExisting = {
  load: async () => [] as [string, unknown][],
  keyOf: (c) => c.code.trim().toLowerCase(),
  changes: (record, c) => ((record as Rec).name === c.name.trim() ? [] : [{ field: 'Name', from: (record as Rec).name, to: c.name.trim() }]),
  update: vi.fn(),
  noChange: 'No change.',
  unavailable: 'x',
  nothingToDo: 'y',
};
const ok = (index: number): RowValidation => ({ index, errors: {}, valid: true });
const records = new Map<string, unknown>([['p-1', { name: 'Ana' }], ['p-2', { name: 'Budi' }]]);

describe('applyMatches', () => {
  it('AC-PIU-001 a matched row with a different value is an update that names the change', () => {
    const [r] = applyMatches([ok(0)], [{ code: ' P-1 ', name: 'Ana Putri' }], match, records);
    expect(r).toMatchObject({ valid: true, action: 'update', changes: [{ field: 'Name', from: 'Ana', to: 'Ana Putri' }] });
  });
  it('AC-PIU-005 a matched row with the same values is no change: not valid, flagged already', () => {
    const [r] = applyMatches([ok(0)], [{ code: 'p-2', name: 'Budi' }], match, records);
    expect(r).toMatchObject({ valid: false, already: true });
    expect(r.action).toBeUndefined();
  });
  it('AC-PIU-003 an unmatched row is new', () => {
    const [r] = applyMatches([ok(0)], [{ code: 'P-9', name: 'Cici' }], match, records);
    expect(r).toMatchObject({ valid: true, action: 'new' });
  });
  it('an invalid row is left as it is', () => {
    const bad: RowValidation = { index: 0, errors: { name: 'required' }, valid: false };
    expect(applyMatches([bad], [{ code: 'p-1', name: '' }], match, records)).toEqual([bad]);
  });
  it('AC-PIU-006 only records handed in (live people) can match, so an archived code is new', () => {
    const [r] = applyMatches([ok(0)], [{ code: 'P-OLD', name: 'Gone' }], match, records);
    expect(r.action).toBe('new');
  });
});
