/**
 * remind_overdue (#1639, OD-GRILL-20261101) — one coarse confirmed write: remind the people whose overdue tasks the caller
 * can see. The model supplies at most a task name; recipients are derived on the server (the send RPC re-derives them
 * from each task row). ADR-0079 §2: prepared before the chip; the approved value is what runs.
 */
import type { AgentAction, DeputyContext, PrepareResult } from '../../../pmo-portal/src/lib/agent/runtime/port.ts';
import { loadOverdueFacts, OVERDUE_TASK_CAP, OVERDUE_TIMEOUT_MS } from './overdue.ts';
import { REMIND_OVERDUE_SCHEMA } from './schema.ts';
import { asRpc, UUID_RE, withTimeout } from './looseClient.ts';
import { formatShortDate } from './agentFormat.ts';

export const REMINDER_BATCH_CAP = 10; // FR-RMD-007 / OQ-7, = the send RPC's batch limit
const PREVIEW_CAP = OVERDUE_TASK_CAP; // PQ-5: = the preview RPC's limit and the overdue fetch cap (50)
const SUMMARY_LISTED = 3;

export interface RemindRequest { task?: string }
export interface PreparedReminder { taskId: string; taskName: string; recipientName: string; dueDate: string }
export interface PreparedReminders { kind: 'prepared-reminders'; reminders: PreparedReminder[] }
type Outcome = 'eligible' | 'sent' | 'not_found' | 'not_overdue' | 'no_assignee' | 'self' | 'recipient_inactive' | 'already_reminded' | 'daily_limit';
interface RpcItem { task_id: string; outcome: Outcome; task_name?: string | null; recipient_name?: string | null }
interface RpcResult { remaining: number; items: RpcItem[] }

const refuse = (error: string, extra: Record<string, unknown> = {}): PrepareResult => ({ ok: false, error: { error, ...extra } });

export function validateRemindRequest(input: unknown): { ok: true; value: RemindRequest } | { ok: false; error: string } {
  const i = (input ?? {}) as Record<string, unknown>;
  if (Object.keys(i).some((k) => k !== 'task')) return { ok: false, error: 'only "task" may be given' };
  if (i.task === undefined) return { ok: true, value: {} };
  if (typeof i.task !== 'string' || !i.task.trim() || i.task.length > 200) return { ok: false, error: 'task must be a short name' };
  return { ok: true, value: { task: i.task.trim() } };
}

export async function prepareRemindOverdue(input: RemindRequest, ctx: DeputyContext, now: Date = new Date()): Promise<PrepareResult> {
  const rpc = asRpc(ctx.supabase);
  if (!rpc) return refuse('Reminders are not available right now.');
  const facts = await withTimeout(loadOverdueFacts(ctx, now), OVERDUE_TIMEOUT_MS);
  let pool = facts.tasks.filter((t) => t.assigneeId && t.assigneeId !== ctx.userId); // FR-RMD-002, never self
  if (input.task) {
    const needle = input.task.toLowerCase();
    pool = pool.filter((t) => t.name.toLowerCase().includes(needle));
    if (pool.length === 0) return refuse(`No overdue task named "${input.task}" belongs to someone else.`);
    if (pool.length > 1) {
      return refuse('Which task should I send a reminder for?', {
        needs: 'choice',
        candidates: pool.slice(0, 8).map((t) => ({ id: t.name, label: `${t.name}${t.assigneeName ? ` (${t.assigneeName})` : ''}` })),
      });
    }
  }
  if (pool.length === 0) return refuse('Every overdue task shown is yours or has no assignee, so there is nobody to remind.');
  pool = pool.slice(0, PREVIEW_CAP); // already oldest-due first (overdue.ts sort)

  const { data, error } = await withTimeout(rpc.rpc('preview_task_reminders', { p_task_ids: pool.map((t) => t.id) }), OVERDUE_TIMEOUT_MS);
  if (error || !data) return refuse('Reminders could not be checked right now.');
  const preview = data as RpcResult;
  const ok = new Map(preview.items.filter((i) => i.outcome === 'eligible').map((i) => [i.task_id, i.recipient_name ?? 'a colleague']));
  const eligible = pool.filter((t) => ok.has(t.id));
  if (eligible.length === 0) return refuse('Nobody can be reminded: these people were already reminded today or are no longer active.');
  if (preview.remaining <= 0) return refuse('You have reached today\'s reminder limit. Try again tomorrow.');
  const chosen = eligible.slice(0, Math.min(preview.remaining, REMINDER_BATCH_CAP)); // FR-RMD-006 / FR-RMD-007
  const left = eligible.length - chosen.length;
  const why = preview.remaining < Math.min(eligible.length, REMINDER_BATCH_CAP) ? 'daily reminder limit' : `at most ${REMINDER_BATCH_CAP} per request`;

  const reminders: PreparedReminder[] = chosen.map((t) => ({
    taskId: t.id, taskName: t.name, recipientName: ok.get(t.id)!, dueDate: t.dueDate,
  }));
  const listed = reminders.slice(0, SUMMARY_LISTED)
    .map((r) => `${r.recipientName} about ${r.taskName} (due ${formatShortDate(r.dueDate)})`).join('; ');
  const more = reminders.length > SUMMARY_LISTED ? `; and ${reminders.length - SUMMARY_LISTED} more` : '';
  const capped = left > 0 ? ` ${left} left out: ${why}.` : '';
  const n = reminders.length;
  return {
    ok: true,
    value: { kind: 'prepared-reminders', reminders } satisfies PreparedReminders,
    summary: `Send ${n} reminder${n === 1 ? '' : 's'}: ${listed}${more}.${capped}`,
  };
}

