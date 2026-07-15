// audit.ts — audit_m365_event RPC + error_events wrappers for m365-token-custody.
// Pure functions, importable in Vitest. No Deno globals, no client construction.
//
// EF7 (Director correction): audit goes through the `audit_m365_event` security-definer wrapper
// (granted to service_role; calls postgres-owned log_audit internally) — NOT a direct log_audit
// call (log_audit is revoked from public). org/actor are passed explicitly because the OAuth
// callback path has no auth.uid() context. recordErrorEvent uses the shared 2-arg form
// recordErrorEvent(supabase, {fn, errorCode, contextId?, orgId?}).

import type { M365SupabaseLike } from './types.ts';
import { recordErrorEvent, type ErrorEventSupabaseLike } from '../_shared/errorEvent.ts';

export interface LogAuditParams {
  action: string; // MUST be m365.* (the audit_m365_event wrapper allowlists this prefix)
  orgId: string;
  actorId: string;
  entityId: string;
  detail: Record<string, unknown>;
}

/**
 * Emit an audit_events row via the audit_m365_event security-definer wrapper (DB6). The wrapper
 * is the ONLY sanctioned path to audit_events from the edge fn. Audit failure is swallowed — it
 * must never perturb the caller's main flow (AC-M365-140: no secret in the logged detail).
 */
export async function logAudit(
  serviceClient: M365SupabaseLike,
  params: LogAuditParams,
): Promise<void> {
  const { error } = await serviceClient.rpc('audit_m365_event', {
    p_action: params.action,
    p_org_id: params.orgId,
    p_actor_id: params.actorId,
    p_entity_id: params.entityId,
    p_detail: params.detail,
  });
  if (error) {
    console.error('[m365-token-custody] audit_m365_event RPC failed', {
      errorCode: 'AUDIT_RPC_FAILED',
      action: params.action,
    });
    // Swallow — audit failure must not perturb the main flow.
  }
}

/** Wrapper for recordErrorEvent with the m365-token-custody fn name. ctx carries NO secret. */
export async function recordM365Error(
  serviceClient: M365SupabaseLike,
  ctx: { errorCode: string; contextId?: string; orgId?: string },
): Promise<void> {
  // The real supabase-js query builder is a thenable, not nominally a Promise (missing
  // catch/finally/[Symbol.toStringTag] under Deno's stricter check — same bridge agent-chat/
  // compose-view use for ErrorEventSupabaseLike/UsageDeps). A localized structural cast; no
  // runtime change (the real client satisfies the insert() shape at runtime).
  await recordErrorEvent(serviceClient as unknown as ErrorEventSupabaseLike, {
    fn: 'm365-token-custody',
    errorCode: ctx.errorCode,
    contextId: ctx.contextId,
    orgId: ctx.orgId,
  });
}
