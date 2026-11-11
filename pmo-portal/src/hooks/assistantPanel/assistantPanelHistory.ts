/**
 * assistantPanelHistory — the PURE thread-history mapping seam of the assistant
 * panel (extracted from useAssistantPanel's openThread, THEME-CROSS-84 / FR-AGP-021).
 * Maps persisted agent_events rows (ordered by (run_id, seq)) into the transcript and
 * the prior-message seed the runtime adoption needs. No React, no runtime access:
 * useAssistantPanel performs the adoption (runtime.adoptRun) and state updates from
 * the returned history.
 */
import type { AgentEvent } from '../../lib/agent/runtime/port';
import type { AgentEventRow } from '../../lib/repositories';
import { makeKey, mergeAssistantEvent, type TranscriptEntry } from './assistantPanelEvents';

export interface ThreadHistory {
  /** The restored transcript, in (run_id, seq) order with assistant rows folded. */
  transcript: TranscriptEntry[];
  /**
   * The accumulated user+assistant turns (text-bearing events, in seq order) — the
   * seed passed to runtime.adoptRun so a FOLLOW-UP replays full context (D8/R5).
   */
  priorMessages: { role: 'user' | 'assistant'; content: string }[];
  /** createdAt of the highest-seq event (the heartbeat stamp), or null for no events. */
  lastEventAt: string | null;
}

/**
 * Build the restored transcript + adoption seed from a run's persisted event rows.
 * Folding consecutive assistant rows through the SAME mergeAssistantEvent reducer the
 * live drain uses means a reload reproduces the original live-merge sequence.
 */
export function buildThreadHistory(rows: AgentEventRow[]): ThreadHistory {
  const ordered = [...rows].sort((a, b) => a.seq - b.seq);
  const events: AgentEvent[] = ordered.map((row) => ({
    id: row.id,
    runId: row.run_id,
    type: row.type as AgentEvent['type'],
    text: row.text ?? undefined,
    payload: row.payload ?? undefined,
    createdAt: row.created_at,
  }));

  let transcript: TranscriptEntry[] = [];
  for (const ev of events) {
    transcript = ev.type === 'assistant' ? mergeAssistantEvent(transcript, ev) : [...transcript, { key: makeKey(), event: ev }];
  }

  const priorMessages = events
    .filter((e): e is AgentEvent & { text: string } => (e.type === 'user' || e.type === 'assistant') && !!e.text)
    .map((e) => ({ role: e.type as 'user' | 'assistant', content: e.text }));

  return {
    transcript,
    priorMessages,
    lastEventAt: events.length > 0 ? events[events.length - 1].createdAt : null,
  };
}
