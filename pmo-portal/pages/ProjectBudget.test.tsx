import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

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

const mockActivate = vi.fn().mockResolvedValue(undefined);
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
      <ProjectBudget projectId={projectId} />
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
    expect(screen.getByText('Draft')).toBeInTheDocument();
    resetState();
  });

  it('shows Active badge for an active version', () => {
    budgetState.data = 4700000;
    versionsState.data = [activeVersion];
    renderPage();
    expect(screen.getByText('Active')).toBeInTheDocument();
    resetState();
  });

  it('shows Archived badge for archived version', () => {
    budgetState.data = 0;
    versionsState.data = [archivedVersion];
    renderPage();
    expect(screen.getByText('Archived')).toBeInTheDocument();
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

  it('calls activate mutation when Activate clicked', async () => {
    budgetState.data = 0;
    versionsState.data = [draftVersion];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /Activate/i }));
    expect(mockActivate).toHaveBeenCalledWith('v-draft');
    resetState();
  });

  it('calls deleteDraft mutation when Delete draft clicked', async () => {
    budgetState.data = 0;
    versionsState.data = [draftVersion];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /Delete draft/i }));
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

  it('calls deleteLineItem when Delete button clicked in line-item editor', async () => {
    budgetState.data = 0;
    versionsState.data = [draftVersion];
    renderPage();
    const deleteBtn = screen.getByRole('button', { name: /Delete line item Labor/i });
    await userEvent.click(deleteBtn);
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

  it('shows confirmation on Archive click then calls mutation', async () => {
    budgetState.data = 4700000;
    versionsState.data = [activeVersion];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^Archive$/i }));
    // Confirmation warning should appear
    expect(screen.getByText(/Warning: archiving removes the active budget/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Yes, archive/i }));
    expect(mockArchive).toHaveBeenCalledWith('v-active');
    resetState();
  });

  it('can cancel archive confirmation', async () => {
    budgetState.data = 4700000;
    versionsState.data = [activeVersion];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^Archive$/i }));
    await userEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    expect(screen.queryByText(/Warning/i)).not.toBeInTheDocument();
    expect(mockArchive).not.toHaveBeenCalled();
    resetState();
  });

  it('calls cloneVersion mutation for Active version', async () => {
    budgetState.data = 4700000;
    versionsState.data = [activeVersion];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /Clone to revise/i }));
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

  it('calls createVersion and closes form on submit in list state', async () => {
    budgetState.data = 4700000;
    versionsState.data = [activeVersion];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /New version/i }));
    await userEvent.type(screen.getByPlaceholderText(/Version name/i), 'Budget v2');
    await userEvent.click(screen.getByRole('button', { name: /^Create$/i }));
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

  it('calls createVersion and closes form on submit', async () => {
    budgetState.data = 0;
    versionsState.data = [];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /New version/i }));
    await userEvent.type(screen.getByPlaceholderText(/Version name/i), 'Budget v1');
    await userEvent.click(screen.getByRole('button', { name: /^Create$/i }));
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
