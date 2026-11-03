import { expect, it } from 'vitest';
import { INVOICE_LINES, INVOICE_PAID_READ, INVOICE_PARTIAL_READ, INVOICE_POSTED_READ, INVOICE_ZERO_POSTED_READ } from '../__fixtures__/revenue.ts';
import { checkCostAccount, checkTotal, compareSent, moneyHeader } from './moneyHeader.ts';

it('AC-OCI-016 derives the whole header or none: Odoo\'s residual is the outstanding, verbatim', () => {
  expect(moneyHeader(INVOICE_POSTED_READ)).toEqual({ untaxed: '1000.00', tax: '110.00', total: '1110.00', outstanding: '1110.00' });
  expect(moneyHeader(INVOICE_PARTIAL_READ)).toEqual({ untaxed: '1000.00', tax: '110.00', total: '1110.00', outstanding: '710.00' });
  expect(moneyHeader(INVOICE_PAID_READ)?.outstanding).toBe('0.00');
  expect(moneyHeader(INVOICE_ZERO_POSTED_READ)).toEqual({ untaxed: '0.00', tax: '0.00', total: '0.00', outstanding: '0.00' });
  expect(moneyHeader({ ...INVOICE_POSTED_READ, amount_total: 1110.56, amount_tax: 110.06, amount_untaxed: 1000.5, amount_residual: '1110.56' }))
    .toEqual({ untaxed: '1000.50', tax: '110.06', total: '1110.56', outstanding: '1110.56' });
});

it('AC-OCI-016 a payload missing any part, or with an unreadable part, writes none of the money', () => {
  for (const part of ['amount_untaxed', 'amount_tax', 'amount_total', 'amount_residual'] as const) {
    expect(moneyHeader({ ...INVOICE_POSTED_READ, [part]: undefined }), part).toBeNull();
    expect(moneyHeader({ ...INVOICE_POSTED_READ, [part]: null }), part).toBeNull();
    expect(moneyHeader({ ...INVOICE_POSTED_READ, [part]: 'n/a' }), part).toBeNull();
    expect(moneyHeader({ ...INVOICE_POSTED_READ, [part]: false }), part).toBeNull();
  }
  expect(moneyHeader(null)).toBeNull();
});

it('AC-OCI-013 tolerates one smallest currency unit only', () => {
  expect(compareSent('1110.00', '1110.01')).toBe('match');
  expect(compareSent('1110.00', '1109.99')).toBe('match');
  expect(compareSent('1110.00', '1110.02')).toBe('mismatch');
  expect(compareSent('1110.00', 'x')).toBe('mismatch');
});

it('AC-OCI-013 a total off by more than a unit is needs-attention with both figures, never replaced', () => {
  const header = moneyHeader(INVOICE_POSTED_READ)!;
  expect(checkTotal(1110, header)).toEqual({ outcome: 'ok' });
  expect(checkTotal('1110.01', header)).toEqual({ outcome: 'ok' });
  expect(checkTotal(1000, header)).toEqual({ outcome: 'needs-attention', reason: 'total-mismatch', sent: '1000', observed: '1110.00' });
});

it('AC-OCI-030 every product line must carry the project\'s cost account; the first missing one flags the invoice', () => {
  expect(checkCostAccount(INVOICE_LINES, 4)).toEqual({ outcome: 'ok' });
  const stripped = [{ ...INVOICE_LINES[0], analytic_distribution: false as const }, ...INVOICE_LINES.slice(1)];
  expect(checkCostAccount(stripped, 4)).toEqual({ outcome: 'needs-attention', reason: 'cost-account-missing', lineIds: [1] });
  const other = [{ ...INVOICE_LINES[0], analytic_distribution: { '9': 100 } }, ...INVOICE_LINES.slice(1)];
  expect(checkCostAccount(other, 4)).toMatchObject({ outcome: 'needs-attention', reason: 'cost-account-missing' });
  const partial = [{ ...INVOICE_LINES[0], analytic_distribution: { '4': 60, '9': 40 } }, ...INVOICE_LINES.slice(1)];
  expect(checkCostAccount(partial, 4)).toMatchObject({ outcome: 'needs-attention' });
});

it('AC-OCI-030 no project means no distribution is required; unreadable lines are not reported as booked', () => {
  expect(checkCostAccount(INVOICE_LINES.map((l) => ({ ...l, analytic_distribution: false as const })), null)).toEqual({ outcome: 'ok' });
  expect(checkCostAccount(null, 4)).toEqual({ outcome: 'unreadable' });
  expect(checkCostAccount(INVOICE_LINES.filter((l) => l.display_type !== 'product'), 4)).toEqual({ outcome: 'unreadable' });
});
