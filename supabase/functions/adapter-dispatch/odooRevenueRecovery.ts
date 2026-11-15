import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdapterCommand } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { dispatchMoneyWrite, type DispatchMoneyWriteDeps } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { ODOO_TIER } from '../../../pmo-portal/src/lib/adapterSeam/odoo/connectAdapter.ts';
import { odooOwnsRevenueTier } from '../../../pmo-portal/src/lib/adapterSeam/odoo/ownership.ts';
import { resolveOdooRevenueMoneyOutboxDeps } from './odooRevenueOutbox.ts';
import { resolveOdooRevenueAdapter } from './odooAdapters.ts';
import { buildOdooReplayDeps, type OdooReplaySpec } from './odooReplayDeps.ts';
import type { OdooCallBudget, ReservedOdooCallBudget } from '../_shared/odooCallBudget.ts';
import { parseOdooOutboxRecoveryCandidates, reconcileOdooOutboxCandidates, type OdooOutboxRecoveryCandidate } from '../_shared/odooOutboxRecovery.ts';

export type OdooRevenueCandidate = OdooOutboxRecoveryCandidate;

export interface OdooRevenueRecoveryResult {
  reconciled: number;
  errors: Array<{ id: string; error: string }>;
}

export const ODOO_REVENUE_RECOVERY_CALL_RESERVATION = 16;

export type BuildOdooRevenueRecoveryDeps = (candidate: OdooRevenueCandidate, callBudget?: ReservedOdooCallBudget) => DispatchMoneyWriteDeps | Promise<DispatchMoneyWriteDeps>;
export type DispatchOdooRevenueRecovery = (deps: DispatchMoneyWriteDeps) => Promise<unknown>;

const isInvoiceSubmit = (candidate: OdooRevenueCandidate): boolean =>
  // The foreground user command is a transition to submit, but the Odoo money outbox persists
  // its physical create operation so one invoice is created and posted as a single fenced write.
  odooOwnsRevenueTier(candidate.externalTier) && candidate.row.domain === 'revenue' && candidate.operation === 'create'
  && candidate.payload?.erp_doc_kind === 'sales-invoice' && candidate.payload.verb === 'submit';

/** Bounded Odoo invoice recovery using the same fenced dispatcher as the foreground command. */
export function reconcileOdooRevenueCandidates(
  candidates: OdooRevenueCandidate[],
  options: { orgId: string; ownsRevenue: boolean; maxCandidates?: number; deadlineAt?: number; callBudget?: OdooCallBudget },
  buildDeps: BuildOdooRevenueRecoveryDeps,
  dispatch: DispatchOdooRevenueRecovery = dispatchMoneyWrite,
): Promise<OdooRevenueRecoveryResult> {
  const { ownsRevenue, ...rest } = options;
  return reconcileOdooOutboxCandidates(candidates, isInvoiceSubmit, ODOO_REVENUE_RECOVERY_CALL_RESERVATION, { ...rest, owns: ownsRevenue }, buildDeps, dispatch);
}

const REVENUE_REPLAY: OdooReplaySpec = {
  label: 'invoice', domain: 'revenue', ownsTier: odooOwnsRevenueTier,
  isFrozen: (stored, payload) => stored.operation === 'create' && payload.erp_doc_kind === 'sales-invoice' && payload.verb === 'submit',
  command: (_stored, payload) => ({ domain: 'revenue', operation: 'transition', record: payload as AdapterCommand['record'] }),
  resolveAdapter: resolveOdooRevenueAdapter, resolveMoney: resolveOdooRevenueMoneyOutboxDeps,
};

/** The Odoo tier's bounded invoice recovery pass; receipt recovery remains with its own slice. */
export async function reconcileOdooRevenueOutbox(
  sc: SupabaseClient,
  orgId: string,
  options: { maxCandidates?: number; timeBudgetMs?: number; callBudget?: OdooCallBudget; candidates?: OdooRevenueCandidate[] } = {},
): Promise<OdooRevenueRecoveryResult> {
  let candidates = options.candidates;
  if (!candidates) {
    const { data, error } = await sc.rpc('outbox_reconcile_candidates', { p_org_id: orgId });
    if (error) throw new AppError('Odoo invoice recovery candidates could not be read', error.code);
    candidates = parseOdooOutboxRecoveryCandidates(data);
  }
  const { data: ownership, error: ownershipError } = await sc.from('external_domain_ownership').select('id')
    .eq('org_id', orgId).eq('external_tier', ODOO_TIER).eq('domain', 'revenue').limit(1);
  if (ownershipError) throw new AppError('Odoo revenue ownership could not be checked', ownershipError.code);
  const now = Date.now();
  const recoveryBudgetMs = Math.min(options.timeBudgetMs ?? 60_000, 60_000);
  return reconcileOdooRevenueCandidates(candidates, {
    orgId, ownsRevenue: (ownership?.length ?? 0) > 0, maxCandidates: options.maxCandidates,
    deadlineAt: now + recoveryBudgetMs, callBudget: options.callBudget,
  },
    (candidate, callBudget) => buildOdooReplayDeps(sc, orgId, candidate, callBudget, REVENUE_REPLAY));
}
