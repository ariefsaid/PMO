import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useFinancePosition } from './useFinancePosition';

const dal = vi.hoisted(() => ({
  listInvoices: vi.fn(),
  listPayments: vi.fn(),
  listProcurements: vi.fn(),
  getOrgDay: vi.fn(),
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-test' }, role: 'Finance' }),
}));

vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => () => true,
}));

vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    revenue: {
      listInvoices: dal.listInvoices,
      listPayments: dal.listPayments,
    },
    procurement: {
      list: dal.listProcurements,
    },
    fxRates: {
      context: vi.fn(async () => ({ timezone: 'Asia/Jakarta', base_currency: 'IDR' })),
    },
  },
}));

vi.mock('@/src/lib/db/fx', () => ({
  getOrganizationDay: dal.getOrgDay,
}));

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('useFinancePosition — deferred and on-demand controls', () => {
  beforeEach(() => {
    dal.listInvoices.mockReset().mockResolvedValue([]);
    dal.listPayments.mockReset().mockResolvedValue([]);
    dal.listProcurements.mockReset().mockResolvedValue([]);
    dal.getOrgDay.mockReset().mockResolvedValue({ day: '2026-11-04', base_currency: 'IDR' });
  });

  it('respects enabled: false and fires NO DAL queries', async () => {
    const { result } = renderHook(() => useFinancePosition({ enabled: false }), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(dal.listInvoices).not.toHaveBeenCalled();
    expect(dal.listPayments).not.toHaveBeenCalled();
    expect(dal.listProcurements).not.toHaveBeenCalled();
    expect(result.current.hasLoadedData).toBe(false);
  });

  it('respects deferred: true by scheduling idle work and cancelling on unmount', async () => {
    let cancelledId: number | null = null;
    const originalRequestIdleCallback = window.requestIdleCallback;
    const originalCancelIdleCallback = window.cancelIdleCallback;

    window.requestIdleCallback = vi.fn((_cb: IdleRequestCallback) => {
      return 42 as unknown as number;
    });
    window.cancelIdleCallback = vi.fn((id: number) => {
      cancelledId = id;
    });

    try {
      const { unmount } = renderHook(() => useFinancePosition({ enabled: true, deferred: true }), {
        wrapper: createWrapper(),
      });

      expect(window.requestIdleCallback).toHaveBeenCalled();
      expect(dal.listInvoices).not.toHaveBeenCalled();

      // Unmount before idle callback fires
      unmount();

      expect(window.cancelIdleCallback).toHaveBeenCalledWith(42);
      expect(cancelledId).toBe(42);
      expect(dal.listInvoices).not.toHaveBeenCalled();
    } finally {
      window.requestIdleCallback = originalRequestIdleCallback;
      window.cancelIdleCallback = originalCancelIdleCallback;
    }
  });

  it('reports hasLoadedData: true once queries succeed', async () => {
    const { result } = renderHook(() => useFinancePosition(true), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(dal.listInvoices).toHaveBeenCalled();
    expect(result.current.hasLoadedData).toBe(true);
    expect(result.current.isPending).toBe(false);
  });
});
