/**
 * The loss block keeps one heading whatever its read is doing: a heading that changes text as data lands reads as a
 * different block appearing.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('@/src/hooks/useDashboard', () => ({ useLossBreakdown: () => state.current }));

import { LossReasonsCard } from './OverviewCards';

const range = { key: 'ytd' } as never;
const clientsOnly = { by_reason: [], by_client: [{ client_id: 'c1', client_name: 'Cascade Foods', wins_count: 2, losses_count: 1 }] };
const withReasons = { by_reason: [{ reason: 'price', losses_count: 2, declined_count: 0 }], by_client: clientsOnly.by_client };

const headingIn = (props: Record<string, unknown>) => {
  state.current = { data: undefined, isPending: false, isError: false, refetch: vi.fn(), ...props };
  const { unmount } = render(<MemoryRouter><LossReasonsCard embedded range={range} /></MemoryRouter>);
  const name = screen.getByTestId('chart-loss-reasons').getAttribute('aria-label');
  unmount();
  return name;
};

describe('Loss block heading', () => {
  it('is the same while loading, when its read fails and once it has clients or reasons', () => {
    const loading = headingIn({ isPending: true });
    expect(headingIn({ isError: true })).toBe(loading);
    expect(headingIn({ data: clientsOnly })).toBe(loading);
    expect(headingIn({ data: withReasons })).toBe(loading);
  });
});
