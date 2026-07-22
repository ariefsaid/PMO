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
import { isCompanyScopedKind, admitsDocForBindingCompany, companyDocFilters, companyRefusalReason } from './companyScope';
import { DOCTYPE_REGISTRY, type ErpDocKind } from './doctypeRegistry';

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

  // ── HIGH-B (Luna re-audit round 2) ──────────────────────────────────────────────────────────────
  // The guard is a `Set` membership test, and the P3b/P3c kinds were simply never added to it — so it
  // was INERT for exactly the two newest money-adjacent doctypes. `Budget` carries a REQUIRED `company`
  // Link; `Timesheet` derives one; `Employee` requires one (it is emphatically NOT a site-wide master
  // like Customer/Supplier — the stated reason those two are exempt).
  it('HIGH-B Budget and Timesheet are company-scoped (both doctypes carry `company`)', () => {
    expect(isCompanyScopedKind('budget')).toBe(true);
    expect(isCompanyScopedKind('timesheet')).toBe(true);
  });

  it('HIGH-B Employee is company-scoped — a required `company`, and adopting one is the COST-IDENTITY path', () => {
    expect(isCompanyScopedKind('employee')).toBe(true);
  });

  it('HIGH-B the exemption list is EXHAUSTIVE over every registered kind — a new kind cannot be silently forgotten', () => {
    const unscoped = (Object.keys(DOCTYPE_REGISTRY) as ErpDocKind[]).filter((k) => !isCompanyScopedKind(k));
    // The ONLY ERPNext doctypes with no company dimension at all. Anything else appearing here is a
    // kind whose documents another tenant on the same site can push into this org's feed.
    expect(unscoped.sort()).toEqual(['customer', 'supplier']);
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

describe('companyRefusalReason — graceful escalation only distinguishes MISSING company from OTHER company', () => {
  const doc = (company: unknown) => ({ name: 'ACC-SINV-2026-00001', company });

  it("admitted doc ⇒ null (nothing to escalate)", () => {
    expect(companyRefusalReason('sales-invoice', doc('PMO Smoke Co'), 'PMO Smoke Co')).toBeNull();
  });

  it("a company-scoped doc that states NO company ⇒ 'no-company' (the ERP-misconfig case that escalates)", () => {
    expect(companyRefusalReason('sales-invoice', doc(null), 'PMO Smoke Co')).toBe('no-company');
    expect(companyRefusalReason('sales-invoice', doc(''), 'PMO Smoke Co')).toBe('no-company');
    expect(companyRefusalReason('sales-invoice', { name: 'x' }, 'PMO Smoke Co')).toBe('no-company');
  });

  it("a doc stating a DIFFERENT company ⇒ 'other-company' (another tenant — must stay SILENT, never escalate)", () => {
    // The distinction that matters: escalating this would be noise AND leak the other tenant's company name.
    expect(companyRefusalReason('sales-invoice', doc('Other Co'), 'PMO Smoke Co')).toBe('other-company');
  });

  it('a global master is never a company refusal (no dimension to be missing)', () => {
    expect(companyRefusalReason('supplier', doc(null), 'PMO Smoke Co')).toBeNull();
  });

  it("an unscopeable binding (no company configured) is not a 'missing-company' escalation", () => {
    expect(companyRefusalReason('sales-invoice', doc(null), null)).toBeNull();
  });

  it('the new P3 company-scoped kinds classify too (timesheet/budget/employee)', () => {
    for (const k of ['timesheet', 'budget', 'employee'] as const) {
      expect(companyRefusalReason(k, doc(null), 'PMO Smoke Co')).toBe('no-company');
      expect(companyRefusalReason(k, doc('Other Co'), 'PMO Smoke Co')).toBe('other-company');
    }
  });
});
