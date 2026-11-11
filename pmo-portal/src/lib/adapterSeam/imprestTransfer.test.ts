import { describe, expect, it } from 'vitest';
import { assertImprestTransfer, IMPREST_TRANSFER_KEY_RE } from './imprestTransfer';
import { imprestTransferKey } from './erpnext/imprestTransferKey';

const ID = '15150000-0000-0000-0000-0000000000E3';
describe('imprest.transfer (AC-IMP-072)', () => {
  it('AC-IMP-072 the key is deterministic from the replenishment and its paid stamp, lower-cased', () => {
    expect(imprestTransferKey({ subject_id: ID, state_stamp: '2026-10-07T10:00:00.123+00:00' }))
      .toBe('impt:15150000-0000-0000-0000-0000000000e3:1791367200123');
    expect(IMPREST_TRANSFER_KEY_RE.test(imprestTransferKey({ subject_id: ID, state_stamp: '2026-10-07T10:00:00.123+00:00' }))).toBe(true);
    expect(IMPREST_TRANSFER_KEY_RE.test('expj:15150000-0000-0000-0000-0000000000e3:1')).toBe(false);
  });

  it('AC-IMP-072 refuses a malformed transfer', () => {
    const ok = { key: imprestTransferKey({ subject_id: ID, state_stamp: '2026-10-07T10:00:00Z' }), fromAccount: 'A', toAccount: 'B', amount: '10.00', date: '2026-10-07', reference: 'R' };
    expect(assertImprestTransfer(ok)).toEqual(ok);
    for (const bad of [{ key: 'x' }, { amount: '0.00' }, { amount: '10' }, { toAccount: 'A' }, { fromAccount: '' }, { date: '7/10' }]) {
      expect(() => assertImprestTransfer({ ...ok, ...bad })).toThrow(/imprest\.transfer/);
    }
  });
});
