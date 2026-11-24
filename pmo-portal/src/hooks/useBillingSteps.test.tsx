import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const h = vi.hoisted(() => ({ setEvidence: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/src/hooks/useOrgId', () => ({ useOrgId: () => 'org-1' }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { billingStages: { setWorkOrderStepClaimEvidence: h.setEvidence } } }));

import { useWorkOrderStepMutations } from './useBillingSteps';

describe('work-order evidence designation', () => {
  it('saves the designation and refreshes the work-order and waiting lists', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useWorkOrderStepMutations(), { wrapper });

    await act(async () => { await result.current.markEvidence.mutateAsync({ stepId: 'step-1', enabled: true }); });

    expect(h.setEvidence).toHaveBeenCalledWith('step-1', true);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['work-order-billing-steps', 'org-1'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['waiting-work-order-steps', 'org-1'] });
  });
});
