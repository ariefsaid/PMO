/**
 * telegram-notify/logic — the Telegram alert drain: pure helpers (groupIntoMessages,
 * buildTelegramPayload, shouldSendLiveness) plus the effects-injected orchestrator (runDrain).
 * This file's OWN code touches no Deno globals except `fetch` inside pingHeartbeat (mockable via
 * vi.stubGlobal, NFR-OF-TEST-001) — every DB / Telegram / heartbeat effect runDrain performs is
 * injected via DrainDeps, never called directly, so the whole orchestration is importable and
 * testable in Vitest (ADR-0039 decision-7).
 */
import { logStructuredError } from '../_shared/errorLog.ts';

export interface ErrorEventRow {
  id: string;
  error_code: string;
  fn: string;
  context_id: string | null;
  org_id: string | null;
  created_at: string;
}

export interface MessageGroup {
  errorCode: string;
  fn: string;
  count: number;
  firstCreatedAt: string;
  lastCreatedAt: string;
  sampleContextId: string | null;
  suppressed: boolean;
  /** The exact `error_events.id`s that make up this group — the caller (index.ts)
   * stamps `notified_at` for precisely these ids, never a re-filter of the raw rows
   * (Fix 1: this is the seam that had zero coverage and silently never stamped). */
  ids: string[];
}

export interface TelegramPayload {
  chat_id?: string;
  text: string;
  parse_mode: 'Markdown';
}

/**
 * groupIntoMessages — collapses unnotified rows into one group per error_code
 * (FR-OF-005/006, LD-OF-005), each carrying a `suppressed` flag computed from
 * `lastNotifiedByCode` + `cooldownSec` (I-2's cross-drain cooldown input) AND the
 * group's own row `ids` (Fix 1). A suppressed group's rows are still marked
 * notified_at by the caller (index.ts) — this function only decides WHICH groups
 * send + WHICH ids belong to each group, never performs the DB write.
 *
 * The cooldown clock is measured relative to the group's OWN `lastCreatedAt` (the
 * most recent row's timestamp), never wall-clock `Date.now()` — a drain tick that
 * runs minutes or hours after the row was written must still evaluate the cooldown
 * as of when the error actually happened, not as of when the tick happens to run.
 */
export function groupIntoMessages(
  rows: ErrorEventRow[],
  lastNotifiedByCode: Record<string, string | undefined>,
  cooldownSec: number,
): MessageGroup[] {
  const byCode = new Map<string, ErrorEventRow[]>();
  for (const row of rows) {
    const existing = byCode.get(row.error_code) ?? [];
    existing.push(row);
    byCode.set(row.error_code, existing);
  }

  const groups: MessageGroup[] = [];
  for (const [errorCode, groupRows] of byCode) {
    const sorted = [...groupRows].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const lastCreatedAt = sorted[sorted.length - 1].created_at;
    const last = lastNotifiedByCode[errorCode];
    const suppressed =
      last !== undefined && (new Date(lastCreatedAt).getTime() - new Date(last).getTime()) / 1000 < cooldownSec;
    groups.push({
      errorCode,
      fn: sorted[0].fn,
      count: sorted.length,
      firstCreatedAt: sorted[0].created_at,
      lastCreatedAt: sorted[sorted.length - 1].created_at,
      sampleContextId: sorted.find((r) => r.context_id)?.context_id ?? null,
      suppressed,
      ids: sorted.map((r) => r.id),
    });
  }
  return groups;
}

/**
 * buildTelegramPayload — message text is code+meta ONLY (FR-OF-006, NFR-OF-PRIV-003):
 * fn, error_code, count, first/last timestamps, a sample context_id. NEVER org_id
 * (raw UUID is "telemetric noise + a soft identifier" per FR-OF-006), never prompt
 * text, never a secret.
 */
