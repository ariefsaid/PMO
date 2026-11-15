import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdapterCommand } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { AdapterError } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { dispatchMoneyWrite, type DispatchMoneyWriteDeps } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import { ODOO_TIER } from '../../../pmo-portal/src/lib/adapterSeam/odoo/connectAdapter.ts';
import { odooOwnsProcurementTier } from '../../../pmo-portal/src/lib/adapterSeam/odoo/ownership.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { checkOutboxReplayAuthorization } from './authGuard.ts';
import { resolveOdooMoneyOutboxDeps } from './odooMoneyOutbox.ts';
import { resolveOdooProcurementAdapter } from './odooAdapters.ts';
import { buildOdooReplayDeps } from './odooReplayDeps.ts';
import { reservedOdooCallBudget, type OdooCallBudget, type ReservedOdooCallBudget } from '../_shared/odooCallBudget.ts';
import { parseOdooOutboxRecoveryCandidates, type OdooOutboxRecoveryCandidate } from '../_shared/odooOutboxRecovery.ts';

export type OdooProcurementCandidate = OdooOutboxRecoveryCandidate;

export interface OdooProcurementRecoveryResult {
  reconciled: number;
  skipped: number;
  budgetExhausted: boolean;
  errors: Array<{ id: string; error: string }>;
}

type BuildOdooProcurementRecoveryDeps = (candidate: OdooProcurementCandidate, callBudget?: ReservedOdooCallBudget) => DispatchMoneyWriteDeps | Promise<DispatchMoneyWriteDeps>;
type DispatchOdooProcurementRecovery = (deps: DispatchMoneyWriteDeps) => Promise<unknown>;
type ReplayAuthorizer = typeof checkOutboxReplayAuthorization;
type AnchoredElsewhere = (candidate: OdooProcurementCandidate) => Promise<boolean>;
type HoldCommitted = (candidate: OdooProcurementCandidate, reason: string) => Promise<number>;

/** Stable operator-facing reason on a committed row whose Odoo document is anchored to another PMO row. */
export const COMMITTED_ANCHOR_HOLD_REASON = 'committed-anchor-owned-elsewhere: the Odoo document is anchored to another PMO record';
type RecoveryResolvers = {
  resolveAdapter?: typeof resolveOdooProcurementAdapter;
  resolveMoneyOutboxDeps?: typeof resolveOdooMoneyOutboxDeps;
};

const PROCUREMENT_COMMANDS: Readonly<Record<string, readonly string[]>> = {
  'purchase-order': ['create', 'update'],
  'goods-receipt': ['create'],
  'purchase-invoice': ['create'],
  payment: ['create'],
};

/** Worst-case recovery RPC allowance, including the probe, an attempted commit and its read-back. */
export function procurementRecoveryCallReservation(candidate: OdooProcurementCandidate): number {
  switch (candidate.payload?.erp_doc_kind) {
    case 'purchase-order': return candidate.operation === 'update' ? 16 : 14;
    case 'goods-receipt': {
      const receipt = candidate.payload.odooReceipt as { lines?: unknown } | undefined;
      const lines = Array.isArray(receipt?.lines) ? receipt.lines.length : 0;
      return 16 + lines;
    }
    case 'purchase-invoice': return 16;
    case 'payment': return 20;
    default: return 0;
  }
}

export function procurementRecoveryStartIndex(atMs: number, eligibleCount: number): number {
  if (!Number.isInteger(eligibleCount) || eligibleCount <= 0) return 0;
  return Math.floor(atMs / (5 * 60_000)) % eligibleCount;
}

function isProcurementCandidate(candidate: OdooProcurementCandidate): boolean {
  const kind = candidate.payload?.erp_doc_kind;
  return odooOwnsProcurementTier(candidate.externalTier) && candidate.row.domain === 'procurement' &&
    candidate.row.state !== 'held' && typeof kind === 'string' &&
    (PROCUREMENT_COMMANDS[kind]?.includes(candidate.operation) ?? false) &&
    (candidate.operation !== 'update' || (kind === 'purchase-order' && Number.isInteger(candidate.payload?.revision)));
}

function recoveryErrorCode(error: unknown): string {
  if (error instanceof AppError || error instanceof AdapterError) return error.code ?? 'recovery-failed';
  return 'recovery-failed';
}

function purchaseOrderFamily(pmoRecordId: string): string {
  return pmoRecordId.startsWith('porev:') ? pmoRecordId.slice('porev:'.length).split(':')[0] : pmoRecordId;
}

