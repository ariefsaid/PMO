// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectDocumentRow } from '@/src/lib/db/documents';
import { DocumentViewerContext, type DocumentViewerApi } from '../viewerContext';
import { ProjectDocumentLink } from './ProjectDocumentLink';

vi.mock('@/src/lib/repositories', () => ({ repositories: { document: { getSignedUrl: vi.fn() } } }));

const row = { id: 'd1', title: 'Survey', status: 'Issued', file_path: 'org/p/d1/s.pdf', source: 'upload' } as unknown as ProjectDocumentRow;
const noFile = { ...row, id: 'd2', title: 'Memo', file_path: null } as unknown as ProjectDocumentRow;

function renderLink(documentId: string | null, documents: ProjectDocumentRow[]) {
  const open = vi.fn<DocumentViewerApi['open']>();
  render(
    <DocumentViewerContext.Provider value={{ open, close: vi.fn() }}>
      <ProjectDocumentLink documentId={documentId} documents={documents} />
    </DocumentViewerContext.Provider>,
  );
  return open;
}

describe('ProjectDocumentLink', () => {
  it('document-preview AC-016 opens a readable linked file in the shared viewer', async () => {
    const open = renderLink('d1', [row]);
    await userEvent.click(screen.getByRole('button', { name: 'Preview Survey' }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0].key).toBe('project-document:d1');
  });

  it('document-preview AC-017 reports an unreadable linked id without exposing the id or preview action', () => {
    renderLink('hidden-id-123', []);
    expect(screen.getByText('Document not available')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(/hidden-id-123/)).toBeNull();
  });

  it('shows a readable title without Preview when the document has no file', () => {
    renderLink('d2', [noFile]);
    expect(screen.getByText('Memo')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
