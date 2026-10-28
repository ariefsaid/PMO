import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import { ProcurementBlock } from '@/src/components/procurement/ProcurementBlock';

const row = (id: string, status: string) => ({
  id, code: `PR-${id}`, title: `Row ${id}`, status, total_value: 1_000, approved_total_value: null, currency: 'USD',
  project_id: 'p-1', budget_category: 'Materials', requested_by_id: 'u-2', vendor_id: null,
  created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z', status_events: [],
  project: { name: 'Site', code: 'P1' }, vendor: null, requested_by: { full_name: 'Requester' },
});
const procState = { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() };
const roleState = { role: 'Finance' };

vi.mock('@/src/hooks/useErpPurchaseLinks', () => ({ useLinkErpDocuments: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock('@/src/hooks/useErpPurchases', () => ({
  useErpPurchases: () => ({ data: [], isError: false, refetch: vi.fn() }),
  useErpOrphans: () => ({ data: [], isError: false, refetch: vi.fn() }),
  useHasErpPurchases: () => ({ data: false }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => procState, useProjectProcurements: () => procState }));
vi.mock('@/src/hooks/useProjects', () => ({ useProject: () => ({ data: null }) }));
vi.mock('@/src/hooks/useProcurementDetail', () => ({ useProcurementDetail: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/pages/project-detail/useProjectPosition', () => ({ useBudgetPosition: () => ({ rows: [], hasBudget: false, isPending: false, actualsPending: false }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: roleState.role, effectiveRole: roleState.role }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-1', org_id: 'org-1' }, role: roleState.role }) }));

const renderBlock = (projectId?: string) => render(
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter><ToastProvider><ProcurementBlock projectId={projectId} /></ToastProvider></MemoryRouter>
  </QueryClientProvider>,
);

describe('ProcurementBlock craft rulings', () => {
  beforeEach(() => {
    roleState.role = 'Finance';
    procState.data = [];
  });

  it('N11: an Approved procurement is named Approved, so "Request" keeps one meaning (not yet approved)', () => {
    procState.data = [row('a', 'Approved'), row('b', 'Requested')];
    renderBlock();

    const approvedRow = screen.getByRole('button', { name: 'Open Row a' }).closest('tr') as HTMLElement;
    const requestedRow = screen.getByRole('button', { name: 'Open Row b' }).closest('tr') as HTMLElement;
    expect(within(approvedRow).getByText('Approved')).toBeInTheDocument();
    expect(within(approvedRow).queryByText('Request')).toBeNull();
    expect(within(requestedRow).getByText('Request')).toBeInTheDocument();
  });

  it('N7: an engineer\'s empty project tab says they raised none, with no column headers over the void', () => {
    roleState.role = 'Engineer';
    renderBlock('p-1');

    expect(screen.getByText("You haven't raised a procurement on this project.")).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('N7: other roles keep the plain empty wording', () => {
    renderBlock('p-1');

    expect(screen.getByText('No procurement on this project yet.')).toBeInTheDocument();
  });

  it('O10: a long supplier name wraps instead of being cut to "SunVolt Modules …"', () => {
    procState.data = [{ ...row('a', 'Requested'), code: 'PROC-2026-001', vendor: { name: 'RackMount Systems International' } }];
    renderBlock();

    const identity = screen.getByText('PROC-2026-001').parentElement as HTMLElement;
    expect(identity).toHaveTextContent('PROC-2026-001 · RackMount Systems International');
    expect(identity.className).not.toMatch(/\btruncate\b/);
  });
});
