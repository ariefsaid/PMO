// The site float transfer pass, live wiring (THEME-BACK-40, #1643): pass (7b)'s resolve reads, its deps for
// `imprestPostingBackstop.ts` and the per-org pass. Moved verbatim from index.ts.
import type { SupabaseClient } from '@supabase/supabase-js';
import { surfaceActionRequired } from '../_shared/erpnextFeedDeps.ts';
import { buildImprestPostingCommand, parseImprestGateTruth } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/imprestPostingCommand.ts';
import { resolveImprestPosting, type ImprestResolveDeps } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/imprestPostingResolve.ts';
import { imprestTransferKey } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/imprestTransferKey.ts';
import { IMPREST_TRANSFER_KEY_RE } from '../../../pmo-portal/src/lib/adapterSeam/imprestTransfer.ts';
import { reconcileOrgImprestPostings, type ImprestBackstopDeps, type ImprestIntentRow } from './imprestPostingBackstop.ts';
import type { OutboxRow } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import type { AdapterCommand } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import type { ErpAuthPairCache } from '../_shared/erpAuthPair.ts';
import { checkErpnextCommandAuthorization, replayMayIssueErpWrite } from '../adapter-dispatch/authGuard.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { findOutboxRowByKey } from './outboxRows.ts';
import { ERPNEXT_EXPENSES_DOMAIN } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts';
import { backstopPassResult } from './expensePostingBackstop.ts';
import { featureDisabled, type OrgBinding, listRetryPendingLive, listCandidatesLive } from './sweepShared.ts';
import { buildReconcileDepsLive, dispatchMoneyWrite, buildMoneyWriteDepsLive } from './moneyWriteLive.ts';
import { expenseResolveDepsLive, expenseOutboxHoldReason } from './expensePostingBackstopLive.ts';

// ────────────────────────────────────────────────────────────────────────────────────────────────
// (7b) #1515 S6 — site float transfers: head office bank → a float's ERP cash account, once per paid replenishment.
// The expense pass's orchestration (imprestPostingBackstop.ts) over `imprest_posting_erp_mirror`; same outbox domain
// (`expenses`), so 0270 §5b's read scope covers its rows.
// ────────────────────────────────────────────────────────────────────────────────────────────────

const IMPREST_INTENT_COLUMNS = 'id, posting_identity, replenishment_id, state_stamp, push_state, push_error, attempt_count';
/** A failed transfer is retried after 2^attempts minutes, capped at an hour (the 0358 expense queue's delay). */
const imprestRetryDelayMs = (attempts: number): number => Math.min(60, 2 ** Math.min(attempts, 10)) * 60_000;

/** The live reads the resolver needs. ERP reads reuse the expense pass's probe-budget client. Exported for its unit test. */
export function imprestResolveDepsLive(serviceClient: SupabaseClient, org: OrgBinding, cache?: ErpAuthPairCache): ImprestResolveDeps {
  const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);
  const erp = expenseResolveDepsLive(serviceClient, org, cache);
  return {
    // The head office end is the binding's BANK account (it funds site cash). No fallback to the company cash account: that
    // would post a cash-to-cash "Bank Entry"; an unset bank account refuses (imprest-head-office-account-unconfigured).
    readBinding: () => Promise.resolve({
      company: text(org.company),
      headOfficeAccount: text(org.config.default_bank_account),
    }),
    readErpAccounts: erp.readErpAccounts,
    readErpCompany: async (company) => {
      const c = await erp.readErpCompany(company);
      return c ? { currency: c.currency } : null;
    },
  };
}

