import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe } from 'jest-axe';
import { BahasaProvider } from '@/test/bahasa';
import type { WinRateRange } from '@/src/hooks/useDashboard';
import type { LossBreakdown as LossBreakdownData } from '@/src/lib/db/dashboard';

let mockData: LossBreakdownData | undefined = undefined;
let mockIsPending = false;
let mockIsError = false;
const mockRefetch = vi.fn();

vi.mock('@/src/hooks/useDashboard', async (orig) => {
  const actual = await orig<typeof import('@/src/hooks/useDashboard')>();
  return {
    ...actual,
    useLossBreakdown: (_range: WinRateRange) => ({
      data: mockData,
      isPending: mockIsPending,
      isError: mockIsError,
      refetch: mockRefetch,
    }),
  };
});

import { LossBreakdown } from '../LossBreakdown';

const sampleRange: WinRateRange = { key: 'all::' };

const sampleData: LossBreakdownData = {
  by_reason: [
    { reason: 'price', losses_count: 5, declined_count: 2 },
    { reason: 'competitor', losses_count: 3, declined_count: 0 },
    { reason: null, losses_count: 1, declined_count: 1 },
  ],
  by_client: [
    { client_id: 'c1', client_name: 'Alpha Corp', wins_count: 4, losses_count: 2 },
    { client_id: null, client_name: null, wins_count: 1, losses_count: 1 },
  ],
};

describe('LossBreakdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockData = sampleData;
    mockIsPending = false;
    mockIsError = false;
  });

  it('AC-LR-015: renders reason rows and client rankings in order with proper counts and fallbacks', () => {
    render(<LossBreakdown range={sampleRange} />);

    expect(screen.getByText('Why deals were lost')).toBeInTheDocument();
    expect(screen.getByText('Price')).toBeInTheDocument();
    expect(screen.getByText('5 lost · 2 declined')).toBeInTheDocument();

    expect(screen.getByText('Lost to a competitor')).toBeInTheDocument();
    expect(screen.getByText('3 lost')).toBeInTheDocument();

    expect(screen.getByText('Not recorded')).toBeInTheDocument();
    expect(screen.getByText('1 lost · 1 declined')).toBeInTheDocument();

    expect(screen.getByText('Win and loss by client')).toBeInTheDocument();
    expect(screen.getByText('Alpha Corp')).toBeInTheDocument();
    expect(screen.getByText('4 won, 2 lost')).toBeInTheDocument();

    expect(screen.getByText('Unknown client')).toBeInTheDocument();
    expect(screen.getByText('1 won, 1 lost')).toBeInTheDocument();
  });

  it('AC-LR-015: empty by_reason shows "No lost deals in this period." and omits client list when empty', () => {
    mockData = { by_reason: [], by_client: [] };
    render(<LossBreakdown range={sampleRange} />);

    expect(screen.getByText('No lost deals in this period.')).toBeInTheDocument();
    expect(screen.queryByText('Win and loss by client')).toBeNull();
  });

  it('AC-LR-015: isError shows retry button and clicking it calls refetch', () => {
    mockIsError = true;
    mockData = undefined;
    render(<LossBreakdown range={sampleRange} />);

    expect(screen.getByText("Couldn't load the loss breakdown")).toBeInTheDocument();
    const retryBtn = screen.getByRole('button', { name: 'Try again' });
    fireEvent.click(retryBtn);
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it('AC-LR-015: isPending renders nothing (no flash)', () => {
    mockIsPending = true;
    const { container } = render(<LossBreakdown range={sampleRange} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('AC-LR-016: Bahasa Indonesia renders Harga, Belum dicatat, Mengapa deal kalah', () => {
    render(
      <BahasaProvider locale="id">
        <LossBreakdown range={sampleRange} />
      </BahasaProvider>,
    );

    expect(screen.getByText('Mengapa deal kalah')).toBeInTheDocument();
    expect(screen.getByText('Harga')).toBeInTheDocument();
    expect(screen.getByText('Belum dicatat')).toBeInTheDocument();
    expect(screen.getByText('Menang dan kalah per klien')).toBeInTheDocument();
  });

  it('AC-LR-018: axe reports no accessibility violations', async () => {
    const { container } = render(<LossBreakdown range={sampleRange} />);
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
