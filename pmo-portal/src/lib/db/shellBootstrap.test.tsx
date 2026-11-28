import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { seedShellQueries, type ShellBootstrap } from './shellBootstrap';
import { HIDE_PRICES_ENABLED_KEY, MAY_SEE_PRICES_KEY, useMaySeePrices, usePriceVisibilitySync } from '@/src/hooks/useHidePrices';
import { setHidePricesActive, setPricesHidden } from '@/src/lib/priceReadPath';

const h = vi.hoisted(() => ({ enabled: vi.fn(), may: vi.fn() }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'requester', org_id: 'org' } }) }));
vi.mock('@/src/lib/repositories/hidePrices', () => ({ hidePricesRepository: { getEnabled: h.enabled, getMaySee: h.may } }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: {} }));

const profile = { id: 'requester', org_id: 'org' };
const answer = (extra: Partial<ShellBootstrap>): ShellBootstrap => ({ profile, ...extra });

beforeEach(() => { h.enabled.mockReset(); h.may.mockReset(); setHidePricesActive(null); setPricesHidden(false); });
afterEach(() => { cleanup(); setHidePricesActive(false); setPricesHidden(false); });

it('AC-SHELL-BOOT-001 a start-up answer without may_see_prices drops the cached one, so it is asked again when hiding turns on', () => {
  const client = new QueryClient();
  seedShellQueries(client, answer({ hide_prices_enabled: true, may_see_prices: true }));
  expect(client.getQueryData([MAY_SEE_PRICES_KEY, 'org', 'requester'])).toBe(true);
  seedShellQueries(client, answer({ hide_prices_enabled: false }));
  expect(client.getQueryData([HIDE_PRICES_ENABLED_KEY, 'org'])).toBe(false);
  expect(client.getQueryData([MAY_SEE_PRICES_KEY, 'org', 'requester'])).toBeUndefined();
});

it('AC-SHELL-BOOT-002 a requester is never shown prices from a stale may_see_prices once hiding is on again', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Earlier answer: hiding on and this person may see prices. Later answer: hiding off, no may_see_prices key.
  seedShellQueries(client, answer({ hide_prices_enabled: true, may_see_prices: true }));
  seedShellQueries(client, answer({ hide_prices_enabled: false }));
  h.enabled.mockResolvedValue(true);
  h.may.mockResolvedValue(false); // the database's current answer: this person may not see prices
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => { usePriceVisibilitySync(); return useMaySeePrices(); }, { wrapper });
  expect(result.current).toBe(true); // hiding is off for now
  // Hiding is switched on again: the setting read now answers true.
  await act(async () => { client.setQueryData([HIDE_PRICES_ENABLED_KEY, 'org'], true); });
  await waitFor(() => expect(h.may).toHaveBeenCalled());
  await waitFor(() => expect(result.current).toBe(false));
});

it('AC-SHELL-BOOT-003 an answer that carries may_see_prices false seeds it as false', () => {
  const client = new QueryClient();
  seedShellQueries(client, answer({ hide_prices_enabled: true, may_see_prices: false }));
  expect(client.getQueryData([MAY_SEE_PRICES_KEY, 'org', 'requester'])).toBe(false);
});
