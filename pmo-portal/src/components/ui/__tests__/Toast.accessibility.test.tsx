import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { toast as sonnerToast } from 'sonner';
import { ToastProvider, useToast, type ToastKind } from '../Toast';

let fire: (title: string, sub?: string, kind?: ToastKind) => void;
const Harness: React.FC = () => {
  const { toast } = useToast();
  fire = toast;
  return null;
};

const renderToast = () => render(<ToastProvider><Harness /></ToastProvider>);

/** Fire a notice and let the library mount its element (a queued timeout). */
const show = (title: string, sub?: string, kind?: ToastKind) => {
  act(() => fire(title, sub, kind));
  act(() => vi.advanceTimersByTime(1));
};

const sonnerToasts = () => document.querySelectorAll<HTMLElement>('[data-sonner-toast]');

describe('Toast accessibility and timing', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    // Sonner's store replays still-active toasts into the next Toaster — clear them.
    act(() => { sonnerToast.dismiss(); });
    if (vi.isFakeTimers()) vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('keeps warning and error remedies visible until dismissed', () => {
    renderToast();
    show('Warning', 'Ask your administrator for Print access', 'warning');
    act(() => vi.advanceTimersByTime(15_000));
    expect(screen.getByRole('alert')).toHaveTextContent('Ask your administrator for Print access');
    expect(sonnerToasts()).toHaveLength(1);

    show('Error', 'Try again later', 'error');
    act(() => vi.advanceTimersByTime(15_000));
    expect(screen.getByRole('alert')).toHaveTextContent('Try again later');
    expect(sonnerToasts()).toHaveLength(2);
    // Dismissing the front remedy returns the still-persistent warning to the announcement.
    act(() => screen.getAllByRole('button', { name: 'Dismiss notification' })[0].click());
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByRole('alert')).toHaveTextContent('Ask your administrator for Print access');
    expect(sonnerToasts()).toHaveLength(1);
  });

  it('announces an error assertively while a save stays polite', () => {
    renderToast();
    show('Saved', 'Budget v3 activated', 'success');
    expect(screen.getByRole('status')).toHaveTextContent('Saved Budget v3 activated');
    show('Push failed', 'Retry after the ERP window', 'error');
    expect(screen.getByRole('alert')).toHaveTextContent('Push failed Retry after the ERP window');
  });

  it('keeps the dismiss control clickable on success toasts', () => {
    renderToast();
    show('Saved', undefined, 'success');
    const dismiss = screen.getByRole('button', { name: 'Dismiss notification' });
    act(() => dismiss.click());
    act(() => vi.advanceTimersByTime(300));
    expect(sonnerToasts()).toHaveLength(0);
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });

  it('announces each toast once: the library container is not a second live region', () => {
    renderToast();
    show('Saved', undefined, 'success');
    expect(sonnerToasts()[0]!.closest('section')).not.toHaveAttribute('aria-live');
  });

  it('auto-dismisses info and success after max(4s, 60ms per character), capped at 10s', () => {
    renderToast();
    show('Saved', undefined, 'success');
    // show() already spent 1ms of the lifetime; 3998 more keeps it just inside 4s.
    act(() => vi.advanceTimersByTime(3_998));
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    act(() => vi.advanceTimersByTime(300));
    expect(sonnerToasts()).toHaveLength(0);

    // 100 characters read for 6s, not the 4s floor.
    show('a'.repeat(100), undefined, 'info');
    act(() => vi.advanceTimersByTime(5_000));
    expect(sonnerToasts()).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1_000));
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(sonnerToasts()).toHaveLength(0);

    // 200 characters would be 12s: capped at 10s.
    show('a'.repeat(200), undefined, 'info');
    act(() => vi.advanceTimersByTime(10_000));
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(sonnerToasts()).toHaveLength(0);
  });

  it('keeps a long warning visible after 15 seconds at a narrow viewport', () => {
    window.innerWidth = 390;
    renderToast();
    const warning = 'A detailed remedy that wraps across several lines at a narrow screen. '.repeat(3);
    show('Warning', warning, 'warning');
    act(() => vi.advanceTimersByTime(15_000));
    expect(screen.getByRole('alert')).toHaveTextContent(new RegExp(warning.trimEnd().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    expect(sonnerToasts()).toHaveLength(1);
    window.innerWidth = 1024;
  });

  it('pauses the auto-dismiss timer while the toast is hovered', () => {
    // Library pause semantics: hover holds the lifetime; keyboard users reach the close
    // control within it and alt+T lifts the whole stack.
    renderToast();
    show('Saved', undefined, 'success');
    const toastEl = sonnerToasts()[0]!;
    fireEvent.mouseEnter(toastEl);
    act(() => vi.advanceTimersByTime(6_000));
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    fireEvent.mouseLeave(toastEl);
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    act(() => vi.advanceTimersByTime(4_300));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(sonnerToasts()).toHaveLength(0);
  });

  it('auto-dismisses a routine toast under StrictMode effect replay', () => {
    render(<React.StrictMode><ToastProvider><Harness /></ToastProvider></React.StrictMode>);
    show('Status updated', undefined, 'success');
    act(() => vi.advanceTimersByTime(4_000));
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(screen.queryByRole('button', { name: 'Dismiss notification' })).not.toBeInTheDocument();
  });

  it('provides a keyboard reachable dismiss control', async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    render(<ToastProvider><Harness /></ToastProvider>);
    act(() => fire('Saved', undefined, 'success'));
    await waitFor(() => expect(sonnerToasts()).toHaveLength(1));
    // The stacked toast is tabbable (the library exposes it), then its close control.
    await user.tab();
    expect(sonnerToasts()[0]).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Dismiss notification' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(sonnerToasts()).toHaveLength(0));
    await waitFor(() => expect(screen.getByRole('status')).toBeEmptyDOMElement());
  });

  it('re-announces an identical message by clearing and restoring the live-region text', () => {
    renderToast();
    // Fire twice before any timer advance: the identical repeat clears its region first.
    act(() => fire('Saved', undefined, 'success'));
    expect(screen.getByRole('status')).toHaveTextContent('Saved');

    act(() => fire('Saved', undefined, 'success'));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    expect(sonnerToasts()).toHaveLength(2);
  });

  it('mounts status and alert live regions before inserting toast text', () => {
    renderToast();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(screen.getByRole('alert')).toBeEmptyDOMElement();
    // The library's stack is itself a polite live region.
    expect(document.querySelector('section[aria-live="polite"]')).not.toBeNull();
    show('Saved', undefined, 'success');
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    expect(screen.getByRole('alert')).toBeEmptyDOMElement();

    // Backward-compatible two-argument calls classify the second argument as the toast kind.
    show('Failed', 'error');
    expect(screen.getByRole('alert')).toHaveTextContent('Failed');
  });
});
