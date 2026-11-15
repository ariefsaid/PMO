import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const h = vi.hoisted(() => ({ catalogue: vi.fn(), binding: { data: { status: 'active' } as { status: string } | null, isError: false } }));
vi.mock('@/src/lib/repositories/budgetProjection', () => ({ listBudgetPostingAccountCatalogue: h.catalogue }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org1' } }) }));
vi.mock('@/src/hooks/useErpnextBinding', () => ({ useErpnextBinding: () => h.binding }));

import { useAccountCatalogue } from './useAccountCatalogue';

const setup = () => {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { wrapper };
};

describe('useAccountCatalogue', () => {
  beforeEach(() => { h.catalogue.mockReset().mockResolvedValue({ accounts: [] }); h.binding = { data: { status: 'active' }, isError: false }; });

  it('#2114 every Accounting panel shares one catalogue request', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => [useAccountCatalogue(true), useAccountCatalogue(true), useAccountCatalogue(true)], { wrapper });
    await waitFor(() => expect(result.current.every((q) => q.isSuccess)).toBe(true));
    expect(h.catalogue).toHaveBeenCalledTimes(1);
  });

  it('#2114 a caller who cannot manage the setting sends no request', async () => {
    const { wrapper } = setup();
    renderHook(() => useAccountCatalogue(false), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(h.catalogue).not.toHaveBeenCalled();
  });

  it('#2114 an org without an active ERP binding sends no request', async () => {
    h.binding = { data: null, isError: false };
    const { wrapper } = setup();
    renderHook(() => useAccountCatalogue(true), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(h.catalogue).not.toHaveBeenCalled();
  });
});
