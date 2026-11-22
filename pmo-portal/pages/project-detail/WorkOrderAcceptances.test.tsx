import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentViewerContext, type DocumentViewerApi } from '@/src/components/documents';
import type { ProjectDocumentRow } from '@/src/lib/db/documents';
import type { WorkOrderAcceptanceWithLines } from '@/src/lib/db/workOrderAcceptances';

vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { document: { getSignedUrl: vi.fn() } } }));
vi.mock('@/src/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/components/ui')>();
  const ButtonWithVariant = (props: React.ComponentProps<typeof actual.Button>) => {
    const buttonProps = { ...props, 'data-variant': props.variant ?? 'primary' } as React.ComponentProps<typeof actual.Button>;
    return React.createElement(actual.Button, buttonProps);
  };
  return { ...actual, Button: ButtonWithVariant };
});

import WorkOrderAcceptances from './WorkOrderAcceptances';

const draft = {
  id: 'acceptance-1',
  acceptance_date: '2026-11-13',
  prepared_at: '2026-11-13T00:00:00.000Z',
  prepared_by: 'u-pm',
  status: 'Draft',
  is_final: false,
  document_id: null,
  note: null,
  lines: [],
} as unknown as WorkOrderAcceptanceWithLines;
const signed = {
  ...draft,
  id: 'acceptance-signed',
  status: 'Confirmed',
  document_id: 'd1',
} as unknown as WorkOrderAcceptanceWithLines;
const document = { id: 'd1', title: 'Signed BAST 1', status: 'Issued', file_path: 'org/p1/d1/bast.pdf', source: 'upload' } as unknown as ProjectDocumentRow;

const renderAcceptances = (
  acceptances: WorkOrderAcceptanceWithLines[] = [draft],
  onPrepare = vi.fn(),
  onConfirm = vi.fn(),
  documents: ProjectDocumentRow[] = [],
  open: DocumentViewerApi['open'] = vi.fn(),
) => {
  render(
    <DocumentViewerContext.Provider value={{ open, close: vi.fn() }}>
      <MemoryRouter><WorkOrderAcceptances
        workOrder={{ id: 'wo-1', status: 'Issued' }}
        boqItems={[]}
        documents={documents}
        acceptances={acceptances}
        state="ready"
        onRetry={vi.fn()}
        currentUserId="u-finance"
        projectManagerId="u-pm"
        hasAllocations
        onPrepare={onPrepare}
        onEdit={vi.fn()}
        onWithdraw={vi.fn()}
        onConfirm={onConfirm}
      /></MemoryRouter>
    </DocumentViewerContext.Provider>,
  );
  return { onPrepare, onConfirm };
};

describe('WorkOrderAcceptances C21 primary actions', () => {
  it('AC-WORP-004 opens the work order from an acceptance', () => {
    renderAcceptances();
    expect(screen.getByRole('link', { name: 'Open work order' })).toHaveAttribute('href', '/work-orders/wo-1');
  });
  it('keeps Confirm BAST and Prepare BAST available and each starts its existing action', async () => {
    const user = userEvent.setup();
    const { onPrepare, onConfirm } = renderAcceptances();

    const confirm = screen.getByRole('button', { name: 'Confirm BAST' });
    const prepare = screen.getByRole('button', { name: 'Prepare BAST' });
    expect(confirm).toHaveAttribute('data-variant', 'primary');
    expect(prepare).toHaveAttribute('data-variant', 'outline');

    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith(draft);
    await user.click(prepare);
    expect(onPrepare).toHaveBeenCalledOnce();
  });

  it('fix-billing item 1: a draft names who it waits on (never an unnamed other party)', () => {
    renderAcceptances();
    expect(screen.getByTestId('bast-waiting-acceptance-1')).toHaveTextContent('Waiting for Finance or an Admin to confirm');
    expect(screen.queryByText(/someone else|other party/i)).not.toBeInTheDocument();
  });

  it('keeps Prepare BAST as the named primary when no draft needs confirmation', () => {
    renderAcceptances([]);

    expect(screen.getByRole('button', { name: 'Prepare BAST' })).toHaveAttribute('data-variant', 'primary');
    expect(screen.queryByRole('button', { name: 'Confirm BAST' })).not.toBeInTheDocument();
  });

  it('document-preview AC-016 opens the linked signed BAST in the shared viewer', async () => {
    const open = vi.fn<DocumentViewerApi['open']>();
    renderAcceptances([signed], vi.fn(), vi.fn(), [document], open);
    await userEvent.click(screen.getByRole('button', { name: 'Preview Signed BAST 1' }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0].key).toBe('project-document:d1');
  });

  it('document-preview AC-017 reports an unreadable linked BAST without showing a raw id or a no-document state', () => {
    renderAcceptances([signed]);
    expect(screen.getByText('Signed BAST:')).toBeInTheDocument();
    expect(screen.getByText('Document not available')).toBeInTheDocument();
    expect(screen.queryByText(/No signed BAST document linked/)).toBeNull();
    expect(screen.queryByText('d1')).toBeNull();
    expect(screen.queryByRole('button', { name: /Preview/ })).toBeNull();
  });
});
