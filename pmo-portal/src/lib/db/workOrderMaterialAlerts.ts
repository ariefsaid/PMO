/**
 * workOrderMaterialAlerts.ts — the "material issued ahead of progress" alerts (docs/specs/material-vs-progress.spec.md). They are rows of the
 * usage-warning alert table with kind `issued_ahead`; the database opens and resolves them when stock posts or progress is reported.
 * This file only reads them.
 */
import { supabase } from '@/src/lib/supabase/client';
import { toAppError } from '@/src/lib/appError';
import { fetchAllPages } from '@/src/lib/pagedRead';
import { BY_IDS_CHUNK } from './limits';

export interface OpenMaterialAlertCount { workOrderId: string; itemCount: number }
export interface WaitingMaterialAlert { workOrderId: string; projectId: string; workOrderLabel: string; itemCount: number }

/** How many items on one work order are ahead of progress right now (open alerts). */
export async function getOpenMaterialAlertCount(workOrderId: string): Promise<OpenMaterialAlertCount> {
  const { count, error } = await supabase.from('material_installed_usage_alerts').select('item_id', { count: 'exact', head: true })
    .eq('work_order_id', workOrderId).eq('kind', 'issued_ahead').is('resolved_at', null);
  if (error) throw toAppError(error);
  return { workOrderId, itemCount: count ?? 0 };
}

/** The same count for many work orders in a few requests (one per chunk of ids) instead of one request each. Every id is present in the result, 0 when none is open. */
export async function getOpenMaterialAlertCounts(workOrderIds: string[]): Promise<Record<string, number>> {
  const ids = [...new Set(workOrderIds)];
  const counts: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
  for (let i = 0; i < ids.length; i += BY_IDS_CHUNK) {
    const chunk = ids.slice(i, i + BY_IDS_CHUNK);
    const rows = await fetchAllPages((from, to) => supabase.from('material_installed_usage_alerts').select('work_order_id,item_id')
      .in('work_order_id', chunk).eq('kind', 'issued_ahead').is('resolved_at', null)
      .order('work_order_id').order('item_id').range(from, to));
    for (const row of rows) counts[row.work_order_id] = (counts[row.work_order_id] ?? 0) + 1;
  }
  return counts;
}

/** The open alerts on work orders the caller is the one told about (the needs-you pointer). Derived on read: a resolved alert is not returned. */
export async function getWaitingMaterialAlerts(): Promise<WaitingMaterialAlert[]> {
  const { data, error } = await supabase.rpc('my_open_ahead_alerts');
  if (error) throw toAppError(error);
  return (data ?? []).map((r) => ({ workOrderId: r.work_order_id, projectId: r.project_id, workOrderLabel: r.wo_label, itemCount: r.item_count }));
}
