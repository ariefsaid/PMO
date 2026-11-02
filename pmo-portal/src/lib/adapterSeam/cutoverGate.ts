/**
 * cutoverGate.ts — FR-ECA-030 / OQ-ECA-1: a purchase whose first ERP-bound step happened before the connection pushes no
 * later step (other than the payment of a bill the ERP holds). Tier-agnostic by construction: it asks PMO's own tables (`pre_cutover_procurement`) and runs before any
 * adapter is selected, so no ERP tier can skip it. Relative imports only (Deno-importable).
 */
import { AppError } from '../appError.ts';

const LATER_STEPS = new Set(['goods-receipt', 'purchase-invoice', 'payment']);

interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/** Throws `pre-cutover` when the step must not reach the ERP. Fails closed: a check that cannot answer refuses. */
export async function assertNotPreCutover(
  client: RpcClient,
  command: { domain: string; record: Readonly<Record<string, unknown>> },
): Promise<void> {
  if (command.domain !== 'procurement' || !LATER_STEPS.has(String(command.record.erp_doc_kind))) return;
  if (typeof command.record.procurementId !== 'string') throw new AppError('purchase reference missing', 'commit-rejected');
  // A payment names the bill it pays: a bill the ERP already holds is paid there, whatever the purchase's age.
  const bill = command.record.erp_doc_kind === 'payment' && typeof command.record.invoiceId === 'string' ? { p_invoice_id: command.record.invoiceId } : {};
  const { data, error } = await client.rpc('pre_cutover_procurement', { p_procurement_id: command.record.procurementId, ...bill });
  if (error || typeof data !== 'boolean') throw new AppError('could not check the connection date', 'commit-rejected');
  if (data) throw new AppError('not sent: this purchase started before the ERP connection', 'pre-cutover');
}
