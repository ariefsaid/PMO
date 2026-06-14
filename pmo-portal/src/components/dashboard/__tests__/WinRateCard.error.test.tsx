import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

/**
 * W2-4b — WinRateCard shows error+retry on fetch error, not empty state.
 * AC-W2-4-02: when useWinRate errors, renders an error affordance + Retry, NOT "No closed projects".
 */

const { winRateState } = vi.hoisted(() => ({
  winRateState: {
    data: undefined as Record<string, unknown> | undefined,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock('@/src/hooks/useDashboard', () => ({
  useWinRate: () => winRateState,
}));

import { WinRateCard } from '../WinRateCard';

const renderCard = () => render(<WinRateCard />);

describe('WinRateCard — error state (AC-W2-4-02)', () => {
  beforeEach(() => {
    winRateState.data = undefined;
    winRateState.isError = false;
    winRateState.refetch.mockClear();
  });

  it('AC-W2-4-02: shows error affordance (not "No closed projects") on fetch error', () => {
    winRateState.isError = true;

    renderCard();

    // Should NOT show the "no closed projects" empty state
    expect(screen.queryByText(/No closed projects in this window/i)).toBeNull();
    // Should show an error UI (some error text)
    expect(
      screen.getByRole('alert') ||
      screen.getByText(/couldn't load/i) ||
      screen.getByText(/something went wrong/i),
    ).toBeTruthy();
  });

  it('AC-W2-4-02: Retry button calls refetch on error', () => {
    winRateState.isError = true;
    const refetch = vi.fn();
    winRateState.refetch = refetch;

    renderCard();

    const retryBtn = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retryBtn);
    expect(refetch).toHaveBeenCalled();
  });

  it('shows empty state when no error and no data', () => {
    winRateState.isError = false;
    winRateState.data = undefined;

    renderCard();

    expect(screen.getByText(/No closed projects in this window/i)).toBeInTheDocument();
  });
});
