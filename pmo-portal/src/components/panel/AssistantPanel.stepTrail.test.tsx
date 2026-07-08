/**
 * AssistantPanel step-trail tests — the live "step trail" status line.
 *
 * The panel's streaming indicator swaps "Working…" for the present-tense label of the tool
 * currently executing ("Looking up projects…") while a run is active. The label LINGERS through
 * the tool result and the follow-up model turn (so it is readable, not a sub-second flash), then
 * reverts to "Working…" when the model resumes narrating (an `assistant` event) or on a terminal
 * status. Step events are ephemeral — they never reach the transcript or the status/phase logic.
 *
 * Harness mirrors AssistantPanel.test.tsx (scripted fake runtime via AgentRuntimeContext,
 * DAL mocks incl. getRunHeartbeat). No live agent-chat call.
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
    runId: overrides.runId ?? 'step-run',
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

function makeFakeRuntime(subscribe: () => AsyncIterable<AgentEvent>, runId = 'step-run'): FakeRuntime {
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

describe('AssistantPanel live step trail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.style.overflow = '';
  });

  it('renders the step as a persistent trail row, flips it done on the tool result, and keeps it through the model turn', async () => {
    const user = userEvent.setup();
    const runId = 'step-run';

    // A gated iterable so we can assert the INTERMEDIATE states. The persistent activity
    // trail carries the step row through the whole tool round + the follow-up model turn
    // (render finding 2026-07-07 — a sub-second flash between the tool call and its result
    // is unreadable), so it REPLACES the static "Working…" line once a step has landed:
    //   (a) step event drains → trail shows the friendly current row (spinner);
    //   (b) tool event drains → that row flips to done (✓ + "0 found");
    //   (c) assistant narration drains → the trail PERSISTS (it does NOT revert to "Working…"
    //       — the persistent checklist is the whole point); only a terminal status clears it.
    let releaseTool!: () => void;
    let releaseAssistant!: () => void;
    let releaseComplete!: () => void;
    const toolGate = new Promise<void>((r) => (releaseTool = r));
    const assistantGate = new Promise<void>((r) => (releaseAssistant = r));
    const completeGate = new Promise<void>((r) => (releaseComplete = r));

    const runtime = makeFakeRuntime(
      () => ({
        [Symbol.asyncIterator]: async function* () {
          // 1) step event — the live trail hint (ephemeral, never in the transcript).
          yield makeEvent('status', { payload: { kind: 'step', label: 'Looking up projects…' } });
          await toolGate;
          // 2) tool event — the tool finished; the row flips to done with a result detail.
          yield makeEvent('tool', {
            payload: { name: 'query_entity', input: { entity: 'projects' }, result: { rowCount: 0, rows: [] } },
          });
          await assistantGate;
          // 3) assistant narration — the model resumed; the trail persists (no revert).
          yield makeEvent('assistant', { runId, text: 'You have 0 projects.' });
          await completeGate;
          // 4) terminal — run done, trail clears + indicator unmounts.
          yield makeEvent('status', { payload: { status: 'completed' } });
        },
      }),
      runId,
    );
    renderPanel(runtime);

    // Start the run.
    const textarea = screen.getByRole('textbox', { name: /ask a question/i });
    await user.type(textarea, 'how many projects?');
    await user.keyboard('{Enter}');

    // (a) Step event drained → the persistent trail shows the friendly current row, NOT the
    // neutral "Working…" (the trail replaces the streaming indicator once a step has landed).
    await waitFor(() => {
      expect(screen.getByText(/Checking your projects/)).toBeInTheDocument();
    });
    expect(screen.queryByText('Working…')).not.toBeInTheDocument();

    // The step is ephemeral: it is NOT added to the transcript as a card or bubble.
    expect(screen.queryAllByTestId('assistant-bubble')).toHaveLength(0);

    // (b) Release the tool event → the row flips to done (✓ + the rowCount detail). The trail
    // still carries the friendly label; it does not revert to "Working…".
    act(() => releaseTool());
    await waitFor(() => {
      expect(screen.getByText(/0 found/)).toBeInTheDocument();
    });
    expect(screen.queryByText('Working…')).not.toBeInTheDocument();

    // (c) Release the assistant narration → the model resumed → the trail PERSISTS (it does
    // NOT revert to "Working…"; the persistent checklist is the whole point).
    act(() => releaseAssistant());
    await waitFor(() => {
      expect(screen.getByText(/You have 0 projects/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Checking your projects/)).toBeInTheDocument();
    expect(screen.queryByText('Working…')).not.toBeInTheDocument();

    // Finish the run → terminal clears the trail and the indicator unmounts entirely.
    act(() => releaseComplete());
    await waitFor(() => {
      expect(screen.queryByText(/Checking your projects/)).not.toBeInTheDocument();
      expect(screen.queryByText('Working…')).not.toBeInTheDocument();
    });
  }, 15_000);

  it('falls back to "Working on your answer" when no step event has been emitted', async () => {
    const user = userEvent.setup();
    const runId = 'idle-run';

    // A run that streams nothing for a beat, then completes — no step event ever arrives.
    let releaseComplete!: () => void;
    const completeGate = new Promise<void>((r) => (releaseComplete = r));

    const runtime = makeFakeRuntime(
      () => ({
        [Symbol.asyncIterator]: async function* () {
          yield makeEvent('assistant', { runId, text: 'Thinking…' });
          await completeGate;
          yield makeEvent('status', { payload: { status: 'completed' } });
        },
      }),
      runId,
    );
    renderPanel(runtime);

    const textarea = screen.getByRole('textbox', { name: /ask a question/i });
    await user.type(textarea, 'hi');
    await user.keyboard('{Enter}');

    // While running with no step event → the prominent thinking bubble's neutral copy.
    await waitFor(() => {
      expect(screen.getByText('Working on your answer')).toBeInTheDocument();
    });

    act(() => releaseComplete());
    await waitFor(() => {
      expect(screen.queryByText('Working on your answer')).not.toBeInTheDocument();
    });
  });
});
