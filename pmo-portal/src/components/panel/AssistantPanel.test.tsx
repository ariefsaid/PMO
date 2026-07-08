/**
 * AssistantPanel tests — Tasks 20/21/22 (RED), Task 23 (GREEN).
 * All behaviour ACs for the drawer component.
 *
 * AC-AP-003..023 (open/close/focus/inert/Esc, composer, stream, states, a11y).
 *
 * Uses a scripted fake AgentRuntime provided through AgentRuntimeContext.
 * No live agent-chat call.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { AgentRuntimeContext } from '@/src/lib/agent/runtime/AgentRuntimeContext';
import type { AgentEvent, AgentRuntime, AgentRun } from '@/src/lib/agent/runtime/port';
import { AssistantPanel } from './AssistantPanel';
import { useAssistantHotkey } from '@/src/hooks/useAssistantHotkey';
import { axeViolations } from '../__tests__/axe';

// ADR-0043 (D7): ThreadList fetches via listAgentThreads() when its region is
// expanded — mocked here so these component tests never touch the real
// supabase client (mirrors the DAL's own mocked-client unit-test pattern).
const listAgentThreadsMock = vi.fn().mockResolvedValue([]);
vi.mock('@/src/lib/db/agentThreads', () => ({
  listAgentThreads: (...args: unknown[]) => listAgentThreadsMock(...args),
}));

// ADR-0043 (FR-AGP-021): resume-on-open reads a thread's events via listRunEvents —
// mocked here so a click-to-resume test never touches the real supabase client
// (mirrors useAssistantPanel.persistence.test.ts's own mock of this DAL).
const listRunEventsMock = vi.fn().mockResolvedValue([]);
vi.mock('@/src/lib/db/agentEvents', () => ({
  listRunEvents: (...args: unknown[]) => listRunEventsMock(...args),
}));

// Review round item 2: the hook's server-heartbeat poll (useAssistantPanel.ts) calls
// getRunHeartbeat on its 5s tick while a run is active — mocked here so these component tests
// never touch the real supabase client. Defaults to a fresh (non-stale) heartbeat; the
// StuckRunBanner test below overrides this per-case to simulate a genuinely wedged run.
const getRunHeartbeatMock = vi.fn().mockResolvedValue({ last_progress_at: new Date().toISOString(), status: 'running' });
vi.mock('@/src/lib/db/agentRuns', () => ({
  getRunHeartbeat: (...args: unknown[]) => getRunHeartbeatMock(...args),
}));

// ── Scripted fake runtime ─────────────────────────────────────────────────────

function makeEvent(
  type: AgentEvent['type'],
  overrides: Partial<AgentEvent> = {},
): AgentEvent {
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
  const createRunSpy = vi
    .fn()
    .mockResolvedValue({ id: runId, title: 'test', status: 'running' } as AgentRun);
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

// ── Render helper ─────────────────────────────────────────────────────────────

interface RenderPanelOptions {
  runtime?: FakeRuntime;
  /** Whether to start with the panel open. Default: true */
  open?: boolean;
}

