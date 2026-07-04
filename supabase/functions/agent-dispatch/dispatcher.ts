/**
 * dispatcher.ts — pure tick orchestration for the agent-dispatch edge fn (ADR-0044 §2).
 * selectDueSchedules/selectTriggerMatches run the dispatcher's selection queries under the
 * service_role client, quarantined to metadata enumeration only (FR-AAN-014, NFR-AAN-SEC-002) —
 * never business data. Importable in Vitest (REC-1); no Deno globals here.
 */
import { cronMatches } from './cron';
import { readWatermark, advanceWatermark } from './watermark';
import { isAllowedTriggerSource } from './triggerSources';
import { mintOwnerJwt, auditMint, type AuthAdminLike } from './mint';
import { fireAutomation, type FireHandler } from './fire';
import { evaluateCondition, makeConditionMemo, type ConditionMemo } from './condition';
import type { ModelClient } from '../_shared/modelClient';

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

/** The minimal Supabase-client-like shape the dispatcher needs from its injected service_role client. */
export interface ServiceClientLike {
  from: (table: string) => unknown;
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
 * MINIMAL column set the dispatcher needs (gpt-5.5 audit #2). service_role bypasses RLS, so reading
 * `select('*')` on a tenant business table over-exposes every column of every org's rows to the
 * condition model prompt. We project ONLY: id + created_at (the watermark cursor), to_status (the
 * trigger match key), and org_id (the cross-org tenancy gate). No wide `[key: string]: unknown` —
 * an unforeseen column must never silently flow into a model prompt.
 */
export interface StatusEventRow {
  id: string;
  created_at: string;
  to_status?: string;
  org_id: string;
}

/** The exact minimal column projection read from a trigger source table (gpt-5.5 audit #2). */
export const TRIGGER_EVENT_COLUMNS = 'id, created_at, to_status, org_id';

export interface TriggerMatch {
  automation: AutomationRow;
  event: StatusEventRow;
}

/**
 * selectTriggerMatches — poll-since-watermark event-trigger selection (ADR-0044 §2, FR-AAN-012).
 * For each distinct trigger_on.source among the given enabled kind='trigger' automations, reads the
 * source table for rows created AT-OR-AFTER the source's watermark timestamp (or the epoch if none
 * yet), matches each event's status against each automation's trigger_on.event, and returns the
 * matching {automation, event} pairs. Does NOT advance the watermark — that is the caller's
 * (runDispatchTick) responsibility, performed AFTER the batch succeeds, so a failed tick does not
 * skip events (FR-AAN-013).
 *
 * Item 4 + gpt-5.5 audit #5 (TRUE compound (created_at, id) cursor): `created_at` alone is not a
 * unique cursor — two events can share the exact same timestamp (bulk inserts, low-resolution clocks).
 * A plain `gt('created_at', since)` cursor would SKIP any sibling event at the watermark's own
 * timestamp that sorts after the seen one. So we query `gte('created_at', since)` (never narrower than
 * the watermark's own instant) and then apply the FULL compound-cursor predicate in-JS: keep an event
 * iff `created_at > lastSeenAt OR (created_at === lastSeenAt AND id > lastSeenId)`.
 *
 * The earlier form filtered only `id === lastSeenId`, which is WRONG: when three same-timestamp
 * siblings A,B,C advance the watermark to C, that filter drops only C and re-yields A,B EVERY tick
 * forever (a double-fire, gpt-5.5 audit #5). The strict `> (lastSeenAt, lastSeenId)` predicate drops
 * A and B too (their id is ≤ C's at the same instant), yielding only genuinely-newer rows.
 *
 * Cross-org tenancy (gpt-5.5 audit #1): each candidate event is additionally gated by
 * `event.org_id === automation.org_id` before it can match — a background automation is a deputy for
 * exactly one tenant, so another org's event must never match, condition-evaluate, notify, credit, or
 * fire it.
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
    // SECURITY HIGH-1 (layer 2 — the ENFORCEMENT authority): hard-gate `source` against the SAME
    // TRIGGER_SOURCES allowlist validateCreateAutomation checks at write time. This is the layer
    // that actually matters — a row could exist with a non-allowlisted source (pre-dating this
    // allowlist, or written directly) and must still never be queried. Skip-and-warn, never call
    // sb.from(source) (not even the watermark read is skipped for this source's cursor logic; the
    // watermark table itself is fine to touch, but the SOURCE table never is — we skip before any
    // per-source I/O to keep the gate trivially auditable).
    if (!isAllowedTriggerSource(source)) {
      console.warn('[agent-dispatch] skipping non-allowlisted trigger_on.source', { source });
      continue;
    }
    const wm = await readWatermark(sb, source);
    const lastSeenAt = wm?.lastSeenAt ?? null;
    const lastSeenId = wm?.lastSeenId ?? null;
    const since = lastSeenAt ?? '1970-01-01';

    const builder = sb.from(source) as {
      select: (cols: string) => {
        gte: (col: string, val: string) => {
          order: (col: string) => Promise<{ data: StatusEventRow[] | null; error: unknown }>;
        };
      };
    };
    // gte (not gt): the compound cursor — see the doc comment above. Same-timestamp siblings of the
    // watermark's own instant must still be considered; the exact already-seen row is excluded below
    // by (created_at, id), in-JS. Column projection is MINIMIZED (gpt-5.5 audit #2): never select('*')
    // on a tenant business table under service_role — only the columns the cursor/match/org-gate need.
    const { data, error } = await builder
      .select(TRIGGER_EVENT_COLUMNS)
      .gte('created_at', since)
      .order('created_at');
    if (error || !data) continue;

    for (const event of data) {
      // Compound (created_at, id) cursor exclusion (gpt-5.5 audit #5): keep an event only if it is
      // strictly AFTER the watermark — either a later timestamp, or the same timestamp with a greater
      // id. Same-timestamp siblings that sort BEFORE OR EQUAL the last-seen id were already emitted on
      // a prior tick; filtering only `id === lastSeenId` would re-yield same-timestamp siblings A,B
      // forever when the watermark advanced to C. Skipped when there is no prior watermark.
      if (lastSeenAt !== null && lastSeenId !== null) {
        const after = event.created_at > lastSeenAt || (event.created_at === lastSeenAt && event.id > lastSeenId);
        if (!after) continue;
      }
      for (const automation of automations) {
        // SECURITY CRITICAL cross-org gate (gpt-5.5 audit #1): match ONLY within the automation's own
        // org. Without this, an Org-B event fires an Org-A automation and Org-B's row is serialized
        // into Org-A's condition-model prompt. This is the SELECTION-time tenancy authority (RLS still
        // pins the fired run via the minted owner JWT, but the event never reaches the model here).
        if (automation.org_id !== event.org_id) continue;
        if (automation.trigger_on?.event === event.to_status) {
          matches.push({ automation, event });
        }
      }
    }
  }

  return matches;
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

    try {
      // Mint ONCE per due automation — every downstream use (condition-warning notify, credit
      // preflight, audit, fire) shares this single minted owner client (one mint per candidate
      // fire, never a fresh mint per branch).
      const minted = await mintOwnerJwt(deps, automation);

      // Trigger + NL condition (cheap-tier, memoized §4).
      if (automation.kind === 'trigger' && automation.condition && event) {
        const verdict = await evaluateCondition(
          { model: deps.conditionModel, modelId: deps.conditionModelId, now: () => now.getTime(), memo },
          automation,
          event,
        );
        if (!verdict.fire) {
          if (verdict.warning) {
            // Unevaluable ⇒ warning notification, no fire (fail-quiet-but-visible, FR-AAN-024).
            await notifyOwner(minted.client, 'warning', 'Automation condition could not be evaluated', verdict.warning, {
              source: 'automation',
              automation_id: automation.id,
            });
          }
          continue; // condition false (silent) or unevaluable (warned) ⇒ no fire.
        }
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

      // ── Audit (BEFORE fire) → fire (the SAME loop) → stamp last_fired_at. ──
      const runId = newRunId();
      // AC-AAN-017: audit BEFORE the minted client is used for the fire. Fail-closed (auditMint
      // throws on failure) — never fire an unaudited run.
      await auditMint(minted.client, automation, runId, newMintedAt());

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
      console.error('[agent-dispatch] automation failed', {
        automation_id: automation.id,
        code: err instanceof Error ? err.name : 'unknown',
      });
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
