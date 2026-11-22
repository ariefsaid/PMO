import { formatExactCents, mulRound } from './exactDecimal';

/**
 * Quantity change request rules (#2578, docs/specs/quantity-change-requests.spec.md). Pure functions that MIRROR
 * the database (migrations 1126..1128): the server decides, these let a screen explain what it will decide and show
 * exact money. Quantities are decimals with at most 3 places; money is exact (bigint cents, never floats; NFR-QCR-001).
 * Every exported rule here has a screen reader; the approval-block, limit-count and greatest-source decisions are
 * the server's (qcr_*) and are read from its answers, not restated here (#2753).
 */
export type ProgressSource = 'assessment' | 'acceptance' | 'claim' | 'daily_report';
export type TriggerKind = 'progress' | 'forecast';

/** Over-contract is strictly greater (equal is not over); a lump-sum line can never be over in quantity. */
export function overContract(input: {
  contract: number; progress: number; forecast: number | null; earningBasis: 'unit_rate' | 'lump_sum';
}): { over: boolean; kind: TriggerKind | null; figure: number | null } {
  if (input.earningBasis === 'lump_sum') return { over: false, kind: null, figure: null };
  if (input.progress > input.contract) return { over: true, kind: 'progress', figure: input.progress };
  if (input.forecast !== null && input.forecast > input.contract) return { over: true, kind: 'forecast', figure: input.forecast };
  return { over: false, kind: null, figure: null };
}

export type RequestedQuantityError = 'invalid' | 'not_above_contract' | 'below_trigger';

/** R must be positive with at most 3 decimals, above C and not below the trigger figure (FR-QCR-005). */
export function validateRequestedQuantity(requested: string, contract: number, triggerFigure: number): RequestedQuantityError | null {
  const text = requested.trim();
  if (!/^\d+(\.\d{1,3})?$/.test(text)) return 'invalid';
  const value = Number(text);
  if (!(value > 0) || !Number.isFinite(value)) return 'invalid';
  if (value <= contract) return 'not_above_contract';
  if (value < triggerFigure) return 'below_trigger';
  return null;
}

/** quantity x rate in cents, rounded once, half away from zero — the exact-decimal rule every figure shares (claim-line rule, 0250). Both inputs are non-negative decimals. */
export function lineValueCents(quantity: string | number, rate: string | number): bigint | null {
  const q = nonNegativeDecimal(quantity);
  const r = nonNegativeDecimal(rate);
  return q === null || r === null ? null : mulRound(q, r, 2);
}

/** The claim-line grammar: a non-negative decimal, trimmed; null otherwise. */
function nonNegativeDecimal(value: string | number): string | null {
  const text = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : value.trim();
  return /^(\d+)(?:\.(\d+))?$/.test(text) ? text : null;
}

export interface QuantityVersion {
  version_no: number;
  quantity: number | string;
  source: 'baseline' | 'setup_edit' | 'change_request';
  request_id: string | null;
  created_by: string | null;
  created_at: string;
}
export interface QuantityVersionRow extends QuantityVersion {
  valueCents: bigint | null;
  /** This version's value minus the previous version's value (null for the baseline). */
  changeCents: bigint | null;
  value: string | null;
  change: string | null;
}

/**
 * FR-QCR-020 / AC-QCR-023: each version's value at the item's rate and the change against the previous version. Each
 * value is rounded once, and a change is the difference of two rounded values, so the changes always add up to the
 * current value minus the baseline value.
 */
export function versionValueChanges(versions: QuantityVersion[], rate: string | number): QuantityVersionRow[] {
  const ordered = [...versions].sort((a, b) => a.version_no - b.version_no);
  let previous: bigint | null = null;
  return ordered.map((v) => {
    const valueCents = lineValueCents(v.quantity, rate);
    const changeCents = valueCents !== null && previous !== null ? valueCents - previous : null;
    if (valueCents !== null) previous = valueCents;
    return {
      ...v,
      valueCents,
      changeCents,
      value: valueCents === null ? null : formatExactCents(valueCents),
      change: changeCents === null ? null : formatExactCents(changeCents),
    };
  });
}

// ── the state machine (what the screen may offer; the functions are the authority) ───────────────────
export type RequestStatus =
  | 'draft' | 'pending_approval' | 'returned' | 'approved' | 'sent_to_client' | 'client_accepted' | 'client_declined' | 'withdrawn';

export const OPEN_STATUSES: RequestStatus[] = ['draft', 'pending_approval', 'returned', 'approved', 'sent_to_client'];
export const TERMINAL_STATUSES: RequestStatus[] = ['client_accepted', 'client_declined', 'withdrawn'];

export function limitReached(count: number, limit: number | null): boolean {
  return limit !== null && count >= limit;
}
