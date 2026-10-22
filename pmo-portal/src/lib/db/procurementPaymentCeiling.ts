import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';

/**
 * The server's payment ceiling for one procurement (`procurement_payment_within_ceiling`, 0349): the
 * pre-tax net of its live bills against the pre-tax approved amount. The server is the only place
 * this rule is evaluated — the screen reads it, never recomputes it.
 */
export interface ProcurementPaymentCeiling {
  ok: boolean;
  reason: string | null;
  billedNet: number | null;
  approvedAmount: number | null;
}

interface CeilingRow {
  ok: boolean;
  reason: string | null;
  billed_net: number | null;
  approved_amount: number | null;
}

interface RpcErrorLike {
  message: string;
  code?: string;
  details?: string | null;
}

function throwRpc(error: RpcErrorLike): never {
  throw new AppError(error.message, error.code, error.details ?? undefined);
}

/** Null when the server returns no row (not visible to the caller). */
export async function getProcurementPaymentCeiling(procurementId: string): Promise<ProcurementPaymentCeiling | null> {
  const { data, error } = (await supabase.rpc('procurement_payment_within_ceiling', {
    p_procurement_id: procurementId,
  })) as unknown as { data: CeilingRow[] | null; error: RpcErrorLike | null };
  if (error) throwRpc(error);
  const row = data?.[0];
  if (!row) return null;
  return {
    ok: row.ok,
    reason: row.reason,
    billedNet: row.billed_net == null ? null : Number(row.billed_net),
    approvedAmount: row.approved_amount == null ? null : Number(row.approved_amount),
  };
}

/** Approve a higher amount for a procurement awaiting payment; the server enforces eligibility. */
export async function approveProcurementAmount(procurementId: string, amount: number): Promise<void> {
  const { error } = (await supabase.rpc('approve_procurement_amount', {
    p_procurement_id: procurementId,
    p_amount: amount,
  })) as unknown as { data: null; error: RpcErrorLike | null };
  if (error) throwRpc(error);
}

/**
 * Attach the ceiling to a procurement awaiting payment (the only stage where it decides anything).
 * A failed read attaches null: the page stays readable, no figure is invented, and payment remains
 * refused or allowed by the server alone.
 */
export async function attachPaymentCeiling<T extends { id: string; status: string }>(
  detail: T,
): Promise<T & { paymentCeiling?: ProcurementPaymentCeiling | null }> {
  if (detail.status !== 'Vendor Invoiced') return detail;
  const paymentCeiling = await getProcurementPaymentCeiling(detail.id).catch(() => null);
  return { ...detail, paymentCeiling };
}
