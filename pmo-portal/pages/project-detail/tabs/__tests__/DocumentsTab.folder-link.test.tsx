import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ME, makeLinkedDoc } from './m365Fixtures';

const FOLDER = {
  drive_id: 'synthetic-drive',
  item_id: 'synthetic-folder',
  web_url: 'https://contoso.sharepoint.com/sites/synthetic/Shared%20Documents/Synthetic',
  name: 'Synthetic folder',
  item_kind: 'folder' as const,
};

const h = vi.hoisted(() => ({ docs: { data: [] as unknown[] }, create: vi.fn() }));

vi.mock('@/src/components/m365/RecordFolderAction', () => ({ RecordFolderAction: () => null }));
vi.mock('@/src/hooks/useDocuments', () => ({
  useDocuments: () => ({ data: h.docs.data, isPending: false, isError: false, refetch: vi.fn() }),
  useDocumentMutations: () => ({
    create: { mutateAsync: h.create }, update: { mutateAsync: vi.fn() },
    transition: { mutateAsync: vi.fn(), isPending: false }, remove: { mutateAsync: vi.fn(), isPending: false },
    link: { mutateAsync: vi.fn() }, unlink: { mutateAsync: vi.fn(), isPending: false },
  }),
  useChildDocument: () => ({ data: null, isPending: false }),
}));
vi.mock('@/src/hooks/useFileUpload', () => ({
  useFileUpload: () => ({ upload: { mutate: vi.fn() }, replace: { mutate: vi.fn() }, progress: {}, uploadErrors: {}, cancelUpload: vi.fn(), clearUploadError: vi.fn() }),
}));
vi.mock('@/src/hooks/useRevision', () => ({ useRevision: () => ({ createRevision: { mutate: vi.fn(), isPending: false } }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: ME, org_id: 'org-1' } }) }));
vi.mock('@/src/hooks/useMicrosoftDocuments', () => ({
  useMicrosoftDocuments: () => ({ connection: { connected: true, status: 'active' }, isPending: false, refetch: vi.fn() }),
}));
vi.mock('@/src/components/m365/MicrosoftDocumentPicker', () => ({
  MicrosoftDocumentPicker: (props: { onSelect: (ref: unknown) => Promise<void> }) => (
    <div role="dialog" aria-label="Synthetic picker">
      <button type="button" onClick={() => void props.onSelect(FOLDER)}>Select synthetic folder</button>
    </div>
  ),
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

beforeEach(() => {
  h.docs.data = [];
  h.create.mockReset();
  h.create.mockResolvedValue(undefined);
});

describe('DocumentsTab — linking a SharePoint folder (#1320 AC-1)', () => {
  it('AC-1: the folder form asks for a title only (no Category, Revision, Code) and saves it as a Reference', async () => {
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'Link from Microsoft 365' }));
    await userEvent.click(screen.getByRole('button', { name: 'Select synthetic folder' }));
    const form = await screen.findByRole('dialog');
    expect(within(form).getByLabelText(/Title/)).toHaveValue('Synthetic folder');
    expect(within(form).queryByLabelText(/Category/)).not.toBeInTheDocument();
    expect(within(form).queryByLabelText(/Revision/)).not.toBeInTheDocument();
    expect(within(form).queryByLabelText(/^Code/)).not.toBeInTheDocument();
    await userEvent.click(within(form).getByRole('button', { name: 'Add document' }));
    await vi.waitFor(() => expect(h.create).toHaveBeenCalledTimes(1));
    expect(h.create.mock.calls[0][0]).toMatchObject({ title: 'Synthetic folder', category: 'Reference', source: 'onedrive', microsoft: FOLDER });
  });

  it('AC-1: a linked folder row uses the Reference category without an issue status; a file row still does', () => {
    h.docs.data = [
      makeLinkedDoc({ id: 'f1', title: 'Site folder', category: 'Reference', ms_item_kind: 'folder', ms_item_name: 'Site folder', ms_web_url: FOLDER.web_url }),
      makeLinkedDoc({ id: 'f2', title: 'Foundation GA' }),
    ];
    renderTab();
    const folderRow = screen.getByRole('button', { name: 'View Site folder' }).closest('tr') as HTMLElement;
    expect(within(folderRow).queryByText('Draft')).not.toBeInTheDocument();
    expect(within(folderRow).getByText('Reference')).toBeInTheDocument();
    const fileRow = screen.getByRole('button', { name: 'View Foundation GA' }).closest('tr') as HTMLElement;
    expect(within(fileRow).getByText('Draft')).toBeInTheDocument();
    expect(within(fileRow).getByText('Drawing')).toBeInTheDocument();
  });

  it('AC-1: the folder preview omits the status, category, code and revision fields', async () => {
    h.docs.data = [makeLinkedDoc({ title: 'Site folder', category: 'Reference', ms_item_kind: 'folder', ms_web_url: FOLDER.web_url })];
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'View Site folder' }));
    const drawer = screen.getByRole('complementary');
    expect(within(drawer).queryByText('Draft')).not.toBeInTheDocument();
    for (const label of ['Status', 'Category', 'Code', 'Revision']) {
      expect(within(drawer).queryByText(label)).not.toBeInTheDocument();
    }
  });
});
