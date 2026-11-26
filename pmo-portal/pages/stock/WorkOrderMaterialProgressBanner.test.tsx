import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import en from '../../public/locales/en/stock.json';
import id from '../../public/locales/id/stock.json';
import type { MaterialProgress } from '@/src/lib/db/workOrderMaterialProgress';
import { AuthContext, type AuthContextValue } from '@/src/auth/AuthContext';

const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/src/lib/repositories/workOrderMaterialProgress', () => ({ workOrderMaterialProgressRepository: { get: h.get } }));

import { WorkOrderMaterialProgressBanner } from './WorkOrderMaterialProgressBanner';

const auth = { currentUser: { org_id: 'org1' } } as unknown as AuthContextValue;
const warnItem = { itemId: 'i1', itemCode: 'ROD', itemName: 'Welding rod', unitCode: 'KG', plannedQty: '100', issuedQty: '60', issuedPct: 60, gapPp: 35, unplanned: false, warn: true };
const calm = { ...warnItem, itemId: 'i2', itemName: 'Calm item', issuedPct: 30, gapPp: 5, warn: false };

async function mount(lng: 'en' | 'id', data: MaterialProgress) {
  h.get.mockResolvedValue(data);
  const inst = i18n.createInstance();
  await inst.use(initReactI18next).init({ lng, fallbackLng: 'en', ns: ['stock'], defaultNS: 'stock', resources: { en: { stock: en }, id: { stock: id } }, interpolation: { escapeValue: false } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<AuthContext.Provider value={auth}><QueryClientProvider client={client}><I18nextProvider i18n={inst}><WorkOrderMaterialProgressBanner workOrderId="wo1" /></I18nextProvider></QueryClientProvider></AuthContext.Provider>);
}
beforeEach(() => h.get.mockReset());

describe('WorkOrderMaterialProgressBanner', () => {
  it('AC-MIP-012 no threshold: nothing renders', async () => {
    const { container } = await mount('en', { thresholdPct: null, progressPct: null, items: [] });
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe('');
  });

  it('AC-MIP-012 a threshold but nothing warning: nothing renders', async () => {
    const { container } = await mount('en', { thresholdPct: 30, progressPct: 25, items: [calm] });
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe('');
  });

  it('AC-MIP-013 one warning item names the item, issued share, progress share and gap (English)', async () => {
    await mount('en', { thresholdPct: 30, progressPct: 25, items: [warnItem, calm] });
    expect(await screen.findByText('Items issued ahead of progress: 1')).toBeTruthy();
    const row = screen.getByRole('row', { name: /Welding rod/ });
    expect(row).toHaveTextContent('60%');
    expect(row).toHaveTextContent('35 points');
    expect(screen.getByText(/progress \(25%\)/)).toBeTruthy();
    expect(screen.queryByText(/Calm item/)).toBeNull();
  });

  it('AC-MIP-013 the same in Bahasa Indonesia', async () => {
    await mount('id', { thresholdPct: 30, progressPct: 25, items: [warnItem] });
    expect(await screen.findByText('Barang dikeluarkan melebihi progres: 1')).toBeTruthy();
    const row = screen.getByRole('row', { name: /Welding rod/ });
    expect(row).toHaveTextContent('60%');
    expect(row).toHaveTextContent('35 poin');
  });

  it('AC-MIP-014 outside the app providers it renders nothing and reads nothing', () => {
    const { container } = render(<WorkOrderMaterialProgressBanner workOrderId="wo1" />);
    expect(container.textContent).toBe('');
    expect(h.get).not.toHaveBeenCalled();
  });
});
