/**
 * assistantPanelEvents — the PURE transcript/event reduction seam of the assistant
 * panel (extracted from useAssistantPanel, THEME-CROSS-84). No React, no runtime
 * access: the orchestration hook (useAssistantPanel) consumes these reducers inside
 * its drain loop and keeps keyed approval/question behavior and analytics effects.
 *
 *   - mergeAssistantEvent: NFR-AP-PERF-002 — successive assistant events of the same
 *     run concatenate into one stable-key entry.
 *   - appendAssistantEvent: the drain loop's append rule, including the server-echo
 *     dedupe for user events (send() appends the user's message optimistically; the
 *     stream re-delivers the SAME message as a type:'user' event which must not
 *     render a second, identical bubble).
 */
import type { AgentEvent } from '../../lib/agent/runtime/port';

export interface TranscriptEntry {
  key: string;
  event: AgentEvent;
}

export function makeKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Append or concatenate an assistant event into the transcript.
 * NFR-AP-PERF-002: successive assistant events in the same turn are concatenated
 * into one stable-key entry (the key stays fixed; only .event.text grows).
 */
export function mergeAssistantEvent(
  prev: TranscriptEntry[],
  ev: AgentEvent,
): TranscriptEntry[] {
  // Find the last entry: if it's an assistant event with the same runId, concatenate.
  const last = prev[prev.length - 1];
  if (last && last.event.type === 'assistant' && last.event.runId === ev.runId) {
    // Mutate the text in-place (same key keeps stable reference for perf).
    const merged: TranscriptEntry = {
      key: last.key,
      event: { ...last.event, text: (last.event.text ?? '') + (ev.text ?? '') },
    };
    return [...prev.slice(0, -1), merged];
  }
  return [...prev, { key: makeKey(), event: ev }];
}

/**
 * The drain loop's default append rule: skip a 'user' echo that duplicates the most
 * recent existing user entry (that entry IS send()'s optimistic add this echo
 * mirrors); otherwise append with a fresh key, preserving any user event not already
 * shown — a repeated identical message is still exactly one optimistic entry ahead
 * of its own echo, so this rule never suppresses a genuinely new turn.
 */
export function appendAssistantEvent(
  prev: TranscriptEntry[],
  ev: AgentEvent,
): TranscriptEntry[] {
  if (ev.type === 'user') {
    const lastUser = [...prev].reverse().find((e) => e.event.type === 'user');
    if (lastUser && lastUser.event.text === ev.text) return prev;
  }
  return [...prev, { key: makeKey(), event: ev }];
}
