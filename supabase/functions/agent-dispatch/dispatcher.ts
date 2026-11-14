/**
 * dispatcher.ts — pure tick orchestration for the agent-dispatch edge fn (ADR-0044 §2).
 * selectDueSchedules/selectTriggerMatches run the dispatcher's selection queries under the
 * service_role client, quarantined to metadata enumeration only (FR-AAN-014, NFR-AAN-SEC-002) —
 * never business data. Importable in Vitest (REC-1); no Deno globals here.
 */
import { cronMatches } from './cron.ts';
import { readWatermark, advanceWatermark } from './watermark.ts';
import { isAllowedTriggerSource } from './triggerSources.ts';
import { mintOwnerJwt, auditMint, type AuthAdminLike, type MintedSession } from './mint.ts';
import { fireAutomation, type FireHandler } from './fire.ts';
import { evaluateCondition, makeConditionMemo, peekConditionVerdict, type ConditionMemo } from './condition.ts';
import type { ModelClient } from '../_shared/modelClient.ts';
import { logStructuredError } from '../_shared/errorLog.ts';
import { recordErrorEvent } from '../_shared/errorEvent.ts';
import { recordTrustedUsage } from '../_shared/usage.ts';

/** The minimal automation-row shape the dispatcher's selection queries need. */
export interface AutomationRow {
  id: string;
  kind: 'schedule' | 'trigger';
  owner_id: string;
  /**
   * The automation's tenant (gpt-5.5 audit #1). Carried so a trigger automation is ONLY ever matched
   * to source events of its OWN org — a background run is a deputy for exactly one tenant, and
   * cross-org event content must never reach its condition model or its fire. It is `agent_automations.org_id`,
   * selected under service_role for metadata enumeration; the FIRED run's org is still pinned by RLS
   * (the minted owner JWT), this is the SELECTION-time tenancy gate.
   */
  org_id: string;
  prompt: string;
  schedule?: string | null;
  trigger_on?: { source: string; event: string } | null;
  condition?: string | null;
  enabled: boolean;
  archived_at?: string | null;
  timeout_s?: number;
  /** Row creation time (selected by selectEnabledTriggers only): an organization with no cursor row
   * yet starts polling at the earliest created_at among its OWN enabled trigger automations for the
   * source — never from the beginning of history (issue 2255). */
  created_at?: string;
}

/**
 * The minimal Supabase-client-like shape the dispatcher needs from its injected service_role client.
 * `.rpc()` is used for select_trigger_events (SEC-HIGH-2) — the org-correct event-selection RPC that
 * REPLACES the direct service_role read of the tenant `procurement_status_events` table. `.from()` stays
 * for the metadata-only tables (agent_automations, agent_dispatch_watermarks) — never business data.
 */
export interface ServiceClientLike {
  from: (table: string) => unknown;
  rpc?: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
}

/**
 * selectDueSchedules — reads enabled, non-archived kind='schedule' automations under service_role
 * (agent_automations metadata only), then filters in-JS by cronMatches against `now` (FR-AAN-011,
 * AC-AAN-021). Cron matching is done in-JS, not SQL, because pg_cron-syntax parsing in a SQL
 * predicate is not portable — the DB predicate narrows to enabled/live/schedule-kind only.
 *
 * Determinism note (item 11): no explicit `.order()` here. Postgres does not guarantee row order
 * without one, but it is a non-issue for correctness: every returned row is filtered independently
 * (cronMatches) and, in runDispatchTick, EVERY due automation is attempted regardless of order
 * (item 2's per-unit try/catch means unit N's outcome never depends on unit N-1's). Row order would
 * only matter if the fire loop had an early-exit or shared cross-unit state, which it does not.
 */
export async function selectDueSchedules(sb: ServiceClientLike, now: Date): Promise<AutomationRow[]> {
  const builder = sb.from('agent_automations') as {
    select: (cols: string) => {
      eq: (col: string, val: unknown) => {
        eq: (col: string, val: unknown) => {
          is: (col: string, val: null) => Promise<{ data: AutomationRow[] | null; error: unknown }>;
        };
      };
    };
  };
  const { data, error } = await builder
    // Trimmed from '*' to AutomationRow's 11 fields (drops created_at, updated_at,
    // last_fired_at — verified unread from returned rows; last_fired_at is a WHERE arg
    // only in the claim path, not this read).
    .select('id,kind,owner_id,org_id,prompt,schedule,trigger_on,condition,enabled,archived_at,timeout_s')
    .eq('kind', 'schedule')
    .eq('enabled', true)
    .is('archived_at', null);

  // I-COLPROJ (2026-07-28 review): a real query error must be DISTINGUISHABLE from "nothing is due
  // right now" — the two were previously coalesced (`error || !data`), so a query failure (a drifted
  // column list raising 42703, a connectivity blip, an RLS/grant regression) silently looked
  // IDENTICAL to the empty case, forever: every scheduled automation would just stop firing with no
  // log line anywhere to diagnose it from. Fail-safe behavior is unchanged (still returns []) — only
  // the visibility changes.
  if (error) {
    logStructuredError({ fn: 'agent-dispatch', errorCode: 'SELECT_DUE_SCHEDULES_FAILED' });
    return [];
  }
  if (!data) return [];
  return data.filter((row) => row.schedule && cronMatches(row.schedule, now));
}

/**
 * A status-event row from a trigger source table (e.g. procurement_status_events), projected to the
 * MINIMAL column set the dispatcher needs (gpt-5.5 audit #2). The select_trigger_events RPC returns
 * exactly this projection: id + created_at (the watermark cursor), to_status (the trigger match key),
 * and org_id (the cross-org tenancy gate). No wide `[key: string]: unknown` — an unforeseen column
 * must never silently flow into a model prompt. This is the RPC's `returns table (...)` shape.
 */
export interface StatusEventRow {
  id: string;
  created_at: string;
  to_status?: string;
  org_id: string;
}

/** The exact minimal column projection returned by select_trigger_events (gpt-5.5 audit #2). */
export const TRIGGER_EVENT_COLUMNS = 'id, created_at, to_status, org_id';

/** One (org_id, event) filter pair passed to select_trigger_events — the org-correct match key. */
interface TriggerFilter {
  org_id: string;
  event: string;
}

export interface TriggerMatch {
  automation: AutomationRow;
  event: StatusEventRow;
}

