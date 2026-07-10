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
 * Defaults tuned for the deepseek-v4-flash agent (~4 chars/token): trigger ~6k tokens of transcript,
 * keep the last ~3 turns (6 messages) intact, compact any older tool body over ~200 tokens. Deploy-
 * tunable via AGENT_COMPACTION_* (compactionOptionsFromEnv).
 */
export const DEFAULT_COMPACTION: CompactionOptions = {
  triggerChars: 24_000,
  recentMessages: 6,
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

/** The valid-JSON marker that replaces an old tool result's body. */
function compactedMarker(originalChars: number): string {
  return JSON.stringify({
    _compacted: true,
    note: 'Older tool result omitted to save context. Re-run the tool if you still need this data.',
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
    return { ...m, content: compactedMarker(m.content.length) };
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
