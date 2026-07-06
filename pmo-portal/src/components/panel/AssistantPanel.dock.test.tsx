/**
 * AssistantPanel dock/overlay toggle — Task D3 (RED) / D4 (GREEN).
 *
 * AC-AXP-019 — The dock/overlay toggle reflows content when docked and persists.
 * FR-AXP-025 (dock-vs-overlay toggle, default overlay, persisted) / FR-AXP-026
 * (labelled button, no focus-trap/Escape regression).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { AgentRuntimeContext } from '@/src/lib/agent/runtime/AgentRuntimeContext';
import type { AgentEvent, AgentRuntime, AgentRun } from '@/src/lib/agent/runtime/port';
import { AssistantPanel } from './AssistantPanel';

const MODE_KEY = 'pmo.agentPanel.mode';

vi.mock('@/src/lib/db/agentThreads', () => ({
  listAgentThreads: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/src/lib/db/agentEvents', () => ({
  listRunEvents: vi.fn().mockResolvedValue([]),
  rateAgentEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/src/lib/db/agentRuns', () => ({
  getRunHeartbeat: vi
    .fn()
    .mockResolvedValue({ last_progress_at: new Date().toISOString(), status: 'running' }),
}));

function makeFakeRuntime(): AgentRuntime {
  return {
    createRun: vi.fn().mockResolvedValue({ id: 'r1', title: 't', status: 'running' } as AgentRun),
    followUp: vi.fn().mockResolvedValue(undefined),
    control: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield { id: '1', runId: 'r1', type: 'status', payload: { status: 'completed' }, createdAt: new Date().toISOString() } as AgentEvent;
      },
    }),
  };
}

function renderPanel() {
  const runtime = makeFakeRuntime();
  const Wrapper: React.FC = () => {
    const [isOpen, setIsOpen] = React.useState(true);
    return (
      <AgentRuntimeContext.Provider
        value={{
          runtime,
          open: isOpen,
          openPanel: () => setIsOpen(true),
          closePanel: () => setIsOpen(false),
          togglePanel: () => setIsOpen((o) => !o),
        }}
      >
        <MemoryRouter>
          <AssistantPanel />
        </MemoryRouter>
      </AgentRuntimeContext.Provider>
    );
  };
  return render(<Wrapper />);
}

describe('AssistantPanel dock/overlay toggle', () => {
  beforeEach(() => {
    localStorage.removeItem(MODE_KEY);
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.removeItem(MODE_KEY);
  });

  it('AC-AXP-019 dock/overlay reflow + persists: default mode is overlay', () => {
    renderPanel();

    const toggle = screen.getByRole('button', { name: /dock|overlay/i });
    expect(toggle).toBeInTheDocument();

    const panel = document.querySelector('[aria-label="Agent assistant"]') as HTMLElement;
    expect(panel).toHaveAttribute('data-panel-mode', 'overlay');
    expect(panel.className).toMatch(/fixed/);
    expect(panel.className).toMatch(/right-0/);
  });

  it('AC-AXP-019 dock/overlay reflow + persists: clicking the toggle switches to docked, drops overlay classes, and persists', async () => {
    const user = userEvent.setup();
    renderPanel();

    const toggle = screen.getByRole('button', { name: /dock|overlay/i });
    await user.click(toggle);

    const panel = document.querySelector('[aria-label="Agent assistant"]') as HTMLElement;
    await waitFor(() => {
      expect(panel).toHaveAttribute('data-panel-mode', 'docked');
    });
    expect(panel.className).not.toMatch(/fixed/);

    expect(localStorage.getItem(MODE_KEY)).toBe('docked');
  });

  it('AC-AXP-019 dock/overlay reflow + persists: restores docked mode from localStorage on mount', () => {
    localStorage.setItem(MODE_KEY, 'docked');

    renderPanel();

    const panel = document.querySelector('[aria-label="Agent assistant"]') as HTMLElement;
    expect(panel).toHaveAttribute('data-panel-mode', 'docked');
    expect(panel.className).not.toMatch(/fixed/);
  });

  it('toggling back to overlay restores the fixed overlay classes and persists', async () => {
    localStorage.setItem(MODE_KEY, 'docked');
    const user = userEvent.setup();
    renderPanel();

    const toggle = screen.getByRole('button', { name: /dock|overlay/i });
    await user.click(toggle);

    const panel = document.querySelector('[aria-label="Agent assistant"]') as HTMLElement;
    await waitFor(() => {
      expect(panel).toHaveAttribute('data-panel-mode', 'overlay');
    });
    expect(panel.className).toMatch(/fixed/);
    expect(localStorage.getItem(MODE_KEY)).toBe('overlay');
  });

  it('does not regress Escape-closes-panel behavior with the dock toggle present', async () => {
    renderPanel();

    const panel = screen.getByRole('complementary', { name: /agent assistant/i });
    expect(panel).not.toHaveAttribute('inert');

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    await waitFor(() => {
      expect(panel).toHaveAttribute('inert');
    });
  });
});
