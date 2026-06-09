/**
 * AC-IXD-BUDGET-W5-C4 — Budget IxD: clone auto-opens new draft + inline line-item edit
 *
 * Tests:
 *  1. Clone auto-selects the returned new draft version id
 *  2. Draft line item has an Edit affordance (button, accessible name)
 *  3. Editing category + amount + Save calls updateLineItem with {id, patch}
 *  4. Blank amount is rejected (not coerced to 0, uses parseMoneyInput)
 *  5. Invalid amount (e.g. "1e5x") is rejected
 *  6. Inline edit is absent on Active versions
 *  7. Inline edit is absent on Archived versions
 *  8. Focus moves into the editor when Edit is clicked
 *  9. Cancel closes the editor without calling updateLineItem
 * 10. Save shows a toast on success (routine write, OD-UX-1)
 * 11. Error text is announced via aria-live / role=alert
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '@/src/components/ui';

// ---------------------------------------------------------------------------
// Mutable mock state (same pattern as ProjectBudget.test.tsx)
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
// Fixtures
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
      description: 'Developers',
      budgeted_amount: 200000,
      actual_amount: 0,
      org_id: 'org-1',
    },
  ],
  total: 200000,
};

const activeVersion = {
  id: 'v-active',
  status: 'Active' as const,
  name: 'Version 1',
  version: 1,
  project_id: 'p-1',
  org_id: 'org-1',
  created_at: '2026-01-01T00:00:00Z',
  line_items: [
    {
      id: 'li-active',
      budget_version_id: 'v-active',
      category: 'Materials',
      description: 'Steel',
      budgeted_amount: 500000,
      actual_amount: 0,
      org_id: 'org-1',
    },
  ],
  total: 500000,
};

const archivedVersionWithItems = {
  id: 'v-arch',
  status: 'Archived' as const,
  name: 'Old v0',
  version: 0,
  project_id: 'p-1',
  org_id: 'org-1',
  created_at: '2026-01-01T00:00:00Z',
  line_items: [
    {
      id: 'li-arch',
      budget_version_id: 'v-arch',
      category: 'Equipment',
      description: 'Crane',
      budgeted_amount: 100000,
      actual_amount: 0,
      org_id: 'org-1',
    },
  ],
  total: 100000,
};

// The new draft that cloneVersion returns after cloning
const newDraftVersion = {
  id: 'v-new-draft',
  status: 'Draft' as const,
  name: 'Version 1 (copy)',
  version: 3,
  project_id: 'p-1',
  org_id: 'org-1',
  created_at: '2026-01-01T00:00:00Z',
  line_items: [],
  total: 0,
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
  // Default: clone returns the new draft id
  mockClone.mockResolvedValue('v-new-draft');
});

// ---------------------------------------------------------------------------
// AC-IXD-BUDGET-W5-C4: Clone auto-opens new draft
// ---------------------------------------------------------------------------
describe('AC-IXD-BUDGET-W5-C4: clone-to-revise auto-opens new draft', () => {
  it('after cloning, the returned new draft version id becomes the selected version', async () => {
    budgetState.data = 500000;
    // Start: only active; after clone resolves, new draft appears
    versionsState.data = [activeVersion];

    const { rerender } = renderPage();

    // Verify active is selected initially
    const combobox = screen.getByRole('combobox', { name: /version/i }) as HTMLSelectElement;
    expect(combobox.value).toBe('v-active');

    // Click "Clone to revise" — stages confirm
    await userEvent.click(screen.getByRole('button', { name: /Clone to revise/i }));
    expect(mockClone).not.toHaveBeenCalled();

    // Confirm the clone
    await userEvent.click(screen.getByRole('button', { name: /Clone version/i }));
    expect(mockClone).toHaveBeenCalledWith('v-active');

    // Simulate query invalidation: new draft now exists in versions
    versionsState.data = [activeVersion, newDraftVersion];
    rerender(
      <MemoryRouter>
        <ToastProvider>
          <ProjectBudget projectId="p-1" />
        </ToastProvider>
      </MemoryRouter>
    );

    // The new draft should now be the selected version (auto-selected by returned id)
    await waitFor(() => {
      const cb = screen.getByRole('combobox', { name: /version/i }) as HTMLSelectElement;
      expect(cb.value).toBe('v-new-draft');
    });
  });

  it('clone auto-opens draft: the selected version card shows the new draft', async () => {
    budgetState.data = 500000;
    versionsState.data = [activeVersion];

    const { rerender } = renderPage();

    await userEvent.click(screen.getByRole('button', { name: /Clone to revise/i }));
    await userEvent.click(screen.getByRole('button', { name: /Clone version/i }));

    // After clone + query invalidation → new draft with "Version 1 (copy)" name
    versionsState.data = [activeVersion, newDraftVersion];
    rerender(
      <MemoryRouter>
        <ToastProvider>
          <ProjectBudget projectId="p-1" />
        </ToastProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Version 1 (copy)')).toBeInTheDocument();
    });
  });

  it('clone shows a success toast (routine write — OD-UX-1, no confirm needed)', async () => {
    budgetState.data = 500000;
    versionsState.data = [activeVersion];
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /Clone to revise/i }));
    await userEvent.click(screen.getByRole('button', { name: /Clone version/i }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// AC-IXD-BUDGET-W5-C4: Inline line-item edit in Draft
// ---------------------------------------------------------------------------
describe('AC-IXD-BUDGET-W5-C4: inline line-item edit — Draft', () => {
  it('each Draft line item has an Edit button with an accessible name', () => {
    versionsState.data = [draftVersionWithItems];
    renderPage();

    // "Edit line item Labor" — matches the a11y label pattern
    const editBtn = screen.getByRole('button', { name: /Edit line item Labor/i });
    expect(editBtn).toBeInTheDocument();
  });

  it('Edit button has aria-label including the category name', () => {
    versionsState.data = [draftVersionWithItems];
    renderPage();

    const editBtn = screen.getByRole('button', { name: /Edit line item Labor/i });
    expect(editBtn).toHaveAttribute('aria-label', expect.stringContaining('Labor'));
  });

  it('clicking Edit opens an inline editor (category select + amount input visible)', async () => {
    versionsState.data = [draftVersionWithItems];
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /Edit line item Labor/i }));

    // Category select should be visible
    expect(screen.getByRole('combobox', { name: /category/i })).toBeInTheDocument();
    // Amount input should be visible (text input with aria-label)
    expect(screen.getByRole('textbox', { name: /amount/i })).toBeInTheDocument();
  });

  it('inline editor fields are labelled (a11y)', async () => {
    versionsState.data = [draftVersionWithItems];
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /Edit line item Labor/i }));

    const categoryEl = screen.getByRole('combobox', { name: /category/i });
    expect(categoryEl).toBeInTheDocument();

    const amountEl = screen.getByRole('textbox', { name: /amount/i });
    expect(amountEl).toBeInTheDocument();

    // Save button has accessible name
    const saveBtn = screen.getByRole('button', { name: /^Save$/i });
    expect(saveBtn).toBeInTheDocument();
  });

  it('inline editor pre-populates fields with the current line item values', async () => {
    versionsState.data = [draftVersionWithItems];
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /Edit line item Labor/i }));

    const categoryEl = screen.getByRole('combobox', { name: /category/i }) as HTMLSelectElement;
    expect(categoryEl.value).toBe('Labor');

    const amountEl = screen.getByRole('textbox', { name: /amount/i }) as HTMLInputElement;
    expect(amountEl.value).toBe('200000');
  });

  it('Save calls updateLineItem with the correct {id, patch} when amount changes', async () => {
    versionsState.data = [draftVersionWithItems];
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /Edit line item Labor/i }));

    const amountEl = screen.getByRole('textbox', { name: /amount/i });
    await userEvent.clear(amountEl);
    await userEvent.type(amountEl, '250000');

    await userEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    expect(mockUpdateLineItem).toHaveBeenCalledWith({
      id: 'li-1',
      patch: expect.objectContaining({ budgeted_amount: 250000 }),
    });
  });

  it('Save calls updateLineItem with updated category patch when category changes', async () => {
    versionsState.data = [draftVersionWithItems];
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /Edit line item Labor/i }));

    const categoryEl = screen.getByRole('combobox', { name: /category/i });
    await userEvent.selectOptions(categoryEl, 'Materials');

    await userEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    expect(mockUpdateLineItem).toHaveBeenCalledWith({
      id: 'li-1',
      patch: expect.objectContaining({ category: 'Materials' }),
    });
  });

  it('blank amount is rejected — updateLineItem not called, error message shown', async () => {
    versionsState.data = [draftVersionWithItems];
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /Edit line item Labor/i }));

    const amountEl = screen.getByRole('textbox', { name: /amount/i });
    await userEvent.clear(amountEl);
    // Leave blank

    await userEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    expect(mockUpdateLineItem).not.toHaveBeenCalled();
    // Error message must be present (announced)
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('invalid amount (non-numeric) is rejected — updateLineItem not called', async () => {
    versionsState.data = [draftVersionWithItems];
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /Edit line item Labor/i }));

    const amountEl = screen.getByRole('textbox', { name: /amount/i });
    await userEvent.clear(amountEl);
    await userEvent.type(amountEl, '12abc');

    await userEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    expect(mockUpdateLineItem).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('zero amount is rejected (budget line items must be > 0)', async () => {
    versionsState.data = [draftVersionWithItems];
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /Edit line item Labor/i }));

    const amountEl = screen.getByRole('textbox', { name: /amount/i });
    await userEvent.clear(amountEl);
    await userEvent.type(amountEl, '0');

    await userEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    expect(mockUpdateLineItem).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('Cancel closes editor without calling updateLineItem', async () => {
    versionsState.data = [draftVersionWithItems];
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /Edit line item Labor/i }));
    // Editor is open
    expect(screen.getByRole('textbox', { name: /amount/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));

    expect(mockUpdateLineItem).not.toHaveBeenCalled();
    // Editor is closed — amount input gone
    expect(screen.queryByRole('textbox', { name: /amount/i })).not.toBeInTheDocument();
    // Edit button restored
    expect(screen.getByRole('button', { name: /Edit line item Labor/i })).toBeInTheDocument();
  });

  it('Save shows a success toast (routine write — OD-UX-1, no confirm)', async () => {
    versionsState.data = [draftVersionWithItems];
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /Edit line item Labor/i }));

    const amountEl = screen.getByRole('textbox', { name: /amount/i });
    await userEvent.clear(amountEl);
    await userEvent.type(amountEl, '300000');

    await userEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
  });

  it('Delete button is still present in the same row when editing', async () => {
    versionsState.data = [draftVersionWithItems];
    renderPage();

    // Edit is open — Delete should still be accessible
    // (After clicking Edit, the row enters edit mode but Delete remains)
    await userEvent.click(screen.getByRole('button', { name: /Edit line item Labor/i }));

    // Delete button should still be present (either in row or accessible)
    // The spec says "Keep delete available"
    expect(screen.getByRole('button', { name: /Delete line item Labor/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC-IXD-BUDGET-W5-C4: Inline edit absent on Active/Archived versions
// ---------------------------------------------------------------------------
describe('AC-IXD-BUDGET-W5-C4: inline edit gate — Active / Archived (read-only)', () => {
  it('Active version line items have NO Edit button', () => {
    budgetState.data = 500000;
    versionsState.data = [activeVersion];
    renderPage();

    // Active line item "Steel" is visible in read-only view
    expect(screen.getByText('Steel')).toBeInTheDocument();
    // No Edit button
    expect(screen.queryByRole('button', { name: /Edit line item/i })).not.toBeInTheDocument();
  });

  it('Archived version line items have NO Edit button', async () => {
    budgetState.data = 0;
    versionsState.data = [archivedVersionWithItems];
    renderPage();

    // Select archived version
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /version/i }),
      'v-arch'
    );

    expect(screen.getByText('Crane')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit line item/i })).not.toBeInTheDocument();
  });
});
