import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider, useEffectiveRole } from '@/src/auth/impersonation';
import type { Role } from '@/src/auth/AuthContext';
import { ME, OTHER, makeDoc, makeLinkedDoc } from './m365Fixtures';

const h = vi.hoisted(() => ({
  docs: { data: [] as unknown[] },
  create: vi.fn(),
  link: vi.fn(),
  unlink: vi.fn(),
  createRevision: vi.fn(),
  getItem: vi.fn(),
  pick: null as null | ((ref: unknown) => Promise<void>),
}));

// The register mounts RecordFolderAction (own coverage: DocumentsTab.record-folder.test).
vi.mock('@/src/components/m365/RecordFolderAction', () => ({ RecordFolderAction: () => null }));
vi.mock('@/src/hooks/useDocuments', () => ({
  useDocuments: () => ({ data: h.docs.data, isPending: false, isError: false, refetch: vi.fn() }),
  useDocumentMutations: () => ({
    create: { mutateAsync: h.create }, update: { mutateAsync: vi.fn() },
    transition: { mutateAsync: vi.fn(), isPending: false }, remove: { mutateAsync: vi.fn(), isPending: false },
    link: { mutateAsync: h.link }, unlink: { mutateAsync: h.unlink, isPending: false },
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
vi.mock('@/src/hooks/useMicrosoftDocuments', () => ({
  useMicrosoftDocuments: () => ({ connection: { connected: true, status: 'active' }, isPending: false, refetch: vi.fn() }),
}));
vi.mock('@/src/components/m365/MicrosoftDocumentPicker', () => ({
  MicrosoftDocumentPicker: (props: { onSelect: (ref: unknown) => Promise<void> }) => {
    h.pick = props.onSelect;
    return (
      <div role="dialog" aria-label="Synthetic picker">
        <button type="button" onClick={() => void props.onSelect({ drive_id: 'synthetic-drive', item_id: 'synthetic-item', web_url: 'https://contoso.sharepoint.com/sites/synthetic/Shared%20Documents/Synthetic.pdf', name: 'Synthetic.pdf', item_kind: 'file' }).catch(() => undefined)}>
          Select synthetic item
        </button>
      </div>
    );
  },
}));
vi.mock('@/src/lib/m365/graphClient', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/src/lib/m365/graphClient')),
  getItem: h.getItem,
}));

import DocumentsTab from '../DocumentsTab';

const renderAs = (role: Role) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>
      <ImpersonationProvider realRole={role}>
        <ToastProvider>
          <DocumentsTab projectId="p1" projectCode="PRJ-1" />
        </ToastProvider>
      </ImpersonationProvider>
    </MemoryRouter></QueryClientProvider>,
  );

const menu = async () => {
  await userEvent.click(screen.getByRole('button', { name: /row actions/i }));
  return screen.getByRole('menu');
};

beforeEach(() => {
  vi.clearAllMocks();
  h.docs.data = [];
  h.create.mockResolvedValue(undefined);
  h.link.mockResolvedValue(undefined);
  h.unlink.mockResolvedValue(undefined);
  vi.spyOn(window, 'open').mockImplementation(() => null);
});

const SELECTED = {
  drive_id: 'synthetic-drive', item_id: 'synthetic-item',
  web_url: 'https://contoso.sharepoint.com/sites/synthetic/Shared%20Documents/Synthetic.pdf',
  name: 'Synthetic.pdf', item_kind: 'file',
};

function ViewAsControl() {
  const { viewAs } = useEffectiveRole();
  return <button type="button" onClick={() => viewAs('Engineer')}>View as Engineer</button>;
}

describe('DocumentsTab — create with a Microsoft reference (AC-M365DOC-011/040)', () => {
  it('view-only impersonation while the picker is open prevents the pending link mutation', async () => {
    h.docs.data = [makeDoc({ author_id: ME })];
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><ImpersonationProvider realRole="Admin" demoEligibility="eligible"><ToastProvider><ViewAsControl /><DocumentsTab projectId="p1" projectCode="PRJ-1" /></ToastProvider></ImpersonationProvider></MemoryRouter></QueryClientProvider>);
    await userEvent.click(within(await menu()).getByRole('menuitem', { name: 'Link from Microsoft 365' }));
    expect(screen.getByRole('dialog', { name: 'Synthetic picker' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'View as Engineer' }));
    await userEvent.click(screen.getByRole('button', { name: 'Select synthetic item' }));
    expect(h.link).not.toHaveBeenCalled();
  });

  it('keeps a pending reference form read-only after a view-as change', async () => {
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><ImpersonationProvider realRole="Admin" demoEligibility="eligible"><ToastProvider><ViewAsControl /><DocumentsTab projectId="p1" projectCode="PRJ-1" /></ToastProvider></ImpersonationProvider></MemoryRouter></QueryClientProvider>);
    await userEvent.click(screen.getByRole('button', { name: 'Link from Microsoft 365' }));
    await userEvent.click(screen.getByRole('button', { name: 'Select synthetic item' }));
    const form = screen.getByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: 'View as Engineer' }));
    expect(within(form).getByRole('button', { name: 'Add document' })).toBeDisabled();
    await userEvent.click(within(form).getByRole('button', { name: 'Add document' }));
    expect(h.create).not.toHaveBeenCalled();
  });

  it('AC-M365DOC-011: pick first, then the ordinary form; ONE create call carries the reference (no empty intermediate row)', async () => {
    renderAs('Project Manager');
    await userEvent.click(screen.getByRole('button', { name: 'Link from Microsoft 365' }));
    await userEvent.click(screen.getByRole('button', { name: 'Select synthetic item' }));
    // The picker closed before the form opened: one modal at a time, and nothing written yet.
    expect(screen.queryByRole('dialog', { name: 'Synthetic picker' })).not.toBeInTheDocument();
    expect(h.create).not.toHaveBeenCalled();
    const form = screen.getByRole('dialog');
    const title = within(form).getByRole('textbox', { name: /Title/ });
    expect(title).toHaveValue('Synthetic'); // F7: seeded without the file extension (still editable)
    await userEvent.clear(title);
    await userEvent.type(title, 'Foundation GA');
    await userEvent.click(within(form).getByRole('button', { name: 'Add document' }));
    await vi.waitFor(() => expect(h.create).toHaveBeenCalledTimes(1));
    expect(h.create.mock.calls[0][0]).toMatchObject({ title: 'Foundation GA', category: 'Drawing', source: 'onedrive', microsoft: SELECTED });
  });

  it('AC-M365DOC-040: the original metadata-only path is unchanged (no source, no reference)', async () => {
    renderAs('Project Manager');
    await userEvent.click(screen.getByRole('button', { name: 'Add document' }));
    const form = screen.getByRole('dialog');
    await userEvent.type(within(form).getByRole('textbox', { name: /Title/ }), 'Plain');
    await userEvent.click(within(form).getByRole('button', { name: 'Add document' }));
    await vi.waitFor(() => expect(h.create).toHaveBeenCalledTimes(1));
    expect(h.create.mock.calls[0][0]).not.toHaveProperty('microsoft');
    expect(h.create.mock.calls[0][0]).not.toHaveProperty('source');
  });

  it('AC-M365DOC-040: a role that cannot create documents is offered neither entry point', () => {
    renderAs('Engineer');
    expect(screen.queryByRole('button', { name: 'Link from Microsoft 365' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add document' })).not.toBeInTheDocument();
  });
});

describe('DocumentsTab — link / unlink an existing Draft (AC-M365DOC-040/041/063)', () => {
  it('AC-M365DOC-040: the author sees Link on an empty Draft and the pick is ONE link call', async () => {
    h.docs.data = [makeDoc({ author_id: ME })];
    renderAs('Project Manager');
    await userEvent.click(within(await menu()).getByRole('menuitem', { name: 'Link from Microsoft 365' }));
    await userEvent.click(screen.getByRole('button', { name: 'Select synthetic item' }));
    await vi.waitFor(() => expect(h.link).toHaveBeenCalledTimes(1));
    expect(h.link).toHaveBeenCalledWith({ id: 'd1', reference: SELECTED });
  });

  it('AC-M365DOC-040: Admin break-glass can link another author\'s Draft; a non-author PM cannot', async () => {
    h.docs.data = [makeDoc({ author_id: OTHER })];
    const { unmount } = renderAs('Project Manager');
    const denied = await menu();
    expect(within(denied).queryByRole('menuitem', { name: 'Link from Microsoft 365' })).not.toBeInTheDocument();
    unmount();
    renderAs('Admin');
    expect(within(await menu()).getByRole('menuitem', { name: 'Link from Microsoft 365' })).toBeInTheDocument();
  });

  it('AC-M365DOC-040: no Link on a non-Draft, an uploaded file, or an already linked row', async () => {
    for (const doc of [
      makeDoc({ status: 'Issued' }),
      makeDoc({ file_path: 'org-1/p1/d1/file.pdf' }),
      makeLinkedDoc(),
    ]) {
      h.docs.data = [doc];
      const { unmount } = renderAs('Project Manager');
      expect(within(await menu()).queryByRole('menuitem', { name: 'Link from Microsoft 365' })).not.toBeInTheDocument();
      unmount();
    }
  });

  it('AC-M365DOC-063: a failed link (e.g. source collision) keeps the picker selection and invokes nothing else', async () => {
    h.docs.data = [makeDoc({ author_id: ME })];
    h.link.mockRejectedValue(Object.assign(new Error('collision'), { code: '23514' }));
    renderAs('Project Manager');
    await userEvent.click(within(await menu()).getByRole('menuitem', { name: 'Link from Microsoft 365' }));
    await userEvent.click(screen.getByRole('button', { name: 'Select synthetic item' }));
    await vi.waitFor(() => expect(h.link).toHaveBeenCalledTimes(1));
    // The entry stays mounted (the picker owns the retained alert) and the row keeps its source.
    expect(screen.getByRole('dialog', { name: 'Synthetic picker' })).toBeInTheDocument();
    expect(h.unlink).not.toHaveBeenCalled();
  });

  it('AC-M365DOC-041: Unlink asks first; cancel leaves the row, confirm removes only the PMO reference', async () => {
    h.docs.data = [makeLinkedDoc()];
    renderAs('Project Manager');
    await userEvent.click(within(await menu()).getByRole('menuitem', { name: 'Unlink Microsoft item' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Only the PMO reference is removed. The Microsoft item is unchanged.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));
    expect(h.unlink).not.toHaveBeenCalled();
    await userEvent.click(within(await menu()).getByRole('menuitem', { name: 'Unlink Microsoft item' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Unlink' }));
    await vi.waitFor(() => expect(h.unlink).toHaveBeenCalledWith('d1'));
  });

  it('AC-M365DOC-041: an approved (non-Draft) reference cannot be unlinked from the menu', async () => {
    h.docs.data = [makeLinkedDoc({ status: 'Approved' })];
    renderAs('Admin');
    expect(within(await menu()).queryByRole('menuitem', { name: 'Unlink Microsoft item' })).not.toBeInTheDocument();
  });
});

describe('DocumentsTab — folders are reference-only (AC-M365DOC-058/063)', () => {
  const folder = (over = {}) => makeLinkedDoc({ ms_item_kind: 'folder', ms_item_name: 'Synthetic folder', ms_web_url: 'https://contoso.sharepoint.com/sites/synthetic/Shared%20Documents/Synthetic', ...over });

  it('AC-M365DOC-058: a folder row offers no issue/approve/revision/versions and the Drawer says reference-only', async () => {
    h.docs.data = [folder({ status: 'Issued' })];
    renderAs('Admin');
    const items = within(await menu());
    for (const name of ['Issue', 'Approve', 'Reject', 'Close', 'New revision', 'Make new revision from latest file update']) {
      expect(items.queryByRole('menuitem', { name })).not.toBeInTheDocument();
    }
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'View Foundation GA' }));
    const drawer = screen.getByRole('complementary');
    expect(within(drawer).getByText('Folder reference: contents are not issued or approved')).toBeInTheDocument();
    expect(within(drawer).queryByRole('button', { name: /versions/i })).not.toBeInTheDocument();
    expect(within(drawer).queryByRole('button', { name: /^Issue/ })).not.toBeInTheDocument();
  });

  it('AC-M365DOC-063: a Draft folder keeps metadata Edit and Unlink for the author', async () => {
    h.docs.data = [folder()];
    renderAs('Project Manager');
    const items = within(await menu());
    expect(items.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    expect(items.getByRole('menuitem', { name: 'Unlink Microsoft item' })).toBeInTheDocument();
    expect(items.queryByRole('menuitem', { name: 'Issue' })).not.toBeInTheDocument();
  });
});

describe('DocumentsTab — changed-content revision (AC-M365DOC-064/068)', () => {
  const drifted = () => makeLinkedDoc({ status: 'Issued', ms_drift_state: 'drifted', ms_content_tag_at_issue: 'ctag-1', ms_version_id_at_issue: '1.0' });

  it('keeps a pending latest-file revision read-only after a view-as change', async () => {
    h.docs.data = [drifted()];
    h.getItem.mockResolvedValue({ ...SELECTED, name: 'Synthetic v2.pdf', parent_path: null, content_tag: 'ctag-2', sharepoint_ids: null });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><ImpersonationProvider realRole="Admin" demoEligibility="eligible"><ToastProvider><ViewAsControl /><DocumentsTab projectId="p1" projectCode="PRJ-1" /></ToastProvider></ImpersonationProvider></MemoryRouter></QueryClientProvider>);
    await userEvent.click(within(await menu()).getByRole('menuitem', { name: 'Make new revision from latest file update' }));
    const modal = await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: 'View as Engineer' }));
    expect(within(modal).getByRole('button', { name: 'Create revision' })).toBeDisabled();
    await userEvent.click(within(modal).getByRole('button', { name: 'Create revision' }));
    expect(h.createRevision).not.toHaveBeenCalled();
  });

  it('AC-M365DOC-064: a drifted file re-reads the latest metadata, then creates ONE explicit child with that reference and no baseline', async () => {
    h.docs.data = [drifted()];
    h.getItem.mockResolvedValue({ ...SELECTED, item_id: 'synthetic-item', name: 'Synthetic v2.pdf', parent_path: null, content_tag: 'ctag-2', sharepoint_ids: null });
    renderAs('Project Manager');
    await userEvent.click(within(await menu()).getByRole('menuitem', { name: 'Make new revision from latest file update' }));
    expect(h.getItem).toHaveBeenCalledWith(expect.objectContaining({ drive_id: 'synthetic-drive', item_id: 'synthetic-item' }));
    const modal = await screen.findByRole('dialog');
    expect(within(modal).getByText(/will reference the latest Microsoft file: Synthetic v2\.pdf/)).toBeInTheDocument();
    await userEvent.click(within(modal).getByRole('button', { name: 'Create revision' }));
    expect(h.createRevision).toHaveBeenCalledTimes(1);
    const args = h.createRevision.mock.calls[0][0];
    expect(args).toMatchObject({ parentId: 'd1', microsoft: { drive_id: 'synthetic-drive', item_id: 'synthetic-item', name: 'Synthetic v2.pdf', item_kind: 'file' } });
    // Only the five reference fields travel: never the old pin, the content tag or the drift state.
    expect(Object.keys(args.microsoft).sort()).toEqual(['drive_id', 'item_id', 'item_kind', 'name', 'web_url']);
  });

  it('AC-M365DOC-068: the latest-file action exists only for a drifted file; the ordinary New revision stays', async () => {
    h.docs.data = [makeLinkedDoc({ status: 'Issued', ms_drift_state: 'clean' })];
    renderAs('Project Manager');
    const items = within(await menu());
    expect(items.getByRole('menuitem', { name: 'New revision' })).toBeInTheDocument();
    expect(items.queryByRole('menuitem', { name: 'Make new revision from latest file update' })).not.toBeInTheDocument();
  });
});
