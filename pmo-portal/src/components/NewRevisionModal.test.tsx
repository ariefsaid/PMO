import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NewRevisionModal } from './NewRevisionModal';
import type { ProjectDocumentRow } from '@/src/lib/db/documents';

const baseDoc: ProjectDocumentRow = {
  id: 'parent-1',
  project_id: 'proj-1',
  org_id: 'org-1',
  title: 'Foundation general arrangement',
  code: 'DWG-001',
  category: 'Drawing',
  revision: 'A',
  status: 'Approved',
  author_id: 'user-1',
  doc_date: '2026-05-10',
  file_path: 'org-1/proj-1/parent-1/foundation-ga.pdf',
  parent_document_id: null,
  created_at: '2026-05-10T00:00:00Z',
};

describe('NewRevisionModal', () => {
  it('AC-DOC-084: pre-fills title, code, category, auto-bumped revision, and does not carry the file', () => {
    render(
      <NewRevisionModal parent={baseDoc} onSubmit={vi.fn()} onClose={vi.fn()} loading={false} />,
    );

    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Foundation general arrangement');
    expect(screen.getByRole('textbox', { name: 'Code' })).toHaveValue('DWG-001');
    expect(screen.getByRole('combobox', { name: 'Category' })).toHaveValue('Drawing');
    expect(screen.getByRole('textbox', { name: 'Revision' })).toHaveValue('B');
    expect(screen.getByLabelText('Document date')).toHaveValue('');
    expect(screen.queryByText('foundation-ga.pdf')).not.toBeInTheDocument();
  });

  it('AC-DOC-052: digit revision auto-bumps (3→4)', () => {
    render(
      <NewRevisionModal
        parent={{ ...baseDoc, revision: '3' }}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
        loading={false}
      />,
    );

    expect(screen.getByRole('textbox', { name: 'Revision' })).toHaveValue('4');
  });

  it('AC-DOC-084: Create revision stays disabled until Title is non-empty', async () => {
    const user = userEvent.setup();

    render(
      <NewRevisionModal parent={baseDoc} onSubmit={vi.fn()} onClose={vi.fn()} loading={false} />,
    );

    const title = screen.getByRole('textbox', { name: 'Title' });
    const createButton = screen.getByRole('button', { name: 'Create revision' });

    expect(createButton).toBeEnabled();

    await user.clear(title);
    expect(createButton).toBeDisabled();

    await user.type(title, 'Updated title');
    expect(createButton).toBeEnabled();
  });

  it('AC-DOC-084: subtitle matches the approved design copy and the modal is a dialog', () => {
    render(
      <NewRevisionModal parent={baseDoc} onSubmit={vi.fn()} onClose={vi.fn()} loading={false} />,
    );

    expect(
      screen.getByText(
        'Create the next revision of this document. The file can be uploaded once the revision is created.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'New revision' })).toHaveAttribute('aria-modal', 'true');
  });
});
