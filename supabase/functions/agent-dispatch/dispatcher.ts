/**
 * dispatcher.ts — pure tick orchestration for the agent-dispatch edge fn (ADR-0044 §2).
 * selectDueSchedules/selectTriggerMatches run the dispatcher's selection queries under the
 * service_role client, quarantined to metadata enumeration only (FR-AAN-014, NFR-AAN-SEC-002) —
 * never business data. Importable in Vitest (REC-1); no Deno globals here.
 */
import { cronMatches } from './cron.ts';
import { readWatermark, advanceWatermark } from './watermark.ts';
import { isAllowedTriggerSource } from './triggerSources.ts';
import { mintOwnerJwt, auditMint, type AuthAdminLike } from './mint.ts';
import { fireAutomation, type FireHandler } from './fire.ts';
import { evaluateCondition, makeConditionMemo, type ConditionMemo } from './condition.ts';
import type { ModelClient } from '../_shared/modelClient.ts';
import { logStructuredError } from '../_shared/errorLog.ts';

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
    .select('*')
    .eq('kind', 'schedule')
    .eq('enabled', true)
    .is('archived_at', null);

  if (error || !data) return [];
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
 * For each distinct trigger_on.source among the given enabled kind='trigger' automations, it reads
 * the source's watermark, then calls the SECURITY DEFINER `select_trigger_events` RPC (migration 0054)
 * with the compound cursor + the exact set of (org_id, event) pairs its automations need. The RPC
 * returns ONLY events that match one of those pairs on BOTH org_id AND to_status and are strictly
 * after the cursor — so a cross-org event is never returned to the edge fn at all. It then pairs each
 * returned event back to its matching automation(s). Does NOT advance the watermark — that is the
 * caller's (runDispatchTick) responsibility, AFTER the batch, so a failed tick does not skip events.
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
export async function selectTriggerMatches(
  sb: ServiceClientLike,
  _now: Date,
  triggerAutomations: AutomationRow[],
): Promise<TriggerMatch[]> {
  const bySource = new Map<string, AutomationRow[]>();
  for (const automation of triggerAutomations) {
    if (automation.kind !== 'trigger' || !automation.trigger_on) continue;
    const source = automation.trigger_on.source;
    const list = bySource.get(source) ?? [];
    list.push(automation);
    bySource.set(source, list);
  }

  const matches: TriggerMatch[] = [];

  for (const [source, automations] of bySource) {
    // SECURITY HIGH-1 (defense-in-depth): hard-gate `source` against the SAME TRIGGER_SOURCES allowlist
    // validateCreateAutomation checks at write time, BEFORE any RPC call. The RPC itself also allowlists
    // the source (returning zero rows for a non-allowlisted one), but skipping here keeps the gate
    // trivially auditable and avoids a needless round-trip for a source that can never match.
    if (!isAllowedTriggerSource(source)) {
      console.warn('[agent-dispatch] skipping non-allowlisted trigger_on.source', { source });
      continue;
    }

    const wm = await readWatermark(sb, source);
    const lastSeenAt = wm?.lastSeenAt ?? null;
    const lastSeenId = wm?.lastSeenId ?? null;

    // Build the exact (org_id, event) filter set the RPC needs — deduped, so N automations sharing an
    // (org, event) pair produce one filter. The RPC returns ONLY events matching one of these pairs, so
    // a cross-org event never crosses the trust boundary into the edge fn (SEC-HIGH-2).
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
    if (error || !data) continue;
    const events = data as StatusEventRow[];

    for (const event of events) {
      for (const automation of automations) {
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

/** Dedupe the (org_id, trigger_on.event) filter pairs across a source's automations for the RPC. */
function dedupeFilters(automations: AutomationRow[]): TriggerFilter[] {
  const seen = new Set<string>();
  const filters: TriggerFilter[] = [];
  for (const a of automations) {
    const orgId = a.org_id;
    const event = a.trigger_on?.event;
    if (!orgId || !event) continue;
    const key = `${orgId} ${event}`;
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
  check(userId: string, mintedClient?: unknown): Promise<{ exceeded: boolean; retryAfterSeconds?: number }>;
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
 * over-credit §6). Swallowed on error — a notify failure must not abort the tick.
 */
async function notifyOwner(
  mintedClient: unknown,
  severity: 'info' | 'warning' | 'critical',
  title: string,
  body: string | null,
  metadata: Record<string, unknown> | null,
): Promise<void> {
  try {
    const sb = mintedClient as { from: (t: string) => { insert: (r: Record<string, unknown>) => Promise<{ error: unknown }> } };
    await sb.from('notifications').insert({ severity, title, body, metadata });
  } catch {
    // never surface — notify is best-effort.
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
  const rateGuard = deps.rateGuard ?? { check: async () => ({ exceeded: false }) };

  // ── Selection (service_role, metadata enumeration ONLY — FR-AAN-014) ──
  const dueSchedules = await selectDueSchedules(deps.serviceClient, now);

  // Trigger automations: enumerate enabled/live kind='trigger' rows, then poll-since-watermark.
  const triggerAutomations = await selectEnabledTriggers(deps.serviceClient);
  const triggerMatches = await selectTriggerMatches(deps.serviceClient, now, triggerAutomations);

  // Track the max-ATTEMPTED event per source to advance the watermark AFTER the batch (item 4/2:
  // "attempted", not "matched-and-succeeded" — a unit that throws mid-fire was still attempted
  // against its event, so the watermark must still advance past it, or the same event re-matches
  // and double-fires next tick. Tracked as attempts are made, in the fire loop below.
  const maxAttemptedBySource = new Map<string, { id: string; at: string }>();
  function markAttempted(source: string, event: StatusEventRow): void {
    const prev = maxAttemptedBySource.get(source);
    if (!prev || event.created_at > prev.at || (event.created_at === prev.at && event.id > prev.id)) {
      maxAttemptedBySource.set(source, { id: event.id, at: event.created_at });
    }
  }

  // ── Fire each due automation through the minted-owner deputy path ──
  const scheduleUnits = dueSchedules.map((automation) => ({ automation, event: undefined as StatusEventRow | undefined }));
  const triggerUnits = triggerMatches.map(({ automation, event }) => ({ automation, event: event as StatusEventRow | undefined }));

  // Item 2 (reliability): each unit runs in its own try/catch — one automation's throw must
  // neither kill the batch (the loop continues to the next unit) nor rewind/block the watermark
  // for events already attempted (markAttempted runs unconditionally once selection has committed
  // to attempting a trigger unit, BEFORE any step that can throw).
  for (const { automation, event } of [...scheduleUnits, ...triggerUnits]) {
    if (automation.kind === 'trigger' && event) {
      markAttempted(automation.trigger_on!.source, event);
    }

    // Tracks which phase of the unit is in flight so the catch below can log a DISTINCT
    // errorCode per failure phase (mint vs audit vs fire) without changing any control
    // flow — set immediately before the call that can throw for that phase.
    let stage: 'condition' | 'mint' | 'audit' | 'fire' = 'condition';

    try {
      // ── Trigger + NL condition FIRST — BEFORE the mint (gpt-5.5 audit #3). Condition eval uses the
      // CHEAP MODEL + the event, never the minted client, so a silent condition-false skip (the common
      // case) never mints at all — no audit run, no minted-client write, nothing to leak. This is the
      // "move condition eval before mint" resolution: the ONLY minted-client use for an unevaluable
      // condition is its warning notify, which is deferred below to AFTER mint+audit. ──
      let conditionWarning: string | null = null;
      if (automation.kind === 'trigger' && automation.condition && event) {
        const verdict = await evaluateCondition(
          { model: deps.conditionModel, modelId: deps.conditionModelId, now: () => now.getTime(), memo },
          automation,
          event,
        );
        if (!verdict.fire) {
          // Condition false ⇒ silent no-fire, NEVER mint (nothing to notify, nothing to audit).
          if (!verdict.warning) continue;
          // Unevaluable ⇒ we must warn the owner; that needs the minted client, so we fall through to
          // mint + audit and notify below. Recorded here so the post-audit block emits it.
          conditionWarning = verdict.warning;
        }
      }

      // Mint ONCE per candidate — shared by audit, notify, credit preflight, and fire (one mint per
      // candidate, never a fresh mint per branch). Reached only when the automation will either fire
      // or produce an owner notification (unevaluable condition / over-credit).
      stage = 'mint';
      const minted = await mintOwnerJwt(deps, automation);

      // ── Audit EVERY mint FIRST — before ANY other minted-client DB use (gpt-5.5 audit #3,
      // AC-AAN-017). mint.ts's invariant ("audit is the first minted-client use") now holds on the
      // skip paths too: an unevaluable-condition or over-credit candidate that mints still leaves an
      // audit trail BEFORE its warning notification. Fail-closed — auditMint throws on failure, so a
      // candidate whose audit cannot be written never notifies, credits, or fires. ──
      const runId = newRunId();
      stage = 'audit';
      await auditMint(minted.client, automation, runId, newMintedAt());
      stage = 'fire';

      // Deferred unevaluable-condition warning (the mint is already audited above, so this notify is
      // never the first minted-client write). No fire follows.
      if (conditionWarning !== null) {
        await notifyOwner(minted.client, 'warning', 'Automation condition could not be evaluated', conditionWarning, {
          source: 'automation',
          automation_id: automation.id,
        });
        continue;
      }

      // ── Credit preflight (ADR-0044 §6, FR-AAN-032/033). Balance is computed under the MINTED
      // OWNER CLIENT (never service_role, NFR-AAN-SEC-002/SEC-006) — the preflight runs strictly
      // BEFORE any fire. Over ⇒ warning notification, no fire, no agent_runs row reaches 'running'. ──
      const credit = await rateGuard.check(automation.owner_id, minted.client);
      if (credit.exceeded) {
        await notifyOwner(
          minted.client,
          'warning',
          `Automation skipped — out of credits`,
          `Automation ${automation.id} did not run because the balance was exceeded.`,
          { source: 'automation', automation_id: automation.id },
        );
        continue; // no fire, no last_fired_at stamp.
      }

      // ── Fire (the SAME loop) → stamp last_fired_at. The run was already audited above. ──

      const persistenceExtras = deps.buildPersistence
        ? { persistence: deps.buildPersistence(minted.client, automation.owner_id, runId) }
        : {};
      // FR-AUC-002/004/018 parity with interactive: usage recording is unconditional, under the
      // SAME minted owner client as the fire — one agent_usage row per model-call resolution,
      // scoped to the automation's owner (never service_role).
      const usageExtras = { usage: { supabase: minted.client } };

      // Item 3 (reliability): timeout_s → an AbortController per automation. A coarse wall-clock
      // deadline on top of MAX_TOOL_ROUNDS — each automation gets its OWN controller so one fire's
      // timeout can never abort a sibling's in-flight run.
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

      // FR-AAN-015: stamp last_fired_at only on an actual fire (service_role, quarantined metadata).
      await stampLastFired(deps.serviceClient, automation.id, now.toISOString());
    } catch (err) {
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
              : 'AUTOMATION_CONDITION_FAILED';
      logStructuredError({ fn: 'agent-dispatch', errorCode, contextId: automation.id });
    }
  }

  // ── Advance watermarks AFTER the batch (FR-AAN-013 monotonic-after-success): a source's
  // watermark advances over events whose automations were ALL attempted this tick, regardless of
  // whether the fire ultimately succeeded, threw, or was skipped (condition/credit) — an
  // attempted-but-failed event must never be re-selected and re-attempted next tick. ──
  for (const [source, seen] of maxAttemptedBySource) {
    await advanceWatermark(deps.serviceClient, source, seen);
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
    .select('*')
    .eq('kind', 'trigger')
    .eq('enabled', true)
    .is('archived_at', null);
  if (error || !data) return [];
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
