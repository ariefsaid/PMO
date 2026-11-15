// The expense posting pass, live wiring (THEME-BACK-40, #1643): pass (7)'s resolve reads, its deps for
// `expensePostingBackstop.ts` and the per-org pass. Moved verbatim from index.ts.
import type { SupabaseClient } from '@supabase/supabase-js';
import { surfaceActionRequired } from '../_shared/erpnextFeedDeps.ts';
import { DOCTYPE_REGISTRY } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/doctypeRegistry.ts';
import type { OutboxRow } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import type { AdapterCommand } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { ErpError, getDoc, withProbeBudget, type ErpClientDeps } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/client.ts';
import { lookupConfirmedErpEmployee } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.ts';
import { guardedErpFetch } from '../_shared/erpHostGuard.ts';
import { resolveErpAuthPair, type ErpAuthPairCache } from '../_shared/erpAuthPair.ts';
import { checkErpnextCommandAuthorization, replayMayIssueErpWrite } from '../adapter-dispatch/authGuard.ts';
import { erpDatetime } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/recoveryProbe.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { findOutboxRowByKey } from './outboxRows.ts';
import { ERPNEXT_EXPENSES_DOMAIN } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts';
// #775 phase B (ADR-0081) — the expense posting pass (7), the only originator of expense postings.
import { buildExpensePostingCommand, parseExpenseGateTruth } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/expensePostingCommand.ts';
import { resolveExpensePosting, type ExpenseResolveDeps } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/expensePostingResolve.ts';
import { EXPENSE_POSTING_KEY_PREFIX, expenseOutboxIdentity, expensePostingIdentity, expensePostingKey, type ExpensePosting } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/expensePostingKey.ts';
import type { ErpAccountFacts } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/expenseAccountRules.ts';
import { reconcileOrgExpensePostings, backstopPassResult, type ExpenseBackstopDeps, type ExpenseIntentRow, type ExpenseOutcome } from './expensePostingBackstop.ts';
import { type OrgBinding, listRetryPendingLive, listCandidatesLive } from './sweepShared.ts';
import { buildReconcileDepsLive, dispatchMoneyWrite, buildMoneyWriteDepsLive } from './moneyWriteLive.ts';

// ────────────────────────────────────────────────────────────────────────────────────────────────
// (7) #775 phase B — the expense posting pass, the ONLY originator of expense postings (ADR-0081).
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** The live reads `resolveExpensePosting` needs (FR-EXP-106). ERP reads use the probe budget (one attempt, tight
 *  deadline) — this runs before the outbox claim, so a slow ERP fails the attempt instead of hanging the tick.
 *  Exported for its unit test (`expenseResolveDepsLive.test.ts`). */
