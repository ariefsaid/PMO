import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import en from '../../../public/locales/en/stock.json';
import id from '../../../public/locales/id/stock.json';
import { AuthContext, type AuthContextValue } from '@/src/auth/AuthContext';

const h = vi.hoisted(() => ({ openCount: vi.fn(), ownership: { value: 'pmo' as 'pmo' | 'external' | 'unknown' } }));
vi.mock('@/src/lib/repositories/workOrderMaterialAlerts', () => ({ workOrderMaterialAlertsRepository: { openCount: h.openCount } }));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({
  isOwnershipCacheSynced: () => h.ownership.value !== 'unknown',
  routeDomainWrite: () => h.ownership.value,
  subscribeOwnershipCache: () => () => undefined,
}));

import { WorkOrderAheadBadge } from './WorkOrderAheadBadge';

const auth = { currentUser: { org_id: 'org1' } } as unknown as AuthContextValue;
async function mount(lng: 'en' | 'id', count: number, onOpen = vi.fn()) {
  h.openCount.mockResolvedValue({ workOrderId: 'wo1', itemCount: count });
  const inst = i18n.createInstance();
  await inst.use(initReactI18next).init({ lng, fallbackLng: 'en', ns: ['stock'], defaultNS: 'stock', resources: { en: { stock: en }, id: { stock: id } }, interpolation: { escapeValue: false } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<AuthContext.Provider value={auth}><QueryClientProvider client={client}><I18nextProvider i18n={inst}><WorkOrderAheadBadge workOrderId="wo1" onOpen={onOpen} /></I18nextProvider></QueryClientProvider></AuthContext.Provider>);
  return { view, onOpen };
}
beforeEach(() => { h.openCount.mockReset(); h.ownership.value = 'pmo'; });

describe('WorkOrderAheadBadge', () => {
  it('AC-MVP-011 open alerts show the count in English, and pressing it opens the stock section', async () => {
    const { onOpen } = await mount('en', 2);
    const badge = await screen.findByTestId('wo-ahead-badge-wo1');
    expect(badge.textContent).toBe('2 items ahead of progress');
    fireEvent.click(badge);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('AC-MVP-011 the same in Bahasa Indonesia', async () => {
    await mount('id', 1);
    expect((await screen.findByTestId('wo-ahead-badge-wo1')).textContent).toBe('1 barang melebihi progres');
  });

  it('AC-MVP-011 no open alert: the card header gains nothing', async () => {
    const { view } = await mount('en', 0);
    await new Promise((r) => setTimeout(r, 20));
    expect(view.container.textContent).toBe('');
  });

  it('AC-MVP-011 inventory connected to another system: nothing shows and nothing is read', async () => {
    h.ownership.value = 'external';
    const { view } = await mount('en', 3);
    await new Promise((r) => setTimeout(r, 20));
    expect(view.container.textContent).toBe('');
    expect(h.openCount).not.toHaveBeenCalled();
  });

  it('AC-MVP-011 on the work-order page it links to the project\'s work-order tab', async () => {
    h.openCount.mockResolvedValue({ workOrderId: 'wo1', itemCount: 1 });
    const inst = i18n.createInstance();
    await inst.use(initReactI18next).init({ lng: 'en', fallbackLng: 'en', ns: ['stock'], defaultNS: 'stock', resources: { en: { stock: en } }, interpolation: { escapeValue: false } });
    render(<MemoryRouter><AuthContext.Provider value={auth}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><I18nextProvider i18n={inst}>
      <WorkOrderAheadBadge workOrderId="wo1" href="/projects/p1/work-orders" /></I18nextProvider></QueryClientProvider></AuthContext.Provider></MemoryRouter>);
    const link = await screen.findByTestId('wo-ahead-badge-wo1');
    expect(link.getAttribute('href')).toBe('/projects/p1/work-orders');
  });

  it('AC-MVP-011 outside the app providers it renders nothing and reads nothing', () => {
    const { container } = render(<WorkOrderAheadBadge workOrderId="wo1" onOpen={() => undefined} />);
    expect(container.textContent).toBe('');
    expect(h.openCount).not.toHaveBeenCalled();
  });
});
