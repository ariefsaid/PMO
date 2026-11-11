/**
 * FR-OPP-060 / FR-OPP-044 (AC-OPP-054, AC-OPP-044): the two payment rules the shared vendor-payment gate (paymentGate.ts) has no arm for,
 * for a bill pushed to Odoo. Both read the bill's own outbox row(s) with the service client, scoped to the org, and run BEFORE the
 * outbox insert, so a refusal leaves no row and touches no Odoo.
 *   - the person who entered the bill cannot pay it (the recorded dispatcher of the bill's create is the author; the verified JWT
 *     subject is the payer, never a payload field);
 *   - a bill whose read-back is flagged needs-attention (Odoo computed another total, or a line lacks the cost account) is not payable
 *     until a person confirms it (FR-OPP-044); no confirmation path exists yet, so it is refused outright.
 * Fails closed: a bill whose rows cannot be read is refused. ERPNext keeps the shipped gate byte for byte: the tier is data below.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { isProcurementPaymentCreate } from './paymentGate.ts';

export interface OdooPaymentGateResult { ok: boolean; status: number; message: string }

/** The tiers whose bills carry an author and a read-back flag in the outbox (AC-ECA-043: data, not a branch on a tier name above the adapter). */
const AUTHORED_BILL_TIERS: Readonly<Record<string, boolean>> = { odoo: true };

const OK: OdooPaymentGateResult = { ok: true, status: 200, message: '' };
const refuse = (status: number, message: string): OdooPaymentGateResult => ({ ok: false, status, message });

export async function checkOdooPaymentGate(
  sc: SupabaseClient,
  orgId: string,
  tier: string | undefined,
  callerUserId: string,
  command: { domain: string; operation: unknown; record: { erp_doc_kind?: unknown; invoiceId?: unknown } },
): Promise<OdooPaymentGateResult> {
  if (!AUTHORED_BILL_TIERS[tier ?? ''] || !isProcurementPaymentCreate(command as never)) return OK;
  const invoiceId = command.record.invoiceId;
  if (typeof invoiceId !== 'string' || invoiceId === '') return refuse(422, 'payment-bill-required');
  const { data, error } = await sc.from('external_command_outbox').select('actor_user_id,canonical')
    .eq('org_id', orgId).eq('domain', 'procurement').eq('external_tier', tier!).eq('pmo_record_id', invoiceId);
  if (error) { console.error('[adapter-dispatch] odoo payment gate read failed:', error); return refuse(422, 'gate-check-failed'); }
  const rows = (data ?? []) as Array<{ actor_user_id: string | null; canonical: { odoo_outcome?: unknown } | null }>;
  if (callerUserId && rows.some((r) => r.actor_user_id === callerUserId)) return refuse(403, 'separation of duties: bill author cannot pay own bill');
  if (rows.some((r) => r.canonical?.odoo_outcome === 'needs-attention')) return refuse(422, 'bill-needs-attention');
  return OK;
}
