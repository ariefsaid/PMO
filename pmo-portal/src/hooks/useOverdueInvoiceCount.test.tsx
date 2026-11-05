import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  countOverdueInvoices: vi.fn(),
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { org_id: 'org-1' } }),
}));
vi.mock('@/src/hooks/useFxOrgDay', () => ({
  useFxOrgDay: () => ({ day: '2026-11-05', isPending: false, isError: false, retry: vi.fn() }),
}));
vi.mock('@/src/lib/repositories', () => ({
  repositories: { revenue: { countOverdueInvoices: h.countOverdueInvoices } },
}));

import { useOverdueInvoiceCount } from './useOverdueInvoiceCount';

describe('useOverdueInvoiceCount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shares a short-lived count query instead of mounting finance tables', async () => {
    h.countOverdueInvoices.mockResolvedValue(3);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useOverdueInvoiceCount(), { wrapper });
    await waitFor(() => expect(result.current.data).toBe(3));

    expect(h.countOverdueInvoices).toHaveBeenCalledTimes(1);
    expect(h.countOverdueInvoices).toHaveBeenCalledWith('2026-11-05');
    const query = client.getQueryCache().find({ queryKey: ['overdue-invoice-count', 'org-1', '2026-11-05'] });
    const options = query?.options as { staleTime?: number; refetchOnWindowFocus?: boolean } | undefined;
    expect(options?.staleTime).toBe(10_000);
    expect(options?.refetchOnWindowFocus).toBe(false);
  });
});
