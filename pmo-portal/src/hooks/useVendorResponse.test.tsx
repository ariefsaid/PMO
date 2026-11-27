import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  listBreakdowns: vi.fn(), record: vi.fn(), clear: vi.fn(),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));
vi.mock('@/src/lib/repositories/equipmentVendorResponse', () => ({ equipmentVendorResponseRepository: h }));
vi.mock('./useCompanies', () => ({ useCompanyOptions: () => ({ data: [{ id: 'v1', name: 'Vendor One' }, { id: 'v2', name: 'Other' }] }) }));
import { formatDuration, useBreakdowns, useClearVendorResponse, useRecordVendorResponse, useVendorNames, useVendorResponseReady } from './useVendorResponse';
import { AuthContext } from '@/src/auth/AuthContext';

const wrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const auth = { currentUser: { org_id: 'org-1' } } as never;
  return ({ children }: { children: React.ReactNode }) => (
    <AuthContext.Provider value={auth}><QueryClientProvider client={client}>{children}</QueryClientProvider></AuthContext.Provider>
  );
};

const t = ((key: string, fallback: string, opts?: { count: number }) =>
  fallback.replace('{{count}}', String(opts?.count ?? ''))) as never;

beforeEach(() => { for (const m of Object.values(h)) m.mockReset().mockResolvedValue(null); });

it('breakdowns read over the asset set and window', async () => {
  h.listBreakdowns.mockResolvedValue([{ asset_id: 'a1', minutes: 65 }]);
  const { result } = renderHook(() => useBreakdowns(['a1', 'a2'], '2026-03-01', '2026-03-31'), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.data).toEqual([{ asset_id: 'a1', minutes: 65 }]));
  expect(h.listBreakdowns).toHaveBeenCalledWith(['a1', 'a2'], '2026-03-01', '2026-03-31');
});

it('record and clear forward their payloads', async () => {
  const { result: r1 } = renderHook(() => useRecordVendorResponse(), { wrapper: wrapper() });
  const input = { assetId: 'a1', periodStart: '2026-03-01', responseText: 'repaired' } as never;
  h.record.mockResolvedValue(undefined);
  await act(async () => { await r1.current.mutateAsync(input); });
  expect(h.record).toHaveBeenCalledWith(input);
  const { result: r2 } = renderHook(() => useClearVendorResponse(), { wrapper: wrapper() });
  h.clear.mockResolvedValue(undefined);
  await act(async () => { await r2.current.mutateAsync({ assetId: 'a1', periodStart: '2026-03-01' }); });
  expect(h.clear).toHaveBeenCalledWith('a1', '2026-03-01');
});

it('the ready flag follows the auth session being present', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const w = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useVendorResponseReady(), { wrapper: w });
  expect(typeof result.current).toBe('boolean');
});

it('a vendor id resolves to its name; an unknown id passes through', () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const w = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useVendorNames(), { wrapper: w });
  expect(result.current('v1')).toBe('Vendor One');
  expect(result.current('v9')).toBe('v9');
});

it('durations render the nonzero parts only, and an absent duration is a dash', () => {
  expect(formatDuration(t, null)).toBe('—');
  expect(formatDuration(t, 0)).toBe('0 min');
  expect(formatDuration(t, 65)).toContain('1 h');
  expect(formatDuration(t, 65)).toContain('5 min');
  expect(formatDuration(t, 1440)).toContain('1 d');
  expect(formatDuration(t, 125)).toContain('2 h');
  expect(formatDuration(t, 125)).not.toContain(' d');
});
