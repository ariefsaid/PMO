import { expect, it } from 'vitest';
import { BILL_TAX_LINES, VENDOR_BILL } from '../__fixtures__/purchase.ts';
import { compareSent, moneyHeader } from './moneyHeader.ts';
it('AC-OPP-043 derives an entire header or none', () => {
  expect(moneyHeader(VENDOR_BILL, BILL_TAX_LINES)).toEqual({ gross: '111.00', vat: '11.00', withheld: '2.00', outstanding: '109.00' });
  expect(moneyHeader({ ...VENDOR_BILL, amount_residual: undefined }, BILL_TAX_LINES)).toBeNull();
  expect(moneyHeader(VENDOR_BILL, [BILL_TAX_LINES[0]])?.withheld).toBe('0.00');
});
it('AC-OPP-044 tolerates one cent only', () => {
  expect(compareSent('109.00', '109.01')).toBe('match');
  expect(compareSent('109.00', '109.02')).toBe('mismatch');
});
