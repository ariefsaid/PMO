import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ME, makeLinkedDoc } from './m365Fixtures';

const h = vi.hoisted(() => ({
  conn: { connection: undefined as unknown, isPending: false, refetch: vi.fn() },
  getItem: vi.fn(),
  unlink: vi.fn(),
  createRevision: vi.fn(),
}));

vi.mock('@/src/hooks/useDocuments', () => ({
  useDocuments: () => ({
    data: [makeLinkedDoc({ status: 'Issued', ms_drift_state: 'drifted', ms_last_verified_at: '2026-06-03T00:00:00Z' })],
    isPending: false, isError: false, refetch: vi.fn(),
  }),
  useDocumentMutations: () => ({
    create: { mutateAsync: vi.fn() }, update: { mutateAsync: vi.fn() },
    transition: { mutateAsync: vi.fn(), isPending: false }, remove: { mutateAsync: vi.fn(), isPending: false },
    link: { mutateAsync: vi.fn() }, unlink: { mutateAsync: h.unlink, isPending: false },
  }),
  useChildDocument: () => ({ data: null, isPending: false }),
}));
vi.mock('@/src/hooks/useFileUpload', () => ({
  useFileUpload: () => ({
    upload: { mutate: vi.fn() }, replace: { mutate: vi.fn() }, progress: {}, uploadErrors: {},
    cancelUpload: vi.fn(), clearUploadError: vi.fn(),
  }),
}));
vi.mock('@/src/hooks/useRevision', () => ({ useRevision: () => ({ createRevision: { mutate: h.createRevision, isPending: false } }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: ME, org_id: 'org-1' } }) }));
vi.mock('@/src/hooks/useMicrosoftDocuments', () => ({ useMicrosoftDocuments: () => h.conn }));
vi.mock('@/src/components/m365/MicrosoftDocumentPicker', () => ({ MicrosoftDocumentPicker: () => null }));
vi.mock('@/src/lib/m365/graphClient', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/src/lib/m365/graphClient')),
  getItem: h.getItem,
}));

import DocumentsTab from '../DocumentsTab';

const renderTab = () =>
  render(
    <MemoryRouter>
      <ImpersonationProvider realRole="Project Manager">
        <ToastProvider>
          <DocumentsTab projectId="p1" projectCode="PRJ-1" />
        </ToastProvider>
      </ImpersonationProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  h.conn.connection = undefined;
  h.conn.isPending = false;
  vi.spyOn(window, 'open').mockImplementation(() => null);
});

const rowOpenStillWorks = () => {
  expect(screen.getByRole('button', { name: /Open in SharePoint/ })).toBeEnabled();
  expect(h.unlink).not.toHaveBeenCalled();
};

describe('DocumentsTab — project degradation matrix (AC-M365DOC-032/033/034/035)', () => {
  it.each([
    ['AC-M365DOC-032 stale', { connected: true, status: 'stale' }, /expired/],
    ['AC-M365DOC-032 revoked', { connected: true, status: 'revoked' }, /expired/],
    ['AC-M365DOC-033 absent', { connected: false, status: null }, /Connect Microsoft 365 first/],
  ])('%s: browse is recovered through reviewed copy; row, open and the reference stay', async (_name, connection, copy) => {
    h.conn.connection = connection;
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'From Microsoft 365' }));
    expect(screen.getByText(copy)).toBeInTheDocument();
    rowOpenStillWorks();
  });

  it('AC-M365DOC-034: an opaque/adversarial failure reading the latest file shows only generic copy; nothing is created or unlinked', async () => {
    h.getItem.mockRejectedValue(Object.assign(new Error('synthetic-raw-secret token=abc'), { code: 'GRAPH_ERROR' }));
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: /row actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Make new revision from latest file update' }));
    expect((await screen.findAllByText(/Microsoft could not load this file/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/synthetic-raw-secret/)).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /New revision/ })).not.toBeInTheDocument();
    expect(h.createRevision).not.toHaveBeenCalled();
    rowOpenStillWorks();
  });

  it('AC-M365DOC-035: a network failure behaves the same and keeps the success as-of on the row', async () => {
    h.getItem.mockRejectedValue(new TypeError('Failed to fetch'));
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: /row actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Make new revision from latest file update' }));
    expect((await screen.findAllByText(/Microsoft could not load this file/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/Checked/)).toBeInTheDocument();
    rowOpenStillWorks();
  });

  it('AC-M365DOC-035: a latest item that is no longer a file refuses the revision', async () => {
    h.getItem.mockResolvedValue({ drive_id: 'd', item_id: 'i', web_url: 'https://contoso.sharepoint.com/x', name: 'Folder', item_kind: 'folder' });
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: /row actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Make new revision from latest file update' }));
    expect((await screen.findAllByText(/Microsoft could not load this file/)).length).toBeGreaterThan(0);
    expect(h.createRevision).not.toHaveBeenCalled();
  });
});
