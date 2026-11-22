import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import { fetchAllRowsByKeyset } from '@/src/lib/pagedRead';

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
  /** Optional target in days (1–365, #2800); null = the item carries no target and is never overdue. */
  targetDays: number | null;
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
  /** The item's target in days as it was copied when the work order was issued; null = no target. */
  targetDays: number | null;
  /** The database's due day (issue day + target days); null = no target, never overdue. */
  dueOn: string | null;
}

/** One open, targeted close-out item, for the per-work-order overdue count (#2800, FR-CTD-009). */
export interface OpenCloseoutDueRow {
  workOrderId: string;
  dueOn: string | null;
  doneOn: string | null;
}

/** The organisation's list, in order. */
export async function getCloseoutTemplate(): Promise<CloseoutTemplateItem[]> {
  const { data, error } = await supabase.from('closeout_checklist_templates')
    .select('position,name,required,target_days').order('position').limit(ITEM_LIMIT);
  if (error) fail(error);
  return (data ?? []).map((r) => ({ name: r.name, required: r.required, targetDays: r.target_days ?? null }));
}

/**
 * Replaces the organisation's list whole (Admin). Work orders already issued keep the list they were issued with.
 * `target_days` is sent only when the item carries a target, so a list saved before targets existed produces the
 * same payload it always did and reads back as untargeted.
 */
export async function setCloseoutTemplate(items: CloseoutTemplateItem[]): Promise<number> {
  const { data, error } = await supabase.rpc('set_closeout_checklist', {
    p_items: items.map((i) => ({ name: i.name, required: i.required, ...(i.targetDays === null ? {} : { target_days: i.targetDays }) })),
  });
  if (error) fail(error);
  return Number(data);
}

/** One work order's checklist in order, with the name of who marked each item done. */
export async function listWorkOrderCloseoutItems(workOrderId: string): Promise<WorkOrderCloseoutItem[]> {
  const { data, error } = await supabase.from('work_order_closeout_items')
    .select('id,position,name,required,started_on,done_on,document_id,done_by,target_days,due_on,doer:profiles!done_by(full_name)')
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
    targetDays: r.target_days ?? null,
    dueOn: r.due_on ?? null,
  }));
}

/**
 * Every open close-out item that carries a due day, on an Issued work order — one batch read for the work-orders
 * list's per-work-order overdue count (#2800, FR-CTD-009). Issued-only matches the daily runner's own scan, so the
 * marker never counts an item the notifier would not. No organisation id is sent; RLS scopes the rows. Paged on
 * `id` so a large organisation never hits the silent 1000-row cap.
 */
export async function listOpenCloseoutDue(): Promise<OpenCloseoutDueRow[]> {
  type Raw = { id: string; work_order_id: string; due_on: string | null; done_on: string | null };
  const rows = await fetchAllRowsByKeyset<Raw>(async (afterId, limit) => {
    let q = supabase.from('work_order_closeout_items')
      .select('id, work_order_id, due_on, done_on, work_orders!inner(status)')
      .is('done_on', null)
      .not('due_on', 'is', null)
      .eq('work_orders.status', 'Issued')
      .order('id', { ascending: true });
    if (afterId !== null) q = q.gt('id', afterId);
    // Typed straight off the generated query: the embedded `status` is only a filter (and an extra
    // result field), so `data` is assignable to `Raw` — no untyped cast needed.
    const { data, error } = await q.limit(limit);
    return { data, error };
  });
  return rows.map((r) => ({ workOrderId: r.work_order_id, dueOn: r.due_on ?? null, doneOn: r.done_on ?? null }));
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
