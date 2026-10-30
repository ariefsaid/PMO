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
const { mutations, archiveState, versionState } = vi.hoisted(() => ({
  versionState: { includeArchived: false },
  archiveState: { data: [] as unknown[], isPending: false, isFetching: false, isError: false, refetch: vi.fn() },
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
    { id: 'li2', budget_version_id: 'bv1', org_id: 'o1', category: 'Equipment', description: 'Second', budgeted_amount: 200, actual_amount: 0 },
  ],
} as unknown as BudgetVersionWithItems;

vi.mock('@/src/hooks/useBudget', () => ({
  useProjectBudget: () => ({ data: 100_000, isPending: false, isError: false, refetch: vi.fn() }),
  useBudgetVersions: () => ({ data: versionState.includeArchived ? [draftVersion, { ...draftVersion, id: 'bv2', status: 'Archived', version: 2 }] : [draftVersion], isPending: false, isError: false, refetch: vi.fn() }),
  useBudgetActivationMode: () => ({ data: undefined, isPending: false, isError: false }),
  useBudgetActivationPrecheck: () => ({ data: undefined, isPending: false, isFetching: false, isError: false, refetch: vi.fn() }),
  useBudgetArchiveTargets: () => archiveState,
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
  versionState.includeArchived = false;
  archiveState.data = [];
  archiveState.isPending = false;
  archiveState.isFetching = false;
  archiveState.isError = false;
  archiveState.refetch.mockReset().mockResolvedValue({ data: [] });
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

describe('draft buffers', () => {
  it('retains simultaneous add and edit values when the editor is closed and reopened', async () => {
    const user = userEvent.setup();
    versionState.includeArchived = true;
    renderPage();
    await openDraftEditor(user);
    await user.click(screen.getByRole('button', { name: /Edit line item Labor/i }));
    await user.clear(screen.getByRole('textbox', { name: 'Description' }));
    await user.type(screen.getByRole('textbox', { name: 'Description' }), 'Edited draft');
    await user.clear(screen.getByRole('textbox', { name: 'Amount' }));
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '1234.56');
    await user.type(screen.getByRole('combobox', { name: 'Fiscal year' }), '2027');
    await user.click(screen.getByRole('button', { name: /\+ Add line item/i }));
    await user.type(screen.getByRole('textbox', { name: 'Line item description' }), 'New draft');
    await user.type(screen.getByRole('textbox', { name: 'Line item amount' }), '234.56');
    await user.type(screen.getByRole('combobox', { name: 'Line item fiscal year' }), '2028');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Version' }), 'bv2');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Version' }), 'bv1');
    await openDraftEditor(user);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await openDraftEditor(user);
    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue('Edited draft');
    expect(screen.getByRole('textbox', { name: 'Line item description' })).toHaveValue('New draft');
    expect(screen.getByRole('textbox', { name: 'Amount' })).toHaveValue('1,234.56');
    expect(screen.getByRole('combobox', { name: 'Fiscal year' })).toHaveValue('2027');
    expect(screen.getByRole('textbox', { name: 'Line item amount' })).toHaveValue('234.56');
    expect(screen.getByRole('combobox', { name: 'Line item fiscal year' })).toHaveValue('2028');
  });
});


it('shows an unknown archive status and retries a failed lookup', async () => {
  const user = userEvent.setup();
  versionState.includeArchived = true;
  archiveState.isPending = true;
  const { rerender } = renderPage();
  expect(screen.getByText(/checking archived budget/i)).toBeInTheDocument();
  archiveState.isPending = false;
  archiveState.isError = true;
  rerender(<MemoryRouter><ToastProvider><ProjectBudget projectId="p1" project={{ id: 'p1', currency: 'USD', tax_treatment: 'exclusive' } as unknown as ProjectWithRefs} /></ToastProvider></MemoryRouter>);
  expect(screen.getByText(/could not check archived budget/i)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /retry archived budget/i }));
  expect(archiveState.refetch).toHaveBeenCalledOnce();
  archiveState.isFetching = true;
  rerender(<MemoryRouter><ToastProvider><ProjectBudget projectId="p1" project={{ id: 'p1', currency: 'USD', tax_treatment: 'exclusive' } as unknown as ProjectWithRefs} /></ToastProvider></MemoryRouter>);
  expect(screen.getByText(/checking archived budget/i)).toBeInTheDocument();
  archiveState.isFetching = false;
  archiveState.isError = false;
  archiveState.data = [{ budget_version_id: 'bv2', erp_cancelled_at: null, erp_docstatus: 1, erp_account: 'Account', fiscal_year: '2026' }];
  rerender(<MemoryRouter><ToastProvider><ProjectBudget projectId="p1" project={{ id: 'p1', currency: 'USD', tax_treatment: 'exclusive' } as unknown as ProjectWithRefs} /></ToastProvider></MemoryRouter>);
  expect(screen.queryByText(/could not check archived budget/i)).not.toBeInTheDocument();
  expect(screen.getByText('budgetArchive.archivedBudgetStillLiveInErp')).toBeInTheDocument();
  archiveState.data = [];
  rerender(<MemoryRouter><ToastProvider><ProjectBudget projectId="p1" project={{ id: 'p1', currency: 'USD', tax_treatment: 'exclusive' } as unknown as ProjectWithRefs} /></ToastProvider></MemoryRouter>);
  expect(screen.queryByText('budgetArchive.archivedBudgetStillLiveInErp')).not.toBeInTheDocument();
});