export async function isOdooProcurementAnchorOwnedElsewhere(
  sc: SupabaseClient,
  orgId: string,
  candidate: OdooProcurementCandidate,
  externalRecordId: string,
): Promise<boolean> {
  const { data: owners, error } = await sc.from('external_refs').select('pmo_record_id')
    .eq('org_id', orgId).eq('domain', 'procurement').eq('external_tier', ODOO_TIER)
    .eq('external_record_id', externalRecordId).limit(101);
  if (error) throw new AdapterError('external-unreachable', 'odoo-anchor-owner-unreadable');
  const list = (owners as Array<{ pmo_record_id?: string }> | null) ?? [];
  if (list.length > 100) return true;
  const payload = candidate.payload ?? {};
  const expectedFamily = typeof payload.poId === 'string' ? payload.poId : purchaseOrderFamily(candidate.row.pmoRecordId);
  return list.some((owner) => {
    if (typeof owner.pmo_record_id !== 'string') return false;
    return payload.erp_doc_kind === 'purchase-order'
      ? purchaseOrderFamily(owner.pmo_record_id) !== expectedFamily
      : owner.pmo_record_id !== candidate.row.pmoRecordId;
  });
}

export function odooProcurementAnchoredElsewhere(sc: SupabaseClient, orgId: string): AnchoredElsewhere {
  return (candidate) => candidate.row.externalRecordId
    ? isOdooProcurementAnchorOwnedElsewhere(sc, orgId, candidate, candidate.row.externalRecordId)
    : Promise.resolve(false);
}

/** The fenced committed-to-held transition (`hold_committed_outbox`, 0701): 1 = held, 0 = the row moved on. */
export function odooProcurementHoldCommitted(sc: SupabaseClient): HoldCommitted {
  return async (candidate, reason) => {
    const { data, error } = await sc.rpc('hold_committed_outbox', {
      p_id: candidate.row.id, p_generation: candidate.row.claimGeneration, p_reason: reason,
    });
    if (error) throw new AppError(error.message, error.code);
    return typeof data === 'number' ? data : Number(data ?? 0);
  };
}

/** Run the bounded, shared-dispatch recovery path for eligible Odoo procurement outbox rows. */
export async function reconcileOdooProcurementCandidates(
  candidates: OdooProcurementCandidate[],
  options: { orgId: string; ownsProcurement: boolean; maxCandidates?: number; deadlineAt?: number; callBudget?: OdooCallBudget; candidateStartIndex?: number; holdCommitted?: HoldCommitted },
  buildDeps: BuildOdooProcurementRecoveryDeps,
  anchoredElsewhere: AnchoredElsewhere,
  dispatch: DispatchOdooProcurementRecovery = dispatchMoneyWrite,
): Promise<OdooProcurementRecoveryResult> {
  const eligible = candidates.filter(isProcurementCandidate).sort((a, b) => {
    const time = Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
    return Number.isNaN(time) || time === 0 ? a.row.id.localeCompare(b.row.id) : time;
  });
  const result: OdooProcurementRecoveryResult = { reconciled: 0, skipped: 0, budgetExhausted: false, errors: [] };
  if (!options.ownsProcurement) {
    for (const candidate of eligible) result.errors.push({ id: candidate.row.id, error: 'domain-not-owned' });
    return result;
  }

  const startIndex = options.candidateStartIndex ?? procurementRecoveryStartIndex(Date.now(), eligible.length);
  const normalizedStart = eligible.length === 0 ? 0 : ((startIndex % eligible.length) + eligible.length) % eligible.length;
  const rotated = eligible.slice(normalizedStart).concat(eligible.slice(0, normalizedStart));
  const paymentIndex = rotated.findIndex((item) => item.payload?.erp_doc_kind === 'payment');
  const candidatesInOrder = paymentIndex < 0 ? rotated : [
    rotated[paymentIndex],
    ...rotated.filter((_, index) => index !== paymentIndex),
  ];
  for (const candidate of candidatesInOrder.slice(0, options.maxCandidates ?? 100)) {
    if (options.deadlineAt !== undefined && Date.now() >= options.deadlineAt) {
      result.budgetExhausted = true;
      break;
    }
    // Committed rows need only the ownership read; they do not enter an Odoo probe.
    // A foreign-anchored one is never recovered, so it is held (operator queue) instead of staying in flight.
    if (candidate.row.state === 'committed' && await anchoredElsewhere(candidate)) {
      try {
        await options.holdCommitted?.(candidate, COMMITTED_ANCHOR_HOLD_REASON);
        result.skipped += 1;
      } catch (error) {
        result.errors.push({ id: candidate.row.id, error: recoveryErrorCode(error) });
      }
      continue;
    }
    const reservation = procurementRecoveryCallReservation(candidate);
    if (options.callBudget && !(options.callBudget.canSpend?.(reservation) ?? options.callBudget.left())) {
      result.budgetExhausted = true;
      break;
    }
    const candidateBudget = options.callBudget ? reservedOdooCallBudget(reservation) : undefined;
    let built: DispatchMoneyWriteDeps;
    try {
      built = await buildDeps(candidate, candidateBudget);
      if (candidateBudget?.exhausted()) {
        const used = candidateBudget.used();
        if (used > 0 && options.callBudget && !options.callBudget.spend(used)) result.budgetExhausted = true;
        result.errors.push({ id: candidate.row.id, error: 'external-unreachable' });
        result.budgetExhausted = true;
        break;
      }
      if (options.callBudget && !options.callBudget.spend(reservation)) {
        const used = candidateBudget?.used() ?? 0;
        if (used > 0) options.callBudget.spend(used);
        result.budgetExhausted = true;
        break;
      }
    } catch (error) {
      const used = candidateBudget?.used() ?? 0;
      if (used > 0 && options.callBudget && !options.callBudget.spend(used)) result.budgetExhausted = true;
      result.errors.push({ id: candidate.row.id, error: recoveryErrorCode(error) });
      if (candidateBudget?.exhausted() || (options.callBudget && !options.callBudget.left())) result.budgetExhausted = true;
      if (result.budgetExhausted) break;
      continue;
    }
    try {
      await dispatch(built);
      result.reconciled += 1;
    } catch (error) {
      result.errors.push({ id: candidate.row.id, error: recoveryErrorCode(error) });
    } finally {
      if (options.callBudget && candidateBudget) {
        const used = candidateBudget.used();
        if (used < reservation) options.callBudget.refund?.(reservation - used);
        else if (used > reservation) options.callBudget.spend(used - reservation);
        if (candidateBudget.exhausted() || !options.callBudget.left()) result.budgetExhausted = true;
      }
    }
    if (result.budgetExhausted) break;
  }
  return result;
}