/**
 * selectTriggerMatches — poll-since-watermark event-trigger selection (ADR-0044 §2, FR-AAN-012).
 * For each distinct (trigger_on.source, organization) pair among the given enabled kind='trigger'
 * automations, it reads that organization's cursor, then calls the SECURITY DEFINER
 * `select_trigger_events` RPC (migration 0054) with the compound cursor + the exact set of
 * (org_id, event) pairs its automations need. The RPC returns ONLY events that match one of those
 * pairs on BOTH org_id AND to_status and are strictly after the cursor — so a cross-org event is
 * never returned to the edge fn at all. It then pairs each returned event back to its matching
 * automation(s), sharing MAX_TRIGGER_EVENTS_PER_TICK across the organizations fairly. Does NOT
 * advance the watermark — that is the caller's (runDispatchTick) responsibility, AFTER the batch,
 * so a failed tick does not skip events.
 *
 * SEC-HIGH-2 (the architectural belt): the dispatcher no longer reads the tenant business table
 * `procurement_status_events` under service_role. The RPC is the ENFORCEMENT authority — the raw table
 * is never materialised in the edge fn, only the org-correct projection the RPC computed. service_role
 * still INVOKES the RPC (fine — the RPC does the org-correct filtering internally, and grants execute
 * only to service_role, ADR-0036 §2 / NFR-AAN-SEC-002).
 *
 * The compound (created_at, id) watermark cursor + the (org_id, to_status) match now live in SQL
 * (gpt-5.5 audit #5/#1). We KEEP the in-JS org gate below as defense-in-depth (belt AND suspenders):
 * even though the RPC can only return org-correct rows, the pairing loop re-asserts
 * `event.org_id === automation.org_id` so a future RPC regression (or a hand-mocked client) can never
 * silently cross-match. The gate is now redundant WITH a correct RPC, but cheap and load-bearing if
 * the RPC ever changed — so it stays.
 */
/**
 * Events judged per tick, across ALL organizations on the source. A burst costs a condition model call,
 * a mint and a credit hold per event, serially; the cap keeps one tick inside its wall clock. The cap is
 * the tick TOTAL shared fairly: organizations with pending events split it evenly (minimum one event
 * each), and an organization that cannot use its share leaves it to the others in time order — a burst
 * from one organization never delays another's single event past the first tick (ADR-0101's shared-
 * resource fairness rule; issue 2255). Each organization's own backlog beyond its share is picked up by
 * the next tick: that organization's cursor only advances to its last attempted event.
 */
export const MAX_TRIGGER_EVENTS_PER_TICK = 20;

/**
 * How long a claim may stay unsettled before another tick may take it over. A tick killed between the claim
 * and the fire leaves the event claimed; once the lease has passed, one tick re-claims it. Covers the
 * pre-fire stages only (mint, audit, credit hold, condition call): the claim is settled when the fire starts.
 */
export const TRIGGER_CLAIM_LEASE_MS = 5 * 60_000;

export async function selectTriggerMatches(
  sb: ServiceClientLike,
  _now: Date,
  triggerAutomations: AutomationRow[],
): Promise<TriggerMatch[]> {
  // Group the source's automations per organization (ADR-0101, issue 2255): each organization polls
  // the shared event log with its OWN filters and its OWN cursor, so one organization's activity can
  // neither walk over another's event window (entitlement gate, below) nor consume another's budget
  // share (the round-robin split further down).
  const bySourceOrg = new Map<string, AutomationRow[]>();
  for (const automation of triggerAutomations) {
    if (automation.kind !== 'trigger' || !automation.trigger_on) continue;
    // A trigger automation is always org-scoped (AutomationRow.org_id): without an org there is no
    // per-organization cursor to read and no org-correct filter to send — skip rather than fall back
    // to a shared cursor.
    if (!automation.org_id) continue;
    const key = `${automation.trigger_on.source}\u0000${automation.org_id}`;
    const list = bySourceOrg.get(key) ?? [];
    list.push(automation);
    bySourceOrg.set(key, list);
  }

  const matches: TriggerMatch[] = [];
  // Each organization's pending events for the tick, keyed `${source}\u0000${org_id}` — filled by the
  // per-organization selection loop below, consumed by the fair-share budget split after it.
  const pendingBySourceOrg = new Map<string, StatusEventRow[]>();

  for (const [key, automations] of bySourceOrg) {
    const [source, orgId] = key.split('\u0000');
    // SECURITY HIGH-1 (defense-in-depth): hard-gate `source` against the SAME TRIGGER_SOURCES allowlist
    // validateCreateAutomation checks at write time, BEFORE any RPC call. The RPC itself also allowlists
    // the source (returning zero rows for a non-allowlisted one), but skipping here keeps the gate
    // trivially auditable and avoids a needless round-trip for a source that can never match.
    if (!isAllowedTriggerSource(source)) {
      console.warn('[agent-dispatch] skipping non-allowlisted trigger_on.source', { source });
      continue;
    }

    // This organization's own cursor (issue 2255). An organization with no cursor row yet starts at the
    // earliest created_at among its OWN enabled trigger automations for this source — the reactive
    // forward-looking posture (an automation does not backfill events older than itself), never from
    // the beginning of history.
    const wm = await readWatermark(sb, source, orgId);
    const noCursorSince = automations
      .map((automation) => automation.created_at)
      .filter((at): at is string => typeof at === 'string')
      .sort()[0];
    const lastSeenAt = wm?.lastSeenAt ?? noCursorSince ?? null;
    const lastSeenId = wm?.lastSeenId ?? null;

    // Build THIS organization's (org_id, event) filter set for the RPC — deduped, so N automations
    // sharing an (org, event) pair produce one filter. The RPC returns ONLY events matching one of
    // these pairs, so a cross-org event never crosses the trust boundary into the edge fn (SEC-HIGH-2).
    const filters = dedupeFilters(automations);
    if (filters.length === 0) continue;

    if (typeof sb.rpc !== 'function') {
      // Defensive: the dispatcher's service client must expose .rpc for select_trigger_events. A client
      // without it cannot select events safely — skip rather than fall back to a raw table read.
      console.warn('[agent-dispatch] service client has no .rpc — cannot select trigger events', { source });
      continue;
    }
    const { data, error } = await sb.rpc('select_trigger_events', {
      p_source: source,
      p_last_seen_at: lastSeenAt,
      p_last_seen_id: lastSeenId,
      p_filters: filters,
    });
    if (error) {
      logStructuredError({ fn: 'agent-dispatch', errorCode: 'SELECT_TRIGGER_EVENTS_FAILED', contextId: `${source}:${orgId}` });
      continue;
    }
    if (!data) continue;
    // ponytail: the RPC returns this organization's WHOLE pending backlog (unbounded rows, in the
    // RPC's (created_at,id) order); the round-robin budget split below keeps the tick bounded at
    // MAX_TRIGGER_EVENTS_PER_TICK across all organizations. Add a limit parameter to
    // select_trigger_events when one organization's backlog grows large enough for the transfer
    // itself to matter.
    const orgPending = data as StatusEventRow[];

    pendingBySourceOrg.set(key, orgPending);
  }

  // ── Fair-share budget split (ADR-0101 shared-resource fairness, issue 2255) ──
  // MAX_TRIGGER_EVENTS_PER_TICK is the tick TOTAL per source. Organizations with pending events (in
  // time order by their earliest pending event) take turns round-robin: each pass gives every
  // still-pending organization one slot — an even integer split with a minimum of one event each —
  // and an organization whose backlog is exhausted stops taking slots, leaving its unused share to
  // the others in that same time order. A single organization alone takes the whole budget, exactly
  // as the shared-cursor design did; each organization's remaining backlog is picked up next tick.
  type OrgQueue = { orgId: string; automations: AutomationRow[]; pending: StatusEventRow[]; idx: number };
  const queuesBySource = new Map<string, OrgQueue[]>();
  for (const [key, automations] of bySourceOrg) {
    const [source, orgId] = key.split('\u0000');
    const queues = queuesBySource.get(source) ?? [];
    queues.push({ orgId, automations, pending: pendingBySourceOrg.get(key) ?? [], idx: 0 });
    queuesBySource.set(source, queues);
  }

  for (const [source, queues] of queuesBySource) {
    const withPending = queues
      .filter((queue) => queue.pending.length > 0)
      .sort((a, b) => {
        const ea = a.pending[0];
        const eb = b.pending[0];
        if (ea.created_at !== eb.created_at) return ea.created_at < eb.created_at ? -1 : 1;
        return ea.id < eb.id ? -1 : ea.id > eb.id ? 1 : 0;
      });
    if (withPending.length === 0) continue;

    const selected: StatusEventRow[] = [];
    let assigned = 0;
    while (assigned < MAX_TRIGGER_EVENTS_PER_TICK) {
      let progressed = false;
      for (const queue of withPending) {
        if (assigned >= MAX_TRIGGER_EVENTS_PER_TICK) break;
        if (queue.idx < queue.pending.length) {
          selected.push(queue.pending[queue.idx]);
          queue.idx += 1;
          assigned += 1;
          progressed = true;
        }
      }
      if (!progressed) break;
    }

    for (const event of selected) {
      for (const automation of queues.flatMap((queue) => queue.automations)) {
        // Defense-in-depth cross-org gate (gpt-5.5 audit #1): the RPC already guarantees org-correct
        // rows, but re-assert `event.org_id === automation.org_id` so a future RPC regression or a
        // hand-mocked client can never silently cross-match. Deny unless BOTH orgs are present AND equal
        // (`null !== null` is false in JS — two null-org rows must never cross-match).
        if (!automation.org_id || !event.org_id || automation.org_id !== event.org_id) continue;
        if (automation.trigger_on?.event === event.to_status) {
          matches.push({ automation, event });
        }
      }
    }
  }

  return matches;
}

