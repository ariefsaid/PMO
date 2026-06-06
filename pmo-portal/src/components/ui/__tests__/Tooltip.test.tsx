import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { Tooltip } from '../Tooltip';
import { ToastView, ToastProvider, useToast } from '../Toast';

describe('Tooltip', () => {
  it('is hidden until hover/focus, then shows with role=tooltip', async () => {
    render(
      <Tooltip content="Weighted by stage probability">
        <button>info</button>
      </Tooltip>
    );
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    await userEvent.hover(screen.getByRole('button', { name: 'info' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Weighted by stage probability');
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

  it('renders an optional bold title and closes on blur/mouseleave', async () => {
    render(
      <Tooltip title="Weighted" content="60% of stage value">
        <button>info</button>
      </Tooltip>
    );
    const btn = screen.getByRole('button', { name: 'info' });
    await userEvent.hover(btn);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Weighted');
    await userEvent.unhover(btn);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});

describe('Toast', () => {
  afterEach(() => vi.useRealTimers());

  it('renders aria-live polite (does not steal focus) + maps kind to accent stripe', () => {
    render(<ToastView kind="success" title="Saved" sub="Budget v3 activated" />);
    const toast = screen.getByText('Saved').closest('[role="status"]')!;
    expect(toast).toHaveAttribute('aria-live', 'polite');
    expect(toast.className).toContain('border-l-success');
  });

  it('warning kind maps to the warning stripe', () => {
    render(<ToastView kind="warning" title="Heads up" />);
    expect(screen.getByText('Heads up').closest('[role="status"]')!.className).toContain(
      'border-l-warning'
    );
  });

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
    expect(screen.getByText('Saved')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(4100);
    });
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });
});
