import { describe, expect, it } from 'vitest';
import { sortSalesInvoiceCollection } from './salesInvoiceCollectionSort';

type Invoice = { id: string; dueDate: string | null; invoiceDate: string | null };

const invoice = (id: string, dueDate: string | null, invoiceDate: string | null = '2026-10-01'): Invoice => ({
  id,
  dueDate,
  invoiceDate,
});

describe('sortSalesInvoiceCollection', () => {
  it('shows the soonest due invoice first, keeps unknown dates last, and breaks ties by invoice id', () => {
    const rows = [
      invoice('INV-3', '2026-11-10'),
      invoice('INV-unknown', null),
      invoice('INV-2', '2026-11-03'),
      invoice('INV-1', '2026-11-03'),
    ];

    expect(sortSalesInvoiceCollection(rows, 'due-asc', '2026-11-01').map((row) => row.id))
      .toEqual(['INV-1', 'INV-2', 'INV-3', 'INV-unknown']);
  });

  it('puts the oldest overdue invoices first in the overdue view', () => {
    const rows = [
      invoice('INV-upcoming', '2026-11-04'),
      invoice('INV-newer-late', '2026-10-20'),
      invoice('INV-oldest-late', '2026-10-01'),
      invoice('INV-unknown', null),
    ];

    expect(sortSalesInvoiceCollection(rows, 'overdue-desc', '2026-10-26').map((row) => row.id))
      .toEqual(['INV-oldest-late', 'INV-newer-late', 'INV-upcoming', 'INV-unknown']);
  });

  it('uses latest invoice date when the selected status has its own date scope', () => {
    const rows = [
      invoice('INV-old', '2026-12-01', '2026-09-01'),
      invoice('INV-new', '2026-12-01', '2026-10-01'),
      invoice('INV-undated', '2026-12-01', null),
    ];

    expect(sortSalesInvoiceCollection(rows, 'invoice-date-desc', '2026-10-26').map((row) => row.id))
      .toEqual(['INV-new', 'INV-old', 'INV-undated']);
  });
});
