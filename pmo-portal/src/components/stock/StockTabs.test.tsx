import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import i18next from 'i18next';
import type { Role } from '@/src/auth/AuthContext';
import stockEn from '@/public/locales/en/stock.json';

let realRole: Role = 'Admin';
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole, effectiveRole: realRole }) }));

import { StockTabs } from './StockTabs';

beforeAll(() => { i18next.addResourceBundle('en', 'stock', stockEn, true, true); });

const renderStrip = () => render(<MemoryRouter><StockTabs /></MemoryRouter>);

describe('the stock section strip', () => {
  it('marks itself as sideways-scrollable, so a tab cut off at the right edge is not a mystery', () => {
    realRole = 'Admin';
    renderStrip();
    const nav = screen.getByRole('navigation', { name: 'Stock sections' });
    expect(nav.className).toContain('overflow-x-auto');
    // The shared scroll hint utility (index.css .scroll-fade-x) — the same one the kanban strip uses.
    expect(nav.className).toContain('scroll-fade-x');
  });

  it('offers Setup to a master-data writer and hides it from a reader', () => {
    realRole = 'Admin';
    const first = renderStrip();
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(['On hand', 'Documents', 'Ledger', 'Reorder', 'Setup']);
    first.unmount();
    realRole = 'Engineer';
    renderStrip();
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(['On hand', 'Documents', 'Ledger', 'Reorder']);
  });
});
