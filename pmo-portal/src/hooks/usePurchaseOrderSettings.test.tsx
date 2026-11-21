import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  usePurchaseOrderSettings,
  usePurchaseOrderSettingsMutations,
  PO_SETTINGS_QUERY_KEY,
} from './usePurchaseOrderSettings';
import { repositories } from '@/src/lib/repositories';

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { org_id: 'org-test-1' } }),
}));

vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    procurement: {
      purchaseOrderSettings: vi.fn(),
      setPurchaseOrderSettings: vi.fn(),
    },
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('usePurchaseOrderSettings hook (#2688)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queries settings from procurement repository', async () => {
    vi.mocked(repositories.procurement.purchaseOrderSettings).mockResolvedValue({
      enabled: true,
      signatureBlocks: ['Sign 1'],
      authorisedCollectors: ['Alice'],
    });

    const { result } = renderHook(() => usePurchaseOrderSettings(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      enabled: true,
      signatureBlocks: ['Sign 1'],
      authorisedCollectors: ['Alice'],
    });
  });

  it('mutates settings and calls repository method', async () => {
    vi.mocked(repositories.procurement.setPurchaseOrderSettings).mockResolvedValue(undefined);

    const { result } = renderHook(() => usePurchaseOrderSettingsMutations(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.setSettings.mutateAsync({
        enabled: true,
        signatureBlocks: ['Prepared by'],
        authorisedCollectors: ['Bob'],
      });
    });

    expect(repositories.procurement.setPurchaseOrderSettings).toHaveBeenCalledWith(
      true,
      ['Prepared by'],
      ['Bob'],
    );
  });
});
