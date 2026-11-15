/**
 * The sweep's recovery of connected stock commands (#1508, AC-OSP-004): the same bounded loop as revenue (`reconcileOdooOutboxCandidates`)
 * with the stock filter, and deps from the shared replay builder (`buildOdooReplayDeps`): the row's frozen payload and STORED actor,
 * behind the same authorization the live route runs.
 *
 * The sweep settles what a keeper started: a stale `committing` row is quarantined, a quarantined row's anchor is probed (adopt or
 * hold), a `committed` row is finalized. It never picks a `failed` or `held` row: a refused post waits for the keeper to press Post
 * again (it would otherwise move goods in Odoo days later with nobody pressing anything), and a hold waits for an Admin.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdapterCommand } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { dispatchMoneyWrite, type OutboxRow } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { ODOO_TIER } from '../../../pmo-portal/src/lib/adapterSeam/odoo/connectAdapter.ts';
import { odooOwnsStockTier } from '../../../pmo-portal/src/lib/adapterSeam/odoo/ownership.ts';
import { INVENTORY_DOMAIN } from '../../../pmo-portal/src/lib/adapterSeam/odoo/stock/stockAdapter.ts';
import { recordStockHold, resolveOdooStockAdapter, resolveOdooStockMoneyOutboxDeps, STOCK_DOC_KIND } from './odooStock.ts';
import { buildOdooReplayDeps, type OdooReplaySpec } from './odooReplayDeps.ts';
import type { OdooCallBudget } from '../_shared/odooCallBudget.ts';
import {
  parseOdooOutboxRecoveryCandidates, reconcileOdooOutboxCandidates, type OdooOutboxRecoveryCandidate, type OdooRecoveryResult,
} from '../_shared/odooOutboxRecovery.ts';

/** Odoo calls one stock candidate may use: the intent's reads, the anchor lookup, the move lookup and writes, and two read-backs. */
export const ODOO_STOCK_RECOVERY_CALL_RESERVATION = 40;

/** The states the sweep may drive: the F1 safety transitions and finalize. `failed` and `held` wait for a person; `confirmed` is done. */
const SWEEP_STATES: readonly OutboxRow['state'][] = ['pending', 'committing', 'quarantined', 'committed'];

export const isStockCommand = (candidate: OdooOutboxRecoveryCandidate): boolean =>
  odooOwnsStockTier(candidate.externalTier) && candidate.row.domain === INVENTORY_DOMAIN && candidate.operation === 'create'
  && candidate.payload?.erp_doc_kind === STOCK_DOC_KIND && SWEEP_STATES.includes(candidate.row.state);

const STOCK_REPLAY: OdooReplaySpec = {
  label: 'stock', domain: INVENTORY_DOMAIN, ownsTier: odooOwnsStockTier,
  isFrozen: (stored, payload) => stored.operation === 'create' && payload.erp_doc_kind === STOCK_DOC_KIND
    && payload.stockDocumentId === stored.pmo_record_id && Number.isInteger(payload.documentRevision) && SWEEP_STATES.includes(stored.state),
  command: (stored, payload) => ({
    domain: INVENTORY_DOMAIN, operation: 'create',
    record: { id: stored.pmo_record_id, revision: payload.documentRevision, erp_doc_kind: STOCK_DOC_KIND } as AdapterCommand['record'],
  }),
  resolveAdapter: resolveOdooStockAdapter, resolveMoney: resolveOdooStockMoneyOutboxDeps,
};

/** The Odoo tier's bounded stock recovery pass. */
export async function reconcileOdooStockOutbox(
  sc: SupabaseClient,
  orgId: string,
  options: { maxCandidates?: number; timeBudgetMs?: number; callBudget?: OdooCallBudget; candidates?: OdooOutboxRecoveryCandidate[]; owns: boolean },
): Promise<OdooRecoveryResult> {
  let candidates = options.candidates;
  if (!candidates) {
    const { data, error } = await sc.rpc('outbox_reconcile_candidates', { p_org_id: orgId });
    if (error) throw new AppError('Odoo stock recovery candidates could not be read', error.code);
    candidates = parseOdooOutboxRecoveryCandidates(data);
  }
  const recoveryBudgetMs = Math.min(options.timeBudgetMs ?? 60_000, 60_000);
  return reconcileOdooOutboxCandidates(candidates, isStockCommand, ODOO_STOCK_RECOVERY_CALL_RESERVATION, {
    orgId, owns: options.owns, maxCandidates: options.maxCandidates, deadlineAt: Date.now() + recoveryBudgetMs, callBudget: options.callBudget,
  }, (candidate, callBudget) => buildOdooReplayDeps(sc, orgId, candidate, callBudget, STOCK_REPLAY),
  // A hold the sweep produces shows its reason on the document, as a hold from the live route does.
  async (deps) => {
    try { return await dispatchMoneyWrite(deps); } catch (err) {
      if (err instanceof AppError) await recordStockHold(sc, orgId, deps.command as never, err);
      throw err;
    }
  });
}

/** Does the org employ inventory under Odoo? Only then does the sweep drive stock rows. */
export async function stockRecoveryEmployed(sc: SupabaseClient, orgId: string): Promise<boolean> {
  const { data, error } = await sc.from('external_domain_ownership').select('id')
    .eq('org_id', orgId).eq('external_tier', ODOO_TIER).eq('domain', INVENTORY_DOMAIN).limit(1);
  if (error) throw new Error('could not read Odoo inventory ownership');
  return (data?.length ?? 0) > 0;
}