/** AC-RMD-016: allow-list rebuild of the replayed approved value. */
export function validatePreparedReminders(input: unknown): { ok: true; value: PreparedReminders } | { ok: false; error: string } {
  const v = input as Partial<PreparedReminders> | null;
  if (!v || typeof v !== 'object' || Object.keys(v).some((k) => k !== 'kind' && k !== 'reminders')) return { ok: false, error: 'bad shape' };
  if (v.kind !== 'prepared-reminders' || !Array.isArray(v.reminders)) return { ok: false, error: 'bad shape' };
  if (v.reminders.length < 1 || v.reminders.length > REMINDER_BATCH_CAP) return { ok: false, error: 'between 1 and 10 reminders' };
  const seen = new Set<string>();
  const reminders: PreparedReminder[] = [];
  for (const r of v.reminders as unknown[]) {
    const x = r as Record<string, unknown>;
    if (!x || Object.keys(x).some((k) => !['taskId', 'taskName', 'recipientName', 'dueDate'].includes(k))) return { ok: false, error: 'bad reminder' };
    if (typeof x.taskId !== 'string' || !UUID_RE.test(x.taskId) || seen.has(x.taskId)) return { ok: false, error: 'bad task id' };
    if (typeof x.taskName !== 'string' || typeof x.recipientName !== 'string' || typeof x.dueDate !== 'string') return { ok: false, error: 'bad reminder' };
    seen.add(x.taskId);
    reminders.push({ taskId: x.taskId, taskName: x.taskName, recipientName: x.recipientName, dueDate: x.dueDate });
  }
  return { ok: true, value: { kind: 'prepared-reminders', reminders } };
}

/** AC-RMD-017: sends task ids only; the RPC derives every recipient and enforces every rule. Names come from the
 *  RPC's result, never from the replayed value (PQ-6). */
export async function runRemindOverdue(input: unknown, ctx: DeputyContext): Promise<unknown> {
  const v = validatePreparedReminders(input);
  if (v.ok === false) return { error: v.error };
  const rpc = asRpc(ctx.supabase);
  if (!rpc) return { error: 'Reminders are not available right now.' };
  const { data, error } = await withTimeout(
    rpc.rpc('send_task_reminders', { p_task_ids: v.value.reminders.map((r) => r.taskId) }), OVERDUE_TIMEOUT_MS,
  );
  if (error || !data) return { error: 'The reminders could not be sent right now.', code: (error as { code?: string } | null)?.code };
  const result = data as RpcResult;
  return {
    ok: true,
    sent: result.items.filter((i) => i.outcome === 'sent').map((i) => ({ to: i.recipient_name ?? 'a colleague', task: i.task_name ?? null })),
    skipped: result.items.filter((i) => i.outcome !== 'sent').map((i) => ({ task: i.task_name ?? null, reason: i.outcome })),
    remainingToday: result.remaining,
    note: 'Say who was reminded in one short sentence. Mention any skipped task and why in plain words.',
  };
}

export const remindOverdueAction: AgentAction & {
  validate: typeof validateRemindRequest;
  summarize: (i: unknown) => string;
} = {
  name: 'remind_overdue',
  description:
    'Remind the people whose overdue tasks the user can see (or the one task the user named). Sends an in-app reminder to each assignee after the user confirms. Never reminds the user themself.',
  inputSchema: REMIND_OVERDUE_SCHEMA,
  surfaces: ['agent'],
  confirm: true,
  needsApproval: () => true,
  validate: validateRemindRequest,
  prepare: (input, ctx) => prepareRemindOverdue(input as RemindRequest, ctx),
  validatePrepared: validatePreparedReminders,
  // Only reached if a caller bypasses `prepare` — the handler always uses prepare's summary.
  summarize: () => 'Send reminders about overdue tasks.',
  run: runRemindOverdue,
};
