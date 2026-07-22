import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '@/src/components/ui';

// ---------------------------------------------------------------------------
// Mutable mock state (mirrors Procurement.test.tsx pattern)
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

const mockActivate = vi.fn().mockResolvedValue({ pushState: 'pushed' });
const mockArchive = vi.fn().mockResolvedValue(undefined);
const mockClone = vi.fn().mockResolvedValue('v-clone');
const mockDeleteDraft = vi.fn().mockResolvedValue(undefined);
const mockCreateVersion = vi.fn().mockResolvedValue({ id: 'v-new' });
const mockCreateLineItem = vi.fn().mockResolvedValue({ id: 'li-new' });
const mockDeleteLineItem = vi.fn().mockResolvedValue(undefined);

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
    updateLineItem: { mutateAsync: vi.fn(), isPending: false },
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

import ProjectBudget from './ProjectBudget';

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
const draftVersion = {
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
  line_items: [],
  total: 4700000,
};

const archivedVersion = {
  id: 'v-arch',
  status: 'Archived' as const,
  name: 'Old v0',
  version: 0,
  project_id: 'p-1',
  org_id: 'org-1',
  created_at: '2026-01-01T00:00:00Z',
  line_items: [],
  total: 0,
};

function resetState() {
  budgetState.data = undefined;
  budgetState.isPending = false;
  budgetState.isError = false;
  versionsState.data = undefined;
  versionsState.isPending = false;
  versionsState.isError = false;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetState();
});

// ---------------------------------------------------------------------------
// Core states (AC-726, NFR-BV-UI-001)
// ---------------------------------------------------------------------------
describe('ProjectBudget (AC-726, NFR-BV-UI-001)', () => {
  it('loading skeleton while pending (AC-726)', () => {
    budgetState.isPending = true;
    versionsState.isPending = true;
    renderPage();
    expect(screen.getByTestId('budget-loading')).toBeInTheDocument();
    resetState();
  });

  it('empty state when zero versions (AC-726)', () => {
    budgetState.data = 0;
    versionsState.data = [];
    renderPage();
    expect(screen.getByTestId('budget-empty')).toBeInTheDocument();
    resetState();
  });

  it('error + Retry re-runs both queries (AC-726)', () => {
    budgetState.isError = true;
    versionsState.isError = true;
    const refetchSpy = vi.fn();
    budgetState.refetch = refetchSpy;
    versionsState.refetch = refetchSpy;
    renderPage();
    const retryBtn = screen.getByRole('button', { name: /Retry/i });
    expect(retryBtn).toBeInTheDocument();
    fireEvent.click(retryBtn);
    expect(refetchSpy).toHaveBeenCalled();
    resetState();
  });

  it('renders derived budget via formatCurrency (AC-720 view side)', () => {
    budgetState.data = 4700000;
    versionsState.data = [activeVersion];
    renderPage();
    const matches = screen.getAllByText('$4,700,000');
    expect(matches.length).toBeGreaterThanOrEqual(1);
    resetState();
  });
});

// ---------------------------------------------------------------------------
// Version status badges
// ---------------------------------------------------------------------------
describe('ProjectBudget version status display', () => {
  it('shows Draft badge for a draft version', () => {
    budgetState.data = 0;
    versionsState.data = [draftVersion];
    renderPage();
    // "Draft" appears in the selector-bar pill AND in the VersionCard (intentional reinforcement per plan §2)
    const draftMatches = screen.getAllByText('Draft');
    expect(draftMatches.length).toBeGreaterThanOrEqual(1);
    resetState();
  });

  it('shows Active badge for an active version', () => {
    budgetState.data = 4700000;
    versionsState.data = [activeVersion];
    renderPage();
    const activeMatches = screen.getAllByText('Active');
    expect(activeMatches.length).toBeGreaterThanOrEqual(1);
    resetState();
  });

  it('shows Archived badge for archived version', () => {
    budgetState.data = 0;
    versionsState.data = [archivedVersion];
    renderPage();
    const archivedMatches = screen.getAllByText('Archived');
    expect(archivedMatches.length).toBeGreaterThanOrEqual(1);
    resetState();
  });
});

