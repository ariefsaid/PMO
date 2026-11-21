import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import i18next from 'i18next';
import stockEn from '@/public/locales/en/stock.json';
import { AuthContext, type AuthContextValue } from '@/src/auth/AuthContext';

const h = vi.hoisted(() => ({ enabled: vi.fn(), setEnabled: vi.fn() }));
vi.mock('@/src/lib/repositories/stockWorkOrderTransfer', () => ({ stockWorkOrderTransferRepository: { enabled: h.enabled, setEnabled: h.setEnabled } }));

import { WoTransferToggle } from './WoTransferToggle';

beforeAll(() => { i18next.addResourceBundle('en', 'stock', stockEn, true, true); });
beforeEach(() => { vi.clearAllMocks(); h.enabled.mockResolvedValue(false); h.setEnabled.mockResolvedValue(undefined); });
const renderToggle = (signedIn = true) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <AuthContext.Provider value={(signedIn ? { currentUser: { id: 'u', org_id: 'org-1' } } : { currentUser: null }) as unknown as AuthContextValue}><WoTransferToggle /></AuthContext.Provider>
  </QueryClientProvider>);

describe('WoTransferToggle (AC-WOT-019)', () => {
  it('AC-WOT-019 the setting starts unchecked and turning it on calls the Admin RPC', async () => {
    renderToggle();
    const box = await screen.findByRole('checkbox', { name: 'Work-order transfers' });
    expect(box).not.toBeChecked();
    await userEvent.click(box);
    await waitFor(() => expect(h.setEnabled).toHaveBeenCalledWith(true));
  });
  it('AC-WOT-019 until the setting has been read the toggle shows nothing', () => {
    renderToggle(false);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});
