/**
 * B-0.6/B-0.7 — Budget line-item resilience.
 * AC-B-0-6: create/update failure toasts (no silent no-op).
 * AC-B-0-7: Save button disabled/loading while pending (no double-submit).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import { findToastAnnouncement } from '@/src/components/ui/__tests__/toastTestQueries';
import type { BudgetVersionWithItems } from '@/src/lib/db/budgets';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

// ---------------------------------------------------------------------------
// Mutable mock state
// ---------------------------------------------------------------------------
const { mutations } = vi.hoisted(() => ({
  mutations: {
    createLineItem: {
      mutateAsync: vi.fn().mockResolvedValue({ id: 'li-new' }),
      isPending: false,
    },
    updateLineItem: {
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    },
    deleteLineItem: {
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    },
    createVersion: { mutateAsync: vi.fn().mockResolvedValue({ id: 'v-new' }), isPending: false },
    cloneVersion: { mutateAsync: vi.fn(), isPending: false },
    activate: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    archive: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    deleteDraft: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
  },
}));

const draftVersion: BudgetVersionWithItems = {
  id: 'bv1',
  project_id: 'p1',
  org_id: 'o1',
  version: 1,
  name: 'Budget v1',
  status: 'Draft',
  currency: 'USD',
  created_at: '2026-01-01',
  total: 100_000,
  line_items: [
    {
      id: 'li1',
      budget_version_id: 'bv1',
      org_id: 'o1',
      category: 'Labor',
      description: 'Initial',
      budgeted_amount: 100_000,
      actual_amount: 0,
    },
  ],
} as unknown as BudgetVersionWithItems;

vi.mock('@/src/hooks/useBudget', () => ({
  useProjectBudget: () => ({ data: 100_000, isPending: false, isError: false, refetch: vi.fn() }),
  useBudgetVersions: () => ({ data: [draftVersion], isPending: false, isError: false, refetch: vi.fn() }),
  useBudgetActivationMode: () => ({ data: undefined, isPending: false, isError: false }),
  useBudgetActivationPrecheck: () => ({ data: undefined, isPending: false, isFetching: false, isError: false, refetch: vi.fn() }),
  useBudgetArchiveTargets: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn().mockResolvedValue({ data: [] }) }),
  useBudgetMutations: () => mutations,
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

const renderPage = () =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <ProjectBudget projectId="p1" project={{ id: 'p1', currency: 'USD', tax_treatment: 'exclusive' } as unknown as ProjectWithRefs} />
      </ToastProvider>
    </MemoryRouter>,
  );

// The draft line-item editor sits behind "Edit draft" in the draft-waiting banner.
const openDraftEditor = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Edit draft' }));
};

beforeEach(() => {
  mutations.createLineItem.mutateAsync.mockReset().mockResolvedValue({ id: 'li-new' });
  mutations.updateLineItem.mutateAsync.mockReset().mockResolvedValue(undefined);
  mutations.createLineItem.isPending = false;
  mutations.updateLineItem.isPending = false;
});

// ── B-0.6: failure toasts ────────────────────────────────────────────────────

describe('AC-B-0-6: line-item update failure surfaces a warning toast', () => {
  it('AC-B-0-6: update Save failure → warning toast (not silent no-op)', async () => {
    const user = userEvent.setup();
    mutations.updateLineItem.mutateAsync.mockRejectedValue(new Error('Network error'));

    renderPage();
    await openDraftEditor(user);

    // Click Edit on the existing line item
    const editBtn = screen.getByRole('button', { name: /Edit line item Labor/i });
    await user.click(editBtn);

    // Save without changing anything — the Save button should be visible
    const saveBtn = screen.getByRole('button', { name: /^Save$/i });
    await user.click(saveBtn);

    // A warning toast must contain announced text (not just the persistent empty live region).
    expect(await findToastAnnouncement('alert', /.+/)).toBeInTheDocument();
  });
});

describe('AC-B-0-6: line-item create failure surfaces a warning toast', () => {
  it('AC-B-0-6: create Save failure → warning toast (not silent no-op)', async () => {
    const user = userEvent.setup();
    mutations.createLineItem.mutateAsync.mockRejectedValue(new Error('DB constraint'));

    renderPage();
    await openDraftEditor(user);

    // Open Add row
    const addBtn = screen.getByRole('button', { name: /\+ Add line item/i });
    await user.click(addBtn);

    // Fill in amount and save
    const amountInput = screen.getByRole('textbox', { name: /Line item amount/i });
    await user.type(amountInput, '50000');

    const saveBtns = screen.getAllByRole('button', { name: /^Save$/i });
    // The last Save is the Add row's save
    await user.click(saveBtns[saveBtns.length - 1]);

    // A warning toast must contain announced text (not just the persistent empty live region).
    expect(await findToastAnnouncement('alert', /.+/)).toBeInTheDocument();
  });
});

// ── B-0.7: pending-disable guard ────────────────────────────────────────────

describe('AC-B-0-7: Save button disabled while mutation isPending', () => {
  it('AC-B-0-7: update Save button is disabled when updateIsPending=true', async () => {
    const user = userEvent.setup();
    mutations.updateLineItem.isPending = true;

    renderPage();
    await openDraftEditor(user);

    const editBtn = screen.getByRole('button', { name: /Edit line item Labor/i });
    await user.click(editBtn);

    // The Save button must be disabled
    const saveBtn = screen.getByRole('button', { name: /^Save$/i });
    expect(saveBtn).toBeDisabled();
  });

  it('AC-B-0-7: create Save button is disabled when createIsPending=true', async () => {
    const user = userEvent.setup();
    mutations.createLineItem.isPending = true;

    renderPage();
    await openDraftEditor(user);

    const addBtn = screen.getByRole('button', { name: /\+ Add line item/i });
    await user.click(addBtn);

    // The add-row Save buttons — the last one is the Add form's save
    const saveBtns = screen.getAllByRole('button', { name: /^Save$/i });
    // All Save buttons in the add row should be disabled
    const lastSave = saveBtns[saveBtns.length - 1];
    expect(lastSave).toBeDisabled();
  });
});
