/**
 * AC-W2-5-01: Budget add-line Description + Amount inputs have accessible names.
 * AC-W2-5-02: New budget-version name input has an accessible name.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

// ---------------------------------------------------------------------------
// Mocks (mirror ProjectBudget.test.tsx pattern)
// ---------------------------------------------------------------------------
const budgetState = {
  data: undefined as number | undefined,
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

vi.mock('@/src/hooks/useBudget', () => ({
  useProjectBudget: () => budgetState,
  useBudgetVersions: () => versionsState,
  useBudgetActivationMode: () => ({ data: undefined, isPending: false, isError: false }),
  useBudgetActivationPrecheck: () => ({ data: undefined, isPending: false, isFetching: false, isError: false, refetch: vi.fn() }),
  useBudgetArchiveTargets: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn().mockResolvedValue({ data: [] }) }),
  useBudgetMutations: () => ({
    createVersion: { mutateAsync: vi.fn().mockResolvedValue({ id: 'v-new' }), isPending: false },
    cloneVersion: { mutateAsync: vi.fn(), isPending: false },
    activate: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    archive: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    deleteDraft: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    createLineItem: { mutateAsync: vi.fn().mockResolvedValue({ id: 'li-new' }), isPending: false },
    updateLineItem: { mutateAsync: vi.fn(), isPending: false },
    deleteLineItem: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
  }),
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useProcurements', () => ({ useProjectProcurements: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock('../project-detail/useProjectPosition', () => ({ useBudgetPosition: () => ({ isPending: false, isError: false, refetch: vi.fn(), hasBudget: true, canSeeActual: true, rows: [], unknown: 0 }) }));
vi.mock('../project-detail/budget/BudgetSummary', () => ({ default: () => null }));
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

const draftVersion = {
  id: 'v-draft',
  status: 'Draft' as const,
  name: 'Draft v1',
  version: 1,
  project_id: 'p-1',
  org_id: 'org-1',
  currency: 'USD',
  created_at: '2026-01-01T00:00:00Z',
  line_items: [],
  total: 0,
};

const renderPage = () =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <ProjectBudget projectId="p-1" project={{ id: 'p-1', currency: 'USD', tax_treatment: 'exclusive' } as unknown as ProjectWithRefs} />
      </ToastProvider>
    </MemoryRouter>
  );

beforeEach(() => {
  versionsState.data = [draftVersion];
  versionsState.isPending = false;
});

describe('ProjectBudget accessible names (W2-5)', () => {
  it('AC-W2-5-01: add-line Description and Amount inputs have accessible names via aria-label', async () => {
    const user = userEvent.setup();
    renderPage();

    // Open the draft editor from the "Draft waiting for approval" banner, then the "Add line item" row
    await user.click(await screen.findByRole('button', { name: 'Edit draft' }));
    const addBtn = await screen.findByRole('button', { name: /add line item/i });
    await user.click(addBtn);

    // Both inputs must have accessible names (getByLabelText covers aria-label)
    expect(screen.getByLabelText('Line item description')).toBeInTheDocument();
    expect(screen.getByLabelText('Line item amount')).toBeInTheDocument();
  });

  it('AC-W2-5-02: Create budget opens a labelled version-name field', async () => {
    const user = userEvent.setup();
    versionsState.data = [];
    renderPage();

    const createBtn = await screen.findByRole('button', { name: 'Create budget' });
    await user.click(createBtn);

    expect(screen.getByLabelText('Version name')).toBeInTheDocument();
  });
});
