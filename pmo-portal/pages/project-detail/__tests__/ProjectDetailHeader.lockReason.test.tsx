import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import { toast as sonnerToast } from 'sonner';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
import ProjectDetailHeader from '../ProjectDetailHeader';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

/**
 * ux/1110 restore (AC-IXD-PROJ-001 / UIP-006, coordinator option C): the contract-value lock is a
 * QUIET icon button beside the value — the redesign removed the pill's visible words on purpose,
 * but the WHY must not be lost. The button's accessible name is "Read-only" (aria-label, no text
 * node), it carries aria-controls pointing at the reason, and activating it reveals the
 * segregation-of-duties note (`contract-value-lock-reason`), worded as origin/dev had it.
 */

afterEach(() => {
  act(() => { sonnerToast.dismiss(); });
});

vi.mock('@/src/components/fx/FxEquivalent', () => ({
  default: () => <span data-testid="fx-equivalent" />,
}));

const { roleBox, desktopBox, projectMutations } = vi.hoisted(() => ({
  roleBox: { value: 'Project Manager' },
  desktopBox: { value: true },
  projectMutations: {
    create: { mutateAsync: vi.fn(), isPending: false },
    updateHeader: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    setContractValue: { mutateAsync: vi.fn(), isPending: false },
  },
}));
vi.mock('@/src/components/ui/useIsDesktop', () => ({ useIsDesktop: () => desktopBox.value }));
const { budgetBox } = vi.hoisted(() => ({ budgetBox: { data: 4_200_000 as number | undefined, isPending: false, isError: false } }));
const { financeBox } = vi.hoisted(() => ({
  financeBox: {
    isPending: false,
    data: {
      actuals: {
        currency: 'USD', total: '1800000.00', excludes_restricted_rows: false,
        categories: [{ category: 'Labor', mapped: true, amount: '1800000.00' as string | null }],
      },
    },
  },
}));
vi.mock('@/src/hooks/useProjectFinances', () => ({ useProjectFinances: () => ({ ...financeBox, isError: false }) }));
vi.mock('@/src/hooks/useBudget', () => ({ useProjectBudget: () => budgetBox }));
vi.mock('@/src/hooks/useProjectBudgetPositions', () => ({
  useProjectBudgetPositions: () => ({ data: {}, isPending: false, isError: false, fetchStatus: 'idle', refetch: vi.fn() }),
}));
const { vatBox } = vi.hoisted(() => ({ vatBox: { data: { eligible: true, reason: null as string | null, hasInvoices: false }, isPending: false, isFetching: false, isError: false, refetch: vi.fn() } }));
vi.mock('@/src/hooks/useProjectVatEditability', () => ({ useProjectVatEditability: () => vatBox }));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjectMutations: () => projectMutations,
  useClientCompanies: () => ({ data: [{ id: 'c2', name: 'Innovate Corp', type: 'Client' }] }),
  useProjectManagers: () => ({ data: [{ id: 'u-alice', full_name: 'Alice Manager' }] }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: roleBox.value }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: roleBox.value, realRole: roleBox.value, canImpersonate: false, viewAs: vi.fn() }),
}));

const onHand = {
  id: 'p1',
  name: 'Innovate Corp HQ Fit-Out',
  code: 'CLIENT-81',
  pmo_project_number: 'PMO-26-7711',
  status: 'Ongoing Project',
  client_id: 'c2',
  project_manager_id: 'u-alice',
  tax_treatment: 'exclusive',
  tax_amount: 550000,
  contract_value: 5000000,
  currency: 'USD',
  budget: 4700000,
  spent: 2100000,
  start_date: '2026-01-01',
  end_date: '2026-12-18',
  contract_date: '2026-01-10',
  customer_contract_ref: 'CPO-2026-001',
  client: { name: 'Innovate Corp' },
  pm: { full_name: 'Alice Manager' },
} as unknown as ProjectWithRefs;

const preWin = { ...onHand, status: 'Leads', customer_contract_ref: null } as ProjectWithRefs;

