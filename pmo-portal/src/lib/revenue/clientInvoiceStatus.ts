/**
 * #1459 — the one declaration of "an open client invoice" (a sales invoice Finance still expects to
 * collect). It was declared three times: two `Set`s beside the re-stated pair in the finance reads.
 * The overdue rule (#1457, `clientInvoiceOverdueDays`) reads the same pair through this module.
 */
export const OPEN_CLIENT_INVOICE_STATUSES = ['Submitted', 'Unpaid'] as const;

export type OpenClientInvoiceStatus = (typeof OPEN_CLIENT_INVOICE_STATUSES)[number];

const OPEN_STATUS_SET: ReadonlySet<string> = new Set(OPEN_CLIENT_INVOICE_STATUSES);

export function isOpenClientInvoiceStatus(status: string | null | undefined): boolean {
  return status != null && OPEN_STATUS_SET.has(status);
}