function commandOperation(operation: string, payload: Record<string, unknown>): AdapterCommand['operation'] {
  // The outbox stores `update`; the original PMO command and its recovery probe are `revise`.
  if (operation === 'update' && payload.erp_doc_kind === 'purchase-order' && Number.isInteger(payload.revision)) return 'revise' as never;
  return operation as AdapterCommand['operation'];
}

/** Rebuild one frozen outbox command from its recorded actor and persisted payload. */
export async function buildOdooProcurementRecoveryDeps(
  sc: SupabaseClient,
  orgId: string,
  candidate: OdooProcurementCandidate,
  callBudget?: ReservedOdooCallBudget,
  authorizeReplay: ReplayAuthorizer = checkOutboxReplayAuthorization,
  resolvers: RecoveryResolvers = {},
): Promise<DispatchMoneyWriteDeps> {
  return buildOdooReplayDeps(sc, orgId, candidate, callBudget, {
    label: 'procurement', domain: 'procurement', ownsTier: odooOwnsProcurementTier,
    isFrozen: (stored, payload) => stored.operation === candidate.operation
      && isProcurementCandidate({ ...candidate, externalTier: stored.external_tier, payload }),
    command: (stored, payload) => ({
      domain: 'procurement', operation: commandOperation(stored.operation, payload), record: payload as AdapterCommand['record'],
    }),
    resolveAdapter: resolvers.resolveAdapter ?? resolveOdooProcurementAdapter,
    resolveMoney: resolvers.resolveMoneyOutboxDeps ?? resolveOdooMoneyOutboxDeps,
    extraContext: () => ({
      odooAnchorOwnedElsewhere: (externalRecordId: string) => isOdooProcurementAnchorOwnedElsewhere(sc, orgId, candidate, externalRecordId),
    }),
    authorizeReplay,
  });
}

/** The Odoo tier's bounded procurement recovery pass; it uses the same candidate RPC and fenced dispatcher as revenue recovery. */
export async function reconcileOdooProcurementOutbox(
  sc: SupabaseClient,
  orgId: string,
  options: { maxCandidates?: number; timeBudgetMs?: number; callBudget?: OdooCallBudget; candidates?: OdooProcurementCandidate[] } = {},
): Promise<OdooProcurementRecoveryResult> {
  let candidates = options.candidates;
  if (!candidates) {
    const { data, error } = await sc.rpc('outbox_reconcile_candidates', { p_org_id: orgId });
    if (error) throw new AppError('Odoo procurement recovery candidates could not be read', error.code);
    candidates = parseOdooOutboxRecoveryCandidates(data);
  }
  const { data: ownership, error: ownershipError } = await sc.from('external_domain_ownership').select('id')
    .eq('org_id', orgId).eq('external_tier', ODOO_TIER).eq('domain', 'procurement').limit(1);
  if (ownershipError) throw new AppError('Odoo procurement ownership could not be checked', ownershipError.code);
  const now = Date.now();
  const recoveryBudgetMs = Math.min(options.timeBudgetMs ?? 60_000, 60_000);
  return reconcileOdooProcurementCandidates(candidates, {
    orgId, ownsProcurement: (ownership?.length ?? 0) > 0, maxCandidates: options.maxCandidates,
    deadlineAt: now + recoveryBudgetMs, callBudget: options.callBudget, holdCommitted: odooProcurementHoldCommitted(sc),
  },
    (candidate, callBudget) => buildOdooProcurementRecoveryDeps(sc, orgId, candidate, callBudget),
    odooProcurementAnchoredElsewhere(sc, orgId));
}
