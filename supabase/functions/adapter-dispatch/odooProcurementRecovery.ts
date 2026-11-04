import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdapterCommand, PmoRecord } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { AdapterError } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { dispatchMoneyWrite, type DispatchMoneyWriteDeps, type OutboxRow } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import { recordExternalRef as recordExternalRefWrite } from '../../../pmo-portal/src/lib/adapterSeam/refs.ts';
import { ODOO_TIER } from '../../../pmo-portal/src/lib/adapterSeam/odoo/connectAdapter.ts';
import { assertNotPreCutover } from '../../../pmo-portal/src/lib/adapterSeam/cutoverGate.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { checkOutboxReplayAuthorization, replayMayIssueErpWrite, type AuthorizationResult } from './authGuard.ts';
import { getReadModelWriter } from './readModelWriters.ts';
import { resolveOdooMoneyOutboxDeps } from './odooMoneyOutbox.ts';
import { resolveOdooProcurementAdapter } from './odooAdapters.ts';
import type { AdapterSelectContext } from './dispatchAdapters.ts';

export interface OdooProcurementCandidate {
  row: OutboxRow;
  externalTier: string;
  operation: string;
  payload: Record<string, unknown> | null;
  updatedAt: string;
}

export interface OdooProcurementRecoveryResult {
  reconciled: number;
  skipped: number;
  budgetExhausted: boolean;
  errors: Array<{ id: string; error: string }>;
}

type OdooCallBudget = { left: () => boolean; spend: () => boolean };
type BuildOdooProcurementRecoveryDeps = (candidate: OdooProcurementCandidate) => DispatchMoneyWriteDeps | Promise<DispatchMoneyWriteDeps>;
type DispatchOdooProcurementRecovery = (deps: DispatchMoneyWriteDeps) => Promise<unknown>;
type ReplayAuthorizer = typeof checkOutboxReplayAuthorization;
type AnchoredElsewhere = (candidate: OdooProcurementCandidate) => Promise<boolean>;

const PROCUREMENT_COMMANDS: Readonly<Record<string, readonly string[]>> = {
  'purchase-order': ['create', 'update'],
  'goods-receipt': ['create'],
  'purchase-invoice': ['create'],
  payment: ['create'],
};

function isProcurementCandidate(candidate: OdooProcurementCandidate): boolean {
  const kind = candidate.payload?.erp_doc_kind;
  return candidate.externalTier === ODOO_TIER && candidate.row.domain === 'procurement' &&
    candidate.row.state !== 'held' && typeof kind === 'string' &&
    (PROCUREMENT_COMMANDS[kind]?.includes(candidate.operation) ?? false) &&
    (candidate.operation !== 'update' || (kind === 'purchase-order' && Number.isInteger(candidate.payload?.revision)));
}

function recoveryErrorCode(error: unknown): string {
  if (error instanceof AppError || error instanceof AdapterError) return error.code ?? 'recovery-failed';
  return 'recovery-failed';
}

/** Run the bounded, shared-dispatch recovery path for eligible Odoo procurement outbox rows. */
export async function reconcileOdooProcurementCandidates(
  candidates: OdooProcurementCandidate[],
  options: { orgId: string; ownsProcurement: boolean; maxCandidates?: number; deadlineAt?: number; callBudget?: OdooCallBudget },
  buildDeps: BuildOdooProcurementRecoveryDeps,
  dispatch: DispatchOdooProcurementRecovery = dispatchMoneyWrite,
  anchoredElsewhere: AnchoredElsewhere,
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

  for (const candidate of eligible.slice(0, options.maxCandidates ?? 100)) {
    if (options.deadlineAt !== undefined && Date.now() >= options.deadlineAt) break;
    if (options.callBudget && !options.callBudget.left()) {
      result.budgetExhausted = true;
      break;
    }
    try {
      if (await anchoredElsewhere(candidate)) {
        result.skipped += 1;
        continue;
      }
      await dispatch(await buildDeps(candidate));
      result.reconciled += 1;
    } catch (error) {
      result.errors.push({ id: candidate.row.id, error: recoveryErrorCode(error) });
      if (options.callBudget && !options.callBudget.left()) result.budgetExhausted = true;
    }
  }
  return result;
}

