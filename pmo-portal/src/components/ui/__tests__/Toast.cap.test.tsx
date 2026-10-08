import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import React from 'react';
import { ToastProvider, useToast } from '../Toast';

// AC-IXD-WP-005 (write-policy, plan task 11):
//   Given rapid successive transitions, at most ONE toast is visible at a time
//   (no pile-up) and it auto-dismisses within 3–5s. Routine forward writes each
//   fire a quiet toast; without a cap they would stack into a column. The cap
//   keeps feedback calm and out of the way.

// A tiny harness that exposes the imperative toast() API to the test.
let fire: (title: string, sub?: string, kind?: 'info' | 'success' | 'warning' | 'error') => void;
let fireWarning: (title: string, sub?: string) => void;
const Harness: React.FC = () => {
  const { toast } = useToast();
  fire = (title, sub, kind = 'success') => toast(title, sub, kind);
  fireWarning = (title, sub) => toast(title, sub, 'warning');
  return null;
};

describe('AC-IXD-WP-005: Toast caps to one visible, auto-dismissing within 3–5s', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('AC-IXD-WP-005: three toasts fired in quick succession show at most ONE at a time', () => {
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );

    act(() => {
      fire('Request updated', 'Moved to Requested');
      fire('Request updated', 'Moved to Vendor Quoted');
      fire('Request updated', 'Moved to Ordered');
    });

    // The cap: no pile-up. Exactly one live region is rendered, and it shows the
    // most recent message (the latest forward step the user took).
    const toasts = screen.getAllByRole('status');
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toHaveTextContent('Moved to Ordered');
  });

  it('TO-1: keeps an undismissed warning visible and queues routine success until dismissal', () => {
    render(<ToastProvider><Harness /></ToastProvider>);
    act(() => {
      fireWarning('Review required', 'Check the failed transfer');
      fire('Saved', 'routine success');
    });
    expect(screen.getByText('Review required')).toBeInTheDocument();
    expect(screen.getByText('Check the failed transfer')).toBeInTheDocument();
    expect(screen.queryByText('routine success')).toBeNull();
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' })));
    expect(screen.getByText('routine success')).toBeInTheDocument();
  });

  it('TO-2: an error preempts a warning and returns the still-undismissed warning to the queue head', () => {
    render(<ToastProvider><Harness /></ToastProvider>);
    act(() => {
      fireWarning('Review required', 'Check the transfer');
      fire('Saved', 'routine item');
      fire('Failure', 'Retry the action', 'error');
    });
    expect(screen.getByText('Failure')).toBeInTheDocument();
    expect(screen.queryByText('Review required')).toBeNull();
    expect(screen.getByText('+2 more')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Failure Retry the action');
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' })));
    expect(screen.getByText('Review required')).toBeInTheDocument();
    expect(screen.getByText('Check the transfer')).toBeInTheDocument();
  });

  it('TO-3: announces warning and error queued behind an error immediately, while routine toasts stay silent', () => {
    render(<ToastProvider><Harness /></ToastProvider>);
    act(() => fire('Current failure', 'Still fixing', 'error'));
    act(() => fire('Another warning', 'Needs attention', 'warning'));
    expect(screen.getByRole('alert')).toHaveTextContent('Another warning Needs attention');
    act(() => fire('Next failure', 'Also failed', 'error'));
    expect(screen.getByRole('alert')).toHaveTextContent('Next failure Also failed');
    act(() => fire('Saved', 'quiet success'));
    expect(screen.getByRole('alert')).toHaveTextContent('Next failure Also failed');
    expect(screen.queryByText('quiet success')).toBeNull();
  });

  it('TO-4: caps the queue at five, coalesces same title and kind, and evicts routine items before warnings', () => {
    render(<ToastProvider><Harness /></ToastProvider>);
    act(() => {
      fireWarning('Persistent', 'keep me');
      fire('Same', 'first', 'warning');
      fire('Same', 'second', 'warning');
      fire('Routine 1', undefined, 'success');
      fire('Routine 2', undefined, 'success');
      fire('Routine 3', undefined, 'success');
      fire('Visible failure', 'preempts the warning', 'error');
      fire('Queued failure', 'retain errors', 'error');
      fireWarning('Urgent', 'keep this too');
      fire('Routine 4', undefined, 'info');
    });
    expect(screen.getByText('Visible failure')).toBeInTheDocument();
    expect(screen.getByText('+5 more')).toBeInTheDocument();
    const dismissVisible = () => act(() => fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' })));
    dismissVisible();
    expect(screen.getByText('Persistent')).toBeInTheDocument();
    dismissVisible();
    expect(screen.getByText('Same')).toBeInTheDocument();
    expect(screen.getByText('first')).toBeInTheDocument();
    dismissVisible();
    expect(screen.getByText('Queued failure')).toBeInTheDocument();
    dismissVisible();
    expect(screen.getByText('Urgent')).toBeInTheDocument();
  });

  it('AC-IXD-WP-005: a fired toast auto-dismisses within 3–5s', () => {
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );

    act(() => {
      fire('Saved', 'all good');
    });
    expect(screen.getByRole('status')).toBeInTheDocument();

    // Within the 3–5s window the live region is cleared on its own (no user action).
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
});
