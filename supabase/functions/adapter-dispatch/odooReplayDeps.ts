import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdapterCommand, PmoRecord } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import type { DispatchMoneyWriteDeps, OutboxRow } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import { recordExternalRef as recordExternalRefWrite } from '../../../pmo-portal/src/lib/adapterSeam/refs.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { ODOO_TIER } from '../../../pmo-portal/src/lib/adapterSeam/odoo/connectAdapter.ts';
import { assertNotPreCutover } from '../../../pmo-portal/src/lib/adapterSeam/cutoverGate.ts';
import { checkOutboxReplayAuthorization, replayMayIssueErpWrite } from './authGuard.ts';
import { getReadModelWriter } from './readModelWriters.ts';
import type { AdapterSelectContext } from './dispatchAdapters.ts';
import type { ReservedOdooCallBudget } from '../_shared/odooCallBudget.ts';
import type { OdooOutboxRecoveryCandidate } from '../_shared/odooOutboxRecovery.ts';

/** The outbox row as recovery re-reads it: the frozen command and the actor who issued it. */
export interface StoredOdooOutboxRow {
  external_tier: string; domain: string; pmo_record_id: string; operation: string; state: OutboxRow['state'];
  payload: Record<string, unknown> | null; actor_user_id: string | null;
}

/** What differs between Odoo recovery domains; everything else is the one shared replay path. */
export interface OdooReplaySpec {
  /** The noun in operator-facing errors: 'invoice' | 'procurement' | 'stock'. */
  label: string;
  domain: string;
  ownsTier: (tier: unknown) => boolean;
  isFrozen: (stored: StoredOdooOutboxRow, payload: Record<string, unknown>, candidate: OdooOutboxRecoveryCandidate) => boolean;
  command: (stored: StoredOdooOutboxRow, payload: Record<string, unknown>) => Pick<AdapterCommand, 'domain' | 'operation' | 'record'>;
  resolveAdapter: (context: AdapterSelectContext) => Promise<DispatchMoneyWriteDeps['adapter']>;
  resolveMoney: (context: AdapterSelectContext) => Promise<DispatchMoneyWriteDeps['money']>;
  extraContext?: (sc: SupabaseClient, orgId: string, candidate: OdooOutboxRecoveryCandidate) => Partial<AdapterSelectContext>;
  /** Kept for procurement's existing tests only (#2283 Decisions §3); production never passes it. */
  authorizeReplay?: typeof checkOutboxReplayAuthorization;
}

/** Rebuild one frozen Odoo outbox command, behind the replay authorization the live route runs. */
export async function buildOdooReplayDeps(
  sc: SupabaseClient, orgId: string, candidate: OdooOutboxRecoveryCandidate,
  callBudget: ReservedOdooCallBudget | undefined, spec: OdooReplaySpec,
): Promise<DispatchMoneyWriteDeps> {
  const { data, error } = await sc.from('external_command_outbox')
    .select('external_tier,domain,pmo_record_id,operation,state,payload,actor_user_id')
    .eq('org_id', orgId).eq('id', candidate.row.id).maybeSingle();
  if (error || !data) throw new AppError(`Odoo ${spec.label} recovery row could not be read`, error?.code ?? 'not-found');
  const stored = data as StoredOdooOutboxRow;
  const payload = stored.payload ?? {};
  if (!spec.ownsTier(stored.external_tier) || stored.domain !== spec.domain
      || stored.pmo_record_id !== candidate.row.pmoRecordId || !spec.isFrozen(stored, payload, candidate)) {
    throw new AppError(`Odoo ${spec.label} recovery row no longer matches its frozen command`, 'commit-rejected');
  }
  const command: AdapterCommand = { ...spec.command(stored, payload), idempotencyKey: candidate.row.idempotencyKey };
  const authorize = spec.authorizeReplay ?? checkOutboxReplayAuthorization;
  const asActor = (state: string) => authorize(sc as never, orgId, {
    id: candidate.row.id, state, domain: command.domain, operation: command.operation,
    pmoRecordId: candidate.row.pmoRecordId, actorUserId: stored.actor_user_id, payload, tier: ODOO_TIER,
  });
  const replayAuth = await asActor(stored.state);
  if (!replayAuth.ok) throw new AppError(replayAuth.message, 'commit-rejected'); // mut:replay-auth
  if (replayMayIssueErpWrite(stored.state)) await assertNotPreCutover(sc as never, { domain: command.domain, record: payload });

  const context: AdapterSelectContext = {
    orgId, command, serviceClient: sc, userId: stored.actor_user_id ?? '', replay: true, erpAuth: new Map(),
    faultGate: { envFaults: undefined, header: null, requestHost: null, allowedHosts: undefined },
    ...(spec.extraContext?.(sc, orgId, candidate) ?? {}),
    ...(callBudget ? { odooCallBudget: callBudget } : {}),
  };
  const adapter = await spec.resolveAdapter(context);
  const money = await spec.resolveMoney(context);
  const moneyReauthorize = money.reauthorizeRecoveryReissue;
  money.reauthorizeRecoveryReissue = async () => {
    // Only the dispatcher's post-window reissue branch calls this: a new Odoo write needs the actor's current standing.
    const authorization = await asActor('failed');
    if (!authorization.ok) return { ok: false, message: authorization.message };
    return moneyReauthorize ? await moneyReauthorize() : { ok: true, message: '' };
  };
  const writer = getReadModelWriter(command.domain);
  const writeReadModel = (canonical: PmoRecord, options?: { isReplay?: boolean }) => writer.upsert({
    serviceClient: sc as never, orgId, callerUserId: stored.actor_user_id ?? undefined, isReplay: options?.isReplay ?? true,
  }, canonical, command);
  const recordExternalRef = (mapping: Parameters<DispatchMoneyWriteDeps['recordExternalRef']>[0]) =>
    recordExternalRefWrite(sc as never, { ...mapping, orgId, externalTier: ODOO_TIER });
  return { adapter, command, money, writeReadModel, recordExternalRef, outboxRecordId: candidate.row.pmoRecordId };
}
