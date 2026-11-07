import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { BahasaProvider } from '@/test/bahasa';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

vi.mock('@/src/hooks/useProjectStageEntries', () => ({
  useProjectStageEntries: () => ({ data: [], isLoading: false, error: null }),
  useStageEntryMutations: () => ({ redate: { mutateAsync: vi.fn() }, addSkipped: { mutateAsync: vi.fn() } }),
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/components/ui/useIsDesktop', () => ({ useIsDesktop: () => false }));
vi.mock('@/src/hooks/useDashboard', () => ({ useSalesPipeline: () => ({ data: { stages: [], projects: [] } }) }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: 'Project Manager' }),
}));
vi.mock('@tanstack/react-query', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useQueryClient: () => ({ invalidateQueries: vi.fn() }) };
});
vi.mock('@/src/hooks/useProjectTransitions', () => ({ useProjectWinEligibility: () => ({ data: 'allowed' }) }));

import DealBand from '../../sales/DealBand';

const deal = {
  id: 'd1', name: 'Acme Tender Bid', code: 'OPP-0042', status: 'Tender Submitted', client_id: 'c1',
  project_manager_id: 'u-alice', contract_value: 1200000, currency: 'USD', budget: 0, spent: 0,
  decided_at: null, client: { name: 'Acme' }, pm: { full_name: 'Alice Manager' },
} as unknown as ProjectWithRefs;

describe('DealBand current stage (#1339)', () => {
  it('names the current stage in the viewer\'s language on phones', () => {
    render(
      <BahasaProvider>
        <MemoryRouter>
          <ImpersonationProvider realRole="Project Manager">
            <ToastProvider><DealBand project={deal} /></ToastProvider>
          </ImpersonationProvider>
        </MemoryRouter>
      </BahasaProvider>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Tender diajukan' })).toBeInTheDocument();
  });
});
