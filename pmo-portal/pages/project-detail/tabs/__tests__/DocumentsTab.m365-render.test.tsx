import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ME, REFERENCE, makeDoc, makeLinkedDoc } from './m365Fixtures';

const h = vi.hoisted(() => ({
  docs: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  connectionReads: vi.fn(),
  graph: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

// The register mounts RecordFolderAction (own coverage: DocumentsTab.record-folder.test).
const destinationState = vi.hoisted(() => ({ value: { kind: 'private' } as { kind: 'private' | 'microsoft' | 'unknown' } }));
vi.mock('@/src/hooks/useUploadDestination', async (orig) => ({
  ...(await orig<typeof import('@/src/hooks/useUploadDestination')>()),
  useUploadDestination: () => destinationState.value,
}));

vi.mock('@/src/components/m365/RecordFolderAction', () => ({ RecordFolderAction: () => null }));
vi.mock('@/src/hooks/useDocuments', () => ({
  useDocuments: () => h.docs,
  useDocumentMutations: () => ({
    create: { mutateAsync: vi.fn() }, update: { mutateAsync: vi.fn() },
    transition: { mutateAsync: vi.fn(), isPending: false }, remove: { mutateAsync: vi.fn(), isPending: false },
    link: { mutateAsync: vi.fn() }, unlink: { mutateAsync: vi.fn(), isPending: false },
  }),
  useChildDocument: () => ({ data: null, isPending: false }),
}));
vi.mock('@/src/hooks/useFileUpload', () => ({
  useFileUpload: () => ({
    upload: { mutate: vi.fn() }, replace: { mutate: vi.fn() }, progress: {}, uploadErrors: {},
    cancelUpload: vi.fn(), clearUploadError: vi.fn(),
  }),
}));
vi.mock('@/src/hooks/useRevision', () => ({ useRevision: () => ({ createRevision: { mutate: vi.fn(), isPending: false } }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: ME, org_id: 'org-1' } }) }));
// The connection is read only on a mutation browse entry; a committed row must never touch it.
vi.mock('@/src/hooks/useMicrosoftDocuments', () => ({
  useMicrosoftDocuments: () => { h.connectionReads(); return { connection: undefined, isPending: true, refetch: vi.fn() }; },
}));
vi.mock('@/src/components/m365/MicrosoftDocumentPicker', () => ({ MicrosoftDocumentPicker: () => null }));
vi.mock('@/src/lib/m365/graphClient', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/src/lib/m365/graphClient');
  const spies: Record<string, unknown> = { ...actual };
  for (const [key, value] of Object.entries(actual)) {
    if (typeof value === 'function') { h.graph[key] = vi.fn(); spies[key] = h.graph[key]; }
  }
  return spies;
});

import DocumentsTab from '../DocumentsTab';

const renderTab = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>
      <ImpersonationProvider realRole="Project Manager">
        <ToastProvider>
          <DocumentsTab projectId="p1" projectCode="PRJ-1" />
        </ToastProvider>
      </ImpersonationProvider>
    </MemoryRouter></QueryClientProvider>,
  );

beforeEach(() => {
  h.docs.isPending = false;
  h.docs.isError = false;
  h.connectionReads.mockClear();
  Object.values(h.graph).forEach((spy) => spy.mockClear());
  h.graph.checkMicrosoftDocuments?.mockResolvedValue(undefined);
  vi.spyOn(window, 'open').mockImplementation(() => null);
});

describe('DocumentsTab — Microsoft reference rendering', () => {
  it('AC-M365DOC-020: a linked document shows its PMO title, status and the Microsoft file cell, with no upload controls', async () => {
    h.docs.data = [makeLinkedDoc()];
    renderTab();
    expect(screen.getByRole('button', { name: 'View Foundation GA' })).toBeInTheDocument();
    expect(screen.getAllByText('Draft').length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: 'View Foundation GA' }));
    const preview = screen.getByRole('complementary');
    expect(within(preview).getByText('SharePoint file')).toBeInTheDocument();
    expect(within(preview).getByRole('button', { name: /Open in SharePoint: Foundation GA/ })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /upload/i })).not.toBeInTheDocument();
  });

  it('AC-M365DOC-021: direct open uses only the stored URL — no connection read and no Graph request', async () => {
    h.docs.data = [makeLinkedDoc()];
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'View Foundation GA' }));
    await userEvent.click(within(screen.getByRole('complementary')).getByRole('button', { name: /Open in SharePoint: Foundation GA/ }));
    expect(window.open).toHaveBeenCalledWith(REFERENCE.web_url, '_blank', 'noopener,noreferrer');
    expect(h.connectionReads).not.toHaveBeenCalled();
    for (const spy of Object.values(h.graph)) expect(spy).not.toHaveBeenCalled();
  });

  it('AC-M365DOC-022: with no connection state at all the committed row still renders and opens', async () => {
    // The mocked connection hook would report "pending forever" if it were consulted.
    h.docs.data = [makeLinkedDoc({
      status: 'Approved',
      ms_drift_state: 'clean',
      ms_last_verified_at: new Date().toISOString(),
    })];
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'View Foundation GA' }));
    expect(within(screen.getByRole('complementary')).getByRole('button', { name: /Open latest in SharePoint/ })).toBeEnabled();
    expect(h.connectionReads).not.toHaveBeenCalled();
  });

  it('AC-M365DOC-023: the Drawer shows the same Microsoft cell and resolves the row against the refreshed register', async () => {
    h.docs.data = [makeLinkedDoc()];
    const view = renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'View Foundation GA' }));
    const drawer = screen.getByRole('complementary');
    expect(within(drawer).getByText('SharePoint file')).toBeInTheDocument();
    // The register refetches with the file renamed in PMO: the open drawer follows it (no stale copy).
    h.docs.data = [makeLinkedDoc({ title: 'Foundation GA (renamed)' })];
    view.rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>
        <ImpersonationProvider realRole="Project Manager">
          <ToastProvider>
            <DocumentsTab projectId="p1" projectCode="PRJ-1" />
          </ToastProvider>
        </ImpersonationProvider>
      </MemoryRouter></QueryClientProvider>,
    );
    expect(within(screen.getByRole('complementary')).getByText('Foundation GA (renamed)')).toBeInTheDocument();
  });

  it('AC-M365DOC-030: list loading/error stay tied to the document query only', () => {
    h.docs.data = [];
    h.docs.isError = true;
    renderTab();
    expect(screen.getByText(/Couldn't load documents/)).toBeInTheDocument();
    expect(h.connectionReads).not.toHaveBeenCalled();
  });

  it('an upload row (and a legacy incomplete reference) keeps the ordinary File cell', () => {
    h.docs.data = [makeDoc({ title: 'Plain upload' }), makeDoc({ id: 'd2', title: 'Half link', source: 'onedrive' })];
    renderTab();
    expect(screen.queryByText('SharePoint file')).not.toBeInTheDocument();
  });
});