export function expenseResolveDepsLive(serviceClient: SupabaseClient, org: OrgBinding, cache?: ErpAuthPairCache): ExpenseResolveDeps {
  const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);
  let erpClient: ErpClientDeps | null = null;
  const client = async (): Promise<ErpClientDeps> => {
    if (!erpClient) {
      const { apiKey, apiSecret } = await resolveErpAuthPair(serviceClient, org, cache);
      erpClient = withProbeBudget({ fetchImpl: guardedErpFetch(org.siteUrl), apiKey, apiSecret, baseUrl: org.siteUrl });
    }
    return erpClient;
  };
  const getOrNull = async (doctype: string, name: string): Promise<Record<string, unknown> | null> => {
    try {
      return (await getDoc(await client(), doctype, name)) as Record<string, unknown>;
    } catch (err) {
      if (err instanceof ErpError && err.status === 404) return null;
      throw err;
    }
  };
  return {
    readBinding: () => Promise.resolve({
      company: text(org.company),
      cashAccount: text(org.config.default_cash_account) ?? text(org.config.default_bank_account),
      costCenter: text(org.config.cost_center),
      projectMap: (org.config.project_map as Record<string, string> | undefined) ?? {},
    }),
    readConfirmedEmployee: async (profileId) => {
      const lookup = await lookupConfirmedErpEmployee(serviceClient as never, org.orgId, profileId);
      return lookup.status === 'ok' ? lookup.employee : null;
    },
    readAccountMap: async () => {
      const { data, error } = await serviceClient.from('expense_account_map').select('account_key, erp_account').eq('org_id', org.orgId);
      if (error) throw new AppError(error.message, error.code);
      return Object.fromEntries(((data as Array<{ account_key: string; erp_account: string }> | null) ?? [])
        .map((r) => [r.account_key, r.erp_account]));
    },
    readApprovalPosting: async (claimId) => {
      const { data, error } = await serviceClient.from('expense_posting_erp_mirror')
        .select('push_state, erp_name, erp_cancelled_at')
        .eq('org_id', org.orgId).eq('posting_identity', `${claimId}:approval`).maybeSingle();
      if (error) throw new AppError(error.message, error.code);
      return (data as { push_state: string; erp_name: string | null; erp_cancelled_at: string | null } | null) ?? null;
    },
    // Any outbox command for the approval itself (its key prefix; the cancel shares the approval's identity).
    readApprovalOutboxExists: async (claimId) => {
      const { data, error } = await serviceClient.from('external_command_outbox').select('id')
        .eq('org_id', org.orgId).eq('domain', ERPNEXT_EXPENSES_DOMAIN)
        .eq('pmo_record_id', expenseOutboxIdentity('approval', claimId))
        .like('idempotency_key', `${EXPENSE_POSTING_KEY_PREFIX.approval}:%`).limit(1);
      if (error) throw new AppError(error.message, error.code);
      return Array.isArray(data) && data.length > 0;
    },
    readErpAccounts: async (names) => {
      const facts: ErpAccountFacts[] = [];
      for (const name of names) {
        const doc = await getOrNull('Account', name);
        if (doc) facts.push({ ...doc, name } as ErpAccountFacts);
      }
      return facts;
    },
    // One Company read gives both facts; the supplier payable account is ERPNext's LIVE value, never the binding's copy.
    readErpCompany: async (company) => {
      const doc = await getOrNull('Company', company);
      return doc ? { currency: text(doc.default_currency), defaultPayableAccount: text(doc.default_payable_account) } : null;
    },
    readErpJournalDocstatus: async (name) => {
      const doc = await getOrNull(DOCTYPE_REGISTRY['expense-journal'].doctype, name);
      return typeof doc?.docstatus === 'number' ? doc.docstatus : null;
    },
  };
}

/** Why an existing outbox row that 0131 no longer offers is parked: what an operator must look at. */
export function expenseOutboxHoldReason(state: string): string {
  if (state === 'confirmed') return 'expense-posting-mirror-diverged';
  if (state === 'held') return 'command-held';
  return 'expense-posting-attempts-exhausted';
}

/** The posting a deterministic expense key names (`<prefix>:<subject>:<stamp>`), or null for any other key. */
function expensePostingOfKey(idempotencyKey: string): ExpensePosting | null {
  const prefix = idempotencyKey.split(':', 1)[0];
  const hit = (Object.entries(EXPENSE_POSTING_KEY_PREFIX) as Array<[ExpensePosting, string]>).find(([, p]) => p === prefix);
  return hit ? hit[0] : null;
}

const EXPENSE_INTENT_COLUMNS = 'id, posting, posting_identity, claim_id, return_id, state_stamp, push_state, push_error';

/** The live deps of pass (7). `eligibleOutbox` is 0131's expenses candidate set, read once per pass. Exported so the
 *  replay/hold routing is unit-proven against a fake client (`expensePostingBackstopLive.test.ts`). */
