import type { SupabaseClient } from '@supabase/supabase-js';
import { AdapterError } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { progressClaimItems, type ProgressClaimLineRecord, type ProgressClaimRecord } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/progressClaimItems.ts';

const MAX_CLAIM_LINES = 500;

export interface OdooProgressClaim {
  claim: ProgressClaimRecord;
  customerId: string;
  items: OdooProgressClaimItem[];
  timeMaterials: boolean;
}

export type OdooProgressClaimItem = ReturnType<typeof progressClaimItems>[number] & { amount: number; unit?: string };

interface TimeMaterialsLine {
  line_key: string;
  rate_version: number;
  kind: string;
  basis: 'work' | 'standby';
  label: string;
  unit: string;
  units: number | string;
  rate: number | string;
  amount: number | string;
}

interface TimeMaterialsState {
  status: string;
  confirmed_by: string | null;
  gross_amount: number | string;
}

const amountInMinorUnits = (value: unknown): bigint => {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new AppError('The signed time-and-materials claim amount is invalid', 'commit-rejected');
  return BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
};

const amountNumber = (value: number | string): number => {
  const text = typeof value === 'number' || typeof value === 'string' ? String(value) : '';
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new AppError('The signed time-and-materials claim line is invalid', 'commit-rejected');
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new AppError('The signed time-and-materials claim line is invalid', 'commit-rejected');
  return amount;
};

function invoiceItemsFromClaim(claim: ProgressClaimRecord, lines: readonly ProgressClaimLineRecord[]): OdooProgressClaimItem[] {
  if (claim.kind === 'down_payment') return progressClaimItems(claim).map((line) => ({ ...line, amount: Number(line.rate) }));
  if (claim.withdrawn_at) {
    throw new AdapterError('commit-rejected', 'This progress claim was withdrawn, so no invoice can be raised for it');
  }
  if (lines.length === 0) throw new AdapterError('commit-rejected', 'This progress claim has no quantity lines');

  const items: OdooProgressClaimItem[] = lines.map((line) => ({
    item_code: line.item_code,
    qty: Number(line.quantity),
    rate: Number(line.rate),
    description: `${line.description} (${line.unit})`,
    amount: Number(line.amount),
    unit: line.unit,
  }));
  const recovery = Number(claim.dp_recovery_amount);
  if (recovery > 0) {
    if (!claim.dp_item_code) {
      throw new AdapterError('commit-rejected', 'This progress claim recovers a down payment but names no down payment item');
    }
    items.push({ item_code: claim.dp_item_code, qty: 1, rate: -recovery, amount: -recovery });
  }
  return items;
}

