import { describe, it, expect } from 'vitest';
import { clientInvoiceOverdueDays, deriveArDueDate, overdueAgeDays } from './revenueDisplay';

/**
 * AC-SAR-051 — deriveArDueDate matrix (OWNS AC-SAR-051).
 *
 * Given a mirrored Customer with `erp_payment_terms_days` + a mirrored SI with `invoice_date`,
 * the derived display due-date is `invoice_date + erp_payment_terms_days` (or ERP's own `due_date`
 * when ERPNext provides one) — read-only display; PMO NEVER writes receivables-terms truth.
 * (ADR-0048, FR-ENA-094 precedent).
 */

describe('deriveArDueDate — AC-SAR-051 matrix', () => {
  it('uses ERP due_date when provided (preferred source)', () => {
    const invoiceDate = '2026-07-01';
    const paymentTermsDays = 30;
    const erpDueDate = '2026-08-15'; // ERP computed a different date

    const result = deriveArDueDate(invoiceDate, paymentTermsDays, erpDueDate);
    expect(result).toBe('2026-08-15');
  });

  it('falls back to invoice_date + paymentTermsDays when ERP due_date is absent', () => {
    const invoiceDate = '2026-07-01';
    const paymentTermsDays = 30;
    const erpDueDate = undefined;

    const result = deriveArDueDate(invoiceDate, paymentTermsDays, erpDueDate);
    expect(result).toBe('2026-07-31');
  });

  it('falls back to invoice_date + paymentTermsDays when ERP due_date is null', () => {
    const invoiceDate = '2026-07-01';
    const paymentTermsDays = 30;
    const erpDueDate = null;

    const result = deriveArDueDate(invoiceDate, paymentTermsDays, erpDueDate);
    expect(result).toBe('2026-07-31');
  });

  it('uses default 30 days when paymentTermsDays is null (ERP default)', () => {
    const invoiceDate = '2026-07-01';
    const paymentTermsDays = null;
    const erpDueDate = undefined;

    const result = deriveArDueDate(invoiceDate, paymentTermsDays, erpDueDate);
    expect(result).toBe('2026-07-31');
  });

  it('uses default 30 days when paymentTermsDays is undefined (ERP default)', () => {
    const invoiceDate = '2026-07-01';
    const paymentTermsDays = undefined;
    const erpDueDate = undefined;

    const result = deriveArDueDate(invoiceDate, paymentTermsDays, erpDueDate);
    expect(result).toBe('2026-07-31');
  });

  it('handles leap year correctly (Feb 28 + 30 days = Mar 30)', () => {
    const invoiceDate = '2026-02-28'; // 2026 is not a leap year
    const paymentTermsDays = 30;
    const erpDueDate = undefined;

    const result = deriveArDueDate(invoiceDate, paymentTermsDays, erpDueDate);
    expect(result).toBe('2026-03-30');
  });

  it('handles leap year correctly (Feb 28 + 30 days = Mar 29 in leap year)', () => {
    const invoiceDate = '2024-02-28'; // 2024 is a leap year
    const paymentTermsDays = 30;
    const erpDueDate = undefined;

    const result = deriveArDueDate(invoiceDate, paymentTermsDays, erpDueDate);
    expect(result).toBe('2024-03-29');
  });

  it('handles year rollover (Dec 15 + 30 days = Jan 14)', () => {
    const invoiceDate = '2026-12-15';
    const paymentTermsDays = 30;
    const erpDueDate = undefined;

    const result = deriveArDueDate(invoiceDate, paymentTermsDays, erpDueDate);
    expect(result).toBe('2027-01-14');
  });

  it('returns null when invoiceDate is null', () => {
    const invoiceDate = null;
    const paymentTermsDays = 30;
    const erpDueDate = undefined;

    const result = deriveArDueDate(invoiceDate as unknown as string, paymentTermsDays, erpDueDate);
    expect(result).toBeNull();
  });

  it('returns null when invoiceDate is undefined', () => {
    const invoiceDate = undefined;
    const paymentTermsDays = 30;
    const erpDueDate = undefined;

    const result = deriveArDueDate(invoiceDate as unknown as string, paymentTermsDays, erpDueDate);
    expect(result).toBeNull();
  });

  it('returns null when invoiceDate is empty string', () => {
    const invoiceDate = '';
    const paymentTermsDays = 30;
    const erpDueDate = undefined;

    const result = deriveArDueDate(invoiceDate as unknown as string, paymentTermsDays, erpDueDate);
    expect(result).toBeNull();
  });

  it('handles custom payment terms (e.g., 45 days)', () => {
    const invoiceDate = '2026-07-01';
    const paymentTermsDays = 45;
    const erpDueDate = undefined;

    const result = deriveArDueDate(invoiceDate, paymentTermsDays, erpDueDate);
    expect(result).toBe('2026-08-15');
  });

  it('handles custom payment terms (e.g., 60 days)', () => {
    const invoiceDate = '2026-07-01';
    const paymentTermsDays = 60;
    const erpDueDate = undefined;

    const result = deriveArDueDate(invoiceDate, paymentTermsDays, erpDueDate);
    expect(result).toBe('2026-08-30');
  });

  it('handles payment terms of 0 days (due on invoice date)', () => {
    const invoiceDate = '2026-07-01';
    const paymentTermsDays = 0;
    const erpDueDate = undefined;

    const result = deriveArDueDate(invoiceDate, paymentTermsDays, erpDueDate);
    expect(result).toBe('2026-07-01');
  });

  it('ERP due_date takes precedence even when paymentTermsDays differs', () => {
    const invoiceDate = '2026-07-01';
    const paymentTermsDays = 30; // Customer terms say 30 days
    const erpDueDate = '2026-07-15'; // But ERP computed 14 days (e.g., specific agreement)

    const result = deriveArDueDate(invoiceDate, paymentTermsDays, erpDueDate);
    expect(result).toBe('2026-07-15');
  });
});
describe('overdueAgeDays — organization calendar dates', () => {
  it('counts overdue days without treating the due date itself as late', () => {
    expect(overdueAgeDays('2026-10-15', '2026-10-16')).toBe(1);
    expect(overdueAgeDays('2026-10-16', '2026-10-16')).toBe(0);
    expect(overdueAgeDays('2026-10-17', '2026-10-16')).toBe(-1);
  });

  it('returns unknown when either date is missing', () => {
    expect(overdueAgeDays(null, '2026-10-16')).toBeNull();
    expect(overdueAgeDays('2026-10-15', null)).toBeNull();
  });
});

