/**
 * telegram-notify/logic — pure helpers for the Telegram alert drain (observability
 * floor, DC-OF-001 step 6). No Deno globals except `fetch` (used only inside
 * buildTelegramPayload's caller / pingHeartbeat — both accept fetch implicitly via
 * the global, mockable in Vitest via vi.stubGlobal, per NFR-OF-TEST-001). Importable
 * in Vitest.
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

export interface DrainDeps {
  now: () => Date;
  cooldownSec: number;
  livenessIntervalHours: number;
  selectUnnotified: () => Promise<ErrorEventRow[]>;
  /** error_code -> ISO timestamp of the last WRITE-AHEAD send record (alert_send_log). */
  selectLastSentByCode: () => Promise<Record<string, string | undefined>>;
  /** Write-ahead: MUST resolve before sendTelegram is called (FR-HRD-002). */
  recordSendAhead: (errorCode: string, atIso: string) => Promise<{ error: unknown }>;
  sendTelegram: (payload: TelegramPayload) => Promise<{ ok: boolean }>;
  stampNotified: (ids: string[], atIso: string) => Promise<{ error: unknown }>;
  readHeartbeat: (job: string) => Promise<{ last_success_at: string } | null>;
  writeHeartbeat: (job: string, atIso: string, detail: unknown) => Promise<{ error: unknown }>;
}

export interface DrainResult {
  sent: number;
  suppressed: number;
  stampFailures: number;
  sendFailures: number;
  livenessPinged: boolean;
}

/**
 * runDrain — the whole drain loop, effects injected (FR-HRD-001/002/010).
 *
 * Two invariants this function exists to hold, both of which were broken in index.ts:
 *   1. The cooldown is derived from alert_send_log (written BEFORE the send), never from
 *      error_events.notified_at — so a failed stamp can no longer defeat the cooldown and
 *      re-alert the same group every tick forever.
 *   2. Every write result is INSPECTED. supabase-js resolves with `error` populated instead of
 *      throwing, so a discarded result is a silent failure by construction.
 */
export async function runDrain(deps: DrainDeps): Promise<DrainResult> {
  const nowIso = deps.now().toISOString();
  const result: DrainResult = {
    sent: 0, suppressed: 0, stampFailures: 0, sendFailures: 0, livenessPinged: false,
  };

  const rows = await deps.selectUnnotified();
  const lastSentByCode = await deps.selectLastSentByCode();
  const groups = groupIntoMessages(rows, lastSentByCode, deps.cooldownSec);

  for (const group of groups) {
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
    } else {
      result.suppressed += 1;
    }

    if (group.ids.length > 0) {
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

  // FR-HRD-010 liveness: a quiet tick must still prove the path is alive. If nothing went out and
  // it has been longer than livenessIntervalHours since the last outbound message, send an
  // all-clear. Silence in Telegram then means BROKEN, not "no errors".
  const beat = await deps.readHeartbeat('telegram-notify');
  const lastOutbound = beat?.last_success_at;
  if (result.sent === 0 && shouldSendLiveness(nowIso, lastOutbound, deps.livenessIntervalHours)) {
    const ping = await deps.sendTelegram({
      text: `*Alert path OK* — drain ran at ${nowIso}, no unnotified errors.`,
      parse_mode: 'Markdown',
    });
    if (ping.ok) result.livenessPinged = true;
  }
  if (result.sent > 0 || result.livenessPinged) {
    const hb = await deps.writeHeartbeat('telegram-notify', nowIso, {
      sent: result.sent, liveness: result.livenessPinged,
    });
    if (hb.error) {
      logStructuredError({ fn: 'telegram-notify', errorCode: 'HEARTBEAT_WRITE_FAILED' });
    }
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
