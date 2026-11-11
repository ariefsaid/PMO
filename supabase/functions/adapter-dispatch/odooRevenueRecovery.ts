import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdapterCommand, PmoRecord } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { dispatchMoneyWrite, type DispatchMoneyWriteDeps, type OutboxRow } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import { recordExternalRef as recordExternalRefWrite } from '../../../pmo-portal/src/lib/adapterSeam/refs.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { ODOO_TIER } from '../../../pmo-portal/src/lib/adapterSeam/odoo/connectAdapter.ts';
import { odooOwnsRevenueTier } from '../../../pmo-portal/src/lib/adapterSeam/odoo/ownership.ts';
import { assertNotPreCutover } from '../../../pmo-portal/src/lib/adapterSeam/cutoverGate.ts';
import { replayMayIssueErpWrite, checkOutboxReplayAuthorization } from './authGuard.ts';
import { getReadModelWriter } from './readModelWriters.ts';
import { resolveOdooRevenueMoneyOutboxDeps } from './odooRevenueOutbox.ts';
import { resolveOdooRevenueAdapter } from './odooAdapters.ts';
import type { AdapterSelectContext } from './dispatchAdapters.ts';
import { reservedOdooCallBudget, type OdooCallBudget, type ReservedOdooCallBudget } from '../_shared/odooCallBudget.ts';
import { parseOdooOutboxRecoveryCandidates, type OdooOutboxRecoveryCandidate } from '../_shared/odooOutboxRecovery.ts';

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
export async function reconcileOdooRevenueCandidates(
  candidates: OdooRevenueCandidate[],
  options: { orgId: string; ownsRevenue: boolean; maxCandidates?: number; deadlineAt?: number; callBudget?: OdooCallBudget },
  buildDeps: BuildOdooRevenueRecoveryDeps,
  dispatch: DispatchOdooRevenueRecovery = dispatchMoneyWrite,
): Promise<OdooRevenueRecoveryResult> {
  const eligible = candidates.filter(isInvoiceSubmit).sort((a, b) => {
    const time = Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
    return Number.isNaN(time) || time === 0 ? a.row.id.localeCompare(b.row.id) : time;
  });
  const errors: OdooRevenueRecoveryResult['errors'] = [];
  if (!options.ownsRevenue) {
    for (const candidate of eligible) errors.push({ id: candidate.row.id, error: 'domain-not-owned' });
    return { reconciled: 0, errors };
  }

  let reconciled = 0;
  for (const candidate of eligible.slice(0, options.maxCandidates ?? 100)) {
    if (options.deadlineAt !== undefined && Date.now() >= options.deadlineAt) break;
    if (options.callBudget && !(options.callBudget.canSpend?.(ODOO_REVENUE_RECOVERY_CALL_RESERVATION) ?? options.callBudget.left())) break;
    const candidateBudget = options.callBudget ? reservedOdooCallBudget(ODOO_REVENUE_RECOVERY_CALL_RESERVATION) : undefined;
    let built: DispatchMoneyWriteDeps;
    try {
      built = await buildDeps(candidate, candidateBudget);
      if (candidateBudget?.exhausted()) {
        const used = candidateBudget.used();
        if (used > 0) options.callBudget?.spend(used);
        errors.push({ id: candidate.row.id, error: 'external-unreachable' });
        break;
      }
      if (options.callBudget && !options.callBudget.spend(ODOO_REVENUE_RECOVERY_CALL_RESERVATION)) {
        const used = candidateBudget?.used() ?? 0;
        if (used > 0) options.callBudget.spend(used);
        break;
      }
    } catch (error) {
      const used = candidateBudget?.used() ?? 0;
      if (used > 0) options.callBudget?.spend(used);
      errors.push({ id: candidate.row.id, error: error instanceof Error ? error.message : String(error) });
      if (candidateBudget?.exhausted() || (options.callBudget && !options.callBudget.left())) break;
      continue;
    }
    let stopAfterDispatch = false;
    try {
      await dispatch(built);
      reconciled += 1;
    } catch (error) {
      errors.push({ id: candidate.row.id, error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (options.callBudget && candidateBudget) {
        const used = candidateBudget.used();
        if (used < ODOO_REVENUE_RECOVERY_CALL_RESERVATION) options.callBudget.refund?.(ODOO_REVENUE_RECOVERY_CALL_RESERVATION - used);
        else if (used > ODOO_REVENUE_RECOVERY_CALL_RESERVATION) options.callBudget.spend(used - ODOO_REVENUE_RECOVERY_CALL_RESERVATION);
        stopAfterDispatch = candidateBudget.exhausted() || !options.callBudget.left();
      }
    }
    if (stopAfterDispatch) break;
  }
  return { reconciled, errors };
}

async function buildOdooRevenueRecoveryDeps(
  sc: SupabaseClient,
  orgId: string,
  candidate: OdooRevenueCandidate,
  callBudget?: ReservedOdooCallBudget,
): Promise<DispatchMoneyWriteDeps> {
  const { data, error } = await sc.from('external_command_outbox')
    .select('external_tier,domain,pmo_record_id,operation,state,payload,actor_user_id')
    .eq('org_id', orgId).eq('id', candidate.row.id).maybeSingle();
  if (error || !data) throw new AppError('Odoo invoice recovery row could not be read', error?.code ?? 'not-found');
  const stored = data as {
    external_tier: string; domain: string; pmo_record_id: string; operation: string; state: OutboxRow['state'];
    payload: Record<string, unknown> | null; actor_user_id: string | null;
  };
  const payload = stored.payload ?? {};
  if (!odooOwnsRevenueTier(stored.external_tier) || stored.domain !== 'revenue' || stored.pmo_record_id !== candidate.row.pmoRecordId
      || stored.operation !== 'create' || payload.erp_doc_kind !== 'sales-invoice' || payload.verb !== 'submit') {
    throw new AppError('Odoo invoice recovery row no longer matches its frozen command', 'commit-rejected');
  }
  const command: AdapterCommand = {
    domain: 'revenue', operation: 'transition', record: payload as AdapterCommand['record'], idempotencyKey: candidate.row.idempotencyKey,
  };
  const replayAuth = await checkOutboxReplayAuthorization(sc as never, orgId, {
    id: candidate.row.id, state: stored.state, domain: command.domain, operation: command.operation,
    pmoRecordId: candidate.row.pmoRecordId, actorUserId: stored.actor_user_id, payload, tier: ODOO_TIER,
  });
  if (!replayAuth.ok) throw new AppError(replayAuth.message, 'commit-rejected');
  if (replayMayIssueErpWrite(stored.state)) await assertNotPreCutover(sc as never, { domain: command.domain, record: payload });

  const context: AdapterSelectContext = {
    orgId, command, serviceClient: sc, userId: stored.actor_user_id ?? '', replay: true, erpAuth: new Map(),
    faultGate: { envFaults: undefined, header: null, requestHost: null, allowedHosts: undefined },
    ...(callBudget ? { odooCallBudget: callBudget } : {}),
  };
  const adapter = await resolveOdooRevenueAdapter(context);
  const money = await resolveOdooRevenueMoneyOutboxDeps(context);
  const writer = getReadModelWriter(command.domain);
  const writeReadModel = (canonical: PmoRecord, options?: { isReplay?: boolean }) => writer.upsert({
    serviceClient: sc as never, orgId, callerUserId: stored.actor_user_id ?? undefined, isReplay: options?.isReplay ?? true,
  }, canonical, command);
  const recordExternalRef = (mapping: Parameters<DispatchMoneyWriteDeps['recordExternalRef']>[0]) =>
    recordExternalRefWrite(sc as never, { ...mapping, orgId, externalTier: ODOO_TIER });
  return { adapter, command, money, writeReadModel, recordExternalRef, outboxRecordId: candidate.row.pmoRecordId };
}

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
    (candidate, callBudget) => buildOdooRevenueRecoveryDeps(sc, orgId, candidate, callBudget));
}
