import { formatExactCents, parseExactCents } from './exactDecimal';

/**
 * Quantity change request rules (#2578, docs/specs/quantity-change-requests.spec.md). Pure functions that MIRROR
 * the database (migrations 1126..1128): the server decides, these let a screen explain what it will decide and show
 * exact money. Quantities are decimals with at most 3 places; money is exact (bigint cents, never floats; NFR-QCR-001).
 */
export type ProgressSource = 'assessment' | 'acceptance' | 'claim' | 'daily_report';
export type TriggerKind = 'progress' | 'forecast';

export interface ProgressSources { assessment: number; acceptance: number; claim: number; daily_report: number }

/** Source order breaks ties exactly as qcr_figures does (assessment, acceptance, claim, daily report). */
const SOURCE_ORDER: ProgressSource[] = ['assessment', 'acceptance', 'claim', 'daily_report'];

/** P: the greatest of the four shipped sources, naming the winner; none when nothing has been reported. */
export function reportedProgress(sources: ProgressSources): { quantity: number; source: ProgressSource | null } {
  let best: { quantity: number; source: ProgressSource | null } = { quantity: 0, source: null };
  for (const source of SOURCE_ORDER) {
    if (sources[source] > best.quantity) best = { quantity: sources[source], source };
  }
  return best;
}

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

/** quantity x rate in cents, rounded half-up once (the claim-line rule, 0250). Both inputs are non-negative decimals. */
export function lineValueCents(quantity: string | number, rate: string | number): bigint | null {
  const q = scale(quantity);
  const r = scale(rate);
  if (!q || !r) return null;
  const product = q.units * r.units;
  const places = q.places + r.places;
  if (places <= 2) return product * 10n ** BigInt(2 - places);
  const divisor = 10n ** BigInt(places - 2);
  return (product * 2n + divisor) / (divisor * 2n);
}

function scale(value: string | number): { units: bigint; places: number } | null {
  const text = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : value.trim();
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) return null;
  const fraction = m[2] ?? '';
  return { units: BigInt(m[1] + fraction), places: fraction.length };
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

/** Sum of exact decimal money strings ("5000000.00"), in cents. Invalid entries are skipped. */
export function sumMoney(values: (string | null)[]): string {
  let total = 0n;
  for (const v of values) {
    const cents = v === null ? null : parseExactCents(v);
    if (cents !== null) total += cents;
  }
  return formatExactCents(total);
}

// ── the state machine (what the screen may offer; the functions are the authority) ───────────────────
export type RequestStatus =
  | 'draft' | 'pending_approval' | 'returned' | 'approved' | 'sent_to_client' | 'client_accepted' | 'client_declined' | 'withdrawn';

export const OPEN_STATUSES: RequestStatus[] = ['draft', 'pending_approval', 'returned', 'approved', 'sent_to_client'];
export const TERMINAL_STATUSES: RequestStatus[] = ['client_accepted', 'client_declined', 'withdrawn'];
export const APPROVER_ROLES = ['Admin', 'Executive', 'Finance'] as const;
export const AUTHOR_ROLES = ['Admin', 'Executive', 'Project Manager', 'Finance'] as const;

export interface ApprovalBlock { reason: 'role' | 'author' | 'editor' | 'submitter' | 'status' | null }

/**
 * FR-QCR-011: may this person approve? Role first, then the people the request is separated from — its author, EVERY
 * editor (the whole set, not the last one) and whoever submitted it. Mirrors qcr_assert_approver / qcr_approval_state.
 */
export function approvalBlock(input: {
  role: string | null; userId: string | null; status: RequestStatus;
  authorId: string; editorIds: string[]; submittedBy: string | null;
}): ApprovalBlock {
  if (!input.role || !(APPROVER_ROLES as readonly string[]).includes(input.role)) return { reason: 'role' };
  if (input.userId === input.authorId) return { reason: 'author' };
  if (input.userId && input.editorIds.includes(input.userId)) return { reason: 'editor' };
  if (input.userId && input.userId === input.submittedBy) return { reason: 'submitter' };
  if (input.status !== 'pending_approval') return { reason: 'status' };
  return { reason: null };
}

/** The requests that count toward the work order's limit: all but a draft withdrawn before it was ever submitted. */
export function countsTowardLimit(r: { status: RequestStatus; withdrawn_from: string | null; first_submitted_at: string | null }): boolean {
  return !(r.status === 'withdrawn' && r.withdrawn_from === 'draft' && r.first_submitted_at === null);
}

export function limitReached(count: number, limit: number | null): boolean {
  return limit !== null && count >= limit;
}
