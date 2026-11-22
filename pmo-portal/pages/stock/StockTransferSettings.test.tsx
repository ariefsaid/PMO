import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18next from 'i18next';
import stockEn from '@/public/locales/en/stock.json';

const h = vi.hoisted(() => ({ settings: { mode: 'one_step', proofTiming: 'before_posting' }, setMode: vi.fn(), setTiming: vi.fn(), setTagProof: vi.fn(), setItemQuality: vi.fn() }));
vi.mock('@/src/hooks/useStockTransfers', () => ({ useTransferSettings: () => ({ data: h.settings }), useTransferRefresh: () => async () => [] }));
vi.mock('@/src/hooks/useStock', () => ({ useStockItems: () => ({ data: [{ id: 'i1', code: 'PIPE', name: 'Pipe', needs_quality_check: false }] }) }));
vi.mock('@/src/hooks/useStockSiteWork', () => ({ useStockTags: () => ({ data: [{ id: 'g1', name: 'Client supplied', zero_cost: true, paper_required: true }, { id: 'g2', name: 'Plain', zero_cost: false, paper_required: false }] }) }));
vi.mock('@/src/lib/repositories/stockTransfers', () => ({ stockTransfersRepository: { settings: { setMode: h.setMode, setTiming: h.setTiming, setTagProof: h.setTagProof, setItemQuality: h.setItemQuality } } }));

import { StockTransferSettings } from './StockTransferSettings';

beforeAll(() => { i18next.addResourceBundle('en', 'stock', stockEn, true, true); });
beforeEach(() => { vi.clearAllMocks(); h.settings = { mode: 'one_step', proofTiming: 'before_posting' }; for (const f of [h.setMode, h.setTiming, h.setTagProof, h.setItemQuality]) f.mockResolvedValue(undefined); });
const renderIt = () => render(<QueryClientProvider client={new QueryClient()}><StockTransferSettings /></QueryClientProvider>);

describe('StockTransferSettings (AC-TST-026, AC-TST-033)', () => {
  it('AC-TST-026 the mode switch reads and writes; one-step offers only none and paper per tag, and no quality list', async () => {
    renderIt();
    await userEvent.click(screen.getByRole('button', { name: 'Transfers and proof' }));
    expect(screen.getByRole('combobox', { name: /How transfers are made/ })).toHaveValue('one_step');
    expect(screen.queryByText('Items that need a quality check on receipt')).not.toBeInTheDocument();
    const plain = screen.getByRole('combobox', { name: 'Plain' });
    expect(Array.from(plain.querySelectorAll('option')).map((o) => o.value)).toEqual(['none']);            // paper needs a zero-cost tag; confirmation needs two-step
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /How transfers are made/ }), 'two_step');
    await waitFor(() => expect(h.setMode).toHaveBeenCalledWith('two_step'));
  });
  it('AC-TST-033 the proof timing is chosen here', async () => {
    renderIt();
    await userEvent.click(screen.getByRole('button', { name: 'Transfers and proof' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /When proof is demanded/ }), 'may_follow');
    await waitFor(() => expect(h.setTiming).toHaveBeenCalledWith('may_follow'));
  });
  it('AC-TST-026 two-step adds confirmation and either per tag, and the quality-check list writes per item', async () => {
    h.settings = { mode: 'two_step', proofTiming: 'before_posting' };
    renderIt();
    await userEvent.click(screen.getByRole('button', { name: 'Transfers and proof' }));
    const tag = screen.getByRole('combobox', { name: 'Client supplied' });
    expect(Array.from(tag.querySelectorAll('option')).map((o) => o.value)).toEqual(['none', 'paper', 'confirmation', 'either']);
    expect(tag).toHaveValue('paper');                                                                       // a legacy paper_required tag reads as paper
    await userEvent.selectOptions(tag, 'confirmation');
    await waitFor(() => expect(h.setTagProof).toHaveBeenCalledWith('g1', 'confirmation'));
    await userEvent.click(screen.getByRole('checkbox', { name: 'PIPE - Pipe' }));
    await waitFor(() => expect(h.setItemQuality).toHaveBeenCalledWith('i1', true));
  });
});
