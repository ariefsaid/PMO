import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import { HIDE_PRICES_ENABLED_KEY, useMaySeePrices, usePriceVisibilitySync } from './useHidePrices';
import { arePricesHidden, getPriceVisibility, isHidePricesActive, priceSource, setHidePricesActive, setPricesHidden } from '@/src/lib/priceReadPath';

const h = vi.hoisted(() => ({ enabled: vi.fn(), may: vi.fn(), org: 'org' }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'requester', org_id: h.org } }) }));
vi.mock('@/src/lib/repositories/hidePrices', () => ({ hidePricesRepository: { getEnabled: h.enabled, getMaySee: h.may } }));

beforeEach(() => { h.org = 'org'; h.enabled.mockReset(); h.may.mockReset(); setHidePricesActive(null); setPricesHidden(false); });
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

it('AC-HPG-P2 resolves off without an initial cache reset or invalidation wave', async () => {
  let resolve!: (value: boolean) => void;
  h.enabled.mockImplementation(() => new Promise<boolean>((r) => { resolve = r; }));
  const { client } = renderVisibility();
  const reset = vi.spyOn(client, 'resetQueries');
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  await act(async () => { resolve(false); });
  await waitFor(() => expect(isHidePricesActive()).toBe(false));
  expect(reset).not.toHaveBeenCalled();
  expect(invalidate).not.toHaveBeenCalled();
});

it('AC-HPG-P2 drops every populated cache on a resolved off-to-on transition and refetches masked', async () => {
  h.enabled.mockResolvedValue(false);
  const { client } = renderVisibility();
  await waitFor(() => expect(isHidePricesActive()).toBe(false));
  const keys = ['procurements', 'payments', 'purchase-orders', 'equipment-plans', 'derived-spend'];
  for (const key of keys) await client.fetchQuery({ queryKey: [key], queryFn: async () => priceSource('payments') });
  for (const key of keys) expect(client.getQueryData([key])).toBe('payments');
  await act(async () => { client.setQueryData([HIDE_PRICES_ENABLED_KEY, 'org'], true); });
  await waitFor(() => expect(isHidePricesActive()).toBe(true));
  for (const key of keys) {
    expect(client.getQueryData([key])).toBeUndefined();
    await client.fetchQuery({ queryKey: [key], queryFn: async () => priceSource('payments') });
    expect(client.getQueryData([key])).toBe('payments_masked');
  }
});

it('AC-HPG-P2 refetches active price caches on each resolved transition', async () => {
  h.enabled.mockResolvedValue(false);
  const { client } = renderVisibility();
  await waitFor(() => expect(isHidePricesActive()).toBe(false));
  const read = vi.fn(async () => priceSource('payments'));
  const observer = new QueryObserver(client, { queryKey: ['active-payment-read'], queryFn: read });
  const unsubscribe = observer.subscribe(() => {});
  try {
    await waitFor(() => expect(client.getQueryData(['active-payment-read'])).toBe('payments'));
    await act(async () => { client.setQueryData([HIDE_PRICES_ENABLED_KEY, 'org'], true); });
    await waitFor(() => expect(client.getQueryData(['active-payment-read'])).toBe('payments_masked'));
    expect(read).toHaveBeenCalledTimes(2);
    await act(async () => { client.setQueryData([HIDE_PRICES_ENABLED_KEY, 'org'], false); });
    await waitFor(() => expect(client.getQueryData(['active-payment-read'])).toBe('payments'));
    expect(read).toHaveBeenCalledTimes(3);
    await act(async () => { client.setQueryData([HIDE_PRICES_ENABLED_KEY, 'org'], true); });
    await waitFor(() => expect(client.getQueryData(['active-payment-read'])).toBe('payments_masked'));
    expect(read).toHaveBeenCalledTimes(4);
  } finally { unsubscribe(); }
});

it('AC-HPG-048 conceals prices while the caller\'s own answer is still loading', async () => {
  h.enabled.mockResolvedValue(true);
  h.may.mockImplementation(() => new Promise(() => {}));
  const { result } = renderVisibility();
  await waitFor(() => expect(h.may).toHaveBeenCalled());
  await waitFor(() => expect(getPriceVisibility()).toBe(true));
  expect(arePricesHidden()).toBe(true);
  expect(result.current).toBe(false);
});

it('AC-HPG-048 conceals prices when the caller\'s own answer fails', async () => {
  h.enabled.mockResolvedValue(true);
  h.may.mockRejectedValue(new Error('502'));
  const { result, client } = renderVisibility();
  await waitFor(() => expect(client.getQueryState(['may-see-prices', 'org', 'requester'])?.status).toBe('error'));
  await act(async () => {});
  expect(arePricesHidden()).toBe(true);
  expect(result.current).toBe(false);
});

it('AC-HPG-048 returns to unresolved and masked when the organisation changes', async () => {
  h.enabled.mockImplementation(async () => h.org === 'org' ? false : new Promise(() => {}));
  const { result, rerender } = renderVisibility();
  await waitFor(() => expect(getPriceVisibility()).toBe(false));
  expect(result.current).toBe(true);
  h.org = 'org2';
  rerender();
  await waitFor(() => expect(getPriceVisibility()).toBeNull());
  expect(isHidePricesActive()).toBe(true);
  expect(priceSource('payments')).toBe('payments_masked');
  expect(result.current).toBe(false);
});