/** Filter the org-scoped automation metadata through the shared entitlement resolver before
 * polling events, claiming fires, minting owners, or advancing trigger watermarks. */
async function enabledFeatureAutomations(
  sb: ServiceClientLike,
  automations: AutomationRow[],
): Promise<AutomationRow[]> {
  if (typeof sb.rpc !== 'function') return [];
  const orgIds = [...new Set(automations.map((automation) => automation.org_id).filter(Boolean))];
  const enabledOrgs = new Set<string>();
  for (const orgId of orgIds) {
    const { data, error } = await sb.rpc('service_feature_enabled', { p_org_id: orgId, p_key: 'agent_assistant' });
    if (error) {
      logStructuredError({ fn: 'agent-dispatch', errorCode: 'FEATURE_SWITCH_UNREADABLE' });
      continue;
    }
    if (data === true) enabledOrgs.add(orgId);
  }
  return automations.filter((automation) => enabledOrgs.has(automation.org_id));
}

/** Dedupe the (org_id, trigger_on.event) filter pairs across a source's automations for the RPC. */
function dedupeFilters(automations: AutomationRow[]): TriggerFilter[] {
  const seen = new Set<string>();
  const filters: TriggerFilter[] = [];
  for (const a of automations) {
    const orgId = a.org_id;
    const event = a.trigger_on?.event;
    if (!orgId || !event) continue;
    const key = `${orgId}\u0000${event}`;
    if (seen.has(key)) continue;
    seen.add(key);
    filters.push({ org_id: orgId, event });
  }
  return filters;
}

// ── runDispatchTick — the per-tick orchestration (ADR-0044 §2/§3, the safety core) ──────────────

/**
 * Credit preflight seam (REC-4, issue-3 shipped: `_shared/creditRateGuard.ts`). The dispatcher
 * checks the OWNER's balance before firing; over-budget ⇒ no-start + a warning notification
 * (FR-AAN-032/033, ADR-0044 §6). `check`'s optional second arg is the MINTED OWNER CLIENT — the
 * real `createCreditRateGuard({ supabase })` factory computes the balance under whatever client it
 * is constructed with (`credits`/`agent_usage` rows are owner-RLS-scoped), so `index.ts` builds the
 * guard per-automation with the minted client (never service_role — the deputy invariant extends to
 * the credit read, NFR-AAN-SEC-002). A no-op guard (always `{ exceeded: false }`) ignores the arg.
 * Structurally compatible with handler.ts's interactive `RateGuard`.
 */
export interface DispatchRateGuard {
  /** `reservationId` selects the atomic reserve path (a unique id per unit of work); `release` drops it. */
  check(orgId: string, mintedClient?: unknown, reservationId?: string): Promise<{ exceeded: boolean; retryAfterSeconds?: number; reason?: 'out_of_credits' | 'meter_error' }>;
  release?(mintedClient: unknown, reservationId: string): Promise<void>;
}

/**
 * The full dep bag for one dispatcher tick. service_role appears ONLY on `serviceClient` (selection
 * + watermark + last_fired_at metadata) and `authAdmin` (mint) — never for business data. The fired
 * run runs under the MINTED owner client, never these. (§4 type-consistency guard.)
 */
