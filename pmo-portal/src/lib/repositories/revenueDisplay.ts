/**
 * erpnext/revenueDisplay.ts (Slice 6, FR-SAR-141, AC-SAR-051, ADR-0048):
 * Read-only display helpers for AR aging / due-date columns. PMO NEVER authors
 * receivables-terms truth — ERPNext is the accounting engine (ADR-0048); we
 * only derive display values from mirrored data.
 */

import { isOpenClientInvoiceStatus } from '../revenue/clientInvoiceStatus.ts';

const DEFAULT_PAYMENT_TERMS_DAYS = 30;

/**
 * The row fields the overdue rule reads. Every client-invoice row shape in the app
 * (SalesInvoiceRow, the dashboard's narrow OverdueInvoiceFact, the project-page
 * invoice rows) satisfies it structurally, so callers pass their rows as-is.
 */
export interface ClientInvoiceOverdueInput {
  status: string;
  invoice_date: string | null | undefined;
  erp_payment_terms_days: number | null | undefined;
  erp_due_date: string | null | undefined;
  received_date: string | null | undefined;
  /** Accounting balance still owed, tax included; absent or null = unknown. */
  erp_outstanding_amount?: number | null;
  /** The claim's retention still held on this invoice (ADR-0105; the `retention_held` read, 1116); absent = none. */
  retention_held?: number | null;
}

/** The fields the due-now rule reads. */
export interface ClientInvoiceBalanceInput {
  erp_outstanding_amount?: number | null;
  retention_held?: number | null;
}

/** A numeric balance arrives as a JSON number or as numeric text (PostgREST numeric); anything else is unknown. */
const balanceCents = (value: number | string | null | undefined): number | null => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

/**
 * #2625 (ADR-0105 §4) — the retention still held on an invoice, in cents, capped at the balance; null when the balance is
 * unknown. Retention is its own figure until a release is recorded: it is owed, but not due now.
 */
export function retentionHeldCents(invoice: ClientInvoiceBalanceInput): number | null {
  const outstanding = balanceCents(invoice.erp_outstanding_amount);
  if (outstanding === null) return null;
  const held = balanceCents(invoice.retention_held) ?? 0;
  return Math.max(0, Math.min(held, outstanding));
}

/**
 * #2625 (ADR-0105 §4) — THE due-now rule: the invoice's outstanding balance less the retention still held, in cents, never
 * below zero; null when the balance is unknown (never a guessed figure). The ledger stays the oracle for what was paid.
 */
export function clientInvoiceDueNowCents(invoice: ClientInvoiceBalanceInput): number | null {
  const outstanding = balanceCents(invoice.erp_outstanding_amount);
  if (outstanding === null) return null;
  return outstanding - (retentionHeldCents(invoice) ?? 0);
}

/**
 * #1457 — THE one rule for "overdue client invoice" (#1457, extracted from seven
 * inline copies). An open client invoice is overdue when it is Submitted or Unpaid
 * and its derived due date (#767/FR-SAR-141, see deriveArDueDate) is strictly
 * before the organization's current day. Due today is not overdue; neither is an
 * undecidable due date. The org day (never a device-local day) decides the
 * boundary, so every screen agrees; how much is outstanding stays each surface's
 * own concern.
 *
 * Returns the whole days overdue, or null when the invoice is not overdue.
 */
export function clientInvoiceOverdueDays(
  invoice: ClientInvoiceOverdueInput,
  organizationToday: string | null | undefined,
): number | null {
  if (!isOpenClientInvoiceStatus(invoice.status)) return null;
  // #2625: a known balance that is only retention still held is not due, so it is never overdue.
  if ((balanceCents(invoice.retention_held) ?? 0) > 0 && clientInvoiceDueNowCents(invoice) === 0) return null;
  const dueDate = deriveArDueDate(invoice.invoice_date, invoice.erp_payment_terms_days, invoice.erp_due_date, invoice.received_date);
  const age = overdueAgeDays(dueDate, organizationToday);
  return age !== null && age > 0 ? age : null;
}

/**
 * Whole calendar-day distance from the due date to the organization's current day.
 * No date-fns: an edge function (agent-chat) imports this file and Deno has no npm map for it.
 */
export function overdueAgeDays(dueDate: string | null | undefined, organizationToday: string | null | undefined): number | null {
  if (!dueDate || !organizationToday) return null;
  return Math.round((Date.parse(`${organizationToday}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86_400_000);
}

/**
 * Derive the AR due date for display purposes.
 *
 * Preference order (FR-SAR-141, ADR-0048; #767 AC-DUE-002):
 * 0. `receivedDate + terms` when the client's receipt date is recorded (terms run from receipt)
 * 1. ERP's own `due_date` when present (the authoritative accounting date)
 * 2. `invoiceDate + paymentTermsDays` (customer's payment terms from binding)
 * 3. `invoiceDate + 30` (ERP default when terms are null/undefined)
 *
 * This is the ONE effective-due-date helper: the Sales Invoices Due Date column and its export call
 * it. ERP's own AR aging keeps ERP's due date (Proposed DD-DUE-1, #767): ERPNext will not change
 * `due_date` on a submitted invoice, so PMO never pushes one.
 *
 * Returns `null` when `invoiceDate` is falsy (null/undefined/empty) — the caller
 * should render "—" or similar.
 *
 * @param invoiceDate - The invoice date (YYYY-MM-DD) from the mirrored SI
 * @param paymentTermsDays - The customer's `erp_payment_terms_days` from companies mirror (nullable)
 * @param erpDueDate - Optional ERP-computed due_date from the SI mirror (if available)
 * @param receivedDate - Optional date the client received the invoice (YYYY-MM-DD); overrides the others when set
 * @returns The derived due date as YYYY-MM-DD string, or null if invoiceDate is missing
 */
export function deriveArDueDate(
  invoiceDate: string | null | undefined,
  paymentTermsDays: number | null | undefined,
  erpDueDate?: string | null,
  receivedDate?: string | null,
): string | null {
  // #767: terms run from the date the client RECEIVED the invoice, when recorded.
  const anchor = receivedDate && receivedDate.trim() !== '' ? receivedDate : null;

  // If ERP provides a due_date, it's the authoritative source (ADR-0048)
  if (!anchor && erpDueDate && erpDueDate.trim() !== '') {
    return erpDueDate;
  }

  // No invoice date → cannot derive
  if (!anchor && (!invoiceDate || invoiceDate.trim() === '')) {
    return null;
  }

  // Resolve payment terms: null/undefined → default 30 days (ERP standard)
  const terms = paymentTermsDays ?? DEFAULT_PAYMENT_TERMS_DAYS;

  // Add payment terms days to the anchor (receipt date, else invoice date)
  const date = new Date(`${anchor ?? invoiceDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + terms);

  // Return as YYYY-MM-DD
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}