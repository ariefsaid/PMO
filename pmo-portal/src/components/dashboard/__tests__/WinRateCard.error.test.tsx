import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router';

/**
 * W2-4b — WinRateCard shows error+retry on fetch error, not empty state.
 * AC-W2-4-02: when useWinRate errors, renders an error affordance + Retry, NOT "No closed projects".
 */

const { winRateState } = vi.hoisted(() => ({
  winRateState: {
    data: undefined as Record<string, unknown> | undefined,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock('@/src/hooks/useDashboard', () => ({
  useWinRate: () => winRateState,
}));

import { WinRateCard } from '../WinRateCard';

const renderCard = () => render(<MemoryRouter><WinRateCard currency="USD" /></MemoryRouter>);

describe('WinRateCard — error state (AC-W2-4-02)', () => {
  beforeEach(() => {
    winRateState.data = undefined;
    winRateState.isPending = false;
    winRateState.isError = false;
    winRateState.refetch.mockClear();
  });

  it('AC-W2-4-02: shows error affordance (not "No closed projects") on fetch error', () => {
    winRateState.isError = true;

    renderCard();

    // Should NOT show the "no closed projects" empty state
    expect(screen.queryByText(/No closed projects in this window/i)).toBeNull();
    // Should show an error UI — getByRole('alert') is the single robust assertion
    // (Q-1: drop the dead || fallback that short-circuits on the first truthy value
    // and never exercises the alternatives).
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByTestId('win-rate-figure')).toBeInTheDocument();
    expect(screen.getByTestId('win-rate-track-count')).toHaveAttribute('aria-valuetext', 'Rate unavailable');
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

  it('#1380 keeps the same plot frame and controls while the win rate loads', () => {
    winRateState.isPending = true;

    renderCard();

    expect(screen.getByTestId('win-rate-figure')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('win-rate-period-controls')).toBeInTheDocument();
    expect(screen.getByTestId('win-rate-basis-controls')).toBeInTheDocument();
    expect(screen.getByTestId('win-rate-axis')).toBeInTheDocument();
  });
});