export interface RunDispatchTickDeps {
  /** service_role client — quarantined to {agent_automations, agent_dispatch_watermarks, <sources>}. */
  serviceClient: ServiceClientLike;
  /** Supabase Auth admin — used ONLY to mint (never a .from() business query). */
  authAdmin: AuthAdminLike;
  /**
   * Exchanges the generateLink hashed_token for an owner session (anon-key `auth.verifyOtp`).
   * generateLink returns a token_hash, never an access_token — the token must be verified. Passed
   * straight through to mintOwnerJwt (mint.ts).
   */
  verifyOtp: (params: { type: 'magiclink'; token_hash: string }) => PromiseLike<{
    data: { session: { access_token?: string } | null } | null;
    error: unknown;
  }>;
  /** Builds the caller-JWT-scoped client from a minted access token (mint.ts). */
  buildClient: (accessToken: string) => unknown;
  /** The real agentChatHandler (the SAME loop as interactive) — injected (REC-1, no Deno coupling). */
  handler: FireHandler;
  /** Chat-tier model client + id for the fired run. */
  modelClient: unknown;
  model: string;
  /** Cheap-tier model client + id for NL condition evaluation (§4, FR-AAN-021). */
  conditionModel: Pick<ModelClient, 'create'>;
  conditionModelId: string;
  /** Credit preflight (REC-4) — no-op until issue-3. */
  rateGuard?: DispatchRateGuard;
  /** Injected clock (testable). */
  now: () => Date;
  /** Injected run-id + minted-at generators (testable determinism). */
  newRunId?: () => string;
  newMintedAt?: () => string;
  /** Optional in-invocation condition memo (defaults fresh per tick). */
  conditionMemo?: ConditionMemo;
  /** Opaque HandlerDeps passthrough (can/composeEnabled) — index.ts constructs these. */
  handlerExtras?: Record<string, unknown>;
  /**
   * Optional per-fire persistence-deps factory (FR-AAN-020). Called with the MINTED owner client so
   * the fired run's events persist as an ordinary run under owner RLS (never service_role). auditMint
   * already created the run's thread/run + the seq-0 audit event, so the returned deps set
   * `startSeq: 1` and rely on `runId` being present (handler skips createThreadAndRun on a resume).
   * Undefined ⇒ no persistence (unit tests + a persistence-off env), a no-op by construction.
   */
  buildPersistence?: (mintedClient: unknown, ownerId: string, runId: string) => Record<string, unknown>;
}

function genId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}

/**
 * Insert an owner notification via the MINTED owner client (RLS pins owner_id/org_id via DEFAULT —
 * never sent). Used for the fail-quiet-but-visible warning paths (condition-unevaluable §4;
 * over-credit §6).
 *
 * FR-HRD-020: a notify failure must not abort the tick, but it must NOT be silent either. Both
 * supabase-js failure modes are handled — the resolve-with-`error` shape (the ordinary one, which
 * the previous bare `catch {}` could never see) and a thrown rejection. Returns whether the
 * notification landed; never throws — the caller decides what to do with a `false` (I5, 2026-07-28
 * review: it now feeds `recordErrorEvent` so the failure ALSO reaches the Telegram alert path, not
 * just the edge-function console log).
 *
 * `contextId` is the CALLER-SUPPLIED correlation id (e.g. `automation.id`) — errorLog.ts documents
 * this field as "an optional correlation id (runId / automationId / etc.)". It previously carried
 * the raw Postgres error code / `err.name` instead, which meant the structured log line could never
 * say WHICH automation's notification failed (I5).
 */
export async function notifyOwner(
  mintedClient: unknown,
  severity: 'info' | 'warning' | 'critical',
  title: string,
  body: string | null,
  metadata: Record<string, unknown> | null,
  contextId?: string,
): Promise<boolean> {
  try {
    const sb = mintedClient as { from: (t: string) => { insert: (r: Record<string, unknown>) => Promise<{ error: unknown }> } };
    const { error } = await sb.from('notifications').insert({ severity, title, body, metadata });
    if (error) {
      logStructuredError({ fn: 'agent-dispatch', errorCode: 'NOTIFY_INSERT_FAILED', contextId });
      return false;
    }
    return true;
  } catch {
    logStructuredError({ fn: 'agent-dispatch', errorCode: 'NOTIFY_INSERT_FAILED', contextId });
    return false;
  }
}

/**
 * runDispatchTick — orchestrate ONE dispatcher tick (ADR-0044 §2/§3):
 *   selection (schedule + trigger, under service_role, metadata-only) →
 *   per due automation:
 *     - trigger+condition ⇒ evaluateCondition (cheap model); false ⇒ skip; unevaluable ⇒ mint +
 *       warning notification, no fire;
 *     - credit preflight (owner balance); over ⇒ mint + warning notification, no fire;
 *     - mint owner JWT (D3) → auditMint (D3, establishes the run, BEFORE fire) → fireAutomation (D2,
 *       the SAME loop) → stamp last_fired_at (service_role, agent_automations metadata) →
 *   advance the trigger watermark AFTER the batch (FR-AAN-013 monotonic-after-success).
 *
 * The deputy invariant (NFR-AAN-SEC-001) holds by construction: service_role touches ONLY the
 * quarantined table set; the fired run touches business data ONLY under the minted owner client.
 */
