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

  it('AC-DOC-052: letter revision auto-bumps (A→B)', () => {
    render(
      <NewRevisionModal parent={baseDoc} onSubmit={vi.fn()} onClose={vi.fn()} loading={false} />,
    );

    expect(screen.getByRole('textbox', { name: 'Revision' })).toHaveValue('B');
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

  it('C1: submits edited revision fields, including document date', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <NewRevisionModal parent={baseDoc} onSubmit={onSubmit} onClose={vi.fn()} loading={false} />,
    );

    await user.clear(screen.getByRole('textbox', { name: 'Title' }));
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Edited title');
    await user.clear(screen.getByRole('textbox', { name: 'Code' }));
    await user.type(screen.getByRole('textbox', { name: 'Code' }), 'DWG-009');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'Specification');
    await user.clear(screen.getByRole('textbox', { name: 'Revision' }));
    await user.type(screen.getByRole('textbox', { name: 'Revision' }), 'C');
    await user.type(screen.getByLabelText('Document date'), '2026-06-12');
    await user.click(screen.getByRole('button', { name: 'Create revision' }));

    expect(onSubmit).toHaveBeenCalledWith({
      title: 'Edited title',
      code: 'DWG-009',
      category: 'Specification',
      revision: 'C',
      doc_date: '2026-06-12',
    });
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
