/**
 * agent-chat persistence — pure caller-JWT persistence helpers (ADR-0043 §2/§3/§4/§6).
 *
 * Deputy invariant by construction (NFR-AGP-SEC-001, AC-AGP-018): every function here takes
 * the ALREADY-INJECTED HandlerSupabaseLike (the same caller-JWT client index.ts binds as
 * `callerClient`) — this module never constructs a Supabase client and never references
 * `service_role`. Owner RLS (0046_agent_persistence.sql) is the enforcement authority; these
 * functions never send `org_id`/`owner_id` explicitly (column defaults + WITH CHECK pin them),
 * mirroring the `userViews.ts` DAL pattern.
 *
 * Security forward-flags (issue-1 audit, binding for this module):
 *   - hashToolArgs canonicalizes a VALIDATED args object (post-schema, sorted keys) — never
 *     raw/untrusted model output (NFR-AGP-SEC-004). Canonicalization never spreads/merges the
 *     caller-supplied object; it walks it read-only and rebuilds a new plain object, so a
 *     prototype-pollution key (`__proto__`/`constructor`/`prototype`) in the model-supplied
 *     args can never taint Object.prototype — canonicalize() only ever writes into a fresh
 *     `{}` via bracket assignment on trusted, JSON.stringify-safe keys.
 *   - Tool args callers must JSON.parse model output behind an explicit try (handler.ts already
 *     does this at the dispatch site) with a structured error, not just the outer generator catch.
 */

import { createHash } from 'node:crypto';
import type { AgentEvent, AgentRunStatus } from '../../../pmo-portal/src/lib/agent/runtime/port';
import type { HandlerSupabaseLike } from './handler';

// ── hashToolArgs — sha-256 hex of canonicalized (sorted-key) JSON ────────────

/**
 * Recursively rebuild `value` with object keys sorted (stable order), WITHOUT ever spreading
 * or merging the input — each output object is a fresh `{}` populated key-by-key from the
 * sorted key list, so a `__proto__`/`constructor`/`prototype` key present on the (untrusted,
 * pre-validated) input can never reach the new object's prototype chain (guards against
 * prototype pollution even though these args are expected to already be schema-validated).
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      // Object.keys() never returns 'constructor' (it's non-enumerable on the prototype,
      // not an own key) — but guard explicitly against an own '__proto__'/'prototype' key
      // a caller could still set via JSON.parse (JSON.parse('{"__proto__":...}') creates an
      // OWN enumerable property, not the exotic accessor — still fine to skip defensively).
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * sha-256 hex digest of the canonicalized (sorted-key) JSON of validatedArgs.
 * NFR-AGP-SEC-004: callers must pass the post-schema-validation value, never raw model output.
 * Synchronous by design (matches the plan's signature) — the de-dupe gate (handler.ts) compares
 * hashes inline in a filter/find predicate; `node:crypto`'s createHash is sync in both Deno
 * (native Node-compat) and Node/Vitest, so no async boundary is needed.
 */
