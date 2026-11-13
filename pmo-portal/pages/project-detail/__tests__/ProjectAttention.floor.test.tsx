import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { renderWithQueryClient } from '@/test/renderWithQueryClient';
import { setActiveLocale } from '@/src/lib/locale/activeLocale';

import type { ProjectWithRefs } from '@/src/lib/db/projects';

// Same mock set as ProjectPosition.test.tsx (the overview harness) — the attention
// rows come from the real useProjectAttention hook, only its data reads are mocked.
const state = vi.hoisted(() => ({
  role: 'Project Manager',
  realRole: 'Project Manager',
  orgDay: '2026-10-27',
  versions: [] as unknown[],
  finances: null as unknown,
  financePending: false,
  invoices: [] as unknown[],
  milestones: [] as unknown[],
  procurements: [] as unknown[],
  tasks: [] as unknown[],
}));

vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (action: string, entity: string) => {
    if (entity === 'salesInvoice' && action === 'view') return state.role !== 'Engineer';
    if (entity === 'salesInvoice' && action === 'create') return ['Admin', 'Executive', 'Finance'].includes(state.role);
    if (entity === 'procurement' && action === 'transition') return state.role !== 'Engineer';
    return true;
  },
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'viewer-1', org_id: 'org-1' }, role: state.role }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: state.role, realRole: state.realRole }),
}));
vi.mock('@/src/hooks/useBudget', () => ({
  useBudgetVersions: () => ({ data: state.versions, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProjectFinances', () => ({
  useProjectFinances: () => ({ data: state.finances, isPending: state.financePending, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoices: () => ({ data: state.invoices, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useFxOrgDay', () => ({
  useFxOrgDay: () => ({ day: state.orgDay, isPending: false, isError: false, retry: vi.fn() }),
}));
vi.mock('@/src/hooks/useMilestones', () => ({
  useMilestones: () => ({ data: state.milestones, isPending: false, isError: false, refetch: vi.fn() }),
  useMilestoneMutations: () => ({ create: { mutateAsync: vi.fn() }, update: { mutateAsync: vi.fn() }, remove: { mutateAsync: vi.fn() } }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProjectProcurements: () => ({ data: state.procurements, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useTasks', () => ({ useTasks: () => ({ data: state.tasks, isPending: false, isError: false, refetch: vi.fn() }) }));

import { useProjectAttention } from '@/src/hooks/useProjectPosition';
import { ProjectAttention } from '../ProjectAttention';

const project = {
  id: 'p1', status: 'Ongoing Project', currency: 'USD', contract_value: 1_000,
  contract_date: '2026-10-10', tax_treatment: null,
} as ProjectWithRefs;

const DestProbe = ({ label }: { label: string }) => {
  const LocationProbe = () => <output data-testid={label}>{useLocation().pathname + useLocation().search}</output>;
  return <LocationProbe />;
};

/** Renders the real attention list for the PM lens with a destination probe per row target. */
const renderAttention = () => {
  const { result } = renderHook(() => useProjectAttention(project, 'pm'));
  return renderWithQueryClient(
    <MemoryRouter initialEntries={['/projects/p1/overview']}>
      <Routes>
        <Route path="/projects/p1/overview" element={<ProjectAttention items={result.current.items} />} />
        <Route path="/projects/p1/budget" element={<DestProbe label="dest-budget" />} />
        <Route path="/finance/receivables" element={<DestProbe label="dest-receivables" />} />
        <Route path="/projects/p1/tasks" element={<DestProbe label="dest-tasks" />} />
        <Route path="/projects/p1/procurement" element={<DestProbe label="dest-procurement" />} />
      </Routes>
    </MemoryRouter>,
  );
};

/** Every attention state present at once: over budget, overdue invoice, late phase, waiting approval. */
const seedAllAttentionStates = () => {
  state.versions = [{ id: 'bv1', status: 'Active', line_items: [{ category: 'Labor', budgeted_amount: '100' }] }];
  state.finances = { actuals: { currency: 'USD', categories: [{ category: 'Labor', mapped: true, amount: '130' }] } };
  state.invoices = [{ id: 'inv-1', status: 'Submitted', invoice_date: '2026-10-01', erp_due_date: '2026-10-20', erp_payment_terms_days: 30, erp_outstanding_amount: 40, grand_total: '9999' }];
  state.milestones = [{ id: 'm1', name: 'Design', target_date: '2026-10-25', effective_pct: 40, task_count: 2 }];
  state.procurements = [{
    id: 'req-1', status: 'Requested', requested_by_id: 'another-user',
    approvalRoute: { route: 'flat', approvers: [] },
  }];
};

beforeEach(() => {
  setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
  state.role = 'Project Manager';
  state.realRole = 'Project Manager';
  state.orgDay = '2026-10-27';
  state.versions = [];
  state.finances = null;
  state.financePending = false;
  state.invoices = [];
  state.milestones = [];
  state.procurements = [];
  state.tasks = [];
});

describe('ProjectAttention floor', () => {
  it('floor: Review budget attention row opens the Budget tab', async () => {
    seedAllAttentionStates();
    renderAttention();
    await userEvent.click(screen.getByRole('link', { name: /Project over budget/ }));
    expect(screen.getByTestId('dest-budget')).toHaveTextContent('/projects/p1/budget');
  });

  it('floor: See invoices attention row opens Receivables filtered to the project', async () => {
    seedAllAttentionStates();
    renderAttention();
    await userEvent.click(screen.getByRole('link', { name: /Customer invoice overdue/ }));
    expect(screen.getByTestId('dest-receivables')).toHaveTextContent('/finance/receivables?project=p1&overdue=true');
  });

  it('floor: See tasks attention row on a late phase opens the project task list', async () => {
    seedAllAttentionStates();
    renderAttention();
    await userEvent.click(screen.getByRole('link', { name: /Design is late/ }));
    expect(screen.getByTestId('dest-tasks')).toHaveTextContent('/projects/p1/tasks');
  });

  it('floor: Review attention row on waiting procurement opens the project procurement list', async () => {
    seedAllAttentionStates();
    renderAttention();
    await userEvent.click(screen.getByRole('link', { name: /Procurement waiting for your approval/ }));
    expect(screen.getByTestId('dest-procurement')).toHaveTextContent('/projects/p1/procurement');
  });
});