function outboxRow(raw: Record<string, unknown>): OutboxRow {
  return {
    id: String(raw.id), domain: String(raw.domain), pmoRecordId: String(raw.pmo_record_id), idempotencyKey: String(raw.idempotency_key),
    state: raw.state as OutboxRow['state'], externalRecordId: (raw.external_record_id as string | null) ?? null,
    canonical: (raw.canonical as PmoRecord | null) ?? null, claimGeneration: Number(raw.claim_generation ?? 0),
    payloadDigest: (raw.payload_digest as string | null) ?? null,
  };
}

function commandOperation(operation: string, payload: Record<string, unknown>): AdapterCommand['operation'] {
  // The outbox stores `update`; the original PMO command and its recovery probe are `revise`.
  if (operation === 'update' && payload.erp_doc_kind === 'purchase-order' && Number.isInteger(payload.revision)) return 'revise' as never;
  return operation as AdapterCommand['operation'];
}

async function readExternalAnchorOwner(sc: SupabaseClient, orgId: string, externalRecordId: string): Promise<string | null> {
  const { data, error } = await sc.from('external_refs').select('pmo_record_id')
    .eq('org_id', orgId).eq('domain', 'procurement').eq('external_tier', ODOO_TIER)
    .eq('external_record_id', externalRecordId).maybeSingle();
  if (error) throw new AdapterError('external-unreachable', 'odoo-anchor-owner-unreadable');
  return (data as { pmo_record_id?: string } | null)?.pmo_record_id ?? null;
}

/** Rebuild one frozen outbox command from its recorded actor and persisted payload. */
export async function buildOdooProcurementRecoveryDeps(
  sc: SupabaseClient,
  orgId: string,
  candidate: OdooProcurementCandidate,
  callBudget?: OdooCallBudget,
  authorizeReplay: ReplayAuthorizer = checkOutboxReplayAuthorization,
): Promise<DispatchMoneyWriteDeps> {
  const { data, error } = await sc.from('external_command_outbox')
    .select('external_tier,domain,pmo_record_id,operation,payload,actor_user_id')
    .eq('org_id', orgId).eq('id', candidate.row.id).maybeSingle();
  if (error || !data) throw new AppError('Odoo procurement recovery row could not be read', error?.code ?? 'not-found');
  const stored = data as {
    external_tier: string; domain: string; pmo_record_id: string; operation: string;
    payload: Record<string, unknown> | null; actor_user_id: string | null;
  };
  const payload = stored.payload ?? {};
  if (stored.external_tier !== ODOO_TIER || stored.domain !== 'procurement' || stored.pmo_record_id !== candidate.row.pmoRecordId ||
      stored.operation !== candidate.operation || !isProcurementCandidate({ ...candidate, externalTier: stored.external_tier, payload })) {
    throw new AppError('Odoo procurement recovery row no longer matches its frozen command', 'commit-rejected');
  }

  const command: AdapterCommand = {
    domain: 'procurement', operation: commandOperation(stored.operation, payload),
    record: payload as AdapterCommand['record'], idempotencyKey: candidate.row.idempotencyKey,
  };
  const replayAuth: AuthorizationResult = await authorizeReplay(sc as never, orgId, {
    id: candidate.row.id, state: candidate.row.state, domain: command.domain, operation: command.operation,
    pmoRecordId: candidate.row.pmoRecordId, actorUserId: stored.actor_user_id, payload, tier: ODOO_TIER,
  });
  if (!replayAuth.ok) throw new AppError(replayAuth.message, 'commit-rejected');
  if (replayMayIssueErpWrite(candidate.row.state)) {
    await assertNotPreCutover(sc as never, { domain: command.domain, record: payload });
  }

  const context: AdapterSelectContext = {
    orgId, command, serviceClient: sc, userId: stored.actor_user_id ?? '', replay: true, erpAuth: new Map(),
    faultGate: { envFaults: undefined, header: null, requestHost: null, allowedHosts: undefined },
    ...(callBudget ? { odooCallBudget: callBudget } : {}),
  };
  const adapter = await resolveOdooProcurementAdapter(context);
  const money = await resolveOdooMoneyOutboxDeps(context);
  const reauthorizeRecoveryReissue = money.reauthorizeRecoveryReissue;
  money.reauthorizeRecoveryReissue = async () => {
    // A quarantined row normally gets the probe/finalize exemption. Only the dispatcher's actual
    // post-window reissue branch calls this callback, where a new Odoo write needs current actor auth.
    const authorization = await authorizeReplay(sc as never, orgId, {
      id: candidate.row.id, state: 'failed', domain: command.domain, operation: command.operation,
      pmoRecordId: candidate.row.pmoRecordId, actorUserId: stored.actor_user_id, payload, tier: ODOO_TIER,
    });
    if (!authorization.ok) return { ok: false, message: authorization.message };
    return reauthorizeRecoveryReissue ? await reauthorizeRecoveryReissue() : { ok: true, message: '' };
  };
  const probe = money.probeByRemarksKey;
  money.probeByRemarksKey = async (domain, idempotencyKey, probeOptions) => {
    const result = await probe(domain, idempotencyKey, probeOptions);
    if (!result) return null;
    const owner = await readExternalAnchorOwner(sc, orgId, result.externalRecordId);
    if (owner && owner !== candidate.row.pmoRecordId) throw new AppError('Odoo document is already anchored to another PMO row', 'command-held');
    return result;
  };

  const writer = getReadModelWriter(command.domain);
  const writeReadModel = (canonical: PmoRecord, options?: { isReplay?: boolean }) => writer.upsert({
    serviceClient: sc as never, orgId, callerUserId: stored.actor_user_id ?? undefined, isReplay: options?.isReplay ?? true,
  }, canonical, command);
  const recordExternalRef = (mapping: Parameters<DispatchMoneyWriteDeps['recordExternalRef']>[0]) =>
    recordExternalRefWrite(sc as never, { ...mapping, orgId, externalTier: ODOO_TIER });
  return { adapter, command, money, writeReadModel, recordExternalRef, outboxRecordId: candidate.row.pmoRecordId };
}

