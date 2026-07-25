/**
 * erpnext/revenueDisplay.ts (Slice 6, FR-SAR-141, AC-SAR-051, ADR-0048):
 * Read-only display helpers for AR aging / due-date columns. PMO NEVER authors
 * receivables-terms truth — ERPNext is the accounting engine (ADR-0048); we
 * only derive display values from mirrored data.
 */

const DEFAULT_PAYMENT_TERMS_DAYS = 30;

/**
 * Derive the AR due date for display purposes.
 *
 * Preference order (FR-SAR-141, ADR-0048):
 * 1. ERP's own `due_date` when present (the authoritative accounting date)
 * 2. `invoiceDate + paymentTermsDays` (customer's payment terms from binding)
 * 3. `invoiceDate + 30` (ERP default when terms are null/undefined)
 *
 * Returns `null` when `invoiceDate` is falsy (null/undefined/empty) — the caller
 * should render "—" or similar.
 *
 * @param invoiceDate - The invoice date (YYYY-MM-DD) from the mirrored SI
 * @param paymentTermsDays - The customer's `erp_payment_terms_days` from companies mirror (nullable)
 * @param erpDueDate - Optional ERP-computed due_date from the SI mirror (if available)
 * @returns The derived due date as YYYY-MM-DD string, or null if invoiceDate is missing
 */
export function deriveArDueDate(
  invoiceDate: string | null | undefined,
  paymentTermsDays: number | null | undefined,
  erpDueDate?: string | null,
): string | null {
  // If ERP provides a due_date, it's the authoritative source (ADR-0048)
  if (erpDueDate && erpDueDate.trim() !== '') {
    return erpDueDate;
  }

  // No invoice date → cannot derive
  if (!invoiceDate || invoiceDate.trim() === '') {
    return null;
  }

  // Resolve payment terms: null/undefined → default 30 days (ERP standard)
  const terms = paymentTermsDays ?? DEFAULT_PAYMENT_TERMS_DAYS;

  // Add payment terms days to invoice date
  const date = new Date(`${invoiceDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + terms);

  // Return as YYYY-MM-DD
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}