export async function runDispatchTick(deps: RunDispatchTickDeps): Promise<void> {
  const now = deps.now();
  const newRunId = deps.newRunId ?? genId;
  const newMintedAt = deps.newMintedAt ?? (() => new Date().toISOString());
  // item 11: the condition memo MUST stay fresh per tick — a fresh Map() by default (never module-
  // or closure-level shared state across invocations). deps.conditionMemo exists ONLY as a same-tick
  // injection seam for tests; runDispatchTick must never be called twice sharing one memo across
  // separate ticks, or a condition verdict from a prior tick's TTL window could stale-serve into a
  // new tick and suppress a legitimate re-evaluation.
  const memo = deps.conditionMemo ?? makeConditionMemo();
  const rateGuard: DispatchRateGuard = deps.rateGuard ?? { check: async () => ({ exceeded: false }) };

  // ── Selection (service_role, metadata enumeration ONLY — FR-AAN-014) ──
  const selectedSchedules = await selectDueSchedules(deps.serviceClient, now);

  // Trigger automations: enumerate enabled/live kind='trigger' rows, then poll-since-watermark.
  const selectedTriggers = await selectEnabledTriggers(deps.serviceClient);
  // Resolve each org once across both kinds. A disabled or unreadable entitlement must leave its
  // schedules unclaimed and its trigger watermark untouched so work resumes after re-enable.
  const eligibleAutomations = await enabledFeatureAutomations(
    deps.serviceClient,
    [...selectedSchedules, ...selectedTriggers],
  );
  const eligibleIds = new Set(eligibleAutomations.map((automation) => automation.id));
  const dueSchedules = selectedSchedules.filter((automation) => eligibleIds.has(automation.id));
  const triggerAutomations = selectedTriggers.filter((automation) => eligibleIds.has(automation.id));
  const triggerMatches = await selectTriggerMatches(deps.serviceClient, now, triggerAutomations);

  // Track the max-ATTEMPTED event per (source, organization) to advance that organization's cursor
  // AFTER the batch (item 4/2: "attempted", not "matched-and-succeeded" — a unit that throws mid-fire
  // was still attempted against its event, so the cursor must still advance past it, or the same event
  // re-matches and double-fires next tick. Tracked as attempts are made, in the fire loop below.
  // An event whose claim failed operationally (not a duplicate) was NOT attempted: the cursor must stop
  // before the earliest such event so a recovered database re-selects it (existing claims keep it at-most-once).
  // Per organization (issue 2255): one organization's attempts or claim outage never move another's cursor.
  const attemptedBySourceOrg = new Map<string, Map<string, Array<{ id: string; at: string }>>>();
  const earliestUnclaimedBySourceOrg = new Map<string, Map<string, { id: string; at: string }>>();
  const isAfter = (a: { id: string; at: string }, b: { id: string; at: string }) =>
    a.at > b.at || (a.at === b.at && a.id > b.id);
  function markAttempted(source: string, orgId: string, event: StatusEventRow): void {
    const orgs = attemptedBySourceOrg.get(source) ?? new Map();
    const list = orgs.get(orgId) ?? [];
    list.push({ id: event.id, at: event.created_at });
    orgs.set(orgId, list);
    attemptedBySourceOrg.set(source, orgs);
  }
  function markUnclaimed(source: string, orgId: string, event: StatusEventRow): void {
    const orgs = earliestUnclaimedBySourceOrg.get(source) ?? new Map();
    const prev = orgs.get(orgId);
    const cur = { id: event.id, at: event.created_at };
    if (!prev || isAfter(prev, cur)) orgs.set(orgId, cur);
    earliestUnclaimedBySourceOrg.set(source, orgs);
  }

  // ── Fire each due automation through the minted-owner deputy path ──
  const scheduleUnits = dueSchedules.map((automation) => ({ automation, event: undefined as StatusEventRow | undefined }));
  const triggerUnits = triggerMatches.map(({ automation, event }) => ({ automation, event: event as StatusEventRow | undefined }));

  // A silent condition-false skip opened an audit thread/run (the mint must be audited before the
  // hold). Archive the thread so the owner's history stays clean and close the run; a failed close is
  // reported, never swallowed.
  const closeSilentAudit = async (audited: { minted: MintedSession; runId: string; threadId: string }, automation: AutomationRow): Promise<void> => {
    type Writer = { from(t: string): { update(p: object): { eq(c: string, v: string): PromiseLike<{ error: unknown }> } } };
    const sb = audited.minted.client as Writer;
    let failed: boolean;
    try {
      const thread = await sb.from('agent_threads').update({ archived_at: now.toISOString() }).eq('id', audited.threadId);
      const run = await sb.from('agent_runs').update({ status: 'completed' }).eq('id', audited.runId);
      failed = Boolean(thread.error || run.error);
    } catch {
      failed = true;
    }
    if (failed) {
      void recordErrorEvent(deps.serviceClient as never, {
        fn: 'agent-dispatch',
        errorCode: 'AUTOMATION_AUDIT_CLOSE_FAILED',
        contextId: automation.id,
        orgId: automation.org_id,
      });
    }
  };

  // A minted audit run that will never start (credit refused, condition unevaluable, audit write failed)
  // is closed 'errored' so the owner never sees a run stuck 'running'. Best-effort: a failed close is reported.
  const failRun = async (client: unknown, runId: string, automation: AutomationRow): Promise<void> => {
    type Writer = { from(t: string): { update(p: object): { eq(c: string, v: string): PromiseLike<{ error: unknown }> } } };
    let failed: boolean;
    try {
      failed = Boolean((await (client as Writer).from('agent_runs').update({ status: 'errored' }).eq('id', runId)).error);
    } catch {
      failed = true;
    }
    if (failed) {
      void recordErrorEvent(deps.serviceClient as never, {
        fn: 'agent-dispatch',
        errorCode: 'AUTOMATION_AUDIT_CLOSE_FAILED',
        contextId: automation.id,
        orgId: automation.org_id,
      });
    }
  };

  // Automations whose credit hold was refused this tick: the owner is told ONCE, and the rest of that
  // automation's events are skipped before they mint a session or take a hold.
  const creditBlocked = new Set<string>();

  // Item 2 (reliability): each unit runs in its own try/catch — one automation's throw must
  // neither kill the batch (the loop continues to the next unit) nor rewind/block the watermark
  // for events already attempted (markAttempted runs unconditionally once selection has committed
  // to attempting a trigger unit, BEFORE any step that can throw).
  for (const { automation, event } of [...scheduleUnits, ...triggerUnits]) {

    // Tracks which phase of the unit is in flight so the catch below can log a DISTINCT
    // errorCode per failure phase (claim vs mint vs audit vs fire) without changing any
    // control flow — set immediately before the call that can throw for that phase.
    // (cast: the helper closures below assign `stage`, which control-flow narrowing cannot see)
    let stage = 'claim' as 'claim' | 'condition' | 'mint' | 'audit' | 'fire';
    // The unit's mint (shared by audit, notify, credit hold and fire) and its credit hold id; the
    // finally below releases the hold whichever way the unit ends.
    let session: { minted: MintedSession; runId: string; threadId: string } | undefined;
    let holdId: string | undefined;
    // Set once this unit holds the (automation,event) claim; settled when the fire starts or the unit ends.
    let claimedFire: { automationId: string; eventId: string } | undefined;

    try {
      // ── AUDIT-M2 (2026-07-04 audit): schedule fires are CLAIMED atomically before any other
      // work. Overlapping ticks (a slow tick still running when the next pg_cron minute fires,
      // or a retried invocation) both see cronMatches()==true for the same minute; the
      // conditional last_fired_at UPDATE lets exactly ONE of them win. Claim-then-fire =
      // at-most-once per matched minute (a fire that then throws waits for the next cron
      // match rather than double-firing) — deliberately trading FR-AAN-015's
      // "stamp only on actual fire" for double-fire immunity on schedules.
      if (automation.kind === 'schedule') {
        const claimed = await claimScheduleFire(deps.serviceClient, automation.id, now);
        if (!claimed) continue;
      }

      // CRITICAL fix (2026-07-07): trigger fires are CLAIMED atomically before any other work.
      // Overlapping ticks or a failed watermark write can cause the same (automation_id,
      // event_id) to be selected and dispatched twice. The agent_automation_fires table
      // (migration 0078) enforces at-most-once via its UNIQUE (automation_id, event_id) primary
      // key. Claim-then-fire = at-most-once per (automation, event). A fire that then throws
      // still counts as claimed (it won't re-fire for that event), matching the schedule posture.
      if (automation.kind === 'trigger' && event) {
        const source = automation.trigger_on!.source;
        const claim = await claimTriggerFire(deps.serviceClient, automation.id, event.id, now);
        // 'busy' = another tick holds an unsettled claim inside its lease: not ours to fire, and not yet
        // settled, so the cursor must stop before it (it may need re-claiming once the lease passes).
        if (claim === 'error' || claim === 'busy') {
          markUnclaimed(source, automation.org_id, event);
          if (claim === 'error') logStructuredError({ fn: 'agent-dispatch', errorCode: 'AUTOMATION_CLAIM_FAILED', contextId: automation.id });
          continue;
        }
        markAttempted(source, automation.org_id, event);
        if (claim === 'claimed') claimedFire = { automationId: automation.id, eventId: event.id };
        if (claim === 'duplicate') continue;
      }
      if (creditBlocked.has(automation.id)) continue;
      // Mint ONCE per candidate — shared by audit, notify, credit reservation, and fire (one mint per
      // candidate, never a fresh mint per branch). A conditional trigger whose verdict is not memoized
      // mints BEFORE its condition is evaluated: the condition is a metered model call, so the org's
      // credit must be held first and that hold needs the owner's identity. A memoized verdict costs
      // no model call, so it mints only when it will fire or warn. Everything else mints only when it
      // will fire or notify.
      const ensureMinted = async (): Promise<{ minted: MintedSession; runId: string; threadId: string }> => {
        if (session) return session;
        stage = 'mint';
        const minted = await mintOwnerJwt(deps, automation);
        // ── Audit EVERY mint FIRST — before ANY other minted-client DB use (gpt-5.5 audit #3,
        // AC-AAN-017). Fail-closed — auditMint throws on failure, so a candidate whose audit cannot
        // be written never notifies, credits, or fires. ──
        const runId = newRunId();
        stage = 'audit';
        let threadId: string;
        try {
          threadId = await auditMint(minted.client, automation, runId, newMintedAt());
        } catch (err) {
          await failRun(minted.client, runId, automation); // no-op when the run row was never written
          throw err;
        }
        session = { minted, runId, threadId };
        return session;
      };

      // ── Credit reservation (ADR-0044 §6, FR-AAN-032/033). Held atomically under the MINTED OWNER
      // CLIENT against a fresh id and released in the finally below, whichever way the unit ends.
      // Over ⇒ warning notification, no fire, no agent_runs row reaches 'running'. A meter that
      // itself fails is reported as such (still fail-closed), never as an exhausted balance. ──
      const reserveCredit = async (mintedClient: unknown): Promise<boolean> => {
        const id = genId();
        const credit = await rateGuard.check(automation.org_id, mintedClient, id);
        if (!credit.exceeded) {
          holdId = id;
          return true;
        }
        creditBlocked.add(automation.id);
        if (session) await failRun(mintedClient, session.runId, automation);
        const meterDown = credit.reason === 'meter_error';
        const notified = await notifyOwner(
          mintedClient,
          'warning',
          meterDown ? 'Automation skipped — credit metering unavailable' : `Automation skipped — out of credits`,
          meterDown
            ? `Automation ${automation.id} did not run because credit metering is temporarily unavailable.`
            : `Automation ${automation.id} did not run because the balance was exceeded.`,
          { source: 'automation', automation_id: automation.id },
          automation.id,
        );
        if (!notified) {
          void recordErrorEvent(deps.serviceClient as never, {
            fn: 'agent-dispatch',
            errorCode: 'NOTIFY_INSERT_FAILED',
            contextId: automation.id,
            orgId: automation.org_id,
          });
        }
        return false; // no fire, no last_fired_at stamp.
      };

      // ── Trigger + NL condition FIRST — a silent condition-false skip (the common case) fires and
      // notifies nothing and leaves nothing in the owner's history. A memoized verdict is read before
      // anything is minted; otherwise the cheap-model call is credit-held before it is made and
      // recorded as trusted usage afterwards, whatever the verdict. ──
      let conditionWarning: string | null = null;
      if (automation.kind === 'trigger' && automation.condition && event) {
        let verdict = peekConditionVerdict(memo, now.getTime(), automation, event);
        if (!verdict) {
          const audited = await ensureMinted();
          stage = 'condition';
          if (!(await reserveCredit(audited.minted.client))) continue;
          verdict = await evaluateCondition(
            {
              model: deps.conditionModel,
              modelId: deps.conditionModelId,
              now: () => now.getTime(),
              memo,
              onResponse: (response) =>
                recordTrustedUsage(
                  { serviceClient: deps.serviceClient, userId: automation.owner_id, orgId: automation.org_id, runId: audited.runId },
                  response,
                  'automation',
                ),
            },
            automation,
            event,
          );
          if (!verdict.fire && !verdict.warning) {
            await closeSilentAudit(audited, automation);
            continue;
          }
        } else if (!verdict.fire && !verdict.warning) {
          continue; // memo hit, condition false: nothing was minted, held or written.
        }
        // Unevaluable ⇒ we must warn the owner; recorded here so the block below emits it.
        if (!verdict.fire) conditionWarning = verdict.warning ?? null;
      }

      const { minted, runId } = await ensureMinted();
      stage = 'fire';

      // Deferred unevaluable-condition warning (the mint is already audited above, so this notify is
      // never the first minted-client write). No fire follows.
      if (conditionWarning !== null) {
        const notified = await notifyOwner(
          minted.client, 'warning', 'Automation condition could not be evaluated', conditionWarning,
          { source: 'automation', automation_id: automation.id },
          automation.id,
        );
        // I5 (2026-07-28 review): a notify failure was previously visible ONLY in the edge-function
        // console log. Threading it through recordErrorEvent lands it in error_events, which IS the
        // Telegram alert path (0071/telegram-notify) — the owner is told via the channel this whole
        // path exists to guarantee, not left to whoever next reads Supabase function logs.
        if (!notified) {
          void recordErrorEvent(deps.serviceClient as never, {
            fn: 'agent-dispatch',
            errorCode: 'NOTIFY_INSERT_FAILED',
            contextId: automation.id,
            orgId: automation.org_id,
          });
        }
        await failRun(minted.client, runId, automation);
        continue;
      }

      // A conditional trigger already holds credit (taken before its condition ran); the rest hold it
      // here, strictly BEFORE any fire.
      if (holdId === undefined && !(await reserveCredit(minted.client))) continue;

      // ── Fire (the SAME loop) → stamp last_fired_at. The run was already audited above. ──

      const persistenceExtras = deps.buildPersistence
        ? { persistence: deps.buildPersistence(minted.client, automation.owner_id, runId) }
        : {};
      // FR-AUC-002/004/018 parity with interactive: usage recording is unconditional, under the
      // SAME minted owner client as the fire — one agent_usage row per model-call resolution,
      // scoped to the automation's owner (never service_role). usageAction='automation'
      // (ops-admin-surface S5, FR-USE-001) so a fired run's spend is distinguishable from an
      // interactive turn in org_usage_summary()/operator_usage_summary().
      const usageExtras = { usage: { serviceClient: deps.serviceClient }, usageAction: 'automation' as const };

      // Item 3 (reliability): timeout_s → an AbortController per automation. A coarse wall-clock
      // deadline on top of MAX_TOOL_ROUNDS — each automation gets its OWN controller so one fire's
      // timeout can never abort a sibling's in-flight run.
      // From here the event must never fire again: settle the claim BEFORE the fire. If that write fails the
      // fire does not start (fail-closed), and the lease lets a later tick retry the whole unit.
      if (claimedFire) {
        if (!(await settleTriggerFire(deps.serviceClient, claimedFire.automationId, claimedFire.eventId, now))) {
          throw new Error('claim settle failed');
        }
        claimedFire = undefined;
      }
      const timeoutMs = (automation.timeout_s ?? 120) * 1000;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        await fireAutomation({
          handler: deps.handler,
          mintedClient: minted.client,
          modelClient: deps.modelClient,
          model: deps.model,
          ownerId: automation.owner_id,
          automation,
          runId,
          signal: controller.signal,
          handlerExtras: { ...(deps.handlerExtras ?? {}), ...usageExtras, ...persistenceExtras },
        });
      } finally {
        clearTimeout(timer);
      }

      // FR-AAN-015: stamp last_fired_at on fire. Schedules were already stamped by their claim
      // (AUDIT-M2 above) — only triggers stamp here (watermark is their dedupe authority).
      if (automation.kind === 'trigger') {
        await stampLastFired(deps.serviceClient, automation.id, now.toISOString());
      }
    } catch {
      // Item 2 (reliability): isolate this unit's failure — log code-only (NFR-AAN-SEC-007/008,
      // never the prompt/condition text), continue to the next unit. The watermark for an
      // attempted trigger event has already been recorded above (markAttempted), independent of
      // this throw — so a re-thrown automation neither kills the batch nor causes the same event
      // to re-match (and double-fire) on the next tick.
      //
      // A DISTINCT errorCode per phase (mint vs audit vs fire) makes a stuck/never-fires
      // automation greppable by failure class, not just "automation failed" (harden #1).
      const errorCode =
        stage === 'mint'
          ? 'AUTOMATION_MINT_FAILED'
          : stage === 'audit'
            ? 'AUTOMATION_AUDIT_FAILED'
            : stage === 'fire'
              ? 'AUTOMATION_FIRE_FAILED'
              : stage === 'claim'
                ? 'AUTOMATION_CLAIM_FAILED'
                : 'AUTOMATION_CONDITION_FAILED';
      logStructuredError({ fn: 'agent-dispatch', errorCode, contextId: automation.id });
      // Cast: ServiceClientLike.from() returns `unknown` (a deliberately minimal metadata-only
      // interface, §41-47 above) but the real injected client structurally satisfies
      // ErrorEventSupabaseLike at runtime — the same documented cast pattern used elsewhere in
      // this file for the real supabase-js client (see index.ts's `as never` casts).
      void recordErrorEvent(deps.serviceClient as never, {
        fn: 'agent-dispatch',
        errorCode,
        contextId: automation.id,
        orgId: automation.org_id,
      });
    } finally {
      // A unit that ended without firing (condition false, credit refused, a throw) is decided: settle it so
      // it is not re-claimed. Best-effort; a lost write only means one re-evaluation after the lease.
      if (claimedFire) await settleTriggerFire(deps.serviceClient, claimedFire.automationId, claimedFire.eventId, now);
      if (holdId !== undefined && session) {
        try {
          await rateGuard.release?.(session.minted.client, holdId);
        } catch { /* a failed release only leaves the conservative hold; never kills the batch */ }
      }
    }
  }

  // ── Advance each organization's cursor AFTER the batch (FR-AAN-013 monotonic-after-success):
  // an organization's cursor advances over events whose automations were ALL attempted this tick,
  // regardless of whether the fire ultimately succeeded, threw, or was skipped (condition/credit) —
  // an attempted-but-failed event must never be re-selected and re-attempted next tick. Per
  // organization (issue 2255): an event another organization never attempted stays selectable.
  for (const [source, orgs] of attemptedBySourceOrg) {
    for (const [orgId, attempted] of orgs) {
      const stop = earliestUnclaimedBySourceOrg.get(source)?.get(orgId);
      const safe = stop ? attempted.filter((a) => isAfter(stop, a)) : attempted;
      if (safe.length === 0) continue;
      await advanceWatermark(deps.serviceClient, source, orgId, safe.reduce((m, a) => (isAfter(a, m) ? a : m)));
    }
  }
}

