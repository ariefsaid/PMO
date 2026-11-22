/**
 * workOrderMaterialAlerts.ts — the alerts raised when material issued to a work order runs ahead of its progress
 * (docs/specs/material-vs-progress.spec.md). The database raises, refreshes and resolves them when stock posts or progress
 * is reported; this file only reads them, reads who else is told, and saves that list (Admin only, enforced by the database).
 */
import { supabase } from '@/src/lib/supabase/client';
import { toAppError } from '@/src/lib/appError';

export interface OpenMaterialAlertCount { workOrderId: string; itemCount: number }
export interface WaitingMaterialAlert { workOrderId: string; projectId: string; workOrderLabel: string; itemCount: number }

/** How many items on one work order are ahead of progress right now (open alerts). Empty for a light account or when nothing is open. */
export async function getOpenMaterialAlertCount(workOrderId: string): Promise<OpenMaterialAlertCount> {
  const { data, error } = await supabase.from('work_order_material_alerts').select('item_id')
    .eq('work_order_id', workOrderId).is('resolved_at', null).limit(500);
  if (error) throw toAppError(error);
  return { workOrderId, itemCount: (data ?? []).length };
}

/** The open alerts on work orders the caller controls (the needs-you pointer). Derived on read: a resolved alert is not returned. */
export async function getWaitingMaterialAlerts(): Promise<WaitingMaterialAlert[]> {
  const { data, error } = await supabase.rpc('my_open_material_alerts');
  if (error) throw toAppError(error);
  return (data ?? []).map((r) => ({ workOrderId: r.work_order_id, projectId: r.project_id, workOrderLabel: r.wo_label, itemCount: r.item_count }));
}

/** Built-in role keys the organisation also tells (besides the project manager). Empty = none. */
export async function getAheadAlertRoles(): Promise<string[]> {
  const { data, error } = await supabase.from('work_order_stock_settings').select('ahead_alert_roles').maybeSingle();
  if (error) throw toAppError(error);
  return data?.ahead_alert_roles ?? [];
}

/** Admin only (the database refuses anyone else and any key that is not a built-in role). */
export async function setAheadAlertRoles(roles: string[]): Promise<string[]> {
  const { data, error } = await supabase.rpc('set_work_order_ahead_alert_roles', { p_roles: roles });
  if (error) throw toAppError(error);
  return data ?? [];
}
