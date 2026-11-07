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

const baseDeal = {
  id: 'd1', name: 'Acme Tender Bid', code: 'OPP-0042', status: 'Tender Submitted', client_id: 'c1',
  project_manager_id: 'u-alice', contract_value: 1200000, currency: 'USD', budget: 0, spent: 0,
  decided_at: null, client: { name: 'Acme' }, pm: { full_name: 'Alice Manager' },
} as unknown as ProjectWithRefs;

describe('DealBand vocabulary i18n (#2000)', () => {
  it('translates the advance button and stage vocabulary into Indonesian (#2000)', () => {
    render(
      <BahasaProvider>
        <MemoryRouter>
          <ImpersonationProvider realRole="Project Manager">
            <ToastProvider><DealBand project={baseDeal} /></ToastProvider>
          </ImpersonationProvider>
        </MemoryRouter>
      </BahasaProvider>,
    );

    // Advance button label in Indonesian
    expect(screen.getByRole('button', { name: 'Lanjutkan ke Negosiasi' })).toBeInTheDocument();

    // Desktop status pill in Indonesian
    expect(screen.getByText('Tender diajukan')).toBeInTheDocument();

    // Stepper labels in Indonesian
    expect(screen.getByText('Prospek')).toBeInTheDocument();
    expect(screen.getByText('Penawaran')).toBeInTheDocument();
    expect(screen.getByText('Pra-kualifikasi')).toBeInTheDocument();
  });

  it('translates advance button for each pipeline stage', () => {
    const { unmount } = render(
      <BahasaProvider>
        <MemoryRouter>
          <ImpersonationProvider realRole="Project Manager">
            <ToastProvider><DealBand project={{ ...baseDeal, status: 'Leads' } as ProjectWithRefs} /></ToastProvider>
          </ImpersonationProvider>
        </MemoryRouter>
      </BahasaProvider>,
    );
    expect(screen.getByRole('button', { name: 'Lanjutkan ke Penawaran' })).toBeInTheDocument();
    unmount();

    render(
      <BahasaProvider>
        <MemoryRouter>
          <ImpersonationProvider realRole="Project Manager">
            <ToastProvider><DealBand project={{ ...baseDeal, status: 'Quotation Submitted' } as ProjectWithRefs} /></ToastProvider>
          </ImpersonationProvider>
        </MemoryRouter>
      </BahasaProvider>,
    );
    expect(screen.getByRole('button', { name: 'Lanjutkan ke Pra-kualifikasi' })).toBeInTheDocument();
  });

  it('translates won and lost journey steps in Indonesian', () => {
    const { unmount } = render(
      <BahasaProvider>
        <MemoryRouter>
          <ImpersonationProvider realRole="Project Manager">
            <ToastProvider><DealBand project={{ ...baseDeal, status: 'Won, Pending KoM' } as ProjectWithRefs} /></ToastProvider>
          </ImpersonationProvider>
        </MemoryRouter>
      </BahasaProvider>,
    );
    expect(screen.getByText('Menang')).toBeInTheDocument();
    unmount();

    render(
      <BahasaProvider>
        <MemoryRouter>
          <ImpersonationProvider realRole="Project Manager">
            <ToastProvider><DealBand project={{ ...baseDeal, status: 'Loss Tender' } as ProjectWithRefs} /></ToastProvider>
          </ImpersonationProvider>
        </MemoryRouter>
      </BahasaProvider>,
    );
    expect(screen.getAllByText('Kalah').length).toBeGreaterThanOrEqual(1);
  });

  it('keeps English vocabulary in default locale', () => {
    render(
      <MemoryRouter>
        <ImpersonationProvider realRole="Project Manager">
          <ToastProvider><DealBand project={baseDeal} /></ToastProvider>
        </ImpersonationProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Advance to Negotiation' })).toBeInTheDocument();
    expect(screen.getByText('Tender Submitted')).toBeInTheDocument();
  });
});
