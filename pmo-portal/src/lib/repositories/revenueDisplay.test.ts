import { describe, it, expect } from 'vitest';
import { deriveArDueDate } from './revenueDisplay';

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