describe('deriveArDueDate — #767 received-date anchor', () => {
  it('AC-DUE-002 due = received date + customer terms, not invoice date + terms', () => {
    expect(deriveArDueDate('2026-07-01', 30, null, '2026-07-11')).toBe('2026-08-10');
  });

  it('AC-DUE-002 the received-date due beats a stale ERP due_date', () => {
    expect(deriveArDueDate('2026-07-01', 30, '2026-07-31', '2026-07-11')).toBe('2026-08-10');
  });

  it('AC-DUE-002 absent terms fall back to the 30-day default from the receipt date', () => {
    expect(deriveArDueDate('2026-07-01', null, null, '2026-07-11')).toBe('2026-08-10');
  });

  it('AC-DUE-002 with no received date the existing behaviour is unchanged', () => {
    expect(deriveArDueDate('2026-07-01', 30, null, null)).toBe('2026-07-31');
    expect(deriveArDueDate('2026-07-01', 30, '2026-08-15', '')).toBe('2026-08-15');
  });
});

/**
 * #1457 — THE one rule for "overdue client invoice".
 *
 * Before this function the rule lived inline seven times. Six copies agreed
 * (status Submitted/Unpaid + derived due date strictly before the org day);
 * the two project-page copies (contract cascade, work-order billing) diverged:
 * they read the raw ERP due date with no terms fallback, took the viewer's
 * device-local day instead of the org day, and let Paid rows through the date
 * gate. Each test below owns one of those differences.
 */
