/**
 * companyScope.test.ts — round-7 cross-family B4 (CROSS-TENANT adoption).
 *
 * One ERPNext site routinely hosts several Company records. The binding names exactly one
 * (`external_org_bindings.config.company`, written at bind time by `binding.ts`) and every outbound
 * body stamps it — but NOTHING scoped INBOUND adoption by it: the webhook admitted on HMAC + domain
 * ownership, and the sweep's document filters carried only modified/payment-type. A Company-B Sales
 * Invoice or Receive Payment Entry was therefore adopted into Company A's PMO tenant and surfaced in
 * its revenue/AR views with no error — another tenant's financial data.
 */
import { describe, it, expect } from 'vitest';
import { isCompanyScopedKind, admitsDocForBindingCompany, companyDocFilters } from './companyScope';

describe('isCompanyScopedKind — which ERP doctypes carry a company dimension', () => {
  it('every money/transaction kind is company-scoped', () => {
    for (const kind of [
      'purchase-request', 'rfq', 'quotation', 'purchase-order', 'goods-receipt',
      'purchase-invoice', 'payment', 'sales-invoice', 'incoming-payment',
    ] as const) {
      expect(isCompanyScopedKind(kind)).toBe(true);
    }
  });

  it('Supplier/Customer are GLOBAL masters in ERPNext (no company field) — not company-scoped', () => {
    expect(isCompanyScopedKind('supplier')).toBe(false);
    expect(isCompanyScopedKind('customer')).toBe(false);
  });
});

describe('admitsDocForBindingCompany — B4 inbound admission', () => {
  const doc = (company: unknown) => ({ name: 'ACC-SINV-2026-00001', company });

  it('admits a document stating THIS binding\'s company', () => {
    expect(admitsDocForBindingCompany('sales-invoice', doc('PMO Smoke Co'), 'PMO Smoke Co')).toBe(true);
  });

  it('B4 — REFUSES a document belonging to ANOTHER company on the same ERP site (cross-tenant money)', () => {
    expect(admitsDocForBindingCompany('sales-invoice', doc('Other Tenant Ltd'), 'PMO Smoke Co')).toBe(false);
    expect(admitsDocForBindingCompany('incoming-payment', doc('Other Tenant Ltd'), 'PMO Smoke Co')).toBe(false);
  });

  it('B4 — fails CLOSED: a company-scoped document that does not state its company is NOT adopted', () => {
    expect(admitsDocForBindingCompany('sales-invoice', doc(undefined), 'PMO Smoke Co')).toBe(false);
    expect(admitsDocForBindingCompany('sales-invoice', doc(null), 'PMO Smoke Co')).toBe(false);
    expect(admitsDocForBindingCompany('sales-invoice', doc(''), 'PMO Smoke Co')).toBe(false);
    expect(admitsDocForBindingCompany('sales-invoice', null, 'PMO Smoke Co')).toBe(false);
  });

  it('B4 — fails CLOSED: a binding with no configured company can scope nothing, so it adopts no money doc', () => {
    expect(admitsDocForBindingCompany('sales-invoice', doc('PMO Smoke Co'), null)).toBe(false);
    expect(admitsDocForBindingCompany('sales-invoice', doc('PMO Smoke Co'), '')).toBe(false);
  });

  it('admits a GLOBAL master (Supplier/Customer) regardless of company — it has no company dimension', () => {
    expect(admitsDocForBindingCompany('supplier', { name: 'Acme' }, 'PMO Smoke Co')).toBe(true);
    expect(admitsDocForBindingCompany('customer', { name: 'Acme' }, null)).toBe(true);
  });

  it('refuses an unknown/unmapped kind (nothing to reason about ⇒ never adopt)', () => {
    expect(admitsDocForBindingCompany(undefined, doc('PMO Smoke Co'), 'PMO Smoke Co')).toBe(false);
  });

  it('compares the company name EXACTLY (no trimming/casefolding — ERP names are the identity)', () => {
    expect(admitsDocForBindingCompany('sales-invoice', doc('pmo smoke co'), 'PMO Smoke Co')).toBe(false);
    expect(admitsDocForBindingCompany('sales-invoice', doc(' PMO Smoke Co'), 'PMO Smoke Co')).toBe(false);
  });
});

describe('companyDocFilters — the sweep-side list filter (same rule, applied server-side)', () => {
  it('a company-scoped kind pulls ONLY the binding company\'s documents', () => {
    expect(companyDocFilters('sales-invoice', 'PMO Smoke Co')).toEqual([['company', '=', 'PMO Smoke Co']]);
  });

  it('a global master needs no company filter', () => {
    expect(companyDocFilters('supplier', 'PMO Smoke Co')).toEqual([]);
  });

  it('an unconfigured binding company returns null for a company-scoped kind — "unscopeable, do not sweep it"', () => {
    // Deliberately NOT `[]`: an empty filter list reads as "no scoping needed" and would sweep the whole
    // ERP site into this tenant — the exact B4 exploit. `null` forces the caller to skip the kind.
    expect(companyDocFilters('sales-invoice', null)).toBeNull();
    expect(companyDocFilters('sales-invoice', '')).toBeNull();
  });
});