export function buildTelegramPayload(group: MessageGroup): TelegramPayload {
  const lines = [
    `*Alert:* \`${group.errorCode}\``,
    `*fn:* ${group.fn}`,
    `*count:* ${group.count}`,
    `*first:* ${group.firstCreatedAt}`,
    `*last:* ${group.lastCreatedAt}`,
  ];
  if (group.sampleContextId) lines.push(`*sample context:* \`${group.sampleContextId}\``);
  return { text: lines.join('\n'), parse_mode: 'Markdown' };
}

/**
 * pingHeartbeat — fire-and-forget GET to an optional BetterStack heartbeat monitor
 * URL (FR-OF-021, I-3). No-op when `url` is undefined. Never throws: a network
 * error or non-2xx is swallowed (the heartbeat itself is best-effort telemetry,
 * never on the alert path — NFR-OF-REL-002).
 */
export async function pingHeartbeat(url: string | undefined): Promise<void> {
  if (!url) return;
  try {
    await fetch(url, { method: 'GET' });
  } catch {
    // Swallowed by design (FR-OF-021) — a dead heartbeat URL must never affect the
    // drain's own success/failure or notified_at stamping.
  }
}

/** A row from `alert_send_log`: the write-ahead attempt record for one error_code. */
export interface SendLogEntry {
  /** Written BEFORE the send (the cooldown source, FR-HRD-001/002). */
  lastSentAt: string;
  /** Written ONLY after a CONFIRMED successful send. Null = attempted but never delivered. */
  deliveredAt: string | null;
}

/** A row from `ops_job_heartbeats`, split per I4 (2026-07-28 review). */
export interface HeartbeatRow {
  /** Written unconditionally at the end of every completed tick — "the job ran". */
  lastRunAt: string;
  /** Written only when a message actually left for Telegram — the staleness signal. */
  lastOutboundAt: string | null;
}

export interface DrainDeps {
  now: () => Date;
  cooldownSec: number;
  livenessIntervalHours: number;
  /**
   * Whether TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID are both configured. False stops the drain
   * BEFORE any write-ahead or select (C1 hardening, 2026-07-28 review) — a missing secret must not
   * burn a write-ahead per group only to find out every send fails; that both wastes writes and
   * risks a partially-processed tick. Pre-change behaviour ("skipped: secrets unset", nothing
   * touched) is restored at this single guard.
   */
  secretsConfigured: boolean;
  selectUnnotified: () => Promise<ErrorEventRow[]>;
  /** error_code -> the write-ahead attempt record (alert_send_log), if one exists. */
  selectLastSentByCode: () => Promise<Record<string, SendLogEntry | undefined>>;
  /** Write-ahead: MUST resolve before sendTelegram is called (FR-HRD-002). */
  recordSendAhead: (errorCode: string, atIso: string) => Promise<{ error: unknown }>;
  /** Written ONLY after sendTelegram resolves ok (C1) — never before, never on a failed send. */
  markDelivered: (errorCode: string, atIso: string) => Promise<{ error: unknown }>;
  sendTelegram: (payload: TelegramPayload) => Promise<{ ok: boolean }>;
  stampNotified: (ids: string[], atIso: string) => Promise<{ error: unknown }>;
  readHeartbeat: (job: string) => Promise<HeartbeatRow | null>;
  /**
   * Write-ahead (I2, 2026-07-28 review): record the OUTBOUND intent for a job BEFORE attempting to
   * send the liveness ping — bounds the ping to at most once per livenessIntervalHours even when
   * the PERSISTED write itself later fails, the same discipline C1 applies to alert sends. Without
   * this, a ping whose send succeeds but whose write fails repeats every tick (at 2-minute cron
   * cadence, ~720/day) because the next tick's readHeartbeat still sees the stale timestamp.
   */
  recordLivenessAhead: (job: string, atIso: string) => Promise<{ error: unknown }>;
  /**
   * Unconditional run signal (I4): called once at the end of EVERY completed drain tick regardless
   * of outcome — this is what proves "the job ran", distinct from "the job sent something"
   * (outboundAtIso, set only when a REAL alert went out this tick; the liveness ping's outbound
   * timestamp was already write-ahead-recorded via recordLivenessAhead).
   */
  writeHeartbeat: (
    job: string,
    runAtIso: string,
    outboundAtIso: string | undefined,
    detail: unknown,
  ) => Promise<{ error: unknown }>;
}

