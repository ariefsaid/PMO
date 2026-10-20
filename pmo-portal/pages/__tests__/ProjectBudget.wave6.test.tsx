/**
 * AC-W6-J7 — Budget Draft edit-mode table shows a Total footer equal to the sum of budgeted amounts
 * AC-W6-J8 — Budget add-row amount input is type="text" (parseMoneyInput-friendly, no number coercion)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

const renderPage = (projectId = 'p-1') =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <ProjectBudget projectId={projectId} />
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
  it('AC-W6-J7: the Draft edit-mode line-item table shows a Total footer equal to the sum of budgeted amounts', () => {
    versionsState.data = [draftVersionWithItems];
    renderPage();

    const total = screen.getByTestId('budget-edit-total');
    expect(total).toHaveTextContent('$4,700,000');
  });
});

// ---------------------------------------------------------------------------
// AC-W6-IXD-BUDHEAD — drop the redundant <h2>Project Budget</h2>; the "Active
// budget: $X" line is promoted as the section lead. + New version stays.
// ---------------------------------------------------------------------------
describe('AC-W6-IXD-BUDHEAD: Budget tab double-header removed', () => {
  it('AC-W6-IXD-BUDHEAD: does NOT render a "Project Budget" heading, while the Active-budget lead + New version stay', () => {
    versionsState.data = [draftVersionWithItems];
    renderPage();
    // The redundant tab-duplicating heading is gone.
    expect(screen.queryByText('Project Budget')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /Project Budget/i }),
    ).not.toBeInTheDocument();
    // S-04 / DD-MONEY-4: only a Draft exists, so the lead says there is no Active budget (it never
    // presents the Draft or a $0 as the budget).
    expect(screen.getByText(/No active budget/i)).toBeInTheDocument();
    expect(screen.queryByTestId('derived-budget')).not.toBeInTheDocument();
    // The primary action stays (PM canWrite).
    expect(screen.getByRole('button', { name: /\+ New version/i })).toBeInTheDocument();
  });

  it('AC-W6-IXD-BUDHEAD: the empty state also drops the heading; SUB-D: the empty state says it once (no head text)', () => {
    versionsState.data = [];
    renderPage();
    expect(screen.queryByText('Project Budget')).not.toBeInTheDocument();
    expect(screen.queryByText(/No active budget/i)).not.toBeInTheDocument();
    expect(screen.getByText('No budget versions yet')).toBeInTheDocument();
  });

  it('UX-033: the Active amount is announced ONCE when the Active version is open', () => {
    budgetState.data = 4700000;
    versionsState.data = [{ ...draftVersionWithItems, id: 'v-active', status: 'Active' as const, name: 'Budget v1', version: 1 }];
    const { container } = renderPage();
    // one amount in the header; no "Active budget:" lead, no pill/amount repeated in the selector bar
    expect(screen.getByTestId('derived-budget')).toHaveTextContent('$4,700,000');
    expect(screen.queryByText(/Active budget:/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('version-selector')).not.toBeInTheDocument(); // SUB-D: one version, no switcher
    expect(container.querySelectorAll('[data-testid="version-status-active"]')).toHaveLength(1);
  });

  it('UX-033: while a Draft is open, the Active amount stays in view as a reference line', () => {
    budgetState.data = 4700000;
    versionsState.data = [
      { ...draftVersionWithItems, id: 'v-active', status: 'Active' as const, name: 'Budget v1', version: 1 },
      draftVersionWithItems,
    ];
    renderPage();
    fireEvent.change(screen.getByLabelText('Version'), { target: { value: 'v-draft' } });
    expect(screen.getByText(/Active budget:/i)).toBeInTheDocument();
    expect(screen.getByTestId('derived-budget')).toHaveTextContent('$4,700,000');
  });
});

// ---------------------------------------------------------------------------
// AC-W6-J8 — add-row amount input type="text" + inputMode="decimal"
// ---------------------------------------------------------------------------
describe('AC-W6-J8: add-row amount input type=text', () => {
  it('AC-W6-J8: the add-line-item amount input is type="text" (parseMoneyInput-friendly, no number coercion)', async () => {
    versionsState.data = [draftVersionWithItems];
    renderPage();

    // Open the add row
    await userEvent.click(screen.getByRole('button', { name: /\+ Add line item/i }));

    const amount = screen.getByPlaceholderText('Amount');
    expect(amount).toHaveAttribute('type', 'text');
    expect(amount).toHaveAttribute('inputMode', 'decimal');
  });
});
