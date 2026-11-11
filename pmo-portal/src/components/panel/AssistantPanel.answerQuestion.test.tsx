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
import { MemoryRouter } from 'react-router';

vi.mock('@/src/lib/features', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/features')>();
  return {
    ...actual,
    isFeatureEnabled: (key: string) => key === 'agentAssistant',
    FEATURES: { agentAssistant: true, aiComposer: false, userViews: false, incidents: false },
  };
});

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

  it('AC-ATC-017: a table and question remain visible as the same run continues', async () => {
    const user = userEvent.setup();
    const runId = 'widget-question-run';
    const runtime = makeFakeRuntime(runId);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    runtime.subscribeSpy.mockReturnValueOnce({
      [Symbol.asyncIterator]: async function* () {
        await gate;
        yield makeEvent('tool', { runId, payload: { entity: 'projects', rowCount: 2 } });
        yield makeEvent('assistant', { runId, text: 'Here are your over-budget projects:' });
        yield makeEvent('artifact', { runId, payload: { kind: 'widget', widget: {
          kind: 'data_table', columns: [{ key: 'name', label: 'Project' }, { key: 'overage', label: 'Overage' }],
          rows: [{ id: 'p1', name: 'Refinery Expansion Alpha', overage: '$42,000' }, { id: 'p2', name: 'Pipeline Retrofit Beta', overage: '$8,500' }], caption: 'Over-budget projects',
        } } });
        yield makeEvent('status', { runId, payload: { kind: 'question', questionId: 'q-region', prompt: 'Would you like to see this by region or by client?', options: [{ id: 'region', label: 'By region' }, { id: 'client', label: 'By client' }] } });
      },
    }).mockReturnValueOnce(makeAsyncIterable([
      makeEvent('assistant', { runId, text: 'Grouped by region: 1 project in each region.' }),
      makeEvent('status', { runId, payload: { status: 'completed' } }),
    ]));
    renderPanel(runtime);
    await user.type(screen.getByRole('textbox', { name: /ask a question/i }), 'show me over-budget projects{Enter}');
    try { expect(await screen.findByRole('button', { name: /stop generating/i })).toBeVisible(); }
    finally { release(); }
    const table = await screen.findByRole('table');
    expect(screen.getByRole('columnheader', { name: 'Project' })).toBeVisible();
    expect(screen.getByRole('cell', { name: 'Refinery Expansion Alpha' })).toBeVisible();
    expect(screen.getByRole('cell', { name: 'Pipeline Retrofit Beta' })).toBeVisible();
    expect(screen.queryByText(/\| Project \|/)).not.toBeInTheDocument();
    const question = await screen.findByRole('group', { name: /would you like to see this by region or by client/i });
    expect(runtime.createRunSpy).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'By region' }));
    await waitFor(() => expect(runtime.controlSpy).toHaveBeenCalledWith(runId, 'answer', { questionId: 'q-region', optionId: 'region', freeText: undefined }));
    expect(await screen.findByText(/grouped by region/i)).toBeVisible();
    expect(table).toBeVisible();
    expect(question).toBeVisible();
    expect(runtime.createRunSpy).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('button', { name: /send message/i })).toBeVisible());
    expect(screen.queryByRole('button', { name: /stop generating/i })).not.toBeInTheDocument();
  });

  it('AC-AXP-013: ambiguous project request shows choices and continues the same run', async () => {
    const user = userEvent.setup();
    const runId = 'question-run';
    const runtime = makeFakeRuntime(runId);
    runtime.subscribeSpy.mockReturnValueOnce(makeAsyncIterable([
      makeEvent('status', { runId, payload: { kind: 'question', questionId: 'q-1', prompt: 'Which project set should I show?', options: [{ id: 'active', label: 'Active projects' }, { id: 'at-risk', label: 'At-risk projects' }] } }),
    ])).mockReturnValueOnce(makeAsyncIterable([
      makeEvent('assistant', { runId, text: 'Showing active projects.' }),
      makeEvent('status', { runId, payload: { status: 'completed' } }),
    ]));
    renderPanel(runtime);
    await user.type(screen.getByRole('textbox', { name: /ask a question/i }), 'show my projects{Enter}');
    const group = await screen.findByRole('group', { name: /which project set should i show/i });
    expect(group).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Active projects' }));
    await waitFor(() => expect(runtime.controlSpy).toHaveBeenCalledWith(runId, 'answer', { questionId: 'q-1', optionId: 'active', freeText: undefined }));
    expect(await screen.findByText('Showing active projects.')).toBeVisible();
    expect(group).toBeVisible();
    expect(runtime.createRunSpy).toHaveBeenCalledTimes(1);
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

  // ── Review-remediation item 6: SR live-region announcement for a pending question ──

  it('item 6: a pending question renders a polite SR announcement (mirrors the approval announcement)', async () => {
    const user = userEvent.setup();
    const runId = 'q-run-2';
    const runtime = makeFakeRuntime(runId);

    runtime.subscribeSpy.mockImplementation(() =>
      makeAsyncIterable([
        makeEvent('status', {
          runId,
          payload: { kind: 'question', questionId: 'q1', prompt: 'Which project is this for?', options: [{ id: 'a', label: 'Alpha' }] },
        }),
      ]),
    );

    renderPanel(runtime);

    const textarea = screen.getByRole('textbox', { name: /ask a question/i });
    await user.type(textarea, 'log a call');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByText('Which project is this for?')).toBeInTheDocument();
    });

    // A distinct polite status announcement tells SR users WHY the run is
    // paused, mirroring "A write action awaits your decision" for approvals.
    expect(screen.getByText(/awaits your answer/i)).toBeInTheDocument();
  });
});
