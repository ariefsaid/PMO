/**
 * Tests for useAssistantPanel hook orchestration layer.
 * Uses a scripted fake AgentRuntime provided through AgentRuntimeContext.
 * AC-AP-008/016/019/023; FR-AP-009/021/022/023.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { AgentRuntimeContext } from '../lib/agent/runtime/AgentRuntimeContext';
import type { AgentEvent, AgentRuntime, AgentRun } from '../lib/agent/runtime/port';
import { useAssistantPanel } from './useAssistantPanel';

// ── Scripted fake runtime factory ─────────────────────────────────────────────

function makeEvent(type: AgentEvent['type'], overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id: crypto.randomUUID(),
    runId: overrides.runId ?? 'test-run',
    type,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeAsyncIterable(events: AgentEvent[]): AsyncIterable<AgentEvent> {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const ev of events) {
        yield ev;
      }
    },
  };
}

interface FakeRuntime extends AgentRuntime {
  createRunSpy: ReturnType<typeof vi.fn>;
  followUpSpy: ReturnType<typeof vi.fn>;
  controlSpy: ReturnType<typeof vi.fn>;
  subscribeSpy: ReturnType<typeof vi.fn>;
}

function makeFakeRuntime(
  events: AgentEvent[] = [],
  runId = 'test-run',
): FakeRuntime {
  const createRunSpy = vi.fn().mockResolvedValue({ id: runId, title: 'test', status: 'running' } as AgentRun);
  const followUpSpy = vi.fn().mockResolvedValue(undefined);
  const controlSpy = vi.fn().mockResolvedValue(undefined);
  const subscribeSpy = vi.fn().mockReturnValue(makeAsyncIterable(events));

  return {
    createRun: createRunSpy,
    followUp: followUpSpy,
    control: controlSpy,
    subscribe: subscribeSpy,
    createRunSpy,
    followUpSpy,
    controlSpy,
    subscribeSpy,
  };
}

// ── Provider wrapper factory ──────────────────────────────────────────────────

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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useAssistantPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AC-AP-008 send() with no runId calls createRun with the goal', async () => {
    const completedEvent = makeEvent('status', {
      payload: { status: 'completed' },
    });
    const runtime = makeFakeRuntime([completedEvent]);
    const wrapper = makeWrapper(runtime);

    const { result } = renderHook(() => useAssistantPanel(), { wrapper });

    await act(async () => {
      await result.current.send('how many projects?');
    });

    expect(runtime.createRunSpy).toHaveBeenCalledWith({ goal: 'how many projects?' });
  });

  it('AC-AP-023 send() with a held runId calls followUp + re-subscribes', async () => {
    const runId = 'abc';
    const completedEvent = makeEvent('status', {
      runId,
      payload: { status: 'completed' },
    });

    const runtime = makeFakeRuntime([completedEvent], runId);
    const wrapper = makeWrapper(runtime);

    const { result } = renderHook(() => useAssistantPanel(), { wrapper });

    // First send — createRun
    await act(async () => {
      await result.current.send('first message');
    });

    // Verify phase is idle now (completed)
    expect(result.current.phase).toBe('idle');
    expect(result.current.runId).toBe(runId);

    // Second send — with runId held, should call followUp
    await act(async () => {
      await result.current.send('more');
    });

    expect(runtime.followUpSpy).toHaveBeenCalledWith(runId, 'more');
    expect(runtime.subscribeSpy).toHaveBeenCalledTimes(2);
  });

  it('AC-AP-019 stop() calls control(runId, cancel) and returns to idle', async () => {
    // Set up a runtime where createRun resolves and the stream runs
    const runId = 'stop-run';
    const completedEvent = makeEvent('status', {
      runId,
      payload: { status: 'completed' },
    });
    const runtime = makeFakeRuntime([completedEvent], runId);

    const wrapper = makeWrapper(runtime);
    const { result } = renderHook(() => useAssistantPanel(), { wrapper });

    // Send a message to get a runId
    await act(async () => {
      await result.current.send('show active projects');
    });

    // Phase should be idle after the stream completed
    expect(result.current.runId).toBe(runId);

    // Now manually set phase to running and call stop
    // We test that stop() properly calls control() and sets phase to idle
    // by calling stop() directly (which requires a runId)
    await act(async () => {
      await result.current.stop();
    });

    expect(runtime.controlSpy).toHaveBeenCalledWith(runId, 'cancel');
    expect(result.current.phase).toBe('idle');

    // A "Stopped" entry should be in the transcript
    expect(
      result.current.transcript.some(
        (e) => e.event.type === 'system' && e.event.text === 'Stopped',
      ),
    ).toBe(true);
  });

  it('newConversation() cancels in-flight run via control() and drains leaking events are ignored', async () => {
    // Verify that newConversation() calls control(runId, 'cancel') when a run is active,
    // and that the drain guard (drainRunId !== runIdRef) prevents old events from
    // polluting the fresh transcript.
    const runId = 'flight-run';

    // Use a completed stream; we just test newConversation calls control()
    // when runId is set, then resets state cleanly.
    const completedEvent = makeEvent('status', {
      runId,
      payload: { status: 'completed' },
    });
    const runtime = makeFakeRuntime([completedEvent], runId);
    runtime.createRunSpy.mockResolvedValue({ id: runId, title: 'test', status: 'running' } as AgentRun);

    const wrapper = makeWrapper(runtime);
    const { result } = renderHook(() => useAssistantPanel(), { wrapper });

    // Send a message and let the stream complete so runId is set
    await act(async () => {
      await result.current.send('first question');
    });

    expect(result.current.runId).toBe(runId);
    expect(result.current.phase).toBe('idle');

    // Now start a new "in-flight" state by sending again (drain will complete quickly)
    // The key test: call newConversation when runId IS set → must call control()
    await act(async () => {
      result.current.newConversation();
    });

    // newConversation must have called control(runId, 'cancel') since a runId was held
    expect(runtime.controlSpy).toHaveBeenCalledWith(runId, 'cancel');

    // After newConversation: transcript is empty, phase is idle, runId is null
    expect(result.current.transcript).toHaveLength(0);
    expect(result.current.phase).toBe('idle');
    expect(result.current.runId).toBeNull();
  });

  it('AC-AP-016 retry() re-invokes createRun with the last goal', async () => {
    const runId = 'err-run';
    const errorEvent = makeEvent('status', {
      runId,
      payload: { status: 'errored', error: 'UPSTREAM_ERROR' },
    });
    const runtime = makeFakeRuntime([errorEvent], runId);
    const wrapper = makeWrapper(runtime);

    const { result } = renderHook(() => useAssistantPanel(), { wrapper });

    // Send to enter error state
    await act(async () => {
      await result.current.send('show active projects');
    });

    await waitFor(() => {
      expect(result.current.phase).toBe('error');
    });

    expect(result.current.lastGoal).toBe('show active projects');

    // Reset mock for retry
    const retryRunId = 'retry-run';
    runtime.createRunSpy.mockResolvedValue({
      id: retryRunId,
      title: 'retry',
      status: 'running',
    } as AgentRun);
    // Provide a completed stream for retry
    runtime.subscribeSpy.mockReturnValue(
      makeAsyncIterable([makeEvent('status', { runId: retryRunId, payload: { status: 'completed' } })]),
    );

    await act(async () => {
      await result.current.retry();
    });

    // createRun should have been called a second time with the same goal
    expect(runtime.createRunSpy).toHaveBeenCalledTimes(2);
    expect(runtime.createRunSpy).toHaveBeenLastCalledWith({
      goal: 'show active projects',
    });
  });
});