// ---------------------------------------------------------------------------
// Draft actions
// ---------------------------------------------------------------------------
describe('ProjectBudget Draft version actions', () => {
  it('shows Activate and Delete draft buttons for Draft version', () => {
    budgetState.data = 0;
    versionsState.data = [draftVersion];
    renderPage();
    expect(screen.getByRole('button', { name: /Activate/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delete draft/i })).toBeInTheDocument();
    resetState();
  });

  it('B2: Activate opens a default-tone confirm; mutation fires only on Confirm; toasts on resolve', async () => {
    budgetState.data = 0;
    versionsState.data = [draftVersion];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^Activate$/i }));
    // Owner rule: nothing mutates on the first click.
    expect(mockActivate).not.toHaveBeenCalled();
    // Default tone => role=dialog.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Activate version/i }));
    expect(mockActivate).toHaveBeenCalledWith('v-draft');
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    resetState();
  });

  // ── HIGH-C (Luna re-audit round 2): the push is a CONSEQUENCE of activation, never its precondition
  //    (ADR-0059 §3.2) — so activation still SUCCEEDS when the push fails. But "swallowed" must mean
  //    "recorded and surfaced", never "lost": a dispatch that never reached the edge function writes no
  //    mirror row at all, the sweep backstop's queue IS that mirror, and the user was shown a plain
  //    success while ERPNext kept enforcing the previous budget.
  it('HIGH-C activation whose ERP push failed still succeeds, but SAYS SO instead of toasting a clean success', async () => {
    mockActivate.mockResolvedValueOnce({ pushState: 'failed' });
    budgetState.data = 0;
    versionsState.data = [draftVersion];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^Activate$/i }));
    await userEvent.click(screen.getByRole('button', { name: /Activate version/i }));
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent(/activated/i);
    expect(screen.getByRole('status')).toHaveTextContent(/ERPNext/i);
    resetState();
  });

  it('B5: Delete draft opens a DESTRUCTIVE modal; deleteDraft fires only on Confirm', async () => {
    budgetState.data = 0;
    versionsState.data = [draftVersion];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /Delete draft/i }));
    expect(mockDeleteDraft).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    // The confirm button label is "Delete draft" (verb + object).
    const confirms = screen.getAllByRole('button', { name: /Delete draft/i });
    // The last one is the dialog's confirm (the trigger is also still labelled "Delete draft").
    await userEvent.click(confirms[confirms.length - 1]);
    expect(mockDeleteDraft).toHaveBeenCalledWith('v-draft');
    resetState();
  });

  it('shows line-item row from the draft', () => {
    budgetState.data = 0;
    versionsState.data = [draftVersion];
    renderPage();
    expect(screen.getByText('Developers')).toBeInTheDocument();
    resetState();
  });

  it('delete-line-item opens a DESTRUCTIVE modal; deleteLineItem fires only on Confirm', async () => {
    budgetState.data = 0;
    versionsState.data = [draftVersion];
    renderPage();
    const deleteBtn = screen.getByRole('button', { name: /Delete line item Labor/i });
    await userEvent.click(deleteBtn);
    // Owner rule: the row's Delete click stages a confirm, does not write.
    expect(mockDeleteLineItem).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Delete$/i }));
    expect(mockDeleteLineItem).toHaveBeenCalledWith('li-1');
    resetState();
  });

  it('shows Add line item button in draft', () => {
    budgetState.data = 0;
    versionsState.data = [draftVersion];
    renderPage();
    expect(screen.getByText(/\+ Add line item/i)).toBeInTheDocument();
    resetState();
  });
});

