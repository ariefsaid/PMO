import type { PmoRecord } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { dispatchMoneyWrite, type DispatchMoneyWriteDeps, type OutboxRow } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import { reservedOdooCallBudget, type OdooCallBudget, type ReservedOdooCallBudget } from './odooCallBudget.ts';

/** One typed row read from outbox_reconcile_candidates and shared by this tick's Odoo recovery passes. */
export interface OdooOutboxRecoveryCandidate {
  row: OutboxRow;
  externalTier: string;
  operation: string;
  payload: Record<string, unknown> | null;
  updatedAt: string;
}

export function parseOdooOutboxRecoveryCandidates(data: unknown): OdooOutboxRecoveryCandidate[] {
  return ((data as Array<Record<string, unknown>> | null) ?? []).map((raw) => ({
    row: {
      id: String(raw.id), domain: String(raw.domain), pmoRecordId: String(raw.pmo_record_id), idempotencyKey: String(raw.idempotency_key),
      state: raw.state as OutboxRow['state'], externalRecordId: (raw.external_record_id as string | null) ?? null,
      canonical: (raw.canonical as PmoRecord | null) ?? null, claimGeneration: Number(raw.claim_generation ?? 0),
      payloadDigest: (raw.payload_digest as string | null) ?? null,
    },
    externalTier: String(raw.external_tier), operation: String(raw.operation),
    payload: (raw.payload as Record<string, unknown> | null) ?? null, updatedAt: String(raw.updated_at ?? ''),
  }));
}

export interface OdooRecoveryResult {
  reconciled: number;
  errors: Array<{ id: string; error: string }>;
}

export type BuildOdooRecoveryDeps = (candidate: OdooOutboxRecoveryCandidate, callBudget?: ReservedOdooCallBudget) => DispatchMoneyWriteDeps | Promise<DispatchMoneyWriteDeps>;
export type DispatchOdooRecovery = (deps: DispatchMoneyWriteDeps) => Promise<unknown>;

/**
 * The bounded Odoo recovery loop every domain shares: the candidates `filter` admits, oldest first, each driven through the same fenced
 * dispatcher as the foreground command, one error never ending the pass. `reservation` is the Odoo calls one candidate may need
 * (probe, commit, read-back): a tick that cannot reserve it does not start the candidate, and unused calls are refunded after it.
 * `owns` is whether the org employs the domain under Odoo; an unowned domain dispatches nothing.
 */
export async function reconcileOdooOutboxCandidates(
  candidates: OdooOutboxRecoveryCandidate[],
  filter: (candidate: OdooOutboxRecoveryCandidate) => boolean,
  reservation: number,
  options: { orgId: string; owns: boolean; maxCandidates?: number; deadlineAt?: number; callBudget?: OdooCallBudget },
  buildDeps: BuildOdooRecoveryDeps,
  dispatch: DispatchOdooRecovery = dispatchMoneyWrite,
): Promise<OdooRecoveryResult> {
  const eligible = candidates.filter(filter).sort((a, b) => {
    const time = Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
    return Number.isNaN(time) || time === 0 ? a.row.id.localeCompare(b.row.id) : time;
  });
  const errors: OdooRecoveryResult['errors'] = [];
  if (!options.owns) {
    for (const candidate of eligible) errors.push({ id: candidate.row.id, error: 'domain-not-owned' });
    return { reconciled: 0, errors };
  }

  let reconciled = 0;
  for (const candidate of eligible.slice(0, options.maxCandidates ?? 100)) {
    if (options.deadlineAt !== undefined && Date.now() >= options.deadlineAt) break;
    if (options.callBudget && !(options.callBudget.canSpend?.(reservation) ?? options.callBudget.left())) break;
    const candidateBudget = options.callBudget ? reservedOdooCallBudget(reservation) : undefined;
    let built: DispatchMoneyWriteDeps;
    try {
      built = await buildDeps(candidate, candidateBudget);
      if (candidateBudget?.exhausted()) {
        const used = candidateBudget.used();
        if (used > 0) options.callBudget?.spend(used);
        errors.push({ id: candidate.row.id, error: 'external-unreachable' });
        break;
      }
      if (options.callBudget && !options.callBudget.spend(reservation)) {
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
        if (used < reservation) options.callBudget.refund?.(reservation - used);
        else if (used > reservation) options.callBudget.spend(used - reservation);
        stopAfterDispatch = candidateBudget.exhausted() || !options.callBudget.left();
      }
    }
    if (stopAfterDispatch) break;
  }
  return { reconciled, errors };
}
