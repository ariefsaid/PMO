/**
 * Tests for useAssistantPanel's answerQuestion (ADR-0045 §2, Task Q7).
 * AC-ATC-008: tapping a chip resolves via control('answer'), never followUp.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { AgentRuntimeContext } from '../lib/agent/runtime/AgentRuntimeContext';
import type { AgentEvent, AgentRuntime, AgentRun } from '../lib/agent/runtime/port';
import { useAssistantPanel } from './useAssistantPanel';

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
      for (const ev of events) yield ev;
    },
  };
}

interface FakeRuntime extends AgentRuntime {
  createRunSpy: ReturnType<typeof vi.fn>;
  followUpSpy: ReturnType<typeof vi.fn>;
  controlSpy: ReturnType<typeof vi.fn>;
  subscribeSpy: ReturnType<typeof vi.fn>;
}

function makeFakeRuntime(events: AgentEvent[] = [], runId = 'test-run'): FakeRuntime {
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

describe('useAssistantPanel.answerQuestion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AC-ATC-008 answerQuestion calls control(runId, "answer", payload), not followUp', async () => {
    const runId = 'run-q1';
    const questionEvent = makeEvent('status', {
      runId,
      payload: { kind: 'question', questionId: 'q1', prompt: 'Which project?', options: [{ id: 'a', label: 'Alpha' }] },
    });
    const completedEvent = makeEvent('status', { runId, payload: { status: 'completed' } });

    const runtime = makeFakeRuntime([questionEvent], runId);
    const wrapper = makeWrapper(runtime);
    const { result } = renderHook(() => useAssistantPanel(), { wrapper });

    await act(async () => {
      await result.current.send('log a call');
    });

    // Prime the second subscribe to return the completion.
    runtime.subscribeSpy.mockReturnValueOnce(makeAsyncIterable([completedEvent]));

    await act(async () => {
      await result.current.answerQuestion('q1', 'a');
    });

    expect(runtime.controlSpy).toHaveBeenCalledWith(runId, 'answer', { questionId: 'q1', optionId: 'a', freeText: undefined });
    expect(runtime.followUpSpy).not.toHaveBeenCalled();
  });

  it('answerQuestion appends the question event so TranscriptItem can render QuestionChips', async () => {
    const runId = 'run-q2';
    const questionEvent = makeEvent('status', {
      runId,
      payload: { kind: 'question', questionId: 'q2', prompt: 'Which project?', options: [] },
    });

    const runtime = makeFakeRuntime([questionEvent], runId);
    const wrapper = makeWrapper(runtime);
    const { result } = renderHook(() => useAssistantPanel(), { wrapper });

    await act(async () => {
      await result.current.send('log a call');
    });

    const found = result.current.transcript.find(
      (e) => e.event.type === 'status' && (e.event.payload as { kind?: string } | undefined)?.kind === 'question',
    );
    expect(found).toBeDefined();
  });

  it('answerQuestion with freeText passes freeText through to control', async () => {
    const runId = 'run-q3';
    const questionEvent = makeEvent('status', {
      runId,
      payload: { kind: 'question', questionId: 'q3', prompt: 'Anything else?', options: [], allowFreeText: true },
    });
    const completedEvent = makeEvent('status', { runId, payload: { status: 'completed' } });

    const runtime = makeFakeRuntime([questionEvent], runId);
    const wrapper = makeWrapper(runtime);
    const { result } = renderHook(() => useAssistantPanel(), { wrapper });

    await act(async () => {
      await result.current.send('log a call');
    });

    runtime.subscribeSpy.mockReturnValueOnce(makeAsyncIterable([completedEvent]));

    await act(async () => {
      await result.current.answerQuestion('q3', undefined, 'Beta project');
    });

    expect(runtime.controlSpy).toHaveBeenCalledWith(runId, 'answer', { questionId: 'q3', optionId: undefined, freeText: 'Beta project' });
  });
});