/** The live deps of pass (7b). `eligibleOutbox` is 0131's expenses candidate set, read once per pass. */
export function imprestPostingBackstopDepsLive(
  serviceClient: SupabaseClient,
  org: OrgBinding,
  eligibleOutbox: readonly OutboxRow[],
  cache?: ErpAuthPairCache,
  retryPendingIds: ReadonlySet<string> = new Set(),
  /** 0534 (held module): list NOTHING as new work — only the stranded/finalize-only pass runs. */
  holdNewWork = false,
): ImprestBackstopDeps {
  const eligibleOutboxIds = new Set(eligibleOutbox.map((row) => row.id));
  const recordOutcome: ImprestBackstopDeps['recordOutcome'] = async (row, outcome) => {
    const patch: Record<string, unknown> = { push_state: outcome.state, push_error: outcome.reason };
    if (outcome.state === 'failed') patch.attempt_count = (row.attempt_count ?? 0) + 1;
    if (outcome.state === 'pushed') {
      patch.erp_name = outcome.erpName ?? null;
      patch.pushed_at = new Date().toISOString();
    }
    // Compare-and-set: only a pending/failed, not-cancelled intent moves (a concurrent landing stays `pushed`).
    const { error } = await serviceClient.from('imprest_posting_erp_mirror').update(patch)
      .eq('org_id', org.orgId).eq('id', row.id).in('push_state', ['pending', 'failed']).is('erp_cancelled_at', null);
    if (error) throw new AppError(error.message, error.code);
    if (outcome.state !== 'pushed') {
      await surfaceActionRequired(serviceClient, org.orgId, outcome.state === 'held' ? 'imprest-posting-held' : 'imprest-posting-failed',
        { postingIdentity: row.posting_identity, reason: outcome.reason });
    }
  };
  const classify = (err: unknown) => {
    const code = (err as { code?: unknown } | null)?.code;
    return {
      state: (code === 'command-held' ? 'held' : 'failed') as 'held' | 'failed',
      reason: typeof code === 'string' ? code : err instanceof Error ? err.message : String(err),
    };
  };
  return {
    // Round robin: never-attempted first, then least recently attempted; a failed intent waits out its retry delay.
    listPending: async (orgId, limit) => {
      // 0534: a held module mints nothing new; the stranded/finalize-only pass above still runs.
      if (holdNewWork) return [];
      const { data, error } = await serviceClient.from('imprest_posting_erp_mirror').select(`${IMPREST_INTENT_COLUMNS}, last_attempt_at`)
        .eq('org_id', orgId).in('push_state', ['pending', 'failed']).is('erp_cancelled_at', null)
        .order('last_attempt_at', { ascending: true, nullsFirst: true }).order('created_at', { ascending: true }).limit(limit);
      if (error) throw new AppError(error.message, error.code);
      const now = Date.now();
      return ((data as Array<ImprestIntentRow & { last_attempt_at: string | null }> | null) ?? []).filter((r) =>
        r.push_state !== 'failed' || !r.last_attempt_at || now - Date.parse(r.last_attempt_at) >= imprestRetryDelayMs(r.attempt_count ?? 0));
    },
    markAttempted: async (orgId, intentIds) => {
      const { error } = await serviceClient.from('imprest_posting_erp_mirror')
        .update({ last_attempt_at: new Date().toISOString() }).eq('org_id', orgId).in('id', intentIds);
      if (error) throw new AppError(error.message, error.code);
    },
    // A command left `committed` whose intent the read-model writer already marked `pushed`: finish it (no ERP write).
    listStranded: async (orgId) => {
      const byIdentity = new Map<string, OutboxRow>();
      for (const outbox of eligibleOutbox) {
        if (outbox.state !== 'committed' || !IMPREST_TRANSFER_KEY_RE.test(outbox.idempotencyKey)) continue;
        byIdentity.set(outbox.pmoRecordId, outbox);
      }
      if (byIdentity.size === 0) return [];
      const { data, error } = await serviceClient.from('imprest_posting_erp_mirror').select(IMPREST_INTENT_COLUMNS)
        .eq('org_id', orgId).eq('push_state', 'pushed').in('posting_identity', [...byIdentity.keys()]);
      if (error) throw new AppError(error.message, error.code);
      return ((data as ImprestIntentRow[] | null) ?? []).flatMap((row) => {
        const outbox = byIdentity.get(row.posting_identity);
        return outbox ? [{ row, outbox }] : [];
      });
    },
    findOutbox: (row) => findOutboxRowByKey(serviceClient, org.orgId, ERPNEXT_EXPENSES_DOMAIN, row.posting_identity,
      imprestTransferKey({ subject_id: row.replenishment_id, state_stamp: row.state_stamp })),
    replay: async (row, ref) => {
      const outbox = ref as OutboxRow;
      if (!eligibleOutboxIds.has(outbox.id)) {
        if (outbox.state === 'committing' || outbox.state === 'quarantined' || retryPendingIds.has(outbox.id)) return 'waiting';
        await recordOutcome(row, { state: 'held', reason: expenseOutboxHoldReason(outbox.state) });
        return 'held';
      }
      // A replay that may issue a NEW ERP write re-asserts the gate (status, stamp, recorded actor's CURRENT standing).
      if (replayMayIssueErpWrite(outbox.state)) {
        const { error } = await serviceClient.rpc('imprest_posting_for_push', { p_org_id: org.orgId, p_mirror_id: row.id });
        if (error) {
          if (error.code === '42501' || error.code === 'P0001' || error.code === 'P0002') {
            await recordOutcome(row, { state: 'failed', reason: error.message });
            return 'refused';
          }
          throw new AppError(error.message, error.code);
        }
      }
      try {
        await dispatchMoneyWrite(await buildReconcileDepsLive(serviceClient, org, outbox, cache));
      } catch (err) {
        if (row.push_state === 'pushed') throw err;
        const outcome = classify(err);
        await recordOutcome(row, outcome);
        return outcome.state === 'held' ? 'held' : 'failed';
      }
      return 'completed';
    },
    assertGate: async (row) => {
      const { data, error } = await serviceClient.rpc('imprest_posting_for_push', { p_org_id: org.orgId, p_mirror_id: row.id });
      if (error) {
        if (error.code === 'P0001' || error.code === 'P0002' || error.code === '42501') return { ok: false, reason: error.message };
        throw new AppError(error.message, error.code);
      }
      return { ok: true, truth: parseImprestGateTruth(data) };
    },
    resolve: (truth) => resolveImprestPosting(truth, imprestResolveDepsLive(serviceClient, org, cache)),
    recordOutcome,
    driveFresh: async (row, truth, refs) => {
      const built = buildImprestPostingCommand(truth, refs);
      const auth = await checkErpnextCommandAuthorization(serviceClient as never, org.orgId, truth.actor_id, {
        domain: ERPNEXT_EXPENSES_DOMAIN, record: { erp_doc_kind: built.record.erp_doc_kind },
      });
      if (!auth.ok) {
        await recordOutcome(row, { state: 'failed', reason: auth.message });
        return;
      }
      const command: AdapterCommand = {
        domain: ERPNEXT_EXPENSES_DOMAIN, operation: built.operation,
        record: built.record as AdapterCommand['record'], idempotencyKey: built.idempotencyKey,
      };
      try {
        await dispatchMoneyWrite(await buildMoneyWriteDepsLive(serviceClient, org,
          { command, actorUserId: truth.actor_id, outboxRecordId: built.outboxIdentity, persistPayload: true }, cache));
      } catch (err) {
        await recordOutcome(row, classify(err));
      }
    },
  };
}

