/**
 * AssistantPanel end-to-end test for the ask-user question flow (ADR-0045 §2,
 * Task I2). A dedicated file (not AssistantPanel.test.tsx) because it needs
 * agentAssistant mocked ON (QuestionChips is flag-guarded, FR-ATC-020) — the
 * shared file intentionally runs flag-off.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/src/lib/features', () => ({
  isFeatureEnabled: (key: string) => key === 'agentAssistant',
  FEATURES: { agentAssistant: true, aiComposer: false, userViews: false, incidents: false },
}));

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

import { AgentRuntimeContext } from '@/src/lib/agent/runtime/AgentRuntimeContext';
import type { AgentEvent, AgentRuntime, AgentRun } from '@/src/lib/agent/runtime/port';
import { AssistantPanel } from './AssistantPanel';

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
  controlSpy: ReturnType<typeof vi.fn>;
  subscribeSpy: ReturnType<typeof vi.fn>;
}

function makeFakeRuntime(runId = 'test-run'): FakeRuntime {
  const createRunSpy = vi.fn().mockResolvedValue({ id: runId, title: 'test', status: 'running' } as AgentRun);
  const followUpSpy = vi.fn().mockResolvedValue(undefined);
  const controlSpy = vi.fn().mockResolvedValue(undefined);
  const subscribeSpy = vi.fn();

  return {
    createRun: createRunSpy,
    followUp: followUpSpy,
    control: controlSpy,
    subscribe: subscribeSpy,
    createRunSpy,
    controlSpy,
    subscribeSpy,
  };
}

function renderPanel(runtime: FakeRuntime) {
  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [isOpen, setIsOpen] = React.useState(true);
    return React.createElement(
      AgentRuntimeContext.Provider,
      {
        value: {
          runtime,
          open: isOpen,
          openPanel: () => setIsOpen(true),
          closePanel: () => setIsOpen(false),
          togglePanel: () => setIsOpen((o) => !o),
        },
      },
      children,
    );
  };

  return render(
    <Wrapper>
      <MemoryRouter>
        <AssistantPanel />
      </MemoryRouter>
    </Wrapper>,
  );
}

describe('AssistantPanel — ask-user question flow (ADR-0045 §2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AC-ATC-017-unit tapping a question chip calls runtime.control(runId,"answer",...) and continues the same run', async () => {
    const user = userEvent.setup();
    const runId = 'q-run-1';
    const runtime = makeFakeRuntime(runId);

    let callCount = 0;
    runtime.subscribeSpy.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return makeAsyncIterable([
          makeEvent('status', {
            runId,
            payload: { kind: 'question', questionId: 'q1', prompt: 'Which project is this for?', options: [{ id: 'a', label: 'Alpha' }] },
          }),
        ]);
      }
      return makeAsyncIterable([
        makeEvent('assistant', { runId, text: 'Logging the call on Alpha.' }),
        makeEvent('status', { runId, payload: { status: 'completed' } }),
      ]);
    });

    renderPanel(runtime);

    const textarea = screen.getByRole('textbox', { name: /ask a question/i });
    await user.type(textarea, 'log a call');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByText('Which project is this for?')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Alpha' }));

    await waitFor(() => {
      expect(runtime.controlSpy).toHaveBeenCalledWith(runId, 'answer', { questionId: 'q1', optionId: 'a', freeText: undefined });
    });

    // Same run continues to a final assistant answer — no new createRun.
    await waitFor(() => {
      expect(screen.getByText('Logging the call on Alpha.')).toBeInTheDocument();
    });
    expect(runtime.createRunSpy).toHaveBeenCalledTimes(1);
  });
});
