/**
 * AC-W6-J7 — Budget Draft edit-mode table shows a Total footer equal to the sum of budgeted amounts
 * AC-W6-J8 — Budget add-row amount input is type="text" (parseMoneyInput-friendly, no number coercion)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
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