export function hashToolArgs(validatedArgs: unknown): string {
  const canonical = canonicalize(validatedArgs);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

// ── PersistenceDeps ───────────────────────────────────────────────────────────

/**
 * The single persistence-dep shape passed from index.ts (bound to callerClient) and consumed
 * by handler.ts. Constructs no client, takes no service_role parameter, by construction.
 */
export interface PersistenceDeps {
  supabase: HandlerSupabaseLike;
  ownerId: string;
  orgId: string;
  now: () => Date;
}

export interface JournaledWrite {
  toolName: string;
  argsHash: string;
  payload: unknown;
}

// ── createThreadAndRun — FR-AGP-010 ───────────────────────────────────────────

/**
 * Create a new agent_threads row (if threadId is absent) and an agent_runs row under it, both
 * under the caller's JWT (owner RLS stamps owner_id/org_id via column default + WITH CHECK —
 * never sent explicitly here). Swallows errors (logs count/code only, NFR-AGP-SEC-005) —
 * persistence failures never block the model turn (Error-Handling table).
 */
export async function createThreadAndRun(
  deps: PersistenceDeps,
  input: { runId: string; title: string; scope?: unknown },
): Promise<void> {
  try {
    const { data: thread, error: threadError } = await deps.supabase
      .from('agent_threads')
      .insert({ title: input.title, scope: input.scope ?? null })
      .select()
      .single();
    if (threadError || !thread) {
      console.error('[agent-chat] persistence createThreadAndRun thread insert failed', {
        code: (threadError as { code?: string } | null)?.code,
      });
      return;
    }
    const threadId = (thread as { id?: string }).id;
    const { error: runError } = await deps.supabase
      .from('agent_runs')
      .insert({ id: input.runId, thread_id: threadId, title: input.title, status: 'running' })
      .select()
      .single();
    if (runError) {
      console.error('[agent-chat] persistence createThreadAndRun run insert failed', {
        code: (runError as { code?: string }).code,
      });
    }
  } catch (err) {
    console.error('[agent-chat] persistence createThreadAndRun threw', {
      code: err instanceof Error ? err.name : 'unknown',
    });
  }
}

// ── insertEvent — FR-AGP-011 ──────────────────────────────────────────────────

/**
 * Insert one agent_events row mirroring a streamed AgentEvent, with the assigned monotonic
 * seq. Swallowed on error (NFR-AGP-SEC-005) — a persistence failure never blocks the SSE stream.
 */
export async function insertEvent(
  deps: PersistenceDeps,
  runId: string,
  seq: number,
  ev: AgentEvent,
): Promise<void> {
  try {
    const { error } = await deps.supabase
      .from('agent_events')
      .insert({
        id: ev.id,
        run_id: runId,
        seq,
        type: ev.type,
        text: ev.text ?? null,
        payload: ev.payload ?? null,
      })
      .select()
      .single();
    if (error) {
      console.error('[agent-chat] persistence insertEvent failed', {
        code: (error as { code?: string }).code,
      });
    }
  } catch (err) {
    console.error('[agent-chat] persistence insertEvent threw', {
      code: err instanceof Error ? err.name : 'unknown',
    });
  }
}

// ── journalToolEvent — FR-AGP-012 ─────────────────────────────────────────────

/**
 * Populate the tool-call journal columns (tool_name/tool_args_hash/tool_status) on the
 * agent_events row identified by eventId. Separate UPDATE from insertEvent because the
 * journal fields are only known once the tool dispatch has resolved (result + status).
 * Swallowed on error (NFR-AGP-SEC-005).
 */
export async function journalToolEvent(
  deps: PersistenceDeps,
  eventId: string,
  journal: { toolName: string; argsHash: string; status: 'completed' | 'errored' },
): Promise<void> {
  try {
    const { error } = await deps.supabase
      .from('agent_events')
      .update({
        tool_name: journal.toolName,
        tool_args_hash: journal.argsHash,
        tool_status: journal.status,
      })
      .eq('id', eventId);
    if (error) {
      console.error('[agent-chat] persistence journalToolEvent failed', {
        code: (error as { code?: string }).code,
      });
    }
  } catch (err) {
    console.error('[agent-chat] persistence journalToolEvent threw', {
      code: err instanceof Error ? err.name : 'unknown',
    });
  }
}

// ── heartbeat — FR-AGP-014 ────────────────────────────────────────────────────

/**
 * UPDATE agent_runs.last_progress_at (+ optional progress_step) — one cheap PK-scoped write
 * per tool round / model turn (NFR-AGP-PERF-002). Swallowed on error: per the spec's
 * Error-Handling table, a transient heartbeat failure does not affect this round's behavior;
 * the next round simply retries the heartbeat.
 */
export async function heartbeat(
  deps: PersistenceDeps,
  runId: string,
  step?: string,
): Promise<void> {
  try {
    const patch: Record<string, unknown> = { last_progress_at: deps.now().toISOString() };
    if (step !== undefined) patch.progress_step = step;
    const { error } = await deps.supabase.from('agent_runs').update(patch).eq('id', runId);
    if (error) {
      console.error('[agent-chat] persistence heartbeat failed', {
        code: (error as { code?: string }).code,
      });
    }
  } catch (err) {
    console.error('[agent-chat] persistence heartbeat threw', {
      code: err instanceof Error ? err.name : 'unknown',
    });
  }
}

// ── setRunStatus — FR-AGP-015 ─────────────────────────────────────────────────

/**
 * Persist a terminal (or any) status onto agent_runs.status. Swallowed on error
 * (NFR-AGP-SEC-005) — persistence failures never block the SSE terminal event.
 */
export async function setRunStatus(
  deps: PersistenceDeps,
  runId: string,
  status: AgentRunStatus,
): Promise<void> {
  try {
    const { error } = await deps.supabase.from('agent_runs').update({ status }).eq('id', runId);
    if (error) {
      console.error('[agent-chat] persistence setRunStatus failed', {
        code: (error as { code?: string }).code,
      });
    }
  } catch (err) {
    console.error('[agent-chat] persistence setRunStatus threw', {
      code: err instanceof Error ? err.name : 'unknown',
    });
  }
}

// ── loadJournaledWrites — FR-AGP-013/018 ──────────────────────────────────────

/**
 * Load a run's completed tool-call journal entries (type='tool', tool_status='completed') for
 * the resume de-dupe gate (FR-AGP-013) and resume context injection (FR-AGP-018).
 * Returns [] on error (fail open to "no journal" — a resume with no journal behaves exactly
 * like a first turn, per the spec's Error-Handling table for "no journaled events").
 */
export async function loadJournaledWrites(
  deps: PersistenceDeps,
  runId: string,
): Promise<JournaledWrite[]> {
  try {
    const { data, error } = await deps.supabase
      .from('agent_events')
      .select('tool_name, tool_args_hash, tool_status, payload')
      .eq('run_id', runId)
      .limit(1000);
    if (error || !data) return [];
    return (data as Array<Record<string, unknown>>)
      .filter((row) => row.tool_status === 'completed' && row.tool_name && row.tool_args_hash)
      .map((row) => ({
        toolName: row.tool_name as string,
        argsHash: row.tool_args_hash as string,
        payload: row.payload,
      }));
  } catch {
    return [];
  }
}