// ---------------------------------------------------------------------------
// Active version actions
// ---------------------------------------------------------------------------
describe('ProjectBudget Active version actions', () => {
  it('shows Archive and Clone to revise buttons for Active version', () => {
    budgetState.data = 4700000;
    versionsState.data = [activeVersion];
    renderPage();
    expect(screen.getByRole('button', { name: /Archive/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Clone to revise/i })).toBeInTheDocument();
    resetState();
  });

  it('B4: Archive opens a DESTRUCTIVE modal then calls mutation on Confirm', async () => {
    budgetState.data = 4700000;
    versionsState.data = [activeVersion];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^Archive$/i }));
    // Owner rule: nothing mutates on the first click; a destructive modal appears.
    expect(mockArchive).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Archive version/i }));
    expect(mockArchive).toHaveBeenCalledWith('v-active');
    resetState();
  });

  it('B4: can cancel archive confirmation', async () => {
    budgetState.data = 4700000;
    versionsState.data = [activeVersion];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^Archive$/i }));
    await userEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(mockArchive).not.toHaveBeenCalled();
    resetState();
  });

  it('B3: Clone opens a default-tone confirm then calls cloneVersion on Confirm', async () => {
    budgetState.data = 4700000;
    versionsState.data = [activeVersion];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /Clone to revise/i }));
    expect(mockClone).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Clone version/i }));
    expect(mockClone).toHaveBeenCalledWith('v-active');
    resetState();
  });
});

// ---------------------------------------------------------------------------
// Archived version actions
// ---------------------------------------------------------------------------
describe('ProjectBudget Archived version actions', () => {
  it('shows Clone to revise for Archived version', () => {
    budgetState.data = 0;
    versionsState.data = [archivedVersion];
    renderPage();
    expect(screen.getByRole('button', { name: /Clone to revise/i })).toBeInTheDocument();
    resetState();
  });

  it('does not show Activate/Archive/Delete buttons for Archived', () => {
    budgetState.data = 0;
    versionsState.data = [archivedVersion];
    renderPage();
    expect(screen.queryByRole('button', { name: /Activate/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Archive$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete draft/i })).not.toBeInTheDocument();
    resetState();
  });
});

// ---------------------------------------------------------------------------
// New version form in non-empty (versions list) state
// ---------------------------------------------------------------------------
describe('ProjectBudget New version form (versions list state)', () => {
  it('shows + New version button in list state', () => {
    budgetState.data = 4700000;
    versionsState.data = [activeVersion];
    renderPage();
    expect(screen.getByRole('button', { name: /New version/i })).toBeInTheDocument();
  });

  it('shows form when + New version clicked in list state', async () => {
    budgetState.data = 4700000;
    versionsState.data = [activeVersion];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /New version/i }));
    expect(screen.getByPlaceholderText(/Version name/i)).toBeInTheDocument();
  });

  it('B1: Create opens a confirm in list state; createVersion fires only on Confirm', async () => {
    budgetState.data = 4700000;
    versionsState.data = [activeVersion];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /New version/i }));
    await userEvent.type(screen.getByPlaceholderText(/Version name/i), 'Budget v2');
    await userEvent.click(screen.getByRole('button', { name: /^Create$/i }));
    expect(mockCreateVersion).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    // item J: the confirm description names the entered version — never an
    // empty-string '""' from a fragile kind-narrowing fallback.
    expect(dialog).toHaveTextContent('named "Budget v2"');
    expect(dialog).not.toHaveTextContent('named ""');
    await userEvent.click(screen.getByRole('button', { name: /Create version/i }));
    expect(mockCreateVersion).toHaveBeenCalledWith({ projectId: 'p-1', name: 'Budget v2' });
  });
});