/**
 * Enumerate enabled, non-archived kind='trigger' automations (service_role metadata only).
 * Determinism note (item 11): no explicit `.order()` — see selectDueSchedules's note; the same
 * reasoning applies (selectTriggerMatches groups by source and matches independently per event).
 */
async function selectEnabledTriggers(sb: ServiceClientLike): Promise<AutomationRow[]> {
  const builder = sb.from('agent_automations') as {
    select: (cols: string) => {
      eq: (col: string, val: unknown) => {
        eq: (col: string, val: unknown) => {
          is: (col: string, val: null) => Promise<{ data: AutomationRow[] | null; error: unknown }>;
        };
      };
    };
  };
  const { data, error } = await builder
    // Trimmed to AutomationRow's fields + created_at (issue 2255: the no-cursor start point reads the
    // automation's own created_at; still drops updated_at/last_fired_at, verified unread from returned
    // rows; last_fired_at is a WHERE arg only in the claim path, not this read).
    .select('id,kind,owner_id,org_id,prompt,schedule,trigger_on,condition,enabled,archived_at,timeout_s,created_at')
    .eq('kind', 'trigger')
    .eq('enabled', true)
    .is('archived_at', null);
  // I-COLPROJ (2026-07-28 review): same fix as selectDueSchedules — a real query error must be
  // DISTINGUISHABLE from "no trigger automations enabled", or every trigger automation silently
  // stops firing with nothing to diagnose it from. Fail-safe unchanged (still returns []).
  if (error) {
    logStructuredError({ fn: 'agent-dispatch', errorCode: 'SELECT_ENABLED_TRIGGERS_FAILED' });
    return [];
  }
  if (!data) return [];
  return data;
}

