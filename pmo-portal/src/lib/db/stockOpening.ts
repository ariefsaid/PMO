/**
 * stockOpening.ts — opening stock with movement history (docs/specs/opening-stock-history.spec.md).
 * The database decides every rule: `preview_stock_opening_history` runs the validator and the running balance with no write,
 * `load_stock_opening_history` posts the same file atomically through the ledger's one writer. This file only maps.
 */
import { supabase } from '@/src/lib/supabase/client';
import { toAppError } from '@/src/lib/appError';
import type { Database } from '@/src/lib/supabase/database.types';
import type { StockMovementRow } from '@/src/lib/import/stockMovementHistoryDescriptor';

type PreviewReturn = Database['public']['Functions']['preview_stock_opening_history']['Returns'][number];

/** One row of the database's verdict. Quantities and money stay as the database returns them. */
export interface OpeningPreviewRow {
  rowNo: number;
  verdict: 'ok' | 'refused';
  /** `FAMILY_CODE: row n` when refused (the refusal protocol), else null. */
  message: string | null;
  locationCode: string | null;
  itemCode: string | null;
  occurredOn: string | null;
  direction: string | null;
  quantity: number | null;
  unitCost: number | null;
  reference: string | null;
  zeroCost: boolean;
  runQty: number | null;
  runVal: number | null;
}

const lines = (rows: readonly StockMovementRow[]) =>
  rows.map((r) => ({
    date: r.date, location: r.location, item: r.item, direction: r.direction, quantity: r.quantity,
    unit_cost: r.unitCost === '' ? null : r.unitCost, reference: r.reference === '' ? null : r.reference,
  }));

const toRow = (r: PreviewReturn): OpeningPreviewRow => ({
  rowNo: r.row_no,
  verdict: r.verdict === 'ok' ? 'ok' : 'refused',
  message: r.message ?? null,
  locationCode: r.location_code ?? null,
  itemCode: r.item_code ?? null,
  occurredOn: r.occurred_on ?? null,
  direction: r.direction ?? null,
  quantity: r.quantity ?? null,
  unitCost: r.unit_cost ?? null,
  reference: r.reference ?? null,
  zeroCost: r.zero_cost === true,
  runQty: r.run_qty ?? null,
  runVal: r.run_val ?? null,
});

export async function previewOpeningHistory(asOf: string, rows: readonly StockMovementRow[]): Promise<OpeningPreviewRow[]> {
  const { data, error } = await supabase.rpc('preview_stock_opening_history', { p_as_of: asOf, p_lines: lines(rows) });
  if (error) throw toAppError(error);
  return (data ?? []).map(toRow);
}

/** Confirms the file. `requestId` is one id per file: sending the same file again returns the same openings and posts nothing twice. */
export async function loadOpeningHistory(asOf: string, rows: readonly StockMovementRow[], requestId: string, note?: string): Promise<string[]> {
  const { data, error } = await supabase.rpc('load_stock_opening_history', {
    p_as_of: asOf, p_lines: lines(rows), p_client_request_id: requestId, ...(note ? { p_note: note } : {}),
  });
  if (error) throw toAppError(error);
  return data ?? [];
}