// ---------------------------------------------------------------------------
// Line-item add form in Draft editor
// ---------------------------------------------------------------------------
describe('ProjectBudget line-item add form (Draft)', () => {
  it('can add a line item via the editor form', async () => {
    budgetState.data = 0;
    versionsState.data = [draftVersion];
    renderPage();
    await userEvent.click(screen.getByText(/\+ Add line item/i));
    const amountInput = screen.getByPlaceholderText(/Amount/i);
    await userEvent.type(amountInput, '50000');
    await userEvent.click(screen.getByRole('button', { name: /^Save$/i }));
    expect(mockCreateLineItem).toHaveBeenCalledWith({
      versionId: 'v-draft',
      item: expect.objectContaining({ budgeted_amount: 50000 }),
    });
  });

  it('can cancel the add line item form', async () => {
    budgetState.data = 0;
    versionsState.data = [draftVersion];
    renderPage();
    await userEvent.click(screen.getByText(/\+ Add line item/i));
    await userEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    expect(screen.getByText(/\+ Add line item/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// New version form (empty state)
// ---------------------------------------------------------------------------
describe('ProjectBudget New version form (empty state)', () => {
  it('shows + New version button in empty state', () => {
    budgetState.data = 0;
    versionsState.data = [];
    renderPage();
    expect(screen.getByRole('button', { name: /New version/i })).toBeInTheDocument();
    resetState();
  });

  it('shows form when + New version clicked in empty state', async () => {
    budgetState.data = 0;
    versionsState.data = [];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /New version/i }));
    expect(screen.getByPlaceholderText(/Version name/i)).toBeInTheDocument();
    resetState();
  });

  it('B1: Create opens a confirm in empty state; createVersion fires only on Confirm', async () => {
    budgetState.data = 0;
    versionsState.data = [];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /New version/i }));
    await userEvent.type(screen.getByPlaceholderText(/Version name/i), 'Budget v1');
    await userEvent.click(screen.getByRole('button', { name: /^Create$/i }));
    expect(mockCreateVersion).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /Create version/i }));
    expect(mockCreateVersion).toHaveBeenCalledWith({ projectId: 'p-1', name: 'Budget v1' });
    resetState();
  });

  it('hides form on cancel', async () => {
    budgetState.data = 0;
    versionsState.data = [];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /New version/i }));
    await userEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    expect(screen.queryByPlaceholderText(/Version name/i)).not.toBeInTheDocument();
    resetState();
  });
});