const renderHeader = (role = 'Project Manager', project: ProjectWithRefs = onHand) => {
  roleBox.value = role;
  return render(
    <MemoryRouter>
      <ToastProvider>
        <ProjectDetailHeader project={project} committedSpend={2_100_000} commitmentSource="not-tracked" ledgerBasis="erp" />
      </ToastProvider>
    </MemoryRouter>,
  );
};

beforeEach(() => {
  setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
  roleBox.value = 'Project Manager';
  financeBox.data = { actuals: { currency: 'USD', total: '1800000.00', excludes_restricted_rows: false, categories: [{ category: 'Labor', mapped: true, amount: '1800000.00' }] } };
  vatBox.data = { eligible: true, reason: null, hasInvoices: false };
  vatBox.isPending = false;
  vatBox.isFetching = false;
  vatBox.isError = false;
  vatBox.refetch.mockReset();
  desktopBox.value = true;
  budgetBox.data = 4_200_000;
  budgetBox.isPending = false;
  budgetBox.isError = false;
  Object.values(projectMutations).forEach((m) => {
    m.mutateAsync.mockReset();
    m.mutateAsync.mockResolvedValue(undefined);
    m.isPending = false;
  });
});
afterEach(() => resetActiveLocale());

describe('ProjectDetailHeader — the quiet contract-value lock button (ux/1110 restore, AC-IXD-PROJ-001)', () => {
  it('AC-IXD-PROJ-001/UIP-006: a PM on a won project gets a lock button named Read-only (no visible words) wired to its reason', async () => {
    renderHeader('Project Manager');

    // Icon-only: the accessible name is carried by aria-label; no visible "Read-only" text node.
    expect(screen.queryByText(/Read-only/i)).not.toBeInTheDocument();
    const lock = screen.getByRole('button', { name: /Read-only/i });
    expect(lock).toBeVisible();
    expect(lock).toHaveAttribute('aria-controls', 'contract-value-lock-reason');
    expect(lock).toHaveAttribute('aria-expanded', 'false');
    // the value stays a single read; no edit affordance for this role
    expect(screen.getByTestId('contract-value-amount')).toHaveTextContent('$5,000,000');
    expect(screen.queryByRole('button', { name: /Edit contract value/i })).not.toBeInTheDocument();

    // Activating it (click/Enter) reveals WHY the value cannot be edited — dev's wording.
    await userEvent.click(lock);
    expect(lock).toHaveAttribute('aria-expanded', 'true');
    const reason = screen.getByTestId('contract-value-lock-reason');
    expect(reason).toBeVisible();
    expect(reason).toHaveTextContent(/Once a project is won, the contract value is locked for your role/i);
    expect(reason.parentElement).toHaveAttribute('data-testid', 'contract-value-lock-lane');
  });

  it('Finance (SoD authority) gets the Edit control, never the lock chip', () => {
    renderHeader('Finance');
    expect(screen.getByRole('button', { name: /Edit contract value/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Read-only/i })).not.toBeInTheDocument();
  });

  it('a pre-win deal has no lock control — its value is not locked yet', () => {
    renderHeader('Project Manager', preWin);
    expect(screen.queryByRole('button', { name: /Read-only/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('contract-value-lock-reason')).not.toBeInTheDocument();
  });

  it('the compact (phone/drawer) header carries the same quiet lock button and reason lane', async () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <ProjectDetailHeader project={onHand} compact />
        </ToastProvider>
      </MemoryRouter>,
    );
    expect(screen.queryByText(/Read-only/i)).not.toBeInTheDocument();
    const lock = screen.getByRole('button', { name: /Read-only/i });
    expect(lock).toHaveAttribute('aria-controls', 'contract-value-lock-reason');
    await userEvent.click(lock);
    expect(within(screen.getByTestId('contract-value-lock-lane')).getByTestId('contract-value-lock-reason'))
      .toHaveTextContent(/Once a project is won, the contract value is locked for your role/i);
  });
});
