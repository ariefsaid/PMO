/**
 * AC-W6-J7 — Budget Draft edit-mode table shows a Total footer equal to the sum of budgeted amounts
 * AC-W6-J8 — Budget add-row amount input is type="text" (parseMoneyInput-friendly, no number coercion)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';

// ---------------------------------------------------------------------------
// Mock state (same pattern as ProjectBudget.wave5c4.test.tsx)
// ---------------------------------------------------------------------------
const budgetState = {
  data: 0 as number | undefined,
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};
const versionsState = {
  data: undefined as unknown[] | undefined,
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};

const mockClone = vi.fn();
const mockUpdateLineItem = vi.fn();
const mockDeleteLineItem = vi.fn();
const mockCreateLineItem = vi.fn().mockResolvedValue({ id: 'li-new' });
const mockActivate = vi.fn().mockResolvedValue(undefined);
const mockArchive = vi.fn().mockResolvedValue(undefined);
const mockDeleteDraft = vi.fn().mockResolvedValue(undefined);
const mockCreateVersion = vi.fn().mockResolvedValue({ id: 'v-new' });

vi.mock('@/src/hooks/useBudget', () => ({
  useProjectBudget: () => budgetState,
  useBudgetVersions: () => versionsState,
  useBudgetActivationMode: () => ({ data: undefined, isPending: false, isError: false }),
  useBudgetActivationPrecheck: () => ({ data: undefined, isPending: false, isFetching: false, isError: false, refetch: vi.fn() }),
  useBudgetArchiveTargets: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn().mockResolvedValue({ data: [] }) }),
  useBudgetMutations: () => ({
    createVersion: { mutateAsync: mockCreateVersion, isPending: false },
    cloneVersion: { mutateAsync: mockClone, isPending: false },
    activate: { mutateAsync: mockActivate, isPending: false },
    archive: { mutateAsync: mockArchive, isPending: false },
    deleteDraft: { mutateAsync: mockDeleteDraft, isPending: false },
    createLineItem: { mutateAsync: mockCreateLineItem, isPending: false },
    updateLineItem: { mutateAsync: mockUpdateLineItem, isPending: false },
    deleteLineItem: { mutateAsync: mockDeleteLineItem, isPending: false },
  }),
}));

vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useProcurements', () => ({ useProjectProcurements: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock('../project-detail/useProjectPosition', () => ({ useBudgetPosition: () => ({ isPending: false, isError: false, refetch: vi.fn(), hasBudget: true, canSeeActual: true, rows: [], unknown: 0 }) }));
vi.mock('../project-detail/budget/BudgetErpNotice', () => ({ default: () => null }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }), useQuery: () => ({ data: undefined, isPending: false, isError: false }) }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Project Manager' }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({
    effectiveRole: 'Project Manager',
    realRole: 'Project Manager',
    canImpersonate: false,
    viewAs: vi.fn(),
  }),
}));

import ProjectBudget from '../ProjectBudget';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

const renderPage = (projectId = 'p-1') =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <ProjectBudget projectId={projectId} project={{ id: projectId, currency: 'USD', tax_treatment: 'exclusive' } as unknown as ProjectWithRefs} />
      </ToastProvider>
    </MemoryRouter>
  );

// ---------------------------------------------------------------------------
// Fixtures — mirror seed.sql P001 line items (Labor 2,000,000 + Materials 1,700,000 + Contingency 1,000,000)
// so the asserted total ($4,700,000) is concrete and matches the seed.
// formatCurrency(4700000) === '$4,700,000' (Intl.NumberFormat en-US, 0 fraction digits — confirmed).
// ---------------------------------------------------------------------------
const draftVersionWithItems = {
  id: 'v-draft',
  status: 'Draft' as const,
  name: 'Draft v2',
  version: 2,
  project_id: 'p-1',
  org_id: 'org-1',
  currency: 'USD',
  created_at: '2026-01-01T00:00:00Z',
  line_items: [
    {
      id: 'li-1',
      budget_version_id: 'v-draft',
      category: 'Labor',
      description: 'Project team',
      budgeted_amount: 2000000,
      actual_amount: 1200000,
      org_id: 'org-1',
    },
    {
      id: 'li-2',
      budget_version_id: 'v-draft',
      category: 'Materials',
      description: 'Fit-out materials',
      budgeted_amount: 1700000,
      actual_amount: 900000,
      org_id: 'org-1',
    },
    {
      id: 'li-3',
      budget_version_id: 'v-draft',
      category: 'Contingency',
      description: 'Reserve',
      budgeted_amount: 1000000,
      actual_amount: 0,
      org_id: 'org-1',
    },
  ],
  total: 4700000,
};

function resetState() {
  budgetState.data = 0;
  budgetState.isPending = false;
  budgetState.isError = false;
  versionsState.data = undefined;
  versionsState.isPending = false;
  versionsState.isError = false;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetState();
  mockUpdateLineItem.mockResolvedValue(undefined);
  mockDeleteLineItem.mockResolvedValue(undefined);
  mockClone.mockResolvedValue('v-new-draft');
});

// ---------------------------------------------------------------------------
// AC-W6-J7 — Total footer in edit mode
// ---------------------------------------------------------------------------
describe('AC-W6-J7: Draft edit-mode Total footer', () => {
  it('AC-W6-J7: the Draft edit-mode line-item table shows a Total footer equal to the sum of budgeted amounts', async () => {
    versionsState.data = [draftVersionWithItems];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Edit draft' }));

    const total = screen.getByTestId('budget-edit-total');
    expect(total).toHaveTextContent('$4,700,000');
  });
});

// The budget heading and table answer the owner’s core budget question without the old forecast panel.
describe('AC-W6-IXD-BUDHEAD: project budget lead', () => {
  it('shows currency and tax basis once above the category table and omits forecast surfaces', () => {
    versionsState.data = [{ ...draftVersionWithItems, id: 'v-active', status: 'Active' as const, name: 'Budget v1', version: 1 }];
    renderPage();

    expect(screen.getByRole('heading', { name: 'Project budget' })).toBeInTheDocument();
    expect(screen.getAllByText(/^USD ·/)).toHaveLength(1);
    expect(screen.getAllByTestId('tax-basis')).toHaveLength(1);
    expect(screen.getByRole('table', { name: 'Budget vs actual by category' })).toBeInTheDocument();
    expect(screen.queryByText(/forecast|cost-to-finish/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/fiscal year picker/i)).not.toBeInTheDocument();
  });

  it('offers Create budget when there are no versions', () => {
    versionsState.data = [];
    renderPage();
    expect(screen.getByRole('button', { name: 'Create budget' })).toBeInTheDocument();
    expect(screen.getByText('No budget versions yet')).toBeInTheDocument();
  });

  it('shows the active line sum in the table total row instead of a card total', () => {
    versionsState.data = [{ ...draftVersionWithItems, id: 'v-active', status: 'Active' as const, name: 'Budget v1', version: 1 }];
    renderPage();
    const table = screen.getByRole('table', { name: 'Budget vs actual by category' });
    // C6: bare number under the one "USD · …" page heading.
    expect(within(table).getByText('4,700,000')).toBeInTheDocument();
    expect(screen.queryByTestId('derived-budget')).not.toBeInTheDocument();
  });
});

// AC-W6-J8 — add-row amount input type="text" + inputMode="decimal"
// ---------------------------------------------------------------------------
describe('AC-W6-J8: add-row amount input type=text', () => {
  it('AC-W6-J8: the add-line-item amount input is type="text" (parseMoneyInput-friendly, no number coercion)', async () => {
    versionsState.data = [draftVersionWithItems];
    renderPage();

    // Open the draft editor from the banner, then the add row
    await userEvent.click(screen.getByRole('button', { name: 'Edit draft' }));
    await userEvent.click(screen.getByRole('button', { name: /\+ Add line item/i }));

    const amount = screen.getByPlaceholderText('Amount');
    expect(amount).toHaveAttribute('type', 'text');
    expect(amount).toHaveAttribute('inputMode', 'decimal');
  });
});
