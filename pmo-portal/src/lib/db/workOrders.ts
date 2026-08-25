import { supabase } from '@/src/lib/supabase/client';
import { AppError, assertWriteLanded } from '@/src/lib/appError';
import type { Tables } from '@/src/lib/supabase/database.types';
import type { TaxTreatment } from '@/src/lib/db/procurementLifecycle';

/**
 * Work-order DAL (#566, over migrations `0193` + `0197`).
 *
 * A work order is the CLIENT's inbound purchase order for a scoped activity inside a project's
 * commitment — REVENUE side. The sum of issued work orders is the DRAWDOWN against
 * `projects.contract_value`, and maximising that drawdown is the PM's job (OD-WO-2 / OD-CR-13).
 *
 * ⛔ THE WRITE TOPOLOGY IS NOT SYMMETRIC, and every asymmetry is a control:
 *
 *   • CREATE is a plain INSERT — but only over the granted column list (`0193 §5`). `status`,
 *     `wo_number` and every witness/stamp column are withheld from the grant AND refused by the
 *     origination guard, so this module never sends them.
 *   • BODY EDIT is a plain UPDATE over a SHORTER list: `0197 §5(a)` REVOKED `order_value`,
 *     `tax_treatment` and `tax_amount` from the client UPDATE grant, because promoting the tax
 *     basis into an input of the over-commit control changed its threat model. Sending any of
 *     them here is a `42501`, and it is meant to be.
 *   • VALUE + BASIS travel TOGETHER through `set_work_order_value` — the sole witnessed writer.
 *     Whoever last moved any part of the figure the drawdown computes from is the person the
 *     issue SoD then asks about.
 *   • STATUS moves only through `transition_work_order`.
 *
 * org_id is NEVER sent from the client: the column default + `stamp_org_id` put the caller's real
 * org on the row, RLS scopes every read, and both definer RPCs re-assert org internally.
 */

export type WorkOrderRow = Tables<'work_orders'>;
export type WorkOrderStatus = WorkOrderRow['status'];

/** Shape of a PostgREST/Postgres error we surface (only the fields we read). */
interface PostgrestErrorLike {
  message: string;
  code?: string;
}

/**
 * Throws an `AppError` preserving the verbatim message AND the Postgres error `code`, so the UI
 * can classify the toast via `classifyMutationError`. The codes this surface actually produces:
 * `42501` (RLS / role gate / SoD refusal / post-Draft freeze), `P0001` (illegal transition, a
 * missing or unwanted over-commit acknowledgement, a missing tax basis), `23514` (a value or tax
 * amount outside its CHECK), `P0002` (row vanished under the caller).
 */
function throwWrite(error: PostgrestErrorLike): never {
  throw new AppError(error.message, error.code);
}

/**
 * The create body — exactly the columns `0193 §5`'s INSERT grant admits, minus the ones the
 * origination guard refuses. `currency` is deliberately ABSENT: `stamp_currency` resolves it from
 * the caller's org and `check_work_order_project_currency` pins it to the parent project's, so a
 * client-sent currency could only ever agree or be rejected.
 *
 * ⚑ `taxTreatment` and `taxAmount` are REQUIRED, not optional-with-a-default. Both columns are
 * NOT NULL with no DB default precisely so an omission is a hard error rather than a silently
 * wrong basis (`0193 §1`), and OD-TAX-1 forbids pre-selecting a treatment anywhere in the UI.
 */
export interface WorkOrderInput {
  title: string;
  clientPoNumber: string | null;
  description: string | null;
  orderValue: number;
  taxTreatment: TaxTreatment;
  taxAmount: number;
  orderDate: string | null;
  startDate: string | null;
  endDate: string | null;
}

/**
 * The editable body — `0197 §5(a)`'s UPDATE grant verbatim, minus `tax_rate`/`tax_template`
 * (descriptive, no form collects them yet). Money and its basis are NOT here by design: they move
 * through `setWorkOrderValue`. `0193 §4` freezes every one of these columns the moment the row
 * leaves Draft, so the UI offers this form on Drafts only.
 */
export interface WorkOrderPatch {
  title: string;
  clientPoNumber: string | null;
  description: string | null;
  orderDate: string | null;
  startDate: string | null;
  endDate: string | null;
}

