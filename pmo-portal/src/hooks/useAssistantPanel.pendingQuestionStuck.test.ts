/**
 * RED-first regression test for gpt-5.5 cross-family audit finding 3:
 * "pending question trips stuck-run."
 *
 * Bug: a pending ask_user question (ADR-0045 §2) leaves the hook's `phase` at
 * 'running' (the drain loop never transitions phase on a `status{kind:'question'}`
 * payload — it's appended as-is, same as a plain running/paused status frame).
 * isStuck's derivation only looks at `phase` + heartbeat staleness, so waiting on
 * the human past STUCK_RUN_STALE_MS incorrectly shows the stuck-run banner even
 * though the run is correctly, harmlessly waiting on the user — not wedged.
 *
 * Fix: derive `hasPendingQuestion` from the transcript (a trailing unresolved
 * status{kind:'question'} entry) and exclude it from isStuck.
 *
 * [REC-2]: hook lives at src/hooks/useAssistantPanel.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { AgentRuntimeContext } from '../lib/agent/runtime/AgentRuntimeContext';
import type { AgentEvent, AgentRuntime } from '../lib/agent/runtime/port';
import { useAssistantPanel } from './useAssistantPanel';

const h = vi.hoisted(() => ({ getRunHeartbeat: vi.fn() }));
vi.mock('../lib/db/agentRuns', () => ({ getRunHeartbeat: h.getRunHeartbeat }));
vi.mock('../lib/db/agentEvents', () => ({ listRunEvents: vi.fn() }));

function makeWrapper(runtime: AgentRuntime) {
  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [open, setOpen] = React.useState(false);
    return React.createElement(
      AgentRuntimeContext.Provider,
      {
        value: {
          runtime,
          open,
          openPanel: () => setOpen(true),
          closePanel: () => setOpen(false),
          togglePanel: () => setOpen((o) => !o),
        },
      },
      children,
    );
  };
  return Wrapper;
}

function makeAsyncIterable(events: AgentEvent[]): AsyncIterable<AgentEvent> {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const ev of events) yield ev;
      await new Promise(() => {}); // stay open — the run is paused awaiting the answer
    },
  };
}

describe('useAssistantPanel isStuck excludes a pending question (finding 3)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    h.getRunHeartbeat.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a run with a pending question + a stale heartbeat is NOT isStuck', async () => {
    const runId = 'run-q-stuck';
    const questionEvent: AgentEvent = {
      id: 'e1',
      runId,
      type: 'status',
      payload: {
        kind: 'question',
        questionId: 'q1',
        prompt: 'Which project is this for?',
        options: [{ id: 'a', label: 'Alpha' }],
      },
      createdAt: new Date().toISOString(),
    };

    const runtime: AgentRuntime = {
      createRun: vi.fn().mockResolvedValue({ id: runId, title: 't', status: 'running' }),
      followUp: vi.fn().mockResolvedValue(undefined),
      control: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockReturnValue(makeAsyncIterable([questionEvent])),
    };
    const wrapper = makeWrapper(runtime);
    const { result } = renderHook(() => useAssistantPanel(), { wrapper });

    // Heartbeat is genuinely stale (server hasn't advanced it) — this is EXPECTED while
    // the run is legitimately waiting on the human, not evidence of being wedged.
    const staleTimestamp = new Date(Date.now() - 5 * 60_000).toISOString();
    h.getRunHeartbeat.mockResolvedValue({ last_progress_at: staleTimestamp, status: 'running' });

    await act(async () => {
      void result.current.send('log a call');
      await vi.advanceTimersByTimeAsync(0);
    });

    // Advance well past STUCK_RUN_STALE_MS via the poll cadence.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    // Sanity: the question is indeed pending in the transcript.
    const found = result.current.transcript.find(
      (e) => e.event.type === 'status' && (e.event.payload as { kind?: string } | undefined)?.kind === 'question',
    );
    expect(found).toBeDefined();

    expect(result.current.isStuck).toBe(false);
  });
});
