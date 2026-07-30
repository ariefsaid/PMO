/**
 * transcriptCompaction — shrink the *miss* portion of the agent's transcript replay.
 *
 * PMO's agent is ~94% input tokens: every round replays the whole growing transcript (D8 stateless
 * replay). The heavy, low-value part is OLD tool results — raw DB rows the model already distilled
 * into its next assistant message, yet re-sent verbatim on every subsequent round. This module
 * replaces those old tool-result bodies with a compact marker, cutting input tokens without touching
 * the reasoning thread (all user/assistant text is preserved) or the cached system prefix.
 *
 * SAFETY INVARIANTS (why this can't corrupt a run):
 *   1. messages[0] (the system prompt) is NEVER touched — it is the cached prefix (ADR: cache
 *      locality). Compacting it would destroy the prompt-cache win.
 *   2. NO message is ever removed and NO tool_call_id changes — only the CONTENT string of an old
 *      role:'tool' message is swapped for a marker. The assistant(tool_calls)→tool(result) pairing
 *      the OpenAI/OpenRouter API requires stays intact.
 *   3. The replacement is valid JSON, so a model that JSON-parses tool content still succeeds.
 *   4. Token-budget-triggered, not turn-count: under `triggerChars` the transcript is returned
 *      untouched (small chats pay nothing); a recency window of the last N messages is always kept
 *      verbatim so the model keeps recent results intact to reason with.
 *
 * Pure — no I/O, no Deno globals; importable in Vitest.
 */
import type { ModelMessage } from './modelClient.ts';

export interface CompactionOptions {
  /** Compaction runs only when the estimated transcript size (chars) exceeds this. */
  triggerChars: number;
  /** The most recent N messages are kept verbatim (never compacted). */
  recentMessages: number;
  /** An older role:'tool' body longer than this (chars) is replaced with the marker. */
  maxToolResultChars: number;
}

/**
 * Defaults tuned for the deepseek-v4-flash agent (~4 chars/token): trigger ~20k tokens of transcript,
 * keep the last ~6 turns (12 messages) intact, compact any older tool body over ~200 tokens. Deploy-
 * tunable via AGENT_COMPACTION_* (compactionOptionsFromEnv).
 *
 * FR-RQL-003: `triggerChars` was raised 24k→80k and `recentMessages` 6→12 after a prod regression
 * (agent-requery-loop): a single cross-entity analytical turn (projects+milestones+tasks ≈ 8 reads,
 * ~50k chars) tripped the old 24k trigger MID-TURN, compacting the very rows the model still needed to
 * synthesize its answer. It then re-queried the compacted data, burned MAX_TOOL_ROUNDS, and hit the
 * step limit with NO answer. 80k (~20k tokens, well within deepseek's context) keeps a normal analytical
 * turn intact; compaction still guards genuinely long multi-turn conversations.
 */
export const DEFAULT_COMPACTION: CompactionOptions = {
  triggerChars: 80_000,
  recentMessages: 12,
  maxToolResultChars: 800,
};

/** Rough token-proxy: content length + serialized tool_calls length, in characters. */
export function estimateTranscriptChars(messages: ModelMessage[]): number {
  let total = 0;
  for (const m of messages) {
    total += m.content ? m.content.length : 0;
    if (m.tool_calls) total += JSON.stringify(m.tool_calls).length;
  }
  return total;
}

/**
 * Best-effort rowCount from a query_entity tool-result body, so the compaction marker can retain
 * provenance (FR-RQL-002) without the model needing to re-query. Non-JSON / non-object → undefined.
 */
function toolRowCount(content: string): number | undefined {
  try {
    const p = JSON.parse(content) as { rowCount?: unknown; rows?: unknown };
    if (p && typeof p === 'object') {
      if (typeof p.rowCount === 'number') return p.rowCount;
      if (Array.isArray(p.rows)) return p.rows.length;
    }
  } catch {
    /* not JSON — no rowCount to retain */
  }
  return undefined;
}