/** The value + the basis that describes it — always written as one call (`0197 §5`). */
export interface SetWorkOrderValueInput {
  id: string;
  value: number;
  taxTreatment: TaxTreatment;
  taxAmount: number;
}

/**
 * `get_project_drawdown`'s row, with the numerics normalised to `number`.
 *
 * `basis` is returned by the RPC rather than inferred: both sides are converted to NET before the
 * comparison, so the figures are basis-independent and the over-commit trigger point is correct in
 * BOTH directions (`0197 §3`). OD-TAX-1 requires the label be rendered, never assumed.
 */
export interface ProjectDrawdown {
  /** Issued + Closed, net of tax. The PM's headline number. */
  committed: number;
  /** Draft only, net of tax — reported separately so drafts never pollute the headline. */
  draft: number;
  /** `projects.contract_value`, net of tax. The ceiling the work orders draw against. */
  ceiling: number;
  currency: string;
  /** The basis every figure above is stated on. `'net'` today. */
  basis: string;
}

/**
 * The legal (from → to) map, mirroring the `v_legal` literal inside `transition_work_order`
 * (`0193 §8`). `Closed` and `Cancelled` are TERMINAL — which is also what makes `issued_at` a
 * once-only stamp. This is a UX projection; the RPC is the authority.
 */
export const LEGAL_WORK_ORDER_TRANSITIONS: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  Draft: ['Issued', 'Cancelled'],
  Issued: ['Closed', 'Cancelled'],
  Closed: [],
  Cancelled: [],
};

/** True when (from → to) is in the map above and is not a no-op. Mirrors the RPC's legality test. */
export function isLegalWorkOrderTransition(from: WorkOrderStatus, to: WorkOrderStatus): boolean {
  if (from === to) return false;
  return LEGAL_WORK_ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Normalise one figure to NET, the same way `get_project_drawdown` and `transition_work_order`
 * both do (`0197 §3`/`§4`): an inclusive figure already contains its tax, an exclusive one does
 * not. Exported so the FE's over-commitment preview and the server's gate cannot drift.
 */
export function netOf(value: number, treatment: string, taxAmount: number): number {
  return treatment === 'inclusive' ? value - taxAmount : value;
}

/**
 * Does this failure mean "you may do this, but you must say so out loud"?
 *
 * `transition_work_order` refuses an over-ceiling issue with `P0001` and a message that NAMES the
 * candidate total, the ceiling and what is already committed — deliberately, because the fix is a
 * human decision rather than a retry. The UI needs to tell that refusal apart from the other
 * `P0001`s on the same call (an illegal transition; an acknowledgement attached where none is
 * wanted), so it can offer the acknowledgement path instead of a dead-end toast.
 *
 * ⚑ THIS MATCHES ON THE SERVER'S MESSAGE TEXT, and that coupling is deliberate rather than
 * overlooked: the RPC returns one errcode for three distinct refusals, so the text is the only
 * discriminator available without a schema change. The substring chosen is the ruling's own phrase
 * ("must be acknowledged explicitly"), not incidental wording. ⚑ AND THE FAILURE MODE IS
 * DEGRADATION, NOT BREAKAGE: if the message ever changes, this returns false and the caller falls
 * back to showing the server's message verbatim — which itself instructs the reader to re-issue
 * with the acknowledgement. Nothing is auto-retried and nothing is silently swallowed either way.
 */
export function isOverCommitmentRefusal(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  const message = err instanceof Error ? err.message : '';
  return code === 'P0001' && message.includes('must be acknowledged explicitly');
}

/**
 * Every work order on a project, newest first. org_id is NEVER sent — `work_orders_select`
 * (`org_id = auth_org_id() AND is_active_member()`) scopes the rows.
 */
export async function listProjectWorkOrders(projectId: string): Promise<WorkOrderRow[]> {
  const { data, error } = await supabase
    .from('work_orders')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });
  if (error) throwWrite(error);
  return data ?? [];
}

/** One work order by id, or null when not found / not readable. RLS scopes the row. */
export async function getWorkOrder(id: string): Promise<WorkOrderRow | null> {
  const { data, error } = await supabase
    .from('work_orders')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throwWrite(error);
  return data ?? null;
}

/**
 * Mint a Draft work order under a project.
 *
 * ⚑ `status` is NOT sent. The column defaults to `'Draft'` and the origination guard refuses any
 * other origination status by name — sending `'Draft'` explicitly would be harmless today and
 * would quietly become the thing to edit the day someone wants a different origination state.
 * The same reasoning covers `wo_number` (minted at issue) and every stamp column.
 */
