/**
 * dispatcher.ts — pure tick orchestration for the agent-dispatch edge fn (ADR-0044 §2).
 * selectDueSchedules/selectTriggerMatches run the dispatcher's selection queries under the
 * service_role client, quarantined to metadata enumeration only (FR-AAN-014, NFR-AAN-SEC-002) —
 * never business data. Importable in Vitest (REC-1); no Deno globals here.
 */
import { cronMatches } from './cron';
import { readWatermark } from './watermark';

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
