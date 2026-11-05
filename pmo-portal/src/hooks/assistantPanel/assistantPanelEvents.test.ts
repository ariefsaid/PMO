/**
 * assistantPanelEvents — the pure transcript/event reduction seam extracted from
 * useAssistantPanel (THEME-CROSS-84). These tests pin the EXACT behaviors the
 * orchestration hook's drain loop exhibited before the extraction:
 *   - mergeAssistantEvent: consecutive same-run assistant events concatenate under a
 *     stable key (NFR-AP-PERF-002)
 *   - appendAssistantEvent: a server-echoed user event that duplicates send()'s
 *     optimistic append is skipped; every other event appends with a fresh key
 */
import { describe, it, expect } from 'vitest';
import type { AgentEvent } from '../../lib/agent/runtime/port';
import { makeKey, mergeAssistantEvent, appendAssistantEvent } from './assistantPanelEvents';

function ev(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id: 'evt-1',
    runId: 'run-1',
    type: 'system',
    text: 'hello',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('makeKey', () => {
  it('mints distinct keys', () => {
    expect(makeKey()).not.toBe(makeKey());
  });
});

describe('mergeAssistantEvent — NFR-AP-PERF-002 assistant concat', () => {
  it('concatenates a successive assistant event of the same run into the last entry (stable key)', () => {
    const first = mergeAssistantEvent([], ev({ type: 'assistant', text: 'Hello' }));
    expect(first).toHaveLength(1);

    const merged = mergeAssistantEvent(first, ev({ type: 'assistant', text: ' world' }));
    expect(merged).toHaveLength(1);
    expect(merged[0].key).toBe(first[0].key);
    expect(merged[0].event.text).toBe('Hello world');
  });

  it('appends separately when the last entry is NOT an assistant event', () => {
    const withTool = mergeAssistantEvent([], ev({ type: 'tool' }));
    const after = mergeAssistantEvent(withTool, ev({ type: 'assistant', text: 'Done' }));
    expect(after).toHaveLength(2);
    expect(after[1].event.type).toBe('assistant');
  });

  it('appends separately when the assistant event belongs to a DIFFERENT run', () => {
    const runA = mergeAssistantEvent([], ev({ type: 'assistant', runId: 'run-a', text: 'A' }));
    const after = mergeAssistantEvent(runA, ev({ type: 'assistant', runId: 'run-b', text: 'B' }));
    expect(after).toHaveLength(2);
  });
});

describe('appendAssistantEvent — server-echo dedupe', () => {
  it('skips a user echo identical to the most recent user entry (the optimistic add)', () => {
    const optimistic = appendAssistantEvent([], ev({ type: 'user', text: 'hi there' }));
    expect(optimistic).toHaveLength(1);

    const echoed = appendAssistantEvent(optimistic, ev({ type: 'user', text: 'hi there' }));
    expect(echoed).toBe(optimistic); // no new entry — returns the same array
    expect(echoed).toHaveLength(1);
  });

  it('appends a user event that is NOT a duplicate of the last user entry', () => {
    const prev = appendAssistantEvent([], ev({ type: 'user', text: 'first' }));
    const next = appendAssistantEvent(prev, ev({ type: 'user', text: 'second' }));
    expect(next).toHaveLength(2);
  });

  it('compares against the most recent USER entry even across intervening non-user events (the echo mirrors its optimistic add)', () => {
    const first = appendAssistantEvent([], ev({ type: 'user', text: 'repeat me' }));
    const middle = appendAssistantEvent(first, ev({ type: 'system', text: 'intervening' }));
    const next = appendAssistantEvent(middle, ev({ type: 'user', text: 'repeat me' }));
    // The most recent user entry still has identical text → skipped (shipped rule).
    expect(next).toBe(middle);
    expect(next).toHaveLength(2);
  });

  it('a different-text user event after intervening events appends (a genuinely new turn)', () => {
    const first = appendAssistantEvent([], ev({ type: 'user', text: 'first' }));
    const middle = appendAssistantEvent(first, ev({ type: 'system', text: 'intervening' }));
    const next = appendAssistantEvent(middle, ev({ type: 'user', text: 'different' }));
    expect(next).toHaveLength(3);
  });

  it('appends non-user events with a fresh key', () => {
    const next = appendAssistantEvent([], ev({ type: 'tool' }));
    expect(next).toHaveLength(1);
    expect(next[0].key).toBeTruthy();
    expect(next[0].event.type).toBe('tool');
  });
});
