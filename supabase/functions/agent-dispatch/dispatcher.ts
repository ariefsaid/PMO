/**
 * dispatcher.ts — pure tick orchestration for the agent-dispatch edge fn (ADR-0044 §2).
 * selectDueSchedules/selectTriggerMatches run the dispatcher's selection queries under the
 * service_role client, quarantined to metadata enumeration only (FR-AAN-014, NFR-AAN-SEC-002) —
 * never business data. Importable in Vitest (REC-1); no Deno globals here.
 */
import { cronMatches } from './cron';
import { readWatermark, advanceWatermark } from './watermark';
import { mintOwnerJwt, auditMint, type AuthAdminLike } from './mint';
import { fireAutomation, type FireHandler } from './fire';
import { evaluateCondition, makeConditionMemo, type ConditionMemo } from './condition';
import type { ModelClient } from '../_shared/modelClient';

/** The minimal automation-row shape the dispatcher's selection queries need. */
export interface AutomationRow {
  id: string;
  kind: 'schedule' | 'trigger';
  owner_id: string;
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

/** A status-event row from a trigger source table (e.g. procurement_status_events). */
export interface StatusEventRow {
  id: string;
  created_at: string;
  to_status?: string;
  [key: string]: unknown;
}

export interface TriggerMatch {
  automation: AutomationRow;
  event: StatusEventRow;
}

/**
 * selectTriggerMatches — poll-since-watermark event-trigger selection (ADR-0044 §2, FR-AAN-012).
 * For each distinct trigger_on.source among the given enabled kind='trigger' automations, reads the
 * source table for rows created after the source's watermark (or the epoch if none yet), matches
 * each event's status against each automation's trigger_on.event, and returns the matching
 * {automation, event} pairs. Does NOT advance the watermark — that is the caller's (runDispatchTick)
 * responsibility, performed AFTER the batch succeeds, so a failed tick does not skip events
 * (FR-AAN-013).
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
    const wm = await readWatermark(sb, source);
    const since = wm?.lastSeenAt ?? '1970-01-01';

    const builder = sb.from(source) as {
      select: (cols: string) => {
        gt: (col: string, val: string) => {
          order: (col: string) => Promise<{ data: StatusEventRow[] | null; error: unknown }>;
        };
      };
    };
    const { data, error } = await builder.select('*').gt('created_at', since).order('created_at');
    if (error || !data) continue;

    for (const event of data) {
      for (const automation of automations) {
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
 * Credit preflight seam (REC-4, issue-3). The dispatcher checks the OWNER's balance before firing;
 * over-budget ⇒ no-start + a warning notification (FR-AAN-032/033). Until issue-3's credit-backed
 * RateGuard ships, index.ts injects a no-op guard (always { exceeded: false }) — Phase F wires the
 * real one and owns AC-AAN-027. Structurally identical to handler.ts's RateGuard.
 */
export interface DispatchRateGuard {
  check(userId: string): Promise<{ exceeded: boolean; retryAfterSeconds?: number }>;
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
  const memo = deps.conditionMemo ?? makeConditionMemo();
  const rateGuard = deps.rateGuard ?? { check: async () => ({ exceeded: false }) };

  // ── Selection (service_role, metadata enumeration ONLY — FR-AAN-014) ──
  const dueSchedules = await selectDueSchedules(deps.serviceClient, now);

  // Trigger automations: enumerate enabled/live kind='trigger' rows, then poll-since-watermark.
  const triggerAutomations = await selectEnabledTriggers(deps.serviceClient);
  const triggerMatches = await selectTriggerMatches(deps.serviceClient, now, triggerAutomations);

  // Track the max-seen event per source to advance the watermark AFTER the batch.
  const maxSeenBySource = new Map<string, { id: string; at: string }>();
  for (const { automation, event } of triggerMatches) {
    const source = automation.trigger_on!.source;
    const prev = maxSeenBySource.get(source);
    if (!prev || event.created_at > prev.at) {
      maxSeenBySource.set(source, { id: event.id, at: event.created_at });
    }
  }

  // ── Fire each due automation through the minted-owner deputy path ──
  const scheduleUnits = dueSchedules.map((automation) => ({ automation, event: undefined as StatusEventRow | undefined }));
  const triggerUnits = triggerMatches.map(({ automation, event }) => ({ automation, event: event as StatusEventRow | undefined }));

  for (const { automation, event } of [...scheduleUnits, ...triggerUnits]) {
    // Trigger + NL condition: evaluate BEFORE minting (cheap-tier, memoized §4). We mint lazily —
    // once per due automation — so a warning-notify and the fire share one minted client.
    let conditionWarning: string | undefined;
    if (automation.kind === 'trigger' && automation.condition && event) {
      const verdict = await evaluateCondition(
        { model: deps.conditionModel, modelId: deps.conditionModelId, now: () => now.getTime(), memo },
        automation,
        event,
      );
      if (!verdict.fire) {
        if (verdict.warning) {
          // Unevaluable ⇒ mint + warning notification, no fire (fail-quiet-but-visible, FR-AAN-024).
          const minted = await mintOwnerJwt(deps, automation);
          await notifyOwner(minted.client, 'warning', 'Automation condition could not be evaluated', verdict.warning, {
            source: 'automation',
            automation_id: automation.id,
          });
        }
        continue; // condition false (silent) or unevaluable (warned) ⇒ no fire.
      }
    }

    // ── Credit preflight (REC-4, FR-AAN-032/033). Over ⇒ mint + warning notification, no fire. ──
    const credit = await rateGuard.check(automation.owner_id);
    if (credit.exceeded) {
      const minted = await mintOwnerJwt(deps, automation);
      await notifyOwner(
        minted.client,
        'warning',
        `Automation skipped — out of credits`,
        `Automation ${automation.id} did not run because the balance was exceeded.`,
        { source: 'automation', automation_id: automation.id },
      );
      continue; // no fire, no last_fired_at stamp.
    }

    // ── Mint → audit (BEFORE fire) → fire (the SAME loop) → stamp last_fired_at. ──
    const runId = newRunId();
    const minted = await mintOwnerJwt(deps, automation);
    // AC-AAN-017: audit BEFORE the minted client is used for the fire. Fail-closed (auditMint
    // throws on failure) — never fire an unaudited run.
    await auditMint(minted.client, automation, runId, newMintedAt());

    const persistenceExtras = deps.buildPersistence
      ? { persistence: deps.buildPersistence(minted.client, automation.owner_id, runId) }
      : {};
    await fireAutomation({
      handler: deps.handler,
      mintedClient: minted.client,
      modelClient: deps.modelClient,
      model: deps.model,
      ownerId: automation.owner_id,
      automation,
      runId,
      handlerExtras: { ...(deps.handlerExtras ?? {}), ...persistenceExtras },
    });

    // FR-AAN-015: stamp last_fired_at only on an actual fire (service_role, quarantined metadata).
    await stampLastFired(deps.serviceClient, automation.id, now.toISOString());
  }

  // ── Advance watermarks AFTER the batch (FR-AAN-013 monotonic-after-success). ──
  for (const [source, seen] of maxSeenBySource) {
    await advanceWatermark(deps.serviceClient, source, seen);
  }
}

/** Enumerate enabled, non-archived kind='trigger' automations (service_role metadata only). */
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
