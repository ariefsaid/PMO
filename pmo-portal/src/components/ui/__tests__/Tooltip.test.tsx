import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import React from 'react';
import { Tooltip, TOOLTIP_OPEN_DELAY_MS } from '../Tooltip';
import { ToastProvider, useToast } from '../Toast';

const css = readFileSync('index.css', 'utf8');

// Hover opens after the provider's hover-intent delay (Base UI falls back to 600ms without a
// provider), so every hover journey waits for the tooltip instead of assuming the first frame.
const HOVER_INTENT_WAIT = { timeout: 1_500 };

describe('Tooltip', () => {
  it('is hidden until hover/focus, then shows with role=tooltip', async () => {
    render(
      <Tooltip content="Weighted by stage probability">
        <button>info</button>
      </Tooltip>
    );
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    await userEvent.hover(screen.getByRole('button', { name: 'info' }));
    expect(await screen.findByRole('tooltip', {}, HOVER_INTENT_WAIT)).toHaveTextContent('Weighted by stage probability');
  });

  it('opens on keyboard FOCUS (not hover-only) — tooltip-keyboard', async () => {
    render(
      <Tooltip content="Keyboard reachable">
        <button>info</button>
      </Tooltip>
    );
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'info' })).toHaveFocus();
    expect(screen.getByRole('tooltip')).toHaveTextContent('Keyboard reachable');
  });

  it('Escape dismisses a focus-opened tooltip; the focused trigger is described by it while open', async () => {
    render(
      <Tooltip content="Dismissible">
        <button>info</button>
      </Tooltip>
    );
    await userEvent.tab();
    const tip = screen.getByRole('tooltip');
    expect(screen.getByRole('button', { name: 'info' })).toHaveAccessibleDescription('Dismissible');
    expect(tip).toHaveTextContent('Dismissible');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('renders an optional bold title and closes on blur/mouseleave', async () => {
    render(
      <Tooltip title="Weighted" content="60% of stage value">
        <button>info</button>
      </Tooltip>
    );
    const btn = screen.getByRole('button', { name: 'info' });
    await userEvent.hover(btn);
    expect(await screen.findByRole('tooltip', {}, HOVER_INTENT_WAIT)).toHaveTextContent('Weighted');
    await userEvent.unhover(btn);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('keeps explanatory content at a readable preferred width and clamps it to the viewport', async () => {
    render(
      <Tooltip content="A complete explanation that should remain easy to read near the edge of the screen.">
        <button>help</button>
      </Tooltip>,
    );
    await userEvent.hover(screen.getByRole('button', { name: 'help' }));
    const tooltip = await screen.findByRole('tooltip', {}, HOVER_INTENT_WAIT);
    expect(document.body).toContainElement(tooltip);
    expect(screen.getByRole('button', { name: 'help' }).parentElement).not.toContainElement(tooltip);
    expect(tooltip.className).toContain('w-[280px]');
    expect(tooltip.className).toContain('max-w-[calc(100vw-16px)]');
  });
});

describe('#2123 tooltip motion — hover intent, instant neighbours, grow from the trigger', () => {
  it('exposes the shared 400ms hover-intent delay (Base UI default timeout) for the app provider', () => {
    expect(TOOLTIP_OPEN_DELAY_MS).toBe(400);
  });

  it('the app wraps the shell in exactly one tooltip provider, in the shared toast shell', () => {
    const app = readFileSync('App.tsx', 'utf8');
    expect(app.match(/<BaseTooltip\.Provider/g) ?? []).toHaveLength(1);
    expect(app).toContain('<BaseTooltip.Provider delay={TOOLTIP_OPEN_DELAY_MS} closeDelay={0}>');
  });

  it('a pointer sweep across neighbours opens nothing; resting opens the tooltip after the delay', async () => {
    const user = userEvent.setup();
    render(
      <BaseTooltip.Provider delay={TOOLTIP_OPEN_DELAY_MS} closeDelay={0}>
        <Tooltip content="first cell"><button>first</button></Tooltip>
        <Tooltip content="second cell"><button>second</button></Tooltip>
      </BaseTooltip.Provider>,
    );
    await user.hover(screen.getByRole('button', { name: 'first' }));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)); });
    // Crossing a cell must not flash its 280px panel: a 150ms pass is not intent.
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(await screen.findByRole('tooltip', {}, HOVER_INTENT_WAIT)).toHaveTextContent('first cell');
  });

  it('a neighbour opens at once, with no entrance animation (data-instant), once one is open', async () => {
    const user = userEvent.setup();
    render(
      <BaseTooltip.Provider delay={TOOLTIP_OPEN_DELAY_MS} closeDelay={0}>
        <Tooltip content="first cell"><button>first</button></Tooltip>
        <Tooltip content="second cell"><button>second</button></Tooltip>
      </BaseTooltip.Provider>,
    );
    const first = screen.getByRole('button', { name: 'first' });
    const second = screen.getByRole('button', { name: 'second' });
    await user.hover(first);
    expect(await screen.findByRole('tooltip', {}, HOVER_INTENT_WAIT)).toHaveTextContent('first cell');
    await user.unhover(first);
    await user.hover(second);
    // No second hover-intent wait: the group is active, so this is already on screen.
    const neighbour = screen.getAllByRole('tooltip').find((tip) => tip.textContent === 'second cell');
    expect(neighbour).toBeDefined();
    expect(neighbour).toHaveAttribute('data-instant');
  });

  it('the popup carries the origin-aware motion class, not a centre-out fade', async () => {
    render(
      <Tooltip content="motion"><button>motion</button></Tooltip>,
    );
    await userEvent.tab();
    const tip = screen.getByRole('tooltip');
    expect(tip.className).toContain('tooltip-anim');
    expect(tip.className).not.toContain('transition-opacity');
  });

  it('the trigger sets no per-trigger delay, so the provider owns hover intent', () => {
    // A trigger delay overrides the provider (delay ?? providerDelay ?? 600) and would defeat it.
    const source = readFileSync('src/components/ui/Tooltip.tsx', 'utf8');
    expect(source).not.toMatch(/\bdelay=\{0\}/);
    expect(source).not.toMatch(/\bcloseDelay=\{0\}/);
  });

  it('grows from the trigger edge over 125ms and skips the entrance for instant opens', () => {
    expect(css).toMatch(/--motion-tooltip:\s*125ms;/);
    const start = css.indexOf('.tooltip-anim {');
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf('/* ----------', start));
    expect(block).toContain('transform-origin: var(--transform-origin)');
    expect(block).toContain('transition: opacity var(--motion-tooltip) var(--ease-out), transform var(--motion-tooltip) var(--ease-out)');
    expect(block).toMatch(/\.tooltip-anim\[data-starting-style\], \.tooltip-anim\[data-ending-style\] \{ opacity: 0; transform: scale\(0\.97\); \}/);
    expect(block).toMatch(/\.tooltip-anim\[data-instant\] \{ transition-duration: 0ms; \}/);
  });
});

describe('Toast', () => {
  afterEach(() => vi.useRealTimers());

  // aria-live/role and kind-tone behaviour of the announced surface is owned by
  // Toast.accessibility.test.tsx; this file only keeps the provider lifecycle proof.
  it('provider shows a toast then auto-dismisses it', async () => {
    vi.useFakeTimers();
    const Trigger: React.FC = () => {
      const { toast } = useToast();
      return <button onClick={() => toast('Saved', 'all good', 'success')}>fire</button>;
    };
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>
    );
    act(() => {
      screen.getByText('fire').click();
    });
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText('Saved')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(4_100);
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });
});
