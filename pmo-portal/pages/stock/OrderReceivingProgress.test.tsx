import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import en from '@/public/locales/en/stock.json';
const h = vi.hoisted(() => ({ enabled: true, purchaser: true }));
vi.mock('@/src/hooks/useOrderReceiving', () => ({
  useOrderReceivingEnabled: () => ({ data: h.enabled, isPending: false, isError: false }),
  useOrderReceiving: () => ({ data: { purchaser: h.purchaser, lines: [{ id: 'line', name: 'Goods', ordered: '10.00', received: '4.000', outstanding: '6.000', status: 'partly_received' }] }, isError: false }),
}));
import { OrderReceivingProgress } from './OrderReceivingProgress';
const mount = async () => {
  const instance = i18next.createInstance(); await instance.init({ lng: 'en', resources: { en: { stock: en } }, defaultNS: 'stock' });
  render(<MemoryRouter><I18nextProvider i18n={instance}><OrderReceivingProgress orderId="po" /></I18nextProvider></MemoryRouter>);
};
beforeEach(() => { h.enabled = true; h.purchaser = true; });
describe('order receipt position on the purchase record', () => {
  it('shows purchasing the exact order progress and opens its receiving record', async () => {
    await mount(); expect(screen.getByText('Ordered 10 · Received 4 · Outstanding 6')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open receiving' })).toHaveAttribute('href', '/stock/new/receive?order=po');
  });
  it('does not show ordered or outstanding quantities to a receiver', async () => {
    h.purchaser = false; await mount(); expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });
  it('keeps the old purchase record when the setting is off', async () => {
    h.enabled = false; await mount(); expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });
});
