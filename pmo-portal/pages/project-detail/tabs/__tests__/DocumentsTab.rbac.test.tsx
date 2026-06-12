import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { Role } from '@/src/auth/AuthContext';

/**
 * A-7 Documents Edit author gate (AC-W2-RBAC-014, rbac-visibility §H):
 *   Edit = ◆ author. A PM who did NOT author a document sees NO Edit action in its row menu; the
 *   author (or Admin break-glass) does. Approve/Reject remains the SoD-gated (approver ≠ author)
 *   path, unchanged.
 *
 * Two-sided: the author sees Edit; the non-author manager does not.
 */
const ME = 'u-self';
const OTHER = 'u-other';

const { docsState, fileUploadState, revisionState } = vi.hoisted(() => ({
  docsState: {
    data: [] as Array<Record<string, unknown>>,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
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
  useDocuments: () => docsState,
  useDocumentMutations: () => ({
    create: { mutateAsync: vi.fn() },
    update: { mutateAsync: vi.fn() },
    transition: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
  }),
  useChildDocument: () => ({ data: null, isPending: false }),
}));
vi.mock('@/src/hooks/useFileUpload', () => ({
  useFileUpload: () => fileUploadState,
}));
vi.mock('@/src/hooks/useRevision', () => ({
  useRevision: () => revisionState,
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: ME, org_id: 'org-1' } }),
}));

import DocumentsTab from '../DocumentsTab';

const makeDoc = (author_id: string) => ({
  id: 'd1',
  project_id: 'p1',
  title: 'Foundation GA',
  code: 'DWG-001',
  category: 'Drawing',
  revision: 'A',
  doc_date: '2026-06-01',
  status: 'Draft',
  author_id,
});

const renderAs = (realRole: Role) =>
  render(
    <ImpersonationProvider realRole={realRole}>
      <ToastProvider>
        <DocumentsTab projectId="p1" />
      </ToastProvider>
    </ImpersonationProvider>,
  );

/** Open the single row's action menu and return its menu element. */
const openRowMenu = async () => {
  const trigger = screen.getByRole('button', { name: /row actions/i });
  await userEvent.click(trigger);
  return screen.getByRole('menu');
};

beforeEach(() => {
  docsState.isPending = false;
  docsState.isError = false;
});

describe('DocumentsTab — Edit author gate (A-7)', () => {
  it('AC-W2-RBAC-014: the AUTHOR (PM) sees Edit in the row menu (authorized)', async () => {
    docsState.data = [makeDoc(ME)];
    renderAs('Project Manager');
    const menu = await openRowMenu();
    expect(within(menu).getByText('Edit')).toBeInTheDocument();
  });

  it('AC-W2-RBAC-014: a NON-author PM sees NO Edit action (denied)', async () => {
    docsState.data = [makeDoc(OTHER)];
    renderAs('Project Manager');
    const menu = await openRowMenu();
    expect(within(menu).queryByText('Edit')).not.toBeInTheDocument();
  });
});
