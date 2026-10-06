import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';
import type { ProjectDocumentRow } from '@/src/lib/db/documents';
import ClaimEvidenceModal from '../ClaimEvidenceModal';

const doc = (id: string, title: string, status: string, filePath: string | null) =>
  ({ id, org_id: 'o', project_id: 'p', code: null, category: 'Report', title, revision: 'A', status, doc_date: null, author_id: null, file_path: filePath, created_at: '' }) as unknown as ProjectDocumentRow;
const DOCS = [
  doc('doc-1', 'Progress report', 'Issued', 'docs/report.pdf'),
  doc('doc-2', 'Draft report', 'Draft', 'docs/draft.pdf'),
  doc('doc-3', 'Report without file', 'Issued', null),
  doc('doc-4', 'Client acceptance', 'Approved', 'docs/bast.pdf'),
];

function renderModal(documents = DOCS, attached = ['doc-4']) {
  const onAttach = vi.fn().mockResolvedValue(undefined);
  render(<ToastProvider><ClaimEvidenceModal documents={documents} attachedDocumentIds={attached} onClose={vi.fn()} onAttach={onAttach} onError={vi.fn()} /></ToastProvider>);
  return { onAttach, user: userEvent.setup() };
}

describe('ClaimEvidenceModal', () => {
  it('AC-PB-020 offers only issued or approved documents with a file that are not already attached', () => {
    renderModal();
    expect(Array.from((screen.getByLabelText('Evidence document') as HTMLSelectElement).options).map((o) => o.textContent))
      .toEqual(['—', 'Progress report (Issued, rev A)']);
  });

  it('AC-PB-020 attaching sends the chosen document', async () => {
    const { onAttach, user } = renderModal();
    await user.selectOptions(screen.getByLabelText('Evidence document'), 'doc-1');
    await user.click(screen.getByRole('button', { name: 'Attach' }));
    expect(onAttach).toHaveBeenCalledWith('doc-1');
  });

  it('AC-PB-020 with no eligible document it says so and cannot submit', () => {
    renderModal([DOCS[1], DOCS[2]], []);
    expect(screen.getByText('No issued or approved document with a file on this project.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Attach' })).toBeDisabled();
  });
});
