/**
 * Server-side Odoo stock ERP mirror adapter (AC-OSP-007).
 *
 * Persists evaluated stock evidence verdicts into public.stock_erp_mirror via
 * the security definer function write_stock_erp_mirror.
 *
 * Refusals (STK_MIRROR_FENCE, STK_MIRROR_COMPANY, STK_MIRROR_EVIDENCE,
 * STK_MIRROR_CONFIRMED, STK_MIRROR_STATE, STK_MIRROR_TRANSFER, STK_MIRROR_DOCUMENT) are returned typed and never retried.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StockEvidenceVerdict } from '../../../pmo-portal/src/lib/adapterSeam/odoo/stock/evidence.ts';

/** What the mirror stores: Odoo's verdict (without the cause the hold sentence is made from), or a refusal before anything reached Odoo (`failed`). `stale` is a state the table allows that no read produces. */
export type StockMirrorEvidence = Omit<StockEvidenceVerdict, 'state' | 'holdCause'> & { state: StockEvidenceVerdict['state'] | 'failed' | 'stale' };

export interface WriteStockMirrorParams {
  orgId: string;
  documentId: string;
  companyId: number;
  generation: number;
}

export type StockMirrorRefusalCode =
  | 'STK_MIRROR_FENCE'
  | 'STK_MIRROR_COMPANY'
  | 'STK_MIRROR_EVIDENCE'
  | 'STK_MIRROR_CONFIRMED'
  | 'STK_MIRROR_STATE'
  | 'STK_MIRROR_TRANSFER'
  | 'STK_MIRROR_DOCUMENT';

export type WriteStockMirrorResult =
  | { ok: true }
  | {
      ok: false;
      refusal: StockMirrorRefusalCode | 'UNKNOWN_REFUSAL';
      message: string;
    };

export interface StockMirrorClient {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
}

const KNOWN_REFUSALS: StockMirrorRefusalCode[] = [
  'STK_MIRROR_FENCE',
  'STK_MIRROR_COMPANY',
  'STK_MIRROR_EVIDENCE',
  'STK_MIRROR_CONFIRMED',
  'STK_MIRROR_STATE',
  'STK_MIRROR_TRANSFER',
  'STK_MIRROR_DOCUMENT',
];

/**
 * Writes the stock ERP mirror verdict to Supabase via write_stock_erp_mirror RPC.
 */
export async function writeOdooStockMirror(
  client: SupabaseClient | StockMirrorClient,
  params: WriteStockMirrorParams,
  verdict: StockMirrorEvidence,
): Promise<WriteStockMirrorResult> {
  const { error } = await client.rpc('write_stock_erp_mirror', {
    p_org_id: params.orgId,
    p_document_id: params.documentId,
    p_company_id: params.companyId,
    p_generation: params.generation,
    p_state: verdict.state,
    p_external_model: verdict.externalModel,
    p_external_id: verdict.externalId,
    p_external_reference: verdict.externalReference,
    p_completed_quantity: verdict.completedQuantity,
    p_completed_value: verdict.completedValue,
    p_currency: verdict.currency,
    p_source_written_at: verdict.sourceWrittenAt,
    p_fetched_at: new Date().toISOString(),
    p_exception: verdict.exception,
  });

  if (error) {
    const refusal =
      KNOWN_REFUSALS.find((code) => error.message.includes(code)) ?? 'UNKNOWN_REFUSAL';
    return {
      ok: false,
      refusal,
      message: error.message,
    };
  }

  return { ok: true };
}