/**
 * The valid-JSON marker that replaces an old tool result's body.
 * FR-RQL-001/002: the note must NOT invite the model to re-run the tool (that instruction drove a
 * step-limit re-query loop on the weak deepseek model); instead it states the data was already
 * retrieved and carries the tool name + rowCount so the model references it rather than re-fetching.
 */
function compactedMarker(originalChars: number, toolName?: string, rowCount?: number): string {
  return JSON.stringify({
    _compacted: true,
    note: 'This result was already retrieved earlier in this conversation and used. Do NOT call the tool again for it — answer from the transcript above.',
    ...(toolName ? { tool: toolName } : {}),
    ...(typeof rowCount === 'number' ? { rowCount } : {}),
    chars_omitted: originalChars,
  });
}

/**
 * Return a compacted copy of `messages` (or the same array unchanged when under budget / nothing to
 * compact). Only OLD role:'tool' bodies past the recency window are replaced; everything else —
 * system prompt, user/assistant text, recent tool results, all tool_call_ids — is preserved.
 */
export function compactTranscript(
  messages: ModelMessage[],
  opts: CompactionOptions = DEFAULT_COMPACTION,
): ModelMessage[] {
  if (messages.length === 0) return messages;
  // Under budget → no-op (small chats are never touched).
  if (estimateTranscriptChars(messages) <= opts.triggerChars) return messages;

  const cutoff = messages.length - Math.max(0, opts.recentMessages); // indices < cutoff are "old"
  let changed = false;
  const out = messages.map((m, i) => {
    if (i === 0) return m; // never touch the system prefix (cache locality)
    if (i >= cutoff) return m; // recency window kept verbatim
    if (m.role !== 'tool') return m; // only compact tool results (the heavy raw rows)
    if (!m.content || m.content.length <= opts.maxToolResultChars) return m;
    changed = true;
    return { ...m, content: compactedMarker(m.content.length, m.name, toolRowCount(m.content)) };
  });
  return changed ? out : messages;
}

/**
 * Build CompactionOptions from edge-fn env (pure — unit-testable). Any unset/invalid knob falls back
 * to DEFAULT_COMPACTION; a non-positive `triggerChars` (AGENT_COMPACTION_TRIGGER_CHARS=0) DISABLES
 * compaction by setting an effectively-infinite trigger.
 *   AGENT_COMPACTION_TRIGGER_CHARS   integer chars; 0 disables compaction entirely.
 *   AGENT_COMPACTION_RECENT_MESSAGES integer count of trailing messages kept verbatim.
 *   AGENT_COMPACTION_MAX_TOOL_CHARS  integer max chars of an old tool body before it's compacted.
 */
export function compactionOptionsFromEnv(env: {
  AGENT_COMPACTION_TRIGGER_CHARS?: string;
  AGENT_COMPACTION_RECENT_MESSAGES?: string;
  AGENT_COMPACTION_MAX_TOOL_CHARS?: string;
}): CompactionOptions {
  const intOr = (raw: string | undefined, fallback: number): number => {
    if (raw === undefined) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && Number.isInteger(n) && n >= 0 ? n : fallback;
  };
  const trigger = intOr(env.AGENT_COMPACTION_TRIGGER_CHARS, DEFAULT_COMPACTION.triggerChars);
  return {
    // 0 → disable: an effectively-unreachable trigger so compactTranscript is always a no-op.
    triggerChars: trigger === 0 ? Number.MAX_SAFE_INTEGER : trigger,
    recentMessages: intOr(env.AGENT_COMPACTION_RECENT_MESSAGES, DEFAULT_COMPACTION.recentMessages),
    maxToolResultChars: intOr(env.AGENT_COMPACTION_MAX_TOOL_CHARS, DEFAULT_COMPACTION.maxToolResultChars),
  };
}
