import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
}));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => procState, useProjectProcurements: () => procState }));
vi.mock('@/src/hooks/useProjects', () => ({ useProject: () => ({ data: null }) }));
vi.mock('@/src/hooks/useProcurementDetail', () => ({ useProcurementDetail: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useProjectPosition', () => ({ useBudgetPosition: () => ({ rows: [], hasBudget: false, isPending: false, actualsPending: false }) }));
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
    expect(within(requestedRow).getByText('Requested')).toBeInTheDocument();
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

  it('the phone Filters control opens category and owner filters that narrow the list', async () => {
    procState.data = [
      { ...row('a', 'Requested'), title: 'Materials request', budget_category: 'Materials', requested_by_id: 'u-a', requested_by: { full_name: 'Alice' } },
      { ...row('b', 'Ordered'), title: 'Travel order', budget_category: 'Travel', requested_by_id: 'u-b', requested_by: { full_name: 'Bob' } },
    ];
    renderBlock();

    const filters = screen.getByRole('button', { name: 'Filters' });
    expect(filters).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(filters);
    expect(filters).toHaveAttribute('aria-expanded', 'true');

    const category = screen.getByLabelText('Filter by category');
    await userEvent.selectOptions(category, 'Travel');
    expect(screen.getByRole('button', { name: 'Open Travel order' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Materials request' })).not.toBeInTheDocument();
    await userEvent.selectOptions(category, '');

    const owner = screen.getByLabelText('Filter by owner');
    await userEvent.selectOptions(owner, 'u-a');
    expect(screen.getByRole('button', { name: 'Open Materials request' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Travel order' })).not.toBeInTheDocument();
  });

  it('the selection bar selects visible rows and clears individual or all selections', async () => {
    procState.data = [row('a', 'Requested'), row('b', 'Ordered')];
    renderBlock();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Row a' }));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select visible' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Return' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Select visible' }));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear visible' }));
    expect(screen.queryByText('2 selected')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Row a' }));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByText('1 selected')).not.toBeInTheDocument();
  });

});
