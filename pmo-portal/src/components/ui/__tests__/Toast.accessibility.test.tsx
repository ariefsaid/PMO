import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider, useToast, type ToastKind } from '../Toast';

let fire: (title: string, sub?: string, kind?: ToastKind) => void;
const Harness: React.FC = () => {
  const { toast } = useToast();
  fire = toast;
  return null;
};

const renderToast = () => render(<ToastProvider><Harness /></ToastProvider>);

describe('Toast accessibility and timing', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    if (vi.isFakeTimers()) vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('keeps warning and error remedies visible until dismissed', () => {
    renderToast();
    act(() => fire('Warning', 'Ask your administrator for Print access', 'warning'));
    act(() => vi.advanceTimersByTime(15_000));
    expect(screen.getByRole('alert')).toHaveTextContent('Ask your administrator for Print access');

    act(() => fire('Error', 'Try again later', 'error'));
    act(() => vi.advanceTimersByTime(15_000));
    expect(screen.getByRole('alert')).toHaveTextContent('Try again later');
    expect(screen.getByText('+1 more')).toBeInTheDocument();
    act(() => screen.getByRole('button', { name: 'Dismiss notification' }).click());
    expect(screen.getByRole('alert')).toHaveTextContent('Ask your administrator for Print access');
  });

  it('auto-dismisses info and success after max(4s, 60ms per character), capped at 10s', () => {
    renderToast();
    act(() => fire('Saved', undefined, 'success'));
    act(() => vi.advanceTimersByTime(3_999));
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();

    act(() => fire('a'.repeat(200), undefined, 'info'));
    act(() => vi.advanceTimersByTime(9_999));
    expect(screen.getByRole('status')).toHaveTextContent('a'.repeat(200));
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('keeps a long warning visible after 15 seconds at a narrow viewport', () => {
    window.innerWidth = 390;
    renderToast();
    const warning = 'A detailed remedy that wraps across several lines at a narrow screen. '.repeat(3);
    act(() => fire('Warning', warning, 'warning'));
    act(() => vi.advanceTimersByTime(15_000));
    expect(screen.getByRole('alert')).toHaveTextContent(new RegExp(warning.trimEnd().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    window.innerWidth = 1024;
  });

  it('pauses the auto-dismiss timer while hovered or focused', async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    render(<ToastProvider><Harness /></ToastProvider>);
    act(() => fire('Saved', undefined, 'success'));
    const dismiss = screen.getByRole('button', { name: 'Dismiss notification' });
    await user.hover(dismiss);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 4_100)); });
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    await user.unhover(dismiss);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 4_100)); });
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('provides a keyboard reachable dismiss control', async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    render(<ToastProvider><Harness /></ToastProvider>);
    act(() => fire('Saved', undefined, 'success'));
    await user.tab();
    expect(screen.getByRole('button', { name: 'Dismiss notification' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('re-announces an identical message by clearing and restoring the live-region text', () => {
    renderToast();
    act(() => fire('Saved', undefined, 'success'));
    expect(screen.getByRole('status')).toHaveTextContent('Saved');

    act(() => fire('Saved', undefined, 'success'));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    act(() => vi.advanceTimersByTime(0));
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });

  it('mounts status and alert live regions before inserting toast text', () => {
    renderToast();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(screen.getByRole('alert')).toBeEmptyDOMElement();
    act(() => fire('Saved', undefined, 'success'));
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    expect(screen.getByRole('alert')).toBeEmptyDOMElement();

    // Backward-compatible two-argument calls classify the second argument as the toast kind.
    act(() => fire('Failed', 'error'));
    expect(screen.getByRole('alert')).toHaveTextContent('Failed');
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
});
