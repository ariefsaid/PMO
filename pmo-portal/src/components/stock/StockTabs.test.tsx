import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import i18next from 'i18next';
import type { Role } from '@/src/auth/AuthContext';
import stockEn from '@/public/locales/en/stock.json';

let realRole: Role = 'Admin';
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole, effectiveRole: realRole }) }));

import { StockTabs } from './StockTabs';

beforeAll(() => { i18next.addResourceBundle('en', 'stock', stockEn, true, true); });

const renderStrip = (initialEntry = '/') => render(
  <MemoryRouter initialEntries={[initialEntry]}><StockTabs /></MemoryRouter>,
);
const strip = () => screen.getByRole('navigation', { name: 'Stock sections' });

/**
 * jsdom lays nothing out — every element measures 0×0 — so a case that needs a real overflow sets the two
 * numbers the strip measures itself with: a scrollWidth greater than clientWidth means there is still
 * something to the right to scroll to.
 */
const withOverflow = (scrollWidth: number, clientWidth: number) => {
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => scrollWidth });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => clientWidth });
};
afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollWidth');
  Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
});

describe('the stock section strip', () => {
  it('keeps the grey rule the full width, with no fade, while every tab fits', () => {
    realRole = 'Admin';
    renderStrip();
    const nav = strip();
    expect(nav.className).toContain('overflow-x-auto');
    // The rule is the strip's own bottom border: with nothing to scroll to, no mask may fade its last pixels.
    expect(nav.className).toContain('border-b');
    expect(nav.className).not.toContain('scroll-fade-x');
  });

  it('shows the right-edge fade only when there is something to scroll to', () => {
    withOverflow(420, 240);
    realRole = 'Admin';
    renderStrip();
    expect(strip().className).toContain('scroll-fade-x');
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

  it('scrolls only the current section tab into view on mount and route change', async () => {
    realRole = 'Admin';
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
    try {
      renderStrip('/stock/setup');
      const setupTab = screen.getByRole('link', { name: 'Setup' });
      const documentsTab = screen.getByRole('link', { name: 'Documents' });

      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView.mock.contexts).toEqual([setupTab]);
      expect(scrollIntoView).toHaveBeenCalledWith({ inline: 'nearest', block: 'nearest' });

      await userEvent.click(documentsTab);

      expect(documentsTab).toHaveAttribute('aria-current', 'page');
      expect(scrollIntoView).toHaveBeenCalledTimes(2);
      expect(scrollIntoView.mock.contexts).toEqual([setupTab, documentsTab]);
    } finally {
      scrollIntoView.mockRestore();
    }
  });
});
