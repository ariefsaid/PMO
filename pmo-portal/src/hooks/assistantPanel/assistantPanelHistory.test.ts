/**
 * assistantPanelHistory — the pure thread-history mapping seam extracted from
 * useAssistantPanel's openThread (THEME-CROSS-84 / FR-AGP-021). Pins:
 *   - rows are ordered by (seq) ascending and mapped to AgentEvents verbatim
 *   - consecutive assistant rows fold through the SAME mergeAssistantEvent reducer
 *     the live drain uses, so a reload reproduces the original live-merge sequence
 *   - priorMessages seeds the runtime adoption with user+assistant turns in seq order
 *   - lastEventAt carries the most recent event's createdAt (or null for empty history)
 */
import { describe, it, expect } from 'vitest';
import type { AgentEventRow } from '../../lib/repositories';
import { buildThreadHistory } from './assistantPanelHistory';

function row(overrides: Partial<AgentEventRow>): AgentEventRow {
  return {
    id: 'evt-1',
    run_id: 'run-1',
    seq: 1,
    type: 'system',
    text: null,
    payload: null,
    created_at: '2026-07-03T00:00:01.000Z',
    ...overrides,
  } as AgentEventRow;
}

describe('buildThreadHistory — FR-AGP-021 resume-on-open mapping', () => {
  it('orders rows by seq ascending regardless of input order', () => {
    const history = buildThreadHistory([
      row({ id: 'e3', seq: 3, type: 'assistant', text: ' third' }),
      row({ id: 'e1', seq: 1, type: 'user', text: 'first' }),
      row({ id: 'e2', seq: 2, type: 'assistant', text: 'Second,' }),
    ]);
    expect(history.transcript.map((e) => e.event.text)).toEqual(['first', 'Second, third']);
    // The consecutive assistant rows fold into ONE stable-key entry.
    expect(history.transcript).toHaveLength(2);
  });

  it('keeps non-assistant events as separate entries in seq order', () => {
    const history = buildThreadHistory([
      row({ id: 'e1', seq: 1, type: 'user', text: 'q' }),
      row({ id: 'e2', seq: 2, type: 'tool', text: null }),
      row({ id: 'e3', seq: 3, type: 'user', text: 'again' }),
    ]);
    expect(history.transcript.map((e) => e.event.type)).toEqual(['user', 'tool', 'user']);
  });

  it('maps row fields onto AgentEvents verbatim (payload included)', () => {
    const payload = { status: 'completed' };
    const history = buildThreadHistory([row({ payload, type: 'status' })]);
    expect(history.transcript[0].event.payload).toEqual(payload);
    expect(history.transcript[0].event.type).toBe('status');
    expect(history.transcript[0].event.createdAt).toBe('2026-07-03T00:00:01.000Z');
  });

  it('derives priorMessages 1:1 from text-bearing user/assistant rows (assistant chunks stay separate)', () => {
    // Shipped behavior: priorMessages maps from the ROW sequence — consecutive assistant
    // chunks are separate replay messages (the model sees its chunks as distinct turns),
    // while the DISPLAY transcript folds them via mergeAssistantEvent.
    const history = buildThreadHistory([
      row({ id: 'e1', seq: 1, type: 'user', text: 'question one' }),
      row({ id: 'e2', seq: 2, type: 'assistant', text: 'answer part one' }),
      row({ id: 'e3', seq: 3, type: 'assistant', text: ' plus two' }),
      row({ id: 'e4', seq: 4, type: 'tool', text: null }), // not a transcript turn
      row({ id: 'e5', seq: 5, type: 'user', text: null }), // textless user event — excluded
    ]);
    expect(history.priorMessages).toEqual([
      { role: 'user', content: 'question one' },
      { role: 'assistant', content: 'answer part one' },
      { role: 'assistant', content: ' plus two' },
    ]);
    // …while the display transcript folds the assistant chunks into one entry and keeps
    // every non-assistant event as its own entry (even textless ones — payload-rendered).
    expect(history.transcript.map((e) => [e.event.type, e.event.text])).toEqual([
      ['user', 'question one'],
      ['assistant', 'answer part one plus two'],
      ['tool', undefined],
      ['user', undefined],
    ]);
  });

  it('reports lastEventAt from the final (highest-seq) event, or null for an empty history', () => {
    const history = buildThreadHistory([
      row({ seq: 1, created_at: '2026-07-03T00:00:01.000Z' }),
      row({ seq: 2, created_at: '2026-07-03T00:00:05.000Z' }),
    ]);
    expect(history.lastEventAt).toBe('2026-07-03T00:00:05.000Z');
    expect(buildThreadHistory([]).lastEventAt).toBeNull();
    expect(buildThreadHistory([]).transcript).toEqual([]);
    expect(buildThreadHistory([]).priorMessages).toEqual([]);
  });
});
