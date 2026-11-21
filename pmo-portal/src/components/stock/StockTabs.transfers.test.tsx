import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext, type AuthContextValue } from '@/src/auth/AuthContext';
import React from 'react';
import i18next from 'i18next';
import stockEn from '@/public/locales/en/stock.json';

const h = vi.hoisted(() => ({ twoStep: false }));
vi.mock('@/src/hooks/useStockTransfers', () => ({ useIsTwoStep: () => h.twoStep }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => false }));

import { StockTabs } from './StockTabs';

beforeAll(() => { i18next.addResourceBundle('en', 'stock', stockEn, true, true); });

const wrap = (ui: React.ReactNode) => <QueryClientProvider client={new QueryClient()}><AuthContext.Provider value={{} as AuthContextValue}><MemoryRouter>{ui}</MemoryRouter></AuthContext.Provider></QueryClientProvider>;

describe('StockTabs Transfers tab (AC-TST-027)', () => {
  it('AC-TST-027 a one-step organisation sees the same tabs as before', () => {
    h.twoStep = false;
    render(wrap(<StockTabs />));
    expect(screen.queryByRole('link', { name: 'Transfers' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(['On hand', 'Documents', 'Ledger', 'Reorder']);
  });
  it('AC-TST-027 a two-step organisation gets a Transfers tab', () => {
    h.twoStep = true;
    render(wrap(<StockTabs />));
    expect(screen.getByRole('link', { name: 'Transfers' })).toHaveAttribute('href', '/stock/transfers');
  });
});
