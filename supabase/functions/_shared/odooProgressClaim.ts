import type { SupabaseClient } from '@supabase/supabase-js';
import { AdapterError } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { progressClaimItems, type ProgressClaimLineRecord, type ProgressClaimRecord } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/progressClaimItems.ts';

const MAX_CLAIM_LINES = 500;

export interface OdooProgressClaim {
  claim: ProgressClaimRecord;
  customerId: string;
  items: ReturnType<typeof progressClaimItems>;
}

function invoiceItemsFromClaim(claim: ProgressClaimRecord, lines: readonly ProgressClaimLineRecord[]): ReturnType<typeof progressClaimItems> {
  if (claim.kind === 'down_payment') return progressClaimItems(claim);
  if (claim.withdrawn_at) {
    throw new AdapterError('commit-rejected', 'This progress claim was withdrawn, so no invoice can be raised for it');
  }
  if (claim.kind !== 'progress') {
    throw new AdapterError('commit-rejected', 'Time-and-materials lines must be resolved from the signed claim');
  }
  if (lines.length === 0) throw new AdapterError('commit-rejected', 'This progress claim has no quantity lines');

  const items: ReturnType<typeof progressClaimItems> = lines.map((line) => ({
    item_code: line.item_code,
    qty: Number(line.quantity),
    rate: Number(line.rate),
    description: `${line.description} (${line.unit})`,
  }));
  const recovery = Number(claim.dp_recovery_amount);
  if (recovery > 0) {
    if (!claim.dp_item_code) {
      throw new AdapterError('commit-rejected', 'This progress claim recovers a down payment but names no down payment item');
    }
    items.push({ item_code: claim.dp_item_code, qty: 1, rate: -recovery });
  }
  return items;
}

/** Load immutable claim facts from PMO and build only the lines the claim recorded. */
export async function readOdooProgressClaim(sc: SupabaseClient, orgId: string, id: string): Promise<OdooProgressClaim | null> {
  const { data, error } = await sc.from('progress_claims')
    .select('id,kind,project_id,work_order_id,currency,down_payment_amount,dp_recovery_amount,dp_item_code,withdrawn_at')
    .eq('org_id', orgId).eq('id', id).maybeSingle();
  if (error) throw new AppError('The billing claim could not be read', 'gate-check-failed');
  if (!data) return null;

  const raw = data as Record<string, unknown>;
  if (raw.id !== id || (raw.kind !== 'down_payment' && raw.kind !== 'progress')) {
    throw new AppError('The billing claim cannot be invoiced through Odoo', 'commit-rejected');
  }
  const claim = raw as unknown as ProgressClaimRecord;
  if (typeof claim.currency !== 'string' || !/^[A-Z]{3}$/.test(claim.currency)) {
    throw new AppError('The billing claim currency could not be verified', 'config-rejected');
  }

  const { data: projectData, error: projectError } = await sc.from('projects').select('client_id')
    .eq('org_id', orgId).eq('id', claim.project_id).maybeSingle();
  if (projectError) throw new AppError('The billing claim project could not be read', 'gate-check-failed');
  const customerId = (projectData as { client_id?: unknown } | null)?.client_id;
  if (typeof customerId !== 'string' || customerId === '') {
    throw new AppError('The billing claim project needs a client before it can be invoiced', 'commit-rejected');
  }

  const { data: evidence, error: evidenceError } = await sc.from('progress_claim_evidence').select('id')
    .eq('org_id', orgId).eq('claim_id', claim.id).limit(1);
  if (evidenceError) throw new AppError('The billing claim evidence could not be read', 'gate-check-failed');
  if (!Array.isArray(evidence) || evidence.length === 0) {
    throw new AppError('Attach billing evidence before raising this claim invoice', 'commit-rejected');
  }

  let lines: ProgressClaimLineRecord[] = [];
  if (claim.kind === 'progress') {
    const { data: rows, error: linesError } = await sc.from('progress_claim_lines')
      .select('item_code,description,unit,quantity,rate').eq('org_id', orgId).eq('claim_id', claim.id)
      .order('boq_item_id', { ascending: true }).limit(MAX_CLAIM_LINES + 1);
    if (linesError) throw new AppError('The billing claim lines could not be read', 'gate-check-failed');
    lines = (rows ?? []) as ProgressClaimLineRecord[];
    if (lines.length > MAX_CLAIM_LINES) throw new AppError(`A progress claim may have at most ${MAX_CLAIM_LINES} lines`, 'commit-rejected');
  }

  try {
    return { claim, customerId, items: invoiceItemsFromClaim(claim, lines) };
  } catch (error) {
    if (error instanceof AdapterError) throw new AppError(error.message, error.code);
    throw error;
  }
}
