/**
 * 1124d — the order's "needed by" date. The rule is organisation data (`organizations.po_needed_by_required_from`, null = off);
 * the header date and the per-line dates are written only by `set_procurement_needed_by`, which fills the lines. The database refuses to send
 * an order (status Ordered) without the date when the rule is on; nothing here decides that.
 */
import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import { priceSource } from '@/src/lib/priceReadPath';
import { readOrgColumnsStrict } from './orgSettingsBatch';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function fail(error: { message: string; code?: string } | null): void {
  if (error) throw new AppError(error.message, error.code);
}

export async function getPoNeededByRequired(): Promise<boolean> {
  const { data, error } = await readOrgColumnsStrict(['po_needed_by_required_from'], { limit: true });
  fail(error);
  return Boolean((data as { po_needed_by_required_from?: string | null } | null)?.po_needed_by_required_from);
}

/** Admin-only, audited server-side. */
export async function setPoNeededByRequired(on: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc('set_po_needed_by_required', { p_on: on });
  fail(error);
  return data === true;
}

export async function getProcurementNeededBy(id: string): Promise<string | null> {
  if (!UUID.test(id)) throw new Error('Invalid order id');
  const { data, error } = await supabase.from(priceSource('procurements') as 'procurements').select('needed_by').eq('id', id).maybeSingle();
  fail(error);
  return (data as { needed_by?: string | null } | null)?.needed_by ?? null;
}

export interface NeededByLine { itemId: string; neededBy: string | null }

/** Sets the header date (null clears it) and, optionally, the dates of single lines; a null line date puts that line back on the header date. */
export async function setProcurementNeededBy(id: string, neededBy: string | null, lines: NeededByLine[] = []): Promise<void> {
  if (!UUID.test(id)) throw new Error('Invalid order id');
  if (neededBy !== null && !ISO_DATE.test(neededBy)) throw new Error('Invalid date');
  for (const l of lines) {
    if (!UUID.test(l.itemId) || (l.neededBy !== null && !ISO_DATE.test(l.neededBy))) throw new Error('Invalid line');
  }
  const { error } = await supabase.rpc('set_procurement_needed_by', {
    p_id: id, p_needed_by: neededBy,
    p_lines: lines.length === 0 ? null : lines.map((l) => ({ item_id: l.itemId, needed_by: l.neededBy })),
  });
  fail(error);
}