it('retains an edited row when another row is opened', async () => {
  const user = userEvent.setup();
  renderPage();
  await openDraftEditor(user);
  await user.click(screen.getByRole('button', { name: /Edit line item Labor/i }));
  await user.clear(screen.getByRole('textbox', { name: 'Description' }));
  await user.type(screen.getByRole('textbox', { name: 'Description' }), 'Retained');
  await user.click(screen.getByRole('button', { name: /Edit line item Equipment/i }));
  await user.click(screen.getByRole('button', { name: /Edit line item Labor/i }));
  expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue('Retained');
});

it('discards only the row explicitly cancelled while keeping the add draft', async () => {
  const user = userEvent.setup();
  renderPage();
  await openDraftEditor(user);
  await user.click(screen.getByRole('button', { name: /Edit line item Labor/i }));
  await user.clear(screen.getByRole('textbox', { name: 'Description' }));
  await user.type(screen.getByRole('textbox', { name: 'Description' }), 'Discard me');
  await user.click(screen.getByRole('button', { name: /\+ Add line item/i }));
  await user.type(screen.getByRole('textbox', { name: 'Line item description' }), 'Keep me');
  await user.click(screen.getAllByRole('button', { name: 'Cancel' })[0]);
  await user.click(screen.getByRole('button', { name: /Edit line item Labor/i }));
  expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue('Initial');
  expect(screen.getByRole('textbox', { name: 'Line item description' })).toHaveValue('Keep me');
});

it('keeps another row from replacing an in-flight edit', async () => {
  const user = userEvent.setup();
  mutations.updateLineItem.isPending = true;
  renderPage();
  await openDraftEditor(user);
  await user.click(screen.getByRole('button', { name: /Edit line item Labor/i }));
  expect(screen.getByRole('button', { name: /Edit line item Equipment/i })).toBeDisabled();
});

it('clears an explicitly cancelled new line when adding again', async () => {
  const user = userEvent.setup();
  renderPage();
  await openDraftEditor(user);
  await user.click(screen.getByRole('button', { name: /\+ Add line item/i }));
  await user.type(screen.getByRole('textbox', { name: 'Line item description' }), 'Discarded');
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  await user.click(screen.getByRole('button', { name: /\+ Add line item/i }));
  expect(screen.getByRole('textbox', { name: 'Line item description' })).toHaveValue('');
});

it('uses the same precision rule for new and edited amounts', async () => {
  const user = userEvent.setup();
  renderPage();
  await openDraftEditor(user);
  await user.click(screen.getByRole('button', { name: /Edit line item Labor/i }));
  const editAmount = screen.getByRole('textbox', { name: 'Amount' });
  await user.clear(editAmount);
  await user.type(editAmount, '12.345');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(mutations.updateLineItem.mutateAsync).not.toHaveBeenCalled();
  expect(screen.getByText(/no more than 2 decimal places/i)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /\+ Add line item/i }));
  await user.type(screen.getByRole('textbox', { name: 'Line item amount' }), '34.567');
  const saveButtons = screen.getAllByRole('button', { name: 'Save' });
  await user.click(saveButtons[saveButtons.length - 1]);
  expect(mutations.createLineItem.mutateAsync).not.toHaveBeenCalled();
  expect(screen.getAllByText(/no more than 2 decimal places/i)).toHaveLength(2);
});
