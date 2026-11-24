import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardRow } from '@/src/lib/billingBoard';

const state = vi.hoisted(() => ({
  all: { isPending: false, isError: false, isSuccess: true, data: { rows: [] as unknown[], truncated: false }, refetch: vi.fn() } as Record<string, unknown>,
  calls: [] as Array<string | null>,
}));

vi.mock('@/src/hooks/useBillingBoard', () => ({
  useBillingBoard: (projectId: string | null) => {
    state.calls.push(projectId);
    if (projectId) {
      const rows = ((state.all.data as { rows: BoardRow[] }).rows).filter((r) => r.projectId === projectId);
      return { ...state.all, data: { rows, truncated: false } };
    }
    return state.all;
  },
}));

import BillingBoard from './BillingBoard';

const row = (over: Partial<BoardRow>): BoardRow => ({
  claimId: 'c1', projectId: 'p1', projectName: 'North project', workOrderId: null, woNumber: null, claimCreatedAt: '2026-01-01T00:00:00Z',
  stepCount: 3, stepsDone: 1, currentPosition: 2, currentName: 'Approve', ownerRole: null, startedOn: '2026-01-01', lastCompletedOn: null,
  dueOn: null, allDone: false, today: '2026-01-11', ...over,
});

const Where = () => <div data-testid="where">{useLocation().pathname + useLocation().search}</div>;
const renderBoard = (entry = '/finance/billing-board') => render(
  <MemoryRouter initialEntries={[entry]}>
    <Routes><Route path="/finance/billing-board" element={<><BillingBoard /><Where /></>} /></Routes>
  </MemoryRouter>,
);
const setRows = (rows: BoardRow[], truncated = false) => {
  state.all = { isPending: false, isError: false, isSuccess: true, data: { rows, truncated }, refetch: vi.fn() };
};

describe('BillingBoard', () => {
  beforeEach(() => { state.calls = []; setRows([]); });
  afterEach(() => cleanup());

  it('AC-BBD-011 cards show no amount and link to the claim', () => {
    setRows([
      row({ claimId: 'c1', woNumber: 'WO-7', ownerRole: 'Finance', dueOn: '2026-01-08' }),
      row({ claimId: 'c2', projectId: 'p2', projectName: 'South project', allDone: true, currentName: null, currentPosition: null, startedOn: null, lastCompletedOn: '2026-01-06' }),
    ]);
    renderBoard();
    const cards = screen.getAllByTestId('billing-board-card');
    expect(cards).toHaveLength(2);
    expect(cards[0].getAttribute('href')).toBe('/projects/p1/contract?open=c1&openType=billingClaim');
    expect(within(cards[0]).getByText(/Work order WO-7/)).toBeTruthy();
    expect(within(cards[0]).getByText(/1 of 3 steps/)).toBeTruthy();
    expect(within(cards[0]).getByText(/10 days on this step/)).toBeTruthy();
    expect(within(cards[0]).getByText(/3 days past target/)).toBeTruthy();
    expect(screen.queryByText(/IDR|Rp|\$/)).toBeNull();
    expect(screen.getByRole('heading', { name: /All steps done/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /complete|move/i })).toBeNull();
  });

  it('AC-BBD-012 error state says so (not an empty board); empty state; truncated notice', () => {
    state.all = { isPending: false, isError: true, isSuccess: false, data: undefined, refetch: vi.fn() };
    const { unmount } = renderBoard();
    expect(screen.getByText('The billing board could not be loaded')).toBeTruthy();
    expect(screen.queryByText('No claims to show')).toBeNull();
    unmount();
    setRows([]);
    const second = renderBoard();
    expect(screen.getByText('No claims to show')).toBeTruthy();
    second.unmount();
    setRows([row({})], true);
    renderBoard();
    expect(screen.getByTestId('billing-board-truncated').textContent).toContain('500');
  });

  it('AC-BBD-013 the project in the URL filters the cards', () => {
    setRows([row({ claimId: 'c1' }), row({ claimId: 'c2', projectId: 'p2', projectName: 'South project' })]);
    renderBoard('/finance/billing-board?project=p2');
    const cards = screen.getAllByTestId('billing-board-card');
    expect(cards).toHaveLength(1);
    expect(cards[0].textContent).toContain('South project');
    expect(state.calls).toContain('p2');
  });

  it('AC-BBD-013 an unknown project in the URL is ignored', () => {
    setRows([row({ claimId: 'c1' })]);
    renderBoard('/finance/billing-board?project=nope');
    expect(screen.getAllByTestId('billing-board-card')).toHaveLength(1);
  });
});
