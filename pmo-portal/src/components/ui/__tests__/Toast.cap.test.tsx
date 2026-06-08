import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { ToastProvider, useToast } from '../Toast';

// AC-IXD-WP-005 (write-policy, plan task 11):
//   Given rapid successive transitions, at most ONE toast is visible at a time
//   (no pile-up) and it auto-dismisses within 3–5s. Routine forward writes each
//   fire a quiet toast; without a cap they would stack into a column. The cap
//   keeps feedback calm and out of the way.

// A tiny harness that exposes the imperative toast() API to the test.
let fire: (title: string, sub?: string) => void;
const Harness: React.FC = () => {
  const { toast } = useToast();
  fire = (title, sub) => toast(title, sub, 'success');
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

    // Within the 3–5s window it disappears on its own (no user action).
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
