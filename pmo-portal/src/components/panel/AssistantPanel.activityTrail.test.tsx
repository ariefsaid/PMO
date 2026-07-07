/**
 * AssistantPanel activity-trail tests — the persistent, legible checklist of what the
 * agent has done and is doing during a run.
 *
 * Drives step → tool → step events through the SAME drain loop that powers the live step
 * trail, and asserts the ActivityTrail renders a done row (✓ + friendly label + detail)
 * for the completed lookup and a current row (spinner) for the in-flight one, then clears
 * on a terminal status / a fresh run. Harness mirrors AssistantPanel.stepTrail.test.tsx
 * (scripted fake runtime via AgentRuntimeContext, DAL mocks incl. getRunHeartbeat).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { AgentRuntimeContext } from '@/src/lib/agent/runtime/AgentRuntimeContext';
import type { AgentEvent, AgentRuntime, AgentRun } from '@/src/lib/agent/runtime/port';
import { AssistantPanel } from './AssistantPanel';

// Mirror AssistantPanel.test.tsx's DAL mocks so this suite never touches the real supabase
// client (incl. the hook's server-heartbeat poll → getRunHeartbeat).
const listAgentThreadsMock = vi.fn().mockResolvedValue([]);
vi.mock('@/src/lib/db/agentThreads', () => ({
  listAgentThreads: (...args: unknown[]) => listAgentThreadsMock(...args),
}));

const listRunEventsMock = vi.fn().mockResolvedValue([]);
vi.mock('@/src/lib/db/agentEvents', () => ({
  listRunEvents: (...args: unknown[]) => listRunEventsMock(...args),
}));

const getRunHeartbeatMock = vi.fn().mockResolvedValue({
  last_progress_at: new Date().toISOString(),
  status: 'running',
});
vi.mock('@/src/lib/db/agentRuns', () => ({
  getRunHeartbeat: (...args: unknown[]) => getRunHeartbeatMock(...args),
}));

// ── Scripted fake runtime ─────────────────────────────────────────────────────

function makeEvent(type: AgentEvent['type'], overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id: crypto.randomUUID(),
    runId: overrides.runId ?? 'trail-run',
    type,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

interface FakeRuntime extends AgentRuntime {
  createRunSpy: ReturnType<typeof vi.fn>;
  subscribeSpy: ReturnType<typeof vi.fn>;
  controlSpy: ReturnType<typeof vi.fn>;
  followUpSpy: ReturnType<typeof vi.fn>;
}

function makeFakeRuntime(subscribe: () => AsyncIterable<AgentEvent>, runId = 'trail-run'): FakeRuntime {
  const createRunSpy = vi
    .fn()
    .mockResolvedValue({ id: runId, title: 'test', status: 'running' } as AgentRun);
  return {
    createRun: createRunSpy,
    followUp: vi.fn().mockResolvedValue(undefined),
    control: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockImplementation(subscribe),
    createRunSpy,
    followUpSpy: vi.fn(),
    controlSpy: vi.fn(),
    subscribeSpy: vi.fn(),
  } as unknown as FakeRuntime;
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

describe('AssistantPanel persistent activity trail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.style.overflow = '';
  });

  it('accumulates done + current rows from step/tool events, then clears on a terminal status', async () => {
    const user = userEvent.setup();
    const runId = 'trail-run';

    let releaseSecondStep!: () => void;
    let releaseComplete!: () => void;
    const secondStepGate = new Promise<void>((r) => (releaseSecondStep = r));
    const completeGate = new Promise<void>((r) => (releaseComplete = r));

    const runtime = makeFakeRuntime(
      () => ({
        [Symbol.asyncIterator]: async function* () {
          // 1) first lookup — projects
          yield makeEvent('status', { payload: { kind: 'step', label: 'Looking up projects…' } });
          yield makeEvent('tool', {
            payload: { name: 'query_entity', input: { entity: 'projects' }, result: { rowCount: 4, rows: [] } },
          });
          await secondStepGate;
          // 2) second lookup — crm activities (still in flight when we assert)
          yield makeEvent('status', { payload: { kind: 'step', label: 'Looking up crm activities…' } });
          await completeGate;
          // 3) terminal — run done, trail clears
          yield makeEvent('assistant', { runId, text: 'All done.' });
          yield makeEvent('status', { payload: { status: 'completed' } });
        },
      }),
      runId,
    );
    renderPanel(runtime);

    const textarea = screen.getByRole('textbox', { name: /ask a question/i });
    await user.type(textarea, 'summarize my deals');
    await user.keyboard('{Enter}');

    // After the first lookup completes, the trail shows it as a DONE row (✓ + "4 found"),
    // rendered with the friendly label.
    await waitFor(() => {
      expect(screen.getByText(/Checking your projects/)).toBeInTheDocument();
      expect(screen.getByText(/4 found/)).toBeInTheDocument();
    });

    // Release the second step → it renders as the CURRENT row (spinner). The first row stays done.
    act(() => releaseSecondStep());
    await waitFor(() => {
      expect(screen.getByText(/Looking for CRM activity/)).toBeInTheDocument();
    });
    // Both rows present in the one activity log.
    const log = screen.getByRole('log', { name: /assistant activity/i });
    expect(log.textContent).toContain('✓');
    expect(log.textContent).toContain('Checking your projects');
    expect(log.textContent).toContain('Looking for CRM activity');

    // Finish the run → terminal status clears the trail; the log region unmounts.
    act(() => releaseComplete());
    await waitFor(() => {
      expect(screen.queryByRole('log', { name: /assistant activity/i })).not.toBeInTheDocument();
      expect(screen.queryByText(/Checking your projects/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Looking for CRM activity/)).not.toBeInTheDocument();
    });
  }, 15_000);

  it('clears the trail on a new conversation (the user-facing “new run” reset)', async () => {
    const user = userEvent.setup();
    const runId = 'fresh-run';

    // Gate the FIRST run so its done-step is observable before a new conversation resets it.
    let releaseFirstStep!: () => void;
    const firstStepGate = new Promise<void>((r) => (releaseFirstStep = r));

    const runtime = makeFakeRuntime(
      () => ({
        [Symbol.asyncIterator]: async function* () {
          yield makeEvent('status', { payload: { kind: 'step', label: 'Looking up projects…' } });
          yield makeEvent('tool', {
            payload: { name: 'query_entity', input: { entity: 'projects' }, result: { rowCount: 2, rows: [] } },
          });
          // Pause mid-run so the done-step is observable; a new conversation resets the trail
          // from this in-flight state (the realistic “new run” reset).
          await firstStepGate;
          yield makeEvent('status', { payload: { status: 'completed' } });
        },
      }),
      runId,
    );
    renderPanel(runtime);

    const textarea = screen.getByRole('textbox', { name: /ask a question/i });
    await user.type(textarea, 'first');
    await user.keyboard('{Enter}');

    // First run lands a done step in the trail (paused mid-run).
    await waitFor(() => {
      expect(screen.getByText(/Checking your projects/)).toBeInTheDocument();
    });

    // Click “New conversation” → the hook resets per-run state, including the trail.
    await user.click(screen.getByRole('button', { name: /new conversation/i }));
    await waitFor(() => {
      expect(screen.queryByText(/Checking your projects/)).not.toBeInTheDocument();
      expect(screen.queryByRole('log', { name: /assistant activity/i })).not.toBeInTheDocument();
    });

    // Release the paused first run so its async iterator can settle (test teardown hygiene).
    act(() => releaseFirstStep());
  }, 15_000);
});
