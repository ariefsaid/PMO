import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

/**
 * B-4 (AC-W2-IXD-007): On an Issued document, a non-author reviewer sees a
 * visible Approve/Reject affordance — not hidden behind hover.
 *
 * With the B-4 DataTable fix (always-visible ⋯ trigger), the row menu's
 * Approve/Reject verbs are now reachable without hover on any viewport.
 * This test verifies the workflow verbs exist in the accessible row-menu,
 * AND that the ⋯ trigger is keyboard-reachable (row-action trigger visible).
 *
 * Owning layer: component (RTL) — AC-W2-IXD-007.
 */

// vi.hoisted must be the first call; author/reviewer IDs are inlined here.
const { docsState, reviewerId, fileUploadState, revisionState } = vi.hoisted(() => ({
  reviewerId: 'reviewer-456',
  docsState: {
    data: [
      {
        id: 'doc1',
        title: 'Foundation Design Report',
        code: 'DOC-001',
        category: 'Report',
        revision: 'A',
        doc_date: '2026-01-01',
        status: 'Issued',
        author_id: 'author-123',
        project_id: 'p1',
        org_id: 'org-1',
        created_at: '2026-01-01',
      },
    ] as Array<Record<string, unknown>>,
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

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: reviewerId, org_id: 'org-1' } }),
}));
vi.mock('@/src/hooks/useDocuments', () => ({
  useDocuments: () => docsState,
  useDocumentMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
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

import DocumentsTab from '../DocumentsTab';

const renderAsReviewer = () =>
  render(
    <ImpersonationProvider realRole="Project Manager">
      <ToastProvider>
        <DocumentsTab projectId="p1" />
      </ToastProvider>
    </ImpersonationProvider>,
  );

describe('DocumentsTab — visible workflow verbs (B-4, AC-W2-IXD-007)', () => {
  it('AC-W2-IXD-007: the row-action trigger is visible (not opacity-0 / hover-gated)', () => {
    renderAsReviewer();
    // The ⋯ trigger must be in the DOM and not have opacity-0 class (B-4 DataTable fix).
    const trigger = screen.getByRole('button', { name: /row actions/i });
    expect(trigger).toBeInTheDocument();
    expect(trigger.className).not.toContain('opacity-0');
  });

  it('AC-W2-IXD-007: opening the row menu on an Issued document shows Approve and Reject for a non-author reviewer', async () => {
    const user = userEvent.setup();
    renderAsReviewer();
    // Open the row menu via click.
    await user.click(screen.getByRole('button', { name: /row actions/i }));
    // The menu must show Approve and Reject verbs for an Issued doc (non-author reviewer).
    expect(screen.getByRole('menuitem', { name: /^Approve$/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /^Reject$/i })).toBeInTheDocument();
  });
});
