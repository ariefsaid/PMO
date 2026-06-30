/**
 * AssistantPanel mobile modal path tests — Blocker 10 / design-plan §1.2 §5.2.
 *
 * The dual-focus contract (D-A2-1) is the single most important a11y subtlety
 * in the panel. Desktop (≥1024px) = complementary, non-modal. Mobile (<1024px)
 * = role="dialog" aria-modal, scrim, focus-trap, background inert.
 *
 * jsdom default (test/setup.ts) returns true for (min-width:1024px), so
 * useIsDesktop() is always true in standard tests. This file stubs matchMedia
 * to return false for all queries so the MOBILE branch renders.
 *
 * Coverage: role/aria-modal, scrim present + scrim-click closes, background
 * #main gets inert on open and de-inerted on close, axe passes on mobile subtree.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { AgentRuntimeContext } from '@/src/lib/agent/runtime/AgentRuntimeContext';
import type { AgentEvent } from '@/src/lib/agent/runtime/port';
import { AssistantPanel } from './AssistantPanel';
import { axeViolations } from '../__tests__/axe';

// ── Mobile viewport stub ──────────────────────────────────────────────────────

/**
 * Stubs `window.matchMedia` so `useIsDesktop()` returns `false` (mobile branch).
 * All min-width queries return `matches: false` regardless of the breakpoint value.
 * Restored after each test via `vi.unstubAllGlobals()`.
 */
function mockMobileViewport() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: false, // mobile: no min-width query matches
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

// ── Fake runtime factory ──────────────────────────────────────────────────────

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

// ── Render helper ─────────────────────────────────────────────────────────────

interface RenderMobilePanelOptions {
  open?: boolean;
}

function renderMobilePanel(opts: RenderMobilePanelOptions = {}) {
  const { open: initialOpen = true } = opts;

  const setOpenRef = { current: (_v: boolean) => {} };

  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [isOpen, setIsOpen] = React.useState(initialOpen);
    setOpenRef.current = setIsOpen;
    return React.createElement(
      AgentRuntimeContext.Provider,
      {
        value: {
          runtime: {
            createRun: vi.fn().mockResolvedValue({ id: 'test-run', title: 'test', status: 'running' }),
            followUp: vi.fn().mockResolvedValue(undefined),
            control: vi.fn().mockResolvedValue(undefined),
            subscribe: vi.fn().mockReturnValue({
              [Symbol.asyncIterator]: async function* () {
                yield makeEvent('status', { payload: { status: 'completed' } });
              },
            }),
          },
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
        {/* #main and .rail-persistent elements the panel makes inert on mobile */}
        <div id="main">Main content</div>
        <div className="rail-persistent">Rail</div>
        <AssistantPanel />
      </MemoryRouter>
    </Wrapper>,
  );

  const setOpen = (v: boolean) => {
    act(() => setOpenRef.current(v));
  };

  return { ...result, setOpen };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AssistantPanel — mobile modal path (D-A2-1, design-plan §1.2/§5.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Stub matchMedia BEFORE each render so useIsDesktop reads mobile on mount
    mockMobileViewport();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    // Restore body overflow and remove inert attributes from any leftover elements
    document.body.style.overflow = '';
    document.getElementById('main')?.removeAttribute('inert');
    document.querySelector('.rail-persistent')?.removeAttribute('inert');
  });

  it('mobile open → role="dialog" and aria-modal (not complementary)', () => {
    renderMobilePanel({ open: true });

    // Mobile branch: section has role="dialog" aria-modal
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    // NOT a complementary landmark on mobile
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('mobile open → scrim is rendered', () => {
    renderMobilePanel({ open: true });

    // The scrim is aria-hidden; look for it by class structure
    // It is a sibling of the dialog inside the outer container
    const scrim = document.querySelector('.fixed.inset-0.bg-foreground\\/40');
    expect(scrim).toBeInTheDocument();
    expect(scrim).toHaveAttribute('aria-hidden');
  });

  it('mobile scrim click closes the panel', async () => {
    const user = userEvent.setup();
    const { setOpen } = renderMobilePanel({ open: true });

    const dialog = screen.getByRole('dialog');
    expect(dialog).not.toHaveAttribute('inert');

    // Click the scrim (aria-hidden, so we target by CSS)
    const scrim = document.querySelector('.fixed.inset-0.bg-foreground\\/40');
    expect(scrim).toBeInTheDocument();
    await user.click(scrim as Element);

    // The panel should close (become inert)
    await waitFor(() => {
      expect(dialog).toHaveAttribute('inert');
    });
  });

  it('mobile open → background #main gets inert attribute (modal contract)', async () => {
    renderMobilePanel({ open: true });

    // The background main element should be made inert when the mobile modal is open
    await waitFor(() => {
      const main = document.getElementById('main');
      expect(main).toHaveAttribute('inert');
    });
  });

  it('mobile close → background #main is de-inerted (inert removed on close)', async () => {
    const { setOpen } = renderMobilePanel({ open: true });

    // Wait for inert to be applied
    await waitFor(() => {
      expect(document.getElementById('main')).toHaveAttribute('inert');
    });

    // Close the panel
    act(() => setOpen(false));

    await waitFor(() => {
      // main should no longer be inert
      expect(document.getElementById('main')).not.toHaveAttribute('inert');
    });
  });

  it('mobile closed → no scrim rendered (scrim is conditional on open + mobile)', () => {
    renderMobilePanel({ open: false });

    // When closed on mobile, the scrim should not be visible
    const scrim = document.querySelector('.fixed.inset-0.bg-foreground\\/40');
    expect(scrim).not.toBeInTheDocument();
  });

  it('mobile open → body scroll is locked (overflow hidden)', async () => {
    renderMobilePanel({ open: true });

    await waitFor(() => {
      expect(document.body.style.overflow).toBe('hidden');
    });
  });

  it('mobile close → body scroll lock is released (overflow restored)', async () => {
    const { setOpen } = renderMobilePanel({ open: true });

    await waitFor(() => {
      expect(document.body.style.overflow).toBe('hidden');
    });

    act(() => setOpen(false));

    await waitFor(() => {
      expect(document.body.style.overflow).not.toBe('hidden');
    });
  });

  it('mobile open → axe-core: no blocking a11y violations in modal state', async () => {
    const { container } = renderMobilePanel({ open: true });

    // Give effects time to run
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    const { blocking } = await axeViolations(container);

    if (blocking.length > 0) {
      console.error('Mobile Axe violations:', JSON.stringify(blocking, null, 2));
    }
    expect(blocking).toEqual([]);
  });
});
