import { describe, it, expect } from 'vitest';
import { pendingProcurementApprovals } from '../approvals';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';

const row = (over: Partial<ProcurementWithRefs>): ProcurementWithRefs =>
  ({ id: 'x', status: 'Requested', requested_by_id: 'other', project: null, vendor: null, requested_by: null, ...over } as ProcurementWithRefs);

describe('pendingProcurementApprovals (H7)', () => {
  const self = 'me';
  it('AC-W6-H7: includes Requested PRs not raised by self (SoD-a)', () => {
    const out = pendingProcurementApprovals([row({ id: '1', requested_by_id: 'other' })], self);
    expect(out.map((p) => p.id)).toEqual(['1']);
  });
  it('AC-W6-H7: excludes a PR the viewer raised themselves', () => {
    const out = pendingProcurementApprovals([row({ id: '2', requested_by_id: 'me' })], self);
    expect(out).toHaveLength(0);
  });
  it('AC-W6-H7: excludes non-Requested PRs', () => {
    const out = pendingProcurementApprovals([row({ id: '3', status: 'Ordered', requested_by_id: 'other' })], self);
    expect(out).toHaveLength(0);
  });
  it('AC-W6-H7: returns [] for null/undefined input', () => {
    expect(pendingProcurementApprovals(undefined, self)).toEqual([]);
  });
});