export async function createWorkOrder(
  projectId: string,
  input: WorkOrderInput,
): Promise<WorkOrderRow> {
  const { data, error } = await supabase
    .from('work_orders')
    .insert({
      project_id: projectId,
      title: input.title,
      client_po_number: input.clientPoNumber,
      description: input.description,
      order_value: input.orderValue,
      tax_treatment: input.taxTreatment,
      tax_amount: input.taxAmount,
      order_date: input.orderDate,
      start_date: input.startDate,
      end_date: input.endDate,
    })
    .select()
    .single();
  if (error) throwWrite(error);
  return data as WorkOrderRow;
}

/**
 * Edit a Draft work order's body. Deliberately excludes `order_value` / `tax_treatment` /
 * `tax_amount` — `0197 §5(a)` revoked them from the client UPDATE grant, and they move through
 * `setWorkOrderValue` so the witness the issue SoD reads is re-stamped with them.
 */
export async function updateWorkOrder(id: string, patch: WorkOrderPatch): Promise<void> {
  const { data, error } = await supabase
    .from('work_orders')
    .update({
      title: patch.title,
      client_po_number: patch.clientPoNumber,
      description: patch.description,
      order_date: patch.orderDate,
      start_date: patch.startDate,
      end_date: patch.endDate,
    })
    .eq('id', id)
    .select('id');
  if (error) throwWrite(error);
  assertWriteLanded(data, 'Work order not found or you do not have permission to edit it.');
}

/**
 * Set a Draft work order's value AND the tax basis that describes it, through the sole witnessed
 * writer (`set_work_order_value`, `0197 §5`). Both tax params are sent unconditionally: the RPC
 * defaults them to NULL and then refuses a NULL with `P0001`, so a `?? undefined` fall-through
 * here would produce a confusing server error instead of a caller-side type error.
 */
export async function setWorkOrderValue(input: SetWorkOrderValueInput): Promise<void> {
  const { error } = await supabase.rpc('set_work_order_value', {
    p_id: input.id,
    p_value: input.value,
    p_tax_treatment: input.taxTreatment,
    p_tax_amount: input.taxAmount,
  });
  if (error) throwWrite(error as PostgrestErrorLike);
}

/**
 * Move a work order's status through `transition_work_order` — the single authority for every
 * status change, the `wo_number` mint and the issue SoD.
 *
 * ⚑ `overCommitAck` is sent ONLY when the caller has one to make. The RPC refuses an
 * acknowledgement attached to a non-issue transition, and refuses one when there is nothing to
 * acknowledge (`DD-WO-10`) — so passing `false` unconditionally would turn a Draft→Cancelled into
 * a `P0001`. `undefined` is omitted by PostgREST, which is the "said nothing" the RPC fails closed
 * on.
 */
export async function transitionWorkOrder(
  id: string,
  to: WorkOrderStatus,
  opts?: { overCommitAck?: boolean },
): Promise<void> {
  const { error } = await supabase.rpc('transition_work_order', {
    p_id: id,
    p_to: to,
    p_over_commit_ack: opts?.overCommitAck,
  });
  if (error) throwWrite(error as PostgrestErrorLike);
}

/**
 * The project's derived drawdown (`get_project_drawdown`, SECURITY INVOKER — the caller's own RLS
 * is the tenancy boundary).
 *
 * Returns null for a project that is invisible or absent: the RPC yields ZERO ROWS there rather
 * than a fabricated zero row, and collapsing that to `{committed: 0, ceiling: 0}` would render a
 * plausible number in place of an error (#508). Postgres `numeric` arrives as a string over
 * PostgREST in some driver paths, so every figure goes through `Number` once, here.
 */
export async function getProjectDrawdown(projectId: string): Promise<ProjectDrawdown | null> {
  const { data, error } = await supabase.rpc('get_project_drawdown', { p_project_id: projectId });
  if (error) throwWrite(error as PostgrestErrorLike);
  const row = (data ?? [])[0];
  if (!row) return null;
  return {
    committed: Number(row.committed),
    draft: Number(row.draft),
    ceiling: Number(row.ceiling),
    currency: row.currency,
    basis: row.basis,
  };
}