// ---------------------------------------------------------------------------
// ProjectBudget version selector (budget-dropdown)
// ---------------------------------------------------------------------------
describe('ProjectBudget version selector (budget-dropdown)', () => {
  // T1/T2: AC-BD-01 — labelled selector present when ≥1 version exists
  it('AC-BD-01: renders a labelled "Version" combobox with ≥1 version', () => {
    budgetState.data = 4700000;
    versionsState.data = [activeVersion, draftVersion];
    renderPage();
    expect(screen.getByRole('combobox', { name: /version/i })).toBeInTheDocument();
    resetState();
  });

  // T3/T4: AC-BD-02 — defaults to Active version, shows Active status pill in selector bar
  it('AC-BD-02: defaults selection to Active version when present (even if not first in array)', () => {
    budgetState.data = 4700000;
    versionsState.data = [archivedVersion, activeVersion, draftVersion];
    renderPage();
    const selectorBar = screen.getByTestId('version-selector');
    // The selector bar pill should show "Active"
    expect(selectorBar.textContent).toContain('Active');
    // The combobox value should be the active version's id
    const combobox = screen.getByRole('combobox', { name: /version/i }) as HTMLSelectElement;
    expect(combobox.value).toBe(activeVersion.id);
    resetState();
  });

  // T5/T6: AC-BD-04 — switching selection swaps the single card (AC-BD-05: never stacked)
  it('AC-BD-04: switching version selector swaps to the selected version card', async () => {
    budgetState.data = 4700000;
    versionsState.data = [activeVersion, draftVersion];
    renderPage();
    // Default = Active; draftVersion has a 'Developers' line item
    expect(screen.queryByText('Developers')).not.toBeInTheDocument();
    // Switch to draft
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /version/i }), draftVersion.id);
    expect(screen.getByText('Developers')).toBeInTheDocument();
    // Only one version-card in the DOM (AC-BD-05)
    expect(screen.getAllByTestId('version-card')).toHaveLength(1);
    resetState();
  });

  // T7: AC-BD-06 — single-version still shows the selector
  it('AC-BD-06: selector is still present when only one version exists', () => {
    budgetState.data = 4700000;
    versionsState.data = [activeVersion];
    renderPage();
    expect(screen.getByRole('combobox', { name: /version/i })).toBeInTheDocument();
    expect(screen.getAllByTestId('version-card')).toHaveLength(1);
    resetState();
  });

  // T8: AC-BD-03 — no-Active fallback: highest Draft wins over Archived
  it('AC-BD-03: no Active version — defaults to highest-version Draft', () => {
    budgetState.data = 0;
    versionsState.data = [archivedVersion, draftVersion]; // no Active
    renderPage();
    const selectorBar = screen.getByTestId('version-selector');
    expect(selectorBar.textContent).toContain('Draft');
    const combobox = screen.getByRole('combobox', { name: /version/i }) as HTMLSelectElement;
    expect(combobox.value).toBe(draftVersion.id);
    resetState();
  });

  // T9: AC-BD-09 — delete-selected-draft self-heals
  it('AC-BD-09: selecting deleted Draft self-heals to default (Active) without crash', async () => {
    budgetState.data = 4700000;
    versionsState.data = [activeVersion, draftVersion];
    const { rerender } = renderPage();
    // Select the draft
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /version/i }), draftVersion.id);
    expect(screen.getByText('Developers')).toBeInTheDocument();
    // Simulate mutation: draft is deleted, only active remains
    versionsState.data = [activeVersion];
    rerender(
      <MemoryRouter>
        <ToastProvider>
          <ProjectBudget projectId="p-1" />
        </ToastProvider>
      </MemoryRouter>
    );
    // Should fall back to active, no crash
    const selectorBar = screen.getByTestId('version-selector');
    expect(selectorBar.textContent).toContain('Active');
    expect(screen.queryByText('Developers')).not.toBeInTheDocument();
    resetState();
  });

  // T10a: A4/N1 — option text for a Draft contains "(Draft)" not color-only
  it('A4/N1: option text includes "(Draft)" for draft version (not color-only status)', () => {
    budgetState.data = 0;
    versionsState.data = [draftVersion];
    renderPage();
    const combobox = screen.getByRole('combobox', { name: /version/i });
    expect(combobox.textContent).toContain('(Draft)');
    resetState();
  });

  // T10b: N2 — no em-dash in selector/option text
  it('N2: no em-dash in selector or option text', () => {
    budgetState.data = 4700000;
    versionsState.data = [activeVersion, draftVersion];
    const { getByTestId } = renderPage();
    const selectorBar = getByTestId('version-selector');
    expect(selectorBar.textContent).not.toContain('—'); // em-dash —
    resetState();
  });
});

/**
 * ⚑ C-4 (rendered Discover pass, 2026-07-22) — two columns named "Actual" sat ~100px apart on the
 * same tab, showing different figures ($1,200,000 here vs $1,150,000 in the projection below), with
 * nothing on screen saying they came from different places or which governed. They are different
 * facts: this is what PMO recorded on the budget line; the projection reads the ERP general ledger.
 */
describe('ProjectBudget — the Actual column names its own source (C-4)', () => {
  it('C-4 the version grid column says the figure is PMO-recorded, not the ERP ledger', async () => {
    budgetState.data = 4700000;
    versionsState.data = [{ ...activeVersion, line_items: draftVersion.line_items }];
    renderPage();
    // the selected version's line-item grid is the surface that carries the column
    await screen.findByRole('columnheader', { name: /Budgeted/i });
    expect(screen.queryAllByRole('columnheader', { name: /^Actual$/ })).toHaveLength(0);
    expect(screen.getAllByRole('columnheader', { name: /Actual \(PMO recorded\)/i }).length).toBeGreaterThan(0);
  });
});
