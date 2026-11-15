// The live helpers every sweep pass shares (THEME-BACK-40, #1643): the loaded binding shape, the 0534 entitlement
// check, the per-org ERP client and full-document read, the outbox candidate listings, and the queue-fairness stamp.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OutboxRow } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import { erpnextRequest, ERP_PROBE_TIMEOUT_MS, ERP_REQUEST_TIMEOUT_MS, type ErpClientDeps } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/client.ts';
import { guardedErpFetch } from '../_shared/erpHostGuard.ts';
import { resolveErpAuthPair, type ErpAuthPairCache } from '../_shared/erpAuthPair.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { outboxRowOf } from './outboxRows.ts';

/** Lists outbox reconcile candidates for an org via the SECURITY DEFINER RPC (mig 0095). The
 *  candidate rows are the `OutboxRow` camelCase shape `dispatchMoneyWrite` consumes. */
export type ListOutboxCandidates = (orgId: string) => Promise<OutboxRow[]>;

/**
 * domain → the plan switch that entitles it (0534). A domain with no switch (`budget`, core
 * `expenses`) is never held here. `companies` is the CRM master feed.
 */
export const DOMAIN_FEATURE_KEY: Record<string, string> = {
  procurement: 'procurement',
  revenue: 'revenue',
  companies: 'crm',
};

/** True when 0534's entitlement read says this org's module is switched off. A read that FAILED for this
 *  org holds every gated key (fail-closed): "we could not read the switch" is never evidence it is on.
 *  Terminal recovery is unaffected — a candidate ERP already accepted still finalizes (see the pass). */
export function featureDisabled(
  org: { disabledFeatureKeys?: readonly string[]; featuresUnreadable?: boolean },
  key: string,
): boolean {
  return org.featuresUnreadable === true || (org.disabledFeatureKeys ?? []).includes(key);
}

/** A loaded per-org ERPNext binding (the external_org_bindings row, PMO-shaped). */
export interface OrgBinding {
  orgId: string;
  /** Present on live bindings; optional only for backward-compatible legacy test fixtures. */
  bindingId?: string | null;
  siteUrl: string;
  secretRef: string;
  company: string;
  config: Record<string, unknown>;
  /** Luna BLOCK 9: the PMO domains this org actually assigned to the ERPNext tier
   *  (`external_domain_ownership`) — the sweep polls only these. */
  ownedDomains: string[];
  // task FIX-6 (Quality MINOR 4): the handshake-stamped ERPNext major version lives on the
  // `external_org_bindings.version_major` COLUMN (§4.1), never inside `config` (which has no
  // `version` key — `report_filter_shape`/`aging_report_names`/the account defaults live there).
  versionMajor: number | null;
  /** AC-TSP-022: the moment this org's ERPNext binding was activated. The timesheet backstop's
   *  `absent` queue is scoped to it — hours approved BEFORE the integration existed are never
   *  retroactively posted to the client's ledger by a background sweep. OPTIONAL so the existing
   *  per-pass tests keep their fixtures byte-for-byte; absent/null ⇒ the `absent` queue yields NOTHING,
   *  which is the fail-safe answer (never a retroactive push). `listEmployingOrgsLive` always sets it. */
  activatedAt?: string | null;
  /** Holder fence for statement-source writes in this sweep tick. */
  statementLockHolder?: string;
  statementReplayNeeded?: boolean;
  /** 0534: the plan-switch keys that resolve OFF for this org (service_resolved_org_features).
   *  OPTIONAL so existing per-pass/cycle fixtures stay byte-for-byte; absent ⇒ nothing is held. */
  disabledFeatureKeys?: string[];
  /** 0534: this org's entitlement read FAILED this tick. Set only for the org whose read failed, and it
   *  holds every gated key for it (fail-closed) while terminal recovery still runs. OPTIONAL so existing
   *  fixtures stay byte-for-byte; absent ⇒ the read succeeded (or was never attempted). */
  featuresUnreadable?: boolean;
  /** 0358: when this org's full (hourly) sweep last completed under its lock; null = never / unknown. */
  lastFullSweepAt?: string | null;
  /** #1642: consecutive failed hourly runs since the last completed one; absent / unknown = 0. */
  fullSweepFailures?: number;
  /** 0642: when this org's native statement pass last PUBLISHED (its own marker, independent of the
   *  full run); null = never / unknown. Optional so existing cycle fixtures stay byte-for-byte. */
  lastStatementPassAt?: string | null;
  /** #2149, this tick only: an ERP request for this org failed or its answer stopped part-way (set by `orgErpFetch`). */
  erpUnanswered?: boolean;
  /** #2149, this tick only (set by `runErpSweepCycle`): true once the money passes must start no new row for this
   *  org — its ERPNext did not answer, or a full minimum try no longer fits the invocation's budget. */
  stopNewMoneyRows?: () => boolean;
  /** #2149, this tick only (set by `runErpSweepCycle`): the invocation's one deadline, spent by `orgErpFetch`. */
  sweepBudget?: SweepBudget;
}

