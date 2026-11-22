import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18next from 'i18next';
import stockEn from '@/public/locales/en/stock.json';

const h = vi.hoisted(() => ({ sent: [] as unknown[], settings: { mode: 'one_step', proofTiming: 'before_posting' }, setMode: vi.fn(), setTiming: vi.fn() }));
vi.mock('@/src/hooks/useStockTransfers', () => ({ useTransferSettings: () => ({ data: h.settings }), useStockTransfers: () => ({ data: h.sent }), useTransferRefresh: () => async () => [] }));
vi.mock('@/src/lib/repositories/stockTransfers', () => ({ stockTransfersRepository: { settings: { setMode: h.setMode, setTiming: h.setTiming } } }));

import { TransferModeSettings } from './TransferModeSettings';

beforeAll(() => { i18next.addResourceBundle('en', 'stock', stockEn, true, true); });
beforeEach(() => { vi.clearAllMocks(); h.sent = []; h.settings = { mode: 'one_step', proofTiming: 'before_posting' }; h.setMode.mockResolvedValue(undefined); h.setTiming.mockResolvedValue(undefined); });
const renderIt = () => render(<QueryClientProvider client={new QueryClient()}><TransferModeSettings /></QueryClientProvider>);

// Moved from StockTransferSettings (#2746): the mode and proof timing sit in the Stock module card in Administration. Behaviour and defaults are unchanged.
describe('TransferModeSettings (AC-TST-026, AC-TST-033)', () => {
  it('AC-TST-026 reads one-step by default and writes two-step when chosen', async () => {
    renderIt();
    expect(screen.getByRole('combobox', { name: /How stock transfers are made/ })).toHaveValue('one_step');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /How stock transfers are made/ }), 'two_step');
    await waitFor(() => expect(h.setMode).toHaveBeenCalledWith('two_step'));
  });
  it('AC-TST-033 the proof timing is chosen here', async () => {
    renderIt();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /When proof is demanded/ }), 'may_follow');
    await waitFor(() => expect(h.setTiming).toHaveBeenCalledWith('may_follow'));
  });
  it('JOB-1122-6 switching two-step off while transfers are in transit is refused out loud, with the number in transit', async () => {
    h.settings = { mode: 'two_step', proofTiming: 'before_posting' };
    h.sent = [{ id: 'a' }, { id: 'b' }];
    renderIt();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /How stock transfers are made/ }), 'one_step');
    expect(await screen.findByRole('alert')).toHaveTextContent('2 transfers are in transit');
    expect(h.setMode).not.toHaveBeenCalled();
  });
});
