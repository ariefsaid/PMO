import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HIDE_PRICES_ENABLED_KEY, useMaySeePrices, usePriceVisibilitySync } from './useHidePrices';
import { isHidePricesActive, priceSource, setHidePricesActive, setPricesHidden } from '@/src/lib/priceReadPath';

const h = vi.hoisted(() => ({ enabled: vi.fn(), may: vi.fn() }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'requester', org_id: 'org' } }) }));
vi.mock('@/src/lib/repositories/hidePrices', () => ({ hidePricesRepository: { getEnabled: h.enabled, getMaySee: h.may } }));

beforeEach(() => { h.enabled.mockReset(); h.may.mockReset(); setHidePricesActive(false); setPricesHidden(false); });
afterEach(() => { cleanup(); setHidePricesActive(false); setPricesHidden(false); });

function renderVisibility() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(() => { usePriceVisibilitySync(); return useMaySeePrices(); }, { wrapper });
  return { ...hook, client };
}

it('AC-HPG-048 keeps requester reads masked when the visibility setting is unavailable', async () => {
  h.enabled.mockRejectedValue(new Error('502'));
  const { result, client } = renderVisibility();
  await waitFor(() => expect(client.getQueryState([HIDE_PRICES_ENABLED_KEY, 'org'])?.status).toBe('error'));
  expect(priceSource('procurements')).toBe('procurements_masked');
  expect(result.current).toBe(false);
});

it('AC-HPG-048 conceals prices while the setting is still loading', () => {
  h.enabled.mockImplementation(() => new Promise(() => {}));
  const { result } = renderVisibility();
  expect(isHidePricesActive()).toBe(true);
  expect(result.current).toBe(false);
});

it('uses the ordinary read path once the server confirms the setting is off', async () => {
  h.enabled.mockResolvedValue(false);
  const { result, client } = renderVisibility();
  await waitFor(() => expect(client.getQueryData([HIDE_PRICES_ENABLED_KEY, 'org'])).toBe(false));
  await waitFor(() => expect(isHidePricesActive()).toBe(false));
  expect(result.current).toBe(true);
});

it('shows prices once the database confirms the caller may see them', async () => {
  h.enabled.mockResolvedValue(true);
  h.may.mockResolvedValue(true);
  const { result } = renderVisibility();
  await waitFor(() => expect(h.may).toHaveBeenCalled());
  await waitFor(() => expect(result.current).toBe(true));
});