/** #2149: the most one try (one ERP request attempt) is given: what the client gives one attempt. */
export const SWEEP_TRY_CAP_MS = ERP_REQUEST_TIMEOUT_MS;
/** #2149: the shortest full try: one recovery-probe attempt. No try, row or pass starts with less than this left. */
export const SWEEP_MIN_TRY_MS = ERP_PROBE_TIMEOUT_MS;
/** #2149: the time kept after every try for writing what it produced (the outbox outcome, a mirror stamp, a hold). */
export const SWEEP_OUTCOME_WRITE_MARGIN_MS = 10_000;
/** #2149: the time a durable "write started" stage write may take before its write's try is checked again. */
export const SWEEP_STAGE_WRITE_ALLOWANCE_MS = 5_000;

/** #2149: one invocation's deadline and clock; `setTimer` is injectable so the budget runs on a fake clock in tests. */
export interface SweepBudget {
  deadlineAtMs: number;
  nowMs: () => number;
  setTimer?: (fire: () => void, ms: number) => () => void;
  /** The client's retry wait; injectable for the fake clock. */
  sleep?: (ms: number) => Promise<void>;
}

/** #2149: the budget refused or cut a try. Our own stop, not ERPNext's silence; the work is left for the next pass. */
export class SweepDeadlineError extends Error {
  constructor(detail: string) {
    super(`sweep-deadline: ${detail}; left for the next pass`);
    this.name = 'SweepDeadlineError';
  }
}

/** #2149: the timeout a try starting now gets: min(the cap, time left − the outcome-write margin). */
export function sweepTryTimeoutMs(budget: SweepBudget): number {
  return Math.min(SWEEP_TRY_CAP_MS, budget.deadlineAtMs - budget.nowMs() - SWEEP_OUTCOME_WRITE_MARGIN_MS);
}

/** #2149: whether a full minimum try still fits. No budget (outside a sweep tick) spends nothing, so it always fits. */
export function sweepTryFits(budget: SweepBudget | undefined): boolean {
  return budget === undefined || sweepTryTimeoutMs(budget) >= SWEEP_MIN_TRY_MS;
}

const realTimer = (fire: () => void, ms: number): (() => void) => {
  const id = setTimeout(fire, ms);
  return () => clearTimeout(id);
};

/** Re-wraps a response so `onEnd` runs exactly once: when its body has been read to the end (no error), has failed
 *  (the error), or is cancelled by the caller (no error). A redirect, whose body the client never reads, ends at once. */
function observeBody(res: Response, onEnd: (err?: unknown) => void): Response {
  let ended = false;
  const end = (err?: unknown) => { if (!ended) { ended = true; onEnd(err); } };
  // A response with no body to read (or one the Response constructor cannot rebuild) has nothing left to wait for.
  if (!res.body || res.type === 'opaqueredirect' || res.status < 200 || res.status > 599 || (res.status >= 300 && res.status < 400) ||
    [204, 205, 304].includes(res.status)) {
    end();
    return res;
  }
  const reader = res.body.getReader();
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(c) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (err) {
        end(err);
        if (!cancelled) c.error(err);
        return;
      }
      // A read that lands after the caller cancelled has nowhere to go: the stream is already closed.
      if (cancelled) return;
      if (chunk.done) { end(); c.close(); } else c.enqueue(chunk.value);
    },
    cancel: (reason) => { cancelled = true; end(); return reader.cancel(reason); },
  });
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

