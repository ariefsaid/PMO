import { describe, expect, it } from 'vitest';
import { projectVatRefusal } from './projectVatRefusal';

describe('projectVatRefusal', () => {
  it('AC-PPNC-014 maps the stale VAT refusal by stable code and detail', () => {
    expect(projectVatRefusal({ code: '42501', details: 'vat-live-invoice', message: 'anything' })).toBe('live-invoice');
    expect(projectVatRefusal({ code: 'P0001', details: 'vat-context-changed', message: 'reworded' })).toBe('context-changed');
  });
  it('does not infer refusal from server message text or mismatched SQLSTATE', () => {
    expect(projectVatRefusal({ code: '42501', message: 'vat-live-invoice' })).toBeNull();
    expect(projectVatRefusal({ code: '23514', details: 'vat-live-invoice' })).toBeNull();
  });
});
