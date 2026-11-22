/**
 * workOrderMaterialAlerts.ts — the "material issued ahead of progress" alerts (docs/specs/material-vs-progress.spec.md). They are rows of the
 * usage-warning alert table with kind `issued_ahead`; the database opens and resolves them when stock posts or progress is reported.
 * This file only reads them.
 */
import { supabase } from '@/src/lib/supabase/client';
import { toAppError } from '@/src/lib/appError';

export interface OpenMaterialAlertCount { workOrderId: string; itemCount: number }
export interface WaitingMaterialAlert { workOrderId: string; projectId: string; workOrderLabel: string; itemCount: number }

/** How many items on one work order are ahead of progress right now (open alerts). */
export async function getOpenMaterialAlertCount(workOrderId: string): Promise<OpenMaterialAlertCount> {
  const { data, error } = await supabase.from('material_installed_usage_alerts').select('item_id')
    .eq('work_order_id', workOrderId).eq('kind', 'issued_ahead').is('resolved_at', null).limit(500);
  if (error) throw toAppError(error);
  return { workOrderId, itemCount: (data ?? []).length };
}

/** The open alerts on work orders the caller is the one told about (the needs-you pointer). Derived on read: a resolved alert is not returned. */
export async function getWaitingMaterialAlerts(): Promise<WaitingMaterialAlert[]> {
  const { data, error } = await supabase.rpc('my_open_ahead_alerts');
  if (error) throw toAppError(error);
  return (data ?? []).map((r) => ({ workOrderId: r.work_order_id, projectId: r.project_id, workOrderLabel: r.wo_label, itemCount: r.item_count }));
}
