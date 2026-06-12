/**
 * AC-W3-B2 — Document: Rejected → Draft / Rejected → Closed not offered (lifecycle dead-end fix).
 *
 * The server allows Rejected → Draft (rework) and Rejected → Closed (abandon), but the UI's
 * `statusActions` had no `Rejected` branch, stranding the user.
 *
 * Spec:
 *   - A Rejected document with a write-role exposes two row-menu actions:
 *       • "Reopen for revision" → transition to Draft.
 *       • "Close" → transition to Closed (abandon path).
 *   - Both route through the existing ConfirmDialog mechanism (consistent with Issue/Close).
 *   - A read-only role (Engineer) sees neither action.
 *   - The SoD approver≠author rule is NOT at play for these non-approval transitions
 *     (canWriteDocs gates them, same as Draft→Issued and Approved→Closed).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';

// ── Repository-seam-backed hooks (mirrors DocumentsTab.test.tsx) ─────────────
const { listState, mutations, fileUploadState, revisionState } = vi.hoisted(() => ({
  listState: {
    data: [] as unknown[],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  mutations: {
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    transition: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
  },
  fileUploadState: {
    upload: { mutate: vi.fn(), isPending: false },
    replace: { mutate: vi.fn(), isPending: false },
    progress: {} as Record<string, number>,
    uploadErrors: {} as Record<string, { message: string }>,
    cancelUpload: vi.fn(),
    clearUploadError: vi.fn(),
  },
  revisionState: {
    createRevision: { mutate: vi.fn(), isPending: false },
  },
}));

vi.mock('@/src/hooks/useDocuments', () => ({
  useDocuments: () => listState,
  useDocumentMutations: () => mutations,
  useChildDocument: () => ({ data: null, isPending: false }),
}));
vi.mock('@/src/hooks/useFileUpload', () => ({
  useFileUpload: () => fileUploadState,
}));
vi.mock('@/src/hooks/useRevision', () => ({
  useRevision: () => revisionState,
}));

let realRole: Role = 'Admin';
let currentUserId = 'admin-1';

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: currentUserId, org_id: 'org-1' } }),
}));

import DocumentsTab from '../DocumentsTab';

// Rejected document authored by pm-1.
const rejectedDoc = {
  id: 'd-rej',
  project_id: 'p1',
  code: 'DOC-REJ',
  category: 'Report',
  title: 'Rejected Report',
  revision: 'A',
  status: 'Rejected',
  author_id: 'pm-1',
  doc_date: '2026-06-01',
  org_id: 'org-1',
  file_path: null,
  created_at: '2026-06-01T00:00:00Z',
};

const renderTab = (role: Role = 'Admin', uid = 'admin-1') => {
  realRole = role;
  currentUserId = uid;
  return render(
    <ToastProvider>
      <MemoryRouter>
        <DocumentsTab projectId="p1" />
      </MemoryRouter>
    </ToastProvider>,
  );
};

beforeEach(() => {
  listState.data = [rejectedDoc];
  listState.isPending = false;
  listState.isError = false;
  listState.refetch.mockClear();
  Object.values(mutations).forEach((m) => {
    m.mutateAsync.mockReset();
    m.mutateAsync.mockResolvedValue(undefined);
    m.isPending = false;
  });
  realRole = 'Admin';
  currentUserId = 'admin-1';
});

describe('AC-W3-B2: Rejected document status actions (Reopen + Close)', () => {
  it('AC-W3-B2: a write-role (Admin) sees "Reopen for revision" in the row menu of a Rejected document', async () => {
    renderTab('Admin', 'admin-1');
    const row = screen.getByText('Rejected Report').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: /Row actions/i }));
    expect(screen.getByRole('menuitem', { name: /Reopen for revision/i })).toBeInTheDocument();
  });

  it('AC-W3-B2: a write-role (Admin) sees "Close" in the row menu of a Rejected document', async () => {
    renderTab('Admin', 'admin-1');
    const row = screen.getByText('Rejected Report').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: /Row actions/i }));
    expect(screen.getByRole('menuitem', { name: /^Close$/i })).toBeInTheDocument();
  });

  it('AC-W3-B2: "Reopen for revision" drives a ConfirmDialog and transitions the doc to Draft on confirm', async () => {
    renderTab('Admin', 'admin-1');
    const row = screen.getByText('Rejected Report').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: /Row actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Reopen for revision/i }));

    // Confirm dialog must appear — mutation not yet called
    expect(mutations.transition.mutateAsync).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();

    // Confirm the transition
    await userEvent.click(within(dialog).getByRole('button', { name: /Reopen for revision/i }));
    await waitFor(() =>
      expect(mutations.transition.mutateAsync).toHaveBeenCalledWith({ id: 'd-rej', status: 'Draft' }),
    );
  });

  it('AC-W3-B2: "Close" (abandon) drives a ConfirmDialog and transitions the doc to Closed on confirm', async () => {
    renderTab('Admin', 'admin-1');
    const row = screen.getByText('Rejected Report').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: /Row actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /^Close$/i }));

    // Confirm dialog must appear — mutation not yet called
    expect(mutations.transition.mutateAsync).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: /Close document/i }));
    await waitFor(() =>
      expect(mutations.transition.mutateAsync).toHaveBeenCalledWith({ id: 'd-rej', status: 'Closed' }),
    );
  });

  it('AC-W3-B2: a read-only role (Engineer) sees NO "Reopen for revision" or "Close" actions on a Rejected doc', () => {
    renderTab('Engineer', 'eng-1');
    // Engineers have no row action menu at all (read-only in documents)
    expect(screen.queryByRole('button', { name: /Row actions/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Reopen for revision/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /^Close$/i })).not.toBeInTheDocument();
  });

  it('AC-W3-B2: a PM (write-role) also sees both Rejected actions on a doc they did NOT author', async () => {
    // pm-2 is NOT the author (pm-1 authored it) → canEditDoc is false, but canWriteDocs is true
    // → statusActions should still expose Reopen + Close (not author-gated)
    renderTab('Project Manager', 'pm-2');
    const row = screen.getByText('Rejected Report').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: /Row actions/i }));
    expect(screen.getByRole('menuitem', { name: /Reopen for revision/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /^Close$/i })).toBeInTheDocument();
  });
});
