/**
 * AC-AUC-019 — composer disables and shows out-of-credits message.
 * Mirrors AssistantPanel.test.tsx's harness (mocked AgentRuntimeContext, scripted fake runtime).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
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

describe('AssistantPanel — out-of-credits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.style.overflow = '';
  });

  it('AC-AUC-019 composer disables and shows out-of-credits message', async () => {
    const user = userEvent.setup();
    const runId = 'r1';
    const events: AgentEvent[] = [
      makeEvent('status', {
        runId,
        payload: { status: 'errored', error: 'RATE_LIMITED', retryAfterSeconds: 0 },
      }),
    ];
    const runtime = makeFakeRuntime(events, runId);
    renderPanel(runtime);

    const textarea = screen.getByRole('textbox', { name: /ask a question/i });
    await user.type(textarea, 'do something expensive');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(
        screen.getByText(/used up your assistant credits/i),
      ).toBeInTheDocument();
    });

    // role="status"/aria-live region (NFR-AUC-A11Y-001)
    const statusRegion = screen.getByRole('status');
    expect(statusRegion).toHaveAttribute('aria-live');
    expect(statusRegion).toHaveTextContent(/used up your assistant credits/i);

    // Composer textarea hard-disabled (NFR-AUC-A11Y-002)
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /ask a question/i })).toBeDisabled();
    });

    // Send button also disabled/absent
    expect(screen.queryByRole('button', { name: /send message/i })).toBeDisabled();
  });

  it('does not render the generic ErrorCard for a RATE_LIMITED out-of-credits event', async () => {
    const user = userEvent.setup();
    const runId = 'r2';
    const events: AgentEvent[] = [
      makeEvent('status', {
        runId,
        payload: { status: 'errored', error: 'RATE_LIMITED', retryAfterSeconds: 0 },
      }),
    ];
    const runtime = makeFakeRuntime(events, runId);
    renderPanel(runtime);

    const textarea = screen.getByRole('textbox', { name: /ask a question/i });
    await user.type(textarea, 'do something expensive');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByText(/used up your assistant credits/i)).toBeInTheDocument();
    });

    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^retry$/i })).not.toBeInTheDocument();
  });
});
