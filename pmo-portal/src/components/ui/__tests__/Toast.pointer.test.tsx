import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import React from 'react';
import { toast as sonnerToast } from 'sonner';
import { ToastProvider, useToast, type ToastKind } from '../Toast';

/**
 * #2502 — a notice may be painted over a control, but it never TAKES the control from the person:
 * every pixel of a notice except its own buttons hit-tests through to the page underneath. The
 * shipped bug was a notice pinned bottom-right over a short window's last table row: the row's
 * status control could not be clicked, and a resting pointer paused the notice's clock so it
 * stayed for as long as the person needed to use that control.
 *
 * The browser-level proof (the topmost element at the control's centre is the control) is the e2e
 * spec; these are the host's structural guarantees.
 */

let fire: (title: string, sub?: string, kind?: ToastKind) => void;
const Harness: React.FC = () => {
  const { toast } = useToast();
  fire = toast;
  return null;
};

const renderToast = () => render(<ToastProvider><Harness /></ToastProvider>);
const show = (title: string, sub?: string, kind?: ToastKind) => {
  act(() => fire(title, sub, kind));
  act(() => vi.advanceTimersByTime(1));
};
const sonnerToasts = () => document.querySelectorAll<HTMLElement>('[data-sonner-toast]');

describe('Toast never takes the pointer from the page', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    act(() => { sonnerToast.dismiss(); });
    if (vi.isFakeTimers()) vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('leaves the whole notice stack pointer-transparent and only its own dismiss button clickable', () => {
    renderToast();
    show('Status updated', undefined, 'success');

    const card = sonnerToasts()[0]!;
    const stack = card.closest<HTMLElement>('[data-sonner-toaster]')!;
    expect(stack.style.pointerEvents, 'the stack container must not swallow clicks in the gaps between notices').toBe('none');
    expect(card.style.pointerEvents, 'the notice card must not swallow the click meant for the control it covers').toBe('none');

    const dismiss = screen.getByRole('button', { name: 'Dismiss notification' });
    expect(dismiss.className).toMatch(/\bpointer-events-auto\b/);
  });

  it('keeps the dismiss button the only hit target of a persistent remedy', () => {
    renderToast();
    show('Push failed', 'Retry after the ERP window', 'error');

    const card = sonnerToasts()[0]!;
    expect(card.style.pointerEvents).toBe('none');
    // …and the one exception still works: the remedy can be dismissed while it is up.
    act(() => screen.getByRole('button', { name: 'Dismiss notification' }).click());
    act(() => vi.advanceTimersByTime(300));
    expect(sonnerToasts()).toHaveLength(0);
  });
});