/** Stamp last_fired_at on an automation (service_role, agent_automations metadata — within quarantine). */
async function stampLastFired(sb: ServiceClientLike, automationId: string, at: string): Promise<void> {
  const builder = sb.from('agent_automations') as {
    update: (patch: Record<string, unknown>) => {
      eq: (col: string, val: string) => Promise<{ data: unknown; error: unknown }>;
    };
  };
  await builder.update({ last_fired_at: at }).eq('id', automationId);
}

/**
 * AUDIT-M2: atomically claim a schedule automation's fire for this cron minute. The conditional
 * UPDATE (`last_fired_at is null OR last_fired_at < <minute floor>`) is the mutual exclusion —
 * PostgREST executes it as a single UPDATE, so of N overlapping ticks exactly one gets the row
 * back and fires; the rest see 0 rows and skip. Fail-closed: a claim-query ERROR returns false
 * (no fire) — an unreachable metadata table must never produce an unclaimed fire.
 * (service_role, agent_automations metadata — within quarantine.)
 */
export async function claimScheduleFire(sb: ServiceClientLike, automationId: string, now: Date): Promise<boolean> {
  const minuteFloor = new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString();
  const builder = sb.from('agent_automations') as {
    update: (patch: Record<string, unknown>) => {
      eq: (col: string, val: string) => {
        or: (filter: string) => {
          select: (cols: string) => Promise<{ data: unknown[] | null; error: unknown }>;
        };
      };
    };
  };
  const { data, error } = await builder
    .update({ last_fired_at: now.toISOString() })
    .eq('id', automationId)
    .or(`last_fired_at.is.null,last_fired_at.lt."${minuteFloor}"`)
    .select('id');
  if (error) {
    logStructuredError({ fn: 'agent-dispatch', errorCode: 'SCHEDULE_CLAIM_FAILED', contextId: automationId });
    return false;
  }
  return (data ?? []).length > 0;
}

