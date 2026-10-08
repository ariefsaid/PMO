import { supabase } from '@/src/lib/supabase/client';
import type { Database } from '@/src/lib/supabase/database.types';
import type { CorrectSlipInput, DecimalMoney, RecordSlipInput, SlipWriteResult, VoidSlipInput } from '@/src/lib/vendorWithholdingSlip';

type Functions = Database['public']['Functions'];
type SlipRow = Functions['list_vendor_withholding_slips']['Returns'][number];
type BillRow = Functions['list_vendor_withholding_bills']['Returns'][number];
type SlipArgs = Functions['list_vendor_withholding_slips']['Args'];
type BillArgs = Functions['list_vendor_withholding_bills']['Args'];
export type SlipCursor = { period: string; id: string };
export type BillCursor = { date: string | null; id: string; nullDate: boolean };
export type SlipDetail = { header: Record<string, unknown>; bills: Array<Record<string, unknown>> };
export type SlipPage = { rows: SlipRow[]; nextCursor: SlipCursor | null };
export type BillPage = { rows: BillRow[]; nextCursor: BillCursor | null };

function first<T>(rows: T[] | null): T {
  if (!rows?.[0]) throw new Error('Withholding slip write returned no result');
  return rows[0];
}
function decimal(value: DecimalMoney): number {
  // PostgREST accepts numeric JSON strings and PostgreSQL parses them as numeric without binary rounding.
  return value as unknown as number;
}

export async function recordSlip(input: RecordSlipInput): Promise<SlipWriteResult> {
  const { data, error } = await supabase.rpc('record_vendor_withholding_slip', {
    p_slip_id: input.slipId, p_vendor_id: input.vendorId, p_slip_number: input.slipNumber,
    p_slip_date: input.slipDate, p_tax_period: input.taxPeriod, p_pph_type: input.pphType,
    p_tax_base: decimal(input.taxBase), p_withheld_amount: decimal(input.withheldAmount),
    p_invoice_ids: input.invoiceIds, p_declared_invoice_ids: input.declaredInvoiceIds,
  });
  if (error) throw error;
  const row = first(data);
  return { slipId: row.slip_id, revision: row.revision };
}

export async function correctSlip(input: CorrectSlipInput): Promise<SlipWriteResult> {
  const { data, error } = await supabase.rpc('correct_vendor_withholding_slip', {
    p_slip_id: input.slipId, p_expected_revision: input.expectedRevision, p_slip_number: input.slipNumber,
    p_slip_date: input.slipDate, p_tax_period: input.taxPeriod, p_reason: input.reason,
  });
  if (error) throw error;
  const row = first(data);
  return { slipId: row.slip_id, revision: row.revision };
}

export async function voidSlip(input: VoidSlipInput): Promise<SlipWriteResult> {
  const { data, error } = await supabase.rpc('void_vendor_withholding_slip', {
    p_slip_id: input.slipId, p_expected_revision: input.expectedRevision, p_reason: input.reason,
  });
  if (error) throw error;
  const row = first(data);
  return { slipId: row.slip_id, revision: row.revision };
}

export async function listSlips(params: Omit<SlipArgs, 'p_limit'> & { limit?: number }): Promise<SlipPage> {
  const limit = Math.max(1, Math.min(params.limit ?? 50, 100));
  const args: SlipArgs = {
    p_vendor_id: params.p_vendor_id, p_tax_period: params.p_tax_period, p_invoice_id: params.p_invoice_id,
    p_before_period: params.p_before_period, p_before_id: params.p_before_id, p_limit: limit,
  };
  const { data, error } = await supabase.rpc('list_vendor_withholding_slips', args);
  if (error) throw error;
  const rows = data ?? [];
  const last = rows.at(-1);
  return { rows, nextCursor: rows.length === limit && last ? { period: last.tax_period, id: last.slip_id } : null };
}

export async function listBills(params: Omit<BillArgs, 'p_limit'> & { limit?: number }): Promise<BillPage> {
  const limit = Math.max(1, Math.min(params.limit ?? 50, 100));
  const args: BillArgs = {
    p_vendor_id: params.p_vendor_id, p_pph_type: params.p_pph_type, p_currency: params.p_currency,
    p_invoice_ids: params.p_invoice_ids, p_candidates_only: params.p_candidates_only,
    p_after_date: params.p_after_date, p_after_id: params.p_after_id,
    p_after_null_date: params.p_after_null_date, p_limit: limit,
  };
  const { data, error } = await supabase.rpc('list_vendor_withholding_bills', args);
  if (error) throw error;
  const rows = data ?? [];
  const last = rows.at(-1);
  return {
    rows,
    nextCursor: rows.length === limit && last
      ? { date: last.invoice_date, id: last.invoice_id, nullDate: last.invoice_date === null }
      : null,
  };
}

export async function getSlip(slipId: string): Promise<SlipDetail> {
  const { data, error } = await supabase.rpc('get_vendor_withholding_slip', { p_slip_id: slipId });
  if (error) throw error;
  return data as unknown as SlipDetail;
}

export type { SlipRow, BillRow, SlipArgs, BillArgs };
