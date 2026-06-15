/**
 * AC-W2-5-03: Hidden Documents file input has an accessible name.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '@/src/components/ui';

const { listState, mutations, fileUploadState, revisionState, repositoryState } = vi.hoisted(() => ({
  listState: { data: [], isPending: false, isError: false, refetch: vi.fn() },
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
    createRevision: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
  },
  repositoryState: {
    document: { getSignedUrl: vi.fn() },
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
vi.mock('@/src/lib/repositories', () => ({
  repositories: repositoryState,
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: 'Admin', effectiveRole: 'Admin' }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'admin-1', org_id: 'org-1' } }),
}));

import DocumentsTab from '../DocumentsTab';

describe('DocumentsTab file input accessible name (W2-5)', () => {
  it('AC-W2-5-03: hidden file input has aria-label "Upload a document"', () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <DocumentsTab projectId="p1" />
        </ToastProvider>
      </MemoryRouter>,
    );

    const fileInput = screen.getByTestId('file-input');
    expect(fileInput).toHaveAttribute('aria-label', 'Upload a document');
  });
});
