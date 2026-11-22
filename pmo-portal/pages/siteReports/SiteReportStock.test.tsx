import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import { MemoryRouter } from 'react-router';
import { SiteReportStockView } from './SiteReportStock';
import type { DsrStockStatus } from '@/src/lib/db/dsrStockIssue';

vi.mock('@/src/hooks/useDsrStockIssue', () => ({ useDsrStockStatus: () => ({ data: null }) }));

const line = (o: Partial<DsrStockStatus['lines'][number]>) => ({ consumableId: 'c', position: 1, itemCode: 'ROD', itemName: 'Welding rod', unit: 'pc', quantity: '5', state: 'posted' as const, shortBy: null, reason: null, ...o });
const base: DsrStockStatus = { state: 'partial', reason: null, occurredOn: '2026-11-18', reversed: false, location: 'Site one', documentNumber: 'ISS-0001', lines: [] };

async function setup(lng: 'en' | 'id') {
  const inst = i18n.createInstance();
  const en = (await import('../../public/locales/en/siteReport.json')).default;
  const id = (await import('../../public/locales/id/siteReport.json')).default;
  await inst.init({ lng, fallbackLng: 'en', ns: ['siteReport'], defaultNS: 'siteReport', resources: { en: { siteReport: en }, id: { siteReport: id } }, interpolation: { escapeValue: false } });
  return inst;
}

describe('SiteReportStockView', () => {
  it('AC-DRS-018 a posted report shows the document number and no warning', async () => {
    const inst = await setup('en');
    render(<I18nextProvider i18n={inst}><SiteReportStockView status={{ ...base, state: 'posted', lines: [line({})] }} /></I18nextProvider>);
    expect(screen.getByTestId('dsr-stock-posted').textContent).toContain('ISS-0001');
    expect(screen.queryByTestId('dsr-stock-warning')).toBeNull();
  });

  it('AC-DRS-018 a short line and a missing site location each get a warning in words', async () => {
    const inst = await setup('en');
    render(<I18nextProvider i18n={inst}><SiteReportStockView status={{ ...base, lines: [line({ state: 'short', shortBy: '43', quantity: '50' }), line({ consumableId: 'd', itemCode: 'FLG', state: 'no_location' })] }} /></I18nextProvider>);
    const w = screen.getByTestId('dsr-stock-warning');
    expect(w.textContent).toContain('short by 43 at Site one');
    expect(w.textContent).toContain('this work order has no site location');
    expect(w.getAttribute('role')).toBe('alert');
  });

  it('AC-DRS-018 the same warning reads in Bahasa Indonesia', async () => {
    const inst = await setup('id');
    render(<I18nextProvider i18n={inst}><SiteReportStockView status={{ ...base, lines: [line({ state: 'short', shortBy: '3' })] }} /></I18nextProvider>);
    expect(screen.getByTestId('dsr-stock-warning').textContent).toContain('kurang 3 di Site one');
  });

  it('AC-DRS-018 a line left out by the item scope is not a warning', async () => {
    const inst = await setup('en');
    render(<I18nextProvider i18n={inst}><SiteReportStockView status={{ ...base, state: 'out_of_scope', documentNumber: null, lines: [line({ state: 'not_stocked' })] }} /></I18nextProvider>);
    expect(screen.queryByTestId('dsr-stock-warning')).toBeNull();
  });

  it('AC-SD-006 a line with no site location links the warning to the setting, in both languages', async () => {
    for (const lng of ['en', 'id'] as const) {
      const inst = await setup(lng);
      const { unmount } = render(<MemoryRouter><I18nextProvider i18n={inst}><SiteReportStockView workOrderId="wo9" status={{ ...base, state: 'not_posted', location: null, lines: [line({ state: 'no_location' })] }} /></I18nextProvider></MemoryRouter>);
      expect(screen.getByTestId('dsr-stock-set-location')).toHaveAttribute('href', '/work-orders/wo9#site-location');
      expect(screen.getByTestId('dsr-stock-set-location').textContent).toBe(lng === 'en' ? 'Set the site location on the work order' : 'Atur lokasi lapangan di perintah kerja');
      unmount();
    }
  });
});