/** The Odoo tier's bounded procurement recovery pass; it uses the same candidate RPC and fenced dispatcher as revenue recovery. */
export async function reconcileOdooProcurementOutbox(
  sc: SupabaseClient,
  orgId: string,
  options: { maxCandidates?: number; timeBudgetMs?: number; callBudget?: OdooCallBudget } = {},
): Promise<OdooProcurementRecoveryResult> {
  const { data, error } = await sc.rpc('outbox_reconcile_candidates', { p_org_id: orgId });
  if (error) throw new AppError('Odoo procurement recovery candidates could not be read', error.code);
  const candidates: OdooProcurementCandidate[] = ((data as Array<Record<string, unknown>> | null) ?? []).map((raw) => ({
    row: outboxRow(raw), externalTier: String(raw.external_tier), operation: String(raw.operation),
    payload: (raw.payload as Record<string, unknown> | null) ?? null, updatedAt: String(raw.updated_at ?? ''),
  }));
  const { data: ownership, error: ownershipError } = await sc.from('external_domain_ownership').select('id')
    .eq('org_id', orgId).eq('external_tier', ODOO_TIER).eq('domain', 'procurement').limit(1);
  if (ownershipError) throw new AppError('Odoo procurement ownership could not be checked', ownershipError.code);
  const now = Date.now();
  const recoveryBudgetMs = Math.min(options.timeBudgetMs ?? 60_000, 60_000);
  return reconcileOdooProcurementCandidates(candidates, {
    orgId, ownsProcurement: (ownership?.length ?? 0) > 0, maxCandidates: options.maxCandidates,
    deadlineAt: now + recoveryBudgetMs, callBudget: options.callBudget,
  },
    (candidate) => buildOdooProcurementRecoveryDeps(sc, orgId, candidate, options.callBudget),
    dispatchMoneyWrite,
    async (candidate) => {
      if (!candidate.row.externalRecordId) return false;
      const owner = await readExternalAnchorOwner(sc, orgId, candidate.row.externalRecordId);
      return owner !== null && owner !== candidate.row.pmoRecordId;
    });
}