/**
 * #2149: spends the invocation's one deadline. A try that cannot get a full minimum is refused before anything is
 * sent. A try with less than the cap left is aborted at time left − the outcome-write margin, body read included, so
 * the total of all tries never passes the deadline and the outcome write always has its margin. The client classifies
 * a refused or cut try as retryable `external-unreachable`: for a create the dispatch marks nothing and the reconciler
 * owns the row (ADR-0058 §4), the same path as the claim-budget refusal.
 */
export function budgetErpFetch(inner: typeof fetch, budgetOf: () => SweepBudget | undefined): typeof fetch {
  return async (input, init) => {
    const budget = budgetOf();
    if (!budget) return inner(input, init);
    const timeoutMs = sweepTryTimeoutMs(budget);
    if (timeoutMs < SWEEP_MIN_TRY_MS) throw new SweepDeadlineError('no full ERP try fits the invocation\'s remaining time');
    // With the full cap left, the client's own per-attempt deadline is the whole bound.
    if (timeoutMs >= SWEEP_TRY_CAP_MS) return inner(input, init);
    const controller = new AbortController();
    let cancel: (() => void) | undefined = (budget.setTimer ?? realTimer)(
      () => controller.abort(new SweepDeadlineError(`an ERP try reached the invocation's deadline after ${timeoutMs}ms`)),
      timeoutMs,
    );
    const settle = () => { cancel?.(); cancel = undefined; };
    const callerSignal = (init as RequestInit | undefined)?.signal;
    const signal = callerSignal ? AbortSignal.any([callerSignal, controller.signal]) : controller.signal;
    let res: Response;
    try {
      res = await inner(input, { ...(init as RequestInit | undefined), signal });
    } catch (err) {
      settle();
      throw err;
    }
    return observeBody(res, settle);
  };
}

/** #2149: whether the money passes may start no new row for this org on this tick (see `OrgBinding.stopNewMoneyRows`). */
export function moneyRowsStopped(org: { stopNewMoneyRows?: () => boolean }): boolean {
  return org.stopNewMoneyRows?.() === true;
}

/**
 * #2149: wraps an ERP fetch so a request that gets no complete answer calls `onUnanswered`: the request itself failed
 * (network failure, or its deadline aborted it), or the body stopped before its end. An answer with an error status is
 * an answer. A destination refusal is our own check, not ERPNext's silence. The caller sees exactly the same response
 * or failure.
 */
export function watchErpAnswer(inner: typeof fetch, onUnanswered: () => void): typeof fetch {
  // Our own refusals are not ERPNext's silence: a destination refusal, and the invocation budget's stop (#2149).
  const ourOwnStop = (err: unknown, init: RequestInit | undefined) =>
    (err instanceof Error && err.message === 'ERPNext destination is not permitted') || err instanceof SweepDeadlineError ||
    init?.signal?.reason instanceof SweepDeadlineError;
  return async (input, init) => {
    let res: Response;
    try {
      res = await inner(input, init);
    } catch (err) {
      if (!ourOwnStop(err, init as RequestInit | undefined)) onUnanswered();
      throw err;
    }
    return observeBody(res, (err) => {
      if (err !== undefined && !ourOwnStop(err, init as RequestInit | undefined)) onUnanswered();
    });
  };
}

/**
 * #2149: the fetch and the retry wait for one ERP client of an org's sweep passes. A wait (backoff or `Retry-After`)
 * after which no full try would fit is not spent, and from then on this client's tries are refused unsent and its
 * waits end at once: the invocation is within that wait of its last try, so nothing it could still start would fit
 * the time the server asked for. Waits therefore never carry the tries past the budget either. `writeMayStart` tells
 * an adapter, before it records a durable "write started" stage, whether that write would still be sent. One per client.
 */
export function orgErpTransport(org: OrgBinding): {
  fetchImpl: typeof fetch; sleep: (ms: number) => Promise<void>; writeMayStart: () => boolean;
} {
  let waitSkipped = false;
  const fetchImpl = orgErpFetch(org);
  return {
    fetchImpl: (input, init) => waitSkipped
      ? Promise.reject(new SweepDeadlineError('no full ERP try fits after the wait the client asked for'))
      : fetchImpl(input, init),
    sleep: (ms) => {
      const budget = org.sweepBudget;
      if (waitSkipped || (budget && !sweepTryFits({ ...budget, nowMs: () => budget.nowMs() + ms }))) {
        waitSkipped = true;
        return Promise.resolve();
      }
      return (budget?.sleep ?? ((t: number) => new Promise<void>((r) => setTimeout(r, t))))(ms);
    },
    // A write that records a durable "started" stage first must still get a full try after that stage write.
    writeMayStart: () => {
      const budget = org.sweepBudget;
      return !waitSkipped && (!budget || sweepTryFits({ ...budget, nowMs: () => budget.nowMs() + SWEEP_STAGE_WRITE_ALLOWANCE_MS }));
    },
  };
}