/** Load immutable claim facts from PMO and build only the lines the claim recorded. */
export async function readOdooProgressClaim(sc: SupabaseClient, orgId: string, id: string): Promise<OdooProgressClaim | null> {
  const { data, error } = await sc.from('progress_claims')
    .select('id,kind,project_id,work_order_id,currency,gross_amount,down_payment_amount,dp_recovery_amount,dp_item_code,withdrawn_at')
    .eq('org_id', orgId).eq('id', id).maybeSingle();
  if (error) throw new AppError('The billing claim could not be read', 'gate-check-failed');
  if (!data) {
    // A T&M claim may exist before its sign-off projection; never let its caller-authored lines fall through as an ordinary invoice.
    const { data: tmData, error: tmError } = await sc.from('tm_claims').select('status,confirmed_by,gross_amount')
      .eq('org_id', orgId).eq('id', id).maybeSingle();
    if (tmError) throw new AppError('The time-and-materials sign-off could not be read', 'gate-check-failed');
    if (!tmData) return null;
    const tmClaim = tmData as TimeMaterialsState;
    if (tmClaim.status === 'Withdrawn') throw new AppError('This time-and-materials claim was withdrawn, so no invoice can be raised for it', 'commit-rejected');
    if (tmClaim.status !== 'SignedOff' || !tmClaim.confirmed_by) {
      throw new AppError('Confirm the time-and-materials claim before raising its invoice', 'commit-rejected');
    }
    throw new AppError('The signed time-and-materials claim is unavailable', 'commit-rejected');
  }

  const raw = data as Record<string, unknown>;
  const timeMaterials = raw.kind === 'time_materials';
  if (raw.id !== id || (!timeMaterials && raw.kind !== 'down_payment' && raw.kind !== 'progress')) {
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
      .select('item_code,description,unit,quantity,rate,amount').eq('org_id', orgId).eq('claim_id', claim.id)
      .order('boq_item_id', { ascending: true }).limit(MAX_CLAIM_LINES + 1);
    if (linesError) throw new AppError('The billing claim lines could not be read', 'gate-check-failed');
    lines = (rows ?? []) as ProgressClaimLineRecord[];
    if (lines.length > MAX_CLAIM_LINES) throw new AppError(`A progress claim may have at most ${MAX_CLAIM_LINES} lines`, 'commit-rejected');
  }

  let items: OdooProgressClaimItem[];
  if (timeMaterials) {
    if (claim.withdrawn_at) throw new AppError('This time-and-materials claim was withdrawn, so no invoice can be raised for it', 'commit-rejected');
    const { data: tmData, error: tmError } = await sc.from('tm_claims').select('status,confirmed_by,gross_amount')
      .eq('org_id', orgId).eq('id', claim.id).maybeSingle();
    if (tmError) throw new AppError('The time-and-materials sign-off could not be read', 'gate-check-failed');
    if (!tmData) throw new AppError('This time-and-materials claim is unavailable', 'commit-rejected');
    const tmClaim = tmData as TimeMaterialsState;
    if (tmClaim.status === 'Withdrawn') throw new AppError('This time-and-materials claim was withdrawn, so no invoice can be raised for it', 'commit-rejected');
    if (tmClaim.status !== 'SignedOff' || !tmClaim.confirmed_by) {
      throw new AppError('Confirm the time-and-materials claim before raising its invoice', 'commit-rejected');
    }

    const { data: tmRows, error: tmLinesError } = await sc.from('tm_claim_lines')
      .select('line_key,rate_version,kind,basis,label,unit,units,rate,amount').eq('org_id', orgId).eq('claim_id', claim.id)
      .order('line_key', { ascending: true }).order('rate_version', { ascending: true }).order('basis', { ascending: true }).limit(MAX_CLAIM_LINES + 1);
    if (tmLinesError) throw new AppError('The signed time-and-materials lines could not be read', 'gate-check-failed');
    const tmLines = (tmRows ?? []) as TimeMaterialsLine[];
    if (tmLines.length > MAX_CLAIM_LINES) throw new AppError(`A time-and-materials claim may have at most ${MAX_CLAIM_LINES} lines`, 'commit-rejected');
    if (tmLines.length === 0) throw new AppError('This time-and-materials claim has no quantity lines', 'commit-rejected');

    const gross = amountInMinorUnits(raw.gross_amount);
    const tmGross = amountInMinorUnits(tmClaim.gross_amount);
    let linesGross = 0n;
    items = tmLines.map((line) => {
      const label = typeof line.label === 'string' && line.label.trim() ? line.label.trim() : null;
      const unit = line.unit === 'hour' || line.unit === 'day' ? line.unit : null;
      const quantity = amountNumber(line.units);
      const rate = amountNumber(line.rate);
      const amount = amountNumber(line.amount);
      if (!label || !unit || !['labour', 'equipment'].includes(line.kind) || !['work', 'standby'].includes(line.basis)
        || (line.basis === 'standby' && line.kind !== 'equipment') || quantity <= 0 || rate < 0 || amount < 0) {
        throw new AppError('The signed time-and-materials claim line is invalid', 'commit-rejected');
      }
      linesGross += amountInMinorUnits(line.amount);
      const basisLabel = line.basis === 'standby' ? `${label} (${claim.currency === 'IDR' ? 'siaga' : 'standby'})` : label;
      return { item_code: label, description: `${basisLabel} (${unit})`, qty: quantity, rate, amount, unit };
    });
    if (linesGross !== gross || linesGross !== tmGross) {
      throw new AppError('The signed time-and-materials claim header does not match its line amounts', 'commit-rejected');
    }
  } else {
    try {
      items = invoiceItemsFromClaim(claim, lines);
    } catch (error) {
      if (error instanceof AdapterError) throw new AppError(error.message, error.code);
      throw error;
    }
  }
  return { claim, customerId, items, timeMaterials };
}