/** Pass (7b), domain-gated like (7): an org that has not employed `expenses` has nothing to post. */
export async function reconcileOrgImprestPostingsLive(
  serviceClient: SupabaseClient,
  org: OrgBinding,
  cache?: ErpAuthPairCache,
): Promise<{ driven: number; error?: string }> {
  if (!org.ownedDomains.includes(ERPNEXT_EXPENSES_DOMAIN)) return { driven: 0 };
  // 0534: `imprest` off holds the site-float transfers (this pass's ONLY subject). Core expense
  // postings keep running — expense claims are a never-gatable key (0533), so the split is per pass,
  // never per domain. Held, never dropped: the mirror row's queue resumes on re-enable.
  //
  // ⚑ CLOSURE IS NEVER HELD (FR-PLN-006): the pass still FINISHES commands ERP already accepted. A
  // `committed` outbox row whose intent the read-model writer already marked `pushed` is completed by
  // the finalize-only replay with no ERP write — leaving it would keep the intent unfinished for the
  // whole off interval. Only NEW transfers are held.
  const held = featureDisabled(org, 'imprest');
  try {
    const eligibleOutbox = (await listCandidatesLive(serviceClient)(org.orgId)).filter((c) => c.domain === ERPNEXT_EXPENSES_DOMAIN);
    const result = await reconcileOrgImprestPostings(
      imprestPostingBackstopDepsLive(serviceClient, org, eligibleOutbox, cache,
        await listRetryPendingLive(serviceClient, org.orgId), held),
      { orgId: org.orgId },
    );
    for (const e of result.errors) {
      console.warn(`[erpnext-sweep] org ${org.orgId} imprest intent ${e.intentId}: ${e.error}`);
    }
    const summary = backstopPassResult(result, 'imprest');
    return held ? { ...summary, error: ['feature-off:imprest', summary.error].filter(Boolean).join('; ') } : summary;
  } catch (err) {
    return { driven: 0, error: err instanceof Error ? err.message : String(err) };
  }
}