/** #2149: the guarded ERP fetch for one org's sweep passes: it spends the tick's budget, and a request ERPNext does not
 *  answer marks the org for this tick. */
export function orgErpFetch(org: OrgBinding): typeof fetch {
  // The budget is read per request: clients are built during the passes, and the tick sets it before they run.
  return budgetErpFetch(watchErpAnswer(guardedErpFetch(org.siteUrl), () => { org.erpUnanswered = true; }), () => org.sweepBudget);
}

/** Re-read ONE ERP doc in full (Luna BLOCK 6) — the list endpoint omits child tables, and a Receive
 *  Payment Entry's `references` child rows carry the Sales Invoice link the money read-model needs. */
export async function fetchErpDoc(client: ErpClientDeps, doctype: string, name: string): Promise<Record<string, unknown>> {
  const body = await erpnextRequest(client, {
    method: 'GET',
    path: `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`,
  });
  return ((body as { data?: Record<string, unknown> } | null)?.data ?? {}) as Record<string, unknown>;
}

// #651 / ADR-0072: ONE resolver for both directions — `_shared/erpAuthPair.ts`. The inline Vault-first
// block that used to live here (and its env-fallback-on-vault-error) is gone: a store that cannot answer
// now refuses (FR-ENA-018). `cache` is optional so the per-pass unit tests keep their two-arg call.
export async function erpClientForBinding(
  serviceClient: SupabaseClient,
  org: OrgBinding,
  cache?: ErpAuthPairCache,
): Promise<ErpClientDeps> {
  const { apiKey, apiSecret } = await resolveErpAuthPair(serviceClient, org, cache);
  return { ...orgErpTransport(org), apiKey, apiSecret, baseUrl: org.siteUrl };
}

/** 0357: the org's `failed` outbox rows still waiting out their retry delay (not due, not exhausted). */
export async function listRetryPendingLive(serviceClient: SupabaseClient, orgId: string): Promise<ReadonlySet<string>> {
  const { data, error } = await serviceClient.rpc('outbox_retry_pending', { p_org_id: orgId });
  if (error) throw new AppError(error.message, error.code);
  return new Set(((data as unknown[] | null) ?? []).map(String));
}

/** The outbox-recovery listCandidates RPC wrapper (camelCase → OutboxRow). */
export function listCandidatesLive(serviceClient: SupabaseClient): ListOutboxCandidates {
  return async (orgId: string) => {
    const { data, error } = await serviceClient.rpc('outbox_reconcile_candidates', { p_org_id: orgId });
    if (error) throw new AppError(error.message, error.code);
    const rows = (data as Array<Record<string, unknown>> | null) ?? [];
    return rows.map(outboxRowOf);
  };
}

/** THEME-BACK-06 (0427): stamp the row a queue pass is about to start (#2149: at its turn, never the
 *  whole batch), so the next tick serves the rows it did not reach first. Written for rows that are skipped, waiting or failing too — that is the point. */
export async function stampQueueAttempt(serviceClient: SupabaseClient, table: string, orgId: string, column: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await serviceClient.from(table)
    .update({ last_attempt_at: new Date().toISOString() }).eq('org_id', orgId).in(column, ids);
  if (error) throw new AppError(error.message, error.code);
}

/** The queues' fair order, as a comparator over the rows' own keys: never attempted first, then the
 *  longest-waiting, then the oldest, then id (the same total order the SQL `order by` uses). */
export function byQueueFairness(a: { last_attempt_at?: string | null; created_at?: string | null; id?: string | null }, b: { last_attempt_at?: string | null; created_at?: string | null; id?: string | null }): number {
  return (a.last_attempt_at ?? '').localeCompare(b.last_attempt_at ?? '')
    || (a.created_at ?? '').localeCompare(b.created_at ?? '')
    || (a.id ?? '').localeCompare(b.id ?? '');
}
