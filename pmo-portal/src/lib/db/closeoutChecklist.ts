import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';

/**
 * Work-order close-out checklist DAL (#2593; migrations 1400–1402). Every write is a SECURITY DEFINER RPC (no client write
 * grant exists on the tables); reads are RLS-scoped; org_id is never sent from the client. A database refusal names its
 * reason in `details` (e.g. `item-out-of-order`); that becomes the AppError code the screen explains. The checklist items
 * are the organisation's own data: nothing here knows an item's name.
 */

/** A checklist has at most 20 items (the table's check). */
const ITEM_LIMIT = 20;

function fail(error: { message: string; code?: string; details?: string | null }): never {
  const detail = typeof error.details === 'string' && /^[a-z][a-z-]*$/.test(error.details) ? error.details : undefined;
  throw new AppError(error.message, detail ?? error.code);
}

export interface CloseoutTemplateItem {
  name: string;
  required: boolean;
}

export interface WorkOrderCloseoutItem {
  id: string;
  position: number;
  name: string;
  required: boolean;
  startedOn: string | null;
  doneOn: string | null;
  documentId: string | null;
  doneBy: string | null;
  doneByName: string | null;
}

/** The organisation's list, in order. */
export async function getCloseoutTemplate(): Promise<CloseoutTemplateItem[]> {
  const { data, error } = await supabase.from('closeout_checklist_templates')
    .select('position,name,required').order('position').limit(ITEM_LIMIT);
  if (error) fail(error);
  return (data ?? []).map((r) => ({ name: r.name, required: r.required }));
}

/** Replaces the organisation's list whole (Admin). Work orders already issued keep the list they were issued with. */
export async function setCloseoutTemplate(items: CloseoutTemplateItem[]): Promise<number> {
  const { data, error } = await supabase.rpc('set_closeout_checklist', { p_items: items.map((i) => ({ name: i.name, required: i.required })) });
  if (error) fail(error);
  return Number(data);
}

/** One work order's checklist in order, with the name of who marked each item done. */
export async function listWorkOrderCloseoutItems(workOrderId: string): Promise<WorkOrderCloseoutItem[]> {
  const { data, error } = await supabase.from('work_order_closeout_items')
    .select('id,position,name,required,started_on,done_on,document_id,done_by,doer:profiles!done_by(full_name)')
    .eq('work_order_id', workOrderId).order('position').limit(ITEM_LIMIT);
  if (error) fail(error);
  return (data ?? []).map((r) => ({
    id: r.id,
    position: r.position,
    name: r.name,
    required: r.required,
    startedOn: r.started_on,
    doneOn: r.done_on,
    documentId: r.document_id,
    doneBy: r.done_by,
    doneByName: (r.doer as { full_name: string | null } | null)?.full_name ?? null,
  }));
}

export async function attachCloseoutItemDocument(itemId: string, documentId: string): Promise<void> {
  const { error } = await supabase.rpc('attach_closeout_item_document', { p_item: itemId, p_document: documentId });
  if (error) fail(error);
}

export async function completeCloseoutItem(itemId: string, doneOn: string): Promise<void> {
  const { error } = await supabase.rpc('complete_closeout_item', { p_item: itemId, p_done_on: doneOn });
  if (error) fail(error);
}

export interface WorkOrderCloser {
  closedAt: string | null;
  closedByName: string | null;
}

/** When a work order was closed and by whom (stamped by the database from the caller; never sent by a client). */
export async function getWorkOrderCloser(workOrderId: string): Promise<WorkOrderCloser | null> {
  const { data, error } = await supabase.from('work_orders')
    .select('closed_at,closer:profiles!closed_by(full_name)').eq('id', workOrderId).maybeSingle();
  if (error) fail(error);
  if (!data) return null;
  return { closedAt: data.closed_at, closedByName: (data.closer as { full_name: string | null } | null)?.full_name ?? null };
}
