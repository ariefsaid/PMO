// @vitest-environment jsdom
/**
 * AC-M365DOC-069/071 — the project Documents register mounts the one Create-folder action, driven
 * by the register's own rows. The actual tab is rendered; only the data hooks are stubbed.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider, useEffectiveRole } from '@/src/auth/impersonation';
import type { Role } from '@/src/auth/AuthContext';
import { AppError } from '@/src/lib/appError';
import { recordFolderKey } from '@/src/hooks/recordFolderState';

const { docsState, ensure } = vi.hoisted(() => ({
  docsState: { data: [] as Array<Record<string, unknown>>, isPending: false, isError: false, refetch: vi.fn() },
  ensure: vi.fn(),
}));
vi.mock('@/src/hooks/useDocuments', () => ({
  useDocuments: () => docsState,
  useDocumentMutations: () => ({
    create: { mutateAsync: vi.fn() }, update: { mutateAsync: vi.fn() },
    transition: { mutateAsync: vi.fn(), isPending: false }, remove: { mutateAsync: vi.fn(), isPending: false },
  }),
  useChildDocument: () => ({ data: null, isPending: false }),
}));
vi.mock('@/src/hooks/useFileUpload', () => ({
  useFileUpload: () => ({
    upload: { mutate: vi.fn(), isPending: false }, replace: { mutate: vi.fn(), isPending: false },
    progress: {}, uploadErrors: {}, cancelUpload: vi.fn(), clearUploadError: vi.fn(),
  }),
}));
vi.mock('@/src/hooks/useRevision', () => ({ useRevision: () => ({ createRevision: { mutate: vi.fn(), isPending: false } }) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { document: {}, m365RecordFolders: { ensure: (...a: unknown[]) => ensure(...a) } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }) }));

import DocumentsTab from '../DocumentsTab';

const row = (over: Record<string, unknown>) => ({
  id: 'd1', project_id: 'p1', title: 'Foundation GA', code: 'DWG-001', category: 'Drawing', revision: 'A',
  doc_date: '2026-06-01', status: 'Draft', author_id: 'u1', source: null, ms_item_kind: null, ...over,
});
let qc: QueryClient;
function ViewAs({ role }: { role: Role }) {
  const { viewAs } = useEffectiveRole();
  React.useEffect(() => viewAs(role), [role, viewAs]);
  return null;
}
const renderTab = (role: Role = 'Project Manager', viewAs?: Role) =>
  render(
    <QueryClientProvider client={qc}>
      <ImpersonationProvider realRole={role} demoEligibility="eligible">
        {viewAs ? <ViewAs role={viewAs} /> : null}
        <ToastProvider><MemoryRouter><DocumentsTab projectId="p1" /></MemoryRouter></ToastProvider>
      </ImpersonationProvider>
    </QueryClientProvider>,
  );
const create = () => screen.queryAllByRole('button', { name: 'Create folder in SharePoint' });

beforeEach(() => {
  ensure.mockReset();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  docsState.data = [row({})];
  docsState.isPending = false;
  docsState.isError = false;
});

describe('AC-M365DOC-071 DocumentsTab mount', () => {
  it('shows exactly one Create folder action to a writer when the register has only plain/file refs', () => {
    docsState.data = [row({}), row({ id: 'd2', source: 'onedrive', ms_item_kind: 'file' })];
    renderTab('Project Manager');
    expect(create()).toHaveLength(1);
  });

  it('hides it when the register holds a folder reference (direct open does not depend on the connection)', () => {
    docsState.data = [row({ id: 'f1', source: 'onedrive', ms_item_kind: 'folder' })];
    renderTab('Project Manager');
    expect(create()).toHaveLength(0);
  });

  it('a read-only role (Engineer) and view-only impersonation see no action', () => {
    renderTab('Engineer');
    expect(create()).toHaveLength(0);
    document.body.innerHTML = '';
    renderTab('Admin', 'Engineer');
    expect(create()).toHaveLength(0);
  });

  it('adds no Issue/Approve/version controls of its own and leaves the Add document control in place', () => {
    renderTab('Project Manager');
    expect(screen.getByRole('button', { name: 'Add document' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /issue|approve|version/i })).toBeNull();
  });

  it('a failed ensure leaves the register rows rendered and offers the one retry', async () => {
    ensure.mockRejectedValue(new AppError('RAW-UPSTREAM-MARKER', 'GRAPH_ERROR'));
    renderTab('Project Manager');
    await userEvent.setup().click(create()[0]);
    expect((await screen.findByTestId('record-folder-failure')).textContent).toContain('Record saved. Folder not linked.');
    expect(screen.getByText('Foundation GA')).toBeTruthy();
    expect(document.body.textContent).not.toContain('RAW-UPSTREAM');
    expect(create()).toHaveLength(1);
  });

  it('shows a failure recorded by the create-time coordinator after navigation', () => {
    qc.setQueryData(recordFolderKey('org-1', 'u1', { kind: 'project', id: 'p1' }), {
      status: 'settled', copy: { key: 'error.defaultUnset', remedy: 'contactAdmin', ok: false },
    });
    renderTab('Project Manager');
    expect(screen.getByTestId('record-folder-failure').textContent).toContain('Ask an Admin to choose the default document library.');
  });

  it('targets the project id and reloads the register on success', async () => {
    ensure.mockResolvedValue({ state: 'created', document_id: '22222222-2222-4222-8222-222222222222' });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderTab('Project Manager');
    await userEvent.setup().click(create()[0]);
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['project-documents', 'org-1', 'p1'] }));
    expect(ensure).toHaveBeenCalledWith({ kind: 'project', id: 'p1' });
  });
});
