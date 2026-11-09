import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentViewerContext } from '@/src/components/documents';
import type { ProjectDocumentRow } from '@/src/lib/db/documents';
import type { WorkOrderAcceptanceWithLines } from '@/src/lib/db/workOrderAcceptances';

vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => false }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { document: { getSignedUrl: vi.fn() } } }));

import WorkOrderAcceptances from '../WorkOrderAcceptances';

const doc = { id: 'd1', title: 'Signed BAST 1', status: 'Issued', file_path: 'org/p1/d1/bast.pdf', source: 'upload' } as unknown as ProjectDocumentRow;
const acceptance = {
  id: 'a1', status: 'Confirmed', is_final: false, acceptance_date: '2026-10-20', prepared_at: '2026-10-20T00:00:00Z',
  prepared_by: 'u-pm', document_id: 'd1', confirm_basis: 'standard', note: null, lines: [],
} as unknown as WorkOrderAcceptanceWithLines;

describe('WorkOrderAcceptances', () => {
  it('AC-016 the signed BAST title opens the viewer', async () => {
    const open = vi.fn();
    render(
      <DocumentViewerContext.Provider value={{ open, close: vi.fn() }}>
        <WorkOrderAcceptances workOrder={{ id: 'wo-1', status: 'Issued' }} boqItems={[]} documents={[doc]} acceptances={[acceptance]}
          state="ready" onRetry={vi.fn()} currentUserId="u-fin" projectManagerId="u-pm" hasAllocations
          onPrepare={vi.fn()} onEdit={vi.fn()} onWithdraw={vi.fn()} onConfirm={vi.fn()} />
      </DocumentViewerContext.Provider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Preview Signed BAST 1' }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0].key).toBe('project-document:d1');
  });
});
