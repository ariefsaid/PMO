import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BahasaProvider } from '@/test/bahasa';
import type { BoardRow } from '@/src/lib/billingBoard';

const rows: BoardRow[] = [
  { claimId: 'c1', projectId: 'p1', projectName: 'Proyek Utara', workOrderId: 'w1', woNumber: 'WO-7', claimCreatedAt: '2026-01-01T00:00:00Z',
    stepCount: 3, stepsDone: 1, currentPosition: 2, currentName: 'Persetujuan', ownerRole: 'Finance', startedOn: '2026-01-01', lastCompletedOn: null,
    dueOn: '2026-01-08', allDone: false, today: '2026-01-11' },
  { claimId: 'c2', projectId: 'p2', projectName: 'Proyek Selatan', workOrderId: null, woNumber: null, claimCreatedAt: '2026-01-01T00:00:00Z',
    stepCount: 2, stepsDone: 2, currentPosition: null, currentName: null, ownerRole: null, startedOn: null, lastCompletedOn: '2026-01-10',
    dueOn: null, allDone: true, today: '2026-01-11' },
];

const board = vi.hoisted(() => ({ empty: false }));
vi.mock('@/src/hooks/useBillingBoard', () => ({
  useBillingBoard: () => ({ isPending: false, isError: false, isSuccess: true, data: board.empty ? { rows: [], truncated: false } : { rows, truncated: true }, refetch: vi.fn() }),
}));

import BillingBoard from './BillingBoard';

describe('BillingBoard in Bahasa Indonesia', () => {
  afterEach(() => { cleanup(); board.empty = false; });

  it('BQ13 the empty board sends the person to the project tab that exists: Kontrak', () => {
    board.empty = true;
    render(<BahasaProvider><MemoryRouter><BillingBoard /></MemoryRouter></BahasaProvider>);
    expect(screen.getByText(/tab Kontrak proyek/)).toBeTruthy();
    expect(screen.queryByText(/tab Penagihan/)).toBeNull();
  });

  it('AC-BBD-014 title, columns, ages, overdue chip and notices read as Bahasa', () => {
    render(<BahasaProvider><MemoryRouter><BillingBoard /></MemoryRouter></BahasaProvider>);
    expect(screen.getByRole('heading', { name: 'Papan penagihan' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Semua langkah selesai/ })).toBeTruthy();
    const [first, second] = screen.getAllByTestId('billing-board-card');
    expect(within(first).getByText('1 dari 3 langkah')).toBeTruthy();
    expect(within(first).getByText('10 hari di langkah ini')).toBeTruthy();
    expect(within(first).getByText('3 hari lewat target')).toBeTruthy();
    expect(within(first).getByText('Menunggu Keuangan', { exact: false })).toBeTruthy();
    expect(within(second).getByText('1 hari di langkah ini')).toBeTruthy();
    expect(screen.getByTestId('billing-board-truncated').textContent).toContain('yang tertua');
    expect(screen.queryByText(/days on this step|days past target|Billing board/)).toBeNull();
  });
});
