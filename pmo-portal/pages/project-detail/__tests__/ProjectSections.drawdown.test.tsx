import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import ProjectSections from '../ProjectSections';
import { FinanceI18nTestProvider } from '../../__tests__/financeI18nTestProvider';

const state = vi.hoisted(() => ({
  drawdown: { committed: 500_000, draft: 100_000, ceiling: 900_000, currency: 'USD', basis: 'net' },
}));

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: 'Finance', effectiveRole: 'Finance', canImpersonate: false, viewAs: vi.fn() }),
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Finance' }) }));
vi.mock('@/src/components/fx/FxEquivalent', () => ({ default: () => null }));
vi.mock('@/src/hooks/useProjectFinances', () => ({
  useProjectFinances: () => ({
    data: {
      project_id: 'p1', contract_invoiced: null, remaining_to_invoice: null, invoices: [], budget: null,
      actuals: { currency: 'USD', as_of: null, total: null, excludes_restricted_rows: false, categories: [] },
      cash_received: { state: 'unavailable', reason: 'not-reported' },
    },
    isPending: false, isError: false, refetch: vi.fn(),
  }),
}));
vi.mock('@/src/hooks/useProgressBilling', () => ({
  useBoqItems: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useProjectBilling: () => ({ data: { contractLines: [], contractNet: 10_000, dpBilled: 0, dpRecovered: 0 }, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useRevenue', () => ({ useSalesInvoices: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useWorkOrders', () => ({
  useProjectDrawdown: () => ({ data: state.drawdown, isPending: false, isError: false, refetch: vi.fn() }),
  useProjectWorkOrders: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({ useWorkOrderBilling: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('../useProjectPosition', () => ({
  useOverdueReceivables: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }),
  useProjectAttention: () => ({ items: [], isPending: false, error: null, myVisibleTaskKeys: new Set() }),
  useBudgetPosition: () => ({ isPending: false, isError: false, hasBudget: true, canSeeActual: true, rows: [], unknown: 0, refetch: vi.fn() }),
}));
vi.mock('../ProjectAttention', () => ({ ProjectAttention: () => <section aria-label="Project attention" /> }));
vi.mock('../ProjectActivity', () => ({
  ActivityFooter: () => null,
  MyOpenTasks: () => null,
  ProjectActivity: () => null,
}));
vi.mock('../ProjectProfitLossSection', () => ({ default: () => null }));
vi.mock('../ProjectSCurve', () => ({ default: () => null }));
vi.mock('../tabs/BillingTab', () => ({ default: () => null }));
vi.mock('../tabs/WorkOrdersTab', () => ({ default: () => null }));
vi.mock('../ProjectBlocks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ProjectBlocks')>();
  return {
    ...actual,
    CostBlock: () => <section aria-label="Project costs" />,
    DeliveryBlock: () => <section aria-label="Project delivery" />,
  };
});

const project = {
  id: 'p1', name: 'Alpha', code: 'A-1', status: 'Ongoing Project', currency: 'USD',
  contract_value: 10_000, project_manager_id: 'u-pm', client_id: null, tax_treatment: 'exclusive',
} as unknown as ProjectWithRefs;

beforeEach(() => {
  state.drawdown = { committed: 500_000, draft: 100_000, ceiling: 900_000, currency: 'USD', basis: 'net' };
});

describe('Project contract drawdown (#566 / OD-CR-13)', () => {
  it('shows the real drawdown figures when the Contract area opens', async () => {
    render(
      <FinanceI18nTestProvider>
        <MemoryRouter>
          <ProjectSections project={project} area="contract" setArea={vi.fn()} isPipeline={false} header={<h1>Alpha</h1>} />
        </MemoryRouter>
      </FinanceI18nTestProvider>,
    );

    const panel = await screen.findByRole('tabpanel', { name: 'Contract & billing' });
    const drawdown = await within(panel).findByTestId('project-drawdown');
    expect(drawdown).toHaveTextContent('$500,000');
    expect(drawdown).toHaveTextContent('$100,000');
    expect(drawdown).toHaveTextContent('$900,000');
    expect(within(panel).queryByRole('button', { name: /Drawdown headroom/i })).not.toBeInTheDocument();
  });
});
