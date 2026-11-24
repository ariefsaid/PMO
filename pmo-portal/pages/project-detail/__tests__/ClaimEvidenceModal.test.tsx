import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';
import type { ProjectDocumentRow } from '@/src/lib/db/documents';
import ClaimEvidenceModal from '../ClaimEvidenceModal';

const doc = (id: string, title: string, status: ProjectDocumentRow['status'], filePath: string | null): ProjectDocumentRow => ({
  id, org_id: 'o', project_id: 'p', code: null, category: 'Report', category_id: 'cat-report', title, revision: 'A',
  status, doc_date: null, author_id: null, file_path: filePath, created_at: '', parent_document_id: null,
  source: filePath ? 'upload' : null,
  ms_drive_id: null, ms_item_id: null, ms_web_url: null, ms_item_name: null, ms_item_kind: null,
  ms_linked_by: null, ms_linked_at: null, ms_last_verified_at: null,
  ms_content_tag_at_issue: null, ms_version_id_at_issue: null, ms_drift_state: null,
  ms_check_claim: null, ms_check_claimed_at: null,
});
const DOCS = [
  doc('doc-1', 'Progress report', 'Issued', 'docs/report.pdf'),
  doc('doc-2', 'Draft report', 'Draft', 'docs/draft.pdf'),
  doc('doc-3', 'Report without file', 'Issued', null),
  doc('doc-4', 'Client acceptance', 'Approved', 'docs/bast.pdf'),
];

function renderModal(documents = DOCS, attached = ['doc-4'], earlier: string[] = []) {
  const onAttach = vi.fn().mockResolvedValue(undefined);
  render(<ToastProvider><ClaimEvidenceModal documents={documents} attachedDocumentIds={attached} earlierDocumentIds={earlier} onClose={vi.fn()} onAttach={onAttach} onError={vi.fn()} /></ToastProvider>);
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

  it('BQ10 the documents used on earlier claims of this work order come pre-ticked and attach in one confirm', async () => {
    const docs = [...DOCS, doc('doc-5', 'Inspection test plan', 'Approved', 'docs/itp.pdf')];
    const { onAttach, user } = renderModal(docs, ['doc-4'], ['doc-1', 'doc-5', 'doc-4', 'doc-2']);
    // Only what could be attached now is offered: doc-4 is already on this claim, doc-2 is a draft.
    expect(screen.getByRole('checkbox', { name: /Progress report/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Inspection test plan/ })).toBeChecked();
    expect(screen.queryByRole('checkbox', { name: /Client acceptance/ })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /Draft report/ })).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: /Inspection test plan/ }));
    await user.click(screen.getByRole('button', { name: 'Attach' }));
    expect(onAttach.mock.calls.map((c) => c[0])).toEqual(['doc-1']);
  });
});
