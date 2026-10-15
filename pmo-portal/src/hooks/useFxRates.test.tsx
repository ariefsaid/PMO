import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const harness = vi.hoisted(() => ({
  org: 'org-a',
  list: vi.fn(),
  onDate: vi.fn(),
  upsert: vi.fn(),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: harness.org ? { org_id: harness.org } : null }),
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({
  useOrgCurrencyState: () => ({ currency: 'IDR', isResolved: true, isError: false }),
}));
vi.mock('@/src/hooks/useFxOrgDay', () => ({
  useFxOrgDay: (enabled: boolean) => ({
    day: enabled ? '2026-10-12' : null,
    isPending: false,
    isError: false,
    retry: vi.fn(),
  }),
}));
vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    fxRates: {
      list: harness.list,
      onDate: harness.onDate,
      upsert: harness.upsert,
    },
  },
}));
import { fxKeys, useFxRate, useFxRates, useFxRateMutations } from './useFxRates';
import FxEquivalent from '@/src/components/fx/FxEquivalent';

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

describe('useFxRates query and mutation keys', () => {
  beforeEach(() => {
    harness.org = 'org-a';
    harness.list.mockResolvedValue({ rows: [], nextCursor: null });
    harness.onDate.mockResolvedValue(null);
    harness.upsert.mockResolvedValue({ new: 1, changed: 0, unchanged: 0 });
  });
  afterEach(cleanup);

  it('disables queries without an organization and keys bounded pages by cursor', async () => {
    const { client, wrapper } = setup();
    harness.org = '';
    const disabled = renderHook(() => useFxRates(), { wrapper });
    expect(harness.list).not.toHaveBeenCalled();
    disabled.unmount();
    harness.org = 'org-a';
    renderHook(() => useFxRates('2026-10-09'), { wrapper });
    await waitFor(() => expect(harness.list).toHaveBeenCalledWith('2026-10-09'));
    expect(
      client.getQueryCache().find({ queryKey: fxKeys.page('org-a', '2026-10-09') }),
    ).toBeDefined();
  });

  it('coalesces identical org/pair/date lookups without an amount key', async () => {
    const { wrapper } = setup();
    const first = renderHook(() => useFxRate('USD', 'IDR', '2026-10-09'), { wrapper });
    const second = renderHook(() => useFxRate('USD', 'IDR', '2026-10-09'), { wrapper });
    await waitFor(() => {
      expect(harness.onDate).toHaveBeenCalledTimes(1);
      expect(first.result.current.data).toBeNull();
      expect(second.result.current.data).toBeNull();
    });
  });

  it('issues one onDate request for each unique same-org/pair/date query key', async () => {
    const { wrapper } = setup();
    renderHook(() => useFxRate('USD', 'IDR', '2026-10-09'), { wrapper });
    renderHook(() => useFxRate('USD', 'IDR', '2026-10-09'), { wrapper });
    renderHook(() => useFxRate('USD', 'IDR', '2026-10-10'), { wrapper });
    await waitFor(() => expect(harness.onDate).toHaveBeenCalledTimes(2));
    expect(harness.onDate.mock.calls).toEqual([
      ['USD', 'IDR', '2026-10-09'],
      ['USD', 'IDR', '2026-10-10'],
    ]);
  });

  it('AC-FX-012 shares one latest-date request across twenty outstanding equivalents', async () => {
    const { wrapper } = setup();
    harness.onDate.mockResolvedValue({ rate: 16300, rate_date: '2026-10-12' });
    const { container } = render(
      <div>
        {Array.from({ length: 20 }, (_, index) => (
          <FxEquivalent key={index} amount={25} currency="USD" date="latest" />
        ))}
      </div>,
      { wrapper },
    );
    await waitFor(() => expect(harness.onDate).toHaveBeenCalledTimes(1));
    expect(harness.onDate).toHaveBeenCalledWith('USD', 'IDR', '2026-10-12');
    await waitFor(() =>
      expect(container.textContent?.match(/JISDOR 2026-10-12/g)).toHaveLength(20),
    );
  });

  it('does not share lookups across org or date keys', async () => {
    const { client, wrapper } = setup();
    renderHook(() => useFxRate('USD', 'IDR', '2026-10-09'), { wrapper });
    await waitFor(() => expect(harness.onDate).toHaveBeenCalledTimes(1));
    harness.org = 'org-b';
    renderHook(() => useFxRate('USD', 'IDR', '2026-10-10'), { wrapper });
    await waitFor(() => expect(harness.onDate).toHaveBeenCalledTimes(2));
    expect(
      client.getQueryCache().find({ queryKey: fxKeys.onDate('org-a', 'USD', 'IDR', '2026-10-09') }),
    ).toBeDefined();
    expect(
      client.getQueryCache().find({ queryKey: fxKeys.onDate('org-b', 'USD', 'IDR', '2026-10-10') }),
    ).toBeDefined();
  });

  it('invalidates the org root only after a successful upsert', async () => {
    const { client, wrapper } = setup();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useFxRateMutations(), { wrapper });
    harness.upsert.mockRejectedValueOnce(new Error('failed'));
    await expect(
      result.current.upsert.mutateAsync([{ rate_date: '2026-10-09', rate: 16234 }]),
    ).rejects.toThrow('failed');
    expect(invalidate).not.toHaveBeenCalled();
    harness.upsert.mockResolvedValueOnce({ new: 1, changed: 0, unchanged: 0 });
    await result.current.upsert.mutateAsync([{ rate_date: '2026-10-09', rate: 16234 }]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: fxKeys.root('org-a') });
  });
});
