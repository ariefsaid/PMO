import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** #2634 (AC-TWM-023): the receipt-lines and bill-lines editor, over 1018's writers. */
const h = vi.hoisted(() => ({
  items: vi.fn(), lines: vi.fn(), recordReceipt: vi.fn(), recordBill: vi.fn(),
}));
vi.mock('@/src/lib/repositories/threeWayMatch', () => ({
  threeWayMatchRepository: { orderedItems: h.items, recordedLines: h.lines, recordReceiptLines: h.recordReceipt, recordBillLines: h.recordBill },
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'o' } }) }));
import { MatchLinesEditor } from './MatchLinesEditor';

const ITEMS = [{ id: 'i1', name: 'Cement', quantity: '100', rate: '1000' }, { id: 'i2', name: 'Steel', quantity: '10', rate: '50000' }];
const renderIt = (kind: 'receipt' | 'bill', onClose = vi.fn()) => {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MatchLinesEditor kind={kind} targetId="t1" procurementId="p1" label="X-1" onClose={onClose} />
  </QueryClientProvider>);
  return onClose;
};

describe('MatchLinesEditor (AC-TWM-023)', () => {
  beforeEach(() => { vi.clearAllMocks(); h.items.mockResolvedValue(ITEMS); h.lines.mockResolvedValue([]); });

  it('lists the purchase\'s ordered items and sends exactly item and quantity for a receipt', async () => {
    h.recordReceipt.mockResolvedValue(undefined);
    renderIt('receipt');
    await userEvent.type(await screen.findByLabelText('Quantity', { selector: '#match-qty-i1' }), '60');
    expect(screen.getByText('Steel')).toBeInTheDocument();
    expect(screen.queryByLabelText('Rate')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save lines' }));
    await waitFor(() => expect(h.recordReceipt).toHaveBeenCalledWith('t1', [{ itemId: 'i1', quantity: 60 }]));
    expect(await screen.findByTestId('match-lines-result')).toHaveTextContent('Receipt lines saved');
  });

  it('starts a bill from the lines already recorded, rate pre-filled from the order, and shows the new match', async () => {
    h.lines.mockResolvedValue([{ itemId: 'i1', quantity: '80', rate: '1000' }]);
    h.recordBill.mockResolvedValue({ status: 'matched', reasons: [], lines: [] });
    renderIt('bill');
    const qty = await screen.findByLabelText('Quantity', { selector: '#match-qty-i1' });
    await waitFor(() => expect(qty).toHaveValue('80'));
    expect(screen.getByLabelText('Rate', { selector: '#match-rate-i2' })).toHaveValue('50,000');
    await userEvent.clear(qty); await userEvent.type(qty, '60');
    await userEvent.click(screen.getByRole('button', { name: 'Save lines' }));
    await waitFor(() => expect(h.recordBill).toHaveBeenCalledWith('t1', [{ itemId: 'i1', quantity: 60, rate: 1000 }]));
    expect(await screen.findByTestId('match-lines-result')).toHaveTextContent('This bill now matches, so its hold is released.');
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });

  it('a bill that still does not match says it is still held', async () => {
    h.recordBill.mockResolvedValue({ status: 'held', reasons: [], lines: [] });
    renderIt('bill');
    await userEvent.type(await screen.findByLabelText('Quantity', { selector: '#match-qty-i2' }), '9');
    await userEvent.click(screen.getByRole('button', { name: 'Save lines' }));
    expect(await screen.findByTestId('match-lines-result')).toHaveTextContent('still held');
  });

  it('validates before sending: a quantity of 0, an item with no quantity everywhere, a negative rate', async () => {
    renderIt('bill');
    await userEvent.click(await screen.findByRole('button', { name: 'Save lines' }));
    expect(await screen.findByText('Enter a quantity for at least one item.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Quantity', { selector: '#match-qty-i1' }), '0');
    await userEvent.click(screen.getByRole('button', { name: 'Save lines' }));
    expect(await screen.findByText('Enter a quantity above 0 with at most 3 decimal places.')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Quantity', { selector: '#match-qty-i1' }));
    await userEvent.type(screen.getByLabelText('Quantity', { selector: '#match-qty-i1' }), '5');
    const rate = screen.getByLabelText('Rate', { selector: '#match-rate-i1' });
    await userEvent.clear(rate); await userEvent.type(rate, '-3');
    await userEvent.click(screen.getByRole('button', { name: 'Save lines' }));
    expect(await screen.findByText('Enter a rate of 0 or more with at most 2 decimal places.')).toBeInTheDocument();
    expect(h.recordBill).not.toHaveBeenCalled();
  });

  it('explains a database refusal: a paid bill', async () => {
    h.recordBill.mockRejectedValue(Object.assign(new Error('this bill is paid'), { code: 'three-way-match-posted' }));
    renderIt('bill');
    await userEvent.type(await screen.findByLabelText('Quantity', { selector: '#match-qty-i1' }), '5');
    await userEvent.click(screen.getByRole('button', { name: 'Save lines' }));
    expect(await screen.findByText('This bill is paid, so its lines can no longer change.')).toBeInTheDocument();
  });

  it('explains a refusal on a receipt of a closed purchase', async () => {
    h.recordReceipt.mockRejectedValue(Object.assign(new Error('closed'), { code: 'three-way-match-posted' }));
    renderIt('receipt');
    await userEvent.type(await screen.findByLabelText('Quantity', { selector: '#match-qty-i1' }), '5');
    await userEvent.click(screen.getByRole('button', { name: 'Save lines' }));
    expect(await screen.findByText('This purchase is paid or cancelled, so its receipt lines can no longer change.')).toBeInTheDocument();
  });

  it('shows a load error with a retry, and nothing to send, when the order lines cannot be read', async () => {
    h.items.mockRejectedValue(new Error('boom'));
    renderIt('receipt');
    expect(await screen.findByText("Couldn't load the order lines")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save lines' })).toBeDisabled();
  });
});
