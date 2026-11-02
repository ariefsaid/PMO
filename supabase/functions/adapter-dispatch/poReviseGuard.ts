/**
 * AC-SCA-012 (#1513): a `purchase-order.revise` that would cancel the ERP order is refused while the purchase has a
 * submitted bill. The answer is the database's (`po_revision_push_refusal`, 0475), asked BEFORE any outbox or ERP work.
 * Fails closed on any unreadable input or unanswerable check. The key and the recovery decision live in the seam module
 * (AC-SCA-011); they are re-exported so the #1505 dispatch imports both from one place.
 */
export { poReviseRecoveryDecision } from '../../../pmo-portal/src/lib/adapterSeam/purchaseOrderRevise.ts';

export type PoReviseClient = {
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
};
export interface PoReviseResult { ok: boolean; status: number; message: string }

const FAILED: PoReviseResult = { ok: false, status: 422, message: 'gate-check-failed' };

export async function checkPoRevise(
  client: PoReviseClient,
  orgId: string,
  revise: { poId: unknown; revision: unknown },
  opts: { reviseCancels: boolean },
): Promise<PoReviseResult> {
  if (typeof revise.poId !== 'string' || revise.poId === '' || !Number.isInteger(revise.revision)) return FAILED;
  const { data, error } = await client.rpc('po_revision_push_refusal', {
    p_org: orgId, p_po_id: revise.poId, p_revision: revise.revision, p_revise_cancels: opts.reviseCancels,
  });
  if (error) { console.error('[adapter-dispatch] po_revision_push_refusal failed:', error); return FAILED; }
  return data === null || data === undefined ? { ok: true, status: 200, message: '' } : { ok: false, status: 422, message: String(data) };
}
