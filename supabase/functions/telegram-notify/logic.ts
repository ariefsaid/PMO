/**
 * telegram-notify/logic — pure helpers for the Telegram alert drain (observability
 * floor, DC-OF-001 step 6). No Deno globals except `fetch` (used only inside
 * buildTelegramPayload's caller / pingHeartbeat — both accept fetch implicitly via
 * the global, mockable in Vitest via vi.stubGlobal, per NFR-OF-TEST-001). Importable
 * in Vitest.
 */

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
