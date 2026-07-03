/**
 * Tests for useAssistantPanel's live-context wiring (ADR-0045 §3, Task X3).
 * FR-ATC-015: send()'s createRun call carries context: getContext() when a
 * host is wrapped in AgentContextProvider.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../lib/features', () => ({
  isFeatureEnabled: (key: string) => key === 'agentAssistant',
  FEATURES: { agentAssistant: true },
}));

import { AgentRuntimeContext } from '../lib/agent/runtime/AgentRuntimeContext';
import { AgentContextProvider } from '../lib/agent/context/AgentContextProvider';
import type { AgentEvent, AgentRuntime, AgentRun } from '../lib/agent/runtime/port';
import { useAssistantPanel } from './useAssistantPanel';

function makeAsyncIterable(events: AgentEvent[]): AsyncIterable<AgentEvent> {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const ev of events) yield ev;
    },
  };
}

function makeFakeRuntime(events: AgentEvent[] = [], runId = 'test-run') {
  const createRunSpy = vi.fn().mockResolvedValue({ id: runId, title: 'test', status: 'running' } as AgentRun);
  const followUpSpy = vi.fn().mockResolvedValue(undefined);
  const controlSpy = vi.fn().mockResolvedValue(undefined);
  const subscribeSpy = vi.fn().mockReturnValue(makeAsyncIterable(events));

  return {
    runtime: {
      createRun: createRunSpy,
      followUp: followUpSpy,
      control: controlSpy,
      subscribe: subscribeSpy,
    } as AgentRuntime,
    createRunSpy,
  };
}

function makeWrapper(runtime: AgentRuntime, route = '/projects/123') {
  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [open, setOpen] = React.useState(false);
    return (
      <MemoryRouter initialEntries={[route]}>
        <AgentContextProvider>
          <AgentRuntimeContext.Provider
            value={{
              runtime,
              open,
              openPanel: () => setOpen(true),
              closePanel: () => setOpen(false),
              togglePanel: () => setOpen((o) => !o),
            }}
          >
            {children}
          </AgentRuntimeContext.Provider>
        </AgentContextProvider>
      </MemoryRouter>
    );
  };
  return Wrapper;
}

describe('useAssistantPanel live context wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('FR-ATC-015 send() createRun carries context.route from the current route', async () => {
    const completedEvent: AgentEvent = {
      id: crypto.randomUUID(),
      runId: 'test-run',
      type: 'status',
      payload: { status: 'completed' },
      createdAt: new Date().toISOString(),
    };
    const { runtime, createRunSpy } = makeFakeRuntime([completedEvent]);
    const wrapper = makeWrapper(runtime, '/projects/123');

    const { result } = renderHook(() => useAssistantPanel(), { wrapper });

    await act(async () => {
      await result.current.send('summarize this');
    });

    expect(createRunSpy).toHaveBeenCalledWith({
      goal: 'summarize this',
      context: expect.objectContaining({ route: '/projects/123' }),
    });
  });
});
