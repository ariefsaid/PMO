/**
 * confirmedAction — the shared authorization/journal mechanics used by BOTH the approval
 * path (handleDecision) and the auto-approval path (runToolLoop's low-materiality writes)
 * (THEME-CROSS-93): the forced-confirmed dispatch seam, the needs-approval resolver, the
 * action→can() mapping (FR-AW-010), the durable denial audit (0079 RPC), the deputy
 * re-auth profiles lookup and the validated-argument journal check. Each caller keeps its
 * own distinct event order around these primitives.
 */
import type { AgentAction, DeputyContext } from '../../../pmo-portal/src/lib/agent/runtime/port.ts';
import { isDestructiveDeleteAction } from './actions.ts';
import { hashToolArgs } from './persistence.ts';
import { findJournaledWrite } from './turnPersistence.ts';
import type { HandlerDeps, HandlerSupabaseLike, PersistenceRuntime, JournaledWrite } from './handlerTypes.ts';

// ── Dispatch helpers (A3/NFR-AW-SEC-001) ─────────────────────────────────────

/**
 * The ONLY site that may call action.run on a confirm:false action.
 * Guard: if the action has confirm:true, this throws (unreachable in production —
 * the handler routes confirm:true through the approval branch).
 */
export async function dispatchAction(
  action: AgentAction,
  toolInput: unknown,
  ctx: import('../../../pmo-portal/src/lib/agent/runtime/port.ts').DeputyContext,
): Promise<unknown> {
  if (action.confirm) {
    throw new Error(`dispatchAction: confirm:true action '${action.name}' must route through the approval branch`);
  }
  return action.run(toolInput, ctx);
}

/**
 * Execute an approved confirm:true action (bypasses the confirm guard because
 * the approval gate has already fired). Called ONLY after deputy re-auth passes.
 */
export async function dispatchActionForced(
  action: AgentAction,
  validatedInput: unknown,
  ctx: DeputyContext,
): Promise<unknown> {
  return action.run(validatedInput, ctx);
}

/**
 * ADR-0051: decide whether a write needs the human A3 chip. UX-only; this gates
 * only chip visibility, never RLS/RPC enforcement. Destructive deletes are
 * always material. Without a predicate, the existing static confirm behavior is
 * preserved.
 */
export function resolveNeedsApproval(
  action: AgentAction,
  input: unknown,
  ctx: DeputyContext,
): boolean {
  if (isDestructiveDeleteAction(action.name)) return true;
  if (action.needsApproval) return action.needsApproval(input, ctx);
  return action.confirm ?? false;
}

// ── Action-to-can() mapping (FR-AW-010) ──────────────────────────────────────

/**
 * Map an action name to the can() arguments for deputy re-auth.
 * Returns null if no permission check is configured for this action.
 */
export function getPermissionCheck(
  actionName: string,
): { action: string; entity: string } | null {
  switch (actionName) {
    case 'create_activity':
      return { action: 'create', entity: 'contactActivity' };
    case 'update_task_status':
      return { action: 'edit', entity: 'taskStatus' };
    case 'draft_invoice':
      return { action: 'create', entity: 'salesInvoice' };
    // remind_overdue: no can() entity — send_task_reminders is the authority (ADR-0016/0019, #1639 PQ-3).
    default:
      return null;
  }
}

/**
 * Audit Observability-High #1: durably record an agent authorization REFUSAL — the handler
 * denying a tool/action for SoD/permission reasons — so a misconfigured automation or a
 * prompt-injection escalation attempt survives the SSE-stream close. Wraps the
 * `audit_agent_denial` SECURITY DEFINER RPC (migration 0079), which stamps org/actor
 * SERVER-SIDE from the live JWT (non-forgeable) and writes via log_audit (0076); the caller
 * supplies only `reason` + `detail` (the attempted tool/action, thread/run id), which land in
 * `audit_events.detail`.
 *
 * FAIL-OPEN: a failed audit write MUST NOT change the refusal behavior or break the user's
 * turn — this is observability, not a gate. Errors are swallowed + console.error'd (same
 * posture as recordErrorEvent's self-swallowing, but awaited so the row lands before the
 * stream closes when possible).
 */
export async function auditAgentDenial(
  supabase: HandlerSupabaseLike,
  reason: string,
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    await supabase.rpc('audit_agent_denial', { p_reason: reason, p_detail: detail });
  } catch (err) {
    console.error('audit_agent_denial_failed', err);
  }
}


/**
 * Shared deputy re-auth (AC-AW-004): re-derive the caller's org + role from profiles under
 * the SAME deps. Returns null when the lookup fails — the caller emits its own terminal
 * event (the two paths differ in what they emit around this check).
 */
export async function rederiveDeputyAuth(
  deps: HandlerDeps,
): Promise<{ role: string | null; orgId: string | null } | null> {
  try {
    const { data, error } = await deps.supabase
      .from('profiles')
      .select('org_id, role')
      .eq('id', deps.userId)
      .single();
    if (error || !data) return null;
    return { role: data.role ?? null, orgId: data.org_id ?? null };
  } catch {
    return null;
  }
}

/**
 * Shared validated-argument journal check (FR-AGP-013/015): a write whose
 * (toolName, argsHash-of-VALIDATED-args) matches an already-journaled COMPLETED call is
 * replayable from the journal — action.run is never re-invoked for it. NFR-AGP-SEC-004:
 * the hash is computed from the POST-validation value, never the raw tool input.
 */
export function findValidatedJournal(
  persist: PersistenceRuntime | undefined,
  toolName: string,
  validatedValue: unknown,
): JournaledWrite | undefined {
  return persist ? findJournaledWrite(persist, toolName, hashToolArgs(validatedValue)) : undefined;
}
