/**
 * A 413 PAYLOAD_TOO_LARGE run error (the conversation outgrew agent-chat's transcript limits) reads as
 * its own non-retryable message with a way forward, not the generic "try again" card.
 * Mirrors AssistantPanel.credits.test.tsx's harness (mocked AgentRuntimeContext, scripted fake runtime).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { AgentRuntimeContext } from '@/src/lib/agent/runtime/AgentRuntimeContext';
import type { AgentEvent, AgentRuntime, AgentRun } from '@/src/lib/agent/runtime/port';
import { AssistantPanel } from './AssistantPanel';

const listAgentThreadsMock = vi.fn().mockResolvedValue([]);
vi.mock('@/src/lib/db/agentThreads', () => ({
  listAgentThreads: (...args: unknown[]) => listAgentThreadsMock(...args),
}));

const listRunEventsMock = vi.fn().mockResolvedValue([]);
vi.mock('@/src/lib/db/agentEvents', () => ({
  listRunEvents: (...args: unknown[]) => listRunEventsMock(...args),
}));

const getRunHeartbeatMock = vi.fn().mockResolvedValue({ last_progress_at: new Date().toISOString(), status: 'running' });
vi.mock('@/src/lib/db/agentRuns', () => ({
  getRunHeartbeat: (...args: unknown[]) => getRunHeartbeatMock(...args),
}));

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

function makeFakeRuntime(events: AgentEvent[], runId = 'test-run'): AgentRuntime {
  return {
    createRun: vi.fn().mockResolvedValue({ id: runId, title: 'test', status: 'running' } as AgentRun),
    followUp: vi.fn().mockResolvedValue(undefined),
    control: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(makeAsyncIterable(events)),
  };
}

function renderPanel(runtime: AgentRuntime) {
  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) =>
    React.createElement(
      AgentRuntimeContext.Provider,
      {
        value: {
          runtime,
          open: true,
          openPanel: () => {},
          closePanel: () => {},
          togglePanel: () => {},
        },
      },
      children,
    );

  return render(
    <Wrapper>
      <MemoryRouter>
        <AssistantPanel />
      </MemoryRouter>
    </Wrapper>,
  );
}


describe('AssistantPanel — conversation too long', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.style.overflow = '';
  });

  async function sendAndHitTheLimit(runtime: AgentRuntime) {
    const user = userEvent.setup();
    renderPanel(runtime);
    await user.type(screen.getByRole('textbox', { name: /ask a question/i }), 'one more question');
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('This conversation is too long. Start a new one.');
    });
    return user;
  }

  const tooLong = (runId: string) => [
    makeEvent('status', { runId, payload: { status: 'errored', error: 'PAYLOAD_TOO_LARGE' } }),
  ];

  it('tells the user to start a new conversation and offers no Retry', async () => {
    await sendAndHitTheLimit(makeFakeRuntime(tooLong('r1'), 'r1'));

    expect(screen.queryByRole('button', { name: /^retry$/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
  });

  it('starting a new conversation from the message clears it and keeps the composer usable', async () => {
    const user = await sendAndHitTheLimit(makeFakeRuntime(tooLong('r1'), 'r1'));

    await user.click(screen.getByRole('button', { name: /start a new conversation/i }));

    expect(screen.queryByText('This conversation is too long. Start a new one.')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /ask a question/i })).toBeEnabled();
  });

  it('any other run error still shows the generic card with Retry', async () => {
    const user = userEvent.setup();
    renderPanel(makeFakeRuntime([
      makeEvent('status', { runId: 'r2', payload: { status: 'errored', error: 'UPSTREAM_ERROR' } }),
    ], 'r2'));
    await user.type(screen.getByRole('textbox', { name: /ask a question/i }), 'q');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.getByText(/something went wrong/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /^retry$/i })).toBeInTheDocument();
    expect(screen.queryByText(/conversation is too long/i)).not.toBeInTheDocument();
  });
});
