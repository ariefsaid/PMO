/**
 * #2696 — a category and a needed-by date on each purchase request line. The setting and the category list are organisation
 * data (`purchase_line_planning`, `purchase_line_categories`); every write goes through a definer RPC. Nothing here names a
 * category: the code only carries ids and labels the organisation entered.
 */
import { supabase } from '@/src/lib/supabase/client';
import type { Tables } from '@/src/lib/supabase/database.types';
import { AppError } from '@/src/lib/appError';

export type PurchaseLineCategory = Tables<'purchase_line_categories'>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function fail(error: { message: string; code?: string } | null): void {
  if (error) throw new AppError(error.message, error.code);
}

export async function getPurchaseLinePlanning(): Promise<boolean> {
  const { data, error } = await supabase.rpc('get_purchase_line_planning');
  fail(error);
  return data === true;
}

/** Admin-only, audited server-side. */
export async function setPurchaseLinePlanning(enabled: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc('set_purchase_line_planning', { p_enabled: enabled });
  fail(error);
  return data === true;
}

/** The organisation's categories (an Admin-curated short list, capped at 200), by position; `activeOnly` leaves retired ones out (for a picker). */
export async function listPurchaseLineCategories(opts: { activeOnly?: boolean } = {}): Promise<PurchaseLineCategory[]> {
  let query = supabase.from('purchase_line_categories').select('*').order('position', { ascending: true }).order('name', { ascending: true }).limit(200);
  if (opts.activeOnly) query = query.is('archived_at', null);
  const { data, error } = await query;
  fail(error);
  return (data ?? []) as PurchaseLineCategory[];
}

/** Add (id null) or rename / reorder a category. Admin-only. */
export async function savePurchaseLineCategory(id: string | null, name: string, position: number | null = null): Promise<string> {
  if (id !== null && !UUID.test(id)) throw new Error('Invalid category id');
  const { data, error } = await supabase.rpc('set_purchase_line_category', {
    p_id: id as unknown as string, p_name: name, p_position: position as unknown as number,
  });
  fail(error);
  if (typeof data !== 'string') throw new Error('The category was not saved');
  return data;
}

export async function archivePurchaseLineCategory(id: string): Promise<void> {
  if (!UUID.test(id)) throw new Error('Invalid category id');
  const { error } = await supabase.rpc('archive_purchase_line_category', { p_id: id });
  fail(error);
}

/** Sets (or, with nulls, clears) the category and needed-by date of one Draft line. */
export async function setProcurementLinePlanning(itemId: string, categoryId: string | null, neededBy: string | null): Promise<void> {
  if (!UUID.test(itemId)) throw new Error('Invalid line id');
  if (categoryId !== null && !UUID.test(categoryId)) throw new Error('Invalid category id');
  if (neededBy !== null && !ISO_DATE.test(neededBy)) throw new Error('A needed-by date is YYYY-MM-DD');
  const { error } = await supabase.rpc('set_procurement_line_planning', {
    p_item: itemId, p_category: categoryId as unknown as string, p_needed_by: neededBy as unknown as string,
  });
  fail(error);
}
