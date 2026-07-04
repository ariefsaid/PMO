/**
 * Flag-off proof for live context (ADR-0045 §3, FR-ATC-020).
 * A separate file from useAssistantPanel.context.test.tsx because that file
 * mocks '../lib/features' at module scope (vi.mock is file-scoped/hoisted).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { AgentRuntimeContext } from '../lib/agent/runtime/AgentRuntimeContext';
import type { AgentEvent, AgentRuntime, AgentRun } from '../lib/agent/runtime/port';
import { useAssistantPanel } from './useAssistantPanel';

function makeAsyncIterable(events: AgentEvent[]): AsyncIterable<AgentEvent> {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const ev of events) yield ev;
    },
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

describe('useAssistantPanel live context — flag-off', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('FR-ATC-020 flag-off: createRun is called WITHOUT a context field (no AgentContextProvider needed)', async () => {
    const completedEvent: AgentEvent = {
      id: crypto.randomUUID(),
      runId: 'test-run',
      type: 'status',
      payload: { status: 'completed' },
      createdAt: new Date().toISOString(),
    };
    const createRunSpy = vi.fn().mockResolvedValue({ id: 'test-run', title: 'test', status: 'running' } as AgentRun);
    const runtime: AgentRuntime = {
      createRun: createRunSpy,
      followUp: vi.fn(),
      control: vi.fn(),
      subscribe: vi.fn().mockReturnValue(makeAsyncIterable([completedEvent])),
    };
    const wrapper = makeWrapper(runtime);

    const { result } = renderHook(() => useAssistantPanel(), { wrapper });

    await act(async () => {
      await result.current.send('summarize this');
    });

    // isFeatureEnabled('agentAssistant') is false by default in the test env
    // (no VITE_FEATURES_AGENT_ASSISTANT) — getContext() must never be called.
    expect(createRunSpy).toHaveBeenCalledWith({ goal: 'summarize this' });
  });
});
