import { describe, expect, it } from 'vitest';
import { payableOf, verifiedNotOnPo, prefillBillLines, capMessage } from './subcontractRules';

describe('subcontract rules (mirror of the SQL, display only)', () => {
  it('FR-SCA-050 payable = min(verified, PO) − billed, floored at 0', () => {
    expect(payableOf({ poQty: 100, verified: 120, billed: 100 })).toBe(0);
    expect(payableOf({ poQty: 100, verified: 80, billed: 0 })).toBe(80);
    expect(payableOf({ poQty: 100, verified: 80, billed: 90 })).toBe(0);
  });

  it('FR-SCA-050 verified, not on PO = max(verified − PO, 0)', () => {
    expect(verifiedNotOnPo({ poQty: 100, verified: 120 })).toBe(20);
    expect(verifiedNotOnPo({ poQty: 100, verified: 80 })).toBe(0);
  });

  it('FR-SCA-051 the bill form pre-fills payable per line and states the cap in words at zero', () => {
    const lines = [{ boqItemId: 'a', itemCode: 'L1', unit: 'm3', rate: 100000, poQty: 100, verified: 120, billed: 100, payable: 0, verifiedNotOnPo: 20 }];
    expect(prefillBillLines(lines)).toEqual([{ boqItemId: 'a', quantity: 0, max: 0, rate: 100000 }]);
    expect(capMessage(lines[0])).toBe('L1: nothing payable — 120 verified, 100 on the PO, 100 already billed');
  });

  it('capMessage returns null when payable is greater than 0', () => {
    const line = { itemCode: 'L1', poQty: 100, verified: 80, billed: 0, payable: 80 };
    expect(capMessage(line)).toBeNull();
  });

  it('NFR-SCA-001 property: over random sequences payable never lets billed exceed min(verified, PO)', () => {
    let seed = 1513;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 500; i++) {
      const poQty = Math.round(rnd() * 200), verified = Math.round(rnd() * 250), billed = Math.round(rnd() * Math.min(poQty, verified));
      expect(billed + payableOf({ poQty, verified, billed })).toBeLessThanOrEqual(Math.min(poQty, verified));
    }
  });
});
