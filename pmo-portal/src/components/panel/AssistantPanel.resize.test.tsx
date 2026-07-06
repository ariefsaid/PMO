/**
 * AssistantPanel resizable drawer — Task D1 (RED) / D2 (GREEN).
 *
 * AC-AXP-018 — The desktop drawer is resizable and the width persists.
 * FR-AXP-024 (resizable width, clamped 320-720, default 400) / FR-AXP-026
 * (keyboard-operable slider, no focus-trap/Escape regression).
 *
 * jsdom defaults matchMedia to desktop (AssistantPanel.tsx useIsDesktop), so no
 * viewport stub is needed here — mirrors AssistantPanel.test.tsx's renderPanel.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { AgentRuntimeContext } from '@/src/lib/agent/runtime/AgentRuntimeContext';
import type { AgentEvent, AgentRuntime, AgentRun } from '@/src/lib/agent/runtime/port';
import { AssistantPanel } from './AssistantPanel';

const WIDTH_KEY = 'pmo.agentPanel.width';

const listAgentThreadsMock = vi.fn().mockResolvedValue([]);
vi.mock('@/src/lib/db/agentThreads', () => ({
  listAgentThreads: (...args: unknown[]) => listAgentThreadsMock(...args),
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

describe('AssistantPanel resizable drawer', () => {
  beforeEach(() => {
    localStorage.removeItem(WIDTH_KEY);
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.removeItem(WIDTH_KEY);
  });

  it('AC-AXP-018 drawer resizable + persists: renders a keyboard-operable slider with default width', () => {
    renderPanel();

    const slider = screen.getByRole('slider', { name: /resize/i });
    expect(slider).toHaveAttribute('aria-valuemin', '320');
    expect(slider).toHaveAttribute('aria-valuemax', '720');
    expect(slider).toHaveAttribute('aria-valuenow', '400');
    expect(slider).toHaveAttribute('tabIndex', '0');

    const panel = document.querySelector('[aria-label="Agent assistant"]') as HTMLElement;
    expect(panel.style.width).toBe('400px');
  });

  it('AC-AXP-018 drawer resizable + persists: ArrowRight increases width, clamped to 720, and persists', async () => {
    renderPanel();
    const slider = screen.getByRole('slider', { name: /resize/i });

    // Push width up in large steps to hit the clamp ceiling quickly.
    for (let i = 0; i < 30; i++) {
      act(() => {
        slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      });
    }

    await waitFor(() => {
      expect(Number(slider.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(720);
      expect(Number(slider.getAttribute('aria-valuenow'))).toBeGreaterThan(400);
    });

    const panel = document.querySelector('[aria-label="Agent assistant"]') as HTMLElement;
    const now = Number(slider.getAttribute('aria-valuenow'));
    expect(panel.style.width).toBe(`${now}px`);
    expect(localStorage.getItem(WIDTH_KEY)).toBe(String(now));
  });

  it('AC-AXP-018 drawer resizable + persists: ArrowLeft decreases width, clamped to 320', async () => {
    renderPanel();
    const slider = screen.getByRole('slider', { name: /resize/i });

    for (let i = 0; i < 30; i++) {
      act(() => {
        slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      });
    }

    await waitFor(() => {
      expect(Number(slider.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(320);
      expect(Number(slider.getAttribute('aria-valuenow'))).toBeLessThan(400);
    });
  });

  it('AC-AXP-018 drawer resizable + persists: width restores from localStorage on (re)mount', () => {
    localStorage.setItem(WIDTH_KEY, '500');

    renderPanel();

    const slider = screen.getByRole('slider', { name: /resize/i });
    expect(slider).toHaveAttribute('aria-valuenow', '500');
    const panel = document.querySelector('[aria-label="Agent assistant"]') as HTMLElement;
    expect(panel.style.width).toBe('500px');
  });

  it('AC-AXP-018 drawer resizable + persists: a stored value outside [320,720] is clamped on read', () => {
    localStorage.setItem(WIDTH_KEY, '9999');

    renderPanel();

    const slider = screen.getByRole('slider', { name: /resize/i });
    expect(slider).toHaveAttribute('aria-valuenow', '720');
  });

  it('does not regress Escape-closes-panel behavior with the resize handle present', async () => {
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