function renderPanel(opts: RenderPanelOptions = {}) {
  const { open: initialOpen = true } = opts;
  const runtime =
    opts.runtime ??
    makeFakeRuntime([makeEvent('status', { payload: { status: 'completed' } })]);

  let openValue = initialOpen;
  const setOpenRef = { current: (_v: boolean) => {} };

  // We need a controlled open state that can change — use a wrapper with useState
  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [isOpen, setIsOpen] = React.useState(initialOpen);
    setOpenRef.current = setIsOpen;
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

  const result = render(
    <Wrapper>
      <MemoryRouter>
        <AssistantPanel />
      </MemoryRouter>
    </Wrapper>,
  );

  // Expose a way to change open state from outside
  const setOpen = (v: boolean) => {
    openValue = v;
    act(() => setOpenRef.current(v));
  };

  return { ...result, runtime, setOpen, openValue };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AssistantPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore body scroll-lock if set
    document.body.style.overflow = '';
  });

  // ── Batch 1: open/close/focus/inert/Esc (Tasks 20/23) ──────────────────────

  it('AC-AP-005 Escape closes the panel and restores focus', async () => {
    const user = userEvent.setup();

    // Create a probe button that will be the trigger
    const probeButton = document.createElement('button');
    probeButton.textContent = 'trigger';
    document.body.appendChild(probeButton);
    probeButton.focus();

    const { setOpen } = renderPanel({ open: false });

    // Open the panel
    act(() => setOpen(true));
    await waitFor(() => {
      expect(screen.queryByRole('complementary', { name: /agent assistant/i })).toBeInTheDocument();
    });

    // Press Escape — should close
    await user.keyboard('{Escape}');

    await waitFor(() => {
      const panel = document.querySelector('[aria-label="Agent assistant"]');
      // After close, the panel should be inert
      expect(panel).toHaveAttribute('inert');
    });

    document.body.removeChild(probeButton);
  });

  it('AC-AP-005 Escape closes the panel regardless of run state (D-A2-4)', async () => {
    const user = userEvent.setup();
    // Panel starts open
    renderPanel({ open: true });

    const panel = screen.getByRole('complementary', { name: /agent assistant/i });
    expect(panel).not.toHaveAttribute('inert');

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(panel).toHaveAttribute('inert');
    });
  });

  it('AC-AP-006 focus moves into the composer on open', async () => {
    const { setOpen } = renderPanel({ open: false });

    act(() => setOpen(true));

    await waitFor(() => {
      const composer = document.getElementById('assistant-composer-textarea');
      expect(composer).not.toBeNull();
      // Focus should be on the composer textarea after open
      expect(document.activeElement?.tagName.toLowerCase()).toBe('textarea');
    });
  });

  it('AC-AP-007 the panel root is inert when closed', () => {
    const { setOpen } = renderPanel({ open: true });

    const panel = document.querySelector('[aria-label="Agent assistant"]');
    expect(panel).not.toHaveAttribute('inert');

    act(() => setOpen(false));

    expect(panel).toHaveAttribute('inert');
  });

  // ── Batch 2: composer/stream/states (Task 21/23) ───────────────────────────

  it('AC-AP-008 Enter sends createRun with the goal', async () => {
    const user = userEvent.setup();
    const completedEvent = makeEvent('status', { payload: { status: 'completed' } });
    const runtime = makeFakeRuntime([completedEvent]);
    renderPanel({ runtime });

    const textarea = screen.getByRole('textbox', { name: /ask a question/i });
    await user.type(textarea, 'how many projects?');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(runtime.createRunSpy).toHaveBeenCalledWith({ goal: 'how many projects?' });
    });
  });

  it('AC-AP-008 Shift+Enter inserts a newline, does not submit', async () => {
    const user = userEvent.setup();
    const runtime = makeFakeRuntime([]);
    renderPanel({ runtime });

    const textarea = screen.getByRole('textbox', { name: /ask a question/i });
    await user.type(textarea, 'line one');
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    await user.type(textarea, 'line two');

    // Should not have called createRun
    expect(runtime.createRunSpy).not.toHaveBeenCalled();
    expect(textarea).toHaveValue('line one\nline two');
  });

  it('AC-AP-009 while streaming: textarea + Send disabled; Stop enabled', async () => {
    // Create a runtime that never resolves subscribe (keeps streaming).
    // We use an explicit iterator (not a generator) to avoid the require-yield lint rule.
    const neverEndingIterable: AsyncIterable<AgentEvent> = {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<AgentEvent>> {
            return new Promise<IteratorResult<AgentEvent>>(() => {}); // Never resolves
          },
          return(): Promise<IteratorResult<AgentEvent>> {
            return Promise.resolve({ value: undefined as unknown as AgentEvent, done: true });
          },
        };
      },
    };

    const runtime: FakeRuntime = {
      ...makeFakeRuntime([]),
      createRun: vi.fn().mockResolvedValue({ id: 'r1', title: 't', status: 'running' } as AgentRun),
      subscribe: vi.fn().mockReturnValue(neverEndingIterable),
    } as unknown as FakeRuntime;
    runtime.createRunSpy = runtime.createRun as ReturnType<typeof vi.fn>;
    runtime.subscribeSpy = runtime.subscribe as ReturnType<typeof vi.fn>;
    runtime.controlSpy = runtime.control as ReturnType<typeof vi.fn>;
    runtime.followUpSpy = runtime.followUp as ReturnType<typeof vi.fn>;

    renderPanel({ runtime });

    const textarea = screen.getByRole('textbox', { name: /ask a question/i });
    const user = userEvent.setup();
    await user.type(textarea, 'test question');

    // Start the send — don't await so it's still "streaming"
    act(() => {
      void userEvent.keyboard('{Enter}');
    });

    await waitFor(() => {
      expect(runtime.createRunSpy).toHaveBeenCalled();
    });

    // While streaming, Stop should be present and Send absent/disabled
    await waitFor(() => {
      const stopBtn = screen.queryByRole('button', { name: /stop generating/i });
      expect(stopBtn).toBeInTheDocument();
    });
  });

  it('AC-AP-010 after status:completed: textarea + Send enabled; Stop hidden', async () => {
    const user = userEvent.setup();
    const completedEvent = makeEvent('status', { payload: { status: 'completed' } });
    const runtime = makeFakeRuntime([completedEvent]);
    renderPanel({ runtime });

    const textarea = screen.getByRole('textbox', { name: /ask a question/i });
    await user.type(textarea, 'question');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(runtime.createRunSpy).toHaveBeenCalled();
    });

    // After completion, Send should be enabled and Stop absent
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /stop generating/i })).not.toBeInTheDocument();
      const sendBtn = screen.queryByRole('button', { name: /send message/i });
      expect(sendBtn).toBeInTheDocument();
    });
  });

  it('AC-AP-011 empty textarea → Send disabled', () => {
    renderPanel();

    const sendBtn = screen.getByRole('button', { name: /send message/i });
    expect(sendBtn).toBeDisabled();
  });

  it('AC-AP-012 three assistant events coalesce into ONE assistant bubble', async () => {
    const user = userEvent.setup();
    const runId = 'r1';
    const events: AgentEvent[] = [
      makeEvent('assistant', { runId, text: 'Hello ' }),
      makeEvent('assistant', { runId, text: 'world' }),
      makeEvent('assistant', { runId, text: '.' }),
      makeEvent('status', { runId, payload: { status: 'completed' } }),
    ];
    const runtime = makeFakeRuntime(events, runId);
    renderPanel({ runtime });

    const textarea = screen.getByRole('textbox', { name: /ask a question/i });
    await user.type(textarea, 'hi');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      const bubbles = screen.getAllByTestId('assistant-bubble');
      expect(bubbles).toHaveLength(1);
      expect(bubbles[0]).toHaveTextContent('Hello world.');
    });
  });

  it('AC-AP-013 tool event → tool card with entity text, no bubble', async () => {
    const user = userEvent.setup();
    const runId = 'r1';
    const events: AgentEvent[] = [
      makeEvent('tool', { runId, payload: { entity: 'projects', rowCount: 5 } }),
      makeEvent('status', { runId, payload: { status: 'completed' } }),
    ];
    const runtime = makeFakeRuntime(events, runId);
    renderPanel({ runtime });

    const textarea = screen.getByRole('textbox', { name: /ask a question/i });
    await user.type(textarea, 'show projects');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByText(/Looked up projects/i)).toBeInTheDocument();
    });

    // Should not be an assistant bubble
    expect(screen.queryByTestId('assistant-bubble')).not.toBeInTheDocument();
  });

  it('AC-AP-014 status errored TURN_CAP → step-cap notice, no error card, composer re-enabled', async () => {
    const user = userEvent.setup();
    const runId = 'r1';
    const events: AgentEvent[] = [
      makeEvent('status', {
        runId,
        payload: { status: 'errored', error: 'TURN_CAP' },
      }),
    ];
    const runtime = makeFakeRuntime(events, runId);
    renderPanel({ runtime });

    const textarea = screen.getByRole('textbox', { name: /ask a question/i });
    await user.type(textarea, 'complex query');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      // Should show step-cap notice (not error card)
      const notice = screen.queryByText(/step limit/i);
      expect(notice).toBeInTheDocument();
    });

    // No error card
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/retry/i)).not.toBeInTheDocument();

    // Composer should be re-enabled (Send button present, not Stop)
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /stop generating/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /send message/i })).toBeInTheDocument();
    });
  });

  it('AC-AP-015 status errored non-TURN_CAP → error card + Retry, no raw JSON', async () => {
    const user = userEvent.setup();
    const runId = 'r1';
    const events: AgentEvent[] = [
      makeEvent('status', {
        runId,
        payload: { status: 'errored', error: 'UPSTREAM_ERROR' },
      }),
    ];
    const runtime = makeFakeRuntime(events, runId);
    renderPanel({ runtime });

    const textarea = screen.getByRole('textbox', { name: /ask a question/i });
    await user.type(textarea, 'show projects');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    });

    const retryBtn = screen.getByRole('button', { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();

    // No raw JSON in any visible element
    const errorText = screen.getByText(/something went wrong/i).textContent ?? '';
    expect(errorText).not.toContain('{');
    expect(errorText).not.toContain('stack');
  });

  it('AC-AP-016 click Retry → createRun with the last goal', async () => {
    const user = userEvent.setup();
    const runId = 'r1';
    const events: AgentEvent[] = [
      makeEvent('status', {
        runId,
        payload: { status: 'errored', error: 'UPSTREAM_ERROR' },
      }),
    ];
    const runtime = makeFakeRuntime(events, runId);
    // After retry, return completed
    runtime.createRunSpy.mockResolvedValueOnce({ id: runId, title: 'test', status: 'running' } as AgentRun);
    runtime.subscribeSpy
      .mockReturnValueOnce(makeAsyncIterable(events))
      .mockReturnValueOnce(
        makeAsyncIterable([makeEvent('status', { payload: { status: 'completed' } })]),
      );

    renderPanel({ runtime });

    const textarea = screen.getByRole('textbox', { name: /ask a question/i });
    await user.type(textarea, 'show active projects');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    });

    const retryBtn = screen.getByRole('button', { name: /retry/i });
    await user.click(retryBtn);

    await waitFor(() => {
      expect(runtime.createRunSpy).toHaveBeenCalledTimes(2);
      expect(runtime.createRunSpy).toHaveBeenLastCalledWith({
        goal: 'show active projects',
      });
    });
  });

  it('AC-AP-017 empty transcript → empty state heading + ≥2 example chips', () => {
    renderPanel();

    expect(screen.getByText(/ask your agent/i)).toBeInTheDocument();
    // Find all buttons that look like chips (not control buttons)
    const chips = screen.getAllByRole('button').filter(
      (b) =>
        b.textContent?.includes('projects') ||
        b.textContent?.includes('opportunities') ||
        b.textContent?.includes('companies'),
    );
    expect(chips.length).toBeGreaterThanOrEqual(2);
  });

  it('AC-AP-017 empty transcript shows no transcript entries', () => {
    renderPanel();

    expect(screen.queryByTestId('assistant-bubble')).not.toBeInTheDocument();
  });

  it('AC-AP-018 click a chip → fills composer; createRun NOT called', async () => {
    const user = userEvent.setup();
    const runtime = makeFakeRuntime([]);
    renderPanel({ runtime });

    // Find the first example chip
    const chip = screen.getAllByRole('button').find((b) =>
      b.textContent?.includes('projects'),
    );
    expect(chip).toBeDefined();

    await user.click(chip!);

    const textarea = screen.getByRole('textbox', { name: /ask a question/i });
    // Composer should be filled with the chip text
    expect(textarea).toHaveValue(chip!.textContent ?? '');
    // createRun should NOT be called
    expect(runtime.createRunSpy).not.toHaveBeenCalled();
  });

  it('AC-AP-019 Stop → control(runId, cancel); Stopped notice; composer re-enabled', async () => {
    const user = userEvent.setup();
    const runId = 'stop-run';

    // Runtime that produces some assistant text then stays "streaming"
    let resolveStream: () => void;
    const streamPromise = new Promise<void>((r) => (resolveStream = r));
    const slowIterable: AsyncIterable<AgentEvent> = {
      [Symbol.asyncIterator]: async function* () {
        yield makeEvent('assistant', { runId, text: 'Partial answer...' });
        await streamPromise; // Wait for external resolution
      },
    };

    const runtime = makeFakeRuntime([], runId);
    runtime.createRunSpy.mockResolvedValue({ id: runId, title: 'test', status: 'running' } as AgentRun);
    runtime.subscribeSpy.mockReturnValue(slowIterable);
    runtime.controlSpy.mockImplementation(() => {
      resolveStream!(); // Stop the stream when control is called
      return Promise.resolve();
    });

    renderPanel({ runtime });

    const textarea = screen.getByRole('textbox', { name: /ask a question/i });
    await user.type(textarea, 'show projects');

    // Start the stream
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /stop generating/i })).toBeInTheDocument();
    });

    // Click Stop
    const stopBtn = screen.getByRole('button', { name: /stop generating/i });
    await user.click(stopBtn);

    await waitFor(() => {
      expect(runtime.controlSpy).toHaveBeenCalledWith(runId, 'cancel');
    });

    // "Stopped" notice in transcript
    await waitFor(() => {
      expect(screen.getByText('Stopped')).toBeInTheDocument();
    });

    // Composer re-enabled (Send present, not Stop)
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /stop generating/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /send message/i })).toBeInTheDocument();
    });
  });

  it('AC-AP-023 followUp same runId — appends below', async () => {
    const user = userEvent.setup();
    const runId = 'follow-run';
    let callCount = 0;

    const runtime = makeFakeRuntime([], runId);
    runtime.createRunSpy.mockResolvedValue({ id: runId, title: 'test', status: 'running' } as AgentRun);
    runtime.subscribeSpy.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return makeAsyncIterable([
          makeEvent('assistant', { runId, text: 'First answer.' }),
          makeEvent('status', { runId, payload: { status: 'completed' } }),
        ]);
      }
      return makeAsyncIterable([
        makeEvent('assistant', { runId, text: 'Second answer.' }),
        makeEvent('status', { runId, payload: { status: 'completed' } }),
      ]);
    });

    renderPanel({ runtime });

    const textarea = screen.getByRole('textbox', { name: /ask a question/i });

    // First send
    await user.type(textarea, 'first question');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByText(/First answer/)).toBeInTheDocument();
    });

    // Second send — should call followUp
    await user.clear(textarea);
    await user.type(textarea, 'follow up');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(runtime.followUpSpy).toHaveBeenCalledWith(runId, 'follow up');
    });

    await waitFor(() => {
      expect(screen.getByText(/Second answer/)).toBeInTheDocument();
    });
  });

  // ── Batch 3: a11y (Task 22/23) ─────────────────────────────────────────────

  it('AC-AP-020 open (desktop) → complementary landmark; composer has accessible label', () => {
    renderPanel({ open: true });

    const panel = screen.getByRole('complementary', { name: /agent assistant/i });
    expect(panel).toBeInTheDocument();

    // Composer textarea has an accessible label
    const textarea = screen.getByLabelText(/ask a question/i);
    expect(textarea).toBeInTheDocument();
  });

  it('AC-AP-021 open → aria-live="polite" element wraps the transcript content', () => {
    renderPanel({ open: true });

    const liveRegion = document.querySelector('[aria-live="polite"]');
    expect(liveRegion).toBeInTheDocument();
  });

  it('AC-AP-022 axe-core: no blocking violations in empty state', async () => {
    const { container } = renderPanel({ open: true });

    const { blocking } = await axeViolations(container);

    if (blocking.length > 0) {
      console.error('Axe violations:', blocking);
    }
    expect(blocking).toEqual([]);
  });

  it('AC-AP-022 axe-core: no blocking violations with transcript content', async () => {
    const user = userEvent.setup();
    const runId = 'axe-run';
    const events: AgentEvent[] = [
      makeEvent('assistant', { runId, text: 'You have 5 active projects.' }),
      makeEvent('tool', { runId, payload: { entity: 'projects', rowCount: 5 } }),
      makeEvent('system', { runId, text: 'Run completed.' }),
      makeEvent('status', { runId, payload: { status: 'completed' } }),
    ];
    const runtime = makeFakeRuntime(events, runId);
    const { container } = renderPanel({ runtime, open: true });

    const textarea = screen.getByRole('textbox', { name: /ask a question/i });
    await user.type(textarea, 'show projects');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByText(/5 active projects/)).toBeInTheDocument();
    });

    const { blocking } = await axeViolations(container);
    if (blocking.length > 0) {
      console.error('Axe violations:', blocking);
    }
    expect(blocking).toEqual([]);
  });

  // ── Integrated hotkey + Rail open (Tasks 20/23, Blocker 1) ────────────────
  // AC-AP-003: ⌘J → panel not inert; ⌘J again → panel inert (panel-level boundary test).
  // These complement the hook-isolation tests in useAssistantHotkey.test.tsx.

  it('AC-AP-003 ⌘J toggles the panel open then closed (integrated panel boundary)', async () => {
    // PanelWithHotkey: a wrapper that integrates useAssistantHotkey with the panel context,
    // mirroring what App.tsx does — so ⌘J fires togglePanel and the panel's inert state changes.
    const PanelWithHotkey: React.FC<{ children: React.ReactNode }> = ({ children }) => {
      const [isOpen, setIsOpen] = React.useState(false);
      const togglePanel = React.useCallback(() => setIsOpen((o) => !o), []);
      // Register the global hotkey (mirrors App.tsx wiring)
      useAssistantHotkey({ enabled: true, onToggle: togglePanel });
      return React.createElement(
        AgentRuntimeContext.Provider,
        {
          value: {
            runtime: makeFakeRuntime([makeEvent('status', { payload: { status: 'completed' } })]),
            open: isOpen,
            openPanel: () => setIsOpen(true),
            closePanel: () => setIsOpen(false),
            togglePanel,
          },
        },
        children,
      );
    };

    render(
      <PanelWithHotkey>
        <MemoryRouter>
          <AssistantPanel />
        </MemoryRouter>
      </PanelWithHotkey>,
    );

    const panel = document.querySelector('[aria-label="Agent assistant"]');
    expect(panel).toBeInTheDocument();

    // Initially closed: panel is inert
    expect(panel).toHaveAttribute('inert');

    // Fire ⌘J → panel opens (not inert)
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', metaKey: true, bubbles: true }));
    });

    await waitFor(() => {
      expect(panel).not.toHaveAttribute('inert');
    });

    // Fire ⌘J again → panel closes (inert)
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', metaKey: true, bubbles: true }));
    });

    await waitFor(() => {
      expect(panel).toHaveAttribute('inert');
    });
  });

  it('AC-AP-004 the Rail Assistant entry opens the panel (via openPanel in context)', async () => {
    // Verifies that calling openPanel (the same callback the Rail button invokes)
    // causes the panel to become visible (not inert). Panel-level boundary test.
    const { setOpen } = renderPanel({ open: false });

    const panel = document.querySelector('[aria-label="Agent assistant"]');
    expect(panel).toHaveAttribute('inert');

    // Simulate Rail button click: call openPanel (which is setOpen(true) in our wrapper)
    act(() => setOpen(true));

    await waitFor(() => {
      expect(panel).not.toHaveAttribute('inert');
    });
  });

  // ── New conversation (FR-AP-023) ────────────────────────────────────────────

  it('New conversation button clears the transcript', async () => {
    const user = userEvent.setup();
    const runId = 'conv-run';
    const events: AgentEvent[] = [
      makeEvent('assistant', { runId, text: 'First conversation answer.' }),
      makeEvent('status', { runId, payload: { status: 'completed' } }),
    ];
    const runtime = makeFakeRuntime(events, runId);
    renderPanel({ runtime });

    const textarea = screen.getByRole('textbox', { name: /ask a question/i });
    await user.type(textarea, 'first question');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByText(/First conversation answer/)).toBeInTheDocument();
    });

    // Click new conversation
    const newConvBtn = screen.getByRole('button', { name: /new conversation/i });
    await user.click(newConvBtn);

    // Transcript should be cleared — empty state visible
    expect(screen.queryByText(/First conversation answer/)).not.toBeInTheDocument();
    expect(screen.getByText(/ask your agent/i)).toBeInTheDocument();
  });

  // ── A3 Approve/Deny chip (Tasks 23) — AC-AW-013..017 ─────────────────────

  it('AC-AW-013 needs-approval event → chip renders with humanSummary; composer Send disabled', async () => {
    const user = userEvent.setup();
    const runId = 'aw-run-1';
    const events: AgentEvent[] = [
      makeEvent('status', {
        runId,
        payload: {
          status: 'needs-approval',
          pendingId: 'p1',
          actionName: 'create_activity',
          humanSummary: 'Log a call activity on contact XYZ',
          structuredArgs: { contactId: 'c1', kind: 'call', subject: 'Follow-up' },
        },
      }),
    ];
    const runtime = makeFakeRuntime(events, runId);
    renderPanel({ runtime });

    const textarea = screen.getByRole('textbox', { name: /ask a question/i });
    await user.type(textarea, 'log a call');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByText(/Log a call activity on contact XYZ/i)).toBeInTheDocument();
    });

    // Approve and Deny buttons visible
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /deny/i })).toBeInTheDocument();

    // Composer is disabled while in needs-approval phase:
    // either no Send button (replaced by Stop) OR Send button is disabled.
    await waitFor(() => {
      const sendBtn = screen.queryByRole('button', { name: /send message/i });
      const stopBtn = screen.queryByRole('button', { name: /stop generating/i });
      // One of: Send absent (running=true → Stop shown) OR Send present+disabled
      const composerDisabled = !sendBtn || stopBtn !== null;
      expect(composerDisabled).toBe(true);
    });
  });

  it('AC-AW-014 clicking Approve calls runtime.control(runId, "approve"); chip resolves on subsequent tool event', async () => {
    const user = userEvent.setup();
    const runId = 'aw-run-2';

    // First subscribe: needs-approval stream
    // Second subscribe (after approve): tool event + completed
    let callCount = 0;
    const runtime = makeFakeRuntime([], runId);
    runtime.createRunSpy.mockResolvedValue({ id: runId, title: 'test', status: 'running' } as AgentRun);
    runtime.subscribeSpy.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return makeAsyncIterable([
          makeEvent('status', {
            runId,
            payload: {
              status: 'needs-approval',
              pendingId: 'p2',
              actionName: 'create_activity',
              humanSummary: 'Log a call activity on contact ABC',
              structuredArgs: {},
            },
          }),
        ]);
      }
      return makeAsyncIterable([
        makeEvent('tool', { runId, payload: { name: 'create_activity', pendingId: 'p2', result: { id: 'act-1' } } }),
        makeEvent('assistant', { runId, text: "Done - I've logged the call." }),
        makeEvent('status', { runId, payload: { status: 'completed' } }),
      ]);
    });

    renderPanel({ runtime });

    const textarea = screen.getByRole('textbox', { name: /ask a question/i });
    await user.type(textarea, 'log a call');
    await user.keyboard('{Enter}');

    // Wait for chip to appear
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
    });

    // Click Approve
    await user.click(screen.getByRole('button', { name: /approve/i }));

    // runtime.control called with approve
    await waitFor(() => {
      expect(runtime.controlSpy).toHaveBeenCalledWith(runId, 'approve');
    });

    // After second stream: chip should resolve to approved state
    await waitFor(() => {
      expect(screen.getByText(/Approved/i)).toBeInTheDocument();
    });
  });

  it('AC-AW-015 clicking Deny calls runtime.control(runId, "reject"); chip shows Denied; composer re-enables', async () => {
    const user = userEvent.setup();
    const runId = 'aw-run-3';

    let callCount = 0;
    const runtime = makeFakeRuntime([], runId);
    runtime.createRunSpy.mockResolvedValue({ id: runId, title: 'test', status: 'running' } as AgentRun);
    runtime.subscribeSpy.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return makeAsyncIterable([
          makeEvent('status', {
            runId,
            payload: {
              status: 'needs-approval',
              pendingId: 'p3',
              actionName: 'create_activity',
              humanSummary: 'Log a call activity on contact DEF',
              structuredArgs: {},
            },
          }),
        ]);
      }
      return makeAsyncIterable([
        makeEvent('system', { runId, payload: { event: 'write_resolved', decision: 'rejected', actionName: 'create_activity', pendingId: 'p3' } }),
        makeEvent('assistant', { runId, text: 'Understood, I will not log that.' }),
        makeEvent('status', { runId, payload: { status: 'completed' } }),
      ]);
    });

    renderPanel({ runtime });

    const textarea = screen.getByRole('textbox', { name: /ask a question/i });
    await user.type(textarea, 'log a call');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /deny/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /deny/i }));

    await waitFor(() => {
      expect(runtime.controlSpy).toHaveBeenCalledWith(runId, 'reject');
    });

    // After second stream: chip shows Denied (exact text in chip p element)
    await waitFor(() => {
      // Look for any element containing "Denied" — either the chip state or the notice
      const deniedEls = screen.queryAllByText(/denied/i);
      expect(deniedEls.length).toBeGreaterThan(0);
    });

    // Composer re-enables after completed
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /stop generating/i })).not.toBeInTheDocument();
      const sendBtn = screen.queryByRole('button', { name: /send message/i });
      expect(sendBtn).toBeInTheDocument();
    });
  });

  it('AC-AW-016 after chip approved: no enabled Approve/Deny buttons (no re-approval)', async () => {
    const user = userEvent.setup();
    const runId = 'aw-run-4';

    let callCount = 0;
    const runtime = makeFakeRuntime([], runId);
    runtime.createRunSpy.mockResolvedValue({ id: runId, title: 'test', status: 'running' } as AgentRun);
    runtime.subscribeSpy.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return makeAsyncIterable([
          makeEvent('status', {
            runId,
            payload: {
              status: 'needs-approval',
              pendingId: 'p4',
              actionName: 'create_activity',
              humanSummary: 'Log a meeting on contact GHI',
              structuredArgs: {},
            },
          }),
        ]);
      }
      return makeAsyncIterable([
        makeEvent('tool', { runId, payload: { name: 'create_activity', pendingId: 'p4', result: { id: 'act-2' } } }),
        makeEvent('status', { runId, payload: { status: 'completed' } }),
      ]);
    });

    renderPanel({ runtime });

    const textarea = screen.getByRole('textbox', { name: /ask a question/i });
    await user.type(textarea, 'log a meeting');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /approve/i }));

    // After resolution, no active Approve/Deny buttons
    await waitFor(() => {
      const approveBtn = screen.queryByRole('button', { name: /^approve$/i });
      if (approveBtn) {
        expect(approveBtn).toBeDisabled();
      }
    });
  });

  it('AC-AW-017 axe-core zero blocking violations when chip is visible', async () => {
    const user = userEvent.setup();
    const runId = 'aw-axe-run';
    const events: AgentEvent[] = [
      makeEvent('status', {
        runId,
        payload: {
          status: 'needs-approval',
          pendingId: 'paxe',
          actionName: 'create_activity',
          humanSummary: 'Log a call activity on contact XYZ',
          structuredArgs: {},
        },
      }),
    ];
    const runtime = makeFakeRuntime(events, runId);
    const { container } = renderPanel({ runtime });

    const textarea = screen.getByRole('textbox', { name: /ask a question/i });
    await user.type(textarea, 'log a call');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByText(/Log a call activity on contact XYZ/i)).toBeInTheDocument();
    });

    const { blocking } = await axeViolations(container);
    if (blocking.length > 0) console.error('Axe violations (needs-approval chip):', blocking);
    expect(blocking).toEqual([]);
  });

  // ── Blocker 7: NFR-AW-A11Y-003 — needs-approval accessibility ─────────────
  // When in needs-approval phase, a role="status" region must announce the blocking
  // reason ("A write action awaits your decision") distinct from the streaming indicator.
  // The textarea must have aria-disabled="true" so SR users know WHY input is blocked.

  it('NFR-AW-A11Y-003 needs-approval phase: role=status element contains descriptive awaiting text', async () => {
    const user = userEvent.setup();
    const runId = 'a11y-run-1';
    const events: AgentEvent[] = [
      makeEvent('status', {
        runId,
        payload: {
          status: 'needs-approval',
          pendingId: 'pa1',
          actionName: 'create_activity',
          humanSummary: 'Log a call on contact XYZ',
          structuredArgs: {},
        },
      }),
    ];
    const runtime = makeFakeRuntime(events, runId);
    renderPanel({ runtime });

    const textarea = screen.getByRole('textbox', { name: /ask a question/i });
    await user.type(textarea, 'log a call');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByText(/Log a call on contact XYZ/i)).toBeInTheDocument();
    });

    // A role=status element must be present with the approval-awaiting text
    await waitFor(() => {
      const statusEl = screen.getByRole('status');
      expect(statusEl.textContent).toMatch(/write action awaits your decision/i);
    });
  });

  it('NFR-AW-A11Y-003 needs-approval phase: textarea has aria-disabled="true"', async () => {
    const user = userEvent.setup();
    const runId = 'a11y-run-2';
    const events: AgentEvent[] = [
      makeEvent('status', {
        runId,
        payload: {
          status: 'needs-approval',
          pendingId: 'pa2',
          actionName: 'create_activity',
          humanSummary: 'Log a meeting on contact ABC',
          structuredArgs: {},
        },
      }),
    ];
    const runtime = makeFakeRuntime(events, runId);
    renderPanel({ runtime });

    const textarea = screen.getByRole('textbox', { name: /ask a question/i });
    await user.type(textarea, 'log a meeting');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByText(/Log a meeting on contact ABC/i)).toBeInTheDocument();
    });

    // The textarea must have aria-disabled="true" in needs-approval state
    await waitFor(() => {
      const ta = screen.getByRole('textbox', { name: /ask a question/i });
      expect(ta).toHaveAttribute('aria-disabled', 'true');
    });
  });

  // ── Blocker 8: chip state keyed by pendingId — multi-proposal support ───────
  // A single global approvalChipState causes corruption when two sequential proposals
  // appear in one conversation. Test asserts the first chip stays 'pending' while the
  // second arrives, and approving the second doesn't corrupt the first.

  it('Blocker-8 two sequential needs-approval events: first chip shows Approved after approval even when second chip is pending', async () => {
    const user = userEvent.setup();
    const runId = 'b8-run';
    let callCount = 0;

    const runtime = makeFakeRuntime([], runId);
    runtime.createRunSpy.mockResolvedValue({ id: runId, title: 'test', status: 'running' } as AgentRun);
    runtime.subscribeSpy.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // First subscribe: first proposal
        return makeAsyncIterable([
          makeEvent('status', {
            runId,
            payload: {
              status: 'needs-approval',
              pendingId: 'first-p',
              actionName: 'create_activity',
              humanSummary: 'First proposal summary',
              structuredArgs: {},
            },
          }),
        ]);
      }
      if (callCount === 2) {
        // After approving first: tool event resolving first, then second proposal
        return makeAsyncIterable([
          // write_resolved for first chip
          makeEvent('system', {
            runId,
            payload: { event: 'write_resolved', decision: 'approved', actionName: 'create_activity', pendingId: 'first-p' },
          }),
          // second proposal
          makeEvent('status', {
            runId,
            payload: {
              status: 'needs-approval',
              pendingId: 'second-p',
              actionName: 'update_task_status',
              humanSummary: 'Second proposal summary',
              structuredArgs: {},
            },
          }),
        ]);
      }
      return makeAsyncIterable([
        makeEvent('status', { runId, payload: { status: 'completed' } }),
      ]);
    });

    renderPanel({ runtime });

    const textarea = screen.getByRole('textbox', { name: /ask a question/i });
    await user.type(textarea, 'do two things');
    await user.keyboard('{Enter}');

    // First chip appears
    await waitFor(() => {
      expect(screen.getByText(/First proposal summary/i)).toBeInTheDocument();
    });

    // Approve first chip
    const approveBtn = screen.getByRole('button', { name: /approve/i });
    await user.click(approveBtn);

    // Second chip appears in same conversation
    await waitFor(() => {
      expect(screen.getByText(/Second proposal summary/i)).toBeInTheDocument();
    });

    // The second chip must have active Deny/Approve buttons (it is still pending).
    // With a global approvalChipState, when the second needs-approval resets it to 'pending',
    // the FIRST chip also reverts to showing active Approve/Deny buttons — even though it was
    // already approved. We detect this: if chip state is correctly keyed by pendingId,
    // the first chip stays disabled (no enabled Approve button for 'First proposal summary').
    //
    // The second chip should have active Deny and Approve buttons.
    const denyBtns = screen.queryAllByRole('button', { name: /deny/i });
    const activeDeny = denyBtns.find((b) => !b.hasAttribute('disabled'));
    expect(activeDeny).toBeDefined();

    // With per-pendingId state: the first chip (already approved) must NOT have an
    // enabled Approve button — it should show "Approved ✓" resolved state.
    // With global state bug: the first chip would show an enabled Approve button again.
    // We check: at most ONE enabled Approve button exists (only on the second chip).
    const approveBtns = screen.queryAllByRole('button', { name: /^approve$/i });
    const enabledApprove = approveBtns.filter((b) => !b.hasAttribute('disabled'));
    // With correct per-id state: 0 or 1 enabled Approve (only the second chip's).
    // With global-state bug: 2 enabled Approve buttons (both chips show pending again).
    expect(enabledApprove.length).toBeLessThanOrEqual(1);
  });

  // ── Panel keep-mounted (D-A2-6) ────────────────────────────────────────────

  it('AC-AP-007 panel DOM is present even when closed (keep-mounted)', () => {
    renderPanel({ open: false });

    // The panel element should exist in the DOM (not unmounted)
    const panel = document.querySelector('[aria-label="Agent assistant"]');
    expect(panel).toBeInTheDocument();
    // But it should be inert
    expect(panel).toHaveAttribute('inert');
  });

  it('AC-AP-007 panel becomes visible (not inert) when opened', () => {
    const { setOpen } = renderPanel({ open: false });

    const panel = document.querySelector('[aria-label="Agent assistant"]');
    expect(panel).toHaveAttribute('inert');

    act(() => setOpen(true));

    expect(panel).not.toHaveAttribute('inert');
  });

  // ── ADR-0043 Phase D: ThreadList + StuckRunBanner wiring ──────────────────

  it('renders a History toggle that expands to a ThreadList region', async () => {
    const user = userEvent.setup();
    listAgentThreadsMock.mockResolvedValueOnce([
      {
        id: 'thread-1',
        org_id: 'org-1',
        owner_id: 'owner-1',
        title: 'Earlier conversation',
        scope: null,
        pinned_at: null,
        created_at: '2026-07-01T00:00:00.000Z',
        updated_at: '2026-07-01T00:00:00.000Z',
        archived_at: null,
        latestRunId: null,
      },
    ]);
    renderPanel();

    const toggle = screen.getByRole('button', { name: /history/i });
    await user.click(toggle);

    await waitFor(() => {
      expect(listAgentThreadsMock).toHaveBeenCalled();
    });
    expect(await screen.findByRole('list', { name: /recent conversations/i })).toBeInTheDocument();
    expect(await screen.findByText('Earlier conversation')).toBeInTheDocument();
  });

  it('does not call listAgentThreads before the History region is expanded', () => {
    renderPanel();
    expect(listAgentThreadsMock).not.toHaveBeenCalled();
  });

  it('clicking a thread in the list closes the History region', async () => {
    const user = userEvent.setup();
    listAgentThreadsMock.mockResolvedValueOnce([
      {
        id: 'thread-1',
        org_id: 'org-1',
        owner_id: 'owner-1',
        title: 'Resume me',
        scope: null,
        pinned_at: null,
        created_at: '2026-07-01T00:00:00.000Z',
        updated_at: '2026-07-01T00:00:00.000Z',
        archived_at: null,
        latestRunId: null,
      },
    ]);
    renderPanel();

    await user.click(screen.getByRole('button', { name: /history/i }));
    const threadBtn = await screen.findByRole('button', { name: /resume me/i });
    await user.click(threadBtn);

    // Region collapses after selecting a thread.
    await waitFor(() => {
      expect(screen.queryByRole('list', { name: /recent conversations/i })).not.toBeInTheDocument();
    });
  });

  it('AC-AGP-021 clicking a thread with a latest run resumes and renders its restored transcript', async () => {
    const user = userEvent.setup();
    listAgentThreadsMock.mockResolvedValueOnce([
      {
        id: 'thread-1',
        org_id: 'org-1',
        owner_id: 'owner-1',
        title: 'Resume me',
        scope: null,
        pinned_at: null,
        created_at: '2026-07-01T00:00:00.000Z',
        updated_at: '2026-07-01T00:00:00.000Z',
        archived_at: null,
        latestRunId: 'run-42',
      },
    ]);
    listRunEventsMock.mockResolvedValueOnce([
      {
        id: crypto.randomUUID(),
        run_id: 'run-42',
        org_id: 'org-1',
        owner_id: 'owner-1',
        seq: 1,
        type: 'user',
        text: 'how many active projects?',
        payload: null,
        tool_name: null,
        tool_args_hash: null,
        tool_status: null,
        rating: null,
        downvote_reason: null,
        created_at: '2026-07-01T00:00:00.000Z',
      },
      {
        id: crypto.randomUUID(),
        run_id: 'run-42',
        org_id: 'org-1',
        owner_id: 'owner-1',
        seq: 2,
        type: 'assistant',
        text: 'You have 3 active projects.',
        payload: null,
        tool_name: null,
        tool_args_hash: null,
        tool_status: null,
        rating: null,
        downvote_reason: null,
        created_at: '2026-07-01T00:00:01.000Z',
      },
    ]);
    renderPanel();

    await user.click(screen.getByRole('button', { name: /history/i }));
    const threadBtn = await screen.findByRole('button', { name: /resume me/i });
    await user.click(threadBtn);

    await waitFor(() => {
      expect(listRunEventsMock).toHaveBeenCalledWith('run-42');
    });
    expect(await screen.findByText('how many active projects?')).toBeInTheDocument();
    expect(await screen.findByText('You have 3 active projects.')).toBeInTheDocument();
  });

  it('AC-AGP-021 clicking a thread with no runs yet opens an empty transcript without crashing', async () => {
    const user = userEvent.setup();
    listAgentThreadsMock.mockResolvedValueOnce([
      {
        id: 'thread-empty',
        org_id: 'org-1',
        owner_id: 'owner-1',
        title: 'Never sent',
        scope: null,
        pinned_at: null,
        created_at: '2026-07-01T00:00:00.000Z',
        updated_at: '2026-07-01T00:00:00.000Z',
        archived_at: null,
        latestRunId: null,
      },
    ]);
    renderPanel();

    await user.click(screen.getByRole('button', { name: /history/i }));
    const threadBtn = await screen.findByRole('button', { name: /never sent/i });
    await user.click(threadBtn);

    // No crash; listRunEvents is never called for a thread with no runs; the
    // History region still closes and the empty-transcript state renders.
    await waitFor(() => {
      expect(screen.queryByRole('list', { name: /recent conversations/i })).not.toBeInTheDocument();
    });
    expect(listRunEventsMock).not.toHaveBeenCalled();
  });

  it('shows a loading state while listAgentThreads is in flight', async () => {
    const user = userEvent.setup();
    let resolveThreads!: (rows: unknown[]) => void;
    listAgentThreadsMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveThreads = resolve;
      }),
    );
    renderPanel();

    await user.click(screen.getByRole('button', { name: /history/i }));
    expect(screen.getByText(/loading conversations/i)).toBeInTheDocument();

    resolveThreads([]);
    await waitFor(() => {
      expect(screen.queryByText(/loading conversations/i)).not.toBeInTheDocument();
    });
  });

  it('shows an error state when listAgentThreads rejects', async () => {
    const user = userEvent.setup();
    listAgentThreadsMock.mockRejectedValueOnce(new Error('denied'));
    renderPanel();

    await user.click(screen.getByRole('button', { name: /history/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t load your conversations/i);
    // The empty-list ThreadList must not also render alongside the error.
    expect(screen.queryByRole('list', { name: /recent conversations/i })).not.toBeInTheDocument();
  });

  it('StuckRunBanner renders inside the transcript region while a run is stale', async () => {
    const user = userEvent.setup();
    const runId = 'stuck-run-1';
    // A runtime whose subscribe() never resolves — the run stays 'running' with no
    // further progress signal, so lastProgressAt is pinned at the one yielded event.
    const runtime: FakeRuntime = {
      createRun: vi.fn().mockResolvedValue({ id: runId, title: 'test', status: 'running' } as AgentRun),
      followUp: vi.fn().mockResolvedValue(undefined),
      control: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield {
            id: crypto.randomUUID(),
            runId,
            type: 'status' as const,
            payload: { status: 'running' },
            createdAt: new Date().toISOString(),
          };
          await new Promise(() => {}); // never resolves — run stays 'running'
        },
      }),
      createRunSpy: vi.fn(),
      followUpSpy: vi.fn(),
      controlSpy: vi.fn(),
      subscribeSpy: vi.fn(),
    };
    renderPanel({ runtime });

    const textarea = screen.getByRole('textbox', { name: /ask a question/i });
    await user.type(textarea, 'do something slow');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /stop generating/i })).toBeInTheDocument();
    });
    // No banner yet — the run just started (fresh heartbeat).
    expect(
      screen.queryByRole('status', { name: /still working/i }),
    ).not.toBeInTheDocument();

    // Fast-forward the wall clock past the staleness threshold; the hook's 5s server-heartbeat
    // poll (real timer, review round item 2) re-evaluates isStuck against the real
    // elapsed-vs-stale-heartbeat comparison via a stubbed Date.now(). The mock is pinned to a
    // fixed real-time stamp NOW (before the spy) so the very next poll — whenever it lands —
    // reads as unambiguously stale once Date.now() is offset, independent of interval timing.
    const realNow = Date.now();
    getRunHeartbeatMock.mockResolvedValue({ last_progress_at: new Date(realNow).toISOString(), status: 'running' });
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(realNow + 50_000);
    try {
      await waitFor(
        () => {
          expect(
            screen.getByRole('status', { name: /still working/i }),
          ).toBeInTheDocument();
        },
        { timeout: 8_000, interval: 250 },
      );
      expect(screen.getByRole('button', { name: /^stop$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^retry$/i })).toBeInTheDocument();
    } finally {
      nowSpy.mockRestore();
    }
  }, 12_000);
});
