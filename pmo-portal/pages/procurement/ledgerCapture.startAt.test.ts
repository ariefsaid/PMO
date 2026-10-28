import { describe, expect, it } from 'vitest';
import { nextExpectedType } from './ledgerCapture';

describe('nextExpectedType with a start step', () => {
  it('AC-PFE-010: a Draft purchase started at Invoice offers only the supplier invoice capture (skipped steps get none)', () => {
    expect(nextExpectedType('Draft', new Set(), 'vendor_invoice')).toBe('vendor_invoice');
  });
  it('the start step applies only while the ledger is empty', () => {
    expect(nextExpectedType('Vendor Invoiced', new Set(['Invoice'] as never), 'vendor_invoice')).not.toBe('vendor_invoice');
  });
  it('without a start step the shipped gate is unchanged', () => {
    expect(nextExpectedType('Draft', new Set())).toBe(nextExpectedType('Draft', new Set(), null));
  });
});