export interface DrainResult {
  sent: number;
  suppressed: number;
  stampFailures: number;
  sendFailures: number;
  livenessPinged: boolean;
  /** Set when the drain short-circuited because Telegram secrets are unset (C1). */
  skipped?: 'secrets-unset';
}

/**
 * runDrain — the whole drain loop, effects injected (FR-HRD-001/002/010, C1/I2/I3/I4 hardening).
 *
 * Invariants this function exists to hold:
 *   1. The cooldown is derived from alert_send_log (written BEFORE the send), never from
 *      error_events.notified_at — so a failed stamp can no longer defeat the cooldown and
 *      re-alert the same group every tick forever (FR-HRD-001/002).
 *   2. A SUPPRESSED group only stamps notified_at when the attempt that suppressed it was actually
 *      DELIVERED (C1) — otherwise the write-ahead alone would convert alert-spam into alert-loss: a
 *      send that fails after the write-ahead lands would be marked notified on the very next tick,
 *      when it was suppressed by its own (failed) write-ahead, and never retried.
 *   3. Every write result is INSPECTED. supabase-js resolves with `error` populated instead of
 *      throwing, so a discarded result is a silent failure by construction.
 *   4. A tick where every send/stamp failed never reports a false all-clear (I3) — Telegram being
 *      reachable in that scenario means the misleading "OK" message actually arrives.
 *   5. The liveness ping's own outbound timestamp is write-ahead-recorded (I2), and the drain's run
 *      signal is written unconditionally every tick (I4) — "ran but quiet" and "never runs" must not
 *      write identical rows.
 */
