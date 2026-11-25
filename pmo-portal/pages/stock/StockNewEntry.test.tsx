import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
const h = vi.hoisted(() => ({ data: false, isPending: false, isError: false, refetch: vi.fn() }));
vi.mock('@/src/hooks/useOrderReceiving', () => ({ useOrderReceivingEnabled: () => h }));
vi.mock('./StockMovementForm', () => ({ default: () => <div>Existing stock form</div> }));
vi.mock('./OrderReceiving', () => ({ default: () => <div>Order counted receipt</div>, OrderReceivingSetting: () => <div>Receiving setting</div> }));
import StockNewEntry from './StockNewEntry';
const mount = (kind = 'receive') => render(<MemoryRouter initialEntries={[`/stock/new/${kind}`]}><Routes><Route path="/stock/new/:kind" element={<StockNewEntry />} /></Routes></MemoryRouter>);
beforeEach(() => { h.data = false; h.isPending = false; h.isError = false; });
describe('receiving opt-in route', () => {
  it('AC-RGO-001 keeps the existing receive form while off', () => {
    mount(); expect(screen.getByText('Existing stock form')).toBeInTheDocument(); expect(screen.queryByText('Order counted receipt')).not.toBeInTheDocument();
  });
  it('opens order counts when enabled', () => {
    h.data = true; mount(); expect(screen.getByText('Order counted receipt')).toBeInTheDocument(); expect(screen.queryByText('Existing stock form')).not.toBeInTheDocument();
  });
  it('keeps other stock movement forms', () => {
    h.data = true; mount('issue'); expect(screen.getByText('Existing stock form')).toBeInTheDocument();
  });
  it('does not expose the old price form while the setting read fails', () => {
    h.isError = true; mount(); expect(screen.getByRole('alert')).toBeInTheDocument(); expect(screen.queryByText('Existing stock form')).not.toBeInTheDocument();
  });
});