/**
 * CRITICAL fix (2026-07-07): atomically claim a trigger automation's fire for a specific event.
 * The agent_automation_fires table (migration 0078) enforces at-most-once via its UNIQUE
 * (automation_id, event_id) primary key — the INSERT itself is the mutual exclusion: of N
 * overlapping ticks exactly one INSERT succeeds and fires; the losers hit a 23505 unique-violation.
 * Results: 'claimed' (fire it) · 'duplicate' (settled: already decided, skip) · 'busy' (someone's unsettled
 * claim is still inside its lease) · 'error' (outage; caller keeps the event retryable).
 *
 * Lease (migration 0683): a 23505 whose row is still unsettled after TRIGGER_CLAIM_LEASE_MS belongs to a tick
 * that died before firing. One conditional UPDATE (unsettled AND stale) takes it over and renews the lease, so
 * of N racing ticks exactly one wins; a settled claim (fire started, or unit decided) never matches.
 * (service_role, agent_automation_fires metadata — within quarantine.)
 */
export async function claimTriggerFire(
  sb: ServiceClientLike,
  automationId: string,
  eventId: string,
  now: Date,
): Promise<'claimed' | 'duplicate' | 'busy' | 'error'> {
  const builder = sb.from('agent_automation_fires') as {
    insert: (row: Record<string, unknown>) => {
      select: (cols: string) => Promise<{ data: unknown[] | null; error: unknown }>;
    };
  };
  try {
    const { data, error } = await builder
      .insert({ automation_id: automationId, event_id: eventId })
      .select('automation_id');
    // Only a unique-violation means "already claimed"; anything else is an outage and must stay retryable.
    if (!error) return (data ?? []).length > 0 ? 'claimed' : 'duplicate';
    if ((error as { code?: string }).code !== '23505') return 'error';

    const table = sb.from('agent_automation_fires') as {
      update: (patch: Record<string, unknown>) => {
        eq: (c: string, v: string) => { eq: (c: string, v: string) => { is: (c: string, v: null) => { lt: (c: string, v: string) => {
          select: (cols: string) => Promise<{ data: unknown[] | null; error: unknown }>;
        } } } };
      };
      select: (cols: string) => {
        eq: (c: string, v: string) => { eq: (c: string, v: string) => {
          maybeSingle: () => Promise<{ data: { settled_at: string | null } | null; error: unknown }>;
        } };
      };
    };
    const cutoff = new Date(now.getTime() - TRIGGER_CLAIM_LEASE_MS).toISOString();
    const won = await table
      .update({ fired_at: now.toISOString() })
      .eq('automation_id', automationId).eq('event_id', eventId)
      .is('settled_at', null).lt('fired_at', cutoff)
      .select('automation_id');
    if (won.error) return 'error';
    if ((won.data ?? []).length > 0) return 'claimed';
    const row = await table.select('settled_at').eq('automation_id', automationId).eq('event_id', eventId).maybeSingle();
    if (row.error) return 'error';
    return row.data && row.data.settled_at === null ? 'busy' : 'duplicate';
  } catch {
    return 'error';
  }
}

/** Mark a claim decided (fire starting, or unit ended without firing); a settled claim is never re-claimed. */
export async function settleTriggerFire(sb: ServiceClientLike, automationId: string, eventId: string, now: Date): Promise<boolean> {
  try {
    const table = sb.from('agent_automation_fires') as {
      update: (patch: Record<string, unknown>) => {
        eq: (c: string, v: string) => { eq: (c: string, v: string) => PromiseLike<{ error: unknown }> };
      };
    };
    const { error } = await table.update({ settled_at: now.toISOString() }).eq('automation_id', automationId).eq('event_id', eventId);
    return !error;
  } catch {
    return false;
  }
}
