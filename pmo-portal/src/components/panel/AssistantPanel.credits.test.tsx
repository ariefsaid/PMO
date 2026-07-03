/**
 * AC-AUC-019 — composer disables and shows out-of-credits message.
 * Mirrors AssistantPanel.test.tsx's harness (mocked AgentRuntimeContext, scripted fake runtime).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
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

/**
 * Controlled-open variant (mirrors AssistantPanel.test.tsx's renderPanel) — needed for the
 * F2 focus-fallback test, which drives the panel closed then reopened while phase is
 * 'out-of-credits' (the real-world trigger: close/re-open after a send already hit the
 * out-of-credits terminal phase).
 */
function renderPanelControlled(runtime: AgentRuntime, initialOpen = true) {
  const setOpenRef = { current: (_v: boolean) => {} };

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

  const setOpen = (v: boolean) => {
    act(() => setOpenRef.current(v));
  };

  return { ...result, setOpen };
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
    const sendButton = screen.queryByRole('button', { name: /send message/i });
    expect(sendButton).toBeDisabled();

    // F1 (Discover finding): disabled Send must NOT remain brand-blue at opacity-50 — a neutral
    // disabled treatment (bg-secondary/text-muted-foreground) instead, and never carry bg-primary
    // while disabled.
    expect(sendButton).toHaveClass('bg-secondary');
    expect(sendButton).toHaveClass('text-muted-foreground');
    expect(sendButton).not.toHaveClass('bg-primary');
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

  it('F2 opening the panel while out-of-credits focuses a control inside the panel, not body', async () => {
    const user = userEvent.setup();
    const runId = 'r3';
    const events: AgentEvent[] = [
      makeEvent('status', {
        runId,
        payload: { status: 'errored', error: 'RATE_LIMITED', retryAfterSeconds: 0 },
      }),
    ];
    const runtime = makeFakeRuntime(events, runId);
    const { setOpen, container } = renderPanelControlled(runtime, true);

    // Drive the panel into the out-of-credits phase via a send (as in the AC-AUC-019 test).
    const textarea = screen.getByRole('textbox', { name: /ask a question/i });
    await user.type(textarea, 'do something expensive');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByText(/used up your assistant credits/i)).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /ask a question/i })).toBeDisabled();
    });

    // Close, then re-open — the real-world trigger for the open-focus effect while phase is
    // still 'out-of-credits' (phase does not reset on close/re-open).
    setOpen(false);
    setOpen(true);

    await waitFor(() => {
      const panel = container.querySelector('[role="complementary"], [role="dialog"]');
      expect(panel).not.toBeNull();
      expect(panel?.contains(document.activeElement)).toBe(true);
    });
    // Never falls through to no-op (focus stuck on body) and never "focuses" the disabled
    // textarea itself (a disabled element cannot receive focus — calling .focus() on it is a
    // silent no-op, which is the bug this test guards against).
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.tagName).not.toBe('TEXTAREA');
  });
});
