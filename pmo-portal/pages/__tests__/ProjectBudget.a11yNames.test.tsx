/**
 * AC-W2-5-01: Budget add-line Description + Amount inputs have accessible names.
 * AC-W2-5-02: New budget-version name input has an accessible name.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '@/src/components/ui';

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
  created_at: '2026-01-01T00:00:00Z',
  line_items: [],
  total: 0,
};

const renderPage = () =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <ProjectBudget projectId="p-1" />
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

    // Open the "Add line item" row
    const addBtn = await screen.findByRole('button', { name: /add line item/i });
    await user.click(addBtn);

    // Both inputs must have accessible names (getByLabelText covers aria-label)
    expect(screen.getByLabelText('Line item description')).toBeInTheDocument();
    expect(screen.getByLabelText('Line item amount')).toBeInTheDocument();
  });

  it('AC-W2-5-02: new budget-version name input has an accessible name via aria-label', async () => {
    const user = userEvent.setup();
    renderPage();

    // Click the "+ New version" button
    const createBtn = await screen.findByRole('button', { name: /\+ new version/i });
    await user.click(createBtn);

    expect(screen.getByLabelText('Version name')).toBeInTheDocument();
  });
});
