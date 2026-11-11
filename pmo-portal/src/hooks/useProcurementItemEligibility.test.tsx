import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
const itemValuesEditable = vi.hoisted(() => vi.fn());
vi.mock('@/src/lib/repositories', () => ({ repositories: { procurement: { itemValuesEditable } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));
import { useProcurementItemEligibility } from './useProcurementItemEligibility';
const Wrapper = ({ children }: { children: React.ReactNode }) => {
  const [client] = React.useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};
describe('procurement item eligibility', () => {
  it('reads the case eligibility from the repository', async () => {
    itemValuesEditable.mockResolvedValueOnce(true);
    const { result } = renderHook(() => useProcurementItemEligibility('case-1', true), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.data).toBe(true));
    expect(itemValuesEditable).toHaveBeenCalledWith('case-1');
  });
  it('keeps failures distinguishable from an allowed result', async () => {
    itemValuesEditable.mockRejectedValueOnce(new Error('unavailable'));
    const { result } = renderHook(() => useProcurementItemEligibility('case-1', true), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).not.toBe(true);
  });
});
