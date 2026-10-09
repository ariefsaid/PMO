import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import React from 'react';

const { currentUser, getVatEditability } = vi.hoisted(() => ({
  currentUser: { org_id: 'org-1' as string | undefined },
  getVatEditability: vi.fn(),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser }) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { project: { getVatEditability } } }));
import { useProjectVatEditability } from './useProjectVatEditability';

describe('useProjectVatEditability', () => {
  it('AC-PPNC-013 uses tenant+project scoped cache identity and reads eligibility', async () => {
    const result = { eligible: false, reason: 'vat-command-pending' as const, hasInvoices: true };
    getVatEditability.mockResolvedValueOnce(result);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result: hook } = renderHook(() => useProjectVatEditability('project-1'), { wrapper });
    await waitFor(() => expect(hook.current.data).toEqual(result));
    expect(hook.current.dataUpdatedAt).toBeGreaterThan(0);
    expect(getVatEditability).toHaveBeenCalledWith('project-1');
    expect(client.getQueryCache().find({ queryKey: ['project-vat-editability', 'org-1', 'project-1'] })).toBeDefined();
  });

  it('does not query until both organization and project identity are known', () => {
    currentUser.org_id = undefined;
    const client = new QueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useProjectVatEditability('project-1'), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(getVatEditability).not.toHaveBeenCalled();
    currentUser.org_id = 'org-1';
  });
});
