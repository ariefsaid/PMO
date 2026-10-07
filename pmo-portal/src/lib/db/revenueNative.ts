import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { Json } from '@/src/lib/supabase/database.types';

/**
 * #784 (ADR-0055 addendum 2026-10-07): the PMO-native revenue writes — used while no ERP owns revenue for the org.
 * Every write is a SECURITY DEFINER RPC (migration 0270) that enforces role (Admin/Finance), approval SoD, ownership and
 * balance rules; this module only names them.
 */
export interface NativeInvoiceLineInput {
  item_code: string;
  qty: number;
  rate: number;
  description?: string;
}

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

function fail(error: { message: string; code?: string }): never {
  throw new AppError(error.message, error.code);
}

export async function createNativeSalesInvoice(input: NativeInvoiceInput): Promise<string> {
  const { data, error } = await supabase.rpc('create_native_sales_invoice', {
    p_project_id: input.projectId,
    p_customer_id: input.customerId,
    p_lines: input.lines as unknown as Json,
    ...(input.workOrderId ? { p_work_order_id: input.workOrderId } : {}),
  });
  if (error) fail(error);
  return String(data);
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
  return String(data);
}

export async function cancelNativeReceipt(id: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_native_receipt', { p_receipt_id: id });
  if (error) fail(error);
}