export async function runDrain(deps: DrainDeps): Promise<DrainResult> {
  const nowIso = deps.now().toISOString();
  const result: DrainResult = {
    sent: 0, suppressed: 0, stampFailures: 0, sendFailures: 0, livenessPinged: false,
  };

  if (!deps.secretsConfigured) {
    // C1: stop BEFORE any write-ahead/select — a missing secret must not burn a write-ahead per
    // group. Leaves error_events entirely untouched, retried once secrets are wired (FR-OF-007).
    logStructuredError({ fn: 'telegram-notify', errorCode: 'TELEGRAM_SECRET_MISSING' });
    return { ...result, skipped: 'secrets-unset' };
  }

  const rows = await deps.selectUnnotified();
  const sendLog = await deps.selectLastSentByCode();
  const lastSentByCode: Record<string, string | undefined> = {};
  for (const [code, entry] of Object.entries(sendLog)) {
    if (entry) lastSentByCode[code] = entry.lastSentAt;
  }
  const groups = groupIntoMessages(rows, lastSentByCode, deps.cooldownSec);

  for (const group of groups) {
    let delivered = false;

    if (!group.suppressed) {
      // WRITE-AHEAD (FR-HRD-002): record the send BEFORE performing it, in a table that is not
      // the one being stamped. A failure here aborts the send — better a delayed alert than an
      // unbounded re-alert loop.
      const ahead = await deps.recordSendAhead(group.errorCode, nowIso);
      if (ahead.error) {
        logStructuredError({
          fn: 'telegram-notify',
          errorCode: 'ALERT_SEND_LOG_WRITE_FAILED',
          contextId: group.errorCode,
        });
        result.sendFailures += 1;
        continue;
      }
      const res = await deps.sendTelegram(buildTelegramPayload(group));
      if (!res.ok) {
        result.sendFailures += 1;
        continue; // leave notified_at NULL — retried next tick (FR-OF-007)
      }
      result.sent += 1;
      delivered = true;
      // C1: mark delivery ONLY after a confirmed successful send. If this write itself fails, a
      // FUTURE suppressed occurrence of this error_code won't be eligible to stamp until the
      // cooldown lapses naturally — conservative (a delay), never a silent loss, and this tick's
      // own rows are still stamped below because `delivered` is already true for THIS send.
      const mark = await deps.markDelivered(group.errorCode, nowIso);
      if (mark.error) {
        logStructuredError({
          fn: 'telegram-notify',
          errorCode: 'ALERT_DELIVERY_MARK_FAILED',
          contextId: group.errorCode,
        });
      }
    } else {
      result.suppressed += 1;
      // C1: a suppressed group may stamp notified_at ONLY if the write-ahead that suppressed it
      // was actually delivered — never on the mere existence of a (possibly failed) attempt.
      delivered = sendLog[group.errorCode]?.deliveredAt != null;
    }

    if (delivered && group.ids.length > 0) {
      // FR-HRD-001: the stamp result is INSPECTED, not discarded.
      const stamp = await deps.stampNotified(group.ids, nowIso);
      if (stamp.error) {
        result.stampFailures += 1;
        logStructuredError({
          fn: 'telegram-notify',
          errorCode: 'NOTIFY_STAMP_FAILED',
          contextId: group.errorCode,
        });
      }
    }
  }

  // FR-HRD-010 liveness — reads the OUTBOUND column specifically (I4): last_run_at proves the tick
  // executed, last_outbound_at proves a message actually went out. Conflating them (the original
  // bug) made "quiet but healthy" and "never runs" write identical rows.
  const beat = await deps.readHeartbeat('telegram-notify');
  const lastOutbound = beat?.lastOutboundAt ?? undefined;
  // I3: a tick where every send/stamp failed must NOT report an all-clear — Telegram being up in
  // that scenario means the FALSE all-clear actually arrives.
  const allClear = result.sendFailures === 0 && result.stampFailures === 0;
  if (result.sent === 0 && allClear && shouldSendLiveness(nowIso, lastOutbound, deps.livenessIntervalHours)) {
    // I2: write-ahead the outbound intent BEFORE the send — the same discipline C1 applies to
    // alerts. Without this, a liveness ping whose SEND succeeds but whose PERSISTED write fails
    // repeats every tick (~720/day at the real 2-minute cadence) because the next tick's
    // readHeartbeat still sees the stale last_outbound_at.
    const ahead = await deps.recordLivenessAhead('telegram-notify', nowIso);
    if (ahead.error) {
      logStructuredError({ fn: 'telegram-notify', errorCode: 'HEARTBEAT_WRITE_FAILED' });
    } else {
      const ping = await deps.sendTelegram({
        text: `*Alert path OK* — drain ran at ${nowIso}, no unnotified errors.`,
        parse_mode: 'Markdown',
      });
      if (ping.ok) result.livenessPinged = true;
    }
  }

  // I4: the run signal is unconditional — written at the end of every completed drain regardless
  // of outcome. The outbound column is only set here for a REAL alert send; the liveness ping's
  // outbound timestamp was already write-ahead-recorded above.
  const hb = await deps.writeHeartbeat(
    'telegram-notify',
    nowIso,
    result.sent > 0 ? nowIso : undefined,
    { sent: result.sent, suppressed: result.suppressed, liveness: result.livenessPinged },
  );
  if (hb.error) {
    logStructuredError({ fn: 'telegram-notify', errorCode: 'HEARTBEAT_WRITE_FAILED' });
  }

  return result;
}

/**
 * shouldSendLiveness — pure. True when no outbound message has gone out for longer than
 * `intervalHours` (or ever). Deliberately independent of the cron cadence (AS-2): tightening the
 * tick from hourly must not change how often the all-clear fires.
 */
export function shouldSendLiveness(
  nowIso: string,
  lastOutboundIso: string | undefined,
  intervalHours: number,
): boolean {
  if (!lastOutboundIso) return true;
  const elapsedH = (new Date(nowIso).getTime() - new Date(lastOutboundIso).getTime()) / 3_600_000;
  return elapsedH >= intervalHours;
}