describe('clientInvoiceOverdueDays — #1457 the one overdue rule', () => {
  const base: {
    status: string;
    invoice_date: string | null;
    erp_payment_terms_days: number | null;
    erp_due_date: string | null;
    received_date: string | null;
  } = {
    status: 'Unpaid',
    invoice_date: '2026-07-01',
    erp_payment_terms_days: 30,
    erp_due_date: null,
    received_date: null,
  };
  const invoice = (over: Partial<typeof base>) => ({ ...base, ...over });

  it('counts an Unpaid invoice past its derived due date, in whole days', () => {
    // 2026-07-01 + 30 = 2026-07-31; org day 2026-08-03 → 3 days overdue.
    expect(clientInvoiceOverdueDays(invoice({}), '2026-08-03')).toBe(3);
  });

  it('counts a Submitted invoice too — the same set the finance hub, dashboard and receivables use', () => {
    expect(clientInvoiceOverdueDays(invoice({ status: 'Submitted' }), '2026-08-03')).toBe(3);
  });

  it('ignores Draft, Paid and Cancelled invoices even when past due', () => {
    expect(clientInvoiceOverdueDays(invoice({ status: 'Draft' }), '2026-08-03')).toBeNull();
    expect(clientInvoiceOverdueDays(invoice({ status: 'Paid' }), '2026-08-03')).toBeNull();
    expect(clientInvoiceOverdueDays(invoice({ status: 'Cancelled' }), '2026-08-03')).toBeNull();
  });

  it('is not overdue on the due date itself — only strictly after it', () => {
    expect(clientInvoiceOverdueDays(invoice({}), '2026-07-31')).toBeNull();
  });

  it('is not overdue while the due date is in the future', () => {
    expect(clientInvoiceOverdueDays(invoice({}), '2026-07-15')).toBeNull();
  });

  it('cannot be decided without the organization day', () => {
    expect(clientInvoiceOverdueDays(invoice({}), null)).toBeNull();
    expect(clientInvoiceOverdueDays(invoice({}), undefined)).toBeNull();
  });

  it('derives the due date when the ERP due date is absent — a terms-past-due invoice counts on the project pages too', () => {
    // The two project-page copies required erp_due_date and missed this invoice entirely.
    expect(clientInvoiceOverdueDays(invoice({ erp_due_date: null }), '2026-08-03')).toBe(3);
  });

  it('uses the ERP due date when present, even when it disagrees with the terms math', () => {
    expect(clientInvoiceOverdueDays(invoice({ erp_due_date: '2026-07-20' }), '2026-07-25')).toBe(5);
  });

  it('defaults null terms to the ERP 30-day standard', () => {
    expect(clientInvoiceOverdueDays(invoice({ erp_payment_terms_days: null, invoice_date: '2026-07-01', erp_due_date: null }), '2026-08-03')).toBe(3);
  });

  it('anchors terms on the received date when recorded, beating both the ERP due date and the invoice-date math', () => {
    // Received 2026-07-11 + 30 = 2026-08-10 → not yet due on 2026-08-03.
    expect(clientInvoiceOverdueDays(invoice({ erp_due_date: '2026-07-31', received_date: '2026-07-11' }), '2026-08-03')).toBeNull();
    // …and overdue from 2026-08-11.
    expect(clientInvoiceOverdueDays(invoice({ erp_due_date: '2026-07-31', received_date: '2026-07-11' }), '2026-08-11')).toBe(1);
  });

  it('never decides overdue from an undecidable due date — no invoice date and no ERP due date', () => {
    expect(clientInvoiceOverdueDays(invoice({ invoice_date: null, erp_due_date: null }), '2026-08-03')).toBeNull();
  });

  it('handles month and year boundaries in the day count', () => {
    // Due 2026-01-31, org day 2026-02-03 → 3 days over two months.
    expect(clientInvoiceOverdueDays(invoice({ invoice_date: '2026-01-01', erp_due_date: '2026-01-31' }), '2026-02-03')).toBe(3);
    // Due 2025-12-28, org day 2026-01-02 → 5 days over the year end.
    expect(clientInvoiceOverdueDays(invoice({ invoice_date: '2025-11-28', erp_payment_terms_days: 30, erp_due_date: '2025-12-28' }), '2026-01-02')).toBe(5);
  });
});
