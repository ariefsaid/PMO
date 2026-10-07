import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';

/**
 * #784 (ADR-0055 addendum 2026-10-07): the PMO-native revenue writes — used while no ERP owns revenue for the org.
 * Every write is a SECURITY DEFINER RPC (migration 0275) that enforces role (Admin/Finance), approval SoD, ownership and
 * balance rules; this module only names them.
 */
/** A type alias (not an interface) so a line is assignable to the generated `Json` the RPC takes. */
export type NativeInvoiceLineInput = {
  item_code: string;
  qty: number;
  rate: number;
  description?: string;
};

export interface NativeInvoiceInput {
  projectId: string;
  customerId: string;
  /** Pre-tax lines; PPN is added server-side from the project's VAT setting (OD-TAX-4). */
  lines: NativeInvoiceLineInput[];
  workOrderId?: string | null;
}

export interface NativeReceiptInput {
  salesInvoiceId: string;
  /**
   * The amount settled on the invoice, tax withheld included (DD-RCPT-1). Omitted = settle what is outstanding;
   * less or more than the balance is accepted (DD-NAR-17).
   */
  amount?: number;
  receivedAmount?: number;
  withheldAmount?: number;
  withholdingSlipNumber?: string | null;
  /** The payment date (yyyy-mm-dd), required by the server and never in the future (DD-NAR-17). */
  date: string;
}

/**
 * The machine-readable refusal codes migration 0275's RPCs put in the error DETAIL. The UI keys its headlines on these,
 * never on the message text. Any other detail (e.g. Postgres's own "Failing row contains …") is ignored and the
 * SQLSTATE stays the code, so free text never becomes a code.
 */
export const NATIVE_REVENUE_REFUSALS = [
  // Ownership: a PMO write once an ERP owns revenue; the PMO path refusing an ERP row; the ERP path refusing a PMO row.
  'erp-owns-revenue', 'not-pmo-native', 'pmo-native',
  // Receipts (23502 / 23514).
  'payment-date-missing', 'payment-date-future', 'payment-date-before-invoice', 'receipt-amount-invalid',
  'withheld-amount-invalid', 'receipt-split-mismatch', 'withholding-slip-missing', 'receipt-on-pmo-invoice',
  // Invoice body (23514) and tax (P0001).
  'invoice-lines-count', 'invoice-line-invalid', 'invoice-total-invalid', 'vat-rate-missing',
  // State (P0001) and approval SoD.
  'invoice-not-receivable', 'invoice-has-receipts', 'receipt-already-cancelled', 'illegal-transition',
  'sod-self-approval', 'sod-author-missing', 'native-drafts-open',
] as const;
export type NativeRevenueRefusal = (typeof NATIVE_REVENUE_REFUSALS)[number];
const REFUSALS: ReadonlySet<string> = new Set(NATIVE_REVENUE_REFUSALS);

/** The code a revenue refusal is classified by: its machine-readable detail when it is a known one, else the SQLSTATE. */
export function revenueRefusalCode(error: { code?: string; details?: string | null }): string | undefined {
  return error.details && REFUSALS.has(error.details) ? error.details : error.code;
}

function fail(error: { message: string; code?: string; details?: string | null }): never {
  throw new AppError(error.message, revenueRefusalCode(error));
}

/** The new row's id. A write that reports success with no id is an error, never the string "null". */
function newId(data: unknown, what: string): string {
  if (typeof data !== 'string' || data === '') throw new AppError(`the server recorded the ${what} but returned no id`);
  return data;
}

export async function createNativeSalesInvoice(input: NativeInvoiceInput): Promise<string> {
  const { data, error } = await supabase.rpc('create_native_sales_invoice', {
    p_project_id: input.projectId,
    p_customer_id: input.customerId,
    p_lines: input.lines,
    ...(input.workOrderId ? { p_work_order_id: input.workOrderId } : {}),
  });
  if (error) fail(error);
  return newId(data, 'invoice');
}

export async function transitionNativeSalesInvoice(id: string, to: 'Unpaid' | 'Cancelled'): Promise<void> {
  const { error } = await supabase.rpc('transition_native_sales_invoice', { p_id: id, p_to: to });
  if (error) fail(error);
}

export async function recordNativeReceipt(input: NativeReceiptInput): Promise<string> {
  const slip = input.withholdingSlipNumber?.trim();
  const { data, error } = await supabase.rpc('record_native_receipt', {
    p_sales_invoice_id: input.salesInvoiceId,
    ...(input.amount !== undefined ? { p_amount: input.amount } : {}),
    ...(input.receivedAmount !== undefined ? { p_received_amount: input.receivedAmount } : {}),
    ...(input.withheldAmount !== undefined ? { p_withheld_amount: input.withheldAmount } : {}),
    ...(slip ? { p_withholding_slip_number: slip } : {}),
    p_date: input.date,
  });
  if (error) fail(error);
  return newId(data, 'receipt');
}

export async function cancelNativeReceipt(id: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_native_receipt', { p_receipt_id: id });
  if (error) fail(error);
}