export function expensePostingBackstopDepsLive(
  serviceClient: SupabaseClient,
  org: OrgBinding,
  eligibleOutbox: readonly OutboxRow[],
  cache?: ErpAuthPairCache,
  /** 0357: `failed` rows waiting out their retry delay (`outbox_retry_pending`) — not due, not exhausted. */
  retryPendingIds: ReadonlySet<string> = new Set(),
): ExpenseBackstopDeps {
  const eligibleOutboxIds = new Set(eligibleOutbox.map((row) => row.id));
  // Compare-and-set: only a pending/failed, not-cancelled intent moves (a concurrent landing stays `pushed`).
  // The notice is deduplicated by surfaceActionRequired against an unread one for the same posting and reason.
  const recordOutcome = async (row: ExpenseIntentRow, outcome: ExpenseOutcome): Promise<void> => {
    const patch: Record<string, unknown> = { push_state: outcome.state, push_error: outcome.reason };
    // 0358: each failure lengthens the posting's retry delay (`expense_posting_queue`).
    if (outcome.state === 'failed') patch.attempt_count = (row.attempt_count ?? 0) + 1;
    if (outcome.state === 'pushed') {
      patch.erp_name = outcome.erpName ?? null;
      patch.pushed_at = new Date().toISOString();
    }
    const { error } = await serviceClient.from('expense_posting_erp_mirror').update(patch)
      .eq('org_id', org.orgId).eq('id', row.id).in('push_state', ['pending', 'failed']).is('erp_cancelled_at', null);
    if (error) throw new AppError(error.message, error.code);
    if (outcome.state !== 'pushed') {
      await surfaceActionRequired(serviceClient, org.orgId, outcome.state === 'held' ? 'expense-posting-held' : 'expense-posting-failed',
        { postingIdentity: row.posting_identity, reason: outcome.reason });
    }
  };
  const classify = (err: unknown): ExpenseOutcome => {
    const code = (err as { code?: unknown } | null)?.code;
    return {
      state: code === 'command-held' ? 'held' : 'failed',
      reason: typeof code === 'string' ? code : err instanceof Error ? err.message : String(err),
    };
  };
  return {
    // Round robin (NFR-EXP-013): never-attempted first, then least recently attempted — index-served (0270 §3).
    // 0358: a failed posting is queued again only after its retry delay (2^n minutes, capped at an hour).
    listPending: async (orgId, limit) => {
      const { data, error } = await serviceClient.rpc('expense_posting_queue', { p_org_id: orgId, p_limit: limit });
      if (error) throw new AppError(error.message, error.code);
      return (data as ExpenseIntentRow[] | null) ?? [];
    },
    markAttempted: async (orgId, intentIds) => {
      const { error } = await serviceClient.from('expense_posting_erp_mirror')
        .update({ last_attempt_at: new Date().toISOString() }).eq('org_id', orgId).in('id', intentIds);
      if (error) throw new AppError(error.message, error.code);
    },
    // A command left `committed` (finalize-only: the ERP document exists) whose intent the read-model writer already
    // marked `pushed`. Finishing it issues no ERP write; leaving it blocks the record's next command (0134).
    listStranded: async (orgId) => {
      const committed = eligibleOutbox.filter((row) => row.state === 'committed' && row.domain === ERPNEXT_EXPENSES_DOMAIN);
      const byIdentity = new Map<string, OutboxRow>();
      for (const outbox of committed) {
        const posting = expensePostingOfKey(outbox.idempotencyKey);
        const subject = outbox.pmoRecordId.split(':', 1)[0];
        if (posting && subject) byIdentity.set(expensePostingIdentity(posting, subject), outbox);
      }
      if (byIdentity.size === 0) return [];
      const { data, error } = await serviceClient.from('expense_posting_erp_mirror')
        .select(EXPENSE_INTENT_COLUMNS)
        .eq('org_id', orgId).eq('push_state', 'pushed').in('posting_identity', [...byIdentity.keys()]);
      if (error) throw new AppError(error.message, error.code);
      return ((data as ExpenseIntentRow[] | null) ?? []).flatMap((row) => {
        const outbox = byIdentity.get(row.posting_identity);
        return outbox ? [{ row, outbox }] : [];
      });
    },
    findOutbox: (row) => {
      const posting = row.posting as ExpensePosting;
      const subject = row.return_id ?? row.claim_id;
      return findOutboxRowByKey(serviceClient, org.orgId, ERPNEXT_EXPENSES_DOMAIN,
        expenseOutboxIdentity(posting, subject), expensePostingKey(posting, subject, row.state_stamp));
    },
    replay: async (row, ref) => {
      const outbox = ref as OutboxRow;
      if (!eligibleOutboxIds.has(outbox.id)) {
        // Not due yet: a lease or quarantine window (0131), or a failed row's retry delay (0357).
        if (outbox.state === 'committing' || outbox.state === 'quarantined' || retryPendingIds.has(outbox.id)) return 'waiting';
        await recordOutcome(row, { state: 'held', reason: expenseOutboxHoldReason(outbox.state) });
        return 'held';
      }
      // A replay that may issue a NEW ERP write re-asserts the recorded actor's CURRENT role/rank — the gate's actor
      // half (0270 §5), which the generic replay authorization (active membership only for expenses) does not run.
      // A refusal leaves the outbox row untouched; the intent is recorded failed and retried.
      if (replayMayIssueErpWrite(outbox.state)) {
        const { error } = await serviceClient.rpc('expense_posting_actor_check', { p_org_id: org.orgId, p_mirror_id: row.id });
        if (error) {
          if (error.code === '42501' || error.code === 'P0002') {
            await recordOutcome(row, { state: 'failed', reason: error.message });
            return 'refused';
          }
          throw new AppError(error.message, error.code);
        }
      }
      try {
        await dispatchMoneyWrite(await buildReconcileDepsLive(serviceClient, org, outbox, cache));
      } catch (err) {
        // A stranded finish (the intent is already pushed) has nothing to record: the pass reports it and retries.
        if (row.push_state === 'pushed') throw err;
        const outcome = classify(err);
        await recordOutcome(row, outcome);
        return outcome.state === 'held' ? 'held' : 'failed';
      }
      return 'completed';
    },
    assertGate: async (row) => {
      const { data, error } = await serviceClient.rpc('expense_posting_for_push', { p_org_id: org.orgId, p_mirror_id: row.id });
      if (error) {
        if (error.code === 'P0001' || error.code === 'P0002' || error.code === '42501') return { ok: false, reason: error.message };
        throw new AppError(error.message, error.code);
      }
      return { ok: true, truth: parseExpenseGateTruth(data) };
    },
    resolve: (truth) => resolveExpensePosting(truth, expenseResolveDepsLive(serviceClient, org, cache)),
    recordOutcome,
    driveFresh: async (row, truth, refs) => {
      const built = buildExpensePostingCommand(truth, refs, erpDatetime(Date.now() - 60_000));
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

/** Pass (7), domain-gated (an org that has not employed `expenses` has nothing to post). */
export async function reconcileOrgExpensePostingsLive(
  serviceClient: SupabaseClient,
  org: OrgBinding,
  cache?: ErpAuthPairCache,
): Promise<{ driven: number; error?: string }> {
  if (!org.ownedDomains.includes(ERPNEXT_EXPENSES_DOMAIN)) return { driven: 0 };
  try {
    const eligibleOutbox = (await listCandidatesLive(serviceClient)(org.orgId)).filter((c) => c.domain === ERPNEXT_EXPENSES_DOMAIN);
    const result = await reconcileOrgExpensePostings(
      expensePostingBackstopDepsLive(serviceClient, org, eligibleOutbox, cache, await listRetryPendingLive(serviceClient, org.orgId)),
      { orgId: org.orgId },
    );
    for (const e of result.errors) {
      console.warn(`[erpnext-sweep] org ${org.orgId} expense intent ${e.intentId}: ${e.error}`);
    }
    return backstopPassResult(result, 'expense');
  } catch (err) {
    return { driven: 0, error: err instanceof Error ? err.message : String(err) };
  }
}
