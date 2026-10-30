import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ME, makeLinkedDoc } from './m365Fixtures';

const h = vi.hoisted(() => ({
  conn: { connection: undefined as unknown, isPending: false, refetch: vi.fn() },
  pickerProps: [] as Array<{ context: unknown }>,
  pickerRequests: vi.fn(),
}));

// The register mounts RecordFolderAction (own coverage: DocumentsTab.record-folder.test).
vi.mock('@/src/components/m365/RecordFolderAction', () => ({ RecordFolderAction: () => null }));
vi.mock('@/src/hooks/useDocuments', () => ({
  useDocuments: () => ({ data: [makeLinkedDoc()], isPending: false, isError: false, refetch: vi.fn() }),
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
vi.mock('@/src/hooks/useMicrosoftDocuments', () => ({ useMicrosoftDocuments: () => h.conn }));
vi.mock('@/src/components/m365/MicrosoftDocumentPicker', () => ({
  MicrosoftDocumentPicker: (props: { context: unknown }) => {
    h.pickerProps.push(props);
    h.pickerRequests();
    return <div role="dialog" aria-label="Synthetic picker" />;
  },
}));

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

const openEntry = () => userEvent.click(screen.getByRole('button', { name: 'Link from Microsoft 365' }));

beforeEach(() => {
  h.pickerProps.length = 0;
  h.pickerRequests.mockClear();
  h.conn.refetch.mockClear();
  h.conn.connection = undefined;
  h.conn.isPending = false;
});

describe('DocumentsTab — Microsoft connection gate (AC-M365DOC-014/031)', () => {
  it('AC-M365DOC-031: an absent connection offers the setup link and opens no picker', async () => {
    h.conn.connection = { connected: false, status: null };
    renderTab();
    await openEntry();
    expect(screen.getByText(/Connect Microsoft 365 first/)).toBeInTheDocument();
    // F6: the personal connection page, reachable by every role (not the Admin-only administration area).
    expect(screen.getByRole('link', { name: 'My integrations' })).toHaveAttribute('href', '/integrations');
    expect(h.pickerRequests).not.toHaveBeenCalled();
  });

  it('AC-M365DOC-014: a pending status never guesses active — no picker', async () => {
    h.conn.isPending = true;
    renderTab();
    await openEntry();
    expect(screen.getAllByRole('status').some((el) => /Checking your Microsoft 365 connection/.test(el.textContent ?? ''))).toBe(true);
    expect(h.pickerRequests).not.toHaveBeenCalled();
  });

  it('AC-M365DOC-014: a failed status read shows an explicit retry next to the action, never a picker', async () => {
    renderTab();
    await openEntry();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.conn.refetch).toHaveBeenCalledTimes(1);
    expect(h.pickerRequests).not.toHaveBeenCalled();
  });

  it('AC-M365DOC-014: a stale/revoked connection shows the reconnect notice and no picker', async () => {
    h.conn.connection = { connected: true, status: 'stale' };
    renderTab();
    await openEntry();
    expect(screen.getByRole('button', { name: /Reconnect Microsoft 365/ })).toBeInTheDocument();
    expect(h.pickerRequests).not.toHaveBeenCalled();
  });

  it('AC-M365DOC-014: an active connection mounts the picker with the PROJECT code as context', async () => {
    h.conn.connection = { connected: true, status: 'active' };
    renderTab();
    await openEntry();
    expect(screen.getByRole('dialog', { name: 'Synthetic picker' })).toBeInTheDocument();
    expect(h.pickerProps.at(-1)?.context).toEqual({ kind: 'project', code: 'PRJ-1' });
  });

  it('AC-M365DOC-031: committed rows render and open whatever the connection says', async () => {
    h.conn.connection = { connected: false, status: null };
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'View Foundation GA' }));
    expect(within(screen.getByRole('complementary')).getByRole('button', { name: /Open in SharePoint/ })).toBeEnabled();
  });
});
