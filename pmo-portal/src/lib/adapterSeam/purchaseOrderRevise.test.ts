import { describe, expect, it } from 'vitest';
import { PO_REVISE_KEY_RE, poReviseRecoveryDecision, purchaseOrderReviseKey } from './purchaseOrderRevise.ts';

const PO = '15130000-0000-0000-0000-000000000101';

describe('purchase-order.revise seam (#1513)', () => {
  it('AC-SCA-011 one (po, revision) has one key, and it matches the key pattern', () => {
    expect(purchaseOrderReviseKey(PO, 2)).toBe(`porev:${PO}:2`);
    expect(PO_REVISE_KEY_RE.test(purchaseOrderReviseKey(PO, 12))).toBe(true);
  });

  it('AC-SCA-011 revision 1 (the ordinary create) and a malformed PO id mint no key', () => {
    expect(() => purchaseOrderReviseKey(PO, 1)).toThrow(/bad key/);
    expect(() => purchaseOrderReviseKey('not-a-uuid', 2)).toThrow(/bad key/);
    expect(() => purchaseOrderReviseKey(PO, 2.5)).toThrow(/bad key/);
  });

  it('AC-SCA-011 recovery adopts only its own key and holds on any uncertainty', () => {
    expect(poReviseRecoveryDecision({ probe: 'inconclusive' })).toBe('held');
    expect(poReviseRecoveryDecision({ probe: 'found', key: `porev:${PO}:2`, expectedKey: `porev:${PO}:2` })).toBe('adopt');
    expect(poReviseRecoveryDecision({ probe: 'found', key: `porev:${PO}:3`, expectedKey: `porev:${PO}:2` })).toBe('held');
    expect(poReviseRecoveryDecision({ probe: 'absent-conclusive' })).toBe('reissue');
  });
});
