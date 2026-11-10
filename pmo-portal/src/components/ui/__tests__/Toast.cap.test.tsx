import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import React from 'react';
import { toast as sonnerToast } from 'sonner';
import { ToastProvider, useToast } from '../Toast';

// AC-IXD-WP-005 (write-policy, plan task 11), recomposed on Sonner:
//   Given rapid successive transitions, feedback stays bounded and self-clearing —
//   the newest message is the one announced, the stack never grows unbounded, and
//   routine notices clear themselves. Warnings/errors persist (remedies) and each
//   notice keeps its own announcement until it leaves.
//
// A tiny harness that exposes the imperative toast() API to the test.
let fire: (title: string, sub?: string, kind?: 'info' | 'success' | 'warning' | 'error') => number;
let fireWarning: (title: string, sub?: string) => number;
let clearToasts: () => void;
let dismissToast: (id: number) => void;
const Harness: React.FC = () => {
  const { toast, clear, dismiss } = useToast();
  fire = (title, sub, kind = 'success') => toast(title, sub, kind);
  fireWarning = (title, sub) => toast(title, sub, 'warning');
  clearToasts = clear;
  dismissToast = dismiss;
  return null;
};

const sonnerToasts = () => document.querySelectorAll<HTMLElement>('[data-sonner-toast]');

describe('AC-IXD-WP-005: rapid feedback stays bounded and self-clearing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    // Sonner's store replays still-active toasts into the next Toaster — clear them.
    act(() => { sonnerToast.dismiss(); });
    if (vi.isFakeTimers()) vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  const show = (...args: Parameters<typeof fire>) => {
    act(() => fire(...args));
    act(() => vi.advanceTimersByTime(1));
  };

  it('three toasts fired in quick succession announce the latest message and clear themselves', () => {
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );

    show('Request updated', 'Moved to Requested');
    show('Request updated', 'Moved to Vendor Quoted');
    show('Request updated', 'Moved to Ordered');

    // The stack renders every notice, politely announcing the latest forward step.
    expect(sonnerToasts()).toHaveLength(3);
    expect(screen.getByRole('status')).toHaveTextContent('Moved to Ordered');

    // No pile-up: routine notices clear on the library lifetime.
    act(() => vi.advanceTimersByTime(4_000));
    act(() => vi.advanceTimersByTime(300));
    expect(sonnerToasts()).toHaveLength(0);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('dismisses one identified toast without clearing an unrelated unresolved error', () => {
    render(<ToastProvider><Harness /></ToastProvider>);
    let activationNoticeId = 0;
    let errorId = 0;
    act(() => {
      activationNoticeId = fireWarning('Version activated, ERP update pending', 'Retry the push');
      errorId = fire('Unresolved error', 'Retry the failed operation', 'error');
    });
    act(() => vi.advanceTimersByTime(1));

    expect(screen.getByRole('alert')).toHaveTextContent('Unresolved error Retry the failed operation');
    act(() => dismissToast(activationNoticeId));

    expect(screen.getByRole('alert')).toHaveTextContent('Unresolved error Retry the failed operation');

    // The activation notice was already gone, so dismissing the last remedy empties the region.
    act(() => dismissToast(errorId));
    expect(screen.getByRole('alert')).toBeEmptyDOMElement();
  });

  it('clear removes the active toasts and their live-region announcements', async () => {
    vi.useRealTimers(); // element removal rides the library's real rAF clock
    render(<ToastProvider><Harness /></ToastProvider>);
    act(() => {
      fireWarning('Review required', 'Check the transfer');
      fire('Saved', 'routine success');
    });
    await waitFor(() => expect(document.querySelectorAll('[data-sonner-toast]')).toHaveLength(2));
    expect(screen.getByRole('alert')).toHaveTextContent('Review required Check the transfer');
    expect(screen.getByRole('status')).toHaveTextContent('Saved routine success');
    act(() => clearToasts());
    expect(screen.getByRole('alert')).toBeEmptyDOMElement();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    await waitFor(() => expect(document.querySelectorAll('[data-sonner-toast]')).toHaveLength(0));
    expect(screen.queryByText('Review required')).toBeNull();
    expect(screen.queryByText('routine success')).toBeNull();
  });

  it('an error announces immediately while it is showing, and a quiet save keeps its own polite slot', () => {
    render(<ToastProvider><Harness /></ToastProvider>);
    show('Current failure', 'Still fixing', 'error');
    expect(screen.getByRole('alert')).toHaveTextContent('Current failure Still fixing');
    show('Another warning', 'Needs attention', 'warning');
    expect(screen.getByRole('alert')).toHaveTextContent('Another warning Needs attention');
    show('Saved', 'quiet success');
    expect(screen.getByRole('status')).toHaveTextContent('Saved quiet success');
    expect(screen.getByRole('alert')).toHaveTextContent('Another warning Needs attention');
  });

  it('an urgent toast fires a second time as its own stacked notice and re-announces', () => {
    render(<ToastProvider><Harness /></ToastProvider>);
    // Fire twice before any timer advance: the identical repeat clears its region first.
    act(() => { fire('Failure', 'Retry the action', 'error'); });
    act(() => { fire('Failure', 'Retry the action', 'error'); });
    expect(screen.getByRole('alert')).toBeEmptyDOMElement();
    act(() => vi.advanceTimersByTime(1));
    expect(sonnerToasts()).toHaveLength(2);
    expect(screen.getByRole('alert')).toHaveTextContent('Failure Retry the action');
  });

  it('AC-IXD-WP-005: a fired toast auto-dismisses within 3–5s', () => {
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );

    show('Saved', 'all good');
    expect(screen.getByRole('status')).toBeInTheDocument();

    // Within the 3–5s window the live region is cleared on its own (no user action).
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
